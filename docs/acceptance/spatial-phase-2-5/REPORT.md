# LÉLU V1.1 — Phase 2.5: Spatial control and mobile chat reliability

Branch `freebuff/phase-2-2`, continuing from Phase 2.4 (`58f845a`). No architecture
was replaced: the spatial graph, the intent bus, the tier guard, the approval token,
the existing Genesis camera and the Chat Universe are the Phase 2.3/2.4 ones.

**Headline:** camera focus, orbit, zoom and reset are now driven by real chat
messages and verified against the **measured** camera. The transcript is readable
and the phone composer survives a growing conversation. One acceptance item is
**not** met: no screenshot shows a created object in the world, because the surface
that follows chat is the Home dashboard, not the 3D world.

## 1. The environment was the Phase 2.4 "empty transcript" and "Chromium crash"

Phase 2.4 recorded unreadable bubbles and a renderer crash and treated them as
product/environment limits. They were one fault: the sysroot has fonts, but
fontconfig's compiled-in `/usr/share/fonts` does not exist outside a chroot, so
Chromium had **no font**. Every string measured zero width (assistant bubble:
`28 × 22 px`, exactly its padding) and a second message aborted the renderer in
`render_text_harfbuzz.cc:1156`.

`scripts/setup-browser-env.sh` now installs `fonts-dejavu-core`, writes
`/tmp/lelu-fonts.conf` pointing into the sysroot, and exports `FONTCONFIG_FILE`.
After that: bubbles measure `491 × 64 px` (1440) and `270 × 85 px` (390), text is
readable everywhere, and a six-command session completes without a crash. Details
in [environment.md](environment.md).

## 2. Four product defects fixed

### 2.1 A `fly` intent was applied as a zoom
`GenesisCameraController` handled `reset` and treated every other intent as a
1.3× dolly along the current view axis. LÉLU's `camera.focus / frame / orbit /
zoom` all dispatch a `fly` pose, so no camera ever flew to the requested pose.
The controller now implements `fly` with its own existing `flyCameraTo()`.

### 2.2 Verification sampled the camera mid-flight
The bus waited a fixed 1.3 s and then compared the *requested* pose with whatever
the camera was doing. It now waits for the rig to **come to rest** (no movement
> 0.008 units for 240 ms, bounded at 6 s) and verifies that settled camera.

### 2.3 Reset reported a pose the mounted rig never visits
`SpatialCameraApplier.reset()` returned the v2 rig's home `(0, 1.7, 10.4)`, while
the live v1 Genesis camera resets to `(0, 0, 6.8)` looking at the origin — so a
real reset was reported as `camera fail`. Reset now reports the live world's home,
and reset verification checks the measured camera against the documented home
views (`0,0,6.8` v1 / `0,1.7,10.4` v2) instead of trusting a requested pose.

### 2.4 Autonomous camera motion fought every command
Exploration and the presence engine pause on `genesis-user-camera-start` — the
event a real drag emits — but LÉLU's camera commands never emitted it. Orbit was
measured against a camera that an autonomous move had taken elsewhere
(`(0, 6, 0.5)`). Spatial camera commands now announce the takeover before reading
the camera and release it after verification.

Replies now quote the **measured** camera, not the requested one.

## 3. Desktop: one continuous session (1440×900)

Every line below is a real message submitted through the composer, with the
revision and camera read from `__leluSpatialProbe()` after the reply.

| # | Message | Revision | Measured camera | App verification |
| --- | --- | --- | --- | --- |
| 1 | `create a cube called Nova` | 0 → 1 | (0.30, 3.35, 7.85) | — (commit) |
| 2 | `show me Nova` | 1 → 1 | (1.74, 0.39, 4.86) | **camera pass, framing pass** |
| 3 | `orbit around Nova by 30 degrees` | 1 → 1 | (0.68, 0.39, 5.30) | **camera pass, framing pass** |
| 4 | `zoom out` | 1 → 1 | (0.79, 1.09, 6.19) | **camera pass, framing pass** |
| 5 | `return to the original view` | 1 → 1 | (0, 0, 6.80) | **camera pass, framing pass** |
| 6 | `what is in the scene` | 1 → 1 | unchanged | scene revision 1: 1 object |

Focus/orbit/zoom/reset previously all reported `camera fail`; they now pass
because the camera actually arrives and is read after it settles. Revision never
changes on a camera command, and the object stays `rendered: true, visible: true`
throughout.

Screenshots: `screenshots/1440x900-01-create … 06-list`. Trace:
`traces/desktop-continuous-camera.zip`.

## 4. Phone: four consecutive messages, readable transcript

390×844 and 375×812, same composer path.

| Viewport | Messages | Revision | Result |
| --- | --- | --- | --- |
| 390×844 | `add a sphere called Comet`, `what is in the scene`, `show me Comet`, `zoom in` | 0→1, 1→1, 1→1, 1→1 | all submitted, all replied |
| 375×812 | `add a cube called Nova`, `show me Nova` | 0→1, 1→1 | both submitted, both replied |

The composer remained present and usable after each message (tracked by rect and
visibility after every send); the earlier Phase 2.4 "mobile composer unreachable"
was the harness selecting the Universe footer field that sits **under** the chat
sheet. Driving the chat window's own composer fixes it — no product change was
needed for this.

Transcript bubbles grew from `270 × 85` to `270 × 190 px` with readable text,
so the growing-conversation requirement holds.

Screenshots: `screenshots/390x844-01…05`, `375x812-01…03`. Traces:
`traces/mobile-continuous-chat.zip`, `traces/mobile-narrow-focus.zip`.

## 5. Not verified: the object has not been seen on screen

This is the one acceptance item that fails, and it is reported as such.

* While chat owns a phone screen the router **deliberately unmounts** the world
  ("not hidden, not behind it", `GenesisScene.tsx`), so `rendered: false` during
  chat is by design.
* After chat is closed, both 1440×900 and 390×844 return to the **Home
  dashboard** (cards, dock, LÉLU portrait). The probe then reports three canvases,
  28 live nodes and the created object `rendered: true, visible: true`, but the
  captured pixels show no cube — the dashboard covers the world.
* `screenshots/1440x900-07-world.png` and `screenshots/390x844-23-world.png` are
  exactly those captures: home dashboard, **no object visible**.

So: object state in the live scene is verified; **visual rendering of the object
is not**. No pixel-level claim is made for either viewport. Reaching the actual
Genesis v1 world on this build (`surface.cosmosRendered`) is the missing step, and
it is left as an open item rather than papered over with the probe reading.

## 6. Status by requirement

| Requirement | Status |
| --- | --- |
| Full continuous desktop camera session | **Verified** (create → focus → orbit → zoom → reset → inspect) |
| Camera coordinates verified after every operation | **Verified** — measured by probe, checked by `verifyCamera` / `verifyCameraHome` |
| Phone: multiple consecutive messages | **Verified** at 390×844 (4) and 375×812 (2) |
| Phone: composer stays reachable | **Verified** |
| Transcript readable as it grows | **Verified** (rects + text in captures) |
| Created object renders, visible on screen | **Failed visually** — probe true, pixels show dashboard |
| Authorization / refusal / delete paths preserved | **Unchanged and still covered** (23 spatial tests, including refusals and approved delete) |

## 7. Gates (measured)

| Check | Result |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun test tests/spatial-integration.test.ts` | 23 pass, 0 fail |
| `bun run lint` | 0 errors, 108 warnings (unchanged) |
| `bun test` (clean env) | **1329 pass, 38 fail, 6 skip** — identical to the Phase 2.4 baseline, no new failures |
| Playwright session | 3 traces, 20 screenshots, no crash |

Run the full suite with `env -u CHROME -u LD_LIBRARY_PATH -u FONTCONFIG_FILE`:
exporting `CHROME` makes a browser-dependent layout test run instead of skip and
adds one unrelated failure. That is an invocation artifact, not a regression.

## 8. Files

Modified:
* `src/app/scene/genesis/GenesisCameraController.tsx` — real `fly` handling
* `src/app/scene/genesis/GenesisCameraIntent.ts` — camera takeover events
* `src/core/spatial/SpatialCameraApplier.ts` — take the camera before reading it; real home pose
* `src/core/spatial/SpatialIntentBus.ts` — settle-then-verify, measured replies, release takeover
* `src/core/spatial/SpatialVerification.ts` — home-view verification
* `tests/spatial-integration.test.ts` — reset now expects the home the live world uses
* `scripts/setup-browser-env.sh` — fonts + fontconfig (also fixes the Phase 2.4 crash)

Added: this directory (`REPORT.md`, `environment.md`, `test-results.json`,
`diagnostics.json`, `world-shots.json`, `mobile-world.json`, `screenshots/`,
`traces/`).
