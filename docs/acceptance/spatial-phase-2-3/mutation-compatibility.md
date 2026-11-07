# Entity mutation compatibility matrix (Phase 2.3)

Generated from `SpatialMutationBridge.matrix()`; the reasons below are the same
strings the bridge returns to chat.

| Capability | Authored | Cosmos | WorldRegistry | Live scene node |
| --- | --- | --- | --- | --- |
| position | ✅ | ⛔ | ⛔ | ⛔ |
| rotation | ✅ | ⛔ | ⛔ | ⛔ |
| scale | ✅ | ⛔ | ⛔ | ⛔ |
| visibility | ✅ | ⛔ | ⛔ | ⛔ |
| material | ✅ | ⛔ | ⛔ | ⛔ |
| relationship | ✅ | ⛔ | ⛔ | ⛔ |
| delete | ✅ (Tier 4, owner approval) | ⛔ | ⛔ | ⛔ |

## Owners and reasons

**authored** — owner: the spatial scene graph (this core).
Authored objects are owned by `SpatialSceneGraph`, so a sealed commit is both
authoritative and what the R3F layer renders.
Verification: graph snapshot + live mesh (local position, material, visibility).

**cosmos** — owner: `CosmosEntityRegistry`.
The registry exposes registration, visitation and deactivation, but no transform
or material setter and no change notification. A field write would be neither
authoritative nor rendered, so it is refused rather than faked.

**world** — owner: `WorldRegistry`.
Destinations are labels and metadata (weight, scale class) with no spatial
transform; there is nothing to move, rotate or recolour.

**scene** — owner: the Genesis component that renders the node.
Live three.js nodes (Core, planets, avatar) are rendered products of their owning
component's state and animation. Writing the mesh directly would be overwritten
and would not update the authoritative state.

## Refusal shape

```json
{
  "code": "validation-failed",
  "detail": "\"Scout\" is owned by CosmosEntityRegistry and is read-only for position. CosmosEntityRegistry exposes registration, visitation and deactivation, but no transform or material setter and no change notification. …"
}
```

An unknown reference still refuses with `unknown-object` plus candidates. A
successful authorization returns the resolved entity and does **not** mutate
anything — the caller must go through the existing sealed commit path.

## What is explicitly not supported in this phase

* Deleting existing Genesis/Cosmos entities (lifecycle analysis + separate
  approval required; unchanged from Phase 2.2 policy).
* Mutating Cosmos entities, world destinations or renderer-owned nodes by any
  route, including chat.
* Any second registry, transaction system or authorization path.
