# MASTER REPOSITORY AUDIT — LÉLU V1.1

Audit date: 2026-11-06
Repository: `github.com/lapheezy/LeluV1.1`
Audit worktree: `freebuff/078e3ea38e31040bd9a2dce1` (contains `origin/main`; no divergence)
Method: direct inspection of the checked-out worktree, `git` metadata, dependency manifests and a real
typecheck + unit-test run. Nothing in this document is carried over from an earlier report.

---

## 1. Ground truth

| Fact | Measured value | How it was established |
|---|---|---|
| Default integration line | `origin/main` at `44bdd93` | `git log origin/main` |
| Audit branch base | `freebuff/078e3ea38e31040bd9a2dce1`, HEAD `e7b667b` | `git rev-parse`; `git merge-base --is-ancestor origin/main HEAD` → true |
| Remote branches already merged into main | 3 | `git branch -r --merged origin/main` |
| Remote branches NOT merged into main | 15 | `git branch -r --no-merged origin/main` |
| Source files under `src/` | 591 (418 `.ts`, 161 `.tsx`) | `find src -type f` |
| Test files | 88 (`tests/*.test.ts`) + 50 `scripts/verify-*.ts` | `ls tests/*.test.ts` |
| Genesis engine modules | 54 (`src/app/scene/genesis/engines/*.ts`) | `ls` |
| Router stages | 22 modules in `src/core/router/` | `ls src/core/router` |
| Installed dependency tree | 608 packages | license scan over `node_modules` |
| Package manager | `bun` 1.4.4, `bun.lock` (also `package-lock.json`, `deno.lock` present) | versions + lockfiles |
| Node runtime in audit VM | v26.13.0 | `node -v` |

## 2. Measured build health (this audit run, not inherited)

| Check | Command | Result |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, 676 packages |
| Typecheck | `bun run typecheck` (`tsc -b --force`) | **exit 0 — clean** |
| Unit tests | `bun run test` | **1065 tests, 1063 pass, 2 fail, 0 skipped, 118 s** |
| Failing tests | `tests/self-view.test.ts` (2 cases) | Environmental: `browserType.launch: Executable doesn't exist … chromium_headless_shell-1234`. Playwright browsers were not installed in the audit VM. `bunx playwright install chromium` was then run and succeeded; the two cases must be re-run to confirm they are environment-only. |

No lint run and no production build were performed in this audit pass; CI (`.github/workflows/ci.yml`)
runs lint → build → unit tests → every `scripts/verify-*.ts` → a live Playwright run against `vite preview`.

## 3. What the application actually is

Not a chat wrapper. The worktree is a Vite 8 + React 19 + TypeScript 6 single-page application with a
Very large in-browser cognition and orchestration layer, plus a Node/Vite server middleware layer, plus a
Capacitor 8 Android shell.

Entry: `index.html` → `src/main.tsx` → `src/App.tsx` → `<GenesisScene />` (per `PHASE_13_REPORT.md`, which
verified `App.tsx` renders only Genesis). Genesis is a real React-Three-Fiber WebGL environment, not CSS
pseudo-3D: `src/app/scene/genesis/GenesisV2Scene3D.tsx` (1462 lines) builds the core, orbital rings,
satellites, shader materials and drei `Html` labels.

Layers that matter for this project:

```
LÉLU CORE            src/core/AIService.ts (1592)  · src/core/AIRuntime.ts (709) · src/core/AIRouter.ts (333)
SHAMAN               src/core/agents/Shaman.ts (292) + ExecutiveOwnership.ts + AgentRunner/AgentStore
EXECUTIVE BOARD      src/core/executive/ExecutiveBoard.ts · ExecutiveRuntime.ts · SelfDiagnostics.ts
CAPABILITIES/TOOLS   src/core/capabilities/CapabilityManifest.ts · src/core/tools/* · src/core/router/ToolResolver.ts
DEVICE ADAPTERS      src/core/native/NativeCapabilityRegistry.ts + 21 adapters in src/core/native/capabilities/
SPATIAL / GENESIS    src/app/scene/genesis/** (54 engines, cosmos, render, state, avatar)
AVATAR               src/core/avatar/* + src/app/scene/genesis/avatar/*
BROWSER              src/core/browser/BrowserTool.ts · router/BrowserResolver.ts · browser/AuthGate.ts · plugins/browseApi.ts
NEKO                 plugins/nekoApi.ts · deploy/neko/docker-compose.yml · GenesisBrowserPanel.tsx
VOICE                src/core/voice/VoiceEngine.ts (1539) · speechToText.ts · transcriptionTransport.ts
PERSISTENCE          src/core/memory/* (IndexedDB) · src/core/persistence/SupabasePersistence.ts · supabase/migrations/*
```

## 4. Server layer (what can hold a secret)

`server.ts` (317 lines) + `vite.config.ts` (275) mount middleware plugins from `plugins/`:
`aiProxyApi`, `modelApi`, `browseApi`, `nekoApi`, `knowledge relay`, `instagramApi`, `githubApi`,
`engineerApi`, `rssApi`, `quad9Plugin`, `aisBridgePlugin`, `selfViewApi`, `envApi`, `buildInfo`,
`runtimeKeyBridge`, `workspaceBaseline`, `forge/*`.

This is the existing credential boundary: `env.example` states that `ANTHROPIC_API_KEY`, `NEWS_API_KEY`,
`YOUTUBE_API_KEY`, `MESHY_API_KEY`, `INSTAGRAM_ACCESS_TOKEN`, `AISSTREAM_API_KEY`, `NEKO_PASSWORD` are
server-only, and `VITE_*` names are public. `plugins/runtimeKeyBridge.ts` exists specifically so a
shell-exported `ANTHROPIC_API_KEY` resolves without renaming.

Consequence for this project: every new privileged capability (device bridge, media, browser execution)
must be a server-side surface, never a `VITE_` secret.

## 5. Implemented vs partial vs documentation-only

**Implemented and wired**
- Router chain (22 stages), provider registry with priority + failure cooldowns, memory (IndexedDB +
  Supabase adapter), SHAMAN routing to Executive Board, AgentEventBus, ToolRegistry/ToolDispatcher,
  NativeCapabilityRegistry with 21 real adapters, CapabilityManifest, Genesis 3D scene + 54 engines,
  Cosmos store, avatar presence bridge and character rig, BrowserTool read path via `/api/browse`,
  Neko status bridge + embedded Neko surface, VoiceEngine (Web Speech + Groq Whisper fallback),
  Procedural3DEngine render → PNG through Three.js, RenderStore gallery, 88 test files, CI gate.

**Partial**
- **Browser execution**: LÉLU can open an iframe, read page text through the server reader, and can
  embed a live Neko session. It cannot *drive* a page (no click/type/form/tab/screenshot-verify loop).
  `BrowserTool.nativeLaunchAvailable()` returns `false` by design.
- **Neko**: `plugins/nekoApi.ts` only verifies that the web client answers HTTP. That is a status probe,
  not a verified browser session; WebRTC/UDP reachability is explicitly out of that check's scope.
- **Avatar in space**: `AvatarPresenceBridge` maps the three real AIService signals (thinking/speaking/
  listening) onto dialogue state only. There is no position/orientation/attention/scene-awareness layer.
- **Spatial manipulation**: the scene is observable and the camera is controllable
  (`GenesisCameraIntent`, `GenesisSpatialControls`, `WorldRegistry`), but there is no spatial object
  registry, no scene mutation API, and no tiered permission model.
- **Device layer**: capability adapters exist for the *local* device only (browser APIs). There is no
  transport to a second device, no registry, no pairing, no remote session.
- **Android**: Capacitor shell and CI APK build exist; no native plugin surface beyond defaults.
- **iOS**: browser-only. `IOS_CAPABILITIES.md` is honest: haptics, App Intents, URL schemes and true
  background execution are reported as unavailable/native-only.

**Documentation or prototype only**
- `docs/*_REPORT.md` (10 engineering narrative reports) and root `PHASE_3..13_REPORT.md` — historical.
- `IOS_CAPABILITIES.md` — a real capability classification, honored by the adapters.
- `ARCHIVE_MANIFEST.md` claims 439 files were moved to `_archive_orphaned/`. **That directory is not
  present in this worktree.** The manifest is stale relative to the tree (documentation-only artifact).
- `phase2-earthcore-planetexplorer-unify (1).diff` — an unapplied diff committed at repo root.

**Absent (verified by search)**
- No LiveKit, no `RTCPeerConnection`, no `getDisplayMedia`, no QR/pairing, no WebRTC signalling,
  no device registry, no remote session or action-broker code. Case-insensitive search across the tree
  for `livekit|webrtc|RTCPeerConnection|getDisplayMedia|pairing|device.?bridge|qr.?code` returned only
  Neko-related and unrelated matches (`src/core/native/capabilities/network.ts`, provider error text).

## 6. Technical debt found in this pass

1. **Two failing tests in a clean tree** — caused by missing Playwright browsers, i.e. the suite is not
   hermetic; a fresh clone fails `bun run test` until `playwright install` runs. CI hides this because it
   installs browsers later in the job.
2. **Stale `ARCHIVE_MANIFEST.md`** referencing a directory that does not exist.
3. **Three lockfiles** (`bun.lock`, `package-lock.json`, `deno.lock`) — CI pins `bun install
   --frozen-lockfile`, so `package-lock.json` and `deno.lock` are drift risk, not sources of truth.
4. **README.md is still the Vite template README** plus an Android appendix; it does not describe LÉLU.
5. **Root directory pollution**: 11 `PHASE_*_REPORT.md` files, `cleanup-probe-rows.sql`, an unapplied
   `.diff`, `skills-lock.json`.
6. **Two dead default model IDs** still present in `src/core/Environment.ts`
   (`cerebrasModel: llama3.1-8b`, `fireworksModel: llama-3.1-8b-instruct`) while
   `src/core/ProviderModels.ts` documents those models as retired — two sources of truth for defaults.
7. **`.env.local` exists in the worktree** (gitignored). Not read by this audit; it is the live key file
   and must never be committed or echoed.

## 7. Findings that change the brief

- **The brief's "Anthropic-first provider preference" does not match this repository.**
  `src/core/Environment.ts` assigns: Groq 1, OpenRouter 2, Cerebras 3, Mistral 4, Fireworks 5,
  GitHub Models 6, **Anthropic 7**, Gemini 8, and a `localInference` priority 0 entry; default provider is
  `groq`. The existing behaviour is Groq-first with Anthropic late in the fallback chain, promotable with
  `VITE_DEFAULT_PROVIDER=anthropic`. This audit preserves the code as it is; it does not silently
  re-order providers to match the brief. See `INTEGRATION_CONFLICT_REPORT.md` §3 (owner decision).
- **`claude/avatar-3d-world` and `claude/master-integration` are 207 and 236 commits ahead of main**
  respectively, touching 1178 / 1290 files. They are not "historical references" in the harmless sense —
  they are large divergent lines of work. This audit treats both as read-only.
- **The device bridge is genuinely greenfield.** No partial implementation exists to preserve.

## 8. Baseline test defect, root-caused

The two failing cases in `tests/self-view.test.ts` are **environment-bounded, not logic failures**:

1. First run: `browserType.launch: Executable doesn't exist … chromium_headless_shell-1234` → Playwright
   browsers were not installed. `bunx playwright install chromium` was run and succeeded (114.7 MiB).
2. Re-run after install: still 13 pass / 2 fail, now with
   `error while loading shared libraries: libnspr4.so: cannot open shared object file`.
3. `bunx playwright install-deps chromium` **cannot run here**: `sudo` is disabled by the container's
   `no_new_privileges` flag (`sudo: The "no new privileges" flag is set`). No root ⇒ the required system
   libraries (`libnspr4`, `libnss3`, …) cannot be installed in this VM.

Consequences, stated plainly:

- Any Playwright-driven test or `scripts/verify-*.mjs` browser check **cannot run in this workspace**. CI
  (`.github/workflows/ci.yml`) installs browsers with `--with-deps` on `ubuntu-latest`, so the suite is
  expected to pass there; that has not been verified from this VM.
- Visual evidence in this project cannot come from the VM's local Chromium. The working path is the Cloud
  browser panel (an external Chromium rendering the dev server), and every capture must state which browser
  produced it.
- This is recorded as roadmap gate **G0** and is a pre-existing repository/environment limitation, not a
  defect introduced by this project.

## 9. Audit conclusion

LÉLU V1.1 is a real, typechecking, ~1000-test application with a working 3D environment, a real
orchestration hierarchy and an honest device-capability layer for the local browser. Its gaps relative to
the brief are specific and addressable: no scene mutation API, no tiered spatial permissions, no remote
device transport, no real browser *driving*, and no cross-device media. None of those require replacing an
existing system.
