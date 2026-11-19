# LÉLU 2.2.1 — MEMORY SOVEREIGNTY HARDENING & COMPLETE CONTEXT ISOLATION

**Class:** core cognition / memory security / conversational continuity
**Predecessor:** M22 Memory Sovereignty (`2c3d149`, hash record `a605a46`, base `aa8b1bd`)
**Branch:** `freebuff/m22-1-memory-sovereignty-hardening`
**Priority:** P0

---

## 1. Executive summary

M22 made the **memory store** answer "whose is this, and where was it said". It could not
make the rest of LÉLU's cognition answer the same question, because most of her context did
not come from the memory store.

2.2.1 audited every other pathway that can put information in front of her — the project
registry, agent requests, the legacy shared window, the cognitive graph, session state,
background cognition — and gave each one the same origin, ownership and authorization it
gives a memory. Five defects were found and fixed; two structural limits are documented rather
than papered over.

The most serious were not in memory at all:

- **the project registry was global.** Every active project was rendered into every turn's
  context, and `ProjectStore.contextFor()` handed a project's *contents* to any caller,
  including an agent. A project begun in another chat, or belonging to another user, was
  presented as current work.
- **agent requests had no conversation identity.** `AIService.delegate()` built its request
  without `conversationId`, so an agent's memory recall ran unscoped — precisely the condition
  that made the shared window reachable — and its findings were stored as if the user had
  said them.
- **the shared window was still an implicit fallback.** `perChatTurns ?? modelMessages()`
  worked, but nothing named it, and `MemoryBridge.threadContext()` returned it outright when a
  request had no id.

None of these were visible from the memory tests, which is the point: memory was not the only
source of knowledge.

---

## 2. What changed

### 2.1 Project sovereignty (WP01)

`src/core/projects/ProjectSovereignty.ts` (new) defines a project's origin and scope:

```
user-persistent | conversation-local | session-local | shared | historical
```

`ProjectStore` records `ownerId`, `originConversationId`, `originSessionId`,
`originConversationTitle` and `scope`. `MemoryBridge.formatProjects()` authorizes each
project against the turn's access before formatting:

| situation | decision |
|---|---|
| another user's project | **REJECT** — not even its name |
| conversation-local project from another chat | **REJECT** |
| session-local project from another session | **REJECT** |
| durable project started elsewhere | **INJECT_WITH_LABEL** — `[started in the chat "…"]` |
| project of this conversation | **INJECT** |
| pre-2.2.1 project | visible, unlabelled, unowned — never claimed by anyone |

`ProjectStore.contextFor(projectId, access)` refuses contents at the same boundary, so an
agent cannot be handed a project the turn may not describe. Chat creation paths
(`ProjectResolver`, the `project.manage` tool) now record the conversation and session.

### 2.2 Agent memory sovereignty (WP02)

`AgentTaskScope { userId, conversationId, sessionId }` travels from
`AIService.chat → Shaman.dispatch → AgentRunner.run → AIService.delegate`, is **persisted on
the task**, and is restored on `resume()`. Consequences:

- memory recall for an agent runs inside the conversation (`request.conversationId`);
- an agent's report is stored as `sourceType: "agent-reported"`, scope `derived` — never as
  the user's words;
- project contents are authorized against the run's scope;
- two agents on two conversations cannot read each other's memories, because there is one
  boundary and each request carries its own identity.

### 2.3 The legacy fallback, made explicit (WP03)

`src/core/memory/SharedWindowAdapter.ts` is now the **only** code that may return the brain's
shared window:

| input | history |
|---|---|
| known conversation | that conversation |
| unknown conversation id, chats exist | **none** (never another chat's) |
| unknown id, no chats (first run) | shared window, source `shared-legacy` |
| no id, chats exist | **none** |
| no id, no chats | shared window, source `shared-legacy` |

Every non-conversation source writes a `TASK_CONTEXT` trace entry with its reason.
`MemoryBridge.threadContext()` builds a thread from the request's own turns instead of
falling back to the window.

### 2.4 Cognitive state (WP07)

Observations carry `conversationId` (M22) and now also `memoryId`, so a memory and the
observation derived from it can be deleted together. `state(conversationId)` refuses
unattributed nodes. There is no persisted emotional state to inherit: appraisal is computed
per turn from the current message.

### 2.5 Deletion and retention (WP06)

- `Brain.forgetMemory(id)` — store record **and** linked graph node, with a trace entry.
- `Brain.forgetConversation(id, { keepPersistent })` — session memories and that
  conversation's nodes. Durable facts survive, still labelled with the deleted chat as their
  origin. Deleting a chat is not a request to forget the user.
- `GenesisCore.closeConversation` calls it; deletion now propagates instead of leaving the
  chat readable through recall.

### 2.6 Chronology

`updatedAt` advances **strictly monotonically** in reinforce/supersede, so a correction issued
in the same millisecond as the original still orders correctly (an intermittent M22 test
failure traced to clock granularity, now deterministic).

---

## 3. Verification

### 3.1 Unit / integration (no model)

| suite | result |
|---|---|
| `tests/memory-hardening.test.ts` (new, groups H–L) | **18 / 18 pass** |
| `tests/memory-sovereignty.test.ts` (M22) | **28 / 28 pass**, 3 consecutive runs |
| full suite `npm test` | **2,354 tests — 2,344 pass, 8 skipped, 2 fail** (both pre-existing environmental: `genesis-interface` CSS export, `sandbox-security` error string) |
| typecheck `tsc -p tsconfig.app.json --noEmit` | 2 pre-existing errors in `FeatureUnderstanding.ts`; **0 new** |

### 3.2 Two-user execution (`MISSION-22.1/cross-user-validation.json`)

Synthetic users A and B, one store, one boundary. **6/6 checks pass**:

- B asking a semantically similar question recalls **0** memories; no grief in context;
- A's persistent fact and project never reach B;
- B's own project remains available to B;
- A still recalls their own fact (isolation ≠ amnesia);
- A's durable project is labelled as started in another chat.

### 3.3 Provider payloads (`MISSION-22.1/provider-validation.json`)

Real Groq and OpenRouter turns through `MemoryBridge.enrich → AIRuntime.process`. **6/6**.

| turn | context | grief | A's fact | A's project | voice |
|---|---|---|---|---|---|
| B — groq | 4,131 chars | no | no | no | attached |
| B — openrouter | 4,173 chars | no | no | no | attached |
| A — groq | 3,347 chars | no | yes, labelled | yes, labelled | attached |
| A — openrouter | 3,347 chars | no | yes, labelled | yes, labelled | attached |

The personality layer is intact in every answered turn.

### 3.4 Performance (`MISSION-22.1/performance-report.json`) — all thresholds pass

| measure | 2.2 baseline | 2.2.1 |
|---|---|---|
| eligibility, per record | 0.009 ms | 0.0008 ms |
| authorization, per record | 0.009 ms | 0.0094 ms |
| project decision, per project | — | 0.0001 ms |
| cognitive state, 500 nodes | — | 0.046 ms |
| enrich, clean turn | — | 1.20 ms mean / 1.54 p95 |

No inaccessible project appears in either turn; the historical turn carries its label and
provenance note.

### 3.5 Browser (`MISSION-22.1/browser-validation.json`) — partial

Verified in the Cloud browser this session: the composer wrote the Aurelia fact through the
real UI and it was answered; a new conversation was created, became the workspace's active
conversation and persisted (`lelu.multichat.workspace.v1`, 4 chats, 11,295 chars).

**Not verified:** the post-reload recall *answer* in the UI. Two independent blockers:

1. provider quota — OpenRouter's free daily limit returned 429 and Groq's TPM ceiling 413/429,
   so no model reply could be produced for the probe turn;
2. the 3D scene saturates Cloud-browser automation after ~2 minutes: CDP attach timed out,
   module evaluation exceeded 10 s, and a fresh tab booted while Vite returned 503s during
   dependency re-optimisation.

The same behaviour is verified at pipeline and provider level, and M22's screenshots show the
UI isolation it depends on.

### 3.6 Mobile — NOT VERIFIED

No device, emulator or native project exists here (`capacitor.config.ts` only; no `android/`,
`ios/`). `mobile-validation.json` lists the exact outstanding tests and claims nothing.

---

## 4. Acceptance criteria

| criterion | status |
|---|---|
| Project registries have ownership and scope | ✅ |
| Agent context is conversation-aware | ✅ |
| Legacy shared-window fallback removed / isolated | ✅ explicit adapter |
| Missing identity cannot access shared context | ✅ |
| Two-user isolation independently validated | ✅ synthetic two-user execution |
| Concurrent user requests tested | ✅ |
| Cognitive state fully scoped | ✅ nodes; ⚠️ workspace labels still global (documented) |
| Historical emotional state isolated | ✅ no persisted emotional state exists |
| Cache isolation verified | ✅ session-scoped records rejected; no second index |
| Memory deletion propagation verified | ✅ store + graph |
| Browser historical recall verified after reload | ❌ blocked (quota + 3D saturation) |
| Mobile conversation isolation verified | ❌ no device |
| Groq live validation passes | ✅ |
| OpenRouter live validation passes | ✅ |
| Original M22 tests remain green | ✅ 28/28 |
| Full regression suite executed | ✅ 2,354 tests |
| Performance measured | ✅ |
| No new TypeScript errors | ✅ |
| No unauthorized context in provider payloads | ✅ |

---

## 5. Residual risks and honest limits

1. **Single-user build.** Project `ownerId` is enforced when recorded, but the Projects panel
   has no identity to record. A real second account would need the user id threaded into
   project creation; the cross-user test does this explicitly.
2. **Workspace labels.** `CognitiveCore.observe()` still adds observation text to the "core"
   workspace. Context renders workspace *names* only, so nothing leaks today, but the labels
   should be scoped deliberately.
3. **`buildCognitiveContext()`** is composed globally for agent requests. It carries runtime
   and self state, not transcripts; recorded so the next pass can scope it on purpose.
4. **Ordinary memories survive their chat** by design (`persistent-user`). They remain
   recallable only as labelled history; deleting a chat purges session material and nodes.
5. **Model compliance is not guaranteed.** The system always preserves the origin; whether the
   reply states it is the model's behaviour.
6. **Browser and mobile** as described in §3.5–3.6. Neither is claimed.

---

## 6. Reproduction

See `MISSION-22.1/acceptance/README.md`. Fastest complete check:

```bash
npx tsx --tsconfig tsconfig.test.json --import ./tests/support/ignore-css.mjs \
  --test tests/memory-hardening.test.ts tests/memory-sovereignty.test.ts
npx tsx scripts/memory-hardening-live.ts
npx tsx scripts/memory-hardening-bench.ts
```

---

## 7. Commit

Recorded in `MISSION-22.1/commit.txt` after the commit is created. Nothing pushed.
