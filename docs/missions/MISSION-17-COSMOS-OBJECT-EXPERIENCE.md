# MISSION 17 — COSMOS OBJECT EXPERIENCE (partial: the view is open, the objects are still not seen)

Status: **PARTIAL. The door is open and the camera is real; the objects themselves were not captured visibly rendering.**
Base: `8101ec2` (Mission 16). Local branch `mission-17-cosmos-object-experience`, pushed to `integration/lelu-four-workforce-consolidation`.
Preserved: `1632fe2`, `2513e90`, `a4f5df3`, `8101ec2`. No force-push, no history rewrite, nothing merged to production.

## 1. The actual cause of "Chat Universe stayed in front"

Not the panel state. Three separate things:

1. `activePanel === "none"` closes the chat *panel*, but the **Chat Universe is a different surface with its own open flag** (`chat/universe/universeOpen.ts`). It kept rendering over the canvas no matter what `openPanel` did. Fixed: the Universe is not rendered at all while the Cosmos owns the screen (`GenesisInterface`: `homeStore.immersive ? null : <ChatUniverse/>`), and entering the Cosmos closes its open flag; leaving restores it, so the conversation is exactly where it was.
2. The objects' default ring was **behind the LÉLU core**. `ringSlot` put every spawn at `z = -18`, inside the opaque core/backdrop volume, so the store was right and the screen was empty. The ring is now in front of the core, between it and the default camera (`[x, 0.9, 4]`, radius 3.2).
3. The v1 camera controller **drags the OrbitControls target back to the origin every frame** unless a cinematic claim is held. A framed object slid out of the middle. Fixed by using the existing ownership contract: `claimCinematicCamera()` before a frame, released when the layer unmounts and taken back by the user's own drag.

Verified for (1): with `?b=6`, entering the Cosmos left `document.body` showing only the scene and the dock (`LÉLU 8101ec2+dirty …`), no Universe, `window.__leluImmersive === true`, dock = `‹ Back | 1 object | Focus | Home | Prev | Undo | Redo`.

## 2. What was built

**Camera (Phase 2) — VERIFIED as arithmetic and as a reached pose.**
`core/cosmos/objects/CosmosObjectCamera.ts`: extents per primitive, union bounds over objects and assemblies, and `framePose()` that fits the bounding sphere into the real viewport — the tighter of the vertical and horizontal frustum decides, so a portrait phone backs off further than a landscape one. Modes: all, focus, selected, assembly (object + descendants), zoom, home, previous. Pure functions, no model, tested (`tests/cosmos-object-experience.test.ts`).
`ObjectCameraBridge` (inside the Cosmos scene) computes the pose from the live camera fov and canvas aspect and dispatches the existing `cosmos-navigate`; it then **checks whether the camera actually arrived** and, if a fly was swallowed (covered scene, presence recentre), sets the pose through the same OrbitControls. Evidence: requested `[6, 4.06, −7.36] → [6, 1.72, −18]` (distance 10.89); the live camera measured **11.38** with a cinematic claim held (`window.__leluCameraOwner === "cinematic"`).

**Visibility probe (honesty instrument).** `window.__cosmosObjectsProbe()` reports, per object, its place, visibility, mesh count, distance, **screen pixel position**, whether it is in front of the camera, and pixels-per-metre. This is what showed the remaining truth: an object at `[1.6, 0.9, 0]` with the default camera is at **screen x = 396 in a 384-px-wide viewport** — a portrait phone puts it just off the right edge at five metres.

**Direct manipulation (Phase 4) — implemented, NOT verified on a device.** Drag moves the selection on a plane facing the camera; the whole gesture is **one undo step** (silent updates while the finger is down, one commit on release); shift-tap adds to the selection; the contextual strip nudges ±X/±Y/±Z, turns 90°, scales ×2/÷2, locks, floats/stops, isolates, duplicates, extracts, **takes a part out**, removes and clears. No 3D arrow gizmos; the strip plus drag is what exists.

**History (Phase 6) — VERIFIED by tests.** Whole-Cosmos snapshots, bounded 30 in session and 4 on disk, in the same KvStore record. Undo/redo preserve ids, geometry, parents, groups and provenance; selection is deliberately *not* history; a multi-object drag records one step. `canUndo/canRedo` are part of the store state, so the dock's buttons are live.

**Part extraction (Phase 5/7).** `splitPart(object, part)` pulls one part out as its own object — the crankshaft out of the V8, a seat out of a chair, a panel out of a garment — keeping its material and world position, re-centred on its own origin, removing only that part from the parent (which keeps its id and its part count minus one). Undo puts it back inside.

**Furniture and garments (Phase 7) — VERIFIED by tests.** `buildFurniture` (chair/table/desk/shelf/bed/sofa/cabinet) and `buildGarment` (shirt/hoodie/jacket/pants/skirt/dress) join the shared framework: two new domains (`furniture`, `fashion`), nine builders, ten domains. Furniture derives height/seat/leg length from the parameters (a 62 cm seat moves the surface and lengthens the legs); a long table gains two legs and a table has no back. A garment is front/back panels, sleeves, collar or hood, seams, closures and a fabric swatch, with fabric-used in m² including allowances. `garmentFromFabric()` takes the woven sample's own weave/density/diameter, so a fabric sample *is* the garment's cloth. Its notes state plainly that it is a **pattern-based textile representation, not a graded manufacturing-ready pattern** — no darts, ease curves, grain lines or cut list, and nothing is claimed production-ready.

**Routing (Phase 9) — VERIFIED by tests.** Spoken: "Open my Cosmos", "Frame all my objects", "Return to my Home", "Zoom to the engine", "move the X to the left of the Y", "make the X twice as large", "rotate the X 90 degrees", "undo that". Typed `/cosmos` is parsed as **arguments**, not as a sentence: `open|close|list|frame all|frame <obj>|focus|zoom|home|prev|undo|redo|position <obj> x y z|rotate <obj> deg|scale <obj> n|spawn|extract|split <obj> <part>|integrate|group|ungroup|remove <obj> confirm|restore|place <obj> <where>|select|animate|pause|resume`. `/cosmos remove obj_1 confirm=true` now names `obj_1`, not "obj_1 confirm=true". Unknown verbs fall back to a read, never a mutation.

## 3. Why the objects were still not seen — the honest part

The layer is mounted (the camera bridge inside it answers, and the probe reports its objects), the store is right, the camera arrives, and the projection puts an object on screen coordinates — yet **no screenshot in this session shows a chair.** What was ruled out and what remains:

- Ruled out: the Universe covering the scene (fixed and verified); the objects being behind the core with the new ring; the camera not going where asked (measured); the store being empty or the place filter excluding them (probe).
- Still open: whether the meshes are actually in the *render* scene, and whether the Cosmos' decoration draws over them. The last two attempts (drawing the objects with `depthTest:false` in their own pass, and moving the ring in front of the core) have not been shown to work, and the diagnostic that would have counted overlay meshes in `scene.traverse` did not land in the built probe.

I am not going to call this "working". The acceptance criterion "LÉLU can enter the actual Cosmos and visibly see her objects" is **not met** in this build.

## 4. Checks

| Check | Result |
| --- | --- |
| `npx tsc -b --force` | exit 0 |
| `npm run build` | exit 0 |
| `tests/cosmos-object-experience.test.ts` | 11 pass / 0 fail (new) |
| `tests/cosmos-objects.test.ts` | 10 pass / 0 fail |
| `tests/creative-build.test.ts` | 18 pass / 0 fail |
| `tests/creative-kit.test.ts` | 17 pass / 0 fail |
| `tests/creation-studio-tools.test.ts` | 9 pass / 0 fail |
| `tests/chat-surface.test.ts` | 31 pass / 0 fail |
| `tests/module-layout.test.ts` | 11 pass / 0 fail |
| `tests/security-containment.test.ts` | 18 pass / 0 fail |
| Lint | not run (no lint script in this package) |
| Device matrix (iPhone/tablet/desktop), performance, memory, WebGL-off | NOT TESTED — one emulated 384×661 viewport in Chromium |

Live evidence collected: build a chair (9 parts), spawn (`obj_2 @[1.6, 0.9, 0]`, source `art_…@r1`), enter the Cosmos from the dock, Universe gone, camera framed (`__cosmosCameraStatus` ok, measured arrival 11.38), dock controls live. Zero model calls in every one of those steps (direct path replies "no model involved", `modelCalls: 0` in metadata).

## 5. What remains

1. **Find out why the meshes are not on screen** — count them in the render scene, check the layer group's visibility/scale in the built tree, and confirm whether the object pass is drawn at all. This is the one blocker.
2. Then: gizmos (only nudges exist), device matrix, performance pass, and the seven workflows end to end (only build → spawn → enter ran here; furniture integration, garment panel extraction, molecule grouping, cross-workspace round trip and undo-through-reload were not run in the app).
