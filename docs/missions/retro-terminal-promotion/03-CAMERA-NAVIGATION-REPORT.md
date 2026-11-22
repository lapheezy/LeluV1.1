# 03 · Camera navigation report

## Original issue

This is finding N1/N2/N3 of `docs/missions/COSMOS-INTEGRATION-AUDIT.md` (audit branch `claude/cosmos-integration-audit-t9ouny`, `b291a88`).

- **N1.** `CosmosNavigation.currentId` could change from three places: a 3D ring tap, a Cosmos workspace panel row, or LÉLU's `cosmos.workspace navigate`. Only the ring tap moved the camera. The other two moved the highlight and left the view where it was.
- **N2.** Every `cosmos-navigate` / `planet-navigate` started its own rAF lerp, so two flights fought over one camera, and a user drag did not stop a flight.
- **N3.** Navigation did not claim the camera, so the ambient ExplorationController flew away from the chosen destination within seconds.

None of this was on canonical. The Retro Terminal (`1ff3829`) worked around N1 by flying the camera itself from `goto` / `back`.

## Recovered implementation

The source is commit `7510070`, and only that commit (see 01). It changed:

- `cosmos/CosmosRooms3D.tsx`: follows `currentId` and flies every arrival, or `resetToGenesis` for the core. It does not fly on load.
- `cameraFlight.ts` (new): the controller's `flyCameraTo`, moved verbatim, with two additions:
  - one flight at a time;
  - a flight stops when `cameraOwner()` becomes `"user"`.
- `GenesisCameraController.tsx`: uses `cameraFlight.flyCameraTo`.
- `cosmos/CosmosLayer.tsx`: `__cosmosCamera.navigateTo` / `resetToGenesis` call `claimCinematicCamera()`. The same commit also brings star-field buffers, nearest-first detail meshes, and the first-paint subscription.
- `engines/InfiniteCosmos.ts`: preload emits, plus a chunk cap and a cached snapshot. These are the commit's dependencies for the first-paint sky. Generation is unchanged.
- Tests: `tests/camera-flight.test.ts` (4) and `tests/infinite-cosmos.test.ts` (8).
- Harness: `scripts/verify-cosmos-integration.mjs`.

The `CosmosLayer.tsx` auto-merge kept canonical's M17.3 placement-hazards effect.

## Integration changes (this mission)

| File | Change | Why |
|---|---|---|
| `home/RetroTerminal.tsx` `goToNode` | No longer flies the camera after a successful navigate. It re-centres only when the target is already the current place (the same rule as a ring tap). | With N1 fixed, the terminal's own flight was a second controller racing the authoritative one. For the core, the terminal flew to `(0,0,-15)` while CosmosRooms3D reset to the Genesis view `(0,0,6.8)`: two different answers. |
| `home/RetroTerminal.tsx` `back` | No longer flies. `CosmosNavigation.back()` changes `currentId` and CosmosRooms3D flies. | Same reason. |

Result: one navigation authority (CosmosNavigation, via WorkspaceAPI), one camera mover (CosmosRooms3D → `__cosmosCamera` → GenesisCameraController → `cameraFlight`), and one OrbitControls. No controller was added.

## Verification

| Requirement | Evidence |
|---|---|
| Navigation reaches the correct destination | Browser, 3 viewports. Terminal `goto <planet>`: `current === planet`, camera at `(0, 20, −21)`, which equals the ring framing. `evidence/browser-run-1-all.txt` and `browser-run-2-tablet.txt` |
| Camera follows navigation | Same. Audit harness: LÉLU `navigate` (actor "lelu") reaches the destination at 3 sizes. `evidence/regression-verify-cosmos-integration.txt`, 30/30 |
| Orientation consistent | The flight lerps the OrbitControls target to the destination (lookAt = ring centre). Orientation is derived from controls, as before |
| Zoom / scale | `cosmosScaleStore` is `planet` before and after layout switches (browser) |
| Layout switch keeps the camera | Camera identical (±0.3) across terminal → My Home → terminal. The same WebGL canvas element survives |
| `goto` / `back` use the same authority | Code: neither flies directly any more. Browser: `back` returns to the galaxy framing |
| Existing camera controls | `tests/camera-flight.test.ts`: a user grab stops a flight; a cinematic claim does not |
| No competing controllers | One flight loop alive (unit test). The terminal's duplicate flight was removed |
