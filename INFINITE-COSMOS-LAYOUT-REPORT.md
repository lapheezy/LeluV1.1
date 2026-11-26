# Infinite Cosmos: layout languages and the layout-aware window system (mission report)

**Branch:** `claude/infinite-cosmos-layout-redesign-5dtcya` (committed locally; not pushed, merged or deployed)
**Implementation commit:** `67f2d430` (base: `8785e73`)
**Verified in the real app:** `artifacts/infinite-cosmos/verification.json` (see "Verification").

## 1. What changed

Before this work, choosing a Home layout re-arranged the Home's own modules and nothing else. Every
workspace window (Browser, Settings, the Neural Map and the rest) stayed the same violet glass card.

Now a layout can name a **design language**. Switching layout re-composes every open window: its
title bar, its panel heading, its controls, cards and type, and three windows with dedicated
structure (Browser, Settings, Neural Map). It also re-composes the Home modules, the bottom navigation
and the workspace bar. The windows stay open and in place while this happens.

## 2. Architecture (WP04)

| Layer | Where | Owns |
|---|---|---|
| Layout registry (the **one** authority, unchanged in role) | `src/app/scene/genesis/home/homeComposition.ts` → `TEMPLATES` | which layouts exist; a layout may now carry `language?: string` |
| Active layout (the **one** authority, unchanged) | `HomeStore` active presentation | which layout is active, per user, persisted as before |
| Compositions (**structure**) | `src/core/interface/CosmosLanguages.ts` → `COMPOSITIONS` (9) | chrome form, Browser tab, address and action forms, Settings navigation, Neural Map layout, node and link drawing, heading form |
| Languages (**look**) | same file → `LANGUAGES` (16) | palette, fonts (system stacks only), rule, radius, case, shadow, pattern |
| Compiler | `languageVariables()` → the existing `DesignTokens.tokensToCssVariables` | `--lelu-*` (read by every Genesis panel already) plus `--cl-*` (read by the composition CSS) |
| Runtime | `cosmosLanguage/CosmosLanguageRuntime.tsx` | marks `<html data-cosmos-language/-composition/-tone>`; writes one scoped `<style>` for windows, the Neural Map, the Home, the nav and the workspace bar |
| Hook | `cosmosLanguage/useCosmosLanguage.ts` | `useCosmosLanguage()` reads `layoutOf(HomeStore.activePresentation())`; it stores nothing |
| Window matrix | `WINDOW_MATRIX` / `participationFor()` | each registered window's role, its implementation (dedicated or shared) and any documented exception |

- **No competing authority.** A language is read from the active layout; it is never stored
  separately. Presentations, undo and redo, restore points, per-device profiles and persistence all
  work as before.
- **Composition is separate from theme.** Compatible looks share an engine: Swiss and Bauhaus share
  `grid`; Editorial, Art Deco and Exhibition share `editorial`; Brutalist, Constructivist and Memphis
  share `slab`; Futurist HUD and Observatory share `hud`; Cosmic and Y2K share `glass`.
  Structurally different compositions have different code paths in every component that switches on
  them.
- **The default is untouched.** `cosmic` emits no variables and no attributes, so the 12 original
  glass layouts render as before. A test asserts this.
- **Interface themes still work.** Variables are scoped to the surfaces a language owns. An approved
  interface theme (InterfaceRuntime on `<html>`) still applies wherever no language is active.
- `HomeStore.switchLayout(id)` reuses the presentation the user already has for a layout (with their
  arrangement) and creates one only the first time. ⌘K gained `Layout: <name>` for every layout
  (it works with windows open), plus `Open Browser` and `Open Neural Map`.

## 3. Layout inventory (WP01 and WP02)

27 layouts: the 13 originals, every id unchanged, plus 14 new. 60 concepts and the user's own layouts
are unchanged (no language, so the original glass; a saved custom layout keeps a language through
`readLayout`).

| id | name | Home composition (phone / tablet / desktop) | language | window composition |
|---|---|---|---|---|
| `lelu-central` | LÉLU Central | bento / bento / bento | Cosmic glass | glass |
| `bento-universe` | Bento Universe | bento / bento / bento | Cosmic glass | glass |
| `cosmos-orbit` | Cosmos Orbit | bento / orbit / orbit | Cosmic glass | glass |
| `spatial-home` | Spatial Home | layered / spatial / spatial | Cosmic glass | glass |
| `executive-command` | Executive Command Center | grid / split / split | Cosmic glass | glass |
| `organic-asymmetry` | Organic Asymmetry | masonry / masonry / masonry | Cosmic glass | glass |
| `creative-gallery` | Creative Gallery | masonry / masonry / masonry | Cosmic glass | glass |
| `project-hub` | Project Hub | grid / split / split | Cosmic glass | glass |
| `minimal-focus` | Minimal Focus | focus / focus / focus | Cosmic glass | glass |
| `adaptive-intelligence` | Adaptive Intelligence | bento / bento / bento | Cosmic glass | glass |
| `workspace-deck` | Workspace Deck | deck / deck / deck | Cosmic glass | glass |
| `living-ecosystem` | Living Home Ecosystem | bento / freeform / freeform | Cosmic glass | glass |
| `retro-terminal` | Retro Terminal | terminal / terminal / terminal | Retro Terminal (her terminal-theme colours) | console |
| `swiss-international` | Swiss International | column / grid / grid | Swiss International | grid |
| `bauhaus-workshop` | Bauhaus Workshop | bento / bento / bento | Bauhaus Workshop | grid |
| `editorial-magazine` | Editorial Magazine | column / masonry / masonry | Editorial Magazine | editorial |
| `art-deco-salon` | Art Deco Salon | column / radial / radial | Art Deco Salon | editorial |
| `exhibition-hall` | Exhibition Hall | deck / deck / deck | Exhibition Hall | editorial |
| `neo-brutalist` | Neo-Brutalist | strip / strip / strip | Neo-Brutalist | slab |
| `constructivist-poster` | Constructivist Poster | column / lanes / lanes | Constructivist Poster | slab |
| `memphis-milano` | Memphis Milano | bento / scatter / scatter | Memphis Milano | slab |
| `japanese-ma` | Japanese Ma | column / stage / stage | Japanese Ma | scroll |
| `y2k-aqua` | Y2K Aqua | rows / rows / rows | Y2K Aqua | glass |
| `organic-biome` | Organic Biome | masonry / layered / layered | Organic Biome | organic |
| `futurist-hud` | Futurist HUD | grid / orbit / orbit | Futurist HUD | hud |
| `observatory` | Observatory | column / constellation / constellation | Observatory | hud |
| `industrial-control` | Industrial Control | grid / split / split | Industrial Control | bezel |

### The nine compositions (structure)

| composition | window chrome | Browser | Settings navigation | Neural Map | panel heading |
|---|---|---|---|---|---|
| glass | original glass bar | original | none (original) | ring · circles · straight | original |
| console | box-drawn `lelu@cosmos:~/x$` prompt, `[_] [□] [×]` keys | tab line `1:` · `$ open` prompt · F-key actions · prompt masthead | `settings> show 1 overview …`, paged | directory tree · text marks · orthogonal | `> title_` |
| grid | red index number, flush-left grotesk, word controls | numbered tab **column** · headline address · big index masthead | numbered index column | modular grid · squares · orthogonal | big number + title |
| editorial | centred nameplate between rules, folio | nameplate + dateline masthead · footnoted actions ¹²³⁴ | contents page with dotted leaders | in/out columns · serif rings · hairlines | headline + dek |
| slab | title block with heavy outline, block controls | block tabs, shouting block address | heavy block tabs, paged | block matrix · shadowed blocks · heavy | reversed block |
| scroll | quiet bar with ink dots, vertical title + hanko | tabs hang vertically on the **right** · stamped 「actions」 | vertical tabs, paged | hanging columns right-to-left · seals · brush | spaced vertical-feel title |
| hud | ⟦DESIGNATION⟧ + SYS readout, chamfered keys, corner brackets | readout strip, reticle address, tabs as targets along the **bottom** | radial **dial**, paged | radar (in/out orbits) · reticles · dashed | ◤ title + SYS coordinates |
| bezel | engraved plate, screws, lamps, hardware toggles, hazard stripe | LED readout, recessed address, switches with lamps | **switchboard**, paged | patch-panel matrix · lamps · wires | LED plate |
| organic | pebble title, seed controls, cell-shaped window | pebble tabs and address | pebbles | phyllotaxis cluster · blobs · curves | soft title + seed rule |

## 4. Window-by-window implementation matrix (WP03)

- **dedicated**: the window's own component switches on the composition. Structure changes:
  placement, navigation and drawing.
- **shared**: the window renders through the shared layout-aware primitives: the composition's chrome
  (`LanguageWindowChrome`), the panel heading (`GenesisWindowFrame` → `LanguageHeading`), and the
  composition stylesheet for its text, cards, controls, inputs, status colours and scrollbars.

| window | role | implementation | documented exception |
|---|---|---|---|
| `browser` (Browser) | browser | **dedicated** | the embedded web page is another site's document: framed and navigated, not restyled |
| `neural-map` (Neural Map) | map | **dedicated** | — |
| `settings` (Settings) | settings | **dedicated** | — |
| `chat`, `chat:*` (Chat) | conversation | shared | — |
| `knowledge` (Research) | list | shared | — |
| `reasoning` | document | shared | — |
| `creation` (Documents), `artifact:*` | document | shared | — |
| `projects` (Files) | files | shared | — |
| `visualstudio` (Studio), `atelier:*` | studio | shared | the WebGL viewport is a live render |
| `render`, `genesisv2` (3D workspace), `earth`, `avatar`, `video` | canvas | shared | renders, globe, avatar and video frames are content |
| `sketch` (Boards), `executive` | board | shared | the Excalidraw canvas keeps its own surface |
| `agents`, `cognition`, `diagnostics`, `device`, `evolution`, `infra-monitor`, `security-center` | dashboard | shared | — |
| `memory`, `history`, `logs`, `notifications`, `cognitive-trace` | list | shared | — |
| `briefings`, `identity` | document | shared | — |
| `engineering`, `command`, `eng-studio`, `voice-studio` (Tools) | tools | shared | — |

`tests/cosmos-languages.test.tsx` reads `MODULE_RENDERERS` out of `GenesisInterface.tsx` and fails if
any registered window (including dynamic `chat:`, `artifact:` and `atelier:` ids) is missing from the
matrix.

## 5. Retro Terminal preservation

- `retro-terminal` is still a built-in with `kind: terminal` on every device, its order and hidden
  `ask` unchanged. `RetroTerminal.tsx`, `retroTerminal.css`, `homeTerminal.ts` and
  `TerminalAppearanceStudio.tsx` are **not modified**. The Home stylesheet explicitly excludes the
  terminal language, and none of those files reads a `--lelu-*` or `--cl-*` variable.
- Selected through the original UI path (Arrange → "New from" → Retro Terminal) at baseline, and
  through ⌘K in every verification run. The console Home renders with its directory, viewport,
  telemetry and command line (`artifacts/infinite-cosmos/desktop/retro-terminal--*.jpg`).
- What is new: its *windows* now speak the console, in the user's own terminal-theme colours
  (`terminalPalette`, from `resolveRoles(HomeStore.terminalTheme())`), and the bottom navigation and
  workspace bar follow.
- `tests/retro-terminal.test.ts` passes unchanged.

## 6. Verification (WP06 and WP07)

### Real application: `scripts/verify-cosmos-languages.mjs` (`npm run verify:cosmos-languages`)

Run against the Vite dev server with Chromium, through the real UI (⌘K palette, Home buttons,
window controls). Report: `artifacts/infinite-cosmos/verification.json`. Screenshots (real app,
JPEG): `artifacts/infinite-cosmos/desktop/<layout>--windows.jpg`, `--neural-map.jpg`, and
`artifacts/infinite-cosmos/mobile/<layout>--home|browser|settings.jpg`.

**Desktop (1440×900).** Browser is opened and navigated to `https://example.org/`, then Settings,
Research (Knowledge) and Files (Projects) are opened. With all four **still open**, each of the 27
layouts is applied in turn, and the script checks for each:

- the language is active;
- the same four windows are open;
- every window carries its role and the composition's chrome;
- the stored window geometry is unchanged;
- Browser renders the composition and still holds its tab, address and page;
- Settings uses the composition's navigation, reaches a section, and a real toggle still flips;
- every panel heading uses the composition's form;
- the Neural Map lays out in the composition with its real data (entities and relations counted),
  and follows a clicked node.

**Phone (390×844).** For the 15 language-bearing layouts plus LÉLU Central, the script checks that
the Home is composed for the phone, and that the Browser and Settings sheets speak the composition
and fit the screen.

**Result of the final run: 374/374 checks passed, 0 failed** (27 layouts on desktop, 16 on phone; 54 desktop and 48 phone screenshots). No page errors.

Earlier runs, and what they found:
- 367/374: 7 failures, all a **harness** bug. Uppercase languages change `innerText`, so the toggle
  lookup missed. Fixed with `textContent`.
- 374/374 on the next run. Its screenshots then showed one real bug: slab headings rendered
  ink-on-ink. Fixed, then the final run was made.

### Automated tests

- `tests/cosmos-languages.test.tsx` (new, 17 tests). It covers:
  - original ids and their languages; Retro Terminal kind and language;
  - one distinct language per new layout; `readLayout` keeps or refuses a language;
  - compositions structurally distinct; languages distinct; the default emits nothing;
  - the terminal language follows the terminal theme and refuses non-colours;
  - window-matrix coverage of every registered window;
  - layout propagation through HomeStore, which never overwrites an arrangement;
  - chrome, Settings navigation, Neural geometry and links distinct per composition;
  - server-rendered Browser, Settings, Neural Map and panel headings under real layout switches, with
    every original control, section and accessible name still present.
- `tests/home-composition.test.ts`: the count test now asserts all 13 original ids remain, plus the 14
  additions (27 total).
- `npm test`: 3393 tests, 3359 passed, 29 skipped, 5 failed. One of the 5 was mine (a source-text
  assertion on `const header = … : chrome;`); it was fixed by keeping that exact line and re-run
  (`chat-surface.test.ts`: 31/31). The other **4 fail identically on the original commit**
  (verified in a worktree of `8785e73`), so they are pre-existing and unrelated:
  - `credential-exposure`: no workflow hands a provider credential to a build;
  - `foundry-m25c`: the coat and catsuit handbags are their own nodes;
  - `foundry`: the three sources are ordered per component;
  - `supabase-config`: skipping is a remembered, first-class answer.
- `npm run typecheck` (`tsc -b --force`): clean. Production build (`vite build`): succeeds.
- `oxlint` on the changed files: no errors (warnings are pre-existing patterns).

## 7. Limitations (honest)

- **Shared windows are restyled, not re-laid-out.** Research, Documents, Files, Studio, 3D, Boards,
  Tools and the dashboards get the composition's chrome, heading, controls, cards, inputs, type and
  status colours. Their internal arrangement (which card sits where) is their own and is the same in
  every composition. Only Browser, Settings and the Neural Map have composition-specific structure.
  That is the next step per window, not something these screenshots show.
- The shared restyle works by overriding panels' inline colours and surfaces with `!important` CSS,
  keyed on `[data-lelu-module-content]`. Meaning carried by colour is mapped to the language's
  ok/warn/danger only for the palette values these panels actually use. A new inline colour would
  read as plain ink.
- **Fonts** are system stacks only (nothing is downloaded). On a device without Helvetica, Didot,
  DIN or Futura, the language falls back to the nearest available face; this sandbox showed DejaVu and
  Liberation fallbacks.
- **Media is content.** Web pages in the Browser iframe, 3D renders, the globe, the avatar, video and
  the Excalidraw canvas are framed, not repainted (documented in the matrix).
- The 12 original glass layouts deliberately share the original look. Concepts (the 60) and the
  user's own layouts have no language unless one is given.
- "Favorites" and "recents" for layouts do not exist in this codebase, so there was nothing to
  preserve there. Presentations (create, apply, duplicate, rename, reset and restore, undo and redo),
  per-device profiles and saved layouts are preserved and covered by the existing tests.
- The phone check uses Chromium's mobile viewport. It is not Safari on a real iPhone.
- The Neural Map caps each layout at 24–28 related entities (as the original ring capped at 28); the
  rest are listed in its panel, as before.

## 8. Commits

| commit | what |
|---|---|
| `8785e73` | base: the original branch state, untouched |
| `67f2d430` | implementation: registry, runtime, chrome, Browser, Settings, Neural Map, headings, surfaces, tests, verification script, screenshots, journal, playbook |
| (this report) | the mission report |

Final verification: 374/374 in the real app, run on the code of `67f2d430` except for one CSS-only
fix made after that run. On phone sheets the active workspace-bar tab label was accent-on-accent
(visible as an empty pill in `mobile/*--settings.jpg` and `mobile/*--browser.jpg`). The fix (reverse
the label) is in `67f2d430` and was checked on its own in
`artifacts/infinite-cosmos/mobile/_after-final-run--workspace-bar-active-label.png`.
Baseline screenshots from before any change: `artifacts/infinite-cosmos/_baseline-*.png`.

Nothing was pushed, merged or deployed. No paid API, Anthropic call, LangChain or LangGraph was
used or added.
