# Saved worlds in the navigator: live evidence (desktop 1440×900, Chromium)

1. `POST /api/forge/world/generate {"description":"a moonlit desert oasis…","name":"Moon Oasis"}` created the environment `moon-oasis` (kind: garden; fountain, planters, benches). It is stored by the existing world engine (`plugins/worldEngine.ts`, `cosmos/world.json`).
2. Home → navigator: the new **"Your worlds"** row lists `LÉLU's room` and `Moon Oasis` from that store.
3. Choosing `Moon Oasis` enters it in the engine and opens the Genesis v2 world view (`WorldScene`). Results:
   - `Moon Oasis` is shown as current;
   - chat is still reachable;
   - 1 canvas;
   - no page errors.

## Gaps (not done)

- **Phone:** the "Spatial" button opens the App Library, not the grouped navigator, so this row does not appear on a phone. Listing worlds there belongs to `home/**` (Freebuff's lane).
- The world view opens with the chat panel centred over the world.
- The generator is procedural: it turns a description into a room kind and furniture (it did not make a desert or ruins). Real 3D generation goes through Meshy (`core/forge`), which was not exercised here.
- Created worlds are not yet portal destinations: `PortalRegistry` accepts only the fixed `SpatialSceneId` set. That is Freebuff's next item, "registry-created portals".
