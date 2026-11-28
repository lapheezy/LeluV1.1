# WP21 · Multi-theme graphics engine: report

**Branch:** `claude/wp21-multi-theme-graphics-engine`, branched from the WP20 head `a0a7251e`.
Not merged, not deployed.

**Evidence types:**
- *browser-rendered* means Chromium with SwiftShader, a software GPU.
- *emulated-mobile* means Chromium phone emulation.
- Nothing was tested on a physical device or a hardware GPU.

## Outcome in one paragraph

LÉLU now has a reusable world engine instead of one gradient backdrop. A world is a stack of independent
layers:

- environment;
- atmosphere;
- real 3D objects;
- authored 2D graphics;
- panel frames;
- motion.

Worlds are composed from 17 families, edited live in an editor, saved, duplicated, exported and imported.
They render behind every Thread variant, with the Neural Maps live in front. Time & Place worlds rebuild a
city's scale across eras, each era carrying its sources and how sure it is.

The acceptance run in the real app verifies 17 of 18 checks, with 0 failures. The one not run is
real-device and hardware-GPU testing.

## Architecture

| Piece | File | What it does |
|---|---|---|
| Schema | `src/core/worlds/WorldSchema.ts` | Six slots, 38 renderer kinds, validation and clamping, pure edits (`toggle`, `set`, `add`, `remove`, `world`). Renderer-independent. |
| Families | `src/core/worlds/ThemeFamilies.ts` | 17 families as data, plus `registerFamily` for new ones. `composeWorld(ids)`: the primary keeps sky, ground, frames and motion; others add atmosphere, objects and 2D, plus ground only where the primary has none. |
| Store | `src/core/worlds/WorldStore.ts` | Saved worlds and the active one. Create, combine, duplicate, rename, reset, delete, export, import. Persisted in `lelu.worlds.v1`. |
| Time & Place | `src/core/worlds/Places.ts` | Places and eras as data. Each fact has a source and a confidence label (documented, approximate, illustrative or speculative). `placeWorld(place, era)`. |
| Noise | `src/core/worlds/noise.ts` | Seeded noise shared by terrain, trees and the 2D contours, so they agree. |
| 3D adapter | `src/app/scene/worlds/World3D.tsx` | One WebGL scene. Shaders, instancing, generated meshes; GPU particles moved by a time uniform. |
| 2D adapter | `src/app/scene/worlds/World2D.tsx` | Seeded SVG packs above the canvas, plus a canvas for the glyph rain. |
| Stage | `src/app/scene/worlds/WorldStage.tsx` | Canvas and overlay. Quality tiers (auto measures frames), pausing (off-screen, hidden, covered), reduced motion, orbit camera, panel-frame CSS variables. |
| Editor | `src/app/scene/worlds/WorldEditor.tsx` | Every control edits the saved world, and the stage re-renders from it. |
| Thread host | `src/app/scene/worlds/ThreadWorld.tsx` | World or era comparison behind the Thread; editor beside it; the Thread's panels take the world's frame. |

**How 2D and 3D coexist:**
- 3D layers are drawn in one canvas, ordered by `depth`.
- The 2D layers sit above it as separate SVG elements, so they stay crisp and editable and are never
  rasterised into the 3D scene.
- The Thread's panels sit above both.
- Pointer input on empty space reaches the orbit camera.

## Families (WP03)

| Group | Families |
|---|---|
| nature | volcano, hurricane, underwater, valley |
| celestial | celestial, aurora |
| seasonal | spring, summer, autumn, winter |
| urban | urban neon |
| illustrated | street comic / halftone, hand-drawn doodle |
| culture | Kemet geometric |
| science | quantum, holographic HUD |
| abstract | liquid prism, sacred geometry, digital rain |

Every family is rendered in `docs/missions/wp21/shots/lab-*.png`. The reference translation and the
rights notes are in `docs/missions/wp21/WP01-REFERENCE-ANALYSIS.md`.

## Time & Place (WP04)

**Tampa** has five eras:
- c.1920, before Davis Islands;
- 1957–60 aerials;
- 1999 at dusk, combined with the comic layer;
- present night;
- 2060, imagined.

Lakeland, Atlanta and Tokyo have the present only, labelled as such.

What the engine reconstructs is **scale**, not places:
- Building count, height and fill grow by era.
- Positions are not the real street plan.

The on-screen card and the editor's source list say this. Era comparison renders two eras with a split
slider.

Facts marked *approximate* came from general knowledge and must be checked against the cited archive:
the Davis Islands dredging and the 1990s tallest towers. No archival image was used.

## Acceptance (`scripts/worlds/verify-worlds.mjs` → `docs/missions/wp21/verify-worlds.json`)

| WP | Check | Result |
|---|---|---|
| WP06 | A family chosen in the editor builds a world behind the thread; maps stay live in front | VERIFIED |
| WP09 | Turning a 2D layer off and a 3D layer off each changes the pixels | VERIFIED: 2.8–3.0% and 0.7–1.7% of pixels |
| WP02 | 2D only / 3D only / combined (canvas and SVG counts per mode) | VERIFIED |
| WP05 | Edits, rename and duplicate survive a reload | VERIFIED |
| WP05 | Export/import round-trips exactly; a foreign file is refused | VERIFIED |
| WP09 | Five cross-theme combinations render in the thread | VERIFIED |
| WP04 | An era renders with its confidence and cited sources | VERIFIED |
| WP04 | Two eras compare side by side | VERIFIED: three comparisons rendered |
| WP06 | Raindrop, Ribbon, Live and Workspace all render inside a world | VERIFIED |
| WP08 | Quality tiers apply; auto picks a tier from measured frames | VERIFIED |
| WP06 | Turning the world off restores the thread's own look | VERIFIED |
| WP08 | Reduced motion freezes the world | VERIFIED |
| WP08 | 320×740, 375×812, 390×844, 430×932: no overflow with a world on | VERIFIED (emulated) |
| WP10 | No page errors from the engine | VERIFIED |
| WP08 | Physical iPhone / hardware GPU | NOT RUN |

**Frame cost (SwiftShader, software).** The whole app runs at about 3 fps here even without a world (a
366 ms median frame, mostly the in-thread 3D map). With a world it measured 3–5 fps, so the world didn't
make it slower in this environment. These numbers can't predict a real GPU, so performance on hardware is
**unmeasured**.

**Tests:** `tests/worlds.test.ts` has 11 tests covering:
- every family composes with valid kinds;
- group coverage;
- composition rules;
- validation;
- edits;
- store persistence;
- export/import;
- every era carries sources and confidence;
- Tampa's scale grows by era;
- deterministic terrain.

**Typecheck** (`tsc -b --force`): 0 errors. **Build:** passes. **Lint:** clean, except one fast-refresh
notice per file that exports a helper.

## Rights

- Every layer is procedural code: no reference image was copied, traced, embedded or textured.
- Franchise, brand and character references were used only as broad visual language, or not at all where
  that would recreate a protected world.
- Kemet ornament is limited to the documented lotus-and-bud frieze and a stepped pyramid. No hieroglyphic
  text is generated, and nothing is mixed with other traditions.
- The zodiac uses the standard Unicode signs.

## Remaining gaps (honest)

1. **Source review (WP01).** The 167 atlas sources were classified from the atlas's descriptions; the pages
   themselves were not opened in this session.
2. **Cosmos (WP07).** Prepared, not mounted. The world is plain data with an id, and `WorldScene` is an
   ordinary react-three-fiber scene that can go inside the Genesis canvas. It hasn't been mounted there.
3. **LÉLU's own tools.** She has no tool calls yet to create, edit or combine worlds; the owner does it
   through the editor.
4. **Missing families.** Cinema-inspired worlds, wildlife biomimicry, sports arenas, and the retro-interior
   atlas (store, electronics shop, bedroom, studio, atelier). These need a room foundation, a prop library
   and archival research.
5. **Other cities.** Earlier eras for Lakeland, Atlanta and Tokyo, and real street plans (they need
   archival maps).
6. **Performance.** Real-GPU and physical-phone measurements.
7. **Editor placement.** On desktop the editor overlaps the chat column while open. It closes with ✕ or 🌐.
