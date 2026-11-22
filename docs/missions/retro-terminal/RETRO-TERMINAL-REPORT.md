# Infinite Cosmos × Retro Terminal: customizable layout, Color Studio and multicolor theme engine

Base: `integration/lelu-four-workforce-consolidation` @ `904d254`. Branch: `claude/sharp-knuth-l3d7i3`. Not deployed.

## WP01: Audit of the existing layout and theme systems

| System | Where | What it is |
|---|---|---|
| Infinite Cosmos layouts | `home/homeComposition.ts` (`TEMPLATES`, `CompositionKind`, `solveHome`) | The Home is painted over the live Cosmos scene. A *layout* is a composition template (12 built-ins + 60 concepts + custom layouts) solved per device class. |
| Layout selection | `homeStore.ts` presentations, plus `CosmosHome` → `HomeEditBar` (“Presentation”, “New from”), and `HomeDesignStudio` | Each presentation points at a layout. Switching is `HomeStore.applyPresentation` / `createPresentation`. |
| Theme / colour | `home/homeStyle.ts` (`THEMES`, `resolveStyle`, `contrast`, `parseColor`) | Per-presentation look: 15 palettes, 8 colour slots, CSS custom properties (`--glass`, `--ink`, `--accent`, …). |
| Design tokens | `cosmosHome.css` `.lch` variables, set by `resolveStyle().vars` | The Home's modules read `--glass/--edge/--ink/--ink-2/--ink-3/--accent/--radius/--hc-font`. |
| Persistence | `core/storage/KvStore` via `HomeStore` (`lelu.home.v1`, `…presentations.v1`, `…layouts.v1`) | localStorage, then sessionStorage. Each concern has its own key. |
| Responsive | `deviceClassFor` (phone < 700 ≤ tablet < 1100 ≤ desktop), with separate profiles per device | |
| Cosmos state owners | `CosmosNavigation` (region/trail), `CosmosFocus` (selection), `CosmosObjectStore`, `InfiniteCosmos` (camera/chunks), `WorldLifecycle`, `cosmosScaleStore` | None of them are owned by the Home. |

**Integration decision.** Retro Terminal is a 13th built-in composition (`retro-terminal`) with a new composition kind, `terminal`. Its appearance is a new slice of the **same** `HomeStore` (`terminal`), persisted under its own key (`lelu.home.terminal.v1`) through the **same** KvStore, following the presentations/layouts pattern. The colour parsing and WCAG contrast come from `homeStyle` and are reused, not duplicated. The live modules are the existing `HomeComposition`. It gains one optional prop, `skinVars`, which maps the terminal theme onto the Home's own variables. No new theme manager, layout manager, store, renderer or service was added.

## What was built

- **Retro Terminal layout** (`RetroTerminal.tsx`, lazy-loaded): header (identity, presentation, world phase, scale, clock, arrange/layout, appearance, cloud, notifications, Neural, look), **celestial directory** (CosmosNavigation tree synced from the live map like the Cosmos workspace panel, spatial objects, scale flights), a clear **viewport frame onto the live Cosmos** (nothing re-rendered), **telemetry** (camera XYZ, sector chunk, region path, level, trail, world phase/progress/cycle/expansion/engines, stream chunks/stars/galaxies/nebulae/black holes, selection with object position, mode/device/theme/contrast), the Home's **live modules as panes**, and a **command line** with history and Tab completion.
- **Commands** (`terminalCommands.ts`, pure and injectable): `help where ls goto back select deselect scale open look theme appearance layout ask clear`. Each one calls the existing system: navigation through `WorkspaceAPI.execute({action:"navigate"})` + `CosmosFocus` + the same camera fly the 3D rings use; scale through `flyCosmosScale`; apps through `launch()`; text through the `lelu-open-universe` draft. There is no invented telemetry.
- **Terminal Appearance Studio** (`TerminalAppearanceStudio.tsx`, lazy-loaded, portalled above the app nav): tabs for Themes, Palette, Colours, Effects and Readability.
  - 31 independent roles: 8 backgrounds, 11 text categories and 12 accents (the full lists in WP03 A–C).
  - Gradients on bg/bg2/panel/sidebar/header/footer.
  - Colour picker, HEX (accepts `#rgb`, `#rrggbb`, bare hex, `rgb()`, `hsl()`, and rejects anything else with a message), RGB and HSL sliders/inputs, palette chips, and per-role reset.
  - **Multicolor palette** of 2–8 swatches. A role points at a swatch (`@3`) or has its own colour. Editing a swatch recolours every role that uses it. Removing a swatch keeps its roles' colour.
  - Save (updates her theme; an edited preset is saved as a *new* theme and never overwritten), save as, rename, duplicate, delete (confirmed), export to file, copy JSON, import from file or paste.
  - Undo/redo (a colour-picker or slider drag counts as one step), revert-all, and reset-to-preset (confirmed).
- **Presets:** Classic Retro (default, charcoal + amber), Cybernetic, Cosmic Violet (gradient background), Solar Flare, Emerald Terminal, Arctic Interface, Monochrome (with a contrast slider), and Custom (black/amber/electric-blue starter). All of them stay editable, and all pass every contrast check.
- **Beyond colour:** body font (monospace or any system font from homeStyle), monospace font (5 system stacks, none downloaded), size 12–20, weight 300–700, border intensity, panel opacity, glow, scanlines, grid, animation, radius and density. “Reduce effects” turns glow, scanlines, grid and animation off in one step. `prefers-reduced-motion` always disables animation.
- **Readability:** 21 contrast pairs that the terminal actually draws. Text must reach 4.5:1 (3:1 counts only for large text); UI elements must reach 3:1. There are per-role badges, a tab badge, a header warning, a sample table, and a “Restore readable palette” button that asks first. The user's colours are never changed for them. Focus is visible (`--rt-focus`), every control has a label, and touch targets are ≥ 32 px (most are 40 px).

## WP11: Verification

| # | Requirement | Evidence |
|---|---|---|
| 1, 2 | Additional layout, existing layouts intact | unit: 13 templates, the 12 originals present; browser: switching to the original layout renders `.hc[data-template]` |
| 3–7 | Independent backgrounds, typography, accents and regions; HEX | unit + browser (`--rt-bg` changes while `--rt-panel` stays the same; `rgb()` input becomes `#9b5cff`; `#zz` is refused) |
| 8–10 | Presets load and edit; custom themes save and restore | unit + browser (Cybernetic is edited, then saved as “Cybernetic (custom)”, and survives a reload) |
| 11 | Theme/layout changes preserve universe state | unit: camera, chunk, region, trail, version and selection are deep-equal after layout switches and edits to every preset. Browser: region, trail and camera readout are unchanged, and **the same WebGL canvas element** survives two layout switches (the renderer is not remounted) |
| 12 | Layout switching keeps the theme | unit + browser |
| 13 | Live preview | browser: desktop drawer, tablet and phone sheet; the variable changes while the studio is open |
| 14 | Reset and undo | unit + browser (undo, revert, reset role, reset theme, coalesced drag undo) |
| 15 | Contrast warnings | unit + browser (a failing pair is flagged and the colour is kept) |
| 16 | Mobile and desktop | browser: iPhone 13, iPad Mini, 1440×900. No horizontal overflow; phone uses tabs, not a shrunk desktop |
| 17 | No duplicate managers | see the WP01 decision |
| 18 | No regressions | gates below; both new components are lazy chunks |

- **Regression tests:** `tests/retro-terminal.test.ts` (15 tests: theme persistence, palette editing, layout-state preservation, commands) and `tests/home-composition.test.ts` (count updated 12 → 13).
- **Browser acceptance:** `scripts/home/verify-retro-terminal.mjs` reports **37/37** (`browser-run.txt`, `browser-run.json`, `shots/`).
- **Gates** (`gates.txt`):
  - full suite: 2416 tests, 2410 pass, **0 fail**, 6 skipped
  - `tsc -b --force` clean
  - oxlint: 0 errors, 184 warnings (unchanged from before)
  - `vite build` OK
  - `verify:bundle` PASS

## Performance observations

- Both new components load only when used: RetroTerminal is 18.4 kB (5.8 kB gzip) and the studio is 21.8 kB (6.5 kB gzip). The CosmosHome chunk is unchanged in kind.
- Scanlines and grid are **one static overlay** made of CSS gradients. Glow is `text-shadow`. Nothing runs per frame, and the large surfaces have no `backdrop-filter` (the Home modules' blur is turned off inside the terminal).
- Live readings re-render only when something changes:
  - WorldLifecycle ticks every 100 ms, but the terminal accepts a change only when the phase or a whole percent moves.
  - The camera is polled at 2 Hz and only updates if it moved.
  - Stream stats update when the Infinite Cosmos notifies.
- The terminal never touches the scene: the viewport is a transparent frame with `pointer-events: none`, so the Cosmos underneath stays interactive.

## Files

**New**
- `src/app/scene/genesis/home/homeTerminal.ts`: roles, presets, palette edits, CSS vars, contrast, import/export
- `src/app/scene/genesis/home/terminalCommands.ts`
- `src/app/scene/genesis/home/RetroTerminal.tsx`
- `src/app/scene/genesis/home/TerminalAppearanceStudio.tsx`
- `src/app/scene/genesis/home/retroTerminal.css`
- `tests/retro-terminal.test.ts`
- `scripts/home/verify-retro-terminal.mjs`
- `docs/missions/retro-terminal/` (this report, gates, browser run, screenshots)

**Changed**
- `homeComposition.ts`: `terminal` kind and `retro-terminal` template
- `homeStore.ts`: `terminal` appearance slice and its persistence
- `HomeComposition.tsx`: `skinVars` prop
- `CosmosHome.tsx`: renders the terminal when the active layout is `terminal`
- `tests/home-composition.test.ts`

## Remaining limitations

- **No screenshot was attached to the mission.** The default (Classic Retro, charcoal + amber) follows the written description.
- The terminal theme applies to the Retro Terminal only. Other layouts keep their own per-presentation look (`homeStyle`), by design.
- **Reloads:** `CosmosNavigation` restores the current destination after a reload only for nodes it persists. Live-map destinations (e.g. a planet) are re-synced, so a reload from one returns to the core. This is the existing rule and was left unchanged. Layout and theme switches do not affect it.
- **Contrast with low panel opacity:** contrast is computed against the opaque surface colour. At low panel opacity the real contrast depends on the Cosmos behind the panel; the studio says so next to the slider.
- **Overlapping app elements:** the scene's companion avatar (bottom-right) and the app's “Spatial” side tab overlap the terminal's edges on small screens, as they overlap every Home layout.
- **Module content colours:** module content with its own artwork (workspace cards, app-tile highlights) keeps those colours; only the frames and text follow the terminal theme.
- **Audit-branch fixes not included:** the Cosmos audit branch `claude/cosmos-integration-audit-t9ouny` (b291a88) is based on an older line. Its camera-follows-navigation fix in `CosmosRooms3D` is not on canonical, and this branch does not include it. The terminal's `goto` flies the camera with the same call the 3D rings use.
- Headless screenshots use SwiftShader, so the Cosmos behind the viewport appears as noise rather than the real scene.
