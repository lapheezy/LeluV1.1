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

---

# 17.1 — THE RENDER PIPELINE, TRACED

**Status: MET for the blocker.** A chair from `CosmosObjectStore` is a visible,
manipulable mesh in the running Cosmos. It was already being drawn; four
separate faults made it invisible, untouchable or unverifiable, and three of
them are repaired here.

## 1. The trace, boundary by boundary

One chair (`obj_5`, 9 parts, oak, 46 × 48 × 86 cm) was followed from the store
to the frame. Evidence is the live probe `window.__cosmosObjectsProbe()`, which
walks the **real** R3F scene with `scene.traverse` instead of trusting React.

| Boundary | Evidence |
| --- | --- |
| store | `obj_5` present, `place: cosmos`, 9 parts, scale 4 |
| mesh construction | 9 `boxGeometry` parts, `MeshStandardMaterial` (oak `c99a6a`, frame `6f757e`), `transparent: false`, `opacity: 1` |
| React/R3F mounting | group found in the scene by `userData.cosmosObjectId` |
| scene membership | `scene.traverse` → 1 636 meshes, 6 scene children, the object's group **among them**; `mounted: ["obj_5"]`, `missing: []` |
| camera | `PerspectiveCamera` fov 55, near 0.1, far 1000, `layers.mask 1` (same as the object), aspect 0.581 = 384/661 |
| frustum | `Frustum.containsPoint(world)` → `true`; `chainVisible: true`; `renderOrder 900`; `parentType: Group` |
| canvas | `gl.domElement.isConnected === true`, 384 × 661 |

**The object disappears at no boundary.** It is in the render scene, in the
frustum, visible through its whole parent chain, with an opaque material. The
first genuinely broken boundary was therefore not membership but **framing**:
the same chair occupied 24 px/m at 25 m after "frame all", 47 px/m at 13 m,
106 px/m at 6 m. Sparse, low-contrast pixels read as "nothing rendered".

## 2. The four faults, in the order they were hit

1. **Bounding-sphere framing.** `framePose` fit the sphere around the object's
   box against the *narrow* axis of a portrait phone. The sphere is dominated
   by height, so a 1.8 m chair was framed from **11.3 m** (fill 0.84 of the
   sphere, about 100 px of chair). Fit the box axis by axis instead:
   `distance = max(halfWidth/tan(hFov/2), halfHeight/tan(vFov/2)) · padding +
   halfDepth`. Same chair, same viewport → 5.9 m, ~450 px.
2. **Stale camera aspect.** After the phone surface unmounted and remounted the
   world, the projection matrix kept the previous size: taps landed ~57 px from
   the pixels under the finger, and `project()` reported screen positions that
   did not match the picture. The layer now keeps `camera.aspect` in step with
   the canvas (measured: 0.581 = 384/661).
3. **Decoration ate the taps.** R3F's event walk raycasts the whole scene;
   cones and spheres parked 1.9–2.6 m from the camera took every `pointerdown`
   before a chair 5–25 m away. Clicking empty sky selected an object; clicking
   the object often did nothing. The layer now raycasts **its own objects**
   (`intersectObjects(registeredGroups)`) and selects/drags from that hit, so
   nothing decorative can take a tap. Verified: click on sky → no selection;
   click on the chair → `selection: ["obj_5"]`.
4. **Demand frameloop never invalidated.** The world canvas runs on demand.
   Store mutations re-rendered React and changed the transforms, yet no frame
   was requested: move/rotate/resize produced byte-identical frames. The layer
   now calls `invalidate()` on every store change; four consecutive strip
   actions produced four different frames (md5 of each differs).

Also recorded, **not** a fault: while chat owns a phone screen,
`surface.cosmosRendered` is false and the whole world scene is unmounted on
purpose. A probe taken in that state reports a detached canvas (0 × 0) and an
empty scene; that is the documented architecture, not a render bug.

## 3. Screenshots (real Chromium 384 × 661, the running application)

- `artifacts/perf/m17-trace-crop.png` — 6× crop of the chair at the moment it
  was first proven drawn (45 m, ~26 px).
- `artifacts/perf/m17-chair-focused.png` — after the framing fix: chair fills
  the frame, contextual strip "chair — 46 × 48 × 86 cm · 9 parts".
- `artifacts/perf/m17-single-chair-frame-all.png`, `m17-a-base.png` — a single
  chair on screen through the normal render loop (not a manual camera set).
- `artifacts/perf/m17-select-a.png`, `m17-scale-half.png`, `m17-rotate-2.png` —
  selection and transform edits, each a different frame.
- `artifacts/perf/m17-part-split.png` — `leg-left-back` extracted as `obj_6`,
  its own group in the scene at `[4.08, 1.33, 0.4]` beside the 8-part parent.
- `artifacts/perf/m17-part-undo.png` — undo: one object, 9 parts again; redo
  returns 8 + 1.

## 4. Verified in the running app

| Requirement | Result |
| --- | --- |
| real store object becomes a visible mesh | MET — probe + screenshots |
| camera frames/focuses it | MET — all / selected, measured distances |
| stays visible through the normal loop | MET — screenshots taken seconds after the flight, no manual camera set |
| move / rotate / scale redraw immediately | MET — strip actions, distinct frames |
| select by pointer | MET — object-only hit test, sky clicks ignored |
| extract a component as an independent object | MET — `obj_6`, own scene group |
| undo / redo the extraction | MET — 9 parts → 8+1 → 9 → 8+1 |
| remove from Cosmos and restore | MET — `remove` moves it to the trash and the dock count drops; `restore`/undo brings it back (run earlier in the session) |
| Chat Universe / navigation unaffected | MET — dock works before and after, orbiting with a real drag moved the camera and it stayed |

## 5. Files changed

- `src/core/cosmos/objects/CosmosObjectCamera.ts` — box-fit `framePose`.
- `src/app/scene/genesis/cosmos/CosmosObjectsLayer.tsx` — object id on each
  group, `scene.traverse` probe (scene membership, world matrix, frustum,
  layers, render order, materials, canvas wiring), camera-aspect sync,
  object-only pointer hit test, `invalidate()` on store change.
- `src/core/cosmos/objects/CosmosObjectTypes.ts` — `ringSlot` default z 4 → 7.2,
  out of the core's room cluster.
- `tests/cosmos-object-experience.test.ts` — the framing test now asserts the
  box corners are inside the frustum on both axes instead of the sphere radius.

## 6. Remaining limits, honestly

- **Viewport coverage is one emulated 384 × 661 Chromium viewport.** No desktop
  screenshot and no real device was used in 17.1; Chromium emulation is not
  iPhone hardware testing.
- Objects still default into the core's room cluster when the persisted
  position came from an older ring; a spawn in this build reported
  `[3.2, 0.9, 0]` inside those rooms, and the core's sphere can sit in front of
  a chair. Placement in open space is the next fix, not a rendering one.
- The probe's projected `screen` coordinates use the camera's last uploaded
  matrix, which can lag the drawn frame by one step; the pictures and the hit
  test (which raycasts at event time) are the authority.
- History, performance, memory, WebGL-off and the seven workflows end to end
  are unchanged from Mission 17 and were not re-run here.
