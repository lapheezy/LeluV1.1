# Freebuff / Claude commit audit — Phase 0

Audit baseline: **`1549194`** (tip of `origin/freebuff/1fb0099bf53a9ab2f6fe75bd`), which is
`claude/master-integration` at `1031053` plus two Freebuff commits. Previous checkpoint:
`origin/claude/avatar-3d-world` at `616f251`. 31 relevant commits (29 on the integration
branch, 2 on the Freebuff branch). Environment: Linux cloud container, Node 22, headless
Chromium (software WebGL), dev server = Vite on the audit worktree. No iPhone hardware.

Status words: VERIFIED (executed through the real path), PARTIAL, BROKEN, NOT VERIFIED, BLOCKED.

## Repository facts (measured)

| Fact | Value |
|---|---|
| Integration branch HEAD | `1031053`, level with origin, clean tree |
| Latest work | Freebuff `1549194` (2 commits ahead, branched exactly at `1031053`: fast-forward, no conflicts) |
| Remote default branch | `claude/open-session-rbwmdw` (not `main`) |
| Other unmerged branches | `freebuff/b51087…` (`ab34483`, superseded — see below); `lelu-verify/*` (test-README markers only); `claude/env-probe-*` (probe notes only) |
| Typecheck (`tsc -b --force`) at `1549194` | exit 0 |
| Production build (`vite build`) | exit 0, 28 s; export worker emitted as its own chunk |
| Bundle secret scan (`scripts/verify-bundle-secrets.ts` on `dist/`) | ALL CHECKS PASSED |
| Full suite (`npm test`, the project's own runner) | **1346 tests: 1342 pass, 0 fail, 4 skipped** — `evidence/phase0/npm-test-summary.txt` |
| Skipped | 4 Freebuff tests that need the `opa` and `gitleaks` binaries, absent here (BLOCKED) |
| CI | `.github/workflows/ci.yml` runs on push to `main` and on pull requests only — the integration branch gets no push checks |

Correction to earlier reports: the `genesis-interface` "historical failure" recorded in
the master-integration report came from a custom runner that did not load
`tests/support/ignore-css.mjs`. Under `npm test` it passes.

## Commit inventory

| Commit | Author | What | Integrated / reachable | Tests | Status |
|---|---|---|---|---|---|
| `1549194` | Freebuff | Engineering Studio, Voice Studio, Infrastructure Monitor, Security Center panels over `/api/integration/*`; scanner path fixes | Merges cleanly; panels open from Settings (screenshot) | `integration-studios` pass | **PARTIAL** — panels render; on desktop the persistent chat panel covers them (all application panels sit below chat); scanners not installed here |
| `e648365` | Freebuff | Capability gateway: AdapterRegistry (16 adapters), OPA policy (Rego + TS reference), scanners (gitleaks/Trivy/Semgrep), telemetry, relationship store, voice adapters, engineering orchestrator; `/api/integration` mounted in `vite.config.ts` and `server.ts` | Reachable over HTTP (status/security/engineering/voice/traces → 200) | 7 new suites pass; 4 skip | **PARTIAL + SECURITY** — OPA absent here (falls back to the reference evaluator, and says so); **the API has no identity check**: without `LELU_ENGINEER_TOKEN`, an Origin-less request (curl, server-to-server) passes, so `POST /api/integration/scan` runs scanners for anyone (measured: 200). A static shared token, not the verified Supabase identity the engineering API uses |
| `ab34483` | Freebuff | Bare secret names → documented names (Supabase) | Already in integration, **superseded** by `abec038` (refuses admin tokens as browser keys) | `bare-secret-aliases` pass | VERIFIED (via superseding commit) |
| `1031053` | Claude | Creation Studio in chat/Cosmos; Atelier; avatar texture fit | Reachable | studio 25, studio-tools 5, atelier 9, atelier-tools 3 pass | **PARTIAL** — no end-to-end live chat run produced a file; avatar fix unmeasured |
| `511d9fa` | Claude | Studio engine: 9 formats + read-back | Reachable via tools | pass; independently checked with LibreOffice / python-docx/pptx / openpyxl | VERIFIED (engine) |
| `0b33cd2`, `b81d159` | Claude | Kimi K3.1 Pro coding route | Router code | kimi-coding-route pass | NOT VERIFIED live (no live coding turn recorded) |
| `2b18882` | Claude | broker tests opt in; chat layout listener fix | — | pass | VERIFIED |
| `6bf7472` | Claude | key-rotation guide | doc | — | BLOCKED (owner must rotate keys) |
| `1d1ed71` | Claude | server-authoritative autonomy, password to raise | `/api/engineer/autonomy` | server-autonomy pass (injected identity) | PARTIAL — real Supabase identity not exercised (no test project); **policy mismatch**: server apply level 4 vs page `AutonomyGate.can(5)` in `SelfDevelopmentLoop.ts:812` |
| `a29f369`, `5888297`, `f563ddd`, `374541c` | Claude | Fireworks-first routing, Anthropic opt-in enforced server-side | broker | model-broker, live-agent pass | VERIFIED (policy); live Fireworks 200 observed in chat runs |
| `ae8ae5d`, `3eccc6d`, `0b776fc` | Claude | Interface orchestration (propose/preview/consent/undo) | tools + consent bar | interface-orchestration pass | NOT VERIFIED in this audit (no before/after screenshots yet) |
| `e541051` | Claude | Session 1 (Chat Universe, Phase 1A/1B) | live | chat suites pass | **BROKEN on phone** — see baseline below |
| `9b0cd3e` | Claude | data-API keys removed from served page | relay | bundle scan pass | VERIFIED (bundle); relay itself **not mounted in `server.ts`** |
| `66c86cd`…`b996a05` (11 commits) | Claude | Phase 6 self-development lifecycle, rollback, checks | engineer API | development-loop, engineering-runtime pass | NOT VERIFIED end-to-end in this audit |
| `eb2fac3`, `d077ba9`, `ea8c11c`, `441fb51` | Claude | reports / evidence | docs | — | n/a |

## Baseline defects found in Phase 0 (measured, not inferred)

1. **Full-screen Chat on a phone keeps Home/Cosmos mounted** (iPhone 13 viewport, emulated):
   with Chat Universe open, `CosmosHome` and `SpatialNav` are mounted (hidden) and the
   Genesis V1 workspace keeps **two visible 390×664 canvases** rendering underneath.
   `evidence/phase0/mobile-baseline-home-chat-conversation.png`, `mobile-baseline.json`.
2. **An opened conversation on a phone is a small floating window**, not full-screen;
   two composers are visible at nearly the same height (142 px and 275 px wide on a
   390 px screen).
3. **Browse relay SSRF via redirect**: `plugins/browseApi.ts:147` uses `redirect: "follow"`
   without validating each hop, and reads the whole body (`response.text()`) before the
   2 MB cap.
4. **Production route gap**: `server.ts` does not mount `createBrowseApi` or
   `createAiProxyApi` (knowledge relay); `main.ts` lacks the model broker, GitHub and
   integration routes. Chat browsing and knowledge lookups cannot work on the Node server.
5. **Integration API open to unauthenticated callers** (see `e648365`).
6. **Chat turn freezes headless Chromium**: a second avatar canvas uploads 4096² textures
   (31.7 s measured earlier); mitigation committed in `1031053`, not yet re-measured.
7. **Autonomy apply level** shown as L5 in the page, enforced as L4 on the server.
8. **`env.example` contradiction**: line 48 says the default provider is Fireworks;
   line 65 sets `VITE_DEFAULT_PROVIDER=groq`.
9. **CI** does not run on pushes to the integration branch.
10. **Context fan-out**: `ChatUniverse`, `UniverseChatWindow`, `GenesisInterface` and other
    DOM-only components still call `useGenesis()` (the full context including universe
    data) — render cost not yet measured.

## Decision

Freebuff's two commits are integrated into `claude/master-integration` by fast-forward:
they compile, build, pass the full suite and conflict with nothing. Their open-access gap
(defect 5) is fixed in Phase 7 rather than by withholding the work.

## Re-check after Phase 2 interim (`62ddd61`)

`git fetch origin` showed no Freebuff commits newer than `1549194`, which is already integrated. The only Freebuff commit not in `claude/master-integration` is `ab34483`, which is still superseded by `abec038` as recorded above. Nothing new needed to be integrated.
