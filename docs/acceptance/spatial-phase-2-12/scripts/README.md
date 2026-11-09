# Mission 5.3 — evidence harness

Every number and image under `docs/acceptance/spatial-phase-2-12/` came from one
of these scripts driving the real application in Chromium. None of it is
hand-written.

## What each script does

| Script | What it measures |
|---|---|
| `probe-persistence.mjs` | Reproduces (or refutes) the 5.2 defect. Mounts the app, reads the real `localStorage`, dispatches `lelu-portal-create` through the documented channel, reads storage again, reloads, reads again. `VP=390x844 MOBILE=1` runs it at a phone size. |
| `probe-seeding.mjs` | Walks the surface (mount → dismiss the identity gate → travel to Cosmos) and reads the portal key at each step. This is the script that proved the built-in ring was never written. |
| `probe-lifecycle.mjs` | The lifecycle in short, independent phases (`PHASE=create\|remove\|chat\|transitions`), because a long session with a panel over the live canvas eventually traps the software compositor. Each phase writes its own result immediately, so a crash costs one phase, never the evidence. |
| `probe-viewports.mjs` | The same create → reload → remove → reload cycle at 375×812, 390×844, 430×932, 1440×900 and 1920×1080, plus the ring frame at each. `ONLY=390x844,1440x900` for a subset. |

## Environment

The runner ships no fonts and no Chromium libraries, and `sudo` is refused
(`no new privileges`). The 5.2 bootstrap still applies and is reused here:

```bash
npx playwright install chromium
# libraries and fonts unpacked into a workspace prefix, no root:
export LD_LIBRARY_PATH=$PWD/.apt/root/usr/lib/x86_64-linux-gnu
export FONTCONFIG_FILE=$PWD/.apt/fonts.conf     # DejaVu core
```

Without `FONTCONFIG_FILE` every glyph renders as a blank bar while
`textContent` still holds the strings — an environment gap, not an app defect.

Dev server: `npx vite --host 0.0.0.0 --strictPort --port 3013`.

## Known limits of this environment

- Software WebGL (SwiftShader) runs at a few frames per second, so cinematic
  states are captured with `prefers-reduced-motion` and long waits.
- A panel composited over the live canvas can trap the renderer (SIGTRAP). The
  lifecycle phases inject `backdrop-filter: none` for the panel steps: that
  changes compositing only, not the application's behaviour.
- Frames-per-second numbers from this machine are **not** device performance and
  are not reported as such.
