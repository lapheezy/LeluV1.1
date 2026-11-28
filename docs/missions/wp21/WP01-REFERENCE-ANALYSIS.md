# WP21 · WP01 — Reference atlas analysis

**Source:** the owner's PDF *LÉLU Complete Visual Atlas + WP21 Implementation Prompt* (33 pages). It has three
atlases:

| Code | Atlas | Entries |
|---|---|---|
| I | Visual Reference Atlas (spatial UI, neural, astrology, weather, nature, urban/comic/generative) | 76 |
| II | Expanded Addendum (animation, gaming/cinema, Kemet, science, wildlife, sports, locations) | 46 |
| III | Retro Culture, Media & Mobility | 45 |

That is 167 entries. Family `research` fields cite them as `I·27`, `II·25`, `III·28` and so on.

## What was and wasn't inspected

**Honest limit.** In this session I classified every entry from the atlas's own descriptions: category,
source and the visual notes on each line. **I did not open the 167 source pages.** Those pages are research
leads, and many are image-search, Pinterest, Getty, Rockstar or StarWars.com pages whose images can't be
reused anyway. Each source still needs opening, reviewing and a rights check before anything from it is used
beyond broad visual principles. Treat the "technique" column below as the atlas's description turned into
rendering techniques, not as observations of the images themselves.

No reference image was copied, traced, embedded or used as a texture. Every layer in the engine is
procedural geometry, shaders or SVG generated in code.

## Families: what each was translated into

| Atlas family | Composition | Geometry / illustration | Light, material, motion | Engine family (layers) | Rights / care |
|---|---|---|---|---|---|
| I·01–20 Spatial UI / holographic HUD | central volumetric focus, concentric floor rings, panels at varied depth | node sphere, radial gauges, tick rings, grid floor | additive cyan/violet, slow rotation | `holo-hud`: sky (grid) · neural-sphere · hud-rings | study only; no UI copied |
| I·21–26, II·31–33 Neural / 3D networks | node-edge sphere, depth clustering | Fibonacci node sphere with nearest-neighbour edges; interference surface | additive lines, rotation; formula-driven waves | `quantum`, `holo-hud`; Neural Maps stay live thread objects | the interference surface is labelled *illustrative, not a simulation* |
| I·27–34 Astrology / fractal | wheel at centre, constellations, ring systems | 12-sector SVG wheel with 360 ticks, aspect lines, glyphs; 3D glyph ring; ringed planet | gold on violet, slow spin, twinkle | `celestial`, `sacred-geometry` | standard Unicode zodiac signs; overlapping-circle pattern attributed to no single tradition |
| I·35–39 Volcanoes | dark ground, glowing fissures, cone on the horizon | Voronoi-crack lava shader, displaced cone with flow streaks, crater | emissive lava, embers rising, ash falling, plume | `volcano` | original |
| I·40–47 Storms / weather | cyclone from above, shelf cloud, lightning | log-spiral cloud shader with an eye; isobars with a cold front | rain streaks, timed lightning with a bolt, fog | `hurricane` | NOAA imagery is public domain, but none of it was used |
| I·48–51 Underwater | deep floor, light shafts, glowing flora | branching instanced coral, jellyfish bells and tentacles | bubbles, god rays, teal haze | `underwater` | original |
| I·52–60 Nature / seasons | valley, river, layered forest, mist | noise heightfield, carved river, instanced trees (round crowns or pines), contours from the same terrain | seasonal palettes, petals/leaves/fireflies/snow | `valley`, `spring`, `summer`, `autumn`, `winter`, `aurora` | original |
| I·61, II·10–12, II·41–43, III·21 Urban / neon | dense towers, wet street, haze | instanced city with shader windows and neon crowns, traffic light trails | rain, fog, reflective street | `urban-neon` | **no game assets, logos or real signage** |
| I·62–68, II·01–09 Comic / animation | bursts, kinetic lines, colour blocks | toon city with inked edges, SVG starbursts, halftone pattern | flat colour, bold contour | `street-comic`, `doodle` | **traits only**: no characters, likenesses, frames or show identities |
| I·69–76 Generative / abstract | radial symmetry, mirrored seeds | kaleidoscope folds, iridescent prisms (fresnel rainbow shader) | slow rotation | `liquid-prism`, `sacred-geometry` | original |
| II·24 Digital simulation | falling glyph columns | canvas glyph rain using an original glyph set | green on black | `digital-rain` | no film frames or typefaces |
| II·25–30 Kemet / Medu Neter / sacred geometry | registers, borders, monumental forms | lotus-and-bud frieze between banded registers; stepped pyramid | gold, lapis blue, red bands | `kemet` | **ornament only**: no hieroglyphs with invented meanings, no mixing with Islamic or other traditions (II·30 is kept separate) |
| II·41–46, III·25–30 Places | skyline over water, eras | `Places.ts`: eras as data (scale, palette, facts with sources and confidence) | day, dusk and night palettes | Time & Place worlds | massing is labelled illustrative; facts carry confidence |
| II·13–23 Cinema worlds (Star Wars, Treasure Planet, Wakanda, Atlantis, Inception, Matrix) | — | not yet translated beyond `digital-rain` | — | **gap** | broad language only; protected worlds must not be recreated |
| II·34–40 Wildlife, sports | — | not yet translated | — | **gap** | logos and league marks excluded |
| III·01–20, 31–45 Retro retail, devices, music, cars, copper | — | not yet translated | — | **gap**: these need archival 3D props and signage, not filters | brand marks and likenesses need licences |

## Families not yet built (honest gaps)

- **Cinema-inspired worlds** (floating sails over celestial oceans, folding-city architecture, Afrofuturist
  organic towers): the engine has the slots for them, but no family has been authored yet.
- **Wildlife biomimicry** (jaguar rosettes, peacock eyespots, chameleon camouflage) as procedural materials.
- **Sports arenas** and live data layers.
- **The retro atlas** (1998 video-rental store, 2002 electronics shop, PS2-era bedroom, cassette scene,
  Motown-inspired studio, copper atelier). These are interior *places* that need period props and signage
  reconstructed from archival sources. They don't fit the current outdoor environment layers, and they need
  a room foundation and a prop library.
- **Earlier eras for Lakeland, Atlanta and Tokyo:** only the present is modelled, and each is labelled so.
