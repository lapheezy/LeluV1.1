/**
 * ==========================================================
 * LÉLU 3D FORGE — AS LÉLU'S OWN TOOLS
 *
 * CATEGORY: integration. A model-issued tool call goes through
 * the real dispatcher, the real AutonomyGate, the real
 * ForgeClient and the real /api/forge HTTP surface, which
 * talks to a local stand-in for Meshy. What is pinned:
 *
 *   - LÉLU can plan a 3D job, and planning spends nothing
 *   - spending is a separate, risk-3 tool that the autonomy
 *     gate withholds below level 3 — and nothing reaches
 *     Meshy when it does
 *   - at level 3 the same call really submits the job
 * ==========================================================
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { KEY, startFakeMeshy } from "./support/fakeMeshy";
import { tinyPng } from "./support/glbFixture";
import { createMeshyForgeApi } from "../plugins/meshyForgeApi";
import { registerForgeTools } from "../src/core/forge/ForgeTools";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import AutonomyGate from "../src/core/cognition/AutonomyGate";

test("LÉLU plans with forge.plan; forge.approve spends only at autonomy level 3", async () => {
  const fake = await startFakeMeshy();
  const root = mkdtempSync(path.join(tmpdir(), "lelu-forge-tools-"));
  const api = createMeshyForgeApi((n) => ({ MESHY_API_KEY: KEY, MESHY_API_URL: fake.base })[n], { assetRoot: root, poll: false });
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_path, h) => { handler = h as never; } });
  const server = createServer((req, res) => handler!(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // The page calls /api/forge on its own origin; in Node that origin is the test server.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === "string" && input.startsWith("/") ? `${origin}${input}` : input, init)) as typeof fetch;
  const gate = AutonomyGate.getInstance();
  const previousLevel = gate.getLevel();

  try {
    registerForgeTools();
    assert.ok(ToolRegistry.getInstance().get("forge.approve"), "Forge tools are in LÉLU's registry");
    await fetch("/api/forge/characters/hero/references", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "front", dataUrl: `data:image/png;base64,${Buffer.from(tinyPng(8, 8)).toString("base64")}` }),
    });

    gate.setLevel(1);
    const plan = await dispatchToolCall(
      {
        id: "c1",
        name: "forge_plan",
        arguments: { character: "hero", kind: "image-to-3d", purpose: "base", body: { image_url: "ref:front", ai_model: "meshy-7.1" } },
      },
      "t-forge",
    );
    assert.equal(plan.ok, true, plan.content);
    assert.match(plan.content, /awaiting_approval/);
    assert.match(plan.content, /about 30 credits/);
    const jobId = (plan.data as { id: string }).id;

    const invalid = await dispatchToolCall(
      { id: "c2", name: "forge_plan", arguments: { character: "hero", kind: "image-to-3d", body: { image_url: "ref:front", sparkle: true } } },
      "t-forge",
    );
    assert.equal(invalid.ok, false);
    assert.match(invalid.content, /sparkle/);

    const refused = await dispatchToolCall({ id: "c3", name: "forge_approve", arguments: { jobId } }, "t-forge");
    assert.equal(refused.ok, false);
    assert.match(refused.content, /not permitted at the current autonomy level/);
    assert.equal(fake.seen.filter((s) => s.method === "POST").length, 0, "nothing reached Meshy");

    gate.setLevel(3);
    const approved = await dispatchToolCall({ id: "c4", name: "forge_approve", arguments: { jobId } }, "t-forge");
    assert.equal(approved.ok, true, approved.content);
    assert.match(approved.content, /PENDING/);
    assert.equal(fake.seen.filter((s) => s.method === "POST").length, 1);

    const job = await dispatchToolCall({ id: "c5", name: "forge_job", arguments: { jobId } }, "t-forge");
    assert.equal(job.ok, true, job.content);
    assert.match(job.content, /IN_PROGRESS at 40%/);
  } finally {
    gate.setLevel(previousLevel);
    globalThis.fetch = realFetch;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
    await fake.close();
  }
});
