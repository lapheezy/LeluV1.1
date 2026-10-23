/**
 * ==========================================================
 * LÉLU — LATENCY PROBE TESTS
 *
 * Verifies that:
 * 1. The LatencyProbe module exists and exports the correct API
 * 2. T0-T7 checkpoints are wired into AIService and GenesisChat
 * 3. The probe is gated behind __leluProfiling (no production overhead)
 * 4. Documents which stages are ENVIRONMENT-BOUND for live measurement
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = (path: string) =>
  readFileSync(`/home/user/LeluV1.1/${path}`, "utf8");

// ---- Module structure -----------------------------------------------

test("LatencyProbe module exports startTrace, mark, getLog, clearLog", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(code.includes("export function startTrace"), "startTrace must be exported");
  assert.ok(code.includes("export function mark"), "mark must be exported");
  assert.ok(code.includes("export function getLog"), "getLog must be exported");
  assert.ok(code.includes("export function clearLog"), "clearLog must be exported");
});

test("LatencyProbe is gated behind __leluProfiling localStorage flag", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(
    code.includes("__leluProfiling"),
    "probe must check __leluProfiling before recording",
  );
  // Must not run unconditionally
  assert.ok(
    code.includes("isEnabled()"),
    "mark() and startTrace() must call isEnabled() guard",
  );
});

test("LatencyProbe uses performance.now() for sub-millisecond precision", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(code.includes("performance.now()"), "must use performance.now() not Date.now()");
});

// ---- Wiring in AIService -------------------------------------------

test("AIService imports LatencyProbe.mark", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    code.includes("from \"./perf/LatencyProbe\""),
    "AIService must import from LatencyProbe",
  );
});

test("AIService marks T1 at the start of chat()", () => {
  const code = src("src/core/AIService.ts");
  // T1 must appear before the first major async await in chat()
  const t1Idx = code.indexOf('latencyMark("T1")');
  assert.ok(t1Idx > 0, "T1 mark must exist in AIService");
  // T2 must appear after T1
  const t2Idx = code.indexOf('latencyMark("T2")', t1Idx + 1);
  assert.ok(t2Idx > t1Idx, "T2 mark must follow T1 in AIService");
});

test("AIService marks T2 before runtime.process()", () => {
  const code = src("src/core/AIService.ts");
  const t2Idx = code.indexOf('latencyMark("T2")');
  assert.ok(t2Idx > 0, "T2 mark must exist in AIService");
  const processIdx = code.indexOf("this.runtime.process(enriched", t2Idx);
  assert.ok(processIdx > t2Idx, "runtime.process() must follow T2 mark");
});

test("AIService marks T3 on first onDelta (first SSE chunk)", () => {
  const code = src("src/core/AIService.ts");
  const t3Idx = code.indexOf('latencyMark("T3")');
  assert.ok(t3Idx > 0, "T3 mark must exist inside onDelta closure in AIService");
  // T3 should be inside onDelta — verify by checking firstDelta guard nearby
  const firstDeltaIdx = code.indexOf("firstDelta = true", t3Idx - 300);
  assert.ok(firstDeltaIdx > 0 && firstDeltaIdx < t3Idx, "T3 must be inside a firstDelta guard");
});

test("AIService marks T4 immediately after T3 (same tick, stream parser = same as SSE)", () => {
  const code = src("src/core/AIService.ts");
  const t3Idx = code.indexOf('latencyMark("T3")');
  const t4Idx = code.indexOf('latencyMark("T4")', t3Idx);
  assert.ok(t4Idx > t3Idx && t4Idx - t3Idx < 100, "T4 must follow T3 within a few chars");
});

test("AIService marks T5 at the start of emitStream()", () => {
  const code = src("src/core/AIService.ts");
  const emitIdx = code.indexOf("private emitStream(");
  assert.ok(emitIdx > 0, "emitStream must exist");
  const t5Idx = code.indexOf('latencyMark("T5")', emitIdx);
  assert.ok(t5Idx > emitIdx, "T5 mark must be inside emitStream");
  // T5 must come before the first listener loop
  const listenerIdx = code.indexOf("for (const listener of this.streamListeners)", emitIdx);
  assert.ok(listenerIdx > t5Idx, "T5 must precede the listener loop in emitStream");
});

// ---- Wiring in GenesisChat -----------------------------------------

test("GenesisChat imports LatencyProbe startTrace and mark", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    code.includes("from \"../../../core/perf/LatencyProbe\""),
    "GenesisChat must import from LatencyProbe",
  );
  assert.ok(code.includes("latencyStart"), "GenesisChat must use latencyStart (T0)");
});

test("GenesisChat calls startTrace() (T0) at the start of send()", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  const sendIdx = code.indexOf("const send = useCallback(async (): Promise<void> =>");
  assert.ok(sendIdx > 0, "send callback must exist");
  const t0Idx = code.indexOf("latencyStart()", sendIdx);
  assert.ok(t0Idx > sendIdx, "T0 latencyStart() must be inside the send callback");
  // T0 must appear before setSendingIn (which is much later)
  const setSendingIdx = code.indexOf("setSendingIn((current) =>", sendIdx);
  assert.ok(t0Idx < setSendingIdx, "T0 must come before setSendingIn in send()");
});

test("GenesisChat marks T6 in the stream subscriber (before setExchange)", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  const t6Idx = code.indexOf('latencyMark("T6")');
  assert.ok(t6Idx > 0, "T6 mark must exist in GenesisChat");
  const setExchangeAfter = code.indexOf("setExchange((current) =>", t6Idx);
  assert.ok(setExchangeAfter > t6Idx, "T6 must precede setExchange call");
});

// ---- Environment-bound documentation --------------------------------

test("LatencyProbe documents that T8-T11 require real browser DevTools", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(
    code.includes("T8") && code.includes("ENVIRONMENT-BOUND"),
    "LatencyProbe must document that T8-T11 are environment-bound",
  );
});
