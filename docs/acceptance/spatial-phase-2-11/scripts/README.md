# Spatial acceptance harness

These scripts drive the real app in a real Chromium at the required viewports.
They exist because the restricted browser panel (328×528) cannot show a phone
or a desktop, and because every claim in the mission report has to come from a
run someone else can repeat.

## One-time setup (no root required)

The sandbox blocks `sudo`, and Playwright's Chromium needs shared libraries
that the base image does not ship. Both are installable into the workspace:

```bash
npx playwright install chromium

# apt state in a writable prefix, then fetch and unpack only the libraries
A=$PWD/.apt
mkdir -p "$A/lists/partial" "$A/archives/partial" "$A/debs" "$A/root"
apt-get -o Dir::State::lists="$A/lists" \
        -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/ubuntu.sources \
        -o Dir::Etc::sourceparts=/dev/null \
        -o APT::Get::List-Cleanup=0 -o Debug::NoLocking=1 update
cd "$A/debs" && apt-get -o Dir::State::lists="$A/lists" \
        -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/ubuntu.sources \
        -o Dir::Etc::sourceparts=/dev/null -o Debug::NoLocking=1 \
        download libnspr4 libnss3 libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 \
                 libatspi2.0-0t64 libcairo2 libcups2t64 libxcomposite1 libxdamage1 \
                 libxfixes3 libxrandr2 libpango-1.0-0 libxkbcommon0 libgbm1 libdrm2 \
                 libxi6 libxrender1 libavahi-client3 libavahi-common3 libfontconfig1 \
                 libfreetype6 libharfbuzz0b libpixman-1-0 libpng16-16t64 libthai0 \
                 libxcb-render0 libdatrie1 libgraphite2-3
for d in "$A"/debs/*.deb; do dpkg-deb -x "$d" "$A/root"; done
```

## Running

```bash
# the app must already be serving (vite --host 0.0.0.0 --port 3013)
export LD_LIBRARY_PATH=$PWD/.apt/root/usr/lib/x86_64-linux-gnu

# one screenshot, one short session (the reliable path in this container)
node docs/acceptance/spatial-phase-2-11/scripts/short-shot.mjs 390 844 01-genesis-shell
node docs/acceptance/spatial-phase-2-11/scripts/short-shot.mjs 1440 900 03-spatial-portal-ring portal

# a scenario with retries and carried storage state
ONLY=panel,destination node docs/acceptance/spatial-phase-2-11/scripts/capture.mjs 1440 900
```

`NOBLUR=1` injects a stylesheet that disables `backdrop-filter`; every capture
taken that way records `backdropFilterDisabled: true` in its metadata.

## What this environment cannot do

Measured here, on this VM:

- **Software rendering at ~2.5 fps.** `requestAnimationFrame` produces 5–6
  frames every 2 s while the Genesis scene is live. The camera driver is
  frame-based, so a 1.5 s transition takes tens of seconds of wall clock.
- **The renderer traps (SIGTRAP) in longer sessions.** `dmesg` shows
  `traps: chrome-headless trap int3`, i.e. a Chromium CHECK, not an app error.
  It is reproducible when a large `backdrop-filter` panel is composited over
  the live WebGL canvas, and nondeterministically during long sessions.
- **Text does not rasterise legibly.** With the glass disabled the frame is
  structurally sharp — windows, rail, dock, scene — but every glyph renders as
  a blank bar, and `document.body.innerText` is empty while `textContent` holds
  the real strings. The app's text/opacity entrance animations never complete
  at this frame rate.

The consequence, stated plainly: these captures are **evidence that the shell
mounts at the required CSS sizes**, not evidence of a legible interface.
