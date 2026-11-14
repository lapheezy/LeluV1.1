# LÉLU Global Mission — Zero-Unauthorized-Spending, Tool-First Execution & Quality Consent

## 1. Branch and starting commit
- Branch: `claude/lelu-integration-performance-eai80a` (mirrored to `integration/lelu-four-workforce-consolidation`)
- Starting commit: `6315acf` (baseline 2,108 pass / 0 fail / 6 skipped, typecheck 0, lint 0)

## 2. Files changed
Server: `plugins/spendPolicy.ts` (new), `plugins/modelApi.ts`, `plugins/voiceApi.ts`, `plugins/meshyForgeApi.ts`, `plugins/aiProxyApi.ts`, `server.ts`, `vite.config.ts`, `.gitignore`.
Client/runtime: `src/core/spend/SpendConsent.ts` (new), `src/app/scene/genesis/GenesisChat.tsx`, `src/core/voice/VoiceEngine.ts`, `src/core/Environment.ts`, `src/core/ProviderModels.ts`, `src/providers/OpenRouterProvider.ts`, `src/providers/LeluSystemPrompt.ts`, `src/core/router/ProviderResolver.ts`, `src/core/router/continuationContext.ts` (new), `src/core/router/partialWork.ts` (new), `src/core/router/qualityCheckpoint.ts` (new).
Layout: `src/app/scene/spatial/SpatialNavigator.tsx`, `src/app/scene/spatial/SpatialPortals.tsx`, `src/app/scene/genesis/home/CosmosHome.tsx`, `src/app/scene/genesis/home/homePresence.ts` (new).
Tests: new `spend-policy`, `continuation-context`, `partial-work`, `quality-checkpoint`, `home-layout-overlap`, `support/spendAuthorized.ts`; updated paid-path suites to grant explicit test authorization.

## 3. Enforcement
- One server-side policy (`plugins/spendPolicy.ts`) is checked at every paid boundary: model broker (all providers), ElevenLabs TTS/STT, Meshy Forge job approval, AI proxy relays. Requests are refused with HTTP 402 `spend_not_authorized` / `grant_exhausted` **before anything is sent upstream**.
- Default: zero spending. Known-free services (Groq, Cerebras, GitHub Models, Firecrawl, VoxCPM, local, news/geo APIs) pass; OpenRouter passes only for `:free` models; everything else, including unknown services, is treated as paid.
- A key being present, a provider being reachable, or free capacity being exhausted never authorizes paid use. The OpenRouter default model is now a `:free` model.
- Authorization only from the user's own typed or spoken words (`x-lelu-user-consent: typed|spoken`, same-origin, parsed server-side). Grants are scoped to service/model/operation with a request cap (default 40), optional dollar cap, and expiry (default 2 h, max 24 h). "Stop all paid usage" revokes. Agents, tools, background jobs and model output have no path to create a grant (source-scan test).
- Every allow/deny is audited (`.lelu-state/spend`, gitignored; no secrets). `/api/model/status` reports paid providers as `SPEND_NOT_AUTHORIZED`.
- Live check (earlier in this mission): Anthropic 402; OpenRouter paid model 402 "nothing was sent"; OpenRouter `:free` OK at cost 0; agent-origin consent 403.

## 4. Token reduction (same 3D prompt, production build, measured request bytes)
| | Before | After |
|---|---|---|
| Avg continuation round | 24,824 B | 17,132 B (−31%) |
| Whole tool turn | 148,995 B | 110,916 B (−26%) |
| Groq tokens requested per round | ~5,800–6,000 | ~3,950–4,100 |

Cause: LÉLU's 12.5 KB self-description was re-sent on every tool round. Continuation rounds now drop only known self-description sections; safety and task sections are kept. The partial-work report and quality checkpoint add zero model calls.

## 5. Jobs that complete without LLM inference
Time/date answers, identity questions, device-capability status, spend consent parsing and grants, provider/spend status, Firecrawl browse fallback, every tool execution itself (drawing, world objects/rooms, browse, files), the **partial-work report** when a provider fails after tools ran (each step, its own result line, what still needs reasoning — and no paid fallback), and the **quality checkpoint**.

## 6. Quality checkpoint
Reads the tool calls' own arguments, no model and no cost:
- Drawings with fewer than 6 elements (15 if "detailed/realistic" was asked) are flagged.
- A complex subject (statue, animal, car, person…) placed as a single primitive is flagged as a stand-in; several primitives count as an assembly.
- Rooms with fewer than 3 furnishings are flagged.
During the turn, the note is added to that tool's result so the model can improve it with the same free tools. If it is still deficient at the end, the reply says so, gives the free next step, and only **offers** the paid route (stronger model, or a Meshy mesh), stating it has not been used and needs explicit go-ahead.

## 7. Home layout (Priority D)
- Desktop: the Spatial menu opened by default and covered Notifications/App Library. It now starts collapsed, opens on tap, and closes on an outside tap — verified on desktop 1440×900 and iPhone 13 (`closed → open → closed`).
- iPhone: Cosmos portal name chips showed through the home's glass cards; they are hidden while the home is in front and return in the Cosmos view.
Screens: `screens/home-desktop.png`, `screens/home-iphone.png`, `screens/menu-open-*.png`.

## 8. Contabo (Priority E)
Unchanged and still blocked: no SSH key or host access in this environment, no domain, no LiveKit credentials. Nothing was purchased, upgraded or deployed.

## 9. Test results
- Typecheck: 0 errors. Lint: 0 errors (pre-existing warnings in archived acceptance scripts only).
- Full suite: **2,136 tests — 2,130 pass, 0 fail, 6 skipped** (baseline 2,108 pass; +28 new tests).
- Covered: paid provider refused without authorization; paid fallback refused when free is exhausted; grants only within service/model/operation/count/expiry scope; agent/background origins cannot create grants; provider failure after tools preserves the work and reports what remains; deterministic requests answered with zero model calls; quality deficiencies surfaced and paid improvement only offered; drawing/3D/Forge suites; Firecrawl rotation; provider routing/broker suites.
- Not verified live: the consent flow with a real typed message (the auto-mode guard correctly blocked me from sending consent on the user's behalf), so grant creation is covered by unit tests only.
