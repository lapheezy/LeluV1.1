---
date: 2026-11-26
title: Your layouts now speak a design language — and every window speaks it with them
by: Claude (coding assistant)
commits: see `git log -- src/core/interface/CosmosLanguages.ts src/app/scene/genesis/cosmosLanguage`
playbooks: verify-cosmos-languages
---
LÉLU, until today choosing a layout re-arranged your Home and nothing else. Browser, Settings, the
Neural Map and every other window stayed the same violet glass card whatever you chose. Now a layout
can name a **design language**, and the language reaches inside every window.

**What exists now.**
- Fourteen new layouts in your one layout list (`TEMPLATES`, home/homeComposition.ts), each with a
  language: Swiss International, Bauhaus Workshop, Editorial Magazine, Art Deco Salon, Exhibition Hall,
  Neo-Brutalist, Constructivist Poster, Memphis Milano, Japanese Ma, Y2K Aqua, Organic Biome,
  Futurist HUD, Observatory and Industrial Control. Each also uses a different Home composition.
- Your thirteen original layouts are untouched. Twelve keep the original glass. The **Retro Terminal**
  keeps its console Home exactly as it was; its windows now speak its console, in *your own terminal
  theme's colours*.
- The languages live in `src/core/interface/CosmosLanguages.ts`, in two separate layers:
  *compositions* (structure: nine of them) and *languages* (look: sixteen). Compatible looks share a
  composition (Swiss and Bauhaus share the grid; Editorial, Art Deco and Exhibition share the page).
  A look compiles through your existing design-token compiler; it is not a second theme system.
- What changes per composition, for real and not as a recolour:
  - the window title bar (`LanguageWindowChrome`);
  - the Browser's tab placement, address line, action labels and masthead;
  - Settings' navigation: a command line, a numbered index, a contents page, block tabs, vertical tabs,
    a dial, a switchboard or pebbles;
  - the Neural Map's geometry, node marks and links (`neural/neuralLanguage.ts`): a ring, a directory
    tree, a grid, columns, a block matrix, a hanging scroll, a radar or a cluster;
  - every panel heading (`GenesisWindowFrame`), and every panel's controls, cards and text through
    `cosmosLanguage.css`;
  - the Home modules, the bottom navigation and the workspace bar.
- New ⌘K commands: `Layout: <name>` for each layout, which works with windows open; `Open Browser`;
  and `Open Neural Map`.

**Why it is built this way.** You already had exactly one owner of what layout is active
(HomeStore's active presentation). The language is read from it and never stored anywhere else, so
undo, restore, presentations and persistence work unchanged. `HomeStore.switchLayout` reuses the
presentation you already have for a layout, so switching back finds your own arrangement intact.

**What went wrong on the way (so you do not repeat it).**
- Server rendering read `useSyncExternalStore`'s server snapshot, which I had hard-coded to the
  default, so every static render looked like glass. The app is client-rendered with no hydration,
  so the server snapshot now reads the same authority.
- A thicker border made windows 1–2 px bigger. Language windows are now `border-box`, so the
  rectangle you placed is the rectangle you see.
- With five windows open, the steward folded the Browser into a tab, and a test could not type into
  it. Check what is actually on screen before blaming the code.
- In the dense Neural Map layouts, relation words collided between links, so they now sit under each
  node.

**Honest limits.** Web pages inside the Browser, 3D renders, the globe, videos, your avatar and the
Excalidraw canvas are content, not interface. The language frames them but does not repaint them
(each is a documented exception in `WINDOW_MATRIX`). Fonts are system stacks only, so how a
language's type looks depends on the device; nothing is downloaded. Twelve original layouts share one
language (the original glass) by design.

**To redo or extend it.** Run the `verify-cosmos-languages` playbook (screenshots and
verification.json) and `npm test` (`tests/cosmos-languages.test.tsx`). To add a language, see that
playbook's last step.
