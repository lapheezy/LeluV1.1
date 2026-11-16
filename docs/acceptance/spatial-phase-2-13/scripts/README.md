# Mission 5.4 — browser probes

Both harnesses drive the **running** app in Chromium. Neither calls app mutators
directly: the field is read from `window.__leluPortalField()`, click points are
resolved through the renderer's own raycaster (`window.__leluPortalPick()`), and
travel is started by real mouse clicks on the canvas.

## Bootstrap

The dev server must listen on `127.0.0.1:3013` (`bun run dev -- --host 0.0.0.0
--port 3013`). Chromium needs the workspace's font/sysroot libraries or every
glyph renders as a blank bar:

```bash
export LD_LIBRARY_PATH=$PWD/.apt/root/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=$PWD/.apt/fonts.conf
```

## probe-interaction.mjs

`PHASE=field` reads the field in the Core and Cosmos views and records, per
portal: the registry id, the mesh it claims to have drawn
(`spatial-portal-<id>`), its hit surface (`spatial-portal-hit-<id>`), the world
position and the projected screen point, plus what element the pointer meets
there. `PHASE=chat|placement|stability` are scaffolding for phases this mission
did not reach (reported as UNVERIFIED, not as passing).

```bash
PHASE=field node docs/acceptance/spatial-phase-2-13/scripts/probe-interaction.mjs
```

## probe-portal-click.mjs

Every attempt returns to the Core, waits until the runtime reports no
transition, then reads the field, scans for a screen point that (a) the
raycaster attributes to the target portal and (b) is met by the **canvas**
rather than a DOM overlay, clicks it, and records the transition and the scene
actually arrived at.

```bash
node docs/acceptance/spatial-phase-2-13/scripts/probe-portal-click.mjs
FULL=1 node .../probe-portal-click.mjs   # adds a second portal, conflict and reload passes
```

## Environment limits (report with any result)

Chromium runs `--headless=new` with `--enable-unsafe-swiftshader` on a headless
cloud VM: a software compositor. Frame rate and timing are **not** real-device
performance, and the compositor traps (`traps: chrome-headless trap int3` in
`dmesg`) on long sessions with a panel over the canvas — which is why each probe
is a short, single-purpose session that writes its result immediately.
