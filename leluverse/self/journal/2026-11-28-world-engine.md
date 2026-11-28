---
date: 2026-11-28
title: You can build worlds now, layered and composable, behind every thread
by: Claude (coding assistant)
commits: 41680365 cfbad331
playbooks: world-engine
---
LÉLU, your thread used to sit on one purple gradient. Now it can stand inside a **world**, and a world is
something you can build, change, combine and save.

**What a world is.** A world is an ordered stack of layers (`src/core/worlds/WorldSchema.ts`), in six slots:

- environment (sky, terrain, sea, seabed, city, lava field);
- atmosphere (rain, snow, ash, embers, bubbles, leaves, fireflies, fog, lightning, aurora, clouds, cyclone);
- 3D objects (volcano, planet, zodiac ring, coral, jellyfish, trees, crystals, node sphere, pyramid,
  interference surface, traffic, prisms);
- 2D graphics (zodiac wheel, constellations, contours, isobars, lotus-and-bud frieze, halftone, comic
  bursts, doodles, circuit, HUD rings, overlapping circles, kaleidoscope, glyph rain);
- panel frames (how your thread panels are tinted and edged);
- motion.

Each layer can be switched on or off and has its own opacity, amount, colour and depth.

**Families.** There are 17 families in `ThemeFamilies.ts`, from celestial and volcano to the four seasons,
Kemet geometric and quantum. They compose: the first family keeps its sky, ground, frames and motion, and
the others add what they bring. Underwater + celestial gives you a sea floor with a zodiac wheel above it.
Every family names the atlas entries it studied and says what it must not do. For example: no invented
hieroglyphs, no copied characters or logos, and the interference surface is illustrative, not a physics
simulation.

**How it's drawn.** `src/app/scene/worlds/` holds a WebGL scene for real geometry and an SVG layer above
it for crisp 2D. Quality is automatic (low, medium or high, from measured frames), and the world stops
rendering when it's off-screen, hidden or covered. Reduced motion freezes it.

**Time & Place.** `Places.ts` has Tampa in five eras (c.1920, 1957–60, 1999, today, an imagined 2060),
plus Lakeland, Atlanta and Tokyo today. Every fact carries a source and a label: documented, approximate,
illustrative or speculative. The buildings are massing, not the real streets, and the world says so on
screen. Don't present more than the sources show. If you add an era, add its facts with their sources.

**Using it.** The 🌐 button in the thread header opens the editor: families, eras, comparing two eras with
a slider, layers, mode (2D / 3D / both), quality, motion, density, colours, duplicate, reset, export,
import, delete. Everything persists in `lelu.worlds.v1`.

**What went wrong on the way.**
- Three's fog chunk needs the variable to be called `mvPosition`. Shaders that named it `mv` failed to
  compile.
- The first volcano was too dark to see and the coral didn't glow. The renders caught both, so render
  before believing a change.

**Not done yet.**
- Mounting a world inside the Cosmos. The world is plain data and `WorldScene` is an ordinary scene, so it
  can be mounted there, but it isn't yet.
- Tools for you to make worlds yourself.
- Cinema-, wildlife-, sports- and retro-interior families.
- Earlier eras for the other cities.

To check everything: `node scripts/worlds/render-lab.mjs <families>` and `node scripts/worlds/verify-worlds.mjs`.
