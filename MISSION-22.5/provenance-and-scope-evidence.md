# MISSION 22.5 — PROVENANCE AND SCOPE EVIDENCE

**Date:** 2026-11-19
**Verified code commit:** `e481c2c4ca6f8421528b653d9b06646aad6bc9aa`

---

## 1. What provenance means in LÉLU, and what was broken

A memory's provenance answers three questions: **who supplied it**, **how it was obtained**, and **whether the work behind it was observed**. Before this mission, only the first half existed.

`MemoryBridge.learn` computes:

```ts
{
  source: "lelu-chat",
  executionVerified: <a real tool_result backs this turn?>,
  redactedActionClaims?: <count of claims removed>
}
```

and passes it to `Brain.learn`. `Brain.learn`'s signature named those parameters `_intent`, `_keywords`, `_context` and **never read them**. `MemoryEngine.learn` had no provenance parameter at all. So the stored pattern was identical whether the fact came from a verified tool run, a user statement, an agent's inference, or a model sentence that merely *claimed* an action.

Measured consequence: `tests/runtime-integration.test.ts` asserted `context.executionVerified === false` against a **stub brain**, so the suite stayed green while the real path discarded the field.

### The repair

| Layer | Before | After |
|---|---|---|
| `MemoryBridge.learn` | computed provenance | unchanged (still the source of truth) |
| `Brain.learn` | discarded it | forwards `source`, `attribution`, `keywords`, `context` |
| `MemoryEngine.learn` | no such input | merges `LearnProvenance` into created/reinforced/merged/superseded patterns |
| `LocalMemoryProvider.persist` | dropped `attribution` | carries it into the learned context |
| `rememberKnowledge` / `rememberSystem` | no provenance | optional `provenance` written into pattern `context` |
| `AIService.consolidate` | no provenance | optional `provenance` forwarded |
| `ResearchResolver` | stored `"research"` only | `source: research-live-retrieval`, provider names, query, result count, source URLs, `retrievedAt`, `executionVerified: true` |
| `ObjectiveLearning` | lesson text only | lesson id, kind, topic, confidence, observations, objective id |

---

## 2. Provenance fields now persisted

| Field | Example | Written by |
|---|---|---|
| `source` | `lelu-chat`, `objective-learning`, `research-live-retrieval`, `engineering` | bridge / lesson / research / system |
| `attribution` | `lesson <id> from objective <id>`, `live retrieval from Grok + Reuters` | caller |
| `executionVerified` | `true` only when a real `tool_result` exists for the turn | `MemoryBridge` |
| `redactedActionClaims` | number of unbacked "I searched…" sentences removed | `MemoryBridge` |
| `custom` | any caller-supplied context, preserved verbatim | caller |
| `history` / `corrected` | superseded values (last 8) and correction time | `MemoryEngine` |
| confidence | `0–1`, reinforced by reuse, reduced by contradiction | engine / lessons |

### Claim vs fact, proven

- `MemoryBridge` strips sentences that claim a completed retrieval (`ACTION_CLAIM`) unless `AgentEventBus` holds a `tool_result` for that task with results. If the reply consisted only of such a claim, nothing is stored.
- The acceptance run stored a user-stated discovery with `executionVerified=false`: an **unverified observation**, not a fact dressed as verified work.
- Research that really ran stores `executionVerified=true` and its sources.

---

## 3. Scope model

| Scope | Mechanism | Where | Evidence |
|---|---|---|---|
| Conversation | `conversationId` on turns/tasks; task↔message binding | `TurnOwnership`, `AIService`, `MultiChatStore` | `tests/voice-core-integration`, `tests/turn-ownership` (passing) |
| Chat-only memory | `CHAT_SCOPED` regex refuses the long-term write | `ContextProvenance.ts:95`, `MemoryBridge.ts:401`, `ToolDispatcher.ts:1355` | acceptance check "chat-scoped statement is not made long-term memory" |
| Cross-chat honesty | `labelOtherChats` marks quoted other-chat lines and instructs naming the source | `ContextProvenance.ts` | unit-tested; deterministic suite passing |
| Shared resources | authorization recorded as `linked` / `project` / `asked` | `CrossChatResolver`, `AgentEventBus.sources` | `tests/authz-relationships` passing; consent flow not exercised live |
| Relationships / permissions | `RelationshipStore` | `src/core/security/authz/RelationshipStore.ts` | `tests/authz-relationships` passing |
| Project | `projectId` on task/objective/execution | `AgentStore`, `AgentObjectives` | existing tests |
| User (long-term) | user-global by design | `PatternMemory` | acceptance run retrieved across conversations |
| Mission / work package | **absent** | — | recorded as a gap in the audit |

### Important boundary

Long-term memory has **no per-record conversation tag**. Chat scope is enforced by *not writing* the chat-scoped statement, not by filtering reads. Any claim that "unrelated conversations cannot receive unauthorized context" must therefore be read precisely:

- A statement the user explicitly scoped to a chat is never written, so it cannot reach another chat. **Proven.**
- A fact the user did not scope is intentionally user-global and **will** reach other chats; it is labelled only when quoted from another chat's messages. **By design.**
- Multi-user isolation depends on the Supabase path, which was not configured in this environment. **Not tested.**

---

## 4. Privacy and retention evidence

| Control | Implementation | Verified |
|---|---|---|
| No tool arguments recorded | `sanitizeExecutionRecord` rebuilds the record field by field; the endpoint accepts no arguments | source + existing tests |
| Credential redaction | `redactExecutionText`: `sk|rk|pk|ghp|gho|ghs|github_pat|xox*`, `Bearer …`, `api_key|token|secret|password=…` | acceptance run: `Bearer [redacted]`, `api_key=[redacted]` |
| No prompt text / raw audio in execution records | dispatcher records ids, tool, stages, redacted reason | `tests/execution-evidence` + inspection |
| Execution log bounded | 15 min / 60 entries | `ExecutionLedger.ts` |
| Cognitive trace dev-only | disabled unless dev build or explicitly enabled | `CognitiveTrace.ts` |
| Credentials never in chat/test | this mission used invented codenames; no key was read, echoed or committed | repository scan |
| Log files not committed | `.gitignore` `*.log` | `git status` clean of logs |

**What was deliberately not done:** no secret, credential, private user information or raw audio was recorded, and no test forced every spoken statement into permanent memory. Memory writes remain subject to `CHAT_SCOPED`, user intent, and the existing retention bounds.

---

## 5. Residual provenance risks

1. **`source` is caller-asserted.** A future caller can pass `source: "research-live-retrieval"` without retrieving anything; only `executionVerified` is grounded in the event bus. The field records what the caller knew, not an independently audited fact.
2. **`Brain.persistLayer` still defaults knowledge provenance to `research`/`engineering`** when a caller supplies none; the category is true but coarse.
3. **Knowledge memories have no supersession.** `persistLayer` dedupes identical text and otherwise adds a new pattern. A corrected *knowledge* item can coexist with its predecessor (conversation facts, by contrast, now supersede). This is a real limitation and was not changed, because routing knowledge through `MemoryEngine` would change category and extraction semantics.
4. **Commit and mission provenance are absent** (see §3 and the recording matrix), so repository work cannot be reconstructed from memory alone.
