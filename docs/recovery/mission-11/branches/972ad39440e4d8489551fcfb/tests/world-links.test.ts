/**
 * LÉLUVERSE — LINKING AND QUERYING HER WORLD THROUGH HER OWN TOOLS
 *
 * The same ToolRegistry → ToolDispatcher → AutonomyGate path as every other
 * capability, against the real HTTP surface of the Forge/world engine:
 * she links two objects, asks what is connected and gets the neighbour back,
 * removes the link and it is gone, and links two worlds so a resource can move
 * between them.
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

test("she links objects and worlds, queries the neighbours, and can undo a link", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-world-links-"));
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
  const call = (name: string, args: Record<string, unknown>) => dispatchToolCall({ id: `l${++n}`, name, arguments: args }, "t-world-links");

  try {
    registerWorldTools();
    const offered = toolSchemasForModel().map((s) => JSON.stringify(s));
    for (const id of ["world_link", "world_query"]) assert.ok(offered.some((s) => s.includes(id)), `${id} is offered to the model`);
    gate.setLevel(3);

    let r = await call("world_environment", { action: "create", name: "Atelier", kind: "studio" });
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /\(atelier\)/);

    r = await call("world_object", { action: "create", shape: "box", label: "Copper torso", position: [0, -2.55, 0], height: 1.2 });
    const torso = (r.data as { id: string }).id;
    r = await call("world_object", { action: "create", shape: "box", label: "Left shoulder", position: [4, -2.55, 0], height: 0.6 });
    const shoulder = (r.data as { id: string }).id;

    // Nothing is linked yet, and she says so instead of inventing a relationship.
    r = await call("world_query", { entity: torso, world: "atelier", kinds: ["connected-to"], depth: 1 });
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /Nothing is connected to/);

    r = await call("world_link", { action: "connect", fromWorld: "atelier", fromEntity: torso, toWorld: "atelier", toEntity: shoulder, kind: "connected-to", note: "shoulder mounts on the torso" });
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /connected-to/);
    const linkId = /\((lnk_[a-z0-9_]+)\)/.exec(r.content)![1];

    r = await call("world_query", { entity: torso, world: "atelier", depth: 1 });
    const found = r.data as { hits: Array<{ entity: { id: string }; relation: string | null }>; matchedEntityIds: string[] };
    assert.ok(found.hits.some((h) => h.entity.id === shoulder), "the shoulder is reachable from the torso");
    assert.equal(found.hits.find((h) => h.entity.id === shoulder)!.relation, "connected-to");
    assert.match(r.content, /Left shoulder/);
    assert.match(r.content, /Highlighted \d+ object/);

    r = await call("world_link", { action: "list", world: "atelier" });
    assert.match(r.content, /connected-to/);
    assert.match(r.content, /shoulder mounts on the torso/);

    // The graph refuses a link that points at nothing.
    r = await call("world_link", { action: "connect", fromWorld: "atelier", fromEntity: torso, toWorld: "atelier", toEntity: "ghost", kind: "controls" });
    assert.equal(r.ok, false, "a dangling link is refused");

    r = await call("world_link", { action: "remove", id: linkId });
    assert.equal(r.ok, true, r.content);
    r = await call("world_query", { entity: torso, world: "atelier", depth: 1 });
    assert.doesNotMatch(r.content, /Left shoulder/, "the removed link no longer connects them");

    // Worlds can be linked to each other, which is how a resource travels.
    r = await call("world_environment", { action: "create", name: "Laboratory", kind: "lab" });
    assert.match(r.content, /\(laboratory\)/);
    r = await call("world_link", { action: "connect", fromWorld: "atelier", fromEntity: "*", toWorld: "laboratory", toEntity: "*", kind: "linked-to", note: "simulation requests" });
    assert.equal(r.ok, true, r.content);
    assert.match(r.content, /across worlds/);

    r = await call("world_query", { world: "atelier", entity: "*", kinds: ["linked-to"], depth: 1 });
    assert.match(r.content, /laboratory/, "Atelier reports its link to Laboratory");
    const cross = (r.data as { hits: Array<{ entity: { worldId: string } }> }).hits;
    assert.ok(cross.some((h) => h.entity.worldId === "laboratory"));
  } finally {
    gate.setLevel(previous);
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
