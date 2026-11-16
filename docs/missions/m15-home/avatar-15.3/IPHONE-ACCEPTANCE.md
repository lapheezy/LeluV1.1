# LÉLU's presence: physical iPhone Safari acceptance procedure (M15.3 WP02)

**Status: NOT VERIFIED.** No physical iPhone, Safari or WebKit runner was available to the sessions that built M15.3. Every result in the M15.3 reports comes from Chromium on a software GPU (SwiftShader), mostly at phone-sized viewports.
- Viewport emulation is **not** an iPhone.
- WebKit automation is **not** an iPhone.
- SwiftShader is **not** a GPU.

This procedure is for whoever has the device.

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
11. **Repeated transitions.** Go Home → Chat → Home → Browser → Home three times.
    - She never stops moving and never disappears.
    - No transition stalls for more than about a second.
12. **Background and return.** Press the Home button and wait 30 s, then return to Safari.
    - She is there and moving again within about a second.
    - No reload and no blank canvas.
13. **Rotation.** Rotate to landscape and back, on Home and in Studio.
    - She re-places herself and stays visible; nothing overlaps the controls.
14. **Long session.** Leave the app open on Home for 10 minutes, then do step 11 again.
    - Still smooth, and the device is not hot.
    - Safari did not reload the page ("A problem repeatedly occurred" means a memory failure; record it).

## Report back

For each step: pass or fail, a screenshot, and the frame-rate observation. For any failure: what was on screen and what you did just before.
