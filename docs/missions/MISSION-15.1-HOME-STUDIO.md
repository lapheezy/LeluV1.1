# Mission 15.1 — All sixty concepts working; research, blend, merge, create; themes, fonts, elemental borders

Mission 15 left 60 catalogued Home concepts, of which 11 were built. This mission makes **all 60 work** and gives her the tools to research, change, blend, merge and create layouts, and to change the look.

## What she can do now (Design Studio, from the Home's edit bar)

| | |
|---|---|
| **Browse** | 12 compositions, all 60 concepts (search, filter by category) and **My layouts** |
| **Research** | Each concept's notes (composition, hierarchy, input, strengths, weaknesses, accessibility, performance, references) and her own notes, which are saved. **Research with LÉLU** opens the conversation with a `/research …` prompt ready to send; nothing is sent without her. |
| **Layout** | The family on each device (19 families), the parameters (density, lanes, pane share, column width, tilt, depth, a window onto the Cosmos, adaptive ordering, grouped-module view, lane names, links, stack, rail, rings), and every module's size, visibility, dock, pin and order |
| **New layout** | From scratch |
| **Blend** | Two layouts by a weight (order and sizes interpolate; hidden, docked and pinned go by vote; numbers interpolate; looks blend, and two different borders are kept as an outer/inner pair) |
| **Merge** | The family per device from A or B; the arrangement, parameters and look each from A, B or a blend |
| **Look** | 15 themes plus a **generative** one (hue slider, shuffle); 12 font stacks for text and headings (system fonts, nothing downloaded); **13 border effects**: plain, **water barrier**, **fire**, **snow**, ice, aurora, lightning, neon, nature, gold, lava, stardust and sakura; a second border layered inside; strength; animate on/off; radius, glass opacity, backdrop tint, accent and text colours; a live WCAG contrast readout |
| **LÉLU suggests** | Proposes a concept from what is happening (approvals, live work, time of day, unread items, device), with her reason. Nothing changes until she presses Use. |
| **Keep it** | Use as a new presentation (the old one is kept) · Apply to my Home (undoable, with a restore point) · Save to My layouts · Put this look on my Home. The edit bar also has **Save arrangement to My layouts**, and its "New from" lists her own layouts. |

Everything persists: presentations (with their recipe and look) under `lelu.home.presentations.v1`, and her layouts, notes and module usage under `lelu.home.layouts.v1`.

## How

- `homeComposition.ts` gains 9 families (column, strip, rows, stage, lanes, radial, constellation, scatter, twozone), per-device parameters and overrides, a layout **recipe** stored on the presentation, adaptive time/usage ordering (computed at render; never saved over her order), `layoutFromPresentation`, and defensive `readLayout`.
- `homeConcepts.ts` holds a recipe for each concept. `homeConceptNotes.ts` is generated from `m15-home/CONCEPTS.md` by `scripts/home/concepts-from-md.py`.
- `homeBlend.ts` (blend and merge), `homeStyle.ts` (themes, fonts, borders, colour maths), and `homeEffects.css`: each border is a masked, animated gradient ring, plus an SVG turbulence filter that makes the edge itself ripple or burn, plus a decoration (a wave, flames, a snow cap and flakes, icicles, leaves, stars or petals). Motion stops under `prefers-reduced-motion` or the look's own switch.
- A 9th, optional module, **Ask LÉLU**, hands the words to the Chat Universe composer (the open event now carries an optional `draft`).
- No dependency was added.

## Evidence

- `tests/home-concepts.test.ts`, 17 tests. Every concept solves on all three devices with every module accounted for and no grid overlaps; the 60 layouts are pairwise distinct; recipes and looks survive a reload; blends reproduce their parents at t=0 and t=1; merge follows its plan; a hand-arranged Home saved as a layout reproduces exactly; every theme (and 12 generative hues) gives text contrast ≥ 4.5:1; the store's undo, save, delete, apply, notes and usage all work. This found and fixed one bug: #35's 0.82 pane share was clamped to 0.8 on reload.
- Full suite: **2256 pass, 0 fail**.
- `scripts/home/verify-concepts.mjs` drives the real app in Chromium (desktop and iPhone 15 Pro) and takes **a picture at every step and of every concept**, saved to `m15-home/shots-15.1/` (`step-NN-*.jpg`, `concept-NN.jpg`, and `c-00-sixty-concepts.jpg`, a contact sheet of all 60). Results are in `m15-home/verify-concepts.json`: **26/26 verified**.

## Limits

- Fonts are system stacks, so they look different on different devices. Nothing is fetched.
- #40 Today planner is a working layout, but there is still no calendar source, so it shows no appointments.
- Product references in the notes come from general knowledge and were not re-verified; "Research with LÉLU" exists to check them.
- Border effects use SVG filters and run constant animation. That costs GPU time on older phones; the "Animate the borders" switch and reduced-motion both stop the animation. They were not measured on a physical iPhone; this run used Chromium only (no WebKit here).
- In this sandbox, outside services are offline, so the browser log shows network 503 and CORS errors from LÉLU's background research. The acceptance script counts those separately from Home errors.

## Later changes

- **2026-11-15:** [`MISSION-15.2-SPATIAL-BAR-AWAY.md`](MISSION-15.2-SPATIAL-BAR-AWAY.md), commit `6bf290e`, the direct child of this mission's `94e96cb`. The Spatial bar was moved off the Home, and the menu sheets now take taps.
- **2026-11-16:** [`MISSION-15.2-CLOSEOUT-WP03.md`](MISSION-15.2-CLOSEOUT-WP03.md), final verification of 15.2 with three fixes.
