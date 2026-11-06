# Phase 0 — Baseline, Reconnaissance and Safety

**Status:** PASS
**Baseline commit:** `62ddd613afbc3cedc3ea4767c471911ea284605b` (= `origin/claude/master-integration` at 2026-11-06)
**Working branch:** `claude/gallant-ritchie-v7i0fn` (the branch this session is authorised to push to; it was created at the same commit as `claude/master-integration`). The directive's suggested name `claude/api-data-ecosystem-integration` was **not** used, because this session may only push to its designated branch.
**Working tree at start:** clean, single worktree.

## 1. Repository state

| Item | Observation |
|---|---|
| `claude/master-integration` HEAD | `62ddd61` "Phase 2 (interim): chat owns the phone on mobile…" |
| Remote branches | 20 |
| Most recently active | `freebuff/1fb0099bf53a9ab2f6fe75bd` (1549194, 2026-11-06), `claude/lelu-continuous-cognition-92p3jy` (b81d159, 2026-11-06), `claude/avatar-3d-world`, `claude/lelu-interface-control-d2sfdl`, `claude/cosmos-chat-experience-z6xja0` (2026-11-05) |
| Open PRs | #7 "Delegation: durable, attributed and resumable agent tasks" (`claude/evolution-delegation` → `claude/evolution-no-tests-in-bundle`) |

**Overlap check.** None of the active branches touches knowledge providers or usage accounting as its subject. This work stays inside `src/providers/`, `src/core/router/ResearchResolver.ts`, `src/core/Endpoints.ts`, and the new `src/core/apiEcosystem/` and `plugins/sourceCatalogApi.ts`. `ResearchResolver.ts` and `Endpoints.ts` are shared hot files, so the changes to them are additive only.

## 2. Measured baseline

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | 879 packages, exit 0 |
| Unit tests | `npm test` | **1366 pass, 0 fail, 4 skipped** (1370 tests, 286 s) |
| Typecheck | `tsc -b --force` | exit 0 |
| Dev server | `vite --port 5173` | ready, page title "LÉLU", no page errors |

## 3. Architecture map (what already exists)

The directive lists several capabilities as things to build that **already exist** in the repo:

| Capability | Existing implementation |
|---|---|
| Knowledge-source abstraction | `src/providers/Provider.ts` (`Provider`, `KnowledgeResult`) and `BaseProvider.ts` |
| Registered knowledge sources (≈33) | `src/core/RegisterProviders.ts`: Wikipedia, Wikidata, Wikimedia, arXiv, Crossref, OpenAlex, GDELT, GitHub, Hacker News, NASA (+8 NASA science APIs), SpaceX, NOAA, NewsAPI, GNews, Guardian, NewsData, Nominatim, OpenStreetMap, Geoapify, Open-Meteo, RSS/Google News, YouTube, Instagram |
| Source selection | `src/core/router/ResearchResolver.ts`: capability-tag scoring (`DOMAIN_CAPS`), a provider `canSearch` fallback, `MAX_PROVIDERS = 4`, a per-provider timeout, and a 20 s phase budget |
| Model-facing research tool | `research.web` and `browser.read` in `src/core/tools/ToolRegistry.ts`, executed by `ToolDispatcher.ts` |
| Endpoint configuration | `src/core/Endpoints.ts`: one registry of base URLs, overridable per environment |
| SSRF-safe server fetch | `plugins/safeFetch.ts`: resolved-address checks, pinned sockets, re-checked redirects, byte caps, deadline |
| Auth and rate gate | `plugins/requestGuard.ts`: Supabase-verified identity, per-user rate limit |
| AI provider chain | `AIRuntime` → `AIProviderRegistry` (records `lastUsage` per provider) → Anthropic, Groq, Cerebras, OpenRouter, Fireworks, Gemini, Mistral, GitHub Models, local |
| Telemetry | `src/core/observability/Telemetry.ts`: spans with redaction and an OTLP export |
| Status UI | `src/app/scene/genesis/GenesisSettingsPanel.tsx` (API Status tab) |

**Gap analysis.** The real gaps are:
1. a **catalog** that describes sources, covering both those LÉLU has and those it could add (auth, cost, limits, decision);
2. **discovery** from the public API catalogs;
3. a handful of **missing free sources** (dictionary, books, currency, earthquakes);
4. **cumulative usage accounting and budgets**: today only the *last* AI usage per provider is kept, and knowledge-source calls are logged but never counted.

## 4. Initial risk register

| Risk | Mitigation |
|---|---|
| Duplicating providers that already exist | Each inventory entry records its `existing` overlap; new providers only fill gaps |
| Discovery becoming an open proxy | Server route behind `requestGuard` (signed-in user, rate-limited), fixed catalog URLs only, fetched through `safeFetch`, cached |
| Catalog text treated as instructions | Parsed as data; length-capped; never concatenated into a system prompt |
| Silent paid fallback | Budgets are hard per-source call caps checked before the call; nothing routes to a paid source automatically |
| Breaking `ResearchResolver` behaviour | Additive changes only; the full suite is re-run each phase |

## 5. Visual evidence

Captured with Playwright (pre-installed Chromium) against `vite` dev at `62ddd61`, 2026-11-06 21:48 UTC.

| File | Viewport |
|---|---|
| [evidence/phase0/baseline-desktop-1440x900.png](evidence/phase0/baseline-desktop-1440x900.png) | Desktop 1440×900, DPR 1 |
| [evidence/phase0/baseline-iphone13.png](evidence/phase0/baseline-iphone13.png) | Playwright "iPhone 13" emulation (390×844, DPR 3) |

Both screenshots show the Cloud Identity sign-in gate that greets a fresh session.

## 6. Implementation-session usage

The environment does not expose token or context counters, so none are reported. Phase 0 used about 25 tool calls, read about 15 files (excerpts), and ran the full test suite and typecheck once each.

**Next:** Phase 1, the research and inventory.
