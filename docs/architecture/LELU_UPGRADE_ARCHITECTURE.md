# LÉLU V1.1 UPGRADE ARCHITECTURE

Status: design (Phase 1). No production code changed by this document.

## 1. Principles this design obeys

1. **Extend, never replace.** `AIService`, `AIRuntime`, `AIRouter`, SHAMAN, the Executive Board, the provider
   registry, memory, `VoiceEngine`, the R3F scene and Cosmos stay the authorities they already are.
2. **One authority per concern.** One cognition pipeline, one provider fallback, one browser tool, one
   renderer, one device capability registry. New work registers *into* those, it does not sit beside them.
3. **Every new capability is LÉLU-owned.** New abilities are exposed as tools/router intents with a
   capability manifest entry and a permission tier — not as free-floating module APIs the UI calls directly.
4. **Honest state.** A capability reports `available | permission-required | denied | unsupported |
   temporarily-unavailable | native-required | user-interaction-required`. There is no "probably works".
5. **Additive footprint.** New code lives in new directories; existing files get named, localized edits
   (`INTEGRATION_CONFLICT_REPORT.md` §4) so the 207- and 236-commit parallel branches stay mergeable.

## 2. Layers (unchanged hierarchy, new leaves)

```
LÉLU CORE ────────────── AIService · AIRuntime · AIRouter (22 stages)
   │
SHAMAN ──────────────── routing to Executive Board (unchanged)
   │
EXECUTIVE BOARD / GALAXIES / AGENT UNIVERSES / AGENT SYSTEMS (unchanged)
   │
CAPABILITIES ────────── CapabilityManifest (existing) + SpatialCapabilityManifest (new)
   │
TOOLS ───────────────── ToolRegistry · ToolDispatcher · ToolResolver stage (extended)
   │                     ├── spatial tools      (new, Tier 1-5)
   │                     ├── browser tools      (existing + execution backend)
   │                     └── devicebridge tools (new, env-gated, default off)
   │
DEVICE/SPATIAL ADAPTERS ─ NativeCapabilityRegistry (existing, local device)
                          SpatialSceneGraph / SpatialObjectRegistry (new, in-scene)
                          DeviceBridgeAdapter (new, remote devices — separate service)
```

Nothing in the new leaves may call `AIService.chat()` recursively, own a provider, or keep its own memory.
Results flow back as ordinary tool results + `AgentEventBus` events, exactly like `camera.capture` does today.

## 3. Spatial capability core (new)

**Implementation status (Phase 2.1):** shipped. Tiers 1–3 are live and reachable from chat; tiers 4–5 are
enforced by the guard but have no applier and are reported `not_configured`. The authoritative API,
including the revision contract and the anti-bypass guarantees, is [`SPATIAL_API.md`](SPATIAL_API.md);
acceptance evidence is in `docs/acceptance/master-capability-upgrade/phase-2-1/`. One deviation from this
design: existing Cosmos/Genesis entities are **not** registered into the graph yet — the planned read-only
`SpatialAdapter` is deferred to 2.2.

### 3.1 Modules

| Module | Responsibility |
|---|---|
| `SpatialSceneGraph.ts` | Single observable snapshot of the live scene: nodes (id, kind, parent, transform, visibility, material keys, tags), camera (position/target/zoom), lighting summary, and a `revision` counter. Built by reading the existing R3F tree via a registration hook; it never owns geometry. |
| `SpatialObjectRegistry.ts` | Stable `SpatialObjectId` → `{ nodeRef, authored, tier, capabilities, provenance }`. Provenance records whether the object came from the scene, from procedural authoring, or from an agent build — so LÉLU can answer "did I make this?". |
| `SpatialTierGuard.ts` | Maps operation → required tier → risk → permitted. Refusals are typed results (`{ ok:false, reason:"tier-insufficient", requiredTier: 3 }`), never silent no-ops. Tier is granted by configuration + approval, not by UI state. |
| `SpatialIntentBus.ts` | `intent → guard → apply → verify → event`. Apply is delegated to registered appliers (camera, material, transform, construction). Every applied intent emits `AgentEventBus` `tool_started`/`tool_result` so the existing activity surfaces show it. |
| `SpatialCapabilityManifest.ts` | Registers the spatial capabilities in the existing `CapabilityManifest` so cognition's self-model knows what it can do *right now*. |

### 3.2 Tiers are permissions, not labels

| Tier | Operations | Enforced by | Real effect |
|---|---|---|---|
| 1 OBSERVE | `scene.list`, `scene.inspect`, `scene.relations`, `camera.read` | read-only appliers | none |
| 2 MANIPULATE | `object.move/rotate/scale/setVisible`, `material.set`, `light.set`, `camera.set` | `SpatialTierGuard` + undo journal | mutates the live scene, reversible |
| 3 CONSTRUCT | `object.create`, `object.duplicate`, `object.delete`, `scene.compose` | guard + authorization for destructive ops | new/removed objects, recorded in provenance |
| 4 ORCHESTRATE | `scene.build` (multi-step plan → build → validate → revise) | `CreativeOrchestrator` + guard | sequences Tier 3 ops with validation between steps |
| 5 AUTONOMOUS WITH APPROVAL | `scene.propose` → preview render → approval → `scene.commit` | existing `AuthorizationQueue` pattern + guard | executes a prepared change set only after approval |

Refusal tests are the acceptance criterion: for each tier, an operation above the granted tier must return
`tier-insufficient` **and must not touch the scene** (asserted by comparing the revision counter).

### 3.3 Integration with what exists

| Existing system | How it is used |
|---|---|
| `GenesisState` / `GenesisStateMachine` | scene mode + visual mode drive which appliers are legal |
| `WorldRegistry` | attention destinations; the avatar's "where am I looking" |
| `CosmosEntityRegistry` / `CosmosStore` | long-scale (cosmos) entities appear as graph nodes at `scale: "long"` |
| `GenesisCameraIntent` / `GenesisCameraController` | camera appliers reuse the existing intent bus — one camera authority |
| `RenderStore` / `Procedural3DPipeline` | Tier 3 construction + preview renders |
| `AgentEventBus` | every applied intent is observable in the existing timeline |
| `ToolResolver` | spatial intents are detected in the existing stage and return real results into context |
| `CapabilityManifest` | truthful availability for cognition and the Device panel |

### 3.4 Non-goals

No physics engine, no new renderer, no new state library, no second scene tree. If physics becomes
necessary it is an applier behind the guard, added later with its own justification.

## 4. Avatar spatial presence (extension, not a new system)

`AvatarPresenceBridge` today maps three real AIService signals to `idle|thinking|speaking|listening`. The
upgrade adds a **spatial presence** channel beside it:

```ts
interface SpatialPresence {
  position: [number, number, number];
  orientation: number;        // radians, facing
  attention: { kind: "object" | "destination" | "user"; id: string } | null;
  traversal: "idle" | "moving" | "inspecting" | "constructing";
  revision: number;
}
```

Sources of truth: `SpatialObjectRegistry` (what is near), `WorldRegistry` (destination), `SpatialIntentBus`
(construction state), AIService signals (dialogue state). Consumers: `LeluCharacter`/`LeluRig` for animation
selection, `AvatarCommandBus` for imperative moves, `AgentEventBus` for observability.

Hard rule from the brief: the avatar is not decoration. Every presence change must be caused by a real event
(tool applied, attention target selected, destination change), and the same event must be visible in the
activity timeline so a screenshot and a log can be cross-checked.

## 5. Browser execution (one tool, pluggable backend)

```ts
interface BrowserBackend {
  readonly id: "server-read" | "neko";
  available(): Promise<CapabilityState>;
  open(url): Promise<SessionRef>;
  read(ref): Promise<PageContent>;             // existing /api/browse behaviour
  screenshot(ref): Promise<{ png: string; meta: SessionMeta }>;
  navigate(ref, url): Promise<void>;
  act(ref, action: BrowserAction): Promise<ActionResult>;  // click/type/scroll — may be unsupported
  state(ref): Promise<SessionMeta>;
  close(ref): Promise<void>;
}
```

- `server-read` is today's `BrowserTool` path, unchanged, always present when the server middleware runs.
- `neko` registers only when `VITE_NEKO_URL` is set **and** a real session check passes. If the deployed Neko
  does not expose a supported control channel, `act()` returns `unsupported` for this backend — the tool
  says so instead of pretending.
- `BrowserSession` is a small state machine (`idle → opening → open → acting → verifying → closed`) whose
  transitions emit `AgentEventBus` events for the existing chat/browser panels.
- Every mutating action passes `AuthGate`'s `AuthorizationQueue`; form submission and downloads are
  high-risk by the existing classification.

Honest separation, preserved in the API and the UI copy: **browser automation** (this section) ≠ **remote
desktop** (Neko's own surface) ≠ **physical device screen sharing** (Device Bridge, platform-permitting) ≠
**native app integration** (none exists).

## 6. Visual engine

`RenderEngine` gains a `scene` kind implemented by `Procedural3DEngine` (existing pipeline, offline, no key):
a Tier 3 construction can render a preview PNG through Three.js. External image/3D providers remain behind
the existing provider slots (`not_configured` without a key — currently Meshy). No new provider abstraction.

## 7. Voice

`VoiceEngine` remains the only voice implementation. Additions: input-device enumeration/selection,
explicit microphone permission surface, and a diagnostics readout naming the live path (Web Speech vs Groq
Whisper) and the last recoverable error. LiveKit is deliberately **not** wired into chat; it appears only in
the Device Bridge's media gateway, behind a session.

## 8. Cross-device readiness (the seam)

```
LÉLU (this repo)                       Device Bridge (separate repo, separate service)
┌──────────────────────────────┐       ┌──────────────────────────────────────────┐
│ ToolResolver (device intents)│       │ /v1 API (hono)  ·  WS events             │
│ DeviceBridgeAdapter ─────────┼──HTTP─►│ DeviceRegistry · SessionManager          │
│  · discover / manifest       │  +WS  │ CapabilityRegistry · PairingService      │
│  · request permission        │       │ ActionBroker (risk + approval)           │
│  · dispatch action           │       │ MediaGateway (LiveKit, optional)         │
│  · emit AgentEventBus        │       │ AuditLog (append-only)                   │
└──────────────────────────────┘       └──────────────────────────────────────────┘
        env-gated, default off            independently deployable, own DB
```

The adapter is a client of a versioned public API. It imports nothing from the bridge and reads no bridge
table. With `VITE_DEVICE_BRIDGE_URL` unset it reports `not_configured`, and every device tool is
unavailable — LÉLU behaves exactly as it does today.

## 9. Testing strategy (LÉLU side)

| Layer | Tests |
|---|---|
| Spatial registry/graph | `tests/spatial-graph.test.ts` — node registration, revision monotonicity, relation queries |
| Tier guard | `tests/spatial-tiers.test.ts` — per-tier allow/deny matrix, "refusal does not mutate" (revision unchanged) |
| Intent bus | `tests/spatial-intents.test.ts` — apply + event emission + undo journal |
| Avatar presence | `tests/avatar-spatial.test.ts` — transitions caused only by real events |
| Browser backend | `tests/browser-backend.test.ts` — `server-read` behaviour preserved; `neko` absent ⇒ `unsupported`, not a fake success |
| Device adapter | `tests/devicebridge-adapter.test.ts` — unconfigured state, manifest parsing, refusal propagation |
| Regression | existing 1065-test suite must stay green; `scripts/verify-*.ts` unchanged |

## 10. Evidence plan

`scripts/evidence/` writes one folder per phase containing: the command line, exit code, stdout/stderr
tails, JSON summary, and PNG captures. Renders come from the real app in a real browser. In this environment
the working browser path is the Cloud browser panel (external Chromium rendering the dev server);
the VM's local Playwright Chromium cannot start (missing `libnspr4.so`, no root to install it). Any capture
therefore records which browser produced it.
