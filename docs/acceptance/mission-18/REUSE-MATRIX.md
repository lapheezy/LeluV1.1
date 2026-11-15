# Mission 18 — Reuse / Adapt / Build / Reject matrix

Inspected before writing any code, on branch `freebuff/400773963b8c2504ea15ec77`
(base `a4f5df3`), with the Mission 16 creative engine uncommitted in the tree.
Nothing another mission owned was moved, renamed or overwritten.

## Reused as-is

| Capability | Where | Why it is reused |
|---|---|---|
| Cosmos spatial placement store | `src/core/cosmos/SpatialObjects.ts` | Already the one "position and pointer" store: placement is idempotent by record, persisted through KV, with subscribe/move/pin/remove. Creative objects are placed through it instead of a new scene store. |
| Cosmos inspection | `src/core/cosmos/CosmosInspector.ts` | Reads the real record behind a placed pointer. One new branch (`link.kind === "creative"`) makes a placed garment inspectable; no second inspector. |
| Spatial core (scene graph, tiers, camera, verification) | `src/core/spatial/*` | Untouched. It governs primitive scene objects and camera ops; the creative engine does not duplicate it. |
| Tool pipeline | `ToolRegistry`, `ToolDispatcher.registerExecutor`, `AutonomyGate` | The two new tools join the same table, gate and activity events. No parallel registry or dispatcher. |
| Object/tool presentation infrastructure | `src/core/creative/kit/*`, `StudioStore`, `Scene3D` | Left intact; `Scene3D` still owns the three.js → GLB path for scene programs. |
| Pattern drafting, textile library, PBD cloth solver, sculptural generators, CPU PMG renderer | `src/core/couture/{pattern,textiles,cloth,sculptural,garment}.ts`, `scripts/lib/render-png.ts` | The Mission 16 engine is extended, not reimplemented. |
| KV persistence layer | `src/core/storage/KvStore.ts` | Reached through an injected storage port (`browserStorage`), so the store also runs headless in tests and in the demo. |

## Adapted (extended in place)

| Capability | Change |
|---|---|
| `SpatialObjects` | `SpatialKind` gains `"object"` — a pointer to a real creative object. Placement, move and remove keep their semantics; taking an object out removes the placement, never the record. |
| `CosmosTools` | `SPATIAL_KINDS` gains `"object"` so the workspace tool can place one. |
| `CosmosInspector` | Reads and opens a `creative` record: revision, parts, triangles, components and their detached state, materials, placement, history. |
| `Bootstrap` | Calls `registerCoutureTools()` beside the existing registrations. |
| Garment assembly | Now emits per-component parts, sockets and a sleeve generated from the drafted sleeve pattern piece (cap height, bicep, wrist, underarm length). |
| Pattern | `netOutline` accepts any piece-shaped outline, so pattern pieces can be triangulated into geometry objects without a second draft path. |

## Built (genuinely missing)

| File | Why it had to exist |
|---|---|
| `src/core/couture/objects.ts` | Stable object identity, parts with real meshes, component hierarchy with sockets and attachment state, transforms/motion, placement lifecycle (cosmos / workspace / library), detach-reattach-reuse, duplicate, archive, permanent delete with confirmation, snapshot undo/redo, integrity checks, injected persistence. |
| `src/core/couture/components.ts` | Turns a built garment and a drafted pattern into parts/components/sockets, and generates the sleeve mesh from the drafted sleeve piece. |
| `src/core/couture/product.ts` | Parametric product and jewellery engine: typed variables with ranges and units, an expression evaluator (no `eval`) for derived variables, furniture/lighting/accessory templates, jewellery templates, a faceted brilliant cut, bezel and prong settings, volume → estimated metal weight from handbook densities, exploded assemblies. |
| `src/core/couture/exporters.ts` | GLB (glTF 2.0 binary), OBJ, pattern SVG, orthographic drawing SVG, project JSON — each paired with a reader that re-parses the bytes. |
| `src/core/couture/CoutureTools.ts` | `couture.design` and `couture.objects` through the existing registry/dispatcher, with argument validation before execution. |
| `src/core/cosmos/CreativeObjectBridge.ts` | Places/removes creative objects using `SpatialObjects`; lists what is actually floating. |
| `scripts/mission18-demo.ts`, `tests/couture-objects.test.ts` | Executed end-to-end evidence and regression tests. |

## Rejected

| Candidate | Reason |
|---|---|
| A second object store / scene manager / window manager | `SpatialObjects` + `CreativeObjects` + existing workspace engine already cover placement and identity. A parallel store would fragment object identity. |
| Babylon.js or another 3D engine | three.js is already the app's 3D engine; a second one doubles the scene graph. |
| LangGraph / LangChain | Explicitly excluded; every lifecycle operation here is deterministic code, no model call. |
| Cloud generation (TRELLIS, Hunyuan3D, Meshy) | Breaks the offline-first and no-paid-inference constraints. Licence research from Mission 16 stands; nothing was added. |
| ComfyUI / FreeCAD as runtime dependencies | GPL/LGPL and process-level integration for a capability the engine already provides locally. |
| Blender as a rendering dependency for these images | No GPU or Blender in this environment; the CPU renderer produced the files shown, and they are labelled as CPU previews. |
| A new dependency for glTF export | `Scene3D`'s exporter needs a browser document; the mesh-level GLB writer is dependency-free, validated by re-parsing, and keeps headless verification possible. |
| React Three Fiber mesh layer for creative objects | **Not built in this pass.** The Cosmos record, inspector and open-view path are wired; drawing the actual meshes inside the in-app Cosmos layer is the remaining UI work. Reported as incomplete rather than claimed. |
