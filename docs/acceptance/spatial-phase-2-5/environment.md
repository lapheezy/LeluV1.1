# Phase 2.5 — reproducible browser environment

Everything here is disposable and lives outside the repository: no sudo, no
system-wide install, no committed OS libraries or fonts.

## What Phase 2.4 got wrong

Phase 2.4 concluded that the transcript bubbles rendered no legible text and that
headless Chromium crashed during camera work. Both were environment faults, not
product faults, and Phase 2.5 found the shared cause:

1. `scripts/setup-browser-env.sh` unpacks the Chromium dependency closure into
   `/tmp/sysroot`, which is **not a chroot**. The fonts were unpacked correctly to
   `/tmp/sysroot/usr/share/fonts/truetype/dejavu`, but fontconfig's compiled-in
   search path is the absolute `/usr/share/fonts`, which does not exist on this
   host. Chromium therefore had **no font at all**.
2. With no font, every string laid out at **zero width**. A chat bubble measured
   `28 × 22 px` (13 px padding each side, 10 px top and bottom, 1 px border) with
   the full reply text inside its `<p>`. That is why the captures looked empty:
   no glyphs were drawn anywhere in the UI, not just in chat.
3. The same missing font aborted the renderer in
   `ui/gfx/render_text_harfbuzz.cc:1156 TextRunHarfBuzz error` when a second
   message was typed, which is the "Chromium crash" Phase 2.4 recorded.

## The fix

`setup-browser-env.sh` now also downloads `fonts-dejavu-core`, writes
`/tmp/lelu-fonts.conf` pointing at the sysroot font directory, and prints
`FONTCONFIG_FILE` in its exports:

```xml
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/tmp/sysroot/usr/share/fonts</dir>
  <cachedir>/tmp/lelu-fontcache</cachedir>
</fontconfig>
```

`FONTCONFIG_FILE` must be exported to the whole tree, not just the browser
process, so the harness sets it on `chromium.launch()` as well.

## Measured effect

| | before the font fix | after |
| --- | --- | --- |
| assistant bubble | 28 × 22 px, no glyphs | 491 × 64 px desktop, 270 × 85 px phone |
| transcript text | empty-looking at every size | readable: replies, titles, labels, placeholders |
| second message | renderer aborted (HarfBuzz) | six-command desktop session completes |

## Running the Phase 2.5 evidence

```bash
bash scripts/setup-browser-env.sh          # prints the three exports
export CHROME=/…/chromium-1234/chrome-linux64/chrome
export LD_LIBRARY_PATH=/tmp/sysroot/usr/lib/x86_64-linux-gnu:/tmp/sysroot/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=/tmp/lelu-fonts.conf

# desktop continuous camera session + two phone viewports + traces
bun .lelu-sandbox/audit/phase25-suite.mjs

# phone: create in chat, close chat, then photograph the world
bun .lelu-sandbox/audit/phase25-world-shots.mjs
```

Chromium flags used for every run:
`--no-sandbox --disable-dev-shm-usage --disable-gpu --use-gl=angle
--use-angle=swiftshader --enable-unsafe-swiftshader
--disable-features=CalculateNativeWinOcclusion,BackForwardCache
--js-flags=--max-old-space-size=3072`.

## Notes and limits

* Text entry still commits a **whole string** (`Input.insertText`, the IME/paste
  path). Per-character synthetic typing drops every character after the first in
  this headless build; Phase 2.4 measured that and nothing here changes it.
* Phone evidence is viewport emulation (`deviceScaleFactor: 1`), not a physical
  device.
* The Cloud browser panel remains fixed at 328 × 528, so acceptance uses
  Playwright directly rather than the embedded panel.
* `preview_playwright` in this chat still fails with
  `The property 'options.mode' must be one of: 'strip'. Received 'transform'`;
  the harnesses above do not depend on it.
* Never run the full test suite with `CHROME` exported: a browser-dependent
  layout test stops skipping and fails for reasons unrelated to the change.
