# Unified Ecosystem: Phase 0, Actual Current State

Date: 2026-11-07. Established from `git fetch origin` and read-only inspection. Nothing was modified in this phase.

## 1. Authoritative branch

| | |
|---|---|
| Integration branch | `claude/master-integration` |
| HEAD (live, origin) | `a329bcb`, "Phase 2: live product creation passes 15/15" |
| `a329bcb` present? | Yes. **No commits after it.** |
| Working tree | Clean |

## 2. Active work not yet in integration

| Branch | Author | Age | Commits not in integration | Content | Status |
|---|---|---|---|---|---|
| `claude/gallant-ritchie-v7i0fn` | Claude (another session) | about 2 h | **8** | API ecosystem phases 0–8: source catalog, reference providers, research routing, Settings view. **Phase 9: `UsageLedger`, `UsageBudgetGate`, `UsageSync`**, plus Supabase migration `202611070001_usage_records_and_budgets.sql` (51 files, +5066) | Based on `62ddd61`. **A dry-run merge into `a329bcb` is clean, with no conflicts** (throwaway worktree, discarded). The last two commits are marked Phase 9 / WIP. |
| `freebuff/b51087…` (`ab34483`) | Freebuff | 4 days | 1 | Secret-name aliases | Superseded by `abec038` (see `FREEBUFF_COMMIT_AUDIT.md`) |
| `lelu-verify/*`, `claude/env-probe-*` | — | over 10 days | 1–4 | Test-README markers and probe notes | Nothing to integrate |

All other Freebuff and Claude branches are fully contained in integration. **Not merged:** `gallant-ritchie` is another session's active work, and merging it is the owner's coordination decision. It directly supplies the Phase 9 cost and usage instrumentation, so merging it *before* Phase 9 avoids building a second usage system.

## 3. Related repositories

| Repository | State | Missing from the primary? |
|---|---|---|
| `lapheezy/L-lu` | **Empty**: no commits on any ref | Nothing to integrate |
| `lapheezy/Lelu` | 2 files: `README.md` and `phase2-earthcore-planetexplorer-unify.diff` | The diff (PlanetExplorer follows EarthCore's camera) is **already in LeluV1.1** (`PlanetExplorer.tsx:57, 1094–1133`). Nothing to integrate. |

## 4. What LÉLU already has, by capability

These are existing implementations to retain. Directive Phase 7: compare before replacing anything.

| Capability | Existing implementation |
|---|---|
| App shell, shared state | `GenesisCore` (one state, used by 66 files), `GenesisInterface`, `GenesisModuleHost` (one window system: `chat:`, `artifact:`, `atelier:` …), `surface/Surface.ts` (surface ownership), `SpatialNav` |
| Rendering | three 0.185, **@react-three/fiber 9.6, @react-three/drei 10.7 (already in use)**, `GenesisScene`, `GenesisV2Scene3D`, `SceneFrameGovernor`, `AdaptiveQuality`, `SceneRenderBudget` |
| Conversation | `GenesisChat`, Chat Universe, `MultiChatStore`, `TurnOwnership`, `TurnActivity` |
| Creation | `core/studio` (Creation Studio, verified exports), `core/atelier` (directions, BOM, CAD/3D writers) |
| Orchestration | `Orchestrator`, `TaskPlanner` → `TaskEngine` → `TaskExecutor` (steps, retries, checkpoint/resume), `ApprovalGate`, `workflows/` (`WorkflowEngine`, `WorkflowStore`, `AgentWorkflowBridge`) |
| Hierarchy | `executive/ExecutiveBoard` and `ExecutiveRuntime`; SHAMAN, galaxies and agent universes (18, 12 and 3 files reference them); `agents/` |
| Browser | `/api/browse` relay (SSRF-safe, `plugins/safeFetch.ts`), `core/browser/BrowserTool`, `GenesisBrowserPanel` (inside LÉLU) |
| Development | `core/engineering` (`WorkspaceRuntime`, `SandboxRuntime` + worker, `GitHubIntegration`, `AnthropicEngineeringAgent`), `GenesisEngineeringPanel` |
| Earth | `core/earth/EarthCore` and providers and tools, `GenesisEarthCore`, `PlanetExplorer` (three.js globe; **no Cesium**) |
| 3D assets | `core/forge` (`ForgeClient`, `MeshyCatalog`, `GlbInspector`, `MotionGlb`), `PlacedModel` |
| Worlds | `core/world` (`RoomGenerator`, `Physics`, `WorldTools`), `cosmos/CosmosEntityRegistry`. **No persistent, addressable world store yet.** |
| Usage and cost | **None in integration** (no token counts are recorded). It exists on `gallant-ritchie`. |
| Testing | Playwright 1.62, mobile e2e in CI, live product-creation e2e |

## 5. Candidate repositories: initial position

These are initial positions, before the per-library licence, bundle-size and mobile audit that Phase 2 requires.

| Repo | Initial position | Reason |
|---|---|---|
| react-three-fiber, drei | **Already integrated** | In use; keep |
| pmndrs/uikit | Evaluate | No spatial UI library today; in-world panels for worlds and agents |
| react-three-offscreen | Experimental | Worker rendering of the avatar and Cosmos; iOS Safari OffscreenCanvas + WebGL support must be measured first |
| tldraw | Evaluate, licence first | Infinite canvas for Atelier. **The tldraw SDK licence, as last known, requires a licence key (or a watermark) for production use. Check it against the current terms before adopting; it is an owner decision.** |
| xyflow (React Flow) | Evaluate | MIT; visual agent/workflow graphs over the existing `WorkflowEngine` (UI only, no second engine) |
| browser-use | Backend only | Python service; needs an isolated runtime. The UI stays the existing panel and chat. |
| playwright | **Already integrated** | Add WebKit runs for Safari |
| langgraphjs | Likely reject | Duplicates `TaskEngine`, `TaskExecutor`, `ApprovalGate` and checkpointing. Adopt only for a measured gap. |
| vercel/ai | Likely reject as core | Would duplicate `AIService`, `AIRuntime` and `AIProviderRegistry`. At most, provider adapters. |
| gods-eye-view (Cesium) | Evaluate | Cesium is heavy (several MB); load it lazily as a Cosmos layer and keep `PlanetExplorer` as the fallback |
| Meshy | Audit the existing `core/forge` | Verify real API calls and asset persistence |

## 6. Known open issues carried into the next phases

From `PHASE_2_CHAT_MOBILE_REPORT.md`:

- Raw markdown and horizontal overflow in Universe bubbles.
- A model revision removed an unrelated paragraph.
- The avatar re-uploads its textures on returning Home.
- No physical iPhone test.

## 7. Proposed execution order

Each step is verified live and committed separately.

1. **Owner decision: merge `gallant-ritchie`.** It provides usage and cost data for every later report.
2. **Phase 6 fixes first, because they are known defects:**
   - chat markdown and overflow;
   - revision preservation;
   - a single avatar instance with no texture re-upload.
3. **Phase 4 core: a persistent, addressable World store.** It builds on `world/` and `CosmosEntityRegistry`, and lets chat and agents create, save and revisit worlds.
4. **Phase 1/3 continuity:** keep the conversation, project, selected artifact and camera across Chat, Cosmos, Studio and Atelier. The shell already exists; this step closes the gaps.
5. **Phase 2 library integrations, one at a time, each behind a measured benefit:** xyflow, then uikit, then tldraw (after a licence decision), then Cesium (lazy), then offscreen (experimental).
6. Then browser-use backend, multi-agent world building, and the full Phase 8 verification matrix.
