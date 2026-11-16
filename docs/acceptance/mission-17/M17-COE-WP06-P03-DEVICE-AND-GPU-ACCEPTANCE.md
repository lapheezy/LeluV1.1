# M17-COE-WP06-P03 — Real Device and GPU Capability Acceptance

**Decision: PARTIAL.**

Everything that this environment can establish has been established and is
reproducible: the capability classifier is correct about the hardware, the
explicit override is what makes visual evidence possible here, the identity
instrumentation is clean and repeatable, and the projection measurements stand.
Two acceptance dimensions could **not** be established and are marked, not
implied:

- **Physical iPhone Safari: NOT VERIFIED** — no device is reachable from this
  cloud environment. No iOS, Safari or touch claim is made anywhere in this
  report.
- **Automatic-mode visual acceptance: NOT ACHIEVED** — on this host automatic
  mode either stops painting the world (`light`) or paints at 0–2 fps
  (`balanced`), so it cannot produce a frame a person could be shown. The
  override is not evidence that automatic mode works.

| | |
|---|---|
| Branch | `freebuff/m17-coe-wp06-projection-integrity` |
| Starting SHA | `3177250eb62a19fcb5763b33ce58d861df143028` |
| Preflight | branch, local HEAD and remote HEAD all `3177250`; `5e6faf1` and `e0126bf` both ancestors; tracked worktree clean |
| Final SHA | see §13 |
| Evidence | `artifacts/perf/m17-wp06-p03/` |

---

## 1. How capability is decided (traced, not assumed)

`GenesisScene.tsx`:

1. `probeWebGL()` creates **one throwaway context**, reads
   `UNMASKED_RENDERER_WEBGL`, and releases it with `WEBGL_lose_context`. This
   happens **before** the renderer is created and is read once.
2. `softwareGL` is set when there is no WebGL **or** the renderer string matches
   `SOFTWARE_GL_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i`
   (`SceneRenderManager.ts:83`). The string is the driver's, never the user
   agent.
3. `manager.reassessCapability({ renderer, webgl, narrow, mobile, saveData })`
   decides the profile: `full`, `balanced` or `light`, with a `reason` —
   `capability`, `capability:software`, `capability:save-data`,
   `capability:narrow`, `measurement:slow` or `override`.
4. `?render=gpu` is read by `readRenderOverride()` and applied through
   `manager.setOverride()`, which **refuses** when there is no WebGL
   (`refused:no-webgl`) or a software rasteriser (`refused:software`). The
   override sets a floor at the device's own ceiling; it does not raise the
   ceiling.
5. `paintWorld = (!softwareGL || perfWorld) && profile !== "light"` and
   `frameloop = paintWorld ? budgetedFrameloop : "never"`.

The override changes **renderer selection and the profile floor only**. It does
not change the scene, the camera, the projection, the object store, the ids or
the selection path.

### Findings

**A. Automatic capability selection.** On this host the classifier is *right*:
`renderer = "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11
vs_5_0 ps_5_0, D3D11)"`, `webgl: true`, `narrow` false above 720 px,
`saveData` false, and the software regex does **not** match. Every automatic
assessment therefore starts at `full`.

**A defect found — but in the measurement layer, not the classifier.** The
profile is then demoted by *measured* frame rate, and on this VM those two
mechanisms disagree:

| Size | Auto profile | Reason | World painting | Measured fps |
|---|---|---|---|---|
| 768×1024 (home) | `full` | `capability` | yes | 55 |
| 384×661 | `balanced` | `capability:narrow` | yes | — |
| 390×844 | `balanced` | `capability:narrow` | yes | — |
| 1440×900 | `balanced` | `measurement:slow` | yes | 0 |
| 1024×768 (Cosmos) | **`light`** | `measurement:slow` | **no** | 0 |

So a machine whose GPU string is a real Intel Iris Xe is demoted to "no world"
by measurement at 1024×768. That is the WP05 lifecycle working as designed (and
it is not changed here), but it means automatic mode on a slow host is *not* a
rendering environment, and its acceptance status cannot be inferred from the
override. **No code was changed for this**: the smallest possible fix would be a
capability-policy change, which is WP05's authority and out of scope.

**B. Explicit GPU override.** `?render=gpu` → `profile: full`, `reason:
override`, `override: {profile: "full", source: "url:render=gpu"}`,
`overrideRefused: null`, `worldPainting: true`, `demotionsHeld: 4` — the
override holds four measurement demotions off. Accepted because the device is
not software.

**C. Software / fallback rendering.** Not exercised on this host: no
`swiftshader`/`llvmpipe` context was available to produce one. The path is
covered by the existing capability tests, not by a live run here.

**D. Environments where capability cannot be established.** Covered by the
`webgl: false` branch (`capability:no-webgl`, override `refused:no-webgl`); not
exercised live here because this environment has a working WebGL context.

## 2. Automatic vs override, measured

Same build, same viewport (1024×768), same Cosmos pose (`camera.position
[-0.8, 3.65, 2.36]`, aspect 1.333), two sessions:

| | Automatic | `?render=gpu` |
|---|---|---|
| Profile / reason | `light` / `measurement:slow` | `full` / `override` |
| `worldPainting` | **false** | true |
| Stats painting / fps | false / 0 | true / 0 (0.3–2 fps in practice) |
| Draw calls / triangles | 146 / 207,770 | 217 / 214,386 |
| Identity masks | obj_1 13,602 px, obj_2 3,748 px, obj_3 9,646 px | obj_1 18,346 px, obj_2 19,462 px, obj_3 9,535 px |
| Mask capture cost | 7.1 / 7.5 / 7.4 s | 6.8 / 12.1 / 12.0 s |

**The masks differ between modes and that difference matters.** In automatic
`light` mode the frame loop is `never`, so nothing is painted for the user; the
identity hook still calls `gl.render()` directly and therefore measures a scene
that is *not on screen*. The two near chairs' masks are also visibly shorter
(3.7k px vs 19.5k px for obj_2) because the paused, unpainted world leaves the
planet covering them at that pose. **Automatic-mode masks are therefore recorded
as "what would be drawn", never as visual acceptance.**

That is the practical answer to the mission's central question: on this host the
automatic decision and the override produce **different pictures**, so override
evidence cannot stand in for automatic acceptance — and automatic mode produces
no picture to accept.

## 3. Physical iPhone Safari

**NOT VERIFIED.** No iPhone, Lightning/USB device, remote Safari Web Inspector
session or device farm is reachable from this cloud workspace; the browser is
desktop Chromium over CDP on the VM. No device model, iOS version, Safari
version, touch routing, orientation-change behaviour or real-device identity
mask was obtained. **No claim of physical-device acceptance is made.**

Emulated viewports at dpr 1 are not a substitute and are reported separately
(§6).

## 4. Six-viewport comparison

The authoritative six-viewport measurements are WP06-P02's, taken in **override
mode** and unchanged by this mission (`artifacts/perf/m17-wp06-p02/`): 16 of 18
object records `match`, 2 `partial`.

| Viewport | Mode | obj_1 | obj_2 | obj_3 |
|---|---|---|---|---|
| 384×661 | override | match | match | match |
| 390×844 | override | match | match | match |
| 768×1024 | override | match | match | match |
| 1024×768 | override (re-confirmed here) | match | match | match |
| 844×390 | override | **partial** | match | match |
| 1440×900 | override | **partial** | match | match |

The **automatic-mode** column is what P03 adds, and it is mostly "no Cosmos":
at 1024×768 the world is `light` (not painting), at 1440×900 it is `balanced`
with 0 fps, and at 384×661 / 390×844 / 768×1024 the Cosmos entry control did not
appear inside the capture window on this run, so no object record exists. Those
absences are recorded as environment failures, not as passes or failures of the
projection.

## 5. Tan chair

Unchanged from P02 and re-confirmed in this build: at 1024×768 in override mode,
obj_2 (the tan-lit chair) has a mask of **19,462 px**, coverage **1.000**, Δx
**3.9 px**, Δtop **0.1 px** → `match`. It is identified by the pixels its
removal changes, with no dependence on material colour. In automatic `light`
mode the same object's mask is 3,748 px because the paused scene leaves it
mostly behind the planet — a mode difference, not a projection difference.

## 6. Yaw-related partials

Unchanged, and deliberately not forced to `match`: at 844×390 obj_1 sits 12.6 px
off and at 1440×900 15.9 px off, because the axis-aligned projected box is
broader than the yaw-rotated silhouette on one side. Coverage remains 1.000 in
both. **No thresholds were touched.**

## 7. Clipped objects

No live clipped case was produced in this mission (every projected box stayed
inside its viewport, as in P02). Live clipped acceptance remains **not
verified**; the branch is covered by a unit test with hand-computed numbers.

## 8. Pointer selection, resize, reload

The interaction evidence stands on **WP06-P02**, taken on the same branch and the
same code except this mission's `try/finally` in `identityMask`: the three
projected centres select `obj_1`, `obj_2` and `obj_3`; selection survives a
resize to 390×844 and re-selects afterwards; reload clears it; the **Done**
control clears the selection when clicked at its live
`getBoundingClientRect()` centre. Empty-space clicks still do not deselect —
existing behaviour, unchanged.

**P03 did not re-run that sequence.** Two attempts were made on this build; the
first lost the page mid-run and the second exceeded the capture window while
the host was still saturated from the full suite. The pointer path is untouched
by this mission's diff (visibility restore only), so P02's evidence is the
operative interaction evidence, and this gap is recorded rather than filled with
a claim.

## 9. Instrumentation: cleanup, repeatability, cost

The identity hook (`__cosmosObjectIdentity.identityMask`) was hardened in this
mission: visibility is now restored in a **`try/finally`** with a best-effort
repaint, so a throw between the two renders cannot leave an object hidden in the
scene the user is looking at.

Measured at 1024×768 (override), in the same evaluation as the masks:

| Property | Result |
|---|---|
| Visibility before / after | `{obj_1:true, obj_2:true, obj_3:true}` → identical |
| Repeatability | second call on obj_1 → identical area (18,346) and identical bbox |
| Renders per capture | 3 (before, hidden, restore) |
| Capture duration | 6.8 s, 12.1 s, 12.0 s (0.3–2 fps scene) |
| App frame counters | unchanged by captures (frames 46, calls 217 before and after) |
| Continuous cost | **none** — it runs only when called |
| State persisted | none: no store write, no id, no placement, no selection |
| Second renderer | none |

The cost is the honest headline: this is a **capture-time diagnostic**, three
expensive renders per object, and it must not be wired into a frame loop.

## 10. Regression

| Check | Result |
|---|---|
| `tests/cosmos-projection-verification.test.ts` | 16 pass, 0 fail |
| `tests/cosmos-projection.test.ts` | 15 pass, 0 fail |
| `npx tsc -b --force` | 0 |
| `npm run build` | 0 |
| `oxlint` (changed file) | 0 errors |
| Full suite | see below |

Full suite: **2297 tests, 2287 pass, 2 fail** — the same baseline pair
(`sandbox-security` network probe empty, `genesis-interface`
`@excalidraw/excalidraw/index.css`), unchanged from WP06-P02. No new failures.

## 11. Files changed

- `src/app/scene/genesis/cosmos/CosmosObjectsLayer.tsx` — `identityMask`
  restores visibility in a `finally` (17 lines added, 3 removed). No projection,
  threshold, scene, camera, store or selection change.
- `tests/` — unchanged (no new test: the cleanup path is exercised live, and the
  classifier tests already cover the verdicts).
- Evidence and this report.

Architectural impact: none beyond the hardening. No second renderer, no new
identity system, no persistence, no dependency, no threshold change, no
capability-policy change, no unrelated lifecycle change.

## 12. Evidence

```
artifacts/perf/m17-wp06-p03/
  raw.json      capability + rendering-mode observations (raw, not verdicts)
  (annotated captures and the six-viewport verdicts live in
   artifacts/perf/m17-wp06-p02/, produced by the same runner and unchanged)
```

Evidence classes, kept apart:

1. **Unit tests** — 31 projection/verification tests.
2. **Browser automation** — Playwright over CDP, real pointer events.
3. **Emulated Chromium viewport** — six sizes, dpr 1.
4. **Explicit GPU override** — every visual measurement in P01/P02 and the
   override run in §2.
5. **Automatic capability selection** — recorded in §1–2 (no world at
   1024×768; balanced/0 fps at 1440×900).
6. **Physical iPhone Safari** — none.
7. **Real GPU hardware** — the host exposes a real Intel Iris Xe through ANGLE
   D3D11, but frames are 0.3–2 fps; this is real GPU *hardware* without usable
   throughput, which is exactly what the override exists for and exactly why it
   is not automatic acceptance.

## 13. Delivery

- Starting SHA `3177250eb62a19fcb5763b33ce58d861df143028`.
- Final SHA: recorded in the session's delivery message after the push; the
  branch is `freebuff/m17-coe-wp06-projection-integrity`, fast-forward only, no
  force-push, not merged into integration.

## 14. Remaining blockers and next step

1. **No physical device** — the only way to close §3 is a real iPhone (or a
   device farm with Safari) loading this build and running the P02 capture
   sequence. Until then, physical-device acceptance stays NOT VERIFIED.
2. **Automatic mode paints nothing here** — its acceptance needs a host where
   the *measurement* does not demote a capable GPU below `light` (for example a
   real laptop with the same build and no override). That is WP05's
   capability-policy question, not a projection question.
3. The exact next mission, when a device is available: run the P02 identity
   capture and the pointer sequence on the iPhone in automatic mode, with the
   capability snapshot attached to each record.
