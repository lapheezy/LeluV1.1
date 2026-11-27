/**
 * WP19 — the conversation registry, resource policy, plain-word controls and
 * multi-resolution analytics, without a network: real modules, in-memory
 * storage, a controllable clock. The live, model-backed acceptance run is
 * scripts/usage/verify-usage.mjs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import ConversationRegistry from "../src/core/observability/ConversationRegistry";
import ResourcePolicy, { ResourceRefusal } from "../src/core/observability/ResourcePolicy";
import UsageLedger, { type UsageEvent } from "../src/core/observability/UsageLedger";
import { rangeOf, series } from "../src/core/observability/UsageAnalytics";

function kv() {
  const m = new Map<string, unknown>();
  return { get: <T,>(k: string) => (m.has(k) ? (JSON.parse(JSON.stringify(m.get(k))) as T) : null), set: <T,>(k: string, v: T) => (m.set(k, JSON.parse(JSON.stringify(v))), true), m };
}
const usage = (over: Partial<UsageEvent>): UsageEvent => ({
  id: Math.random().toString(36), userId: null, at: 1_800_000_000_000, kind: "ai", source: "Groq", ok: true, latencyMs: 100,
  inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null, costUsd: null, costKind: "unknown", ...over,
});

test("every call is registered: by conversation, as background, or as unattributed — never dropped", () => {
  const r = new ConversationRegistry(kv(), () => 1_800_000_000_000);
  r.open({ id: "chat-1", type: "user-chat", initiator: "user" });
  r.recordUsage(usage({ conversationId: "chat-1", inputTokens: 10, outputTokens: 5, model: "m" }));
  r.recordUsage(usage({ operation: "self-study" }));
  r.recordUsage(usage({ operation: "generate" }));
  assert.equal(r.get("chat-1")!.modelCalls, 1);
  assert.equal(r.get("chat-1")!.inputTokens, 10);
  assert.equal(r.list({ type: ["background"] })[0].modelCalls, 1);
  assert.equal(r.list({ type: ["unattributed"] })[0].modelCalls, 1);
});

test("tokens are counted only from calls whose provider reported them", () => {
  const r = new ConversationRegistry(kv(), () => 0);
  r.open({ id: "c", type: "user-chat", initiator: "user" });
  r.recordUsage(usage({ conversationId: "c" }));
  r.recordUsage(usage({ conversationId: "c", inputTokens: 7, outputTokens: 3 }));
  const c = r.get("c")!;
  assert.equal(c.modelCalls, 2);
  assert.equal(c.tokenReportedCalls, 1);
  assert.equal(c.inputTokens + c.outputTokens, 10);
});

test("chains trace a user request through agents and dialogues; tool work follows its task", () => {
  const r = new ConversationRegistry(kv(), () => 0);
  r.open({ id: "chat", type: "user-chat", initiator: "user" });
  r.open({ id: "agent-task:1", type: "agent-task", initiator: "lelu", parentId: "chat" });
  r.open({ id: "dialogue:x", type: "agent-direct", initiator: "agent", parentId: "agent-task:1" });
  assert.deepEqual(r.chain("dialogue:x").map((c) => c.id), ["chat", "agent-task:1", "dialogue:x"]);
  r.bindTask("123", "agent-task:1");
  r.recordBusEvent({ type: "tool_started", taskId: "123", tool: "research.web" });
  assert.deepEqual(r.get("agent-task:1")!.tools, { "research.web": 1 });
});

test("a conversation active when the app stopped is restored as interrupted, not as running", () => {
  const store = kv();
  const a = new ConversationRegistry(store, () => 0);
  a.open({ id: "c", type: "voice", initiator: "user" });
  a.save();
  const b = new ConversationRegistry(store, () => 1000);
  assert.equal(b.get("c")!.status, "failed");
  assert.equal(b.get("c")!.interruptions, 1);
});

test("the policy refuses calls for the reasons the owner set, and records why", () => {
  let t = 0;
  const p = new ResourcePolicy(kv(), () => t);
  p.control("c", "throttled", { minGapMs: 10_000 });
  p.checkCall({ conversationId: "c", inFlight: [] });
  p.noteCall({ conversationId: "c" });
  t = 5000;
  assert.throws(() => p.checkCall({ conversationId: "c", inFlight: [] }), (e: unknown) => e instanceof ResourceRefusal && e.rule === "throttled");
  assert.equal(p.refusalSince(0, ["c"])?.rule, "throttled");
  t = 11_000;
  p.checkCall({ conversationId: "c", inFlight: [] });
  p.setLimit("maxConcurrentCalls", 1);
  assert.throws(() => p.checkCall({ conversationId: "d", inFlight: [{ conversationId: "c" }] }), /limit is 1/);
  p.emergencyStop(true);
  assert.throws(() => p.checkCall({ inFlight: [] }), /Emergency stop/);
  p.emergencyStop(false);
  p.setLimit("maxTasksPerAgent", 2);
  assert.throws(() => p.checkAgentTask("a1", { total: 2, forAgent: 2 }), /limit is 2/);
  assert.equal(p.setLimit("maxConcurrentCalls", 10_000), 64, "clamped to what the runtime allows");
  assert.ok(p.get().changes.length >= 5, "every change is logged");
});

test("hourly caps continue after a restart from the ledger's hour rollup", () => {
  const p = new ResourcePolicy(kv(), () => Date.parse("2026-11-27T10:30:00Z"));
  p.seedHour = () => ({ calls: 9, tokens: 0, byConversation: {}, byAgent: {} });
  p.setLimit("hourlyCalls", 10);
  p.checkCall({ inFlight: [] });
  p.noteCall({});
  assert.throws(() => p.checkCall({ inFlight: [] }), /hourly limit of 10/);
});

test("minute/hour/day series and ranges are computed from real buckets", () => {
  let t = Date.parse("2026-11-27T10:00:10Z");
  const ledger = new UsageLedger(() => t, null);
  for (const [minute, calls] of [[0, 2], [1, 5], [2, 1]] as const) {
    t = Date.parse(`2026-11-27T10:0${minute}:10Z`);
    for (let i = 0; i < calls; i++) ledger.record({ kind: "ai", source: "Groq", ok: true, latencyMs: 50 + i, usage: { prompt_tokens: 3, completion_tokens: 1 } });
  }
  const minutes = series("minute", {}, ledger);
  assert.deepEqual(minutes.map((p) => p.calls), [2, 5, 1]);
  const r = rangeOf(minutes, "calls", (p) => p.calls, 10);
  assert.deepEqual([r.lowest, r.lowestAt, r.highest, r.highestAt, r.current, r.average], [1, "2026-11-27T10:02", 5, "2026-11-27T10:01", 1, 2.67]);
  assert.equal(r.pctUsed, 10);
  assert.equal(series("hour", {}, ledger)[0].calls, 8);
  assert.equal(series("day", {}, ledger)[0].inputTokens, 24);
  // A bucket with no reported tokens reads as unavailable, not zero.
  ledger.record({ kind: "ai", source: "X", ok: true });
  t = Date.parse("2026-11-27T11:00:10Z");
  ledger.record({ kind: "ai", source: "X", ok: true });
  assert.equal(series("hour", {}, ledger).at(-1)!.inputTokens, null);
});
