# WP21.4: original-screen inventory and the unified mapping

Each original screen was read from the code and recorded as it is today, before any change
(`node scripts/landing/og-inventory.mjs` → `og/*.png`).

Column meanings:
- **OG path**: how the original opens on its own.
- **State authority**: the store that owns its data. Every row uses an existing store; none is
  duplicated.
- **In the unified frontend**: where its capability is reached.

## Whole interfaces (`core/interface/InterfaceCatalog.ts`)

| Original | OG path | State authority | In the unified frontend |
|---|---|---|---|
| Cosmos (Genesis V1 world) | `?interface=cosmos` | `GenesisCore` (scene, modules), `HomeStore` | The landing: the primary Cosmos with the core chat box |
| LÉLU's Room (Genesis V2) | `?interface=lelu-room` | `GenesisCore` (`activeScene` genesisv2) | Dial → Genesis Scene |
| Neural Map (standalone overlay) | `?interface=neural-map` | `core/neural/multiverse` (`liveAspectGraph`) | Dial → Neural Map → V1/V2/V3 (in the chat workspace); "+" → Neural Map; contextual surfacing |
| LÉLU System UI (legacy) | `?interface=lelu-system` | `GenesisCore`, `VisualEngine` | Dial → Scene → System view |
| Original LÉLU · Inner Sky (legacy app) | `/og/app` (Home, Chats, Agents, Memory Garden, Files, Projects, Universes, Action queue, Settings) | `src/og/*`, shared runtime singletons (to be verified, see WP21.4 acceptance) | OG launcher |
| Original LÉLU · Core (legacy) | `/og/core` | `src/og/*` | OG launcher |

## Home and the Infinite Cosmos

| Original | OG path | State authority | Unified |
|---|---|---|---|
| Dashboard Home "My Home" (`CosmosHome`): weather, workspaces, notifications, Infinite Library | The landing before the consolidation (`HomeStore.immersive = false`) | `HomeStore` | Dial → "Back to the workspace"; the OG landing |
| Home layouts: 20 templates (bento, grid, masonry, split, stage, lanes, column, strip, rows, deck, focus, layered, orbit, depth planes, radial fan, constellation, card table, orbit band, freeform, retro terminal) | Home → edit (Home Design Studio) | `HomeStore` presentations (`homeComposition.ts` `layoutOf`) | Unchanged: the same Home presentations |
| Cosmos languages (cosmic, terminal, swiss, bauhaus, editorial, artdeco, exhibition, brutalist, constructivist) × window compositions (glass, console, grid, editorial, slab, scroll, hud, bezel, organic) | Home Design Studio | **The active Home presentation's layout** (`useCosmosLanguage` reads `HomeStore`; it keeps no store of its own) | "+" → Theme (interface language), with the WP21 world themes |
| Retro Terminal (home kind "terminal") | A presentation using it | `HomeStore.terminalTheme` | Same |
| Infinite Library sheet (interfaces, Legacy UIs, compositions, apps) | Dial → Library | `InterfaceCatalog`, `homeCatalog.APPS` | Dial → Library |
| Mission 40 (60-layout Cosmos redesign) | Not on this branch (`origin/claude/infinite-cosmos-layout-redesign-5dtcya`) | n/a | **Not integrated: not on this branch** |

## Chat

| Original | OG path | State authority | Unified |
|---|---|---|---|
| Chat Universe hub (cards, timeline, orbits, rail) | Dial → Chat Universe | `MultiChatStore` (conversations), `GenesisCore` modules (open windows), `universeOpen` | Same hub, floating over the Cosmos |
| Chat Universe "workspace" mode (own backdrop) | Hub's mode toggle | `HomeStore.cosmosMode` (saved choice kept) | Default is now floating; workspace kept as the OG choice |
| Conversation window stages: conversation, cinematic, board, gallery, present, spatial, research, document, diagram, data, code, film, voice, studio, thread | Window's stage switcher | `WorkspaceStewardStore` | Same; "+" → Chat workspace opens the Thread stage |
| Thread variants: Raindrop, Liquid workspace, Ribbon thread, Live workspace, Chat + browser, Freestyle | Thread view tabs | `ThreadObjects` (objects, per-variant transforms, variant per conversation) | "+" → Chat variant; the same tabs |
| The old single-panel chat (`GenesisChat`) | Mounted hidden (it is the send engine) | `GenesisChat` and `AIService` | Every composer sends through its event |
| Core chat box (new, unified) | — | Same send engine and conversation store | The landing |

## Worlds, themes, objects, apps

| Original | OG path | State authority | Unified |
|---|---|---|---|
| WP21 world themes (15 families) and the world editor | Thread 🌐 editor | `WorldStore` (active world) | "+" → Theme; theme of the Cosmos and of every variant |
| Creative Objects dock | Cosmos (✦ pill) | `CreativeObjectStore` | "+" → Creative objects |
| Apps (catalog, 30+: Browser, Studio, Documents, Files, Agents, Sketch, Render, Video, Avatar, Code, Engineering Command, Self Development, Trace, Engines, Logs, Knowledge, Reasoning, Earth, Memory, Executive, Briefings, Updates, Cognition, History, Identity, Device, Settings…) | Dial → Library, or their panels | `GenesisCore` modules (one window system) | Dial → Library / Windows / Search |
| Spatial navigator, Command palette | Spatial rail, ⌘K | Their own components over `GenesisCore` | Unchanged |

## Theme systems (more than one exists)

There are **two distinct presentation authorities**, and they are kept distinct (they style different
layers; merging them would remove capability):

1. **Cosmos languages and compositions:** the *interface's* typography, chrome and window shapes. Owned
   by the active Home presentation.
2. **WP21 world themes:** the *environment* behind the Cosmos and the chats. Owned by `WorldStore`.

The unified Theme section offers both. Neither keeps a copy of the other's state.
