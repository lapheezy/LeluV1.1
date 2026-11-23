# Mission 5.8 — Audit before implementation

Branch `claude/mission5-lelu-asre-integration-mm6xau`, verified starting HEAD
`d8acba2de0db7ea5217af17d4e1a669b2a578f7e` (`git rev-parse HEAD`, 2026-11-18).
Nothing in this document comes from memory: every number below was produced by
this machine today with the scripts named beside it.

## 1. What the current character actually is

| | |
|---|---|
| Representation | one signed-distance function (SDF) per component, sampled at cell centres, meshed with **naive surface nets** |
| Lattice | **6 mm** cells, `originCells [-160,-12,-110]`, `dims [320,360,220]` → a 1.92 × 2.16 × 1.32 m box |
| Components | 15 named parts (`torso pelvis neck head face hair arms hands legs feet clothing.top/bottom/shoes accessories.head/body`) |
| Identity | `CharacterSpec` + content-keyed component cache + immutable version records (SHA-256 of geometry, materials and the GLB) |
| Materials | **vertex colours only** (RGBA per vertex), one GLB material per component |
| Base build | `scripts/asre/m58-baseline.ts` → **307,304 triangles**, 664,116 occupied cells, **3.4 s** cold build, 9.4 MB GLB |

Per-component, base spec (`artifacts/mission58/before/metrics.json`):

| component | cells | vertices | triangles | samples | ms | surface err (mm) | normal err (°) |
|---|---:|---:|---:|---:|---:|---:|---:|
| torso | 98,912 | 17,362 | 34,720 | 1.06 M | 275 | 0.052 | 0.6 |
| pelvis | 55,172 | 11,172 | 22,340 | 0.63 M | 174 | 0.061 | 0.66 |
| neck | 9,850 | 3,472 | 6,940 | 0.09 M | 10 | 0.107 | 1.12 |
| head | 21,218 | 5,654 | 11,304 | 0.14 M | 48 | 0.082 | 0.94 |
| **face** | **224** | **462** | **900** | 0.02 M | 4 | **0.715** | **13.47** |
| hair | 67,580 | 13,594 | 27,184 | 1.00 M | 155 | 0.075 | 1.58 |
| arms | 26,446 | 11,984 | 23,960 | 0.52 M | 107 | 0.122 | 1.48 |
| **hands** | 4,640 | 3,152 | 6,296 | 0.15 M | 21 | 0.187 | 2.15 |
| legs | 71,376 | 21,932 | 43,856 | 1.10 M | 132 | 0.090 | 1.01 |
| **feet** | 9,592 | 4,684 | 9,360 | 0.11 M | 14 | 0.146 | 1.54 |
| clothing.top | 131,852 | 21,330 | 42,656 | 0.77 M | 480 | 0.064 | 1.44 |
| clothing.bottom | 148,038 | 31,652 | 63,300 | 0.91 M | 673 | 0.068 | 1.08 |
| clothing.shoes | 19,216 | 7,248 | 14,488 | 0.11 M | 25 | 0.115 | 1.18 |

13 of 13 non-empty components are watertight, consistently oriented, with zero
degenerate triangles.

## 2. Shown, not assumed

`artifacts/mission58/before/` holds Blender (Cycles CPU) renders of the GLB that
`buildCharacter` + `writeGlb` actually produced — `base-front.png`,
`base-side.png`, `base-back.png`, `base-three-quarter.png`, plus
`base-face-*`, `base-hands-*`, `base-feet-*` close-ups framed on the real
component nodes.

What they show, plainly:

- the limbs are tapered tubes meeting at **hard seams** (a visible ring at the
  wrist and the elbow): two separate capsules unioned, not one continuous limb;
- **hands are rounded stumps** — no palm, no fingers, no thumb;
- **feet are rounded stumps** — no heel, no arch, no toes; the shoes are a
  single capsule per foot, so they read as slippers;
- the **face is a flat mask**: two spherical eyes sitting on the skin, an
  ellipsoid nose, one capsule mouth, two capsule eyebrows; no eyelids, no lips,
  no jaw, no cheekbones, no brow ridge;
- the **hair is a helmet**: `long-straight` is a scalp ellipsoid inflated by a
  box "curtain"; `afro` is **one sphere**;
- the **clothing has no construction**: an inflated shell of the torso, sleeves
  as inflated capsules, no folds, seams, cuffs, collar, placket, hems or
  thickness variation;
- everything reads **plastic**: one roughness value per part, no
  ambient occlusion, no tone mapping, no shadows, no environment light.

## 3. Which limitation comes from where

This is the part the brief insists on, so it is separated by cause. The
measurement that decides each row is named.

| observed defect | cause | evidence | not the cause |
|---|---|---|---|
| tube limbs, hard wrist/elbow seams | **geometry vocabulary** | `armsShape`/`legsShape` are 2 `capsule()` unions; a capsule union leaves a crease where the radii differ | meshing: surface err 0.12 mm |
| stump hands | **geometry** + **resolution** | `handsShape` is one capsule per hand; a 9 mm finger is 1.5 cells at a 6 mm lattice | rendering |
| mask face, ball eyes | **geometry** + **resolution** + **material** | `faceLocal` = 2 spheres + 1 ellipsoid + 3 capsules; the face occupies only 224 cells; eyes are just dark spheres, not a material with specular/highlights | meshing: err 0.72 mm is *large* precisely because the primitives are crude |
| boulder/helmet hair | **geometry vocabulary** | `hairLocal`: afro = 1 `sphere`, bob/top-knot/pigtails = ≤4 primitives; no locks, layers, strand clumps | — |
| clay clothing | **geometry** + **material** | `topShape` = `inflate(torsoShape)`; no fold displacement, no seams/cuffs; one roughness per garment | — |
| wasted triangles on simple parts, starved detail parts | **topology / sampling policy** | uniform 6 mm: torso 34,720 tris vs face 900 tris; clothing = 39 % of all triangles | — |
| plastic look | **rendering** | `SpatialViewer`: ambient 0.85 + 2 directional lights, no tone mapping, no shadows, no environment; Blender job: `Standard` view transform, no floor | geometry — the same geometry lit properly reads far better |
| no subdivision/smoothing stage | **topology** | naive surface nets, one quad per sign-changing edge, split into 2 triangles; no Taubin/Loop pass, no decimation, no retopo | — |

**The meshing itself is not the bottleneck.** Mean vertex-to-surface error is
0.08 mm on a 6 mm lattice and mesh normals are within 1.2° of the analytic SDF
gradient. Shooting better pixels at this geometry would be exactly the
substitution the brief forbids, so the work below starts at the shape
vocabulary and the sampling policy, and only then touches materials and light.

## 4. Where the ASRE machinery sits (must keep working)

- `sampleShape()` samples each component **only inside its own bounding box**,
  on the shared lattice, and meshes it in the component's own frame;
- a component is placed by a **lattice-snapped anchor**, so moving it (e.g. a
  taller body lifting the head) is not a rebuild — `head`, `face`, `hair`,
  `accessories.head` live in the head frame;
- **content keys** = hash(component id, its parameter slice, dependency keys);
  geometry key = same with materials neutralised → a colour change recolours
  cached buffers instead of resampling;
- `occupancyCodes`, `componentCodes`, `characterGrid`, `versionGrid`, the
  temporal `SnapshotStore` and `compareGrids` all index cells on the **shared
  lattice** — the test *"components add up to the whole object exactly (IoU 1)"*
  enforces it;
- a version records `geometrySha`/`shapeSha`/`materialSha` per component, so
  "the face did not change" is a byte comparison.

Any change to resolution or vocabulary must keep: occupancy on one lattice,
per-component keys and reuse, byte-identical rebuilds, verified version
records, and the whole-object IoU = 1 invariant.

## 5. Local toolchain and assets available (offline)

| tool | state |
|---|---|
| Blender 4.2.23 LTS (`~/lelu-tools/blender-4.2.23-linux-x64/blender`) | present, Cycles CPU, headless (`services/asre-reconstruct/blender_render.py`) |
| Node 26.13.0, `tsx`, Playwright chromium | present |
| Python/torch/TripoSR | **absent** — image-to-3D stays on the native silhouette engine (`engines.triposr:false`), recorded, not hidden |
| Free add-ons installed | none. Blender's own Cycles, Subdivision Surface, Geometry Nodes, Solidify and the skin/remesh modifiers ship with it (GPL, already on disk, no download, no licence change) |

Nothing new is required for the improvements planned: the SDF vocabulary,
adaptive sampling, SDF-driven normals/AO and Blender's built-in renderer cover
it. No paid API, no account, no network.

## 6. Plan (committed step by step, evidence after each)

1. **Baseline** — this audit + `artifacts/mission58/before/*` (GLBs, metrics, renders). *done*
2. **Anatomy vocabulary** — continuous limbs with real joints, hands with five
   digits, feet with heel/arch/toes, a sculpted head and face (jaw, brow,
   cheekbones, eyelids, lips, nose with bridge and wings, ears).
3. **Adaptive lattice** — a fine lattice for detail components (face, hands,
   feet), the coarse one for the body, **occupancy cells staying on the shared
   lattice** so NRE/identity/temporal is untouched.
4. **Surface quality** — SDF-gradient normals, residual projection, curvature
   aware vertex AO baked into the mesh; measure before/after.
5. **Hair and clothing** — lock-based hair with silhouettes that read, garments
   with thickness, folds, seams, cuffs, collar and hems.
6. **Materials and rendering** — per-component PBR (roughness/sheen), studio
   light rig with tone mapping, shadow-catching floor, identical cameras for
   every before/after pair.
7. **Benchmarks and integration** — full view/hair/outfit/pose/wireframe set,
   measured cost and memory, then Mission 5.7 re-verified inside Chat Universe.

## 7. What this audit does *not* claim

- It does not claim the current mesh is inaccurate; it is accurate to the shape
  it describes. It describes too little.
- It does not claim a render improvement equals a geometry improvement; the
  before/after pairs are shot with the **same camera and the same light rig**,
  and the geometry numbers are reported separately from the image comparison.
