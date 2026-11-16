/**
 * LÉLUVERSE — LÉLU USES HER WORLD THROUGH HER OWN TOOLS
 *
 * The world tools go through the same ToolRegistry, schema list, dispatcher
 * and AutonomyGate as every other tool, against the real HTTP surface:
 * the model is offered them, she can create an environment, make and change
 * objects, switch on physics, restore a version — and replacing a working
 * environment with a sandbox is withheld below autonomy level 3.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createMeshyForgeApi } from "../plugins/meshyForgeApi";
import { registerWorldTools } from "../src/core/world/WorldTools";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import AutonomyGate from "../src/core/cognition/AutonomyGate";

test("LÉLU builds and changes her world with world.* tools; promotion waits for level 3", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-world-tools-"));
  const api = createMeshyForgeApi(() => undefined, { assetRoot: root, poll: false });
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_p, h) => { handler = h as never; } });
  const server = createServer((req, res) => handler!(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? `${origin}${input}` : input, init)) as typeof fetch;
  const gate = AutonomyGate.getInstance();
  const previous = gate.getLevel();
  let n = 0;
  const call = (name: string, args: Record<string, unknown>) => dispatchToolCall({ id: `w${++n}`, name, arguments: args }, "t-world");

  try {
    registerWorldTools();
    const offered = toolSchemasForModel().map((s) => JSON.stringify(s));
    for (const id of ["world_state", "world_environment", "world_object", "world_versions", "world_improve"]) {
      assert.ok(offered.some((s) => s.includes(id)), `${id} is offered to the model`);
    }

    gate.setLevel(1);
    let r = await call("world_state", {});
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /LÉLU is in "LÉLU's room" \(room/);

    r = await call("world_object", { action: "create", shape: "sphere", label: "globe", color: "#38bdf8", height: 0.8 });
    assert.equal(r.ok, true, r.content);
    const globe = (r.data as { id: string }).id;
    r = await call("world_object", { action: "modify", id: globe, color: "#22c55e", metalness: 0.7 });
    assert.match(r.content, /#22c55e sphere/);
    r = await call("world_object", { action: "move", id: globe, position: [1, -2.55, 3], rotationY: 0.4, height: 1.2 });
    assert.match(r.content, /1\.20 tall at \[1\.00, -2\.55, 3\.00\]/);
    r = await call("world_object", { action: "simulate", id: globe, physics: true, push: [2, 4, 0], restitution: 0.8 });
    assert.match(r.content, /Physics on for globe/);

    r = await call("world_environment", { action: "create", name: "Fashion studio", kind: "studio", settings: { accent: "#fb923c" } });
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /Created and entered "Fashion studio" \(fashion-studio\)/);
    r = await call("world_object", { action: "create", shape: "cylinder", label: "mannequin stand" });
    r = await call("world_environment", { action: "enter", id: "home" });
    assert.match(r.content, /globe/);
    assert.doesNotMatch(r.content, /mannequin/);

    r = await call("world_versions", {});
    assert.match(r.content, /v1 .*v2/);
    r = await call("world_versions", { restore: 1 });
    assert.equal(r.ok, true, r.content);
    assert.match((await call("world_state", {})).content, /0 object\(s\)/, "version 1 had no objects");

    r = await call("world_environment", { action: "sandbox", id: "home" });
    const sandboxId = /\(([a-z0-9-]+)\)/.exec(r.content)![1];
    r = await call("world_promote", { id: sandboxId });
    assert.equal(r.ok, false);
    assert.match(r.content, /not permitted at the current autonomy level/);
    gate.setLevel(3);
    r = await call("world_promote", { id: sandboxId });
    assert.equal(r.ok, true, r.content);

    r = await call("world_improve", { stage: "evaluate", subject: "fashion-studio", what: "lighting", why: "fabric colours read true", tests: "visual", passed: true });
    assert.equal(r.ok, true, r.content);
  } finally {
    gate.setLevel(previous);
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
