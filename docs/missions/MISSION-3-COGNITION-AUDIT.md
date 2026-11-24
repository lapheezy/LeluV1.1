# Mission 3 — Cognition, context and execution audit (first tranche)

2026-11-24 · branch `claude/lelu-voice-https-production-lvv519` (fast-forwarded to integration `cb9aecdb`;
Mission 2 deployment work untouched) · by Claude (coding assistant)

> **Scope honesty.**
> - No screenshots reached the session. The failures were taken from the mission text and traced to code and to
>   production evidence (Supabase logs).
> - Production infrastructure was not modified.
> - No live model was run: the session has no authorized provider key. Every cognition test below is offline and
>   deterministic. Supabase findings come from the **real** production project (read-only) and real HTTP probes.

## 1. Pipeline as it actually runs (text turn)

| # | Stage | Implementation | Connected? | Finding |
|---|---|---|---|---|
| 1 | Ingestion | `GenesisChat.send` → `Orchestrator.process(prompt, undefined, context, conversationId)` | yes | `context` = **cross-chat** research only (`crossChatReference`) |
| 2 | Normalization | prompt/media/files joined in `send` | yes | — |
| 3 | History | **direct path:** `AIService.chat` → `priorTurnsFor` → `resolveTurnHistory` (this conversation only) | yes | **planner path had no history**; `process()` ignores its `_conversationHistory` arg → **fixed** (`conversationSoFar`) |
| 4 | Memory retrieval | `MemoryBridge.enrich` → providers (local brain, Supabase, OG archive) | yes | OG archive swallowed `401 Invalid API key` as "no memories" and retried 2×/turn → **fixed** |
| 5 | Intent | `Orchestrator.classifyIntent/detectCategory` (regex) | yes | multi-step patterns tested the **raw** text → case-dependent routing → **fixed** |
| 6 | Reference resolution | none of its own; relies on history in the model request | partly | conversation references now stay on the history-carrying path and get history tools |
| 7 | Objective extraction / 8 decomposition / 9 planning | `planTask` → `createTask` → `TaskExecutor.run` (multi-step only) | yes | planner now receives the conversation (bounded 4 KB) |
| 10 | Capability selection | `toolSchemasForRequest` → `selectToolSchemas` (≤14 of ~180) | yes | **main root cause** (below) → **fixed** |
| 11 | Agent routing | `agent_delegate` tool, `TaskExecutor` agent steps | yes | not changed |
| 12 | Tool invocation | `ToolDispatcher` (registry ∩ executor ∩ AutonomyGate) | yes | not changed |
| 13 | Results | tool results back into the model loop; `stepActions` report real outcomes | yes | — |
| 14 | Result interpretation | model + `TaskExecutor.report` | yes | — |
| 15 | Memory update | `memory.learn`, `SupabasePersistence` writers | yes | **production writes stopped 22 Nov** (key rejected) |
| 16 | Response | `cleanAssistantText` before display | yes | recognised only 4 tool names as raw markup → **fixed** |

## 2. Root causes (measured)

**A. Capability selection handed turns the wrong tools.** I probed `toolSchemasForRequest` with the full startup
registry (all 15 `register*Tools`, 179 tools):
- "Figure out what we've discussed, identify **blockers** … **find** solutions" was read as a **mission resume**
  (`isMissionResume` matched `blockers` + `find`). It got **only** `mission_list/find/update/brief`.
- "Find out why Supabase isn't working" got `research_web`, `repo_research`, `kb_search`, `browser_*`,
  `cosmos_object_remove`, `world_promote`, `cosmos_object_split`, and no tool that reads her live state.
- "Investigate the production voice failure" got `studio_deploy`, `world_gltf`, `interface_themes`….
- "What can you **actually** do" missed the capabilities family, which matched only the literal "what can you do".
- `cosmos_object_split` outranked relevant tools because its description repeats "out" ("find out").

A model holding only ledger or web-research tools can't look at the conversation or at itself, so it asks the user
which repository or dataset to use. That is the reported failure.

**B. Supabase is rejected, and LÉLU reported it as "signed out".**
- **The project is fine.** Production project `nrehsldbfxthspikaxvr` is `ACTIVE_HEALTHY`, with RLS on every table.
  It holds 4724 messages, 520 memories and 2139 knowledge items.
- **Writes stopped.** The last write to every table was **2026-11-22 15:59 UTC**.
- **Every request is refused.** Edge logs for the last 24 h show every app request answered **401**: 146 from the
  server (`node`), plus Mac Chrome, iPhone Safari and iPhone Chrome. That includes `POST /auth/v1/otp`.
- **The 401 is the key's verdict.** From this session, the project's current publishable key gets 200 on
  `auth/v1/settings` and on REST (`[]` under RLS when anonymous). A wrong key gets exactly
  `401 {"message":"Invalid API key"}`.
- **So the deployment's environment holds a key the project doesn't accept.** The key in
  `src/core/config/supabasePublic.ts` *is* the current valid one; the environment value overrides it.
- **Why nobody saw it.** `SupabasePersistence.initialize()` only calls `auth.getSession()`, which reads local storage
  and never asks the project, so the status settled at `signed_out`.

**C. Raw action JSON as the answer.** `cleanAssistantText` recognised `"tool": "browser|research|instagram|search"`
only.

## 3. Changes (offline-tested; production untouched)

| File | Change |
|---|---|
| `src/core/router/continuationContext.ts` | a resume must name a mission/workstream/ledger/continuity or an `m-…` id |
| `src/core/tools/ToolSchemas.ts` | `SELF_DIAGNOSIS_REQUEST` and `CONVERSATION_REFERENCE` families; capability/free-tools patterns; a relevance floor when a family matched; each description word counted once; "out" as a stopword; ledger pinning only when a mission tool is hinted |
| `src/core/orchestrator/Orchestrator.ts` | lowercase multi-step check; conversation references stay on the history path; the planner receives the conversation (`conversationSoFar`, same source as the direct path, ≤4 KB) |
| `src/core/persistence/SupabasePersistence.ts` | `verifyKey()` asks the project (`GET /auth/v1/settings`, key never logged). It runs right after boot (`AIService`) and before every `self.operational` report (`ContinuityTools`); `initialize()` stays network-free, as `local-only-operation` pins. A rejected key → `degraded` + operator explanation; `getKeyVerdict()` |
| `src/core/memory/providers.ts` | `OgArchiveProvider`: a rejected key → unavailable for the session, `lastFailure()`, no per-turn retries |
| `src/core/cognition/OperationalSelfModel.ts` | `persistence.supabase` claim from the project's answer. Mapping to the requested vocabulary: VERIFIED = live verified, UNAVAILABLE = failed/live unavailable, PARTIAL/REPORTED = unverified/stale, BLOCKED = not configured |
| `src/core/router/ToolMarkup.ts` | `bareActionTool`: a whole-reply action payload naming **any** tool id + arguments is never shown; ordinary JSON is left alone |
| `src/core/cognition/ContinuityTools.ts`, `src/core/AIService.ts` | call `verifyKey()` before reporting / after boot |
| `tests/cognition-context-routing.test.ts` | 15 regression tests for all of the above |

After the change (same probe, full registry):
- **Supabase:** `self_run_status, memory_recall, self_operational, chats_read, self_changes` first, then research as a
  secondary route.
- **Voice:** self-inspection; no deploy or 3D tools.
- **Review / "second thing":** conversation, memory and ledger tools.
- **What can you do:** `self_operational, capability_discover, device_capabilities, tools_catalog`.
- **3D free tools:** `resources_discover/gaps/evaluate/audit`, `tools_catalog`, `world_state`.

## 4. Supabase — required production fix (not performed: production change)

On the VPS, in `/etc/lelu/lelu.env`, both values must belong to the same project:
- `SUPABASE_URL=https://nrehsldbfxthspikaxvr.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_hb-9gS-K2ycoSf-Y6EbUdA_3s-XNeLV`

Both values are public by design. Then remove any stale `SUPABASE_ANON_KEY` / `VITE_SUPABASE_*` duplicates and
`systemctl restart lelu`. The page receives the key at serve time through the runtime bridge
(`__LELU_SUPABASE_PUBLISHABLE_KEY__`), so **no rebuild** is needed. Sign-in links also need
`http://157.173.116.95` (later `https://…`) in the project's Auth → URL configuration redirect allow-list.

## 5. Supabase acceptance (WP06 1–7)

The RLS acceptance transaction is written: create, read, update and delete as user A under RLS; A can't write a row
owned by B; B can't see, update or delete A's row; anonymous sees nothing. It runs against the **test** project
`ugshflwlyakipeduifkd` and rolls back so nothing persists. The Supabase connector paused it for owner confirmation,
which got no answer, so **it has not run**.

Already shown on production: the valid key gets 200, anonymous REST returns `[]` under RLS, and a wrong key gets 401.

WP06 8–9 (application persistence across sessions) need a signed-in session against a project that accepts the key.
They are blocked on §4.

The test project is missing 3 recent migrations (`memory_tombstones` and two execute-lockdown migrations). It no
longer mirrors production's schema.

## 5b. Test results (executed)

- **`npm test`** (3292 tests, run before the `verifyKey` refactor): 3277 pass, 5 fail, 10 skipped.
  - Four failures are pre-existing and unchanged: credential-exposure, foundry-m25c ×2, outfit-switching.
  - The fifth was caused by this tranche: `local-only-operation` pins a network-free `initialize()`, and the first
    version of the probe broke it. Fixed by moving the probe into `verifyKey()`.
- **After the fix:** the persistence/self-model/memory/routing suites (12 files) pass **209/209**, including that
  contract.
- **`npm run build`:** passes after the final change.
- All cognition tests are **offline and deterministic**. The Supabase evidence is **real**: production project
  read-only, plus HTTP probes.

## 6. Not yet done in this tranche

- **Live-model end-to-end runs of scenarios A–F.** No authorized provider key in this session.
- **WP08 execution-lifecycle states.** `TaskEngine` statuses were not extended; the existing ones are
  pending/running/waiting/completed/failed/skipped. That needs its own change with migrations of stored tasks.
- **WP05 Engineering Agent 503 diagnosis.** Not reproduced here (no production access). The diagnosis turn now gets
  the tools that inspect it.
- **WP11 latency measurements.** Need a live runtime. The OG-archive change removes two failing round trips from
  every turn while the key is rejected.
