# Mission 15.3 WP02 — Avatar performance, world movement, the real preview, device acceptance

Prompt `M15.3-WP02-P01` v1.0, dated 2026-11-16.
Branch `claude/charming-hamilton-icbyrb`; base `4adbbdc4fe3b0fa1015ab19298b53cd7cf72ac99` (M15.3 WP01), which was still the remote head and had a clean worktree at the start. This follows `MISSION-15.3-AVATAR-PRESENCE.md` (unchanged).

Only the existing system was touched:
- `LeluCompanion`, `LeluBody`, `LeluCharacter3D`, `holoMaterial`, `LeluV2Presence`, `AvatarCommandBus` and the approved v005 model.
- No new controller, model, renderer, store or adaptation system.
- No dependency or paid service, no model call, no voice files.

**Test conditions** for every measurement, before and after: Chromium with **SwiftShader** (a software GPU) in a container; phone means a 393×852 viewport emulated in Chromium. That is not a phone and not a GPU (see §6).

---

## 1. Finding 1: WP01's "Studio 59.6 → 31.9 / Code 59.9 → 23.6 fps" was mostly a measuring artefact

The WP01 harness sampled 3 s, starting 2.5 s after a screen switch. Its average fps therefore included the switch's own trailing long tasks and the app's background work.

The harness now records frame-time **percentiles** and **dropped frames**, waits until no long task has started for 1.5 s, then samples 5 s. A controlled A/B was run on the same build and page state, with her companion present vs. her element removed, interleaved, 8 rounds × 5 s:

| Phone screen | With LÉLU: median fps (min) | Without her: median fps (min) |
|---|---|---|
| Code | 60 (23) | 60.2 (34.8) |
| Studio | 60 (33) | 60.2 (38.2) |

Each variant had one dip. A 30 s trace on the settled Code screen recorded **no long tasks, no captures and no attribute changes on her element**, so the dips are background app work. On the main thread (desktop, CPU profile, companion on vs. off through her own `CompanionStore.enabled`), her cost is below the noise floor:

| Scene | Busy, companion on | Busy, companion off |
|---|---|---|
| Chat | 48.3% | 56.6% |
| Home | 43.5% | 49.8% |

Raw data: `m15-home/avatar-15.3/wp02/cpu-*.json` and `measure-wp02-*.json`.

**Not dismissed, corrected:** WP01's settled-screen "regression" is not reproducible. What *is* hers was found in the **screen switches** (§2).

## 2. Finding 2 (root cause): her screen switches cost seconds, all of it hers

The same route was run with her companion on vs. off (phone, long-task ms during each switch into an app screen):

| Switch into | On | Off |
|---|---|---|
| Chat | 1758 | 204 |
| Browser | 6748 | 587 |
| Studio | 3948 | 808 |
| Code | 3834 | 397 |

CPU profile of Home → Code (`scripts/avatar/profile-transition.mjs`), attributed by call stack:

| Cost | Time | Cause |
|---|---|---|
| `toDataURL` | 1.57 s | Her low-power still: a synchronous GPU readback plus PNG encode into an `<img>`, on every switch. |
| `getShaderInfoLog`, `getProgramInfoLog`, `(program)` | ≈2.5 s | Changing her form (embodied face on Home → hologram on Code) toggled `material.transparent`. In three.js that flips the `OPAQUE` define, so **every one of her materials compiled a new shader program mid-switch**. three.js deletes a program once no material uses it, so the other variant cannot be kept warm (a pre-compile was tried and measured useless: 14 ms, then the compile still happened at first use). |
| `WebGLRenderer.setSize` | 0.6–3.4 s | Her canvas was reallocated (multisampled buffers) whenever her box changed, and **twice** per switch: a transient larger box for about 300 ms, then the edge spot. |

### Fixes, in the existing renderer

| Fix | File |
|---|---|
| **Form switching is uniform-only.** Her originally opaque materials get a fixed alpha-blend mode (the same factors as NormalBlending) once, at load, and write alpha = 1 while embodied, so she looks exactly as before. Their program key never changes again; no `transparent` or `needsUpdate` on a form change. Depth writes stay on, so a hologram shows one translucent layer of her. | `avatar/holoMaterial.ts`, `avatar/LeluBody.tsx` |
| **No readback for her rest.** A paused canvas keeps showing its frame; one new frame is drawn on the canvas itself when her form, framing or size changes (`RestFrame`). The `toDataURL` and `<img>` path is removed. | `avatar/LeluCharacter3D.tsx`, `avatar/LeluCharacter.tsx`, `avatar/LeluCompanion.tsx` |
| **Fewer canvas reallocations.** Her canvas is scaled, not resized, when her place shrinks (down to 40%), and it grows only for a place that lasts 500 ms (a drag is live). | `avatar/LeluCompanion.tsx` |

Result on the same switch (Home → Code), several runs: **4.7–6.9 s → 1.0–1.4 s** of long tasks. About 0.35 s of that is the screen itself (companion off). The remaining 0.4 s that appears only with her is the **Cosmos** canvas's own unmount (`forceContextLoss`), slower in a software GPU while a second context is alive. That is Cosmos lifecycle, not hers.

### Before/after, identical conditions

The base commit `4adbbdc` was served from a separate checkout and compared with the final code. Same script (`profile-transition.mjs`), phone size, 2 runs each. Figures are long-task ms during the switch.

| Switch | Before (`4adbbdc`) | After (final) |
|---|---|---|
| Home → Chat | 2737 (worst 2019), 2367 (worst 1624) | 731 (worst 185), 962 (worst 701) |
| Home → Browser | 4885 (worst 4062), 5235 (worst 4117) | 822 (worst 429), 801 (worst 215) |
| Home → Studio | 2304 (worst 1458), 3037 (worst 1891) | 486 (worst 182), 799 (worst 362) |
| Home → Code | 4566 (worst 3648), 4524 (worst 3723) | 1052 (worst 480), 914 (worst 359) |

**3–6× less main-thread blocking on every switch.** The worst single freeze fell from 1.5–4.1 s to 0.2–0.7 s.
- **What stayed the same:** she is still shown, still adapts her form (the hologram on Browser and Code), and still animates on capable devices.
- **What was not added:** no hiding, no freezing, no shrinking.
- **Not changed:** the measured low-power rest (§6), which still applies only on "light" devices.

Route-level settled measurements (`measure-wp02-{before,after}-{phone,desktop}.json`) are recorded too. Their settled fps swings both ways between runs (background app work), and the "after" run overlapped live edits (hot reload). They are kept as data, not cited as proof.

## 3. World movement

**Root cause of the two WP01 timeouts (3.8 m and 8.2 m walked):** her walk was one collision-checked step **per rendered frame**, capped at 0.25 s. Under load her world rendered at 0.2–1 fps here, so she walked far slower than real time and long walks outlasted any deadline. WP01 raised the deadline to 45 s, which hid it.

**Fixes (`LeluV2Presence.tsx`):**
- **Elapsed time.** She walks in elapsed time, not per frame: each frame integrates the real time since the last one (up to 5 s), split into collision-checked sub-steps of ≤ 0.1 s. Turning also uses elapsed time.
- **Honest deadline.** The walk deadline is back to **20 s** (turning 8 s) in `AvatarResolver` and `avatar.move`.
- **Dragging cancels.** Taking her by the hand mid-walk ends that walk with an honest decline ("you moved me yourself before I got there").
- **Kept from WP01:** a valid command arrives (measured), or stops near the goal and reports the measured distance short, or declines with the reason. A newer command supersedes an older one.

**Result.** The same final code was run through the overlay and her world in the real app: 10/10 valid outcomes in the dedicated actions run (`scripts/avatar/verify-avatar-presence.mjs actions`). The two scenarios that failed in WP01:

| Scenario | WP01 final run | WP02 |
|---|---|---|
| "walk to the Studio" (first command after entering her world) | silent timeout after 3.8 m | Measured progress report before the 20 s deadline ("still on my way: 3.78 m from where I started, 5.65 m to go… 0.8 frames/s, and I'll keep walking there"). She keeps walking. In isolation the same walk **arrives in about 5 s, confirmed**, at 0.4–1.6 fps. |
| "come closer" | silent timeout after 8.2 m | **Arrived and confirmed** ("walked 8.07 m") within the 20 s deadline. |

Other world commands: "face me" confirmed within 0.0°; "dance" confirmed by her hand moving; "go back to your spot" confirmed, or honestly declined when blocked ("stopped 1.59 m short").

**Also found and fixed:** her world's asynchronous load could land seconds after a walk began, teleport her back to her saved place and reset her target mid-walk. The saved place is now applied only when she is not walking somewhere.

**Remaining:** the first Studio walk in the full sequence still does not arrive within 20 s. It is honestly reported as on the way, not as arrived. One plausible cause, not yet proven: the open chat window is projected onto her floor as an obstacle about 2.2 m across, centred near where she stands, so she may be routing around it. Recorded as PARTIAL.

## 4. The Avatar panel shows her, not a placeholder

**Before:** the panel's "3D" tab showed a procedural figure, or the saved reference *photo* as a "billboard". Its "Render 3D snapshot" rendered the procedural figure again. None of these was her.

**Now** the tab reserves a spot (`[data-lelu-preview-host]`) and her one presence stands in it. `presencePlacement.choosePlace` ranks the preview spot after a world; the presentation profile has a `preview` context. That gives:
- the approved v005 model, live, in the form and framing chosen in the panel's Presence controls;
- **no second canvas, model copy or controller**;
- when the panel closes, she returns to her place.

The procedural preview, the billboard and the procedural snapshot were removed from the panel. The external reconstruction section is unchanged.

**Result** (`verify-avatar-presence.mjs panel`): **20/20** on desktop (1440×900) and phone size (393×852).
- **Opening the panel:** her presence moves into the spot (`data-presence="preview"`), on the **same canvas element**, with model key `rig/v005_faceshapes_mvwaqbim/lelu.glb`.
- **Animation:** she animates on desktop; on the software-renderer phone run she is in the measured low-power rest.
- **Choices:** each Form and Framing choice (Hologram, Face, Full body, Embodied, Auto) changes her immediately on the same canvas.
- **Close and reopen** (×2): she returns to her place, then back into the spot.
- **No new avatar context.** The page's total WebGL context count does rise across close/reopen (+4 to +11). That is the Cosmos canvas being re-created when the panel's window covers or uncovers it; her canvas is the same element throughout.

Pictures: `m15-home/avatar-15.3/verify/panel-*.png`.

## 5. Regression protection

`tests/avatar-forms-actions.test.ts` gains 5 tests:
- a form change never touches a material's version, program key or `transparent`
- embodied stays exactly opaque
- the preview spot outranks other places, and the preview follows her chosen form
- the panel has no procedural figure, billboard, snapshot or second canvas
- the walk integrates elapsed time in sub-steps; a drag declines; the 20 s deadline

| Check | Result |
|---|---|
| Typecheck (`npm run typecheck`) | exit 0 |
| Lint (`npm run lint`, oxlint) | exit 0; **0 errors**, 178 warnings (= baseline) |
| Production build (`npm run build`) | exit 0 |
| Full suite (`npm test`) | **2279 tests, 2273 pass, 0 fail, 6 skipped**: the WP01 baseline of 2274 plus the 5 new tests; no test was rewritten |
| Focused avatar tests | `avatar-forms-actions` 13/13, `avatar-presence` 5/5, `chat-surface` 31/31, `lelu-character` 8/8 |
| Full browser acceptance on the final code | **63/65** (`verify-avatar-presence.mjs all`):
- **Passing areas:** forms, context adaptation on desktop and phone, actions (all world commands valid outcomes), App Library at four viewports, Avatar panel, activity, transition stress.
- **The two failures** are the phone panel's close/reopen steps. In this run the test's tap on the window's close control did not close the panel ("closed: preview": the panel was still open and she correctly stayed in its spot). The dedicated panel run on the same code passed close/reopen twice on both desktop and phone (20/20). Recorded as a test-interaction flake, not fixed in code. |

## 6. Device and hardware matrix

| Environment | What it is | Result |
|---|---|---|
| Chromium + SwiftShader, 1440×900 | desktop browser, **software GPU** | TEST-VERIFIED (this report) |
| Chromium + SwiftShader, 820×1180 / 393×852 / 852×393 (touch, mobile emulation) | viewport emulation, **not a tablet or phone** | TEST-VERIFIED (viewport only) |
| WebKit automation | not available here | NOT RUN |
| Physical iPhone, Safari | not available | **NOT VERIFIED.** Procedure: `m15-home/avatar-15.3/IPHONE-ACCEPTANCE.md` |
| Any real GPU (phone or desktop) | not available | **NOT VERIFIED**: she stays live beside phone sheets by design; frame rate unmeasured |

## 7. Limitations and open items

1. **No physical iPhone and no real GPU.** All numbers are SwiftShader, where the whole page is about 2 fps whenever the Cosmos draws. Her real-GPU frame rate beside phone sheets is unmeasured.
2. **The low-power rest stays** on devices measured "light" (software renderer, no WebGL, data saver). There she shows a frame of herself, redrawn on change. She is never hidden.
3. **The first world walk under load** may still be on its way at the 20 s deadline. She says so with measured progress and keeps walking. The projected chat-window obstacle is a suspected cause, not yet proven.
4. **Cosmos canvas re-creation** on Home returns and window cover changes is the Cosmos's own lifecycle, unchanged.
5. **Settled-screen fps:** no measurable difference between her presence and her absence (§1). WP01's "regression" figures were not reproducible.

## 8. Objectives

| ID | Objective | Status |
|---|---|---|
| O01 | Reproducible baseline and root cause | VERIFIED (§1, §2) |
| O02 | Measurable improvement without hiding or freezing her | TEST-VERIFIED (§2: 3–6× on every switch, she is still shown and animated) |
| O03 | Stable animation and sheet interaction | TEST-VERIFIED (acceptance run) |
| O04 | World movement succeeds, stops accurately or declines honestly under load | TEST-VERIFIED for outcomes (no silent timeouts in the actions run); PARTIAL for the first Studio walk under load (§3) |
| O05 | Panel uses the approved model | TEST-VERIFIED |
| O06 | No duplicate continuously running renderer | TEST-VERIFIED (same canvas, no panel canvas) |
| O07 | Form, framing and identity persist | TEST-VERIFIED |
| O08 | No leaked contexts or stale renderers on repeated transitions | TEST-VERIFIED for her (one canvas); the Cosmos's re-creation is recorded (§7.4) |
| O09 | WP01 behaviour regression-tested | TEST-VERIFIED |
| O10 | Physical-device procedure | VERIFIED (`m15-home/avatar-15.3/IPHONE-ACCEPTANCE.md`) |
| O11 | Physical iPhone and real-GPU acceptance | **NOT VERIFIED** |
| O12 | Typecheck, lint, build, full suite | VERIFIED |
| O13 | Docs and evidence committed | VERIFIED |
| O14 | Git provenance and push | in the session's final report |
