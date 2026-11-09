# LÉLU V1.1 — Master integration: report (pass 1)

**Overall: NOT COMPLETE.** Phase A (forensics) and Phase B (security) are done. Phase C is
partly done. Phases D–F are **owned by two sessions that are running right now**, and merging
them needs the owner's authorization (§3). Phases G–H are not started. Nothing in this report
is marked verified without the evidence named beside it.

## 1. Initial repository state (measured 2026-11-05 ~20:25Z, not taken from the brief)

| Branch | Head | Owner | State |
|---|---|---|---|
| `claude/cosmos-chat-experience-z6xja0` (this work) | `d077ba9` → now `9b0cd3e` + this report | Session 2/3 (this session) | clean; pushed |
| `claude/avatar-3d-world` | `e39201d` (was `fb6e7a8` in the brief) | Session 1, **running** (phone test after `e39201d`) | 4 new commits: Phase 1A (Workspace/Floating Cosmos switch, evidence), Phase 1B (chat windows are managed module windows `chat:<id>`; they no longer summon the old GenesisChat; they sit above the home outside the Universe) |
| `claude/lelu-interface-control-d2sfdl` | `0b776fc` | a separate session, **running** (live desktop run) | NEW: 5,116-line interface orchestration — design tokens, fonts, spatial layout solver, 3D scene model, environment presets, `InterfaceOrchestrator` (propose → preview → decision → versioned apply, undo/redo, scope policy, stale protection), `interface.*` tools in the existing ToolRegistry, consent bar. Based on the old `d3e6e75`: it has neither Session 1's Phase 1 nor Phase 6. |

The brief's sections 3–4 (Cosmos visual control, preview, approval) are what
`claude/lelu-interface-control-d2sfdl` is building. Sections 5A–5B overlap Session 1's Phase 1B.
**Building either again here would be the duplication the brief prohibits.**

## 2. Branch coordination and integration strategy

Trial merge in a throwaway local worktree, never pushed (`records/trial-merge.txt`):

| Step | Result |
|---|---|
| this branch + Session 1 (`e39201d`) | **clean** |
| … + interface-control (`0b776fc`) | **4 files conflict**, 24 auto-merge: `GenesisModuleHost.tsx` (8 hunks), `GenesisChat.tsx` (5), `GenesisInterface.tsx` (1), `index.css` (1) |

The conflicts are mostly the same lines styled two ways: Session 1's chrome uses `genesisTheme`
values, and interface-control replaced them with CSS variables whose fallback is the old value.
The data attributes also differ (`data-lelu-module-window` vs `data-lelu-window`), and both can be kept.

**Proposed strategy (needs authorization — two of the files are Session 1's active ones):**
1. Wait until both sessions report their current runs finished (their branches stop moving).
2. Create `claude/master-integration` from this branch, merge Session 1 (clean), then
   interface-control. Resolve each hunk by keeping Session 1's behaviour and adopting
   interface-control's variable with Session 1's value as the fallback. Keep both data attributes.
3. Run both sessions' own tests (`interface-orchestration`, the Phase 1 suites) and the full
   typecheck on the merge. Push the integration branch only; neither source branch is touched.
4. Then Phase E: one permission contract over `interface.*` (visual, reversible) and
   `selfdev.*` (source code). These are separate handlers with one audit record and risk class.

## 3. Phase B — Security (done)

**Incident:** `plugins/runtimeKeyBridge.ts` published five data-API keys into every served
page as `window.__LELU_*__`. This happened in the dev server and in the production `server.ts`
(`injectRuntimeKeyBridge`): NASA, Geoapify, GNews, Guardian and NewsData. Separately,
`src/core/env/publicEnv.ts` statically read `VITE_` copies of Guardian, GNews, NewsData and FIRMS,
which a production build inlines into the bundle. The NASA EPIC provider also put `api_key` in
result image links.

**Not exposed:** model keys (Anthropic, Groq, OpenRouter …) already go through the server
broker, and there is no Supabase service-role key on the client (asserted by the scanner). The
Supabase URL and publishable key are public by design and protected by row-level security.

**Remediation (`9b0cd3e`):**
- The existing knowledge relay (`plugins/aiProxyApi.ts`, which already held the NewsAPI, YouTube
  and Meshy keys) now also relays `guardian`, `gnews`, `newsdata`, `geoapify`, `nasa` (with a
  server-side `DEMO_KEY` fallback) and `firms` (key inserted as a path segment). Each is limited
  to its host and path prefix; a client-supplied key is overwritten, and keys are never echoed.
- The five keys are removed from the bridge allowlist. `publicEnv` reads no service key. The
  providers call through `knowledgeFetch`. `canSearch()` reads a cached `/api/knowledge/providers`
  answer, which is booleans only. EPIC links use the keyless `epic.gsfc.nasa.gov`.
- `scripts/verify-bundle-secrets.ts`: the four "known browser-side" keys are now **forbidden**,
  and the bridge is checked for the six unprefixed names.

| Check | Status | Evidence |
|---|---|---|
| Real production build with canary values | TESTED — **ALL BUNDLE SECRET CHECKS PASSED**, 0 failures | `records/bundle-secret-scan.txt` |
| Live dev server: keys that are set (Geoapify, Guardian, NewsData) absent from served HTML; the only remaining bridged value is a base URL | VERIFIED LIVE | §3 command output in this session |
| Relay live: Geoapify 200 with the server's key; NASA 200 via DEMO_KEY; path escape 400 | VERIFIED LIVE | same |
| NewsData | the configured key is **rejected by NewsData (401)** — the key needs checking | same |
| Guardian | could not be reached from this container ("Blocked by egress policy") — environment limit | same |
| Regression tests | TESTED — `knowledge-relay-security` 5/5; `credential-exposure` 6/6, `bare-secret-aliases` 9/9, `broker-*` 26/26, `supabase-config` 9/9, `config-status` 6/6 | |

**Owner actions (not done here):** rotate the Geoapify, Guardian and NewsData keys. They were
readable by anyone who loaded a page from a running LÉLU server. Also check the NewsData key.
No values appear in this report, the commits or any screenshot.

## 4. Phase C — Phase 6 completion and permission model

| Item | Status |
|---|---|
| Phase 6 pipeline (generate → copy → checks → diff → gates → apply → verify → rollback) | IMPLEMENTED, TESTED, VERIFIED LIVE up to the identity gate (`../session-2/phase-6/REPORT.md`) |
| Test A (apply → Integrated) and Test B (apply → Rolled Back) end-to-end | **BLOCKED** — no dedicated test Supabase project or test user exists (only production `nrehsldbfxthspikaxvr`). Rollback mechanics are tested against the real Node adapter. |
| LÉLU cannot raise her own autonomy | TESTED — `tests/permission-contract.test.ts`: only the two owner settings panels (and the self-test, which restores the level) set it; no tool or agentic module does |
| Server-enforced apply (verified identity, explicit confirm, single-use grant bound to that identity, copy-only writes) | TESTED (source contract) + VERIFIED LIVE (apply refused without identity) |
| Autonomy **level** enforced by the server | **NOT IMPLEMENTED.** The level is a per-browser setting. The server enforces identity and grant, not the level. Making it authoritative needs a server-stored per-user setting, changed only through an authenticated owner action with a human-presence step. That's a design decision for the owner (§7). |
| Execution-time identity + permission re-check, retry revalidates | IMPLEMENTED (every apply/retry re-runs the gates; `EngineeringWorkspace.apply` re-checks the grant before writing) |

**Lowest-cost test environment for A/B:** a new **free-tier** Supabase project, if the
organization has a free slot (Supabase branches of the existing project are billed by the
hour). Then one test user, and the test server started with that project's URL and anon key.
Creating either is the owner's call.

## 5. Phase G — Cognition (status check only)

`DailyReflection` **is now wired**: `Bootstrap.ts:198` starts it, `CognitiveLoop.ts` runs due
reflections, and `AgenticTools` exposes it as a tool. The earlier "never called" finding is
resolved. TESTED (`development-loop` 44/44, including "reflection: invoked at the daily
boundary"); not verified live in this pass. Anthropic is the primary provider and was verified
live in Phase 6 (`Anthropic/claude-opus-5-5` generated the change). Nothing else in Phase G
was started.

## 6. Live demonstrations

| Demo | Status |
|---|---|
| 1 Cosmos transformation, 2 window manipulation, 4 integrated intelligence | **NOT RUN** — needs the interface-control work integrated (§2) |
| 3 Self-development | VERIFIED LIVE up to the apply gate (Phase 6) |
| 5 Failure and recovery | Partially VERIFIED LIVE: Failed, Blocked, interrupted-run recovery (Phase 6); Rolled Back BLOCKED (§4) |

## 7. Decisions needed from the owner

1. **Authorize the integration merge** (§2) once both running sessions stop, or tell me to
   coordinate with them first.
2. **Test identity for apply/rollback:** create a free-tier test project (or a billed branch), or
   authorize me to.
3. **Rotate** the Geoapify, Guardian and NewsData keys, and check the NewsData key.
4. **Server-side autonomy:** should the autonomy level become a server-stored, owner-only
   setting? This changes how L5 is granted.

## 8. Commits (this pass)

- `9b0cd3e` Security: data-API keys no longer published into the served page or bundle
- this report + `tests/permission-contract.test.ts` (next commit)

All pushed to `claude/cosmos-chat-experience-z6xja0`. Session 1's branch and the
interface-control branch were not written to.
