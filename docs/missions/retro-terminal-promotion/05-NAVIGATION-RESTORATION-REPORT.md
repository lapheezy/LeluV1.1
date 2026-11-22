# 05 · Navigation restoration report

## The existing persistence architecture (unchanged in kind)

| State | Owner | Persisted? |
|---|---|---|
| Current destination, trail, visit counts, user/LÉLU rooms | `CosmosNavigation` → `KvStore` key `lelu.cosmos.nav.v1` | yes |
| Live-map destinations (galaxies, agent planets, projects, open views, SHAMAN) | `CosmosLiveMap.syncCosmosMap` re-registers them from the runtime | no (rebuilt from live records, by design) |
| Selected entity | `CosmosFocus` (a reference only) | no |
| Camera pose | `cameraPoseMemory` (session memory, survives an unmount only) | no (deliberately, as its header explains) |
| Region / sector | `InfiniteCosmos` (derived from the camera) | no |
| Layout / theme | `HomeStore` (`lelu.home.*`) | yes, untouched |

### Why a reload returned to the core

`CosmosNavigation.load()` runs at construction, before any live-map destination is registered. A stored `currentId` naming a planet (`map-agent-…`) was therefore unknown and dropped. So were trail entries and visit counts. The next `persist()` then overwrote storage with `currentId: cosmos-core`.

A second gap: on most Homes nothing called `syncCosmosMap` at all. Only the Cosmos workspace panel, the terminal and LÉLU's tool did.

## Changes (the same store, key and payload shape)

`src/core/cosmos/CosmosNavigation.ts`:

- `load()` keeps the stored values for ids that are not registered yet, as numbers and ids only: `pendingCurrentId`, `pendingTrail` and `pendingVisits`. This applies only to live-map ids (the `map-` prefix of `CosmosLiveMap.MAP_ID`). Any other unknown id is still ignored, as before.
- `register()` of a new node applies what was waiting for it:
  - its visit count;
  - the trail, rebuilt in stored order;
  - the current place, when it was the stored one.
- `persist()` writes the pending values while they wait, so an early write (a room created, another node registered) cannot erase them.
- `navigateTo()` abandons the pending destination and trail. Your newer choice wins.
- New method `settleRestore()`: called by `applyCosmosSnapshot` after every successful sync. It drops whatever the sync did not bring back (the agent, project or view is gone). You stay at the core, and storage stops naming an unreachable place. This is the graceful failure path.
- New methods `restoredArrival()` / `restoredArrivalFramed(id)` tell the scene, without consuming the value, that the current place came from storage and has not been framed yet.

`src/app/scene/genesis/cosmos/CosmosRooms3D.tsx` (the scene side of navigation, which already follows `currentId`):

- On mount, when a restore is pending, it requests one `syncCosmosMap()`. That is the existing function; the Home layouts that never synced now restore too.
- When the restored destination becomes current, either already at mount or on the `currentId` change the sync causes, it re-selects it in `CosmosFocus` (only if nothing is selected) and frames it with the same `flyToNode` flight every arrival uses.
- During start-up the camera API or OrbitControls may not exist yet, and the controller ignores a navigation it cannot carry out. The flight starts synchronously when accepted, so `frameWhenReady` asks again each frame until `cameraFlightActive()` is true. It is bounded to 60 s and cancelled by a newer navigation, by the user taking the camera, or by unmount. The arrival is cleared only once the flight is accepted. This matters because React StrictMode in dev mounts twice and the first cleanup cancelled the attempt; found and fixed during verification.

Nothing new is serialized. No three.js objects are stored, and there is no new store, key, database or service. The camera is derived from the destination, as on any arrival.

## Verification

**Unit, `tests/live-map-restoration.test.ts` (6/6):**

- A reload from a planet waits at the core and restores the planet after the sync, with the trail in order, the visit counts, and the arrival signal.
- An early write does not erase the stored destination.
- A vanished agent falls back to the core, and storage is cleaned on the next boot.
- Navigating before the sync wins over the pending restore.
- Unknown non-map ids are still ignored.
- A persisted room is restored at boot and handed to the scene.

**Browser (`verify-retro-terminal-promotion.mjs`, iPhone 13 / iPad Mini / 1440×900, all PASS):**

| Check | Result |
|---|---|
| reload in the Retro Terminal: current = the planet, no pending restore | PASS ×3 |
| the planet is selected again (`CosmosFocus`) | PASS ×3 |
| the camera frames the planet `(0, 20, −21)` | PASS ×3 |
| the terminal caption reads `LIVE COSMOS · <planet>` | PASS ×3 |
| reload on an original layout ("My Home") restores the same planet, selection and camera | PASS ×3 |
| a stored `map-agent-does-not-exist`: falls back to `cosmos-core`, the trail names only existing places, no page error | PASS ×3 |
| layout and theme preferences | the terminal presentation and its theme return after the reload (also `regression-verify-retro-terminal.txt`, 37/37) |

The original Retro Terminal harness recorded this as a limitation (`NOTE reload: navigation map-shaman → cosmos-core`). After this mission it prints `map-shaman → map-shaman`.

## Limitations

- A restore resolves when the live map syncs. If the runtime stores that feed the sync (agents, projects, views) are not loaded yet at that moment, the destination is treated as gone and you stay at the core. This is the safe direction. Nothing is invented.
- On a phone whose world is unmounted (the Chat Universe owns the screen), no scene exists to request the sync. The restore resolves when Home is shown, or when the panel, the terminal or LÉLU syncs.
- The camera pose itself is still not persisted (`cameraPoseMemory`, by design). After a reload the camera is placed by framing the restored destination, not at the exact pre-reload orbit angle.
