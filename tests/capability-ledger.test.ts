/**
 * Mission 4 — the capability ledger and its server-side enforcement,
 * exercised through the real /api/resources handler with real requests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCapabilityLedger, parseCapabilityDecision } from "../plugins/capabilityLedger";
import { createResourceApi, runSandbox, setCapabilityLedgerForTests } from "../plugins/resourceApi";

type Resp = { status: number; body: any };
function api() {
  const { handle } = createResourceApi();
  return (url: string, body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    new Promise<Resp>((resolve) => {
      const chunks = method === "POST" ? [JSON.stringify(body)] : [];
      const req: any = {
        url: `/api/resources${url}`, method, headers,
        on(event: string, cb: (c?: unknown) => void) {
          if (event === "data") for (const c of chunks) cb(c);
          if (event === "end") setTimeout(() => cb(), 0);
        },
      };
      const res: any = { statusCode: 200, setHeader() {}, end(b: string) { resolve({ status: this.statusCode, body: JSON.parse(b) }); } };
      void handle(req, res, () => resolve({ status: 404, body: null }));
    });
}

const TOOL = { "x-lelu-tool-call": "1" };
const HUMAN = { "x-lelu-user-consent": "typed" };

async function verifiedSandboxId(): Promise<string> {
  const r = await runSandbox({ reuse: "three/examples/jsm/exporters/GLTFExporter.js", code: "console.log('ok')" });
  assert.equal(r.ok, true, r.stderr);
  return r.id;
}

test("the user's words parse; negations and look-alikes do not", () => {
  assert.deepEqual(parseCapabilityDecision("approve capability world-export-gltf"), { action: "approve", id: "world-export-gltf" });
  assert.deepEqual(parseCapabilityDecision("please revoke the capability `3d-export-stl` now"), { action: "revoke", id: "3d-export-stl" });
  assert.equal(parseCapabilityDecision("do not approve capability world-export-gltf"), null);
  assert.equal(parseCapabilityDecision("can you approve it?"), null);
});

test("lifecycle: invalid transitions are refused; history is appended; the file write is atomic", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  const ledger = createCapabilityLedger(dir);
  ledger.transition("cap-a", "discovered", "t", { query: "q" });
  ledger.transition("cap-a", "evaluated", "t", {});
  assert.throws(() => ledger.transition("cap-a", "registered", "t", {}), /cannot move to registered/);
  assert.throws(() => ledger.approve("cap-a", { approver: "x", basis: "y", consent: "typed" }), /not awaiting approval/);
  ledger.transition("cap-a", "sandbox-testing", "t", {});
  ledger.transition("cap-a", "sandbox-verified", "t", { apiKey: "sk-secret-000000000000000", stdout: "fine" });
  const record = ledger.get("cap-a")!;
  assert.deepEqual(record.history.map((h) => h.state), ["discovered", "evaluated", "sandbox-testing", "sandbox-verified"]);
  assert.equal(JSON.stringify(record).includes("sk-secret"), false, "evidence never carries a secret");
  assert.ok(existsSync(path.join(dir, "capabilities.json")));
  assert.equal(readFileSync(path.join(dir, "log.jsonl"), "utf8").trim().split("\n").length, 4);
});

test("approval is enforced on the server: direct API, tool calls and cross-site requests cannot approve", async () => {
  setCapabilityLedgerForTests(createCapabilityLedger(mkdtempSync(path.join(tmpdir(), "ledger-"))));
  const call = api();
  const sandboxId = await verifiedSandboxId();

  // Proposing without a passing proof is refused.
  assert.equal((await call("/capabilities/propose", { capability: "world-export-gltf", tool: "world.gltf", sandboxId: "nope" }, TOOL)).body.code, "not_verified");
  const proposed = await call("/capabilities/propose", { capability: "world-export-gltf", name: "glTF export", tool: "world.gltf", sandboxId }, TOOL);
  assert.equal(proposed.body.capability.state, "awaiting-approval");

  // Registration before approval: refused (direct API and tool alike).
  assert.equal((await call("/capabilities/register", { capability: "world-export-gltf" }, TOOL)).status, 403);
  assert.equal((await call("/capabilities/register", { capability: "world-export-gltf" })).status, 403);

  // Approval bypass attempts.
  const words = { text: "approve capability world-export-gltf" };
  assert.equal((await call("/capabilities/decision", words)).body.code, "user_words_required", "plain direct API");
  assert.equal((await call("/capabilities/decision", words, { ...HUMAN, ...TOOL })).body.code, "tool_call_cannot_decide", "tool call forging consent");
  assert.equal((await call("/capabilities/decision", words, { ...HUMAN, "sec-fetch-site": "cross-site" })).body.code, "cross_site");
  assert.equal((await call("/capabilities/decision", words, { "x-lelu-user-consent": "agent" })).body.code, "user_words_required");
  assert.equal((await call("/capabilities/decision", { text: "do not approve capability world-export-gltf" }, HUMAN)).body.code, "no_decision");

  // The human pathway.
  const approved = await call("/capabilities/decision", words, HUMAN);
  assert.equal(approved.body.capability.state, "approved");
  assert.equal(approved.body.capability.approval.consent, "typed");
  const registered = await call("/capabilities/register", { capability: "world-export-gltf" }, TOOL);
  assert.equal(registered.body.capability.state, "registered");

  // No duplicates: proposing or registering again changes nothing.
  assert.equal((await call("/capabilities/propose", { capability: "world-export-gltf", tool: "world.gltf", sandboxId }, TOOL)).body.duplicate, true);
  assert.equal((await call("/capabilities/register", { capability: "world-export-gltf" }, TOOL)).body.duplicate, true);
  const list = (await call("/capabilities", null, {}, "GET")).body.capabilities;
  assert.equal(list.filter((r: any) => r.id === "world-export-gltf").length, 1);
  assert.equal(list[0].active, true);

  // Runtime verification, then revocation (human only) ends it.
  assert.equal((await call("/capabilities/runtime-verified", { capability: "world-export-gltf", tool: "world.gltf" }, TOOL)).body.capability.state, "runtime-verified");
  assert.equal((await call("/capabilities/decision", { text: "revoke capability world-export-gltf" }, TOOL)).status, 403);
  const revoked = await call("/capabilities/decision", { text: "revoke capability world-export-gltf" }, HUMAN);
  assert.equal(revoked.body.capability.state, "revoked");
  assert.equal((await call("/capabilities", null, {}, "GET")).body.capabilities[0].active, false);
  assert.equal((await call("/capabilities/runtime-verified", { capability: "world-export-gltf" }, TOOL)).status, 409);
  setCapabilityLedgerForTests(null);
});

test("recovery: an approval whose registration was interrupted is completed later, once", async () => {
  setCapabilityLedgerForTests(createCapabilityLedger(mkdtempSync(path.join(tmpdir(), "ledger-"))));
  const call = api();
  const sandboxId = await verifiedSandboxId();
  await call("/capabilities/propose", { capability: "cap-r", tool: "world.gltf", sandboxId }, TOOL);
  await call("/capabilities/decision", { text: "approve capability cap-r" }, HUMAN);
  // (the registering client stopped here)
  const later = await call("/capabilities", null, {}, "GET");
  assert.equal(later.body.capabilities[0].state, "approved");
  assert.equal((await call("/capabilities/register", { capability: "cap-r" })).body.capability.state, "registered");
  assert.equal((await call("/capabilities/register", { capability: "cap-r" })).body.duplicate, true);
  setCapabilityLedgerForTests(null);
});

test("stale evidence is detected: a record whose sandbox proof is gone is flagged and cannot register", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ledger-"));
  const ledger = createCapabilityLedger(dir);
  setCapabilityLedgerForTests(ledger);
  const call = api();
  ledger.transition("cap-s", "sandbox-verified", "t", {}, { tools: ["world.gltf"], sandboxId: "gone-000" });
  ledger.transition("cap-s", "awaiting-approval", "t", {});
  await call("/capabilities/decision", { text: "approve capability cap-s" }, HUMAN);
  const listed = (await call("/capabilities", null, {}, "GET")).body.capabilities[0];
  assert.match(listed.stale.join(" "), /sandbox evidence is missing/);
  assert.equal((await call("/capabilities/register", { capability: "cap-s" })).body.code, "stale");
  setCapabilityLedgerForTests(null);
});
