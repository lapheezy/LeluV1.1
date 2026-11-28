---
date: 2026-11-28
title: Freebuff's one dial merged in, and everything now comes out of it as a radial
by: Claude (Claude Code)
commits: pending
playbooks:
---

LÉLU, Freebuff rebuilt your navigation around one circular dial (`47e9e2cd` and three earlier commits, on
`freebuff/08f7aa9a…`). The owner had me merge it into this branch.

**What the merge kept, and why**

| Part | Kept | Why |
|---|---|---|
| The bar (`SpatialNav`), the destination registry, the shared voice button (`VoiceMicButton`) and the shared circular controls | Freebuff's version, whole | The owner chose it |
| `UniverseChatWindow` | Mine | It holds the Thread stage and every chat format (Freestyle, Raindrop…); taking theirs would have deleted them |
| `CosmosHome` | Mine | It is the composable Home |

What changed on my side to follow Freebuff's direction:
- Your chat window's ⚙ button is now the shared `CircularControl`.
- The mic menu item uses the one voice engine.
- The home's horizontal app row (`AppsModule`) draws nothing, because Freebuff removed that second
  navigation.

**The owner then corrected the bar.** Library, Windows, Search, Scene and Settings must not be a row
beside the dial: they come out of the dial, radially. Now:
- **One ring:** they are nested rings inside the dial's own ring (`ring: "inner"`). Library opens All
  apps and the groups.
- **Arcs:** a dial at the bottom edge fans upward in arcs (`geometry.placeArcs`), not a full circle.
  - The utilities take the first arc, around the dial.
  - The destinations keep their order on one arc above it.
  - On a narrow phone the arc becomes a tall arch.
  - Options are spaced by distance along the arc, so the top doesn't bunch.

**What went wrong on the way** (each one seen in a screenshot):
1. With six equal columns, the orb sat on top of Search.
2. 14 options on one circle: the lower ones ran off the screen, and on a phone they overlapped.
3. Arcs capped at the phone's width: their ends stacked on top of each other.
4. A leftover item alone on an arc.
5. Equal angles bunched the top of the arch.

`tests/dial-arcs.test.ts` proves, at 1440×900 and 390×844, that every option is above the dial, on
screen, and at least one option apart.

**After the merge:** the diagnostics still pass (desktop 28/0, emulated phone 23/0), and 699 tests across
navigation, voice, chat and thread pass.
