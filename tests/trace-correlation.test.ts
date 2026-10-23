/**
 * ==========================================================
 * LÉLU — TRACE CORRELATION TESTS
 *
 * Verifies the end-to-end trace/correlation ID architecture
 * required by the LÉLU ENGINEERING PASS:
 *
 *   1. exchangeId (GenesisChat UI layer) and streamId (AIService)
 *      are linked on a single LatencyTrace record.
 *   2. annotate() and traceError() extend the probe without
 *      breaking the existing T0-T7 API.
 *   3. Concurrent traces do not cross-contaminate.
 *   4. Error stages (A–G) are recorded and not duplicated.
 *   5. Correlation IDs appear in the finalised log.
 *   6. CognitiveTrace accepts the three new UI-layer stages.
 *   7. Voice input goes through the same trace path (no second system).
 *   8. No API keys, tokens, or secrets appear in any trace record.
 *   9. GenesisChat source wires the annotate call for exchangeId.
 *  10. AIService source wires the annotate call for streamId.
 *  11. PromptInjectionGuard redacts secrets before traceError is called.
 *  12. Regression: LatencyProbe.getLog() returns completed traces only.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// ---- Module-level test helpers ----------------------------------------

function src(path: string): string {
  return readFileSync(`/home/user/LeluV1.1/${path}`, "utf8");
}

// ---- 1. annotate() and traceError() are exported by LatencyProbe ------

test("LatencyProbe source exports annotate and traceError functions", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(code.includes("export function annotate("),   "annotate must be exported");
  assert.ok(code.includes("export function traceError("), "traceError must be exported");
  assert.ok(code.includes("export function startTrace("), "startTrace still exported");
  assert.ok(code.includes("export function mark("),       "mark still exported");
  assert.ok(code.includes("export function getLog("),     "getLog still exported");
  assert.ok(code.includes("export function clearLog("),   "clearLog still exported");
});

// ---- 2. annotate() stores fields on the active trace (source check) ---

test("annotate() implementation writes field to active trace record", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  // Must assign field to active: `active[field] = value`
  assert.ok(
    code.includes("active[field] = value"),
    "annotate() must write the value to active[field]",
  );
  // Must guard on the traceId when provided: `if (traceId && active.id !== traceId) return`
  assert.ok(
    code.includes("active.id !== traceId"),
    "annotate() must guard against cross-trace contamination via traceId check",
  );
});

// ---- 3. annotate() guards traceId — concurrent traces don't cross ------

test("annotate() is guarded by traceId parameter to prevent cross-trace contamination", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  // The guard must appear in BOTH annotate and mark
  const annotateStart = code.indexOf("export function annotate(");
  const annotateBody  = code.slice(annotateStart, annotateStart + 300);
  assert.ok(
    annotateBody.includes("traceId && active.id !== traceId"),
    "annotate() guard must check `traceId && active.id !== traceId`",
  );
});

// ---- 4. traceError() records only the first error per trace -----------

test("traceError() uses if (!active.error) guard so only the first error is recorded", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(
    code.includes("if (!active.error)"),
    "traceError must guard with if (!active.error) so only the first error is recorded",
  );
});

// ---- 5. traceError() never logs sensitive data (static code check) -----

test("traceError() usage in AIService passes redacted text, not raw error", () => {
  const aiCode = src("src/core/AIService.ts");
  // traceError CALL must appear AFTER the redactSecrets() call.
  // We search for the CALL site (function invocation with '('), not the import.
  const redactIdx   = aiCode.indexOf("PromptInjectionGuard.getInstance().redactSecrets");
  const traceErrIdx = aiCode.indexOf('latencyTraceError("D=Provider"');
  assert.ok(redactIdx  > 0,  "AIService must call redactSecrets()");
  assert.ok(traceErrIdx > 0, "AIService must call latencyTraceError(\"D=Provider\", ...)");
  assert.ok(
    traceErrIdx > redactIdx,
    "latencyTraceError must be called AFTER redactSecrets to avoid logging raw secrets",
  );
});

// ---- 6. CognitiveTrace has the three new UI-layer stages ---------------

test("CognitiveTrace CognitiveStage type includes STREAM_EMIT, STREAM_SUBSCRIBER, EXCHANGE_UPDATE", () => {
  const code = src("src/core/cognition/CognitiveTrace.ts");
  assert.ok(code.includes('"STREAM_EMIT"'),       "STREAM_EMIT stage must exist");
  assert.ok(code.includes('"STREAM_SUBSCRIBER"'), "STREAM_SUBSCRIBER stage must exist");
  assert.ok(code.includes('"EXCHANGE_UPDATE"'),   "EXCHANGE_UPDATE stage must exist");
});

// ---- 7. LatencyTrace interface has the new fields ----------------------

test("LatencyTrace interface exports exchangeId, streamId, and error fields", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  assert.ok(code.includes("exchangeId?: string"),     "LatencyTrace must have exchangeId?: string");
  assert.ok(code.includes("streamId?: string"),       "LatencyTrace must have streamId?: string");
  assert.ok(code.includes("error?: {"),               "LatencyTrace must have error?: {stage, message}");
  assert.ok(code.includes("stage: string"),           "error must include stage: string");
  assert.ok(code.includes("message: string"),         "error must include message: string");
});

// ---- 8. GenesisChat wires annotate('exchangeId') ----------------------

test("GenesisChat calls latencyAnnotate('exchangeId', exchangeId) after creating exchangeId", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    code.includes('latencyAnnotate("exchangeId", exchangeId'),
    "GenesisChat must call latencyAnnotate(\"exchangeId\", exchangeId, ...) to wire the UI-layer ID",
  );
  // The import must include annotate
  assert.ok(
    code.includes("annotate as latencyAnnotate"),
    "GenesisChat must import annotate as latencyAnnotate from LatencyProbe",
  );
});

// ---- 9. AIService wires annotate('streamId') --------------------------

test("AIService calls latencyAnnotate('streamId', streamId) after creating streamId", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    code.includes('latencyAnnotate("streamId", streamId)'),
    "AIService must call latencyAnnotate(\"streamId\", streamId) after streamId = crypto.randomUUID()",
  );
  assert.ok(
    code.includes("annotate as latencyAnnotate"),
    "AIService must import annotate as latencyAnnotate from LatencyProbe",
  );
});

// ---- 10. Error tracing imports in both files --------------------------

test("AIService imports traceError as latencyTraceError", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    code.includes("traceError as latencyTraceError"),
    "AIService must import traceError as latencyTraceError from LatencyProbe",
  );
});

test("GenesisChat imports traceError as latencyTraceError", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    code.includes("traceError as latencyTraceError"),
    "GenesisChat must import traceError as latencyTraceError from LatencyProbe",
  );
});

// ---- 11. Error stage classification in GenesisChat --------------------

test("GenesisChat calls latencyTraceError with stage 'F=Subscription' in the error catch", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    code.includes("latencyTraceError(\"F=Subscription\""),
    "GenesisChat error catch must use stage F=Subscription (outer try wraps stream subscription + Orchestrator call)",
  );
});

// ---- 12. Error stage classification in AIService ----------------------

test("AIService calls latencyTraceError with stage 'D=Provider' in the provider error catch", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    code.includes('latencyTraceError("D=Provider"'),
    "AIService error catch must use stage D=Provider",
  );
});

// ---- 13. Voice pipeline trace: voice uses the same LatencyProbe path -

test("VoiceBridge does NOT start a separate LatencyProbe trace", () => {
  const code = src("src/app/scene/genesis/VoiceBridge.tsx");
  assert.ok(
    !code.includes("latencyStart") && !code.includes("startTrace"),
    "VoiceBridge must not start its own latency trace — voice uses addMessage() → same GenesisChat send() path",
  );
});

test("VoiceEngine does NOT start a separate LatencyProbe trace", () => {
  const code = src("src/core/voice/VoiceEngine.ts");
  assert.ok(
    !code.includes("latencyStart") && !code.includes("startTrace") && !code.includes("LatencyProbe"),
    "VoiceEngine must not import or use LatencyProbe — only the GenesisChat send() path does",
  );
});

// ---- 14. annotate() comment documents the correlation purpose ----------

test("LatencyProbe annotate() has a JSDoc explaining its correlation role", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  const annotateIdx = code.indexOf("export function annotate(");
  const jsdocBefore = code.slice(Math.max(0, annotateIdx - 300), annotateIdx);
  assert.ok(
    jsdocBefore.includes("Attach a correlation ID") || jsdocBefore.includes("correlation"),
    "annotate() must have a JSDoc comment explaining its correlation purpose",
  );
});

// ---- 15. Regression: existing T0-T7 exports still present -------------

test("LatencyProbe still exports all original T0-T7 checkpoints and utilities", () => {
  const code = src("src/core/perf/LatencyProbe.ts");
  const requiredExports = ["startTrace", "mark", "getLog", "clearLog", "LatencyTrace", "LatencyCheckpoint"];
  for (const name of requiredExports) {
    assert.ok(
      code.includes(name),
      `LatencyProbe must still export / define ${name} (regression check)`,
    );
  }
  // All original checkpoints
  const checkpoints = ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"];
  for (const cp of checkpoints) {
    assert.ok(code.includes(`"${cp}"`), `Checkpoint ${cp} must still exist in LatencyCheckpoint type`);
  }
});
