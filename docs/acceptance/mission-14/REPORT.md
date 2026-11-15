# MISSION 14 — COGNITIVE CONTINUITY (PHASE 0–4 SLICES)

Date: 2026-11-15 (first slice 2026-11-14)
Repository: `lapheezy/LeluV1.1`
Branch: `freebuff/8994d7c2e03123fc8927b6fc`
Starting commit: `1ba90af` ("Finish the inline chat experience: page reading, no pop-ups, 3D files")
Implementation commit: `1227738` ("Add evidence-labelled continuity core: self-model, mission ledger, cognitive pulse")
Worktree: `/workspace/chats/8994d7c2e03123fc8927b6fc` (this chat only; no sibling chat or shared Git config was touched)

Owner: Freebuff (this session)
Objective: make LÉLU able to state what is true about herself with evidence, and stop losing work when a conversation ends — without replacing the existing cognition, event, memory, tool, workspace, Cosmos, Earth or persistence systems.

---

## 1. What was actually built

This is **one coherent slice**: Mission 14 Phase 1 (operational self-model), Phase 2 (Project Brain / Mission Continuity Ledger) and Phase 3 (Cognitive Pulse). Phases 4–9 are mapped to existing code below and remain **PROPOSED** where this session did not change them.

### 1.1 Mission evidence vocabulary — `src/core/operational-intelligence/evidence.ts` (new)

The existing operational model already answers *can this capability run, in what lifecycle state*. Mission 14 asks *how well is this claim supported*. This file is a translation layer, not a second model:

- Labels: `VERIFIED`, `REPORTED`, `PARTIAL`, `BLOCKED`, `UNAVAILABLE`, `PROPOSED`, `SIMULATED`.
- Conservative mapping: operational `AVAILABLE`/`COMPLETED`/`EXECUTING` → `PARTIAL`; `NOT_CONFIGURED` → `BLOCKED`; `UNAVAILABLE`/`FAILED` → `UNAVAILABLE`; only `VERIFIED` maps to `VERIFIED`.
- `redactText()` and `redactLines()` redact credential-shaped strings (provider keys, GitHub tokens, JWTs, bearer headers, `password=` pairs) **before storage**, shared by the ledger and pulse.

Evidence status: **VERIFIED** by `tests/mission-continuity.test.ts` (mapping + redaction cases).

### 1.2 Operational self-model — `src/core/cognition/OperationalSelfModel.ts` (new)

A pure assembler over existing singletons. It owns no state and writes nothing, so it cannot become a fourth self-model beside `SelfModel` (narrative) and `OperationalModel` (capability lifecycle).

It reads and labels:

| Question the directive asks | Source | Evidence |
|---|---|---|
| Who/what she is | `SelfModel.identity` | `REPORTED` |
| Cognition, memory, models, agents, tasks | `CapabilityManifest` | per capability: `VERIFIED` only with a recent real success, else `PARTIAL`/`BLOCKED` |
| Tools / capabilities | `ToolRegistry` | `PARTIAL` (registered ≠ executed) |
| Skills | `SkillRegistry` over `.agents/skills` | **`PARTIAL`** — 2 real bodies catalogued, **0 invocable** (authoring guidance, not an executor) |
| Agents | `AgentStore` | `PARTIAL` |
| Applications | `homeCatalog.APPS` | `REPORTED` |
| Workspaces | `WorkspaceEngine.getState()` | `VERIFIED` (live read) |
| Projects | `ProjectStore` | `VERIFIED` |
| Runtime, connectivity, resources | `SystemEnvironment` | `VERIFIED` from browser APIs |
| Permissions | `AutonomyGate` | `VERIFIED` |
| Intentions, blockers, hypotheses | `SelfModel` goals/unfinished/limitations/hypotheses | `REPORTED`/`UNAVAILABLE`/`PROPOSED` |
| Workstreams | `MissionLedger` | `VERIFIED` |
| Recent failure/degradation | `CognitivePulse` | `PARTIAL`/`BLOCKED` by severity |

Each source read is isolated. A source that throws becomes an `UNAVAILABLE` claim plus a `sourceFailures` entry; the rest of the snapshot still renders.

Evidence status: **VERIFIED** (unit tests with injected sources, including a throwing source) and **VERIFIED in browser** (Continuity tab, screenshot below).

### 1.3 Mission Continuity Ledger — `src/core/projects/MissionLedger.ts` (new)

Durable workstream records, offline-first through the shared `KvStore`:

- Fields: title, objective, owner, status (`active|paused|blocked|completed|abandoned`), evidence label, repository/branch/commit, files, decisions, dependencies, blockers (raise/clear with timestamps), next safe action, provenance, bounded log.
- Honest durability: `KvStore.set()`'s boolean is respected. If storage refuses the write, records report `memory-only` — never `persisted`.
- Secret redaction on every free-text write.
- Bidirectional-sync foundation: `export()` and `mergeRemote()`, newer-`updatedAt` wins, absence never deletes, mirroring `ProjectStore.mergeRemote`.
- `resumeBrief()` returns open workstreams with blockers and next safe actions — the thing a new session reads first.

Evidence status: **VERIFIED** (unit tests: reload, blocker lifecycle, merge, redaction, refused write) and **VERIFIED in the live browser** (record `m-e2067b75`, `durability: persisted`, rendered in the Cognition panel).

### 1.4 Cognitive Pulse — `src/core/cognition/CognitivePulse.ts` (new)

A bounded reducer over the **existing** `AgentEventBus`:

- Subscribes once; `start()` is idempotent; `stop()` really unsubscribes.
- Records only operational changes: task/agent/tool failure, task/agent completion, provider failure/fallback, approvals, workspace open/minimize, meaningful cognition stages, failed execution evidence.
- No timer, no polling, no emission back onto the same bus.
- Deduplicates identical fingerprints inside a 20 s window; in-memory cap 120; persisted digest cap 40; secret-redacted summaries.
- `digest()` is prompt-safe and states an empty digest honestly.

Evidence status: **VERIFIED** (mapping, dedupe, bounded cap, persistence, redaction) and **VERIFIED live**: the browser showed 16 real recorded events (5 attention) from the running app's own provider and task lifecycle.

### 1.5 Continuity tools — `src/core/cognition/ContinuityTools.ts` (new)

Five tools registered through `registerExecutor()` + `ToolRegistry`, i.e. the existing dispatcher, autonomy gate, approval path and activity timeline:

| Tool | Risk | Purpose |
|---|---|---|
| `self.operational` | 0 | Evidence-labelled operational self report |
| `mission.list` | 0 | Open/closed workstreams |
| `mission.record` | 1 | Open a durable workstream (local state only) |
| `mission.update` | 1 | status / evidence+basis / next / blocker / clear-blocker / file / decision / note |
| `mission.brief` | 0 | Resume brief, or one workstream in full |

Unknown missions are refused with "Nothing changed"; writes always report durability. No network, repository or production action is reachable from these tools.

Evidence status: **VERIFIED** (registered + executable in the dispatcher; executors exercised in tests).

### 1.6 Wiring and surface

- `src/core/Bootstrap.ts`: registers continuity tools and starts the pulse once, after Cosmos tools. Registration failures are logged, not hidden.
- `src/app/scene/genesis/GenesisCognitionPanel.tsx`: new **Continuity** tab showing evidence counts, claims with sources, per-provider broker observations (availability, last success, last failure), open workstreams (status/evidence/durability/next safe action/blockers) and the live pulse digest. The self-model is assembled on tab open or on "Read now", not polled.

### 1.7 Next slice — real conversation, provider health, recovery, skills

This slice did not rebuild the continuity foundation. It exercised it and fixed what the exercise exposed.

#### 1.7.1 A real signed-in conversation

Turn 1 (real model, real dispatcher, no injected fixture):

| Step | Observed |
|---|---|
| Inspect | `self.operational` returned `13 verified · 4 reported · 16 partial · 0 blocked · 5 unavailable` (38 claims). |
| Create | `mission.record` created `m-406ecd7d`, title "Mission 14 conversational proof", `durability: persisted`. |
| Reply | The model reported the real id and counts; no invented result. |

Turn 2 (a second real turn, same conversation): `mission.update` ran three times and the persisted record changed at 01:02:30–01:02:36 UTC: decision `chat tool loop works end to end`, blocker `providers are rate limited`, next action `read the resume brief and continue`. The final assistant text for that turn never arrived because both remote providers were rate-limited mid-loop. The state change is real; the missing reply is not presented as success.

**Defect found and fixed:** the turn where the model said it lacked `mission_update` was not a model lie. A real turn log showed only a subset of tools offered. `src/core/tools/ToolSchemas.ts` now pins the five continuity tools as one family when a turn is about continuity, so the model sees the whole family (tested).

#### 1.7.2 Provider health from the existing broker

`plugins/modelApi.ts` now records, server-side, `lastSuccessAt` (only on a real 2xx completion), `lastFailureAt`, `lastFailureStatus` and `lastFailureNote`; a 2xx whose body is not a completion deletes the success it briefly recorded. `ProviderHealth.ts` gained a separate `BrokerHealth` reader (not a second provider registry) that persists the `/api/model/status` observation in `lelu.provider-health.v1`. The Continuity tab renders each provider with availability, last success and last failure.

Live observation from this run (no keys shown):

| Provider | State | Evidence |
|---|---|---|
| `openrouter` | `COMPLETION_VERIFIED` | last success 20:06:43; later 429s recorded as failures, so it is not called healthy now |
| `groq` | `CONFIGURED` | no success observed after restart; last failure HTTP 429 (daily token cap) |
| `githubModels` | `CONTRACT_VIOLATION` | HTTP 200 `text/plain` body, correctly refused as not-a-completion |
| `anthropic`, `cerebras`, `fireworks`, `gemini`, `mistral` | `UNCONFIGURED` | **blocked**, not "ready" |

**Defect found and fixed:** `BrokerHealth` stored the global `fetch` and called it as a method; in the browser this threw `Illegal invocation`, so every probe stored an empty provider list. It now binds the function. The screenshot below is from the fixed path.

#### 1.7.3 Runtime skills — a real catalogue, not an executor

`src/core/skills/SkillRegistry.ts` reads the actual `.agents/skills/*/SKILL.md` bodies through Vite's raw glob at build time and parses name/description/source. Every entry is `invocable: false` with a stated reason: the body is authoring guidance and no dispatcher executor is registered for it. Nothing was invented.

Live self-model claim (read in the page):

```
[PARTIAL] 2 runtime skill(s) catalogued from .agents/skills; 0 invocable.
Catalogue: supabase, supabase-postgres-best-practices.
```

Under a plain Node runner Vite's glob is absent, so the catalogue is honestly empty and the self-model returns to `UNAVAILABLE`; the verification script asserts both behaviours and parses a fixture `SKILL.md`.

#### 1.7.4 Interruption and recovery

After the conversational turn, the page was reloaded and a fresh browser tab was opened. `m-406ecd7d` was still present in `lelu.lelu.missions.v1` with `durability: persisted`, its decision, its blocker and its next action. The real dispatcher then ran `mission.brief` against that persisted record after reload:

```
Mission 14 conversational proof (m-406ecd7d)
  status: blocked · evidence: REPORTED · owner: lelu
  objective: Prove the continuity tools work in a real conversation
  next safe action: read the resume brief and continue
  blockers: providers are rate limited [REPORTED]
  decisions: chat tool loop works end to end
  durability: persisted · updated 2026-11-15T01:02:36.762Z
```

That is the saved state, including completed vs unfinished work and the next safe action. **Not verified at that time:** a model-authored resume sentence in a new conversation. Every remote provider was out of free quota at that point (`429`), so the local fallback replied without tools. This is recorded as **BLOCKED**, not as a pass. (Superseded by the §11 follow-up, where the remote Groq model completed the resume.)

---

## 2. Reuse decisions (nothing replaced)

| Existing system | Decision |
|---|---|
| `AgentEventBus` | Reused as the only event transport; no second bus, no polling. |
| `CapabilityManifest` | Reused as the capability source; its lifecycle is translated, not duplicated. |
| `ToolRegistry` + `ToolDispatcher` | Reused as the only registration/dispatch path. |
| `KvStore` | Reused as the only persistence layer; durability honesty preserved. |
| `SelfModel` | Kept as the narrative self; the operational model composes it. |
| `ProjectStore` / `ProjectMission` | Kept as project contents and north star; the ledger adds workstream continuity, not a second project store. |
| `WorkspaceEngine`, existing panels | Untouched; the new tab lives in the existing Cognition panel. |
| `ExecutiveBoard`/SHAMAN/agents | Untouched. No agent was recreated. |

No LangGraph/LangChain. No Anthropic call. No paid dependency added. No LiveKit/voice file touched. No production self-modification.

---

## 3. Files changed

New:
- `src/core/operational-intelligence/evidence.ts`
- `src/core/skills/SkillRegistry.ts` (read-only runtime catalogue)
- `src/core/projects/MissionLedger.ts`
- `src/core/cognition/CognitivePulse.ts`
- `src/core/cognition/OperationalSelfModel.ts`
- `src/core/cognition/ContinuityTools.ts`
- `tests/mission-continuity.test.ts`
- `scripts/verify-mission-continuity.ts`
- `docs/acceptance/mission-14/REPORT.md` (this file)
- `docs/acceptance/mission-14/continuity-evidence.json` (generated)

Modified:
- `src/core/Bootstrap.ts` (imports; registration + pulse start + broker refresh)
- `src/app/scene/genesis/GenesisCognitionPanel.tsx` (Continuity tab, provider rows)
- `src/core/model/ProviderHealth.ts` (broker reader; bound `fetch`)
- `src/core/tools/ToolSchemas.ts` (continuity tool family pinned per turn)
- `src/core/cognition/OperationalSelfModel.ts` (provider/skills claims)
- `plugins/modelApi.ts` (server-side last success/failure timestamps)
- `tests/mission-continuity.test.ts` (16 tests)
- `scripts/verify-mission-continuity.ts` (broker/skill checks)

No existing file was deleted, renamed or overwritten destructively.

---

## 4. Verification actually run

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b --force` | **exit 0** |
| Lint | `npx oxlint` | **0 errors**, 168 pre-existing warnings; no warning in the new files |
| Build | `npm run build` | **exit 0**, built in 5.92 s |
| Focused tests | `npx tsx … --test tests/mission-continuity.test.ts` | **16/16 pass**, exit 0 |
| Full suite | `npm test` | **2188 pass / 2 fail / 8 skipped of 2198**, exit 1 |
| Lint | `npx oxlint` | **0 errors**, 169 warnings (pre-existing style warnings) |
| Follow-up suite (14.2 + 14.1 fixes) | `npm test` | **2198 pass / 2 fail / 8 skipped of 2208**, exit 1 — same two failures |
| Follow-up lint/build (14.2) | `npx oxlint`; `npm run build` | **exit 0** (409 warnings, 0 errors); **exit 0**, built in 6.00 s |
| Verification script | `npx tsx scripts/verify-mission-continuity.ts` | **16/16 checks pass**; JSON regenerated |

### The two full-suite failures (not caused by this change)

1. `tests/genesis-interface.test.tsx` — `ERR_PACKAGE_PATH_NOT_EXPORTED`: `@excalidraw/excalidraw/index.css` is not exported by the installed package (`DrawingEditor.tsx`). This is dependency/export resolution in an untouched module; the repo already records this test as environment-limited in `docs/RECOVERY_REPORT.md:333`.
2. `tests/sandbox-security.test.ts` — "network: TCP, UDP, DNS and fetch all fail": expected `denied:` but the sandbox returned an empty string. The sandbox network namespace in this VM differs; no changed file is in that path.

Both are reported as **failures observed**, not as passes and not as verified fixes.

---

## 5. Live-browser evidence

Dev server: Vite on `0.0.0.0:3000`, served through the VM preview hostname. The app booted (`[data-lelu-home]`), the home rendered, and the Cognition panel was opened through the existing command palette.

- `artifacts/mission-14/baseline-home.png` — app boot, sign-in card, home.
- `artifacts/mission-14/continuity-tab.png` / `continuity-tab-clean.png` — **Continuity** tab live: `VERIFIED 12 · REPORTED 3 · PARTIAL 16 · BLOCKED 0 · UNAVAILABLE 6 · PROPOSED 0 · SIMULATED 0`.
- `artifacts/mission-14/continuity-missions.png` — **MISSION CONTINUITY · 1 OPEN**, with the real record `Mission 14 — cognitive continuity`, status `ACTIVE`, evidence `REPORTED`, durability `persisted`.
- `artifacts/mission-14/continuity-ledger-pulse.png` — **COGNITIVE PULSE — 16 recorded (5 need attention, 0 critical)**, including real provider failures and self-study task completions from the running app.

The ledger record was created by dynamically importing the real `MissionLedger` module **inside the page**, not by writing localStorage by hand. `resumeBrief()` returned:

```
MISSION CONTINUITY — 1 open workstream
- [ACTIVE · REPORTED] Mission 14 — cognitive continuity (m-e2067b75)
  objective: Evidence-labelled self-model, durable mission ledger and bounded cognitive pulse, wired into the existing runtime.
  next safe action: review the report, then run the signed-in acceptance pass
  where: lapheezy/LeluV1.1 @ freebuff/8994d7c2e03123fc8927b6fc (1ba90af)
```

### 5.1 This slice's screenshots

- `artifacts/mission-14-next/chat-turn1.png` — the real Chat Universe turn: user prompt, "2 tools used", and the continuity prompt in the thread.
- `artifacts/mission-14-next/continuity-providers.png` — Continuity tab after the fetch fix: `OPERATIONAL SELF · EVIDENCE-LABELLED`, counts, and the real `PROVIDERS · OBSERVED` rows (`openrouter COMPLETION_VERIFIED`, `groq CONFIGURED` with a 429 failure, `githubModels CONTRACT_VIOLATION`, unconfigured providers `blocked`).
- `artifacts/mission-14-next/boot.png` — page state used for the first turn (browser-only visual anomaly in this VM; it is not evidence of the app's normal render).

The screenshots are of the real page. The chat-turn1 image was reviewed and shows the tool activity, not the whole final answer; the answer text itself is quoted in §1.7.1 from the live DOM. The provider image was reviewed after the fix.

Console/network during the run: no page error from the new code. Pre-existing 403s on `manifest.webmanifest` and 503s on `/api/engineer/status` remain (the engineering runtime is not running in this VM); they are not claimed as working.

---

## 6. Mission 14 phase map — honest status

| Phase | Status | Evidence / existing implementation |
|---|---|---|
| 0 — Inspect architecture, branches, worktrees | **VERIFIED** | This worktree at `1ba90af`; own branch; no sibling worktree touched. Existing map in `docs/audit/EXISTING_CAPABILITY_INVENTORY.md`. |
| 1 — Operational self-model | **VERIFIED** | `OperationalSelfModel` + 7 evidence labels + live browser tab. Broker-observed provider health is recorded with per-provider timestamps; `CONFIGURED` is never reported as working. |
| 2 — Project Brain + Mission Continuity Ledger | **VERIFIED** (ledger + resume brief); **PARTIAL** (broad project graph) | Ledger persists workstreams, files, decisions, blockers, next actions. A repository/branch/commit graph is recorded per mission but not automatically crawled. Existing project/agents/tasks stores were reused. |
| 3 — Cognitive Pulse / event-driven awareness | **VERIFIED** (bounded) | Existing `AgentEventBus` reducer, dedupe, persistence, live 16-event digest. No polling, no fabricated background awareness. |
| 4 — Skill/capability/application/workspace registries | **PARTIAL** | Tool registry, capability manifest, app catalog and workspace state are distinguished in one self-model. **Skills:** a real, read-only catalogue of 2 bodies exists; **0 are invocable**, and the claim states that limit. No competing registry was created. |
| 5 — Persistent Workspace Runtime | **NOT CHANGED / PARTIAL** | Existing `WorkspaceEngine` and module host remain authoritative; the self-model reads live panes. Multi-pane persistence already exists; it was not duplicated. |
| 6 — Cosmos Composition Engine/Forge | **PROPOSED** | Existing `core/cosmos`, `core/forge`, `WorkspaceAPI` are the foundation. No composition pipeline was implemented this session. |
| 7 — Earth Core | **PROPOSED** | Existing `core/earth` and `core/spatial` remain; no second spatial engine built, no `three-live` adoption. |
| 8 — Eagle Eye capability absorption | **PROPOSED / UNVERIFIED** | Repository identities and licences below; no code extracted. |
| 9 — Offline-first iPhone continuity | **PARTIAL (foundation only)** | `KvStore` is offline-first; ledger supports export/merge. No device sync, conflict resolution UI or snapshot recovery was added this session. |

---

## 7. External candidate research (no adoption in this slice)

| Candidate | Verified finding | Decision |
|---|---|---|
| `google/three-live` | Apache-2.0; created 2026-10-02; v1.3.1 on 2026-11-07; **beta**, explicitly "not an officially supported Google product"; compiles Three.js to WebGL2/WebXR/Filament/RealityKit. | **Not adopted.** It is a compiler/runtime, not a scene-graph replacement; adopting it now would duplicate the existing R3F scene. A future spatial pilot is reasonable. |
| `worldmonitor` | Source is **AGPL-3.0-only**; hosted service and outputs have separate commercial terms; trademark policy. | **Not imported.** AGPL obligations are incompatible with silent absorption into a proprietary app without a legal decision. Patterns only, no code. |
| `tldraw` SDK | Source-available **tldraw license**, not MIT/Apache. Production requires a licence key; hobby licence keeps the watermark; commercial licence is paid. | **Not adopted.** Existing Excalidraw/Mermaid/React Flow cover the canvas/graph needs; a paid licence is an owner decision. |
| Cate, Async IDE, Copse | No authoritative repository/licence verified in this session. | **UNVERIFIED — no claim, no adoption.** |
| Bitwise-01 / EdmondEdwards Eagle-eye | Repository identity, licence and functionality were **not verified** here. | **UNVERIFIED — no code imported, no capability claimed.** |

No monitoring, tracking or private-surveillance capability was added.

---

## 8. Security, permissions and limits

- All new writes are local (`KvStore`) and secret-redacted before storage.
- No new network endpoint, no credentials, no shell execution, no production modification.
- Continuity tools are risk 0/1, so the existing autonomy gate and approval machinery apply unchanged; nothing bypasses it.
- A refused storage write is surfaced as `memory-only`, never as durable.
- The pulse never emits onto the bus it listens to; listener exceptions are contained.
- No destructive Git operation was performed; the branch is this chat's own.

---

## 9. Remaining gaps and next safe actions

1. **Skills are catalogued but not invocable** (`PARTIAL`). Next safe action: define one runtime skill contract and register an executor per skill deliberately; do not mark existing bodies as runnable.
2. **Project graph breadth is narrow.** The ledger records repo/branch/commit per workstream but does not crawl branches, worktrees or commits automatically. Next safe action: a read-only repository indexer feeding the ledger, with explicit paths and no writes.
3. **Provider capacity, not provider health, blocks the conversational resume.** `/api/model/status` is now live and timestamped; every configured remote provider was out of free quota during the final pass. Next safe action: retry the resume turn when quota is available, or add a genuinely local completion model; do not weaken the 429 handling.
4. **Offline sync/recovery** is foundation-only (`export`/`mergeRemote`). Next safe action: wire the existing Supabase persistence and define conflict UI before claiming cross-device continuity.
5. **Cosmos/Forge, Earth Core, Eagle Eye** remain `PROPOSED`; each needs its own reviewed slice and licence decision.
6. **Two full-suite failures** are environment/dependency issues in untouched paths; neither is fixed or hidden here.

---

## 10. Evidence labels for this report

- `VERIFIED`: typecheck, lint, build, focused tests, browser boot, Continuity tab, persisted ledger record, live pulse digest, real inspect/create/update turns, persisted `mission.brief` after reload, two catalogued skill bodies, bound broker probe.
- `PARTIAL`: provider availability over time (real 2xx then 429), skills (catalogued, not invocable), project-graph breadth, offline sync foundation.
- `BLOCKED` at the time: model-authored resume reply in a fresh conversation (every configured remote provider returned 429 during that pass). Superseded by the §11 follow-up: **VERIFIED** with remote Groq.
- `UNAVAILABLE`: any invocable skill executor (the catalogue is read-only); live engineering runtime (`/api/engineer/status` 503).
- `PROPOSED`: Cosmos Composition Engine, Earth Core adoption, Eagle Eye absorption, full offline sync.
- `SIMULATED`: nothing in this slice is presented as live; tests use injected event buses and in-memory stores only where stated.

---

## 11. Follow-up slices — Mission 14.1 and 14.2 (2026-11-15)

### Mission 14.1 — cross-conversation resumption: **BLOCKED earlier → VERIFIED on follow-up**

The first attempts are preserved as **BLOCKED**: a genuinely new conversation reached the ledger, but the final answer came from local fallback, selected the active duplicate `m-4863de4f`, and never called `mission.brief` on `m-406ecd7d`. Two retries were stopped by Groq's 8,000 TPM limit and `tool_use_failed`.

The follow-up fixed duplicate identity (`m-4863de4f` is now `abandoned`/`duplicateOf m-406ecd7d`), added `mission.find` with id/status/project/provenance ranking, routed resume turns to the provider with only the four mission tools, flattened tool history on no-tool final rounds, and stripped the non-evidence self-state from resume requests. In conversation `4903d20a-4cbb-4389-a441-16ac463ed39a` the remote **Groq** model called `mission.find → mission.brief → mission.update` on `m-406ecd7d`, reported the blocker and next action, and persisted the note `Attempted to continue but providers are rate limited`; it survived reload. See [`CROSS_CONVERSATION.md`](CROSS_CONVERSATION.md) and `artifacts/mission-14-next/cross-conversation-success.json`.

### Mission 14.2 — provider resilience: **PARTIAL**

The broker now learns per-credential reset windows from body text, `Retry-After` and `X-RateLimit-Reset`, refuses a fully cooling provider without another upstream call, exposes the reset window in status, removes it from the offered chain, and clears cooldowns on a real 2xx. Live: OpenRouter's second request was served locally with a 29,334 s reset; Groq returned a real 200 and `COMPLETION_VERIFIED`. The follow-up also converts tool history to plain evidence on no-tool final rounds, counts provider context in the request ceiling, and narrows a resume turn to the four mission schemas. A real tool-enabled conversation then completed after an OpenRouter→Groq switch; long-window OpenRouter recovery remains unobserved. See [`PROVIDER_RESILIENCE.md`](PROVIDER_RESILIENCE.md).

### Mission 14.1 final review hardening — **VERIFIED**

The final review did not trust the report or the earlier test counts. It found and fixed six real defects: final-round tool results lacked a final trusted guard; the request budget omitted tool-call metadata; the fitter could drop the materialized prompt while suppressing the provider append; local edits could retain a `synchronized` label; create-time duplicate chains were not canonicalized and provenance/repository fields were not redacted; and the claim-grounding negation filter treated `0 failed` as a negation. The rerun used three genuinely new conversations with no mission id; each resolved `m-406ecd7d`, read the brief where asked, and persisted a distinct note through `mission.update`. After a full reload the latest note, `blocked` status, `next: continue`, `durability: persisted`, `sync: local` and the duplicate relationship all survived. Exact raw argument JSON remains **PARTIAL** because the runtime intentionally does not persist it. Full suite: **2215 pass / 2 fail / 8 skipped of 2225**; the two failures reproduce on detached `97fe447`. See [`CROSS_CONVERSATION.md`](CROSS_CONVERSATION.md) and `artifacts/mission-14-next/hardened-live-acceptance.json`.

No branch was merged. Phase 6–9, voice and the mobile runtime were not touched.
