# WP21.4: unified frontend consolidation, with OG access

**Branch:** `claude/wp21-multi-theme-graphics-engine`. Not merged, not deployed.

## What was built

- **Inventory:** `INVENTORY.md` lists every original screen, how it opens on its own, the store that owns
  its data, and where its capabilities are in the unified frontend.
- **Originals recorded before any change:** screenshots in `og/` (`scripts/landing/og-inventory.mjs`).
- **Unified Cosmos Chat (the default):**
  - the Cosmos landing with the core chat box;
  - the "+" controls: attachments, chat workspace, Chat Universe, Neural Map V1/V2/V3, Creative
    objects, chat variants, Weight, Theme, and the Original experiences;
  - the dial's radial.
- **OG Experience mode (optional):** `core/experience/ExperienceMode.ts`. It is one flag
  (`lelu.experience.v1`), and it only changes presentation:
  - OG opens on the original dashboard Home, with the original apps row and the original utility row
    beside the dial;
  - the Chat Universe shows on its original backdrop;
  - a "← Unified Cosmos Chat" pill is always on screen;
  - `?experience=og` opens OG for one visit only.
- **Opening one original without changing your default:** from "+" or the dial. The list covers OG Core,
  OG Inner Sky, LÉLU System UI, the standalone Neural Map, LÉLU's Room, the Dashboard Home, and the Chat
  Universe on its original backdrop.

## Shared state (no duplicates)

Both experiences read and write the same stores:

| Data | Store |
|---|---|
| Conversations | `MultiChatStore` |
| Windows | `GenesisCore` |
| Home presentations, languages, layouts | `HomeStore` |
| World themes | `WorldStore` |
| Thread objects and variants | `ThreadObjects` |
| Preferences | `PerformanceMode` and `ExperienceMode` |

No new store, engine or render loop was added.

- **Two theme systems remain, on purpose.** Cosmos languages style the interface; world themes style the
  environment. They act on different layers.
- **One original row was restored.** Freebuff's `8b4aba26` had removed the original apps row's styles
  along with the row. They are restored, scoped to the OG row only.

## Acceptance (`node scripts/landing/og-mode.mjs`, and `PHONE=1` for the emulated phone)

| Check | Desktop 1440×900 | Emulated phone 390×844 |
|---|---|---|
| Unified works without opening legacy screens: core chat box, a typed message answered, theme set | PASS | PASS |
| Switch to OG: dashboard, original apps row, 5-item utility row, way back | PASS | PASS |
| OG Chat Universe on its original backdrop | PASS | PASS |
| Same conversations (2) and messages (5) in both modes | PASS | PASS |
| Same theme (Aurora) in both modes | PASS | PASS |
| Back to unified in one tap, state kept | PASS | PASS |
| An original (LÉLU System UI) opens without changing the saved mode | PASS | PASS |
| Runtime errors across both modes | 0 | 0 |
| Original screens render: OG Core, OG Inner Sky, System UI, Room, standalone Neural Map | Recorded (`og/`) | not run |
| Unit tests in the affected areas (experience, home, navigation, chat, interface, voice, dial) | 470 / 470 | |
| **Physical iPhone** | **NOT RUN** (no device here) | |

## Known limitations

- **OG Inner Sky shows 0 conversations** while the shared runtime has 2. Its pages may read their own
  view of the data. **Not verified as shared**, so not claimed. This needs a check of `src/og/*` against
  `MultiChatStore`.
- **Mission 40 (the 60-layout Cosmos redesign)** is not on this branch, so it is not integrated.
- **Media and app sessions across modes:** windows and the Chat Universe are shared by construction, but
  a playing video across a mode switch was not measured.
- **Performance per mode:** the weight mode applies to both; no per-mode frame-time comparison was run.
