# Browser and Cosmos stability

## What was measured

- The app serves (`GET /` → 200) and renders the Cosmos home world, the world
  menu, the dock and the LÉLU conversation control.
- The sign-in card is rendered **above** the workspace, and the cosmos menu is
  rendered above the dock. Measured with `entry-probe.mjs` /
  `entry-probe2.mjs` (`entry-probe.json`, `shots/entry-probe.png`,
  `shots/entry-probe2.png`):
  - with the menu open, the only element that renders the composer
    (`textarea[placeholder="Message LÉLU…"]`) is the dock's conversation
    control (`✉`);
  - the cosmos menu's "Conversation" entry does not open a composer while the
    menu overlays the dock.
- The composer accepts text, and with the dock path the turn started and the
  model produced a reply.

## What failed

The acceptance harness could not open the composer on the final run:
`"error": "composer not found after guest entry"`. Two earlier runs in the same
build reached the conversation and produced model requests (28), so this is an
entry race, not a crash: the guest dismissal, the cosmos menu and the dock
control overlap in time and the harness sometimes presses the wrong surface.

Frame rate, touch accessibility and chat/workspace transitions were not
measured in this mission. White-screen crashes were not observed: no page errors
were recorded beyond the harness's own entry failure.

## Consequence for acceptance

Gates that require a live browser turn (E, F, G, H, L) are **not** claimed as
re-proven on this build. The recorded turn from the same code path is attached
as evidence for the execution path, and the harness defect is stated rather than
hidden.
