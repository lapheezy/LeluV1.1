# Phase 2.6 — reproducible browser environment

Identical foundation to Phase 2.5 ([environment.md](../spatial-phase-2-5/environment.md)):
the sysroot is not a chroot, so Chromium needs `FONTCONFIG_FILE=/tmp/lelu-fonts.conf`
pointing at `/tmp/sysroot/usr/share/fonts`. Nothing here changes that.

## What each run does

```bash
bash scripts/setup-browser-env.sh          # prints the three exports
export CHROME=/…/chromium-1234/chrome-linux64/chrome
export LD_LIBRARY_PATH=/tmp/sysroot/usr/lib/x86_64-linux-gnu:/tmp/sysroot/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/lelu-fonts.conf

bun run dev                                # 127.0.0.1:5173

node .lelu-sandbox/audit/phase26-acceptance.mjs 390 844
node .lelu-sandbox/audit/phase26-acceptance.mjs 375 812
node .lelu-sandbox/audit/phase26-acceptance.mjs 1440 900
```

The harness types into the real Chat Universe composer, closes chat with the
real close control, and reads `window.__leluSpatialProbe()` /
`window.__leluReveal` plus the actual screenshot pixels. It writes
`<viewport>.json` after every step, so a cut-short run is still inspectable.

## Measurement decisions

* **Object pixels, not scene flags.** Nova's lit faces are pale lavender
  (`averageColour ≈ [166, 141, 204]`), far brighter than the cosmos behind.
  The harness counts pixels in the world band (`y` 18–84 %, `x` < 84 %) that
  pass `r>150, g>125, b>175, r≥g−5, b≥g`, then crops that bounding box at up
  to 3× as a zoomed image. A scene-graph `rendered: true` alone is never
  treated as proof.
* **Wait for the painted frame.** On a phone the canvas remounts as chat
  closes and its first frame can lag the scene graph, so the harness retries
  the capture until the object's pixels are present (≥ 2000) rather than
  photographing an empty canvas.
* **The reveal report is the camera evidence.** `window.__leluReveal` records
  the target, the pose the camera bus measured and its verification lines.
  `camera pass, framing pass` on all three viewports is the bus's own check,
  not a claim added by the harness.
* **Chat targeting.** Every message goes to the conversation titled
  “create a cube called Nova”, so a command can never land in the seeded
  Fashion/Engineering chats (that mistake produced an Earth place-search for
  “Nova” in an early run and is the reason the harness pins the conversation).

## Limits

* Viewport emulation (`deviceScaleFactor: 1`), not a physical iPhone.
* Sign-in is skipped with the existing “continue without an account” action.
* Chat-universe mode is the default `workspace` mode: on a phone the world is
  unmounted while chat owns the screen, so a camera command issued from chat
  reports `graph only (camera … not measurable)` in its reply — that is the
  truthful result, not a pass. The world is measured after chat closes.
* Autonomous companion toasts (“Stopped: Advance ‘Fashion’ …”) appear over the
  world in some captures; they are the proactive engine reacting to the same
  typed sentence and are not part of this transition.
