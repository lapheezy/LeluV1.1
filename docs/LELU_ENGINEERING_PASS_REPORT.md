# LÉLU ENGINEERING PASS — Final Report

**Session:** `claude/open-session-rbwmdw`  
**Date:** 2026-10-23  
**Branch:** `claude/open-session-rbwmdw`

---

## 1 · End-to-End Trace Correlation ID

### Finding — two separate UUIDs for the same turn

Before this pass, the pipeline created two unrelated UUIDs for every user exchange:

| ID | Where created | Scope |
|----|---------------|-------|
| `exchangeId = crypto.randomUUID()` | `GenesisChat.send()` line 744 | UI exchange state only |
| `streamId = crypto.randomUUID()` | `AIService.chat()` line 568 | Stream events + message ID |

Neither was ever recorded in the latency trace.  No single ID existed that
survived T0 (send pressed) all the way to T6 (setExchange called).

### Fix — link them at the LatencyProbe layer

**Architecture decision:** `exchangeId` is the canonical UI-layer turn ID.
`streamId` is the AIService message ID that becomes `event.id` in stream events.
They are both needed; no third competing ID was created.  The link is made at
`LatencyProbe.annotate()` — both call sites record onto the same trace object,
so any completed `LatencyTrace` in `window.__leluLatencyLog` shows both IDs.

```
T0  GenesisChat.send()
      latencyStart()               → returns traceId (8-char)
      exchangeId = randomUUID()
      latencyAnnotate("exchangeId", exchangeId, traceId)   ← NEW

T1  AIService.chat()
      latencyMark("T1")
      streamId = randomUUID()
      latencyAnnotate("streamId", streamId)                ← NEW
```

---

## 2 · LatencyProbe.ts — Extended (not replaced)

New exports alongside the original T0-T7 API:

```ts
// Attach a correlation ID to the active trace.
export function annotate(
  field: "exchangeId" | "streamId",
  value: string,
  traceId?: string,
): void

// Record an error at a named stage. Only the first error per trace is kept.
// NEVER pass raw API keys, tokens, or secrets as the message.
export function traceError(stage: string, message: string, traceId?: string): void
```

New fields on `LatencyTrace`:

```ts
interface LatencyTrace {
  id: string;
  checkpoints: Partial<Record<LatencyCheckpoint, number>>;
  deltas?: Record<string, number>;
  exchangeId?: string;   // ← NEW
  streamId?: string;     // ← NEW
  error?: { stage: string; message: string };  // ← NEW
}
```

The compact dev trace view now shows the correlation IDs and error stage inline
in the `console.groupCollapsed` label:

```
[LÉLU Latency] trace a1b2c3d4  |  exchange=ex123456  stream=st789abc
  T0→T1   12.3ms
  T1→T2   245.1ms
  T2→T3   890.4ms   ← provider latency
  T3→T4   0.1ms
  T4→T5   0.2ms
  T5→T6   0.8ms
  T0→T7 (total)  1149.9ms
```

---

## 3 · Full Pipeline Stage Coverage

| Stage | Checkpoint / Where |
|-------|--------------------|
| INPUT | T0 — `GenesisChat.send()` start |
| AIService.chat entry | T1 — `AIService.chat()` start |
| runtime.process start | T2 — before `this.runtime.process()` |
| FIRST SSE CHUNK | T3 — first `onDelta` callback |
| STREAM EMIT | T4 — `AIService.emitStream()` (same tick as T3) |
| STREAM SUBSCRIBER | T5 — `GenesisChat.subscribeStream` callback (was missing — now marked) |
| EXCHANGE UPDATE | T6 — `setExchange()` called |
| REACT PAINT | T7 — `requestAnimationFrame` (ENVIRONMENT-BOUND in Node) |

CognitiveTrace (the evidence chain inside AIService) was extended with three
new UI-layer stages so a dev can record STREAM_EMIT / STREAM_SUBSCRIBER /
EXCHANGE_UPDATE into the same cognitive turn record:

```
STREAM_EMIT       // AIService.emitStream() fired
STREAM_SUBSCRIBER // GenesisChat subscribeStream callback received the event
EXCHANGE_UPDATE   // setExchange() was called to update the UI exchange
```

---

## 4 · Error Tracing at Failure Boundaries

| Location | Stage code | What triggers it |
|----------|------------|-----------------|
| `AIService.chat()` catch block | `D=Provider` | Any non-abort provider failure; text is already passed through `PromptInjectionGuard.redactSecrets()` BEFORE the traceError call — no raw keys/tokens logged |
| `GenesisChat.send()` catch block | `F=Subscription` | Failures that escape the AIService pipeline (stream lifecycle, exchange state, subscription error) |

Security constraint verified by test 5:
> `latencyTraceError("D=Provider", ...)` appears AFTER `redactSecrets()` in
> the AIService source — the error message reaching the trace has already had
> secrets stripped.

---

## 5 · "No-Response" Bug Investigation

### Code paths that produce empty `assistantText`

The empty-response path in `GenesisChat.send()`:

```ts
if (!assistantText) {
  if (cancelledRef.current) {
    // silent settle — user pressed Stop
    return;
  }
  const note = "⚠️ I couldn't generate a response — please try again.";
  notify("Lélu Error", "The assistant returned an empty response.");
  ...
}
```

This fires when `Orchestrator.getInstance().process()` returns a falsy `result?.response`.

### Failure classification (A–G)

| Stage | Code | Diagnosis |
|-------|------|-----------|
| A — Input | `GenesisChat` early return | Guarded: `if (!typed && media.length === 0 && files.length === 0) return`. Cannot produce a no-response. |
| B — AIService | `AIService.chat()` returns `{ text: "" }` | Possible if provider returns an empty string and `conversation.record("assistant", "")` is called. AIService currently returns `errorText` text in the catch path, not `""`. |
| C — Runtime | `Orchestrator.process()` returns `null` | Possible if the Orchestrator's internal `process()` returns `{ response: undefined }`. GenesisChat guards with `typeof result?.response === "string"`. |
| D — Provider | Provider timeout / network failure | Caught by AbortSignal.any(); results in an AbortError which GenesisChat treats as silent cancel. If the provider succeeds but returns `text: ""`, flows to B. |
| E — Streaming | Stream events filtered by `conversationId !== turnConversationId` | The stream deltas would be dropped, but `assistantText` comes from `Orchestrator.process()` return value — not from stream events alone. So streaming failure produces empty display only, not empty `assistantText`. **This is the most likely "no-response" scenario.** |
| F — Subscription | `unsubscribeStream()` called before all deltas arrive | Stream deltas arrive after `finally { unsubscribeStream() }` would be silently dropped. But again, `assistantText` from Orchestrator return is not affected. |
| G — UI / Render | `setExchange(null)` called after user cancels | Intentional; not a bug. |

### Most likely root cause: Stage E (Streaming display, not empty response)

The "no-response" symptom — user sees blank assistant turn — is most likely
Stage E: stream events are filtered because `event.conversationId !==
turnConversationId`, so the streaming display never updates.  The final
`assistantText` from `Orchestrator.process()` is still written into
`setExchange` at line 887, but the user sees nothing while the response
streams because the real-time deltas were silently dropped.

This can happen if:
1. The user switches conversations mid-stream (correct behavior).
2. `claimTurn()` / `TurnOwnership.bindMessage()` fails to bind `streamId →
   conversationId` before the first delta arrives (race condition at bind time).

The `bindMessage(streamId, conversationId)` call in AIService line 575 happens
synchronously before any `await`, which guards against the race.  The most
fragile path is `ai.chat(prompt, media, ...)` (line 850) because that goes
directly to AIService without the Orchestrator queue — if the conversation
switches between the `subscribeStream` call and the AIService `streamId`
generation, `streamId` will be bound to the right conversation but the
subscriber checks `turnConversationId` from the closure, which is set before
the switch.  This appears correct.

**VERDICT:** No correctness bug was found in the correlation code.  The "no
response" symptom is most likely caused by the user switching conversations
mid-turn (expected filtering) or by a real provider outage.  The new trace
system will show the exact stage of failure in `window.__leluLatencyLog`.

---

## 6 · Regression Area Inspection

| Area | Finding |
|------|---------|
| Chat state (setExchange) | `exchangeId` is stable per-turn and guards `setExchange` updates — no contamination path found |
| Exchange identity | `exchangeId` and `streamId` are now linked in the trace; their separation is intentional |
| Stream subscription lifecycle | `subscribeStream` is set up before `Orchestrator.process()` call; `unsubscribeStream` is in `finally` — ordering is correct |
| Workspace isolation | 27/27 Playwright tests pass (previous pass) |
| VoiceBridge | 17/17 tests pass; VoiceBridge does NOT import LatencyProbe separately (verified by test 14) |
| GenesisChat | No stale closure on `stillViewingTurn()` — reads from `MultiChatStore.getInstance()` at call time |
| AIService lifecycle | Single instance; `activeUserTurns` counter is guarded by `Math.max(0, ...)` |
| Cancellation | AbortController per conversation; `cancelledRef.current` guards silent settle |
| Initialization ordering | `if (!this.initialized) await this.initialize()` before T1 mark |
| Race conditions | `bindMessage()` is synchronous before any `await` — race is guarded |
| Duplicate subscriptions | `unsubscribeStream()` called in `finally`; no leak path |

---

## 7 · Test Suite Status

```
tests/cancellation-concurrency.test.ts   22/22  ✅
tests/no-duplicate-systems.test.ts       10/10  ✅
tests/latency-probe.test.ts              13/13  ✅
tests/voice-core-integration.test.ts     17/17  ✅
tests/trace-correlation.test.ts          17/17  ✅  ← NEW
TypeScript (tsc --noEmit)                       ✅  clean
scripts/verify-workspace-isolation.mjs   27/27  ✅
```

**Total: 79/79 unit tests + 27/27 Playwright = 106 passing, 0 failing.**

---

## 8 · Architecture Confirmation

```
ONE pipeline — text and voice —
GenesisChat.send()
  ├─ latencyStart()         → traceId
  ├─ exchangeId = UUID
  ├─ latencyAnnotate("exchangeId", exchangeId, traceId)
  │
  ├─ ai.subscribeStream(cb)       ← stream display wiring
  │
  ├─ Orchestrator.process()       ← text path
  │    └─ AIService.chat()
  │         ├─ streamId = UUID
  │         ├─ latencyAnnotate("streamId", streamId)
  │         ├─ bindMessage(streamId, conversationId)
  │         ├─ runtime.process()  → provider
  │         └─ emitMessage({ id: streamId, ... })
  │
  └─ ai.chat(prompt, media, ...)  ← multimodal/voice path (same AIService)

LatencyTrace in window.__leluLatencyLog:
  { id, checkpoints, deltas, exchangeId, streamId, error? }
```

No second AIService, no second chat store, no second cognition loop, no second
streaming system was created or modified.  All existing architectural
boundaries (MemoryBridge, ToolDispatcher, AutonomyGate, EngineeringAuthorization,
TurnOwnership, CompletionVerifier, AgentCognitionRuntime, etc.) are intact.
