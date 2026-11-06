# MASTER IMPLEMENTATION ROADMAP

Two deliverables, independent codebases, one integration seam. This roadmap is executable in order and
every gate is a check someone can re-run.

- **A — LÉLU V1.1 capability upgrade** (this repository, branch `freebuff/078e3ea38e31040bd9a2dce1`).
- **B — LÉLU Device Bridge** (separate repository, separate stack, separately deployable).

## Phase 0 — Reconnaissance (DONE)

Deliverables: `MASTER_REPOSITORY_AUDIT.md`, `BRANCH_AND_COMMIT_REPORT.md`,
`EXISTING_CAPABILITY_INVENTORY.md`, `DEPENDENCY_AND_LICENSE_AUDIT.md`, `INTEGRATION_CONFLICT_REPORT.md`,
`OPEN_SOURCE_INTEGRATION_MATRIX.md`, this roadmap.

Measured baseline: `tsc -b --force` clean; 1065 unit tests, 1063 pass, 2 fail (headless Chromium cannot
launch in the audit VM — missing system library `libnspr4.so`); no LiveKit/WebRTC/pairing code exists.

## Phase 1 — Architecture design (DONE in this pass)

Deliverables: `docs/architecture/LELU_UPGRADE_ARCHITECTURE.md`,
`docs/architecture/DEVICE_BRIDGE_ARCHITECTURE.md`, `docs/architecture/SECURITY_AND_PERMISSION_MODEL.md`.
Gate: the two deliverables share **no** code; the only seam is a versioned HTTP/WS API plus a LÉLU-owned
adapter that is disabled by default.

## Phase 2 — LÉLU capability upgrade

Order is deliberate: spatial first (it is the foundation for avatar and visual work), then avatar, then
browser execution, then voice/visual polish, then integration readiness.

### 2.1 Spatial capability core (DONE — Tier 1-3 enforced, Tier 4-5 enforced but unimplemented)

New: `src/core/spatial/SpatialSceneGraph.ts`, `SpatialObjectRegistry.ts`, `SpatialTierGuard.ts`,
`SpatialIntentBus.ts`, `SpatialPresence.ts`, `SpatialRenderModel.ts`, `SpatialValidation.ts`,
`SpatialSeal.ts`, `SpatialTypes.ts`, `SpatialCapabilityManifest.ts`, `index.ts`; chat entry
`src/core/router/SpatialResolver.ts` (AIRouter stage 1.6); render layer
`src/app/scene/genesis/spatial/SpatialLayer.tsx` mounted inside the existing v1 and v2 canvases.

Shipped behaviour: tiered operations with typed refusals, a revision contract (start 0, +1 per accepted
commit, nothing changes on refusal, stale-revision protection), pre-commit validation, post-commit
verification with automatic undo, a single-use owner approval for destructive deletes (120 s TTL), undo
history, and a real avatar presence channel driven only by applied operations. Full reference:
`docs/architecture/SPATIAL_API.md`.

Acceptance (measured, 2026-11-06): `tests/spatial-core.test.ts` + `tests/spatial-chat.test.ts` — 26 tests,
26 pass; full suite 1091 tests, 1089 pass, the same 2 browser-layout failures as the Phase 0 baseline;
typecheck and lint clean. Evidence and screenshots: `docs/acceptance/master-capability-upgrade/phase-2-1/`
(`RUN_LOG.md`, `probe-readings.json`).

Deviation from the original plan, stated plainly: no read-only `SpatialAdapter` over `GenesisState`,
`WorldRegistry`, `CosmosEntityRegistry` or the R3F tree was built. Existing Cosmos/Genesis entities are not
spatial nodes yet; the graph owns only objects authored through the spatial API. Camera and lighting are not
spatial operations. These move to 2.2 together with `scene.compose`/`scene.commit` and a camera applier.
Also not built: `scripts/verify-spatial.ts`; the machine-readable report is the acceptance test suite plus
the probe JSON recorded in the phase folder.

### 2.2 Spatial construction + orchestration (Tier 3-5)

- Tier 3 (CONSTRUCT): create primitive/asset-backed objects, assemble a small environment, procedural
  authoring via the existing `Procedural3DPipeline`.
- Tier 4 (ORCHESTRATE): multi-step build → validate → revise through `CreativeOrchestrator`.
- Tier 5 (AUTONOMOUS WITH APPROVAL): plan → preview render → approval request → execute → verify. Approval
  uses the existing `AuthorizationQueue` pattern from `src/core/browser/AuthGate.ts`, not a new consent UI.

Rules: a tier is only "implemented" when a refused call is refused by code, not by UI copy. Scene
persistence reuses `RenderStore`/`GenesisState` persistence; no new database.

### 2.3 Avatar spatial presence

Extend `src/core/avatar/AvatarPresenceBridge.ts` (additive) with `position`, `orientation`, `attention`
(target object id), `traversal` state. Drive them from real facts: current panel/destination
(`WorldRegistry`), active object (`SpatialObjectRegistry`), and the existing thinking/speaking/listening
signals. LÉLU moving to an object and inspecting it must be observable in the scene and in `AgentEventBus`.

Acceptance: unit tests for state transitions + a captured before/after frame showing the avatar at two real
positions with the event log naming the same object id.

### 2.4 Browser execution (honest scope)

- Introduce `BrowserBackend` in `src/core/browser/` — an interface with `open`, `read`, `screenshot`,
  `navigate`, `act`, `close`, `state`. `BrowserTool` keeps its current read path as one backend
  (`server-read`); a `neko` backend is registered only when `VITE_NEKO_URL` is configured **and** a session
  is verified.
- Determine empirically whether the deployed Neko build exposes a supported control channel. If it does
  not, `act()` reports `unsupported` for that backend (no fabricated clicks) and the roadmap records the
  constraint. `browser-use` patterns (observe→act→verify, DOM summary, recovery) inform the loop, no code
  imported.
- Every action goes through the existing `AuthorizationQueue` risk gate; screenshots are captured from the
  actual session and stored as evidence.

Acceptance: a real navigation + read through `server-read`, a real rendered Neko session screenshot (if Neko
is reachable in the environment), and an explicit `unsupported` result where it is not.

### 2.5 Voice and media (LÉLU side: no new pipeline)

`VoiceEngine` stays the only voice implementation. Add: audio input device selection, explicit
permission/status surface, session diagnostics (which path is live: Web Speech vs Groq Whisper), and reuse
of the existing barge-in/echo guard. LiveKit is **not** wired into LÉLU's chat in this project.

Acceptance: `tests/voice-continuity.test.ts` still passes; `scripts/verify-voice.ts` passes; a manual
two-turn voice run documented with the honest limitation that audio cannot be asserted from a headless run.

### 2.6 Visual execution & evidence

Extend `Procedural3DEngine` with spatial-scene authoring (`scene` kind) so a Tier 3 build can produce a PNG
without any external image API. Evidence harness: `scripts/evidence/` writing
`docs/acceptance/master-capability-upgrade/<phase>/` with PNG/JSON/log per run, each JSON naming the exact
command and exit code that produced it.

## Phase 3 — Device Bridge foundation (separate repository)

Location: `/workspace/lelu-device-bridge` (its own `git init`, outside the LÉLU worktree). Owner action
required to create the GitHub remote; until then it is a local independent repository.

Stack: Node 22+/TypeScript, `hono` + `@hono/node-server`, `ws`, `zod`, `qrcode`, `node:sqlite`.
Deliverables: auth (pairing + session tokens), device registry, session manager, QR/short-code pairing,
capability discovery + negotiation, permission model, action broker with risk levels, audit log, API v1,
`.env.example`, migrations, tests, `README`/`SECURITY.md`/`API.md`.

Acceptance: unit + integration tests green; two independent browser contexts can pair one device; wrong/expired
codes rejected; revoked session rejected on the next action; guest session cannot read operator data.

## Phase 4 — Media and real device capabilities

Browser-based pairing page first (works on iPhone Safari and Android Chrome), then capability adapters per
platform, then LiveKit media (self-hosted) if the owner provides a server, then screen sharing **where the
platform genuinely allows it**, then native companion *architecture* only.

Honest matrix must be produced per platform: microphone, camera, screen share, clipboard, files,
notifications, background. iOS: no screen share from a web page; Android: `getDisplayMedia` on Chrome,
`AccessibilityService` never adopted. Every state maps to the contract's statuses — no optimistic claims.

## Phase 5 — LÉLU integration adapter

New: `src/core/devicebridge/DeviceBridgeClient.ts`, `DeviceBridgeAdapter.ts`, `DeviceBridgeTypes.ts`.
Contract: discover devices → read capability manifests → request permission → surface approval → dispatch
action → receive result → emit `AgentEventBus` events → return result to cognition → display in
`GenesisDevicePanel`/Cosmos.

Gating: `VITE_DEVICE_BRIDGE_URL` unset → adapter reports `not_configured` and every device tool is
unavailable. No network call, no silent fallback. The adapter never talks to the bridge's database and never
imports bridge code.

Acceptance: LÉLU discovers a paired device, executes one authorized low-risk action end-to-end, the event
appears in the existing activity surfaces, and the bridge is then stopped to prove LÉLU degrades cleanly.

## Phase 6 — End-to-end validation

Full suite (`bun run test`, every `scripts/verify-*.ts`), Playwright runs for LÉLU UI + bridge, the twelve
brief steps §14C as a scripted sequence, plus regression checks on chat, Cosmos, mobile layout, voice,
existing browser path, agent routing, memory and auth. Evidence in both acceptance folders with exit codes.

## Phase 7 — Final acceptance

Reports, docs, deployment instructions, known limitations, and the acceptance matrix with real results.
Nothing is marked PASS unless the command that produced it is named and its exit code is recorded.

## Gates

| Gate | Condition | Blocks |
|---|---|---|
| G0 | Headless Chromium launches in the work environment (`playwright install-deps`, needs root) | every screenshot/evidence claim |
| G1 | Spatial core Tier 1-2 tests + verify script pass | avatar spatial work, Tier 3-5 |
| G2 | Tier 3-5 refusal tests prove the guard (not the UI) denies | "tiered evolution" claim |
| G3 | Bridge: pairing + revocation + isolation tests pass | any LÉLU-side bridge adapter work |
| G4 | Bridge: independent operation with LÉLU stopped | integration adapter merge |
| G5 | Regression suite green after adapter is wired | final acceptance |

## Workstream ownership (single session, isolated branches)

| Stream | Files | Branch |
|---|---|---|
| A1 spatial | `src/core/spatial/**`, `tests/spatial-*`, `scripts/verify-spatial.ts` | same branch, additive |
| A2 avatar | `src/core/avatar/AvatarPresenceBridge.ts` (+ new `SpatialPresence.ts`) | same branch |
| A3 browser | `src/core/browser/**`, `plugins/nekoApi.ts` | same branch |
| A4 evidence | `scripts/evidence/**`, `docs/acceptance/**` | same branch |
| B1 bridge | `/workspace/lelu-device-bridge/**` | own repo, own branch |
| B2 adapter | `src/core/devicebridge/**` | same branch as A |

No file in two streams at once. Shared interfaces (`SpatialObjectRegistry` ids, capability status union,
`BrowserBackend`) are owned by A1 and B1 respectively and changed only with both tests updated.

## Risks and handling

| Risk | Impact | Handling |
|---|---|---|
| No root → Chromium cannot launch | no visual evidence | Gate G0; report blocked honestly if unresolved; use `curl`-level API evidence and unit tests meanwhile |
| No second physical device | cannot claim real-device acceptance | label simulated (two Playwright contexts) vs real; request a real run from the owner |
| Neko needs public IP + UDP 52000-52100 | live browser session may be unreachable here | verify, then report `unavailable` with the reason; never fake a session |
| No LiveKit host | media rows stay `unsupported` | bridge is functional without media; document cost and self-host steps |
| Divergent branches (207/236 commits) | merge conflicts for the owner later | additive files + named localized edits only; no merges |
| Provider-order wording in brief | behaviour change risk | not changed; owner decision recorded |
| Meshy is paid | 3D Forge cannot complete | local procedural path remains the default; no key invented |

### 2.2 Spatial world integration, composition, camera & verification (DONE)

Shipped on top of `claude/master-integration`: a read-only `SpatialAdapter` (authored objects, Cosmos, world
destinations, live three.js nodes, namespaced identity, stale detection), `SpatialComposition` (plan →
owner-approved commit as one revision → verification → rollback on disagreement), `SpatialCameraApplier`
(geometry-aware focus/frame/orbit/zoom/reset on the existing Genesis rig), `SpatialVerification` (graph,
renderer, camera, framing and screenshot layers with honest skips), plus chat and capability-manifest wiring.

Measured: typecheck clean; 46 spatial tests pass; full suite 1392 tests, 1386 pass, 0 fail, 6 skipped; lint
reports 1 pre-existing error in `GenesisChat.tsx` (byte-identical to master-integration) and 108 warnings.
Evidence, gates and limitations: `docs/acceptance/master-capability-upgrade/phase-2-2/REPORT.md`.
