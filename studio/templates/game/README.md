# Rift Runner 3D

A playable third-person 3D prototype. Speak to the Keeper, recover four
shards from the ruins, then walk into the rift gate. Real collision,
real controls, a real quest state and a HUD that reads it.

## Run

```bash
node scripts/build.mjs      # verifies vendored three.js + writes dist/
node --test tests/          # 11 world-logic tests, no GPU needed
```

Then open the preview (the studio serves `dist/` inside a Cosmos window).

## Controls

- **WASD / arrow keys** — move. **E** — talk / advance. Drag — orbit the camera.
- On touch devices an on-screen d-pad and a Talk/Take button appear.

## Structure

- `src/logic.js` — the world as pure state: collision (circle vs AABB),
  pickups, gate, NPC dialogue, quest, win condition. Fully tested.
- `src/main.js` — three.js rendering, input and camera; it never decides
  game rules.
- `vendor/three.module.js` — vendored so the game runs offline.
- `assets/character-card.png` — Session 3B's character reference, used as
  the player's card art.

## Assets, honestly

The character GLB and rig in Session 3B's forge ledger are still
`awaiting_approval` (Meshy costed jobs). No GLB exists on disk, so the
figure is procedural geometry plus the real reference card. When 3B's
`forge-c4c1e9c2` completes, its GLB can replace the figure without
changing `logic.js`.

## Limitations

- Single-player only; no networking or multiplayer.
- No sound, no animation rig, no saved progress.
- Collision is 2D (XZ) against upright boxes; there is no verticality.
