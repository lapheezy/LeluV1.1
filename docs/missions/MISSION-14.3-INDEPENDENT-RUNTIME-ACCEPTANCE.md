# MISSION 14.3 — INDEPENDENT RUNTIME ACCEPTANCE & EXECUTION PROOF

**Branch:** `mission-14.3/independent-runtime-acceptance`
**Base commit:** `4582382`
**Evidence commit:** `229a7e1`
**Report commit:** this commit
**Base branch:** `freebuff/8994d7c2e03123fc8927b6fc`
**Remote:** `https://github.com/lapheezy/LeluV1.1.git`
**Overall status:** **PARTIAL** — local cognition-to-tool execution and true local operation are proven; authenticated cloud continuity is not.

---

## 1. Result in one page

LÉLU's existing runtime was exercised in a real production build and in a real Chromium session. No cognition, identity, memory, project, Cosmos, Neural Map, provider or dispatcher architecture was replaced.

What is now proven:

- A model-shaped turn goes through the production `ProviderResolver`, discovers the tools actually offered to it, calls the production `ToolDispatcher`, executes real project/sandbox/Cosmos operations, receives the results, and continues.
- The dispatcher refuses an unknown tool, invalid arguments, and `project.apply` without an authenticated human authorization.
- A Cosmos room is not created on the model's request alone. It waits for the existing approval gate, then the approved call executes.
- The production build boots and operates with every non-local HTTP request blocked.
- Local identity, conversation, project and knowledge state survive reload and an actual `navigator.onLine === false` turn.
- Knowledge nodes, relationships, revision and local provenance survive reload.
- A blocked browser-storage write is reported as failure, not as success; corrupt stored JSON reads as absent.

What is **not** proven:

- Real remote-model reasoning. The cognition-to-tool trace uses the real production path with a **scripted model** provider. The offline chat turn was deterministic, and LÉLU said so.
- Authenticated Supabase cloud operation. No test account, test project or credentials were supplied.
- Cloud synchronization, conflict handling, cloud disconnection and cloud recovery. These require the missing authenticated session and are not simulated here.
- General conflict resolution. The current Supabase writer is an upsert/last-writer-wins path; no conditional conflict detector was found, and none was invented for this mission.

Mission 14.3 is therefore **PARTIAL**, not complete. A green local test is not a cloud test, and a scripted model is not a remote model.

---

## 2. Repository preflight

The mission started from the exact Mission 14.2 delivery.

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `4582382036558d61a37e9a5d998657331caef09b` |
| Starting branch | `freebuff/8994d7c2e03123fc8927b6fc` |
| Worktree before work | clean |
| Changes since `4582382` before work | none |
| Remote | `origin https://github.com/lapheezy/LeluV1.1.git` |
| Supabase env in shell | none |
| Supabase names in `.env.local` | none |
| Mission 14.2 report | read: `docs/missions/MISSION-14.2-INDEPENDENT-RUNTIME.md` |

A new branch was created at `4582382`:

```text
mission-14.3/independent-runtime-acceptance
```

The Mission 14.2 branch and its commit were not reset, rewritten or force-pushed.

---

## 3. Mission 14.2 baseline

Mission 14.2 established:

- Supabase is opt-in. An empty environment resolves to `null`, not to the public project.
- No Supabase client is created in local-only mode.
- Identity, projects, conversations, cognition and the knowledge graph operate through local stores.
- The knowledge graph persists nodes, relationships, `provenance: "local"`, revision and update time through `KvStore`.
- The optional Supabase adapter initializes only when explicitly configured.
- Real-project apply/commit still requires an authenticated Supabase identity.

The baseline regression result was:

```text
2251 tests
2241 pass
2 fail
8 skipped
```

Known baseline failures:

1. `tests/genesis-interface.test.tsx` — Excalidraw CSS package export error.
2. `tests/sandbox-security.test.ts` — network-denial result is `''` rather than `/^denied:/`.

Mission 14.3 did not change either failing subsystem.

---

## 4. Architecture this mission exercised

The mission deliberately used the existing authority graph. Nothing below is a new orchestrator or store.

```text
User input
  │
  ├─ AIRouter / intent
  │    ├─ deterministic resolvers (identity, project fallback, status)
  │    └─ ProviderResolver.generateWithTools
  │         ├─ Provider selection (remote, local or scripted)
  │         ├─ Tool discovery (ToolSchemas → offered names)
  │         ├─ Tool call → ToolDispatcher.dispatchToolCall
  │         │    ├─ ToolRegistry availability
  │         │    ├─ AutonomyGate / ApprovalGate
  │         │    ├─ EngineeringAuthorization (real-project boundary)
  │         │    └─ real executors
  │         │         ├─ ProjectStore
  │         │         ├─ SandboxFS
  │         │         └─ WorkspaceAPI → CosmosNavigation / SpatialObjects
  │         └─ Tool results returned into the next model turn
  │
  ├─ CognitiveCore / KnowledgeGraph
  │    └─ KvStore `lelu.cognition.knowledge.v1`
  │
  ├─ Local stores
  │    ├─ KvStore (projects, conversations, knowledge, navigation, approvals)
  │    └─ IndexedDB (preferred profile store, with KvStore fallback)
  │
  └─ Optional SupabasePersistence
       ├─ explicit config only
       ├─ auth session / hydration / upsert writes
       └─ reconnect() exists; not tested in this mission
```

The important distinction in this report:

- **Cognition-to-tool path** = production `ProviderResolver` + production dispatcher + real executors.
- **Model reasoning** = an actual model choosing those calls. Mission 14.3 did not have one reachable.
- **Deterministic local path** = fallback parser/identity resolvers. This is real application behavior, not model reasoning.

---

## 5. WP01 — cognition-to-tool execution

### 5.1 Method

`scripts/verify-m143-dispatch.mjs` runs the real development application on `http://127.0.0.1:3000`, imports the production modules, and supplies a scripted provider that returns OpenAI-shaped tool calls. The scripted provider is only the decision source; every step after it is the production code:

```text
scripted tool_calls
  → ProviderResolver.execute
  → ToolSchemas offered for the turn
  → dispatchToolCall
  → toolPermitted / approval / authorization
  → real executor
  → tool result message
  → next ProviderResolver turn
  → final assistant text
```

Evidence classes: **LIVE** (running application), **BROWSER** (real Chromium), **DISPATCH** (real dispatcher execution), **NETWORK** (all non-local requests blocked).

This is **not** remote-model reasoning evidence. It proves that a model-shaped decision can reach and use the runtime, not that a remote model made the decision.

### 5.2 Project operation

Model call:

```json
{
  "name": "project_manage",
  "arguments": {
    "action": "create",
    "name": "M143 Scripted Dispatch",
    "objective": "Prove the model-to-tool path"
  }
}
```

Offered tools for that turn included `project_manage`. The production dispatcher executed it and returned:

```text
Created project "M143 Scripted Dispatch" (c63966dc-1968-4cee-b27c-2cb74571b5ba).
```

Evidence:

| Item | Value |
|---|---|
| Offered capability | `project_manage` |
| Authorization | permitted at autonomy level 3 |
| Dispatch result | `ok: true` |
| Executor | `ProjectStore` |
| Persisted ID | `c63966dc-1968-4cee-b27c-2cb74571b5ba` |
| Reload | still present |
| Turn duration | 469 ms |

### 5.3 Sandbox write and read-back

Two model turns:

1. `sandbox_write` with `path: "m143/proof.txt"`, `content: "local dispatch proof"`.
2. `sandbox_read` with the same path.

Actual results:

```text
Wrote 20 character(s) to "m143/proof.txt".
local dispatch proof
```

The read-back is the executor's value, not an echoed request. Evidence class: **DISPATCH**.

### 5.4 Cosmos object with the real approval gate

The model asked to create a room:

```json
{
  "action": "create-room",
  "room": { "label": "M143 Scripted Room" }
}
```

The first call did **not** create anything. The production autonomy policy classifies `create-room` as YELLOW for LÉLU, so the dispatcher returned:

```text
NOT DONE YET — this is a yellow action: Waiting for approval: create room “M143 Scripted Room”
Nothing in the workspace has changed.
(approval id approval-566cfa12-673b-4e6d-b837-ddb1aa4830a4)
```

The script then approved that exact request through the existing `ApprovalGate.decide(..., "approved")`, and the same call was repeated with the approval id. The dispatcher consumed the single-use approval and returned:

```text
YELLOW: Created room "M143 Scripted Room"
```

Canonical state:

| Item | Value |
|---|---|
| Room ID | `room-e1b164e9` |
| Persistence key | `lelu.lelu.cosmos.nav.v1` |
| Reload | room still present |
| Approval | single-use, exact-argument, consumed once |

This proves both directions of authorization:

- The model could not create the room on its own request.
- The approved request executed only after a real approval.

### 5.5 Knowledge node, relationship and revision

The real `CognitiveCore`/`KnowledgeGraph` code was exercised in the browser:

- observed node `M143 knowledge persistence proof`
- connected it to itself with relation `proves`
- revision advanced to `2`

After reload:

```text
knowledgeNodeStillPresent: true
knowledgeEdgeStillPresent: true
knowledgeRevision: 2
knowledgeProvenance: "local"
```

Evidence class: **LIVE** + **BROWSER**. This is persistence evidence, not model reasoning.

### 5.6 Result continuation

The trace records the offered tools and tool messages for each turn. The final assistant text is not supplied by the scripted provider's tool call; it is a later turn after the tool result was returned. That is the required result → cognitive-context loop.

Example offered set from the project turn:

```text
system_config, capabilities_list, capabilities_activate,
project_preview, project_manage, project_search, repo_status,
spatial_portal_create, repo_inspect, atelier_project,
studio_create, studio_build, studio_test, studio_write
```

No new dispatcher, orchestrator, memory system or identity authority was introduced.

---

## 6. WP01 — authorization evidence

### 6.1 Allowed local operation

`project_manage`, `sandbox_write`, `sandbox_read` and the approved `cosmos_workspace` all executed. They are local operations and do not require a cloud session.

### 6.2 Denied real-project write

`project.apply` was made available only long enough to test its separate authorization boundary. The production preflight reported:

```text
No authenticated session. Applying changes to the real project requires a
signed-in Supabase identity; sandbox work does not.
```

The dispatcher refused:

```text
"project.apply" was NOT run: changing the real project requires an explicit
authorization from the signed-in user, and none is currently held.
No authenticated session. ... The sandbox copy is unchanged and nothing was
written to the real project.
```

This is the intended security boundary: local-first does not mean authorization-free.

### 6.3 Unknown tool

```text
There is no tool named "not_a_real_tool", so nothing was executed.
```

### 6.4 Invalid arguments

`cosmos_workspace` with `action: "open-workspace"` and no view was refused before execution:

```text
open-workspace needs a view {kind, title} (plus url for open-browser).
```

### 6.5 Other existing authorization tests

Existing suites cover the remaining cases and were run:

- `tests/engineering-workspace.test.ts` — no session, autonomy level, project.apply not offered, project.apply refused.
- `tests/tool-calling.test.ts` — direct dispatcher, wire shape, provider tool calls.
- `tests/tool-discovery-execution.test.ts` — scripted model → real dispatcher → real executors.
- `tests/security-*.test.ts`, `tests/permission-contract.test.ts`, `tests/policy-authorization.test.ts`.
- `tests/local-only-operation.test.ts` — no implicit Supabase, local identity fallback, local persistence, blocked write, corrupt data.

Evidence class for these: **TEST**. They are not live application proof and are not presented as such.

---

## 7. WP02 — true offline operation

### 7.1 Test environment

| Item | Value |
|---|---|
| Build | production build (`npm run build`) |
| Server | `vite preview` on `127.0.0.1:4173` |
| Browser | Playwright Chromium 159.0.8154.6, headless |
| External requests | every request whose host is not `127.0.0.1`/`localhost` aborted and recorded |
| Actual offline turn | `context.setOffline(true)`; `navigator.onLine === false` |
| Evidence classes | **BROWSER**, **NETWORK**, **LIVE** |

This is a controlled browser-level disconnection, not an OS network namespace. Every non-local request was aborted before it left the browser, and the offline turn also had the browser's offline flag set. The distinction is stated so the result is not overclaimed.

### 7.2 Cold startup with external networking blocked

```text
title:        LÉLU
readyMs:      1878
observedMs:   10143 (includes an 8 s settle wait)
buttons:      37
cloud label:  "Cloud sync off"
```

"Cloud sync off" is the truthful local-only state. No remote provider, CDN or Supabase service was reachable, and LÉLU did not claim one was.

### 7.3 Deterministic operation

A real chat turn asked for a project:

```text
Start a project to map the offline acceptance path.
```

Result:

```text
Project created: Map the Offline Acceptance Path
Objective: Map the offline acceptance path.
Execution:
[Map the Offline Acceptance Path] No results returned after attempting:
hackernews (Failed to fetch); wikipedia (Failed to fetch); youtube (YouTube 503);
gdelt (Failed to fetch); openstreetmap (Failed to fetch); nominatim (Failed to fetch).
(No AI provider was reachable, so this was organised by text parsing.)
```

This is honest deterministic behavior, not model reasoning. The project persisted:

| Item | Value |
|---|---|
| Project ID | `588decce-0aee-458e-b885-7643a8f823c7` |
| Project name | `Map the Offline Acceptance Path` |
| Knowledge nodes | 1 |
| Knowledge edges | 0 in this deterministic path |
| Knowledge revision | 1 |
| Provenance | `local` |

The zero-edge count is reported as it is. The edge case is proven separately by the dispatch script, which adds and reloads an edge.

### 7.4 Reload

```text
reload readyMs:          1488
projectStillPresent:     true
chatStillPresent:        true
knowledgeRevision:       1
```

Local storage keys observed:

```text
lelu.projects.v1
lelu.multichat.workspace.v1
lelu.lelu.cognition.knowledge.v1
lelu.lelu.knowledge.v1
```

### 7.5 Actual offline turn

With `navigator.onLine === false`:

```text
online:             false
projectStillPresent: true
chatCount:          2
```

The identity reply began:

```text
My name is Lélu.
I am your personal AI companion ...
I keep my own persistent memory ... with or without an external AI provider.
```

This is the local identity resolver. It is not evidence of a model call.

### 7.6 Network capture

`blockedExternalCount: 9`, unique hosts:

```text
cdn.jsdelivr.net
hn.algolia.com
en.wikipedia.org
api.gdeltproject.org
api.allorigins.win
nominatim.openstreetmap.org
export.arxiv.org
```

Supabase attempts:

```text
supabaseAttempts: []
```

No `*.supabase.co` or `*.supabase.in` request was attempted. The external attempts were optional knowledge/research/CDN paths; each failed and was reported as unreachable.

Expected console errors included:

```text
Failed to load resource: net::ERR_FAILED
Failed to load resource: net::ERR_CONNECTION_REFUSED
Failed to load resource: ... 503 (Service Unavailable)
[GitHubModelsProvider] Request failed {status: 502 ... BROKER_CONTRACT_VIOLATION}
```

These are provider/CDN failures under blocked networking, not silent persistence failures. The local runtime stayed usable.

### 7.7 Evidence artifact

- `artifacts/m143-offline.json` — `status: PASS`, boot/reload, project, knowledge, offline turn, network capture.
- `artifacts/m143-offline.png` — production UI after the offline identity turn.
- `scripts/verify-m143-offline.mjs` — reproducible harness.

---

## 8. WP04 — persistence and authority integrity

| Authority | Verification | Status |
|---|---|---|
| Identity | local reply after offline; local profile fallback test | **VERIFIED** local |
| Conversations | chat persisted across reload; chat count 2 offline | **VERIFIED** local |
| Projects | created via deterministic path and via dispatcher; both survived reload | **VERIFIED** local |
| KnowledgeGraph | node + edge + revision 2 + `provenance: "local"` survived reload | **VERIFIED** local |
| Cosmos navigation | approved room survived reload | **VERIFIED** local |
| Cosmos spatial records | not exercised in this mission | **NOT STARTED** |
| Forge placements | not exercised in this mission | **NOT STARTED** |
| Neural Map entities | not exercised as a distinct live acceptance path | **NOT STARTED** |
| Cloud copies | no authenticated session | **BLOCKED** |

A persisted `KnowledgeGraph` does not prove complete Neural Map or Cosmos spatial persistence. The table separates them.

Entity IDs remained stable across the observed reload. Knowledge revision advanced from 1 to 2 when the node/edge were added and stayed 2 after reload. `provenance` stayed `local`.

### 8.1 Failure truthfulness

`tests/local-only-operation.test.ts` now proves:

- a write that no backend accepted returns `false`, never a false "saved";
- corrupt persisted JSON returns `null`, not a crash.

This addresses silent persistence success and invalid-persisted-data handling at the canonical `KvStore`.

### 8.2 Storage limitation

The offline test does not simulate a real storage quota exhaustion or an IndexedDB-open failure in Chromium. The failure-return path is covered by **TEST**; it is not claimed as a live quota experiment.

---

## 9. WP03 — authenticated cloud continuity

### 9.1 Mode A: local-only

**VERIFIED.**

- No Supabase environment variables.
- No built-in public credentials.
- No `supabaseAttempts`.
- UI says "Cloud sync off".
- Local runtime operational.

### 9.2 Mode B: explicitly configured

**BLOCKED for live cloud acceptance.**

No authorized test Supabase URL, publishable key or test account was supplied. No production credentials were used. No mock session was substituted.

The existing `tests/local-only-operation.test.ts` covers configured-adapter initialization without writes at the unit level:

```text
a configured Supabase adapter still initializes separately and makes no write
```

Evidence class: **TEST**. It is not an authenticated round trip and is not reported as one.

### 9.3 Supported contracts (code audit, not a live test)

`SupabasePersistence` currently hydrates/writes these existing stores:

| Contract | Remote table | Write shape |
|---|---|---|
| User profile | `user_preferences` (`preference_key = "profile"`) | upsert |
| Projects | `projects` | upsert `(id,user_id)` |
| Conversations | `conversations` | upsert `(id,user_id)` |
| Messages | `messages` | upsert `(id,user_id)` |
| Memories | `memory_items` | upsert `(id,user_id)` |
| Knowledge library | `knowledge_items` | upsert `(id,user_id)` |
| Agents | `agents` | upsert `(id,user_id)` |
| Proactive questions | `proactive_questions` | upsert `(user_id,question_key)` |
| UI state | `ui_state` | upsert `(user_id)` |
| News preferences | `news_preferences` | upsert `(user_id)` |
| API health | `api_health` | upsert `(user_id,provider)` |
| Cognitive events | `cognitive_events` | append-only insert |

Important boundary: the cognition `KnowledgeGraph` at `lelu.cognition.knowledge.v1` is **local-only** in the current architecture. It is not the same store as `knowledge_items`/`KnowledgeLibrary`, and Mission 14.3 did not invent remote synchronization for it.

Mission 14.2's report already recorded that mission-ledger remote sync is gated and not active. That remains true.

### 9.4 Round trips not performed

Not performed because no authenticated session exists:

- authenticate;
- create local record;
- synchronize;
- retrieve through cloud-backed path;
- modify and verify;
- restart and verify identity/record continuity;
- offline modification followed by reconnect;
- duplicate delivery/retry;
- partial sync/interrupted session.

No CLOUD evidence is claimed.

### 9.5 Conflict handling

**NOT STARTED.**

Code audit finding: `SupabasePersistence.write()` uses PostgREST `upsert(..., { onConflict })`. That is a last-writer-wins replacement, not a conditional conflict detector. `persistDevelopmentRecord()` performs a read-merge-write for its specific development-record keys so a device does not overwrite a newer remote copy blindly, but there is no general revision check, merge policy or conflict queue for the cloud-backed stores.

`PersistenceState` has a `conflict` label and the mission ledger has conflict counting, but no cloud conflict-resolution mechanism was exercised or found for `projects`, `conversations`, `messages`, `memory_items` or `knowledge_items`.

Mission 14.3 did not add one: without an authenticated test environment it could not be verified, and the mission explicitly says not to invent synchronization support. This is a documented gap, not a claim of support.

### 9.6 Cloud disconnection and recovery

**BLOCKED.** There was no authenticated cloud session to disconnect, preserve local writes through, reconnect, or reconcile.

`SupabasePersistence.reconnect()` exists and is the intended path. It was not exercised against a real project.

---

## 10. WP05 — regression and performance

### 10.1 Full suite

Command:

```bash
npm test
```

Result:

```text
tests 2253
pass  2243
fail     2
skipped  8
duration 240872 ms
```

Compared with Mission 14.2:

| | Baseline | M14.3 | Delta |
|---|---:|---:|---:|
| Tests | 2251 | 2253 | +2 |
| Pass | 2241 | 2243 | +2 |
| Fail | 2 | 2 | 0 |
| Skipped | 8 | 8 | 0 |

The two failures are the known baseline failures:

1. `tests/genesis-interface.test.tsx` — Excalidraw CSS export.
2. `tests/sandbox-security.test.ts` — network denial returns `''`.

No new failure was introduced by this mission. The full suite exit code is `1` because those two baseline tests fail; that is reported honestly.

### 10.2 Focused suites

Passed:

```text
tests/local-only-operation.test.ts
tests/tool-calling.test.ts
tests/tool-discovery-execution.test.ts
tests/live-cognition-model-loop.test.ts
tests/environment-cognition-live.test.ts
tests/persistence-state.test.ts
tests/mission-security.test.ts
tests/mission-sync-gate.test.ts
```

`tests/local-only-operation.test.ts` now has 7 passing tests, including the two new failure-integrity tests.

### 10.3 TypeScript, lint, build

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 409 warnings |
| `npm run build` | success, 5.57 s |
| `git diff --check` | clean |

### 10.4 Measured timings

| Measurement | Value | Notes |
|---|---:|---|
| Production boot to first cloud-sync control | 1,878 ms | browser-level, blocked non-local network |
| Reload to first cloud-sync control | 1,488 ms | same page, same storage |
| Project dispatch turn | 469 ms | scripted model → dispatcher → `ProjectStore` |
| Sandbox two-turn write/read | 12 ms | scripted model → real `SandboxFS` |
| Approved Cosmos call | 5 ms | second turn only; excludes the pending-approval turn |
| Production build | 5.57 s | `npm run build` |

The boot/reload figures are readiness-to-control, not "the whole app is fully hydrated". The script still waits 8 s afterward before asserting storage, because local hydration is asynchronous.

No cloud reconnect latency is reported because no cloud session existed.

---

## 11. WP06 — security and failure integrity

| Check | Evidence | Status |
|---|---|---|
| No implicit Supabase credentials | `tests/local-only-operation.test.ts`; no Supabase env; `supabaseAttempts: []` | **VERIFIED** |
| No unauthorized tool bypass | `project.apply` refused; unknown tool refused; invalid args refused | **VERIFIED** |
| No accidental remote writes | all non-local requests blocked; no Supabase request | **VERIFIED** local-only |
| No exposed credentials in evidence | secret-pattern scan of new scripts/artifacts | **VERIFIED** |
| No session confusion | local-only boot reports "Cloud sync off"; no cloud identity created | **VERIFIED** local-only |
| No silent persistence success | blocked `KvStore.set` returns `false`; corrupt data returns `null` | **VERIFIED** (TEST) |
| No false cloud-ready status | UI reports local/offline; cloud acceptance marked BLOCKED | **VERIFIED** |
| No unrestricted local execution | autonomy level 3; YELLOW Cosmos action required approval; `project.apply` required auth | **VERIFIED** |
| No privilege escalation offline | offline turn used local identity and local tools; no cloud grant | **VERIFIED** |

The Mission 14.2 intentional boundary remains: applying or committing to a **real** project requires an authenticated Supabase identity. Local sandbox work does not.

---

## 12. Acceptance matrix

| Objective | Required evidence | Status | Evidence |
|---|---|---|---|
| Cognition-to-tool execution | live end-to-end trace | **VERIFIED** | `BROWSER` + `DISPATCH`: scripted model → `ProviderResolver` → `dispatchToolCall` → real executors; results returned to next turn. Not remote-model reasoning. |
| Local deterministic operations | real application execution | **VERIFIED** | `LIVE`: offline project creation and identity reply in production build. |
| Authorization integrity | allowed and denied operations | **VERIFIED** | `DISPATCH`: approved Cosmos room; `project.apply` refused without session; unknown tool/invalid args refused. |
| Offline cold startup | actual disconnected browser | **VERIFIED** | `BROWSER` + `NETWORK`: every non-local host aborted; offline flag set; 1,878 ms to control. Browser-level, not OS namespace. |
| Offline persistence | actual writes and reload | **VERIFIED** | `BROWSER`: project, chat, knowledge revision 1 survived reload; chat count 2 offline. |
| Cosmos persistence | canonical object reload | **VERIFIED** | `DISPATCH` + `BROWSER`: approved room `room-e1b164e9` survived reload. |
| KnowledgeGraph persistence | nodes, edges and revision reload | **VERIFIED** | `BROWSER`: node + `proves` edge + revision 2 + `provenance: "local"` survived reload. |
| Identity continuity | local identity across sessions | **VERIFIED** local | `BROWSER`: identity reply after reload/offline; no cloud identity. |
| Cloud authentication | authenticated test account | **BLOCKED** | No test account or credentials supplied. |
| Cloud synchronization | actual round trip | **BLOCKED** | No authenticated session. |
| Conflict handling | offline/online conflict test | **NOT STARTED** | No conditional conflict detector found; upsert is last-writer-wins. Not simulated. |
| Cloud disconnection | local operations continue | **BLOCKED** | No authenticated cloud session to disconnect. |
| Cloud recovery | supported changes reconcile | **BLOCKED** | No authenticated session; `reconnect()` unexercised. |
| Regression safety | baseline comparison | **VERIFIED** | 2253/2243/2/8; same two baseline failures; +2 new passing tests. |
| Performance | measured timings | **VERIFIED** | See §10.4. |
| Security | no authorization regression | **VERIFIED** local | See §11. Cloud identity boundary not exercised. |

**Overall acceptance: PARTIAL.**

---

## 13. Files added or changed

| File | Purpose |
|---|---|
| `scripts/verify-m143-offline.mjs` | Production-build Chromium harness with every non-local request blocked; real chat/project/reload/offline turn; writes `artifacts/m143-offline.json`. |
| `scripts/verify-m143-dispatch.mjs` | Production `ProviderResolver` + `ToolDispatcher` trace with a scripted model; project, sandbox, Cosmos approval, knowledge edge, denials; writes `artifacts/m143-dispatch.json`. |
| `artifacts/m143-offline.json` | Offline/browser/network evidence (`status: PASS`). |
| `artifacts/m143-offline.png` | Production UI after the offline identity turn. |
| `artifacts/m143-dispatch.json` | Dispatch/authorization/persistence evidence (`status: PASS`). |
| `tests/local-only-operation.test.ts` | Adds blocked-write failure and corrupt-data tests. |
| `docs/missions/MISSION-14.3-INDEPENDENT-RUNTIME-ACCEPTANCE.md` | This report. |

No application source file was changed in Mission 14.3. No dependency was added to `package.json`. The Playwright Chromium binary and its extracted Ubuntu libraries were local test tooling only.

---

## 14. Reproduction

### 14.1 Prerequisites

- Node and project dependencies installed with the existing lockfile.
- A Playwright Chromium browser. In this environment the browser needed local Ubuntu shared libraries extracted under `$HOME/.local/m143-chromium-deps`; this is test-environment setup, not an application dependency.

### 14.2 Dispatch trace

```bash
npx vite --host 127.0.0.1 --strictPort --port 3000
LD_LIBRARY_PATH="$HOME/.local/m143-chromium-deps/usr/lib/x86_64-linux-gnu" \
  node scripts/verify-m143-dispatch.mjs
```

Expected: `status: "PASS"`, all six checks true.

### 14.3 Offline acceptance

```bash
npm run build
npx vite preview --host 127.0.0.1 --strictPort --port 4173
LD_LIBRARY_PATH="$HOME/.local/m143-chromium-deps/usr/lib/x86_64-linux-gnu" \
  node scripts/verify-m143-offline.mjs
```

Expected: `status: "PASS"`, `navigator.onLine === false`, `supabaseAttempts: []`, project/chat/knowledge present after reload.

### 14.4 Focused checks

```bash
node --import tsx --test tests/local-only-operation.test.ts
npm run typecheck
npm run lint
npm run build
```

---

## 15. Remaining limitations

1. **No authenticated Supabase acceptance.** Cloud authentication, hydration, round trip, cross-device continuity, conflict handling, disconnection and recovery remain unverified. This is the largest gap.
2. **No remote model reasoning evidence.** The production path was exercised with a scripted model. The deterministic offline turn is real application behavior but not model cognition.
3. **No general cloud conflict resolution.** The current writer is an upsert/last-writer-wins path. A real conflict policy needs an authenticated, multi-device test and an explicit design; neither exists in this mission.
4. **KnowledgeGraph is local-only.** The cognition graph (`lelu.cognition.knowledge.v1`) is not synchronized by `SupabasePersistence`; `knowledge_items` is a different store.
5. **Cosmos coverage is partial.** Room creation and navigation persistence were exercised. Spatial objects, Forge placements and the full Neural Map were not.
6. **Offline disconnection is browser-level.** Every non-local request was aborted and the browser offline flag was set; this is not an OS network-namespace test.
7. **Storage quota failure is unit-tested, not browser-tested.** The `KvStore` failure return is proven by **TEST**, not by exhausting a real browser quota.
8. **Baseline failures remain.** `genesis-interface.test.tsx` and `sandbox-security.test.ts` still fail exactly as they did in Mission 14.2. They were not hidden or reclassified.

---

## 16. Delivery

- Branch: `mission-14.3/independent-runtime-acceptance`
- Base commit: `4582382`
- Evidence commit: `229a7e1`
- Report commit: this commit
- Push: recorded in the final delivery message after the report commit
- Force-push: none
- Mission 14.2 branch: preserved
- Worktree after report: clean except for the committed Mission 14.3 files

**Final status: PARTIAL. Local independence is proven; cloud continuity is not.**
