# EXISTING CAPABILITY INVENTORY — LÉLU V1.1

Status key: **LIVE** (implemented, wired, exercised by tests) · **PARTIAL** (implemented but narrower than
the name implies) · **DOC** (documentation/prototype only) · **ABSENT** (verified not present).

Every row names the file that carries the behaviour. If a row says LIVE, there is code and at least one
test or verify script behind it.

## 1. Cognition, providers, orchestration

| Capability | Status | Where |
|---|---|---|
| Chat cognition + turn lifecycle | LIVE | `src/core/AIService.ts` (1592 lines), `src/core/AIRuntime.ts` |
| Router chain (22 stages, time → brain → research → browser → workspace → planning → reasoning → engineering → creative → tools → deflock → projects → avatar → surfaces → cognitive-state → provider → interceptor → response) | LIVE | `src/core/AIRouter.ts`, `src/core/router/*` |
| Provider fallback with priority + cooldowns (30 s generic, 15 min credential-refused) and failure classification (credential/timeout/network/server/billing/model-not-found/bad-request) | LIVE | `src/core/AIProviderRegistry.ts`, `src/core/ProviderModels.ts`, `src/core/router/ProviderResolver.ts` |
| Provider priority order | LIVE — Groq 1, OpenRouter 2, Cerebras 3, Mistral 4, Fireworks 5, GitHub Models 6, **Anthropic 7**, Gemini 8 | `src/core/Environment.ts` (`providerEnv(...)` calls) |
| Server-side model-credential broker | LIVE | `plugins/aiProxyApi.ts`, `plugins/modelApi.ts`, `plugins/runtimeKeyBridge.ts`, `src/core/model/BrokerTransport.ts` |
| SHAMAN routing to the Executive Board | LIVE | `src/core/agents/Shaman.ts`, `ExecutiveOwnership.ts`, `tests/shaman-routing.test.ts` |
| Executive runtime | LIVE | `src/core/executive/ExecutiveBoard.ts`, `ExecutiveRuntime.ts`, `SelfDiagnostics.ts` |
| Agent runner/store/templates | LIVE | `src/core/agents/AgentRunner.ts`, `AgentStore.ts`, `AgentTemplates.ts`, `AgentTypes.ts` |
| Agent event bus (tool + reasoning events consumed by UI) | LIVE | `src/core/agent/AgentEvents.ts` (344 lines), `tests/runtime-integration.test.ts` |
| Tool registry + dispatcher + JSON schemas for models | LIVE | `src/core/tools/ToolRegistry.ts`, `ToolDispatcher.ts`, `ToolSchemas.ts`, `ClaimGrounding.ts` |
| Capability manifest (self-model of available capabilities) | LIVE | `src/core/capabilities/CapabilityManifest.ts` |
| Memory: IndexedDB store, orchestrator, ingestion, migration | LIVE | `src/core/memory/*` |
| Persistence: Supabase adapter + migrations | LIVE | `src/core/persistence/SupabasePersistence.ts`, `supabase/migrations/2026*.sql` |
| Curiosity engine, self-study, personality development, proactive core | LIVE | `src/core/curiosity/`, `src/core/cognition/SelfStudyEngine.ts`, `src/core/proactive/`, `tests/curiosity-engine.test.ts`, `tests/personality-development.test.ts` |
| Workflows, planning, projects | LIVE | `src/core/workflows/`, `src/core/planning/`, `src/core/projects/` |
| Engineering sandbox / self-dev | LIVE | `src/core/engineering/`, `src/core/selfdev/`, `plugins/engineerApi.ts`, `tests/engineering-*.test.ts` |

## 2. Device capability layer (local device only)

| Capability | Status | Where |
|---|---|---|
| Native capability contract + registry (register/snapshot/invoke/subscribe, permission gating) | LIVE | `src/core/native/NativeCapability.ts`, `NativeCapabilityRegistry.ts` (199 lines) |
| 21 real adapters | LIVE | `src/core/native/capabilities/`: `appintents, background, camera, clipboard, deeplinks, device, haptics, helpers, install, lifecycle, media, mic, nativebridge, network, notifications, permissions, push, share, speech, storage, tts` |
| Cognition → device capability invocation | LIVE | `src/core/router/ToolResolver.ts` (297 lines): intent patterns → `NativeCapabilityRegistry.invoke()` → `AgentEventBus` events → real result appended to request context |
| Device panel UI | LIVE | `src/app/scene/genesis/GenesisDevicePanel.tsx` |
| Honest platform limits (haptics/App Intents/URL schemes/background on iOS) | LIVE | `IOS_CAPABILITIES.md` + adapter `isAvailable()` implementations |
| Web Push delivery backend | PARTIAL | `push.ts` + service worker handlers exist; there is no push backend in this repo |
| Native companion bridge (WKWebView `messageHandlers`) | PARTIAL | `nativebridge.ts` reports NATIVE ONLY until a shell registers |
| **Remote device transport** (pairing, registry, sessions, remote execution) | **ABSENT** | verified by search |

## 3. Spatial / 3D / visual

| Capability | Status | Where |
|---|---|---|
| WebGL scene (R3F 9.6.1, three 0.185, drei 10.7.7) | LIVE | `src/app/scene/genesis/GenesisV2Scene3D.tsx` (1462), `render/*`, `materials/*`, `environment/*` |
| 54 simulation engines + engine bus/registry/runtime | LIVE | `src/app/scene/genesis/engines/*` |
| World/destination registry for attention | LIVE | `src/app/scene/genesis/WorldRegistry.ts` (196) |
| Camera control (intent bus, rig, spatial buttons, pinch-zoom) | LIVE | `GenesisCameraController.tsx`, `GenesisCameraIntent.ts`, `GenesisV2CameraRig.tsx`, `GenesisSpatialControls.tsx`, `PinchZoomContainer.tsx` |
| Planet/geo pipeline | LIVE | `render/GeoPipeline.ts`, `PlanetTextures.ts`, `PlanetVisual.tsx`, `PlanetExplorer.tsx` |
| Cosmos layer + store + entity registry | LIVE | `src/app/scene/genesis/cosmos/*`, `src/core/cosmos/CosmosEntityRegistry.ts` |
| Procedural 3D authoring → real PNG through Three.js (offline, no key) | LIVE | `src/core/creative/Procedural3DEngine.ts`, `Procedural3DPipeline.ts`, `RenderEngine.ts`, `RenderStore.ts` |
| Pluggable render engines (local canvas, cloud slots that report unconfigured) | LIVE | `src/core/creative/RenderEngine.ts` |
| Avatar presence driven by real cognition signals (thinking/speaking/listening → dialogue state) | LIVE | `src/core/avatar/AvatarPresenceBridge.ts` (140) |
| Avatar rig, animations, character store, command bus, 3D reconstruction (Meshy, paid, server-relayed) | LIVE / PARTIAL | `src/core/avatar/LeluRig.ts`, `LeluRigRenderer.ts`, `LeluAnimation.ts`, `AvatarCommandBus.ts`, `Avatar3DReconstructor.ts`, `src/app/scene/genesis/avatar/*` |
| **Spatial object registry / scene mutation API / tiered spatial permissions** | **ABSENT** | no such module; only camera + camera intent |
| **Avatar spatial presence** (position, orientation, attention, object interaction) | **ABSENT** | `AvatarPresenceBridge` is dialogue-state only |
| XR / WebXR | **ABSENT** | `@pmndrs/xr` not installed |

## 4. Browser, remote browser, media

| Capability | Status | Where |
|---|---|---|
| URL detection / browse-intent classification | LIVE | `src/core/browser/BrowserTool.ts` (`findUrl`, `looksLikeBrowseRequest`, `normalizeUrl`) |
| Page read for cognition through the server (CORS-free) | LIVE | `BrowserTool.readViaServer` → `plugins/browseApi.ts` `/api/browse` |
| In-app browser panel + "Read for Lélu" through `AIService.chat` | LIVE | `src/app/scene/genesis/GenesisBrowserPanel.tsx` (496) |
| Access gating for sensitive sites | LIVE | `src/core/browser/AuthGate.ts` (`AuthorizationQueue`, `assessAccess`) |
| Neko self-hosted virtual browser: config + status probe + embeddable live surface | PARTIAL | `plugins/nekoApi.ts` (HTTP status only), `deploy/neko/docker-compose.yml` (14 lines), `GenesisBrowserPanel` mode `"neko"` |
| **Verified Neko WebRTC session / driving a page (click/type/tabs/screenshot)** | **ABSENT** | no automation surface to Neko; status probe explicitly excludes WebRTC |
| **Cross-device media (WebRTC/LiveKit)** | **ABSENT** | no LiveKit/WebRTC dependency or code |

## 5. Voice

| Capability | Status | Where |
|---|---|---|
| Two-way voice pipeline: TTS (chunked, barge-in), Web Speech recognition, Groq Whisper fallback, iOS audio unlock | LIVE | `src/core/voice/VoiceEngine.ts` (1539), `speechToText.ts`, `transcriptionTransport.ts`, `audioRecorder.ts`, `useVoice.ts` |
| Voice continuity tests | LIVE | `tests/voice-continuity.test.ts`, `scripts/verify-voice.ts` |
| Interruption handling / conversation state coupling | LIVE | `VoiceEngine` barge-in + `AvatarPresenceBridge` speaking/listening signals |
| Device/mic selection, real-time transport, distributed audio sessions | ABSENT | not implemented (browser default device only) |

## 6. Testing and evidence

| Capability | Status | Where |
|---|---|---|
| 88 unit/integration test files (node:test via tsx) | LIVE | `tests/*.test.ts` |
| 50 verification scripts | LIVE | `scripts/verify-*.ts` |
| CI: lint → `tsc -b && vite build` → bundle hygiene → unit tests → all verify scripts → live Playwright runtime + client secret scan | LIVE | `.github/workflows/ci.yml` |
| Evidence capture practice (screenshots + JSON + transcript per run) | LIVE | `docs/evidence/self-improve/<timestamp>/` |
| Playwright browser tests | LIVE | `tests/self-view.test.ts`, `scripts/verify-mobile-chat.mjs`, `verify-layout`, `verify-workspace`, `photo-lelu-formats.mjs` |
| Acceptance evidence folders for this project | ABSENT (to be created) | `docs/acceptance/master-capability-upgrade/`, `docs/acceptance/device-bridge/` |

## 7. Deployment

| Capability | Status | Where |
|---|---|---|
| Vite dev/preview server with middleware APIs | LIVE | `server.ts`, `vite.config.ts` |
| Bun server entry | LIVE | `package.json` `serve`/`start`, `server.ts` |
| Android APK via GitHub Actions | LIVE | `.github/workflows/android-apk.yml`, `capacitor.config.ts`, `scripts/prepare-android.mjs` |
| GitHub Pages deploy workflow | LIVE | `.github/workflows/deploy-pages.yml` |
| Neko docker-compose (self-hosted) | LIVE (config only) | `deploy/neko/docker-compose.yml` |
| Supabase schema + RLS migrations | LIVE | `supabase/migrations/` |
| Device Bridge deployment | ABSENT | new repository, Phase 3 |

## 8. What this inventory implies for the upgrade

Three genuine absences, and nothing else needs rebuilding:

1. **Spatial capability layer** — the scene renders and the camera moves, but there is no object registry,
   no mutation API, and no permission tiers. Extend, don't replace.
2. **Browser/remote execution** — reads pages but cannot drive them; Neko is embedded but unverified.
3. **Device bridge** — nothing exists. Build it separately.

Everything else in the brief (voice, avatar presence, orchestration, providers, memory, Cosmos) is already
implemented and must be extended additively, not re-created.
