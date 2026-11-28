# Cosmos × Chat Universe unification (v3 + diagnostics): status report

- **Branch:** `claude/wp21-multi-theme-graphics-engine`, which now includes Freebuff's one-dial
  navigation (merge `75ce056a`).
- **Not merged to production. Not deployed.**
- **Evidence types:**
  - *desktop*: Chromium 1440×900 with a software GPU, in the running app;
  - *emulated phone*: Chromium at 390×844 with touch emulation. **Not a physical device.**

## WP00: who owns what (reused, not duplicated)

| Capability | Owner (existing) | What this mission did |
|---|---|---|
| Navigation, destinations | `interaction/destinations.ts`, `home/dialMenu.tsx`, `SpatialNav` (Freebuff, merged) | Utilities became nested rings in the dial. Arc layout in `core/interaction/geometry.ts`. Dial slot in chat headers |
| Scene and panels, window lifecycle | `GenesisCore` (`openPanel`, `minimizeModule`, modules) | `openPanel("none")` now minimises conversation windows instead of destroying them |
| Chat Universe open state and mode | `chat/universe/universeOpen.ts`, `universeModel.ts` | The Cosmos destination closes the hub. Default mode is floating |
| Conversation objects and positions | `core/thread/ThreadObjects.ts` (one store, per-variant transforms) | New `diagnostics` kind. No second store |
| Thread modes (variants) | `core/thread/ThreadVariants.ts`, `ThreadStage.tsx` | Unchanged. Keyboard move, touch sizes |
| Neural Map data | `core/neural/multiverse/liveAspects.ts` (canonical V1, V2, V3) | `mentions.ts` reads it; it never builds its own map |
| Tools | `ToolRegistry`, `ToolDispatcher`, `DirectCompiler`, `AIRouter`, `Orchestrator` | `diagnostics.run`, `neural.show`; direct-run rules |
| Running project tests | `EngineeringWorkspace.checkFiles` → `/api/engineer/command` | Used by the `unit` suite. No second runner |
| Voice | `VoiceMicButton` and `VoiceEngine` (Freebuff) | Every mic goes through it |

Named in the spec but **not found** in the repo: `InterfaceCatalog`. Nothing was created in its place.

## WP01: the seven modes against the screenshots

| Mode | Status | Note |
|---|---|---|
| Browsing | **Not a mode** | It is an activity light (shown when a page is open). Pages open live in Neko in every mode |
| Raindrop | **Different from the spec** | Here it is a visual thread mode (objects fall as drops). The spec describes a reference collection; that is **not built** |
| Liquid workspace | Real, distinct | |
| Ribbon thread | Real, distinct | |
| Live workspace | Real, distinct | Has the V1/V2/V3 dock |
| Chat + browser | Real, distinct | |
| Freestyle | Real, distinct | Validated with the chat (below) |

## Acceptance (§13 and §19)

| Criterion | Status | Evidence |
|---|---|---|
| Summon Chat Universe from the Cosmos without leaving it; hide and reopen with state intact | **VERIFIED** (desktop) | Round trip through the real dial: Freestyle → dial → Cosmos → dial → Chat Universe → reopen. Same mode, same 3 objects, moved object still at +60/+30 (`scripts/diagnostics/cosmos-roundtrip.mjs`, `shots/roundtrip-*`) |
| The dial is reachable inside a conversation | **VERIFIED** (desktop) | It was unreachable under the Universe on desktop; now it is in the chat or Thread header slot |
| The primary Cosmos is the default and recognisable; a way back | **VERIFIED** | Dial → Cosmos closes the hub and minimises windows (`shots/roundtrip-2-primary-cosmos.png`) |
| Seven real, distinct modes | **PARTIAL** | 6 real. Browsing is a light, and Raindrop as a reference collection is not built |
| Chat-derived layouts applied to a Cosmos *region* and reversed | **NOT STARTED** | Modes apply to a conversation's Thread, not to regions of the Cosmos |
| Neural Map from conversation content, real entities only | **VERIFIED** (V2) | A typed question → V2 with 5 real nodes, each with its own evidence. No invented nodes (tests) |
| Neural Map V1 and V3 contextual | **PARTIAL** | V3 resolves executives (unit). V1 is empty outside the browser and was not exercised |
| Freestyle + chat as one variant (§17 a–e) | **VERIFIED** (desktop, emulated phone) | 28 pass / 0 fail on desktop, 23 / 0 on the emulated phone, after fixing 5 defects the runs found |
| §17 f: physical iPhone | **BLOCKED** | No physical device here. The check says so instead of passing |
| Drag, resize, rotate, group, layer, collapse | **VERIFIED** (desktop) | Measured by the a-spatial checks |
| The same gestures on a physical iPhone; pinch and two-finger rotate | **BLOCKED / NOT STARTED** | Physical device not available. Pinch and two-finger rotate are not implemented |
| LÉLU performs the same spatial actions by language; locks, undo/redo | **NOT STARTED** | Only `neural.show` and `diagnostics.run` act from language so far |
| State survives reload, mode switch, return to Cosmos | **VERIFIED** | Reload restored dx 33 / dy 17. Mode switch reused the same object ids. Round trip above |
| State survives nested zoom, suspend/resume | **NOT STARTED** | |
| Lightweight by default, per-workspace consent, measured resource release | **NOT STARTED** | Existing: the Cosmos render pauses while the Universe hides it (workspace mode) |
| Planets and portals not built; extension point recorded | **VERIFIED / NOT STARTED** | Nothing was built. The extension-point note is not written yet |
| Diagnostics from the Cosmos chat: a real run, not a description | **VERIFIED** | Typed "Validate Freestyle, including chat" → a run in about 30 s (`shots/chat-diag-*`) |
| Diagnostics panel beside the chat; streams; PASS, FAIL, PARTIAL, BLOCKED, NOT RUN with evidence | **VERIFIED** | `DiagnosticsObject.tsx` |
| Rerun with before/after; history per conversation | **VERIFIED** | "23 → 23 pass, no check changed status" |
| Propose a scoped repair, ask for authorisation, apply, rerun | **PARTIAL** | Each check states its next step and that step's kind. Applying a repair from the panel is not wired |
| No VERIFIED without a real run | **VERIFIED** | A completed run is no longer reported as "verified" (fixed). Unit tests check this |
| Existing regressions pass | **PARTIAL** | 979 tests across the 99 affected test files pass, plus the new tests. The full `npm test` was not run in this phase |

## Defects found by the measurements and fixed

1. The move handle was pointer-only. It now moves with the arrow keys.
2. Touch targets were under 44 px; the map bar only appeared on hover (invisible on a phone); the object
   header covered the first link; the composer hint wrapped and was cut off.
3. After the merge, the orb sat on top of Search. A 14-option circle ran off the screen and overlapped
   on a phone. A corner arc crowded the screen edge.
4. The dial couldn't be reached inside a conversation on desktop.
5. Dial → Cosmos left the Chat Universe hub on top, and returning destroyed the conversation windows.
6. The diagnostics panel arriving mid-run broke the move check.
7. A diagnostic run with a FAIL in it was reported as "verified".
8. "I lost my memory" surfaced the Neural Map.

## Next work packages

1. **Raindrop:** build it as the reference collection, or rename it. This is the owner's call.
2. **Spatial actions by language:** LÉLU acting on the conversation's objects ("bring the map beside
   this thread", "collapse the map but keep it") through `ThreadObjects`, with locks and undo/redo.
3. **Modes on Cosmos regions:** Chat-derived layouts applied to regions of the Cosmos, with
   return-to-primary (WP05 remainder).
4. **Lightweight workspaces:** per-workspace consent and measured resource release (WP08).
5. **Nested zoom** (WP07).
6. **Physical iPhone run:** run "Validate Freestyle, including chat" from the phone's chat.
7. **Regressions:** the full `npm test`.
