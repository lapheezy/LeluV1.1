# MISSION 16 — Construction Engine + Cosmos Object Ecosystem

Status: **VERIFIED for the construction domains, the object lifecycle, integration/extraction, persistence and zero-model routing. PARTIAL for the Cosmos visual layer and the four remaining demonstration workflows. NOT TESTED on physical hardware.**
Base commit: `a4f5df3` (Mission 15). Branch: `freebuff/capability-expansion`, pushed to `integration/lelu-four-workforce-consolidation`. Mission 15 commits `2513e90` and `a4f5df3` and `1632fe2` are preserved.

## 1. What existed

Mission 15's build framework (`program.build` beside the scene objects, three builders, `creative.build/modify/inspect/domains`, revisions, GLB export). The Cosmos existed as an R3F layer inside the Genesis canvas (`CosmosLayer`, `CosmosRooms3D`, `CosmosStore` for the agent/planet map), the world/Forge environment system (server-routed), and a spatial scene graph. None of them could hold a construction as an independent object.

## 2. What was added

### Construction domains (one framework, not six systems)

`src/core/creative/kit/build/` grew from 3 builders to 7 across 6 domains:

| Builder | Domain | What is actually derived |
| --- | --- | --- |
| `gearbox` | mechanical | pitch radius = m·z/2, centre distances at summed radii, ratio, output speed |
| `v8` | mechanical | displacement = π(b/2)²·s·n, crank radius = stroke/2, banks at ±V/2, one plug per cylinder |
| `cabin` | architecture | bay spacing, floor area, roof rise, ridge height, windows = bays × storeys |
| `molecule` | chemistry | real bond angles (104.5°, 109.5°), ball-and-stick or space-filling |
| `circuit` | electrical | ΣR, I = V/ΣR, P = I²R; an open switch gives exactly zero current |
| `cell` | biology | 4πr², 4/3πr³, surface-to-volume ratio; organelle counts are labelled as model contents |
| `fabric` | textiles | plain/twill/satin interlacement rule, cover factor = 2 × ends/cm × diameter |

Each has own parameter surface, layers, steps, derived facts, notes and `sources`. Unsupported claims are stated in the notes ("no valve train, no combustion", "organelle counts are what the model draws").

New `cosmos` builders' modification vocabulary is wired into the same `parseModification` (V angle, bore/stroke, switch open/closed, cell size, weave, density).

### The Cosmos object ecosystem

* `src/core/cosmos/objects/CosmosObjectTypes.ts` — the object record: stable id, name, domain/builder, source artifact + revision, parameters, a **snapshot of its geometry**, frame (position/rotation/scale), motion, parent/children, group, visibility, lock, place, provenance.
* `CosmosObjectStore.ts` — deterministic operations over it: `spawn`, `transform`, `animate`, `pauseAll`, `select`, `integrate`, `extract`, `isolate`, `showAll`, `lock`, `rename`, `duplicate`, `remove` (to a restorable trash), `restore`, `group`, `ungroup`, `resetPositions`, `list`, `resolve`. Persisted through the existing `KvStore` (`lelu.cosmos.objects.v1`), so a reload restores identity, geometry, relationships, positions and motion.
* `CosmosObjectTools.ts` — 15 tools in the existing registry/dispatcher/gate path: `cosmos.object.spawn|position|transform|animate|select|group|ungroup|integrate|extract|isolate|duplicate|remove|restore|reset|list`. Every one reads its result back from the store before reporting success.
* `CosmosObjectsLayer.tsx` — mounted inside `CosmosLayer`, i.e. the existing Cosmos scene, not a second canvas. It draws each object from its own scene objects, animates spin/bob/orbit/drift, and shows a **contextual strip only when an object is tapped** (Float/Stop, Only this, Take out, Duplicate, Remove, Done). Tapping selects.
* `DirectCompiler` + `AIRouter`: cosmos operations are local deterministic plans and run even when a model is available (`cosmos.object.*` added to the deterministic set). Natural language: "Put it in the Cosmos", "Make it float and rotate slowly", "connect the X to the Y", "separate the X", "take the X out and open it in the 3D workspace", "duplicate the X and make the second one smaller", "show me every object in my Cosmos", "pause all floating objects", "return all the objects to their original positions", plus `/cosmos`.

## 3. Evidence (real application, 384×661 viewport, `?b=15`)

| Step | Request | What the app reported | State read back |
| --- | --- | --- | --- |
| Build | "build a V8 engine" | `v8` builder, 6 layers | 36 parts, V8 (90°), 92 × 82 mm, **4.36 L**, crank radius 41.0 mm |
| Spawn | "Put the V8 engine in the Cosmos." | `cosmos.object.spawn` → obj_2 | `obj_2 V8 engine — 92 × 82 mm @[3,0,-12.8] ×4` |
| Animate | "Make it float and rotate slowly." | `cosmos.object.animate` | `obj_2 spin 0.05 paused=false` |
| Integrate | "connect the V8 engine to the gear train" | `cosmos.object.integrate` | `obj_1 children=["obj_2"], obj_2 parent=obj_1` |
| Extract | "separate the V8 engine" | `cosmos.object.extract` | `obj_2 parent=null`, still 36 parts, still spinning, same id |
| Spawn a second source | "Put the cabin in the Cosmos." | obj_3 | `obj_3 … src=art_98903e492873@r2` (real artifact id + revision) |
| List | "show me every object in my Cosmos" | `cosmos.object.list` | 3 objects with ids, positions, scales, sources |
| Persistence | page reload | — | obj_1, obj_2, obj_3 restored with positions, motion and sources from localStorage |

The replies in those runs say "Done locally on the Cosmos scene — no model involved", and the direct path's response metadata records `modelCalls: 0`. That is counting, not a claim: `DirectResolver` returns before the provider stage and stamps the count in metadata.

## 4. Checks

| Check | Result |
| --- | --- |
| `npx tsc -b --force` | exit 0 |
| `npm run build` | exit 0, 5.6 s |
| `tests/cosmos-objects.test.ts` | 10 pass / 0 fail |
| `tests/creative-build.test.ts` | 18 pass / 0 fail |
| `tests/creative-kit.test.ts` | 17 pass / 0 fail |
| `tests/creation-studio-tools.test.ts` | 9 pass / 0 fail |
| `tests/chat-surface.test.ts` | 31 pass / 0 fail |
| `tests/module-layout.test.ts` | 11 pass / 0 fail |
| `tests/security-containment.test.ts` | 18 pass / 0 fail |

`cosmos-objects` covers: six domains and their computed facts; the three weave rules as rules; word→builder routing for the new builders; spawn/transform/lock; integrate (with cycle refusal) and extract preserving id and byte-identical geometry; groups, duplicate, isolate, remove/restore; refusing to drop children silently; pause-all; determinism of the arrangement; and the cosmos phrases compiling to the right tools with the right arguments. `creative-build` was updated to assert six domains instead of three.

## 5. What is not done, or not proven

* **The objects are not visually verified in the Cosmos.** `CosmosObjectsLayer` is mounted in `CosmosLayer`, but at 384×661 I could not get to an unobstructed Cosmos view (the Chat Universe overlay stayed in front), so there is no screenshot of a floating gearbox. This is NOT TESTED, not "working".
* **Four of the seven workflows were not run end to end in the app.** No furniture/garment builders exist yet, so workflows 2 and 3 (chair into cabin, fabric panel into a garment) cannot be run at all; workflows 4 and 5 (molecule collection, cross-environment round trip) are covered by store tests but not by an in-app run. Workflow 1 (V8) and workflow 6 (persistence) were run.
* **Direct manipulation is tap-select + a control strip**, not drag handles. There are no spatial gizmos, no rubber-band selection, no multi-touch transform.
* **Ambiguous verbs.** With objects present, "remove the idler" is read as removing an object called "idler" and refused, instead of being treated as a gearbox modification. The gate uses "is there a Cosmos" plus the words in the sentence, which is a heuristic, not understanding.
* **No undo stack.** Removal is restorable from the trash, but there is no general undo for transforms.
* **`/cosmos <verb> <arg>` parsing is thin** — it reuses the natural-language matcher, so `key=value` forms are not understood.
* **Scale is a modelling decision.** Objects arrive at scale 4 because the Cosmos is drawn at scene scale; a half-metre engine would otherwise be a dot. Stated in code, not hidden.
* Objects live in one store with a 120-object cap; there is no per-environment membership beyond `place` (cosmos/workspace/gallery).
* Mobile was a simulated narrow viewport; no hardware, no touch-gesture test.

## 6. Remaining work

1. Opens: furniture/garment builders so the architecture and fashion workflows can exist; a Cosmos camera preset that frames the objects so the layer can be verified visually and used.
2. Drag/gizmo manipulation, multi-select, undo.
3. Per-environment membership (one Cosmos per environment rather than `place`).
4. Distinguish "remove an object" from "remove a part" by inspecting the current conversation state, not by verb alone.
5. Import: bring an exported GLB back in as an object.
