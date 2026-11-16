# Where every world entity actually lives

Phase 2.2 made existing entities addressable. Phase 2.3 had to establish who owns
them before anything could be changed.

```
chat / resolver
     │  AIRouter stage 1.6 SPATIAL
     ▼
SpatialResolver ──parse──▶ SpatialIntentBus
     │                          │
     │                          ├─ SpatialTierGuard (T1..T5, single-use approval)
     │                          ├─ SpatialSceneGraph  ◀── AUTHORITATIVE for authored objects
     │                          │        │
     │                          │        └─ SpatialObjectRegistry (identity, materials, provenance)
     │                          ├─ SpatialCameraApplier ──▶ genesisCameraIntentBus ──▶ genesis-v2-camera DOM bridge
     │                          └─ SpatialMutationBridge ── AUTHORIZATION ONLY, never writes
     │
     ▼
SpatialSceneGraph revision ──▶ SpatialLayer (three.js) ──▶ live meshes
                                     │
                                     ├─ window.__leluSpatialProbe()
                                     └─ mirrors Core / planets / avatar as read-only nodes

CosmosEntityRegistry  ── entities (position, kind, active)  ── READ-ONLY from spatial
WorldRegistry         ── destinations (label, weight, scale) ── READ-ONLY from spatial
Genesis components    ── own their meshes and animation     ── READ-ONLY from spatial
```

## Ownership table

| Entity type | Authoritative state | Stable identity | Scene owner | Lifecycle owner | Transform owner | Material owner | Relationship owner | Existing mutation API | Rendering sync |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Authored spatial object | `SpatialSceneGraph` (revision + snapshot) | `SpatialObjectRegistry` id, namespaced ref | `SpatialLayer` | `SpatialSceneGraph` | `SpatialSceneGraph` | `SpatialSceneGraph` | `SpatialSceneGraph` (relationships map) | sealed commit via `SpatialIntentBus` → `SpatialSceneGraph.commit` | R3F layer reads the graph snapshot |
| Cosmos entity | `CosmosEntityRegistry` | registry id, `cosmos:<id>` | none (registry is data) | `CosmosEntityRegistry` (active flag) | field on the entity, **no setter** | none | none | `register`, `visit`, `deactivate`, `getAll` | not observed by the registry |
| WorldRegistry destination | `WorldRegistry` | `key` | none | `WorldRegistry` | none (no transform exists) | none | none | `register` (metadata) | n/a |
| Live three.js node (Core, planet, avatar) | the owning Genesis component | live name, `scene:<name>` | the component's `<Canvas>` | the component | the component / animation loop | the component | the component | none exposed | the component's own render loop |

## Why the read-only rows are read-only

* **Cosmos** — the registry has no `updateTransform`/`setMaterial` and emits no
  change notification. A spatial write would change a field nobody re-renders,
  and would be lost on the next registry read. Refusing is the only honest answer.
* **WorldRegistry** — destinations are labels and metadata (`weight`, `scale`
  class). There is no transform to move or rotate.
* **Live three.js nodes** — those meshes are products of their component's state
  and animation. Direct writes are overwritten on the next frame and would leave
  authoritative state untouched, which the phase brief explicitly forbids.

## What Phase 2.3 added

`SpatialMutationBridge` — a compatibility layer, not a second system:

* takes the existing `SpatialAdapter` discovery result,
* maps each entity source to its owner and its allowed capabilities,
* allows only `authored`, refuses the rest with the owner and reason,
* records decisions in a bounded audit trail,
* is consulted by `SpatialIntentBus.resolveTarget()` so chat answers with the owner
  instead of "not in the scene".

It writes nothing, owns no state, issues no seals and does not duplicate the
registry.
