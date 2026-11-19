# M22.2 — Global Cognitive Context Elimination & Complete Memory Sovereignty

**Branch** `freebuff/m22-2-global-cognitive-context-elimination`
**Started from** M22.1 HEAD `2d09bba` (implementation `ceaa926`, hash record `2d09bba`), base `aa8b1bd`
**Predecessors** M22 (`2c3d149`), M22.1 (`ceaa926`)

M22 made memories owned. M22.1 made projects, agents and the shared window scoped. Both boundaries were correct and both were applied *per boundary* — so every new context carrier was a way around them. M22.2 closes the carriers: workspace observation text, the cognitive snapshot, tool results rendered as runtime state, and an anonymous identity that used to satisfy an owner check by simply being absent.

No second memory system was introduced. The existing stores and the existing `MemorySovereignty` rules are reused; what changed is that context is now classified before it can enter a payload.

---

## 1. The two named pathways, and what they actually were

### P0-A — Workspace observations

`WorkspaceManager` held `items: string[]` per workspace. Every observation's text sat in one global array with **no owner, conversation, session or source**, and `CognitiveCore.state()` returned it to anyone. A workspace *label* was safe to list; the *items* were not, and the API did not distinguish them.

Now an observation carries `origin`: `userId`, `conversationId`, `sessionId`, `workspaceId`, `sourceType`, `createdAt`, `confidence`, `retention`, `scope`, an optional `memoryId` link, and an `unattributed` flag for legacy entries.

Scopes: `conversation-local`, `session-local`, `user-persistent`, `project-associated`, `agent-reported`, `historical`, `inferred`.

- `all()` returns names, purposes and **counts only** — never text.
- `itemsFor(workspaceId, scope)` returns authorized text.
- An observation with no origin is retained for the workspace display and is **never shown as any conversation's context**.
- Reasoning and plan text — filed with no scope at all before — is now session-local and never injected into another conversation.
- Deletion propagates: `forgetMemory` and `forgetConversation` purge observations; `forgetObservation` deletes one; `supersede` replaces text so a corrected statement cannot be quoted as current fact.

### P0-B — The agent cognitive snapshot

`buildCognitiveContext()` assembled one snapshot from live singletons and ignored the caller. It was worse than the brief: it carried **every active and paused project with its checkpoint**, bypassing the M22.1 project boundary outright, plus the self-model's separate copy of project names, plus recent execution events, plus the executive "last action".

Five callers were traced (`AIRuntime` twice for chat, `toolContext`, `AIService.chat`, `AIService.delegate`). The function now takes a `ContextScope` (`userId`, `conversationId`, `sessionId`; a bare string still means a conversation id):

- projects and checkpoints pass `isProjectVisible`, and a project from another chat is **labelled** in the formatted text;
- self-model project names are filtered to authorized names;
- recent execution events must be **owned by this conversation** — ownerless tool results (which is how `Project "X" created` reached every scope) are no longer rendered at all;
- `VerifiedAction` records its owning conversation, and `getSelfStateText(conversationId)` shows the last action only there;
- a caller with no identity gets **operational state only**: no projects, no checkpoints, no events, no last action. There is no silent fallback to global state.

---

## 2. Universal context authorization

`src/core/cognition/ContextAuthorization.ts` is the single checkpoint. Every section declares its kind and provenance; `authorizeContextSections` returns one of **RETRIEVE / RETRIEVE_WITH_CONTEXT / DEFER / REJECT** per section, with a record of `id`, `kind`, `decision`, `relation`, `reason`, `labelled` and `scope`.

- operational state is allowed (no user content);
- this conversation's material is retrieved;
- durable material from elsewhere is retrieved **with context only when labelled**, otherwise deferred;
- another user's or another session's material is rejected;
- an absent identity no longer satisfies an owner — the same tightening was applied to `isProjectVisible` and `decideProject`.

Semantic relevance never authorizes injection. Historical material stays labelled and distinguishable from the current conversation.

`MemoryBridge.buildContext` routes every section through the checkpoint and records a `CONTEXT_INJECTION` trace with per-section decisions. `MISSION-22.2/context-authorization-map.json` maps each pathway (memory, graph, workspace, projects, agents, session, snapshot, tool results, background tasks, payload assembly) to its boundary.

---

## 3. Global state and caches

Audited in `MISSION-22.2/global-state-audit.json`. Shared singletons that hold durable or operational state were **kept** — SelfModel, ProjectStore, AgentStore, AgentEventBus, MultiChatStore, ExecutiveRuntime, CognitiveTrace, UI/capability stores. What was removed is unauthorized *content*: the shared text array, the global snapshot default, ownerless events, and a globally rendered last action. No useful shared infrastructure was eliminated.

## 4. Concurrency

Three conversations at once: A (personal loss, observation, project, agent task), B (unrelated engineering, own observation and task), C (authorized historical recall of a durable project).

`MISSION-22.2/concurrency-validation.json` — **6/6**: A's grief does not enter B; B's deploy fact stays in B; a durable project from A appears in B only with its "started in another conversation" label; B keeps its own project; another user sees neither; no material is reassigned.

## 5. Deletion and retention

`MISSION-22.2/deletion-validation.json`: individual memory, single observation, conversation, session expiry, agent task removal, correction by supersession, project removal. Deleted text does not survive in workspace labels, snapshots, agent caches, background tasks or summaries. Durable memories survive conversation deletion with their provenance, as M22 requires.

## 6. Personality and emotional continuity

`PersonalitySpec`, `EmotionAppraisal`, `ProviderVoiceContract`, `VoiceDriftGuard` and `VoicePerformance` were not modified. `tests/personality-voice-2_1.test.ts` still passes unchanged. Historical emotion reaches the current turn only as labelled material; the current appraisal is not seeded from another conversation's state. Familiarity and project continuity are preserved through durable memory and labelled project context.

## 7. Live provider validation

`MISSION-22.2/provider-validation.json` — **PASS**, two turns answered by **Groq** through the canonical `AIService.chat` pipeline (OpenRouter fell back). The captured payload is the request the provider actually received, after all context transformations:

- B's turn: no grief from A, B's own deploy fact present, A's durable project present **only with its origin label**;
- A's own-history turn: A's history present, B's fact absent.

No credential is recorded.

## 8. Browser and mobile

**Not verified, and not claimed.** `MISSION-22.2/browser-validation.json` records the blockers honestly: the 3D Genesis scene saturated the automation channel within about two minutes in the prior session, and provider quota (OpenRouter 429 free-models-per-day, Groq 413/429 at 8000 TPM on long context) prevented a driven chat. Mobile remains unverified: no device or emulator, and the project has only a `capacitor.config.ts` with no `android/` or `ios/` target.

## 9. Performance (M22.1 baseline → M22.2)

| Measurement | M22.1 | M22.2 |
| --- | --- | --- |
| Section authorization (8 sections) | 0.0094 ms/record | **0.0055 ms** mean, 0.0095 p95 |
| Workspace read (300 observations) | — | **0.0073 ms** mean |
| 500-node cognitive state filter | 0.046 ms | **0.0516 ms** mean |
| Scoped snapshot assembly | — | **0.267 ms** mean, 0.372 p95 |
| Clean enrichment | 1.20 ms mean / 1.54 p95 | **0.779 ms** mean / 1.044 p95 |

All four thresholds pass (`MISSION-22.2/performance-report.json`). Isolation cost is sub-millisecond; scoping made enrichment cheaper because foreign sections are no longer formatted.

## 10. Tests

- M22: 28/28 (`tests/memory-sovereignty.test.ts`)
- M22.1: 18/18 (`tests/memory-hardening.test.ts`)
- M22.2: 19/19 (`tests/context-sovereignty.test.ts` — groups W 9, X 5, Y 6)
- Combined boundary suites: **105/105** with runtime-integration, conversation-memory and personality 2.1
- Full regression: **2373 tests, 2363 pass, 2 fail** — `tests/genesis-interface.test.tsx` (CSS export in this environment) and `tests/sandbox-security.test.ts` "network: TCP, UDP, DNS and fetch all fail", exactly the two failures documented before M22.2 began; no new failure
- Typecheck: only the two pre-existing `src/core/perception/FeatureUnderstanding.ts:455` errors (unchanged, environmental to that file)

## 11. Acceptance

| Criterion | State |
| --- | --- |
| Workspace observation ownership | implemented + tested |
| Workspace labels scope-aware | implemented + tested |
| Global observation leakage eliminated | implemented + tested + live |
| `buildCognitiveContext()` scope-aware | implemented + tested + live |
| Agent snapshots isolated | implemented + tested + live payload |
| All agent callers audited | 5 traced, all scoped |
| Universal context authorization | implemented + tested |
| Global mutable state audited | `global-state-audit.json` |
| Shared caches validated | yes, no cross-turn snapshot cache exists |
| Concurrent cognition | live 6/6 |
| Background task isolation | scoped; no-scope → operational only |
| Memory deletion propagates | tested |
| Historical emotional state isolated | tested |
| Personality 2.1 preserved | tests unchanged and green |
| Groq live validation | PASS (2 turns) |
| OpenRouter live validation | not this session (429 earlier); fallback observed |
| Final provider payloads inspected | yes — booleans + counts, redacted |
| GenesisChat browser validation | **not completed — not claimed** |
| Performance measured | yes |
| Full regression executed | recorded in commit note |
| No new TypeScript errors | yes (2 pre-existing) |
| No unverified acceptance claims | yes |

## 12. Why this is the boundary completed

Before: authorization was a property of each store. A new carrier — a workspace item, a snapshot field, a tool result, the last action — inherited whatever reach its container had.

After: a carrier declares who it belongs to and where it was made, and one checkpoint decides. A future context pathway that forgets to do this fails its own tests rather than quietly reaching a prompt, because the tests assert on the text the provider receives and the snapshot actually rendered, not on a retrieval log.
