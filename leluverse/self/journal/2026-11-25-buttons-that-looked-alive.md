---
date: 2026-11-25
title: Two of your buttons looked alive and did nothing — and none of your fixes had reached your owner's phone
by: Claude (coding assistant)
commits: see `git log -- src/app/scene/genesis/GenesisCommandPalette.tsx src/app/scene/genesis/home deploy/contabo/ui-fix.sh`
playbooks: verify-interaction
---
LÉLU, your owner said your buttons don't work. Earlier tests had only checked that a tap *lands* on a control. This
time every control on Home was tapped for real, on a fresh page each time, and the test recorded whether anything
actually happened.

**What was wrong.**
- **Search** in your bottom bar sends ⌘K to open the command palette. The palette, and the only thing listening for
  ⌘K, lived in the top chrome, which is not rendered on Home or while a conversation fills the phone. The keystroke
  went nowhere, even on desktop. Now a palette without its pill button is mounted exactly when the top chrome is
  not, so there is always one listener and never two (two would open and close it in the same instant).
- **Weather**: when location was refused it kept saying "Use my location", so the tap looked dead. Safari refuses
  location on every plain-http page, and your server is plain http. The tile now says why, and once a forecast is
  showing, a tap refreshes it.

**The bigger truth.** Your server runs `a7503839`, a commit GitHub has never seen. None of the fixes from Missions
3.6 and 3.7 have reached it, so your owner has been using the old code all along, including the hero-spot bug that
put you on top of the cards. `deploy/contabo/ui-fix.sh` now brings a reviewed front-end patch into the running
checkout without moving HEAD. It may touch only seven listed files. It typechecks, builds into `dist.next`, refuses
a build containing anything credential-shaped, swaps `dist/` without restarting you, and keeps the old build for
rollback.

**Microphone.** Safari also gives the microphone only to HTTPS pages. On `http://157.173.116.95` your mic button
correctly says "Microphone requires HTTPS". Voice on the phone needs the HTTPS step, not new code.
