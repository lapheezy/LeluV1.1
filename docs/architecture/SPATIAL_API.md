# SPATIAL CAPABILITY API (Phase 2.1)

Authoritative reference for the spatial core shipped in `src/core/spatial/`. It states what exists, what it
refuses, and what it does **not** claim.

## 1. Operations and tiers

Tiers come from [`SECURITY_AND_PERMISSION_MODEL.md`](SECURITY_AND_PERMISSION_MODEL.md); the table below is
the single source of truth enforced by `SPATIAL_OPERATIONS` in `SpatialTierGuard.ts`.

| Operation | Tier | Mutates | Destructive | Approval | Implemented |
|---|---|---|---|---|---|
| `scene.list` | 1 observe | no | no | no | yes |
| `scene.inspect` | 1 observe | no | no | no | yes |
| `object.move` | 2 manipulate | yes | no | no | yes |
| `object.rotate` | 2 manipulate | yes | no | no | yes |
| `object.scale` | 2 manipulate | yes | no | no | yes |
| `object.setVisible` | 2 manipulate | yes | no | no | yes |
| `material.set` | 2 manipulate | yes | no | no | yes |
| `scene.undo` | 2 manipulate | yes | no | no | yes |
| `object.create` | 3 construct | yes | no | no | yes |
| `object.connect` | 3 construct | yes | no | no | yes |
| `object.delete` | 3 construct | yes | **yes** | **yes, per execution** | yes |
| `scene.recover` | 4 orchestrate | yes | no | no | **no** (`not-implemented`) |
| `scene.compose` | 4 orchestrate | yes | no | no | **no** (`not-implemented`) |
| `scene.commit` | 5 autonomous | yes | no | no | **no** (`not-implemented`) |

Default grant: **tiers 1, 2 and 3**. Tier 4 and 5 are refused with `tier-insufficient` even when an approval
phrase accompanies the request, and `SpatialCapabilityManifest` registers them as `not_configured`.

## 2. Revision contract

- A graph starts at revision `0`.
- Every accepted commit increments the revision by exactly `1`, regardless of how many mutations the commit
  carries (a create + link batch counts once).
- A refused commit leaves the revision **and** the scene untouched; tests compare the full snapshot deeply,
  not just the counter.
- `undo` and `recover` are themselves commits, so they also produce a new revision instead of silently
  rewinding history.
- Intent callers may pass `expectedRevision`; a mismatch returns `stale-revision` with `expectedRevision` and
  `actualRevision`, and changes nothing.

## 3. Surfaces

```ts
SpatialSceneGraph.getInstance()
  .snapshot(): SpatialSceneSnapshot              // frozen objects + relationships + revision
  .getRevision(): number
  .subscribe(listener): () => void
  .commit(request, authorization): SpatialCommitResult
  .undo(authorization): SpatialCommitResult
  .recover(snapshot, authorization): SpatialCommitResult

SpatialTierGuard.getInstance()
  .grant(tier): void  .revoke(tier): void  .grantedTiers(): SpatialTier[]  .maxGrantedTier(): SpatialTier
  .operation(id): SpatialOperationDef
  .authorize(ops, options): { ok, authorization } | { ok: false, refusal }
  .requestApproval(ops, opts): ApprovalTicket      // single use, 120 s TTL

SpatialIntentBus.getInstance()
  .apply(intent, options): Promise<SpatialIntentResult>   // guard → build → validate → commit → verify → event

SpatialObjectRegistry.getInstance()
  .resolve(reference)   .findByName(name)   .all()   .describeContents()

SpatialPresence.getInstance()
  .get() / .subscribe()   // { position?, attention, traversal, lastAction, revision }
```

Results are typed: `{ ok, op, revision, message, refusal? }`. A refusal always names a `SpatialRefusalCode`
(`tier-insufficient`, `approval-required`, `approval-invalid`, `stale-revision`, `validation-failed`,
`unknown-object`, `already-exists`, `limit-exceeded`, `unauthorized`, `not-implemented`,
`verification-failed`) with a human-readable `detail`.

## 4. Why the guard cannot be bypassed

- `SpatialSceneGraph.commit` requires a `SpatialAuthorization` value minted by `SpatialTierGuard.authorize`;
  the structure is validated (`ops`, tier, issued-at) before use.
- `SpatialObjectRegistry.write` requires an unforgeable `SpatialWriteSeal` held in a module-private
  `WeakSet` symbol; the registry rejects any write that is not sealed, so a caller with the registry alone
  cannot inject objects.
- The graph never exposes its internal object map by reference; `snapshot()` returns frozen arrays.
- Destructive operations need a single-use approval ticket: `SpatialTierGuard.requestApproval` with the
  owner's confirmation, 120 s TTL, consumed on first authorization. The chat resolver mints one only for an
  explicit phrase (`…, I approve`), and the ticket is not reusable for a second delete.
- Post-commit verification: if the committed snapshot does not match what the plan promised, the bus undoes
  that commit and reports `verification-failed` instead of describing a scene it did not get.

Hard bounds (`SPATIAL_LIMITS`): 64 objects, 128 relationships, positions within ±40, scale 0.05–20, names
≤ 48 chars, 50-entry undo history. Violations are refused, never clamped silently.

## 5. Chat mapping (deterministic, pre-provider)

`SpatialResolver` runs in `AIRouter` as stage **1.6 SPATIAL**, after `SurfaceResolver` and before any
provider call, so these commands work with **no AI provider configured**:

| Phrase (examples) | Intent |
|---|---|
| `create a red cube at the left called Nova` | `object.create` (box, colour `#ef4444`, position from the left/right descriptor) |
| `add a blue sphere at the right called Comet` | `object.create` (sphere) |
| `move Nova up by 2` / `move Nova to -1.2, 0, 4` | `object.move` (delta or absolute) |
| `make the cube metallic gold` / `make the sphere glow blue` | `material.set` |
| `connect Nova to Comet` | `object.connect` |
| `delete Comet` | `object.delete` → `approval-required` |
| `delete Comet, I approve` | `object.delete` with a single-use approval |
| `undo` / `what's in the scene` | `scene.undo` / `scene.list` |

The resolver returns a normal chat reply; the same commit emits `AgentEventBus` tool events, so the existing
activity surfaces show it.

## 6. Rendering integration

`src/app/scene/genesis/spatial/SpatialLayer.tsx` mounts inside the **existing** canvases
(`GenesisV2Scene3D` for `genesis-unified`, `GenesisRenderer` for `genesis-v1`) and renders one mesh per
spatial object named `spatial:<id>`, plus drei `Line` relationships. No second renderer, no second scene
tree, no new state library. Meshes read the graph through `useSyncExternalStore`, so only a commit moves them.

The layer publishes a read-only diagnostic, `window.__leluSpatialProbe()`, returning
`{ revision, presence, objects: [{ id, name, rendered, worldPosition, visible, color }] }` where
`worldPosition` is `getWorldPosition()` from the live three.js object and `color` is read from its material.
It exposes nothing that is not already on screen and is used only for acceptance evidence.

## 7. Known limits

- Tier 4–5 appliers (`scene.compose`, `scene.commit`) do not exist; `scene.recover` is enforced but
  unimplemented. The manifest says so.
- Existing Cosmos/Genesis entities are **not** registered as spatial nodes in this phase; the graph owns only
  objects authored through the spatial API. The planned read-only `SpatialAdapter` over `GenesisState`,
  `WorldRegistry` and `CosmosEntityRegistry` is Phase 2.2 work.
- Camera manipulation and lighting are not spatial operations yet.
- World positions inherit the Genesis group's rotation, so the same committed local position yields a
  different world position over time. This is reported, not hidden.
