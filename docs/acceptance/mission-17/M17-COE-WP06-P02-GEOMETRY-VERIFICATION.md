# M17-COE-WP06-P02 — Geometry- and Depth-Aware Projection Verification

**Status: COMPLETE**, with the two "partial" verdicts in §5 reported as findings
rather than smoothed away, and the limitations in §9 stated plainly.

| | |
|---|---|
| Branch | `freebuff/m17-coe-wp06-projection-integrity` |
| Starting commit | `5e6faf15743802b5006999ecae78882c7d4038a8` |
| Preflight | branch, local HEAD and remote HEAD all `5e6faf1`; base `e0126bf` an ancestor; tracked worktree clean |
| Verification module | `src/core/cosmos/objects/ProjectionVerification.ts` |
| Tests | `tests/cosmos-projection-verification.test.ts` (16) |
| Runner | `artifacts/perf/m17-wp06-p02/verify.ts` (raw → verdicts) |
| Evidence | `artifacts/perf/m17-wp06-p02/` |

WP06-P01's evidence is untouched: `artifacts/perf/m17-wp06/` is unchanged, and
this mission writes only to `artifacts/perf/m17-wp06-p02/`.

---

## 1. Why the old check was not evidence

The P01 detector asked "are there pale pixels inside this box". At 1024×768 the
tan-lit chair sat exactly inside its box and scored **0.034**: the rule measured
lighting, not identity. A detector that fails on a correctly projected object is
not a weak test, it is the wrong instrument — it can pass a wrong box that
happens to sit on a bright nebula, and fail a right one that is in shadow.

## 2. The method

**The renderer is asked which pixels are the object.** The existing renderer
draws the frame twice in one JavaScript task — once with the object's scene node
visible, once with it hidden — and the identity mask is the set of pixels whose
luminance changed:

- Nothing in the scene advances between the two renders (same task, no frame
  loop turn), so the diff contains the object and nothing else. Measured
  changed-pixel counts equal the mask area exactly at every viewport, which is
  the signature of a clean diff.
- The mask is the object's **drawn silhouette**, so it is colour-independent,
  lighting-independent, and yaw-rotated geometry comes out as the silhouette
  itself rather than as its axis-aligned box.
- Occlusion is respected for free: a leg behind the planet does not change when
  the chair is hidden, so it is not in the mask — and the report says so through
  the `fill` ratio instead of pretending the object is a rectangle.
- Nothing persists. No store write, no canonical id, no placement, no selection,
  no renderer, no render target, no second scene. The flag lives on the scene
  node for one render and is restored immediately.

Independence: the projection under test computes NDC from the camera matrices
and a world box. The mask comes from the rasteriser's output. They share the
camera, and nothing else — a wrong matrix, a wrong box, a wrong viewport or a
wrong dpr moves one and not the other. **The second oracle is the pointer**: a
real click at the projected centre must select that canonical id (§6), which
runs through the raycast path rather than the projection path.

The code path: `__cosmosObjectIdentity.identityMask(id)` in
`CosmosObjectsLayer.tsx` (capture-time hook beside the existing probe) →
`raw.json` → `verify.ts` → `ProjectionVerification.classify()` → the verdicts in
`measurements.json`. The classification the report quotes is the same code the
unit tests cover; the numbers are not re-derived by hand in the report.

### Thresholds, declared before the results

| Name | Value | Meaning |
|---|---|---|
| `coverageMatch` | 0.98 | share of the drawn silhouette that must fall inside the box |
| `coveragePartial` | 0.85 | below this the silhouette is not where the box says → `outside` |
| `centreMatch` | 12 px | max of (horizontal centre displacement, top-edge displacement) |
| `centrePartial` | 30 px | the partial band |
| `clippedFill` | 0.35 | mask/box area below which a viewport-crossing box is `clipped` |
| `minMaskArea` | 40 px² | a mask smaller than this is not evidence |

**Alignment uses the silhouette's horizontal centre and its top edge**, not its
area centroid. Both were chosen after seeing (not before) that near chairs lose
their legs to the planet: an area centroid drifts with occlusion and with yaw,
while the top edge and horizontal centre stay put — and a genuinely wrong
projection still moves them. That is a change of *metric*, made once, applied to
every object and viewport, and documented here; no per-object tuning.

## 3. What is deliberately not claimed

- `gl.render()` is called directly, so any full-screen post effect would not be
  applied to the mask. The Cosmos has no `EffectComposer` or render-target
  chain (checked), so the frame read is the frame drawn.
- The scene-wide raycast in the P01 probe is **not** used as an oracle: it walks
  the whole scene and decorations intercept the ray (`owner: null` at ~6.7 m).
  Identity comes from the mask and from the real selection path instead.

## 4. Six-viewport results

All captures behind the same settle gate (`|camera.position − framing target| <
0.02`), probe and masks read in the **same evaluation**, dpr 1.

| Viewport | obj_1 | obj_2 | obj_3 | Viewport passed |
|---|---|---|---|---|
| 384×661 | match | match | match | yes |
| 390×844 | match | match | match | yes |
| 768×1024 | match | match | match | yes |
| 1024×768 | match | match (tan-lit) | match | yes |
| 844×390 | **partial** | match | match | yes |
| 1440×900 | **partial** | match | match | yes |

**16 of 18 observations are `match`; 2 are `partial`.** Both partials are obj_1
(the near-left chair), at the two side-on aspects: the axis-aligned box extends
further to the left than the yaw-rotated silhouette, which shifts the box's
horizontal centre by 12.6 px (844×390) and 15.9 px (1440×900) — just past the
12 px match band. Coverage is still 1.000 in both. The verdict is reported as
partial because the declared threshold says so, not because the projection
placed the object wrong.

### Per-object record (representative)

| Viewport | id | box | mask bbox | coverage | Δx | Δtop | fill | verdict |
|---|---|---|---|---|---|---|---|---|
| 384×661 | obj_1 | 125,297 → 184,393 | 128,297 → 172,362 | 1.000 | 4.9 | 0.6 | 0.39 | match (legs occluded) |
| 384×661 | obj_3 | 80,281 → 122,358 | 81,281 → 121,357 | 1.000 | 0.5 | 0.1 | 0.92 | match |
| 1024×768 | obj_2 (tan) | 716,303 → 874,542 | 720,303 → 862,539 | 1.000 | 3.9 | 0.1 | 0.65 | match |
| 1024×768 | obj_1 | 329,301 → 493,549 | 352,301 → 490,545 | 1.000 | 10.3 | 0.2 | 0.49 | match |
| 768×1024 | obj_2 | 546,449 → 653,632 | 550,448 → 635,519 | 1.000 | 7.1 | 0.2 | 0.33 | match (heavily occluded) |
| 844×390 | obj_1 | 272,131 → 404,328 | 302,131 → 400,324 | 1.000 | 12.6 | 0.1 | 0.35 | **partial** (yaw broadening) |
| 1440×900 | obj_1 | 469,336 → 688,679 | 507,336 → 682,674 | 1.000 | 15.9 | 0.0 | 0.43 | **partial** (yaw broadening) |

## 5. The difficult cases

- **Tan-lit chair (1024×768, obj_2).** Mask area 19,462 px, coverage 1.000, Δx
  3.9 px, Δtop 0.1 px → `match`. This is the object the pale rule scored 0.034
  on. It is now identified by the pixels its removal changes, which is the
  object's identity and not its colour.
- **Yaw-rotated silhouettes (844×390, 1440×900).** The masks are 15–30 px
  narrower than their boxes on one side, exactly as a turned chair should be.
  The geometry comparison is done on the silhouette, not on the box, which is
  why the two partials say "box broader than silhouette" instead of "object
  missing".
- **Occlusion (768×1024 obj_2, 384×661 obj_1).** The mask fills 33% and 39% of
  its box because the planet covers the legs. The classifier records
  `the visible silhouette fills N% of the box, so part of the object is behind
  scene geometry` and still judges the alignment on the visible edges.
- **Partial visibility / clipping.** The `clipped` branch exists for a box that
  leaves the viewport with a mask far smaller than the box; it is covered by a
  unit test with hand-computed numbers. In this run every box was inside its
  viewport, so no live `clipped` case was produced — stated rather than implied.
- **Neighbouring objects.** The three chairs are recorded with their own masks,
  each one component, and no object's mask absorbs another's pixels at any
  viewport. Component counts are in `measurements.json`.

## 6. Browser interaction

Real pointer events (`page.mouse.click`) at the projected centres, same session
as the projection reads:

| Step | Pointer | Result |
|---|---|---|
| click obj_1 centre (384×661) | (156, 344) | `["obj_1"]` |
| click obj_2 centre | (299, 344) | `["obj_2"]` |
| click obj_3 centre | (102, 319) | `["obj_3"]` |
| select obj_2, resize → 390×844 | — | selection preserved, re-settled |
| click the selected object again after resize | (328, 470) | `["obj_2"]` |
| reload | — | `[]` (cleared) |
| click **Done** on the contextual strip | (103, 445) | `[]` — deselected |

**The Done-control blocker from P01 is resolved and was never an app defect.**
The diagnosis this time: `document.elementFromPoint` at the button's live
`getBoundingClientRect()` centre returns the button itself (`sameAsButton:
true`), its computed `pointer-events` is `auto`, and a click there clears the
selection. P01's failure came from clicking a coordinate estimated from a
screenshot of a strip that had already moved — the drei `Html` strip is
positioned by the camera, so an estimate goes stale between the screenshot and
the click. The store's `select(null)` path is correct (it clears both `selected`
and `selection`).

Empty-space clicks still do not deselect — the Cosmos surface has no
`onPointerMissed`, and deselection is the strip's **Done** control. That is the
existing product contract and it is unchanged; it is recorded here because P01
recorded it too.

## 7. Checks

| Check | Result |
|---|---|
| `tests/cosmos-projection-verification.test.ts` | **16 pass, 0 fail** |
| `tests/cosmos-projection.test.ts` (P01) | 15 pass, 0 fail |
| `npx tsc -b --force` | exit 0 |
| `npm run build` | exit 0 |
| `oxlint` on changed files | 0 errors, 5 pre-existing warnings |
| Full suite | 2297 tests, 2287 pass, 2 fail — see §7.1 |

The verification tests do not re-derive the implementation: every expected value
is written by hand from the rectangles in the test (a 100×100 square offset by
50 overlaps its twin by 50×50, so IoU is 25/175), and the occlusion and
shifted-silhouette cases use the real numbers recorded at 390×844.

### 7.1 Full suite

`2297 tests, 2287 pass, 2 fail` — 2281 + this mission's 16 new tests, and the
same two environment failures as the P01 baseline, reproduced identically at the base commit: `sandbox-security`
("network: TCP, UDP, DNS and fetch all fail" returns empty in this sandbox) and
`genesis-interface` (cannot resolve `@excalidraw/excalidraw/index.css`).

## 8. Evidence

```
artifacts/perf/m17-wp06-p02/
  raw.json                 what the browser recorded (boxes, masks, dpr, camera)
  verify.ts                raw → verdicts, using the tested module
  measurements.json        the acceptance record, thresholds echoed
  annotate.py              draws box (colour) and mask (yellow) onto a capture
  frame-384x661.png        the renderer's own frame at that instant
  frame-390x844.png  frame-844x390.png
  annotated-384x661.png  annotated-844x390.png
  diagnostic-384x661.png   first pass, kept because it shows the mask before
                           the threshold fix dropped the thin legs
```

![384×661: projected boxes (coloured) and identity masks (yellow) on the renderer's own frame](artifacts/perf/m17-wp06-p02/annotated-384x661.png)

![844×390: the box broader than the yaw-rotated silhouette, mask inside it](artifacts/perf/m17-wp06-p02/annotated-844x390.png)

## 9. Evidence classes

- **Mathematically verified projection:** P01's 15 tests over the conversion
  contract (world → NDC → viewport → buffer → screenshot), independent pinhole
  expectations.
- **Visually verified geometry:** this mission — identity masks from the
  renderer, per-object coverage/alignment/occlusion at six viewports, and two
  annotated captures.
- **Browser interaction verification:** real pointer events at projected
  centres, resize, reload, and the Done control by its live rect.
- **Emulated viewport evidence:** all six sizes are Chromium viewport emulation
  at dpr 1 on one host.
- **Physical device evidence:** none. Nothing here was run on an iPhone or any
  physical device; no iOS Safari claim is made.
- **Automatic GPU capability evidence:** none. Every capture used the explicit
  `?render=gpu` override on a host the app classifies as incapable; this is not
  automatic capable-GPU acceptance.

## 10. Remaining limitations

1. **No physical device, no iOS Safari** — emulated viewports only.
2. **Override rendering** — capability acceptance is still WP05's open item.
3. **Two `partial` verdicts** at 844×390 and 1440×900 for obj_1, caused by the
   axis-aligned box exceeding a yawed silhouette on one side. Reported, not
   re-thresholded.
4. **No live `clipped` case** this run (unit-tested only); every box was inside
   its viewport.
5. **Occluded geometry is invisible to the mask by construction** — the mask
   says what was drawn, so a box that covers an occluded part cannot be checked
   against pixels; that is why `fill` is reported alongside the verdict.
6. **The identity hook lives in the shipped probe** (`__cosmosObjectIdentity`),
   as the P01 probe does. It runs only when called, writes nothing, and restores
   visibility immediately; it does leave one extra `invalidate` dependency on
   the probe effect.
7. **One object per capture** — three renders per viewport, so the method is a
   capture-time instrument, not a continuous check.
