# LÉLU's presence: physical iPhone Safari and real-GPU acceptance procedure (M15.3 WP02, updated WP03)

**Status: NOT VERIFIED.** No physical iPhone, Safari or WebKit runner was available to the sessions that built M15.3. Every result in the M15.3 reports comes from Chromium on a software GPU (SwiftShader), mostly at phone-sized viewports.
- Viewport emulation is **not** an iPhone.
- WebKit automation is **not** an iPhone.
- SwiftShader is **not** a GPU.

This procedure is for whoever has the device. It needs no paid service and no new infrastructure: any build of this branch served over the local network (`npm run dev` on a laptop, then open `http://<laptop-ip>:5173/` on the phone on the same Wi-Fi), or an approved preview deployment.

## 0. Which build is this?

- The build stamp is in the bottom-right corner (e.g. `LÉLU d9f0320 · claude/charming-hamilton-icbyrb · development · built …`). A `+dirty` suffix means uncommitted changes: do not record acceptance against a dirty build.
- Web Inspector console: `window.__LELU_BUILD__` gives the full commit SHA, branch and build time. Record the full SHA.
- The WP03 movement fixes are present only from commit `d9f0320` on; an older build will still show the WP02 behaviour (first walk "still on my way" and stuck).

## Record first

| Field | Value |
|---|---|
| Device model (e.g. iPhone 15 Pro) | |
| iOS version | |
| Browser (Safari / Home-Screen web app) | |
| Build (the commit shown in the bottom-right build stamp) | |
| Viewport (Safari → `window.innerWidth × innerHeight`, portrait and landscape) | |
| Rendering mode: in Safari Web Inspector (Mac) console, run `document.querySelector('[data-testid=lelu-companion]').dataset.lowPower` | should be `none` on a real GPU |
| Low Power Mode on or off | |
| GPU (real-GPU desktop runs: `chrome://gpu` or Safari → Develop → WebGL renderer; on iPhone it is "Apple GPU") | |
| Full commit SHA (`window.__LELU_BUILD__.sha`) | |

**How to read frame rate:**
- **With a Mac:** Safari → Develop → [device] → Timelines, and record "Rendering Frames" during each step.
- **Without a Mac:** use Settings → Developer → (if present) frame-rate overlay, or note visible stutter.

Take a screenshot of each numbered step (side button + volume up).

## Steps

For each step: what to do, then what must be true.

1. **Home portrait.** Open the app, choose "Continue without an account" if asked, and wait for LÉLU.
   - Her head and shoulders sit in the Home's portrait spot.
   - She blinks and breathes; she is not a still picture.
2. **Studio: full body.** Open ☰ App Library → Studio.
   - All of her is shown, beside the Studio, not covering its controls, and animating.
3. **Hologram on Browser and Code.** Open Browser, go back Home, then open Code.
   - On both she is a compact, projected (cyan, scanlined, translucent) version of herself, still moving.
   - Switching screens causes no multi-second freeze.
4. **Chat.** Open Chat (Chat Universe), then close it.
   - She stays visible and moving while it is open.
   - She is back in place when it closes.
5. **App Library sheet.** Open ☰, then close it with ✕ or by tapping outside.
   - While open she is under the sheet: visible and moving, but not on top of it.
   - When it closes she is in front again.
6. **Render tile.** Open ☰ and tap **Render**.
   - The Render app opens. Her body never takes the tap meant for the tile.
7. **Form changes.** In Chat type `become a hologram`, then `become embodied`.
   - Each reply arrives, and she changes form everywhere with a short dissolve.
   - No freeze (the form switch is uniform-only since WP02).
8. **Framing.** In Chat type `show me all of you`, then `just your face`, then `choose your own form`.
   - Full body, then head and shoulders, then each screen chooses again.
9. **World entry and exit.** Open Worlds → Her world, then Worlds → Cosmos.
   - In her world she stands in the room; leaving it, her presence returns.
10. **Movement and gestures.** In her world, in Chat: `walk to the studio`, `face me`, `come closer`, `dance`, `go back to your spot`.
    - She walks at a normal pace, turns and dances.
    - Each reply reports what was measured, e.g. "walked 5.6 m…" or "turned to you…". A request she cannot do gets an honest "I didn't…".
10a. **Walk asked while her world is still loading (WP03).** From Home, open Worlds → Her world and, *without waiting for her to appear*, open Chat and type `walk to the studio`.
    - She does not move until her room has loaded, then walks round the Core (not through it, not into the chat window) to the Creation Studio.
    - The reply is "Done — … walked N m (walk to the studio); now at x …, z …, N cm from the point" (arrival is within 10 cm), or, if loading took most of 20 s, "I'm still on my way (… m to go on my route) … I'll keep walking there", after which she must really arrive.
    - With Web Inspector: `JSON.parse(document.querySelector('canvas[data-lelu-spatial]').dataset.leluSpatial).goal` shows `outcome` (`waiting-for-world` → `walking` → `arrived`), `remaining` (metres to the point) and the `route` she planned. `outcome` must never read `arrived` while `remaining` is over 0.1.
    - Leave the chat window open over the room for the *first* `walk to the studio`: an open window is an obstacle she must walk round (this was the WP02 failure).
10b. **Avatar panel close and reopen (WP03).** ☰ → Avatar → 3D. She stands in the panel. Tap the panel's ✕ (top-right). Then reopen it. Repeat 3 times, in portrait and once in landscape.
    - Each ✕ tap closes the panel at once (one tap, no second tap needed) and she returns to her place within about a second.
    - Each reopen shows the same live her (same form and framing), not a picture or a different figure.
11. **Repeated transitions.** Go Home → Chat → Home → Browser → Home three times.
    - She never stops moving and never disappears.
    - No transition stalls for more than about a second.
12. **Background and return.** Press the Home button and wait 30 s, then return to Safari.
    - She is there and moving again within about a second.
    - No reload and no blank canvas.
13. **Rotation.** Rotate to landscape and back, on Home, in Studio, with the Avatar panel open, and in her world mid-walk.
    - She re-places herself and stays visible; nothing overlaps the controls.
    - Mid-walk, she still arrives (the room re-projects the windows; she re-plans her route).
14. **Long session.** Leave the app open on Home for 10 minutes, then do step 11 again.
    - Still smooth, and the device is not hot.
    - Safari did not reload the page ("A problem repeatedly occurred" means a memory failure; record it).

## Real-GPU desktop (no phone needed)

Steps 1–11 and 10a/10b on a desktop browser with a hardware GPU (Chrome or Safari, `chrome://gpu` must show hardware acceleration, not SwiftShader). Also run the automated acceptance against that machine's browser if Playwright can drive it there:
`LELU_URL=http://127.0.0.1:5173/ node scripts/avatar/verify-avatar-presence.mjs all` — remove the `--use-angle=swiftshader` launch flags first, and record that you did. Expected: every step passes, and walks arrive in a few seconds rather than the 10–15 s measured on SwiftShader.

## Report back

For each step: pass or fail, a screenshot, and the frame-rate observation. For any failure: what was on screen and what you did just before, plus the `leluSpatial` telemetry line for movement failures. Save the results as `docs/missions/m15-home/avatar-15.3/device/<device>-<date>.md` with the screenshots beside it, and record the full SHA tested.

Until such a record exists, physical iPhone Safari and real-GPU acceptance are **NOT VERIFIED**.
