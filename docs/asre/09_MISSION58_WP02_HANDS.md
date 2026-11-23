# Mission 5.8 — WP02.1 Hands

Branch `claude/mission5-lelu-asre-integration-mm6xau`.
Evidence: `artifacts/mission58/hands/` (GLBs, `metrics.json`, Cycles renders).
Measured by `npx tsx scripts/asre/m58-family.ts --family hands`, topology located
by `npx tsx scripts/asre/m58-diag-edges.ts`.

## What changed

The hand was **one tapered capsule** (`handsShape` = `capsule(wrist, handTip)`).
It is now a parametric hand: palm with thenar and hypothenar eminences, a
knuckle ridge, four digits of three phalanges each with joint bulges, and an
opposed thumb with metacarpal, proximal and distal segments, placed in a real
hand frame derived from the wrist (`basisFrom`), mirrored for the other side.

Articulation is geometry, not a pose applied afterwards: `spec.hands.curl`,
`.spread`, `.opposition` bend the actual phalanx chain, so an open hand and a
clenched fist are different closed meshes. `handSkeleton(spec)` returns those
joints, which is how the benchmark measures movement at real landmarks instead
of guessing from pixels.

## Measured (base pose, hands + arms family build)

| | before (M5.7) | after |
|---|---:|---:|
| hand triangles | 6,296 | **29,512** |
| digits | 0 | **5 per hand, 3 phalanges each** |
| vertices on surface (mean) | 0.187 mm | **0.091 mm** |
| normal vs analytic gradient | 2.15° | 3.14° |
| boundary edges (holes) | 0 | **0** |
| degenerate triangles | 0 | **0** |
| family build (hands + arms) | — | 2.1 s |
| signed volume (both hands) | — | 8.35 × 10⁻⁴ m³ |

The normal deviation rose from 2.15° to 3.14°: a hand has far more high-curvature
creases (knuckles, phalanx joints, the thumb base) than a capsule, and those are
counted now. It is reported rather than hidden.

## Articulation (measured at joint landmarks)

| movement | result |
|---|---|
| fingertip travel, open → clenched | **100.4 mm** |
| fingertip travel, open → half flex | 60.1 mm |
| fingertip width change, fingers together → spread | **17.6 mm** |
| thumb tip travel, open → opposed | 15.8 mm |
| landmarks inside the surface | **yes** (−4.7 … −8.2 mm) |

## Joint continuity (no gap at the wrist)

Eight samples around each wrist ring are all **inside the forearm** (worst sample
−16.0 mm), and the hand and forearm share 1,278 occupancy cells: the hand root is
embedded in the arm, not butted against it.

## Architecture preserved

| requirement | result |
|---|---|
| only the edited family rebuilds | **yes** — changing `hands` regenerates `["hands"]`, reuses 14 components |
| face / head / hair byte-identical | **yes** (geometry SHA equal) |
| deterministic rebuild | **yes** — 15/15 components identical across two cold builds |
| occupancy on the shared lattice | **yes** — IoU vs the whole-object build = **1.000** |
| resolution raised only where needed | hands 3.0 mm, body unchanged at 4–6 mm |

## Known defect (reported, not hidden)

At some articulation values the hands mesh has **0–8 non-manifold edges out of
~44,000** (seen: base 4, open 0, spread 4, fist 8, clenched 2, tall 2). Boundary
edges are 0 in every case — the surface is closed, there are no holes — but a
few edges are shared by four triangles instead of two.

Cause: naive surface nets places **one vertex per sign-changing cube**. Where two
surfaces of the hand come within one cell of each other (a digit beside a digit,
a thumb beside a digit), one cube contains both sheets and they share that
vertex. This was attacked at the cause and measurably reduced, not papered over:

1. the thumb is pushed out until it clears every digit by ≥ 6 mm (`segSegDistance`,
   deterministic, six iterations);
2. digit medial radii are shrunk and the hand re-inflated by a fixed 1.5 mm, so a
   sub-cell gap merges instead of pinching (fixed, not lattice-dependent — an
   earlier version keyed it on the mesh resolution and broke the IoU = 1
   invariant, which the benchmark caught);
3. digits meet the palm with a hard union so no thin wedge is created.

A vertex-splitting repair was implemented and **rejected**: splitting one edge
tears its neighbouring edges and produced boundary edges (holes) — strictly worse.

Remaining fix, not done: a manifold dual-contouring mesher (one vertex per
surface sheet per cube, not per cube). That is a change to `volume/mesh.ts`, not
to the anatomy, and it is the honest next step for this defect.

## Evidence files

| file | what |
|---|---|
| `hands-base.glb`, `hands-open/-spread/-fist/-clenched/-tall.glb` | the actual GLBs |
| `full-body.glb` | the whole character with the new hands |
| `hands-base-hands-{front,side,three-quarter}.png` | hand close-ups, Cycles, 720², 40 samples |
| `hands-base-wire-hands-{front,three-quarter}.png` | wireframe, same camera |
| `hands-{open,fist}-hands-{front,three-quarter}.png` | articulation, same camera |
| `full-body-{front,three-quarter}.png` | the figure |
| `metrics.json` | every number above, per variant |
