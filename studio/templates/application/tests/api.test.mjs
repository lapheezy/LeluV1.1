import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { after, before } from "node:test";

import { createApiServer, statsFor, validateTask } from "../server.mjs";

let server;
let base;
let dataDir;

async function call(route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "pulse-test-"));
  server = createApiServer({ dataFile: path.join(dataDir, "tasks.json") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

test("health reports the service without inventing data", async () => {
  const { status, body } = await call("/api/health");
  assert.equal(status, 200);
  assert.equal(body.service, "pulse-board");
  assert.equal(body.tasks, 0);
});

test("creating a task persists it and returns an id", async () => {
  const created = await call("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "Ship the studio", lane: "todo" }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.task.title, "Ship the studio");
  assert.equal(created.body.task.lane, "todo");
  assert.ok(created.body.task.id > 0);

  const listed = await call("/api/tasks");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.tasks.length, 1);
});

test("the core workflow moves a task across every lane", async () => {
  const listed = await call("/api/tasks");
  const task = listed.body.tasks[0];

  const doing = await call(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({ lane: "doing" }),
  });
  assert.equal(doing.status, 200);
  assert.equal(doing.body.task.lane, "doing");

  const done = await call(`/api/tasks/${task.id}`, {
    method: "PATCH",
    body: JSON.stringify({ lane: "done" }),
  });
  assert.equal(done.body.task.lane, "done");

  const stats = await call("/api/stats");
  assert.equal(stats.body.total, 1);
  assert.equal(stats.body.byLane.done, 1);
  assert.equal(stats.body.donePercent, 100);
});

test("lane filtering is done by the backend, not the browser", async () => {
  await call("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Second task", lane: "todo" }) });
  const filtered = await call("/api/tasks?lane=todo");
  assert.equal(filtered.body.tasks.length, 1);
  assert.equal(filtered.body.tasks[0].lane, "todo");
});

test("invalid input is refused with a named reason", async () => {
  const short = await call("/api/tasks", { method: "POST", body: JSON.stringify({ title: "x" }) });
  assert.equal(short.status, 400);
  assert.match(short.body.errors[0], /3 characters/);

  const badLane = await call("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Valid title", lane: "nowhere" }) });
  assert.equal(badLane.status, 400);
  assert.match(badLane.body.errors[0], /todo, doing, done/);
});

test("unknown tasks and routes are 404, not silent successes", async () => {
  const missing = await call("/api/tasks/9999", { method: "PATCH", body: JSON.stringify({ lane: "done" }) });
  assert.equal(missing.status, 404);
  const route = await call("/api/nothing");
  assert.equal(route.status, 404);
});

test("deleting a task removes it from the store", async () => {
  const listed = await call("/api/tasks");
  const id = listed.body.tasks[0].id;
  const removed = await call(`/api/tasks/${id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  const after = await call("/api/tasks");
  assert.equal(after.body.tasks.some((task) => task.id === id), false);
});

test("stats are computed from the real task list", () => {
  assert.deepEqual(statsFor([]), { total: 0, byLane: { todo: 0, doing: 0, done: 0 }, donePercent: 0 });
  assert.deepEqual(
    statsFor([
      { lane: "todo" },
      { lane: "done" },
      { lane: "done" },
      { lane: "doing" },
    ]),
    { total: 4, byLane: { todo: 1, doing: 1, done: 2 }, donePercent: 50 },
  );
});

test("validation is pure and reports every problem", () => {
  assert.deepEqual(validateTask({ title: "Good title", lane: "todo" }), []);
  const errors = validateTask({ title: " ", lane: "sideways" });
  assert.equal(errors.length, 2);
});
