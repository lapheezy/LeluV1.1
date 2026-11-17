/**
 * LÉLU ASRE — integration: coverage/next-view analysis, the server API
 * (real HTTP, real builds; no Python needed for these routes) and the
 * tool registration LÉLU's cognition reads.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SparseVoxelGrid, type Vec3 } from "../src/core/asre/nre";
import { assessCoverage } from "../src/core/asre/analysis/coverage";
import { ballCells } from "../src/core/asre/volume/shapes";
import { ASRE_EXECUTORS, ASRE_TOOLS, registerAsreTools } from "../src/core/asre/AsreTools";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { createAsreApi } from "../plugins/asreApi";

test("coverage: a single front view leaves the back synthesized, and the back is requested first", () => {
  const spec = { resolution: 0.01, origin: [0, 0, 0] as Vec3, dims: [64, 64, 64] as Vec3, coordinateSystem: "z-up-right-handed" as const };
  const g = new SparseVoxelGrid(spec);
  const ball = ballCells([32, 32, 32], 12);
  g.fuse({ id: "model", capturedAt: 0, source: "gen", modality: "generative-model", provenance: "SYNTHESIZED", confidence: 0.5, parameters: {}, fingerprint: "m", lineage: [] }, ball);
  // the camera on +X saw the front half
  g.fuse({ id: "seen", capturedAt: 0, source: "cam", modality: "silhouette", provenance: "OBSERVED", confidence: 0.9, parameters: {}, fingerprint: "s", lineage: [] }, ball.filter(([x]) => x >= 32));
  const r = assessCoverage(g, [1, 0, 0], [0, 0, 1]);
  const side = (s: string) => r.sides.find((x) => x.side === s)!;
  assert.equal(side("front").unsupported, 0);
  assert.equal(side("back").unsupported, 1);
  assert.equal(r.requests[0].view, "back");
  assert.ok(r.overallUnsupported > 0.3 && r.overallUnsupported < 0.7);
});

test("ASRE tools register in LÉLU's registry with an executor each", () => {
  registerAsreTools();
  const ids = ToolRegistry.getInstance().all().map((t) => t.id);
  for (const t of ASRE_TOOLS) {
    assert.ok(ids.includes(t.id), t.id);
    assert.ok(ASRE_EXECUTORS.some((e) => e.id === t.id), `executor for ${t.id}`);
  }
});

test("ASRE API: status, character variations with reuse, assets, and refusals", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-api-"));
  const api = createAsreApi(() => undefined, { root });
  const handlers: Array<(req: unknown, res: unknown, next: () => void) => void> = [];
  api.attach({ use: (_p, h) => handlers.push(h as never) });
  const server = createServer((req, res) => handlers[0](req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = (p: string) => `http://127.0.0.1:${(server.address() as { port: number }).port}/api/asre${p}`;
  const post = (p: string, body: unknown, headers: Record<string, string> = {}) => fetch(url(p), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    const status = await (await fetch(url("/status"))).json();
    assert.equal(status.ok, true);
    assert.match(status.spend, /zero/);

    const first = await (await post("/character", { patch: {} })).json();
    assert.equal(first.ok, true, first.error);
    assert.equal(first.meshValid, true);
    assert.equal(first.reused.length, 0);
    const second = await (await post("/character", { patch: { hair: { style: "afro" } } })).json();
    assert.deepEqual(second.regenerated, ["hair"]);
    assert.equal(second.reused.length, 14);

    const glb = await fetch(url(`/assets/${second.glb}`));
    assert.equal(glb.status, 200);
    assert.equal(glb.headers.get("content-type"), "model/gltf-binary");
    assert.equal(new DataView(await glb.arrayBuffer()).getUint32(0, true), 0x46546c67);

    assert.equal((await fetch(url("/assets/..%2F..%2Fetc%2Fpasswd"))).status, 404);
    assert.equal((await post("/reconstruct", { image: "../../etc/passwd" })).status, 400);
    assert.equal((await post("/character", {}, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(url("/jobs/nope"))).status, 404);
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
