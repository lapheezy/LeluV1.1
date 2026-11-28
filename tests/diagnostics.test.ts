import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, summarize, suiteFor, chatSummary, setDiagnosticsStorage, runDiagnostics, registerSuite, runs, type DiagnosticCheck } from "../src/core/diagnostics/Diagnostics";
import { registerDiagnosticSuites } from "../src/core/diagnostics/suites";

const c = (status: DiagnosticCheck["status"]): DiagnosticCheck => ({ id: status, category: "g", title: status, status, evidence: "", ms: 0 });

test("a group is VERIFIED only when every check passed", () => {
  assert.equal(verdict([c("PASS"), c("PASS")]), "VERIFIED");
  assert.equal(verdict([c("PASS"), c("NOT_RUN")]), "PARTIAL");
  assert.equal(verdict([c("PASS"), c("FAIL")]), "FAIL");
  assert.equal(verdict([c("BLOCKED"), c("NOT_RUN")]), "BLOCKED");
  assert.equal(verdict([]), "NOT_RUN");
});

test("skipped and blocked checks are never counted as passes", () => {
  const s = summarize({ checks: [c("PASS"), c("BLOCKED"), c("NOT_RUN"), c("PARTIAL")] });
  assert.deepEqual(s, { PASS: 1, FAIL: 0, PARTIAL: 1, BLOCKED: 1, NOT_RUN: 1 });
});

test("natural-language requests select the right suite", () => {
  registerDiagnosticSuites();
  assert.equal(suiteFor("Validate Freestyle, including chat")?.id, "freestyle-chat");
  assert.equal(suiteFor("Test every borderless output")?.id, "freestyle-chat");
  assert.equal(suiteFor("Check chat, Neural Map, and browser integration")?.id, "integration");
  assert.equal(suiteFor("Run a full Cosmos diagnostic")?.id, "full");
});

test("a run is stored per conversation, and outside a page the Freestyle suite is BLOCKED, not passed", async () => {
  const mem = new Map<string, string>();
  setDiagnosticsStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) } as Storage);
  registerSuite({ id: "t-one", title: "t", match: /^t-one$/, run: async (ctx) => ctx.push({ ...c("PASS"), id: "x" }) });
  const r = await runDiagnostics("t-one", "conv-1");
  assert.equal(r.status, "done");
  assert.equal(runs("conv-1")[0].id, r.id);
  assert.match(chatSummary(r), /1 pass, 0 fail/);
  const f = await runDiagnostics("freestyle-chat", "conv-1");
  assert.ok(f.checks.length > 0);
  assert.ok(f.checks.every((x) => x.status !== "PASS" || x.category === "f-device"), "no Freestyle check passes without a page");
  assert.ok(f.checks.some((x) => x.status === "BLOCKED"));
});
