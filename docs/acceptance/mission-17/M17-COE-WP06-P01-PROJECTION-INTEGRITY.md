# M17-COE-WP06-P01 — Projection Coordinate Integrity, Pixel-Space Verification & Live Selection Acceptance

**Status: COMPLETE**, with the limitations in §9 stated plainly.

| | |
|---|---|
| Base | `e0126bf6942c50cd398692627e0cf1b6a84a9ba2` (`freebuff/m17-coe-wp03-responsive-canvas`) |
| Capability parent | `268e65952c28a1d0dcd4072c05a8710c0c45f6d` |
| Branch | `freebuff/m17-coe-wp06-projection-integrity` |
| Contract module | `src/core/cosmos/objects/CosmosProjection.ts` |
| Probe | `src/app/scene/genesis/cosmos/CosmosObjectsLayer.tsx` (`__cosmosObjectsProbe`) |
| Tests | `tests/cosmos-projection.test.ts` (15) |
| Evidence | `artifacts/perf/m17-wp06/` |

The remote tip was fetched and inspected before any edit: it equalled the
expected base, and the base's ancestry ran `e0126bf → 268e659 → fd7971c`. The
worktree was clean. Nothing was reset, discarded or rewritten.

---

## 1. Root cause

Three separate defects sat in the measurement path, and one more in how the
measurement was *taken*. None of them was in the renderer, the camera or the
selection router.

### 1.1 Stale camera matrices

The probe projected through `camera.projectionMatrix` but relied on
`camera.matrixWorldInverse`, which three.js refreshes **inside the render
pass**. In the Cosmos the frame rate on this host is 0.3–2 fps, and the camera
is flown by a bridge; between the last rendered frame and the probe call the
camera can be metres away. The probe reported a pose the pixels never had.

This is the `x = -3114` at 1440×900 recorded in the WP05 evidence: a coordinate
outside any viewport, produced by a view matrix for a pose the camera had
already left.

### 1.2 Wrong width and height source

The probe took `size` from `useThree()` and folded the device pixel ratio into
it by hand. That is the *window's* notion of size, not the canvas's, and after a
resize it is briefly the previous notion. At 390×844 the converted coordinates
fell outside the window entirely, which is why the WP05 patches read **0 while
three chairs were plainly visible**.

### 1.3 A transform applied twice (introduced and fixed in this mission)

`objectBounds()` is already expressed in the object's **parent** space: it
multiplies the object's scale into its part positions and extents and adds the
object's position. The first repair pass transformed that box by the object
group's own `matrixWorld`, which applies the same position and scale a second
time — a box displaced by its own offset and thickened by its own scale. It
looked plausible (a rectangle in the sky, no clamp, no NaN) and was nowhere near
the chair. This is exactly the failure mode the mission was written about, so it
is now pinned by a test (`the parent transform is applied, and only once`).

### 1.4 The measurement was taken mid-flight

Even with a correct contract, reading the probe 2 s after the Cosmos opens reads
a camera that is still flying to its framing pose: successive runs produced
centres at y ≈ 206, 288 and 344 for the same object at the same viewport. Every
figure in §4 is therefore taken behind a **settle gate** — the probe is read
only once `camera.position` is within 0.02 of `__cosmosCameraStatus.pose.position`,
and the probe is read both before and after the screenshot so a pose that moves
during capture is visible as drift rather than as a wrong answer. Drift was
**0 px for every object at every viewport**.

---

## 2. The coordinate contract

`src/core/cosmos/objects/CosmosProjection.ts` is a pure module with no scene
access. It is the single conversion path; the probe consumes it and the
selection router keeps its own (already correct) NDC conversion.

| Space | Origin | Axes | Unit | Source |
|---|---|---|---|---|
| `world` | scene origin | three.js right-handed, **+Y up, −Z forward** | metres | the group's `matrixWorld` |
| `view` | camera | −Z into the screen | metres | `camera.matrixWorldInverse`, freshened |
| `ndc` | screen centre | +X right, +Y **up** | −1…1 | `vector.applyMatrix4(camera.projectionMatrix)` |
| `buffer` | canvas top-left | +X right, +Y **down** | device pixels | NDC × drawingBuffer ÷ 2, y flipped |
| `viewport-css` | **viewport** top-left | +X right, +Y down | CSS pixels | `canvas.getBoundingClientRect()` |
| `screenshot` | captured image top-left | +X right, +Y down | image pixels | viewport × `devicePixelRatio` (uncropped) |
| pointer | viewport | same as `viewport-css` | CSS pixels | `event.clientX/Y` minus the canvas rect |

Rules the module enforces:

- **The viewport box is the canvas**, measured as
  `getBoundingClientRect()` + `gl.domElement.width/height` + `gl.getPixelRatio()`.
  `window.innerWidth` is never used. The rect's `left`/`top` are carried, so a
  canvas that does not start at (0,0) — and nonzero offsets are covered by
  tests — converts correctly.
- **The device pixel ratio is applied exactly once**, in `viewportToBuffer`,
  and is read from the renderer rather than from `window`.
- **`freshenCamera(camera)`** calls `camera.updateMatrixWorld(true)` and
  recomputes `matrixWorldInverse` before any projection.
- **`projectBounds` never calls `updateProjectionMatrix`.** The matrix the
  renderer drew with is the matrix that must explain the pixels; a stale aspect
  is *reported* as `aspectMismatch` rather than silently corrected.
- **No clamping.** An off-screen object reports `inFrustum: false` with its
  real (possibly negative, possibly > width) coordinates. A failed projection
  reports `failure` and `center: null` — a different answer from "off-screen".
- Every reported coordinate carries `space`, and every record carries the
  canonical `id`.

The box that is projected is **the box that is drawn**:
`new Box3().setFromObject(group, true)` after `group.updateWorldMatrix(true, true)`.
When the model (`objectBounds`) and the pixels disagree, the pixels win; the
model is reported beside it as `modelView` and is not trusted.

---

## 3. Live results — six viewports

All captures: real entry path (`/?render=gpu` → dismiss "Continue without an
account" → `button.lch-cosmos`), settled pose, device pixel ratio 1, buffer ==
viewport (no CSS scaling), uncropped screenshot of the same viewport.

| Viewport | Aspect | Settled | Centre drift | obj_1 centre px | obj_2 centre px | obj_3 centre px | Verdict |
|---|---|---|---|---|---|---|---|
| 384×661 | 0.581 | yes | 0/0 | (156, 344) | (299, 344) | (102, 319) | exact on all three |
| 390×844 | 0.462 | yes | 0/0 | (158, 436) | (305, 436) | (100, 410) | exact on all three |
| 768×1024 | 0.750 | yes | 0/0 | (313, 538) | (597, 538) | (212, 491) | exact on all three |
| 1024×768 | 1.333 | yes | 0/0 | (420, 418) | (788, 418) | (313, 359) | exact on all three |
| 844×390 | 2.164 | yes | 0/0 | (349, 222) | (641, 222) | (282, 178) | inside boxes, ≤ 25 px |
| 1440×900 | 1.600 | yes | 0/0 | (592, 498) | (1103, 498) | (453, 417) | exact on all three |

Every object reported `space: "viewport-css"`, `failure: null`,
`inFrustum: true`, `onScreen: true` at every viewport. **No coordinate was
clamped and none is negative** except where an object genuinely straddles the
left edge (obj_3 at 384×661 reports `bounds: [-20, 162, 34, 245]` — the left
edge is off-canvas, and the box says so).

The two former failure cases, re-measured on the corrected path:

- **390×844 (previously 0 hits with three chairs visible):** all three objects
  report on-screen boxes, and the boxes coincide with the chairs
  (`annotated-390x844.png`).
- **1440×900 (previously `x = -3114`):** centres at 592 / 1103 / 453 px inside a
  1440 px viewport, on three chairs that fill the frame
  (`annotated-1440x900.png`).

### 844×390, the honest exception

At aspect 2.16 the projected boxes are noticeably **wider than the drawn
silhouettes** (obj_2: box 146 px wide, chair ≈ 80 px). The chairs yaw, and the
projected box is the axis-aligned world-space box, which is a superset of a
rotated silhouette. The chairs sit inside their boxes, and the box centres are
within 25 px of the chair centres, but this viewport is recorded as
"inside the box", not as "exact".

---

## 4. Pixel-space accuracy

**Method.** The PNG is decoded in the page, and for each projected box the
fraction of *pale* pixels is measured inside the box and inside two same-sized
control regions (one box-width to the right, one box-height below). Pale =
luminance > 120, channel spread < 55, blue ≤ red + 30. Then the projected boxes
are **drawn onto the capture** (`annotate.py` → `annotated-*.png`) so the
agreement can be judged without any detector at all.

**Tolerance.** ±12 px on box edges for the portrait/desktop viewports:
antialiasing on a pale chair over a bright horizon is 1–3 px, the screenshot is
unscaled (dpr 1, no crop), and the settle gate holds the pose to 0 px drift. The
one systematic term is the axis-aligned box versus a yaw-rotated silhouette,
which is why 844×390 is judged at 25 px and by containment.

**Detector specificity — a real limitation.** The colour rule is *not* object
identity. At 1024×768 obj_2 is the tan-lit chair and scores **0.034** inside a
box that visually matches the chair exactly: the detector is what failed there,
not the projection. Two consequences are recorded: (a) the per-viewport verdict
rests on the annotated captures, not on the colour score; (b) at 844×390 the
control regions land on the bright horizon and the control comparison is not
discriminating, so that cell is reported with no control evidence.

| Viewport | inside / control-below (obj_1) | inside / control-below (obj_2) | inside / control-below (obj_3) |
|---|---|---|---|
| 384×661 | 0.551 / 0.036 | 0.438 / 0.091 | 0.600 / 0.004 |
| 390×844 | 0.551 / 0.036 | 0.438 / 0.091 | 0.600 / 0.004 |
| 1024×768 | 0.341 / 0.052 | 0.034 / 0.065 (tan chair) | 0.522 / 0.000 |
| 844×390 | 0.401 / — | 0.787 / — | 0.404 / 0.246 |

---

## 5. Live pointer-selection acceptance

Real pointer events (`page.mouse.click`) at the projected centres, in the same
`viewport-css` space the probe reports. 384×661, settled pose.

| Step | Pointer | Selection after | Result |
|---|---|---|---|
| click obj_1 centre | (156, 344) | `["obj_1"]` | pass |
| click obj_2 centre | (299, 344) | `["obj_2"]` | pass |
| click empty sky | (30, 110) | `["obj_2"]` | unchanged — **existing behaviour** |
| click dock control | (196, 576) | `["obj_2"]` | pass — UI did not select geometry |
| resize → 390×844 | — | `["obj_2"]` | pass — preserved |
| click obj_2 after resize | (328, 470) | `["obj_2"]` | pass |
| reload | — | `[]` | pass — cleared |
| click obj_1 after reload | (158, 436) | `["obj_1"]` | pass |

The empty-sky click not deselecting is **not** a regression: the Cosmos surface
has no `onPointerMissed` handler (only `WorldScene` does), and deselection is
`store.select(null)` behind the contextual strip's **Done** control. That is the
existing, documented behaviour and it was left alone.

Two objects are selected by pointer, selection survives a resize, is cleared by
a reload, and re-selects correctly afterwards. Selection screenshots:
`selection-384x661-obj_1.png` (chair highlighted, strip reading
"chair near left · 4 parts"), `selection-384x661-obj_3.png`.

**Not exercised:** the strip's *Done* button. Playwright's locator found it, but
the click did not register — three.js `Html` content is transformed by CSS, and
synthetic pointer events aimed at its DOM box are intercepted. This is a harness
limitation, reported rather than papered over; deselect-on-reload is proven.

---

## 6. Tests, build, regression

| Check | Result |
|---|---|
| `tests/cosmos-projection.test.ts` | **15 pass, 0 fail** |
| `npx tsc -b --force` | exit 0 |
| `npm run build` | exit 0 |
| `oxlint` (3 changed files) | 0 errors, 6 pre-existing warnings |
| Full suite | **2281 tests, 2271 pass, 2 fail** — the two known environment failures only |

The two failures are the documented WP05 baseline, reproduced identically at
base `268e659`: `tests/sandbox-security.test.ts` ("network: TCP, UDP, DNS and
fetch all fail" returns empty in this sandbox) and
`tests/genesis-interface.test.tsx` (cannot resolve
`@excalidraw/excalidraw/index.css`). No new failures.

**The tests do not re-derive the implementation.** Expected values are
hand-computed pinhole results for a camera at the origin looking down −Z with
`fov 55`, so each assertion has an independent number: for a 400×300 canvas at
dpr 2, a point 2 m to the right at 10 m depth must land at x = 266.34 px, and
that figure comes from `tan(fov/2)`, not from the module. Coverage includes
world→NDC, NDC→CSS, CSS→viewport offsets, viewport→buffer at dpr 1/2/3,
screenshot scaling, non-square viewports, canvas smaller than the window,
identity vs non-identity parent transforms, the double-apply regression,
non-finite inputs, behind-camera, off-frustum, empty boxes, resize between
measurements, and four repeated measurements yielding identical output.

**Architecture untouched:** no second camera, renderer or manager; no new
dependency; the WP05 capability lifecycle, the frame-loop authority, the WP02
geometry-aware selection router, canonical ids, the store, LiveKit, LangChain and
Supabase are all unmodified. The selection path (`ndcOf(event, gl.domElement)`)
was already correct and was not touched; only the probe's `hit(x, y)` was moved
onto the same viewport rect.

---

## 7. Evidence

```
artifacts/perf/m17-wp06/
  measurements.json            six viewports, per-object projection + pixel records, selection log
  annotate.py                  draws the recorded boxes onto the captures
  vp-384x661.png  vp-390x844.png  vp-768x1024.png
  vp-1024x768.png vp-844x390.png  vp-1440x900.png
  annotated-*.png              the same captures with the projected boxes drawn
  selection-384x661-obj_1.png   selection-384x661-obj_3.png
```

Before/after, same instrument:

| | Before (WP05 probe) | After (contract) |
|---|---|---|
| 1440×900, obj_1 x | **−3114** | **592** (chair centre) |
| 390×844, hits | **0 of 3** | 3 of 3 on-screen, boxes on the chairs |

---

## 8. Evidence classes

- **Unit-test evidence:** 15 tests, independent pinhole expectations. Conversions,
  dpr, offsets, non-square, stale matrices, invalid input, resize, repetition.
- **Browser projection evidence:** the six viewport tables — camera pose, aspect,
  surface aspect, buffer, dpr, rect, per-object centre and bounds read from the
  live build behind a settle gate.
- **Screenshot pixel evidence:** six captures plus six annotated captures, with
  pale-region inside/control fractions. **Colour-based, not object identity** —
  it misses the tan-lit chair, which is stated rather than hidden.
- **Real pointer-selection evidence:** eight pointer steps with the resulting
  canonical selection, including resize and reload.
- **Simulated or fixture-only evidence:** none is used to support a pass. No
  store mutation, no test-only selection helper, no scripted camera pose.
- **Physical iPhone evidence: none.** Nothing here was run on a physical device;
  all captures are Chromium in this VM. The six viewports are emulated sizes.

## 9. Limitations and untested conditions

1. **Physical iOS Safari was not tested.** No claim is made about real-device
   rendering, safe-area insets or touch routing.
2. **The renderer is a software-limited VM** (Intel Iris Xe via ANGLE/D3D11,
   0.3–2 fps in the Cosmos). Every capture used `?render=gpu`, the explicit
   capability override, because automatic mode classifies this host as
   incapable. **This is not automatic capable-GPU acceptance** — that remains
   the WP05 limitation.
3. **The 768×1024 capture crashed the renderer on the first attempt**
   (`page.screenshot: target closed`). A fresh page succeeded and that capture
   is what is reported; the crash is recorded as an environment incident, not as
   a projection result.
4. **844×390 is not pixel-exact** (≤ 25 px, containment) because the projected
   box is axis-aligned and the chairs yaw; the pale-pixel control is not
   discriminating at that aspect.
5. **The colour detector is not object-specific** — it fails on the tan-lit
   chair at 1024×768. The annotated captures are the primary pixel evidence for
   that reason.
6. **The Done control was not exercised** (synthetic clicks into drei `Html`
   content do not register). Deselect-on-reload is proven instead.
7. **Two pre-existing suite failures** remain, unchanged from the base.
