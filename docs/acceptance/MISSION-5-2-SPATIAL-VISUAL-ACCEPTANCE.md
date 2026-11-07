# MISSION 5.2 — SPATIAL VISUAL ACCEPTANCE, MULTI-DEVICE VALIDATION & FINAL INTEGRATION

**Repository:** LÉLU V1.1 · **Branch:** `claude/master-integration`
**Date:** 2026-11-07
**Baseline:** Mission 5.1 checkpoint, implementation untouched except where this report documents a defect.

This mission was scoped as acceptance, not construction. It found one real
missing capability (an agent tool that did not exist), closed it, and then hit a
hard environment wall on the visual half that no amount of testing technique
removed. Both are reported below with the evidence that produced them.

---

## 1. Starting commit

`3d914dd` — verified to still be an ancestor of the branch before any work
began. The branch and the remote were identical at start (`behind_ahead=0 0`),
and `3d914dd..HEAD` was empty.

## 2. Ending commit

The commit that carries this report on `claude/master-integration` (see
`git log -1 --stat`). No force-push, no reset, no history rewrite: the mission
was committed on top of the verified checkpoint.

## 3. Files changed

| File | Change |
|---|---|
| `src/core/interface/InterfaceTools.ts` | **New capability.** `spatial.portal.create` and `spatial.portal.remove` tool definitions plus their executors. The executor asks the mounted spatial interface over the existing `lelu-portal-create` / `lelu-portal-remove` domain events and waits for its structured answer, so an agent reaches the one registry through the one scene. Refuses with the registry's own reason; never claims a portal it did not create. |
| `tests/portal-tools.test.ts` | 6 tests: registration/risk, destination enum derived from the scene graph, an executor for each tool, refusal with no interface mounted, refusal to remove a built-in `scene:` identity, refusal without an id. |
| `docs/acceptance/spatial-phase-2-11/` | Five-viewport screenshots, measurement JSON, and the reproducible harness (`capture.mjs`, `short-shot.mjs`, `README.md`). |
| `docs/acceptance/MISSION-5-2-SPATIAL-VISUAL-ACCEPTANCE.md` | This report. |

No portal registry, layout engine, camera, scene, dock or Studio was added,
rebuilt or duplicated. Mission 5.1's implementation is the baseline and was not
reopened.

## 4. Browser tooling used

The in-panel browser is fixed at 328×528 and cannot be resized, so it was not
used for acceptance.

| Step | Result |
|---|---|
| `npx playwright install chromium` | Chromium **151.0.7922.34** + headless shell downloaded |
| System libraries | `sudo` is blocked (`no new privileges`), so apt was bootstrapped into a **workspace prefix** (`.apt/`), 28 `.deb`s fetched and unpacked with `dpkg-deb -x`, resolved via `LD_LIBRARY_PATH` |
| Launch | full Chromium, `--headless=new`, `--enable-unsafe-swiftshader` (software WebGL) |
| Emulation | Playwright contexts with exact `viewport`, `hasTouch` + `isMobile` on phones, `reducedMotion: "reduce"` |
| Optional | `NOBLUR=1` injects `backdrop-filter: none` (recorded per capture) |

Both binaries were exercised: the headless shell traps (SIGTRAP) exactly like
the full build; the full build is used because it mounts and advances
transitions faster.

## 5. Actual viewport sizes

| Device | CSS viewport | Device scale | Captured pixels |
|---|---|---|---|
| Small iPhone | 375×812 | 1 | 375×812 |
| Standard iPhone | 390×844 | 1 | 390×844 |
| Large phone | 430×932 | 1 | 430×932 |
| Desktop | 1440×900 | 1 | 1440×900 |
| Large desktop | 1920×1080 | 1 | 1920×1080 |

DPR 1, not 3: at DPR 3 the renderer trapped reproducibly within the first
transitions. Each capture JSON records the real `devicePixelRatio` and the
pixel dimensions it produced. **This is a CSS-size acceptance, not a
retina-quality one** — that limitation is carried into the matrix rather than
hidden.

## 6. Screenshot evidence

Location: `docs/acceptance/spatial-phase-2-11/`.

| File | Viewport | What it actually shows |
|---|---|---|
| `375x812-01-genesis-shell.png` | 375×812 | Shell mounts at the small-iPhone size: 3 canvases, scene `core` |
| `390x844-01-genesis-shell.png` | 390×844 | Shell at the standard-iPhone size |
| `430x932-01-genesis-shell.png` | 430×932 | Shell at the large-phone size |
| `1440x900-01-genesis-shell.png` | 1440×900 | Shell at desktop size: window frames, dock, rail |
| `1920x1080-01-genesis-shell.png` | 1920×1080 | Shell at the large-desktop size |
| `390x844-02-cosmos-home.png` | 390×844 | Camera at the Cosmos destination (`current: cosmos`) |
| `1440x900-02-cosmos-home.png` | 1440×900 | Same destination at desktop size |
| `390x844-03-spatial-portal-ring.png` | 390×844 | Camera at the dimensional-portal destination |
| `1440x900-03-spatial-portal-ring.png` | 1440×900 | Same destination at desktop size, full window chrome |
| `1440x900-probe-noblur.png` | 1440×900 | The diagnostic frame behind section 6: glass disabled, `backdropFilterDisabled: true`; structure sharp, text blank |

**What these images do not show.** In this container the app's frosted glass is
mis-composited by SwiftShader (the whole frame renders blurred), and with the
glass disabled the frame is structurally sharp but **every glyph renders as a
blank bar** while `document.body.innerText` is empty and `textContent` holds the
real strings. The text/opacity entrance animations never complete at the
measured frame rate. The remaining twelve required captures (creation panel,
removal, transition, destination, auto-arrange, regenerate, pinned, manual,
chat-open, Studio) were not obtained: opening the portal panel over the live
canvas reproducibly kills the renderer.

These captures are evidence that **the shell mounts and the camera travels at
the required CSS sizes**. They are **not** evidence of a legible interface on a
device, and this report does not claim otherwise.

## 7. Dynamic portal-ring results

**Registry behaviour: PASS (tests). Identity, namespacing, idempotent seeding,
honest persistence and travel planning are covered by
`tests/spatial-portals.test.ts` (8 tests) and unchanged this mission.**

**Live 3D ring: UNVERIFIED.** In every headless run, after 6 s at `core`,
`localStorage["lelu.lelu.spatial.portals.v1"]` was **absent** (`raw: null`,
portal-related keys `[]`), although `SpatialPortals` calls
`registry.seedRing(PORTAL_SCENES)` on mount and on effect. `seedRing` deletes
the seeded records again when `persist()` fails, so the ring may be empty at
runtime in this environment. This is the one finding that needs a real-GPU
browser to resolve: either localStorage is unavailable during the first mount
(it is not — other `lelu.*` keys exist), or `seedRing`'s write is throwing.
**Not fixed blind.** The scene renders at the portal destination
(`scene: portal`, 3 canvases) but the portal meshes themselves could not be
counted or read from the image, so built-in, user and agent portals in the ring
are all UNVERIFIED visually.

## 8. Agent-created portal results

**Tool layer: PASS (new, tested).** Before this mission there was **no** tool
carrying portal creation: `lelu-portal-create` was a DOM event with a handler
and registry tests, unreachable from a conversation, because
`ToolDispatcher` is the only source of advertisable tools. Two executors were
added in the existing `InterfaceTools` module and registered by the existing
`registerInterfaceTools()` call.

**Live conversation path: UNVERIFIED.** The ten-step execution
(instruction → destination → tool routing → registry → structured result →
transcript → ring → selection → travel → arrival) never completed: the run that
enters the portal panel dies at the panel. No provider-based turn was attempted
in this environment because the shell could not reach a legible chat.

## 9. Conversation preservation results

**UNVERIFIED.** The sequence requires a chat that renders and a navigation that
completes while it is open. Neither was available: the chat capture scenario
runs after the panel scenarios, which trap. Nothing in this mission's changes
touches conversation state, and Mission 5.1's code path
(`SpatialExperience` minimizes rather than closes, and the chat is the single
documented exception) is unchanged — but that is an argument, not a measurement,
and is reported as such.

## 10. Mobile interaction results

**PARTIAL.** Verified with real touch input (`touchscreen.tap` at control
coordinates):

- the collapsed rail expands on a phone and exposes all 13 destinations;
- tapping `cosmos` starts `camera-pullback` and arrives (`current: cosmos`);
- tapping `portal` arrives at `current: portal`;
- the rail is present at 375, 390 and 430 without horizontal overflow.

Not verified on a phone: creating a portal by touch, pinning by touch, dragging
a window by touch, and the on-screen keyboard. A mouse-driven drag was used for
the manual-placement scenario because the touch drag itself is what the
renderer could not survive.

## 11. Desktop interaction results

**PARTIAL.** Verified with real mouse input at 1440×900: rail travel
(`core → cosmos → portal`), the portal destination camera, window chrome
rendered (frames, dock, dock groups), and three live canvases at `core`
dropping to zero when a workspace module owns the screen. Not verified:
auto-arrange, regenerate, pin, manual placement — all live behind the portal
panel, which traps.

## 12. Performance measurements

Measured, unthrottled, software rendering (the only renderer available here):

| Measurement | Value | How |
|---|---|---|
| Idle `requestAnimationFrame` rate | **5 frames / 2051 ms ≈ 2.4 fps** | 2 s rAF counter at `core` |
| Same, full Chromium build | **6 frames / 2611 ms ≈ 2.3 fps** | identical counter |
| Transition progress rate | **0.06–0.07 per 600 ms** | `workspace-expand` sampled 4× |
| Consequence | a 1500 ms cinematic takes ~15–20 s of wall clock | derived from the above |
| Canvases at `core` | **3** | DOM count |
| Canvases while a workspace module owns the screen | **0** | DOM count |

**These are not device performance numbers and must never be quoted as such.**
They measure SwiftShader in a container and are the reason the mission's
animation-heavy states could not be captured. No GPU, no physical device and no
real mobile browser was available to this agent.

## 13. Memory measurements

**UNVERIFIED.** No `performance.memory` / CDP heap series was collected: the
runs that would have produced it (10 repeated transitions) are precisely the
runs the renderer traps in. Mission 5.1's two single samples (476 MB → 517 MB)
remain the only memory figures and are not a leak test. Nothing here should be
read as "no leak".

## 14. Test results

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc -b --force` | **PASS** — 0 errors |
| Tests | `bun run test` | **PASS** — 1636 pass, 0 fail, 2 skipped (200 s) |
| Lint | `bun run lint` | **PASS (baseline +1)** — 0 errors, 115 warnings; baseline 114 |
| Build | `bun run build` | **PASS** — exit 0, `✓ built in 7.01s` |

The +1 warning is in this mission's evidence scripts, not in application
source: `npx oxlint src/core/interface/InterfaceTools.ts` reports **0 warnings
and 0 errors**, and the two retained harness files lint clean. No test was
skipped, weakened or deleted; `tests/portal-tools.test.ts` (6 tests) is new and
passing.

## 15. Remaining defects

1. **`seeding did not persist in headless runs`** — the built-in ring had no
   stored records after mount. Needs a real-GPU browser and a look at
   `seedRing`'s persistence path before anyone claims the ring is populated.
   Highest-priority open item from this mission.
2. **Agent portal tool was missing** — now implemented and tested; the live
   conversation path still needs a run on a capable browser.
3. **Environment, not app:** SIGTRAP in the renderer during long sessions and
   when a `backdrop-filter` panel composites over the live canvas; text/opacity
   animations not completing at ~2.4 fps; page-wide frosted blur mis-composited.
   Reproducible, logged (`dmesg`: `traps: chrome-headless trap int3`), and
   documented in `docs/acceptance/spatial-phase-2-11/scripts/README.md`.
4. **Not changed:** the avatar lifecycle, the spatial runtime, the layout
   engine, the docks and the Studio. No regression was observed in their tests.

## 16. PASS / FAIL / PARTIAL / UNVERIFIED matrix

| Requirement | Status | Basis |
|---|---|---|
| Branch safety: checkpoint is ancestor, no force-push | **PASS** | `merge-base --is-ancestor 3d914dd` |
| Real viewport-capable browser obtained | **PASS** | Chromium 151 + 28 libs unpacked, launched |
| Shell captured at 375 / 390 / 430 / 1440 / 1920 | **PASS** | five files, CSS sizes recorded |
| Legible UI in those captures | **FAIL** | text renders as blank bars; blur mis-composited |
| Portal ring: registry identity, seeding, travel plan (tests) | **PASS** | `tests/spatial-portals.test.ts` |
| Portal ring: built-in / user / agent visible in 3D | **UNVERIFIED** | no persisted seed; cannot read meshes |
| Built-in portals in ring | **UNVERIFIED** | same |
| User-created portals in ring | **UNVERIFIED** | panel kills renderer |
| Agent-created portals in ring | **UNVERIFIED** | same |
| Portal create through the real UI | **PARTIAL** | panel opens, then renderer dies |
| Portal removal through the real UI | **PARTIAL** | same |
| Portal travel (camera leaves, arrives) | **PASS** | `core → cosmos → portal` measured via runtime state |
| Destination environment opens with real module | **PARTIAL** | reached in one run (`files`, module window), not captured |
| Agent tool exists and is advertisable | **PASS** | new executors + 6 tests |
| Agent tool refuses honestly | **PASS** | unknown destination, built-in removal, no interface |
| Agent portal created by a real conversation turn | **UNVERIFIED** | chat not legible; no model turn completed |
| Conversation preserved across travel | **UNVERIFIED** | scenario never completed |
| Mobile touch: rail expand + travel | **PASS** | real `touchscreen.tap` at 390 |
| Mobile touch: create / pin / drag / keyboard | **UNVERIFIED** | not reached |
| Desktop: rail travel + camera | **PASS** | real mouse input at 1440 |
| Desktop: arrange / regenerate / pin / manual | **UNVERIFIED** | panel traps |
| Idle / transition frame rate | **PASS (as measured)** | 2.4 fps, SwiftShader — not a device number |
| CPU usage | **UNVERIFIED** | not instrumented |
| Memory before/after/10 transitions | **UNVERIFIED** | runs trap |
| Scene / camera / avatar instance counts | **PARTIAL** | canvases counted (3 / 0); camera+avatar instances not |
| Duplicate listeners / render loops | **UNVERIFIED** | not measured |
| `tsc` / tests / lint / build | **PASS** | 0 errors, 1636 pass, 115 warnings, build ok |
| No new workspace/renderer/registry/camera/dock/Studio | **PASS** | one tool module + tests + evidence |
| Voice & multimodal roadmap untouched | **PASS** | no files in that area changed |

---

## Closing statement

Mission 5.1 built the architecture. Mission 5.2 was supposed to prove the
experience; this environment proved only part of it. What it did establish with
evidence: the shell mounts at all five required CSS sizes, real touch and mouse
input drive the spatial camera, and the agent's portal capability — which did
not exist at all — now exists, is advertised through the same dispatcher as
every other tool, and refuses dishonestly-shaped requests.

What it did not establish, and will not claim: a legible phone or desktop
screenshot, populated portals in the ring, a conversation surviving a jump, or
any memory and CPU figure. Those need a GPU-capable machine or a physical
device. The next session should start there, and start with defect 1
(`seedRing` persistence), because an empty ring would invalidate the visual
acceptance regardless of how good the renderer is.

The next development priority is unchanged: LÉLU hearing, speaking, perceiving
and operating through her existing intelligence — voice and multimodal.
