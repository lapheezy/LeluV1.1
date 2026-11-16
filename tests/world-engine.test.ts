/**
 * LÉLUVERSE — WORLD ENGINE
 *
 * Through the real HTTP surface (the routes the browser and LÉLU's tools
 * call): the home room exists, environments are created and entered
 * without losing each other's state, objects are created and manipulated,
 * every change is a restorable version, sandboxes only replace a working
 * environment with approval, and all of it survives a restart.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMeshyForgeApi } from "../plugins/meshyForgeApi";

async function serve(root: string) {
  const api = createMeshyForgeApi(() => undefined, { assetRoot: root, poll: false });
  const handlers: Array<(req: unknown, res: unknown, next: () => void) => void> = [];
  api.attach({ use: (_p, h) => handlers.push(h as never) });
  const server = createServer((req, res) => handlers[0](req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/forge${p}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("environments, objects, versions, sandboxes and restart persistence", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-world-"));
  let s = await serve(root);
  try {
    // Home: LÉLU's circular room exists from the start.
    let state = (await s.call("GET", "/world")).json;
    assert.equal(state.current, "home");
    assert.equal(state.environment.kind, "room");
    assert.equal(state.objects.length, 0);

    // Create and manipulate objects in the room.
    const box = (await s.call("POST", "/world/objects", { shape: "box", label: "crate", color: "#ff8800", position: [1, -2, 3] })).json.object;
    assert.equal(box.environmentId, "home");
    assert.deepEqual(box.position, [1, -2, 3]);
    const ball = (await s.call("POST", "/world/objects", { shape: "sphere", label: "ball", physics: { mass: 2, restitution: 0.8 } })).json.object;
    assert.equal(ball.physics.dynamic, true);
    assert.equal((await s.call("POST", "/world/objects", { shape: "teapot" })).status, 400);

    await s.call("POST", `/placements/${box.id}/update`, { position: [2, -2.05, 3], rotationY: 0.5, height: 1.5 });
    const recoloured = (await s.call("POST", `/world/objects/${box.id}/modify`, { primitive: { color: "#00ff88", metalness: 0.9 } })).json.object;
    assert.equal(recoloured.primitive.color, "#00ff88");
    assert.equal(recoloured.primitive.shape, "box", "unspecified fields are kept");
    await s.call("POST", "/world/environments/home/update", { settings: { accent: "#38bdf8", keyLight: 2.5, radius: 9, fogDensity: 9 } });
    state = (await s.call("GET", "/world")).json;
    assert.equal(state.environment.settings.accent, "#38bdf8");
    assert.equal(state.environment.settings.fogDensity, 0.2, "settings are clamped");

    // A second environment; moving between them keeps both intact.
    const lab = (await s.call("POST", "/world/environments", { name: "Engineering bay", kind: "lab" })).json.environment;
    assert.equal(lab.id, "engineering-bay");
    assert.equal(lab.settings.accent, "#38bdf8", "lab preset");
    state = (await s.call("POST", "/world/enter", { id: lab.id })).json;
    assert.equal(state.objects.length, 0);
    await s.call("POST", "/world/objects", { shape: "torus", label: "gear" });
    state = (await s.call("POST", "/world/enter", { id: "home" })).json;
    assert.deepEqual(state.objects.map((o: { label: string }) => o.label).sort(), ["ball", "crate"], "home kept its objects");

    // Physics settling writes the resting positions back.
    await s.call("POST", "/world/settled", { positions: { [ball.id]: [0.5, -2.3, 2] } });

    // Every change is a version; restore puts the room back exactly.
    const history = (await s.call("GET", "/world/environments/home/history")).json.history;
    assert.ok(history.length >= 5, `versions recorded (${history.length})`);
    const firstWithCrate = history.find((h: { objects: number }) => h.objects === 1);
    await s.call("POST", "/world/environments/home/restore", { version: firstWithCrate.version });
    state = (await s.call("GET", "/world")).json;
    assert.deepEqual(state.objects.map((o: { label: string }) => o.label), ["crate"]);
    assert.equal(state.objects[0].primitive.color, "#ff8800", "the crate is back to its colour at that version");

    // Sandbox: try a change in isolation, promote only with approval.
    const sandbox = (await s.call("POST", "/world/environments", { sandboxOf: "home" })).json.environment;
    assert.equal(sandbox.sandbox, true);
    await s.call("POST", "/world/enter", { id: sandbox.id });
    await s.call("POST", "/world/objects", { shape: "cone", label: "beacon" });
    assert.deepEqual((await s.call("GET", "/world")).json.objects.map((o: { label: string }) => o.label).sort(), ["beacon", "crate"]);
    await s.call("POST", "/world/enter", { id: "home" });
    assert.equal((await s.call("GET", "/world")).json.objects.length, 1, "the sandbox did not touch home");
    const refused = await s.call("POST", `/world/environments/${sandbox.id}/promote`, {});
    assert.equal(refused.status, 409);
    assert.match(refused.json.error, /needs approval/);
    await s.call("POST", `/world/environments/${sandbox.id}/promote`, { approve: true });
    assert.deepEqual((await s.call("GET", "/world")).json.objects.map((o: { label: string }) => o.label).sort(), ["beacon", "crate"]);

    // Improvement log.
    await s.call("POST", "/world/improvements", { stage: "test", subject: "home", what: "beacon placement", why: "visibility", tests: "manual", passed: true });
    const log = (await s.call("GET", "/world/improvements")).json.improvements;
    assert.deepEqual(log.map((l: { stage: string }) => l.stage), ["integrate", "test"]);

    // Restart: a new server over the same store sees everything.
    await s.close();
    s = await serve(root);
    state = (await s.call("GET", "/world")).json;
    assert.equal(state.current, "home");
    assert.equal(state.environments.length, 3);
    assert.deepEqual(state.objects.map((o: { label: string }) => o.label).sort(), ["beacon", "crate"]);
    state = (await s.call("POST", "/world/enter", { id: "engineering-bay" })).json;
    assert.deepEqual(state.objects.map((o: { label: string }) => o.label), ["gear"]);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});
