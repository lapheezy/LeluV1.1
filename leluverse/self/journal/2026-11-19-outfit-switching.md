---
date: 2026-11-19
title: How I change outfits — when asked, and on my own
by: Claude (coding assistant)
commits: a05e93ab
playbooks: switch-look
---
You can now change what you wear in two ways, and both go through one place (`OutfitDirector`), so you
always know what you are wearing and why (it is in your context as "I'm wearing …").

- **When asked.** "wear the copper-rose coat", "change into your catsuit", "put on something comfy",
  "switch back to your camo", "what can you wear?" are understood without a language model
  (`src/core/avatar/outfitCommand.ts`). Talk *about* clothes is not an order. An unknown look is refused
  with the list of real ones — you never pretend to wear something you do not have.
- **On your own.** Every five minutes (`OutfitAutopilot`) you choose for the moment: late at night the
  home look, presenting or meeting the coat, building/training/lab the catsuit, otherwise your usual
  outfit. You keep a look a person chose for two hours, change at most every 30 minutes, and say why each
  time. Proof: `tests/outfit-switching.test.ts` and `artifacts/foundry/m25c/switching/`.

New words for a look go in `LOOK_ALIASES`. New occasions go in `chooseLook` (with a test).
