# Mission 5.8 — WP03. Reference anatomy: LÉLU rebuilt from CC0 human assets

Branch `claude/mission5-lelu-asre-integration-mm6xau`.
Evidence: `artifacts/mission58/reference/`, `artifacts/mission58/variations/`.
Code: `src/core/asre/reference/`, `scripts/asre/cc0-anatomy.ts`,
`scripts/asre/m58-reference.ts`, `scripts/asre/m58-variations.ts`.

## What was acquired

A real, verified CC0 human anatomy library — details and the licence audit in
[resources/cc0/README.md](../../resources/cc0/README.md):

- MakeHuman base mesh: 19,158 verts, 18,486 faces, **172 named groups**, of
  which 125 are joint markers covering every phalanx of every finger and toe.
- **1,554 morph targets**: macrodetails (age/sex/ancestry/weight/muscle),
  head, nose, mouth, eyes, eyebrows, cheeks, chin, forehead, ears, torso,
  breast, buttocks, stomach, hip, pelvis, neck, arms/legs, 102 expressions.
- **139-bone rig with per-vertex weights**, including facial muscles
  (`orbicularis`, `oris`, `levator`, `risorius`).
- 10 hairstyles + 20 more, 20 garments, 6 shoe styles, eyes, teeth, tongue,
  eyebrows, eyelashes — all with `.mhclo` barycentric body mappings.
- Blender's Human Base Meshes (CC0) could **not** be fetched: blender.org
  served a Cloudflare challenge and download.blender.org returned 503.
  Reported, not silently substituted.

Rejected for licence: `hair02`/`hair03` (CC-BY), Ellie Pose Library (CC-BY),
Blender Studio demo scenes and open-movie files (CC-BY / CC-BY-SA).

## How it is wired into LÉLU

Not an asset viewer. A new module turns a fitted reference mesh into exactly
what her builders already consume — an SDF with bounds:

| file | role |
|---|---|
| `reference/parser.ts` | OBJ (with group→face lists), `.target`, `.mhw`, `.mhclo` parsers (both `.mhclo` dialects) |
| `reference/field.ts` | mesh → signed distance field: exact distance in a 3-cell band, exact inside/outside by ray parity, BFS far field; `fieldShape`, `fieldShellShape` |
| `reference/skin.ts` | linear blend skinning with parent composition |
| `reference/provider.ts` | region shapes clipped by anatomical planes from the mesh's own joints; hand/foot articulation from the spec; garment/proxy placement |
| `scripts/asre/cc0-anatomy.ts` | Node loader: applies targets, scales to metres, reads joints and skin weights, places every proxy by its `.mhclo` |

`CharacterSpec.anatomy = { source, targets }` selects the path and is part of
each affected component's content key. With `source: "procedural"` (the
default) nothing changed: all 13 character tests still pass byte-for-byte.

## Measured — base character

| | procedural (M5.8) | reference (WP03) |
|---|---:|---:|
| body surface | SDF primitives | fitted CC0 mesh, 26,756 tris |
| triangles (whole character) | 612,116 | **1,273,680** |
| GLB | 18.7 MB | 45.5 MB |
| build | 6.3 s | 30–42 s |
| occupancy cells | — | 297,204 |
| IoU vs whole-object build | 1.000 | **0.975** |
| boundary edges (holes) | 0 | **0 on every body part** |
| components | 15 | 15, `accessories.*` empty by default |

Topology at base: head 9 non-manifold edges, arms 18, feet 7, hands 4,
legs 3, pelvis 0, torso 0, face 0 — all 0 boundary edges.

## Articulation on real anatomy

Hands and feet are skinned with the CC0 rig (bone rotations composed along the
chain), so a fist is different geometry, not a pose:

| measurement | open | fist |
|---|---:|---:|
| hand vertical span (both hands) | 265.1 mm | **134.6 mm** |
| hand triangles | 24,708 | 27,804 |
| non-manifold edges | 8 | 334 |

Feet, toes gripping: toe reach **190.8 mm → 168.0 mm** (22.8 mm of curl).

## Variation generation (incremental regeneration proven)

| variant | build | regenerated | reused | triangles |
|---|---:|---:|---:|---:|
| v1-long | 41.9 s | 15 | 0 | 1,273,680 |
| v2-bob (hair only) | **1.4 s** | **1** | **13** | 1,273,680 |
| v3-ponytail (taller) | 29.6 s | 12 | 3 | 1,175,088 |
| v4-braids-petite | 29.6 s | 12 | 3 | 1,245,668 |
| v5-afro-broad | 29.8 s | 12 | 3 | 1,273,680 |

A hair change regenerates exactly one component in 1.4 s with 13 reused —
the M5.8 incremental architecture holding on the new pipeline.

## Defects and limitations — reported, not hidden

1. **Garments are the body's surface, offset.** The CC0 garment supplies the
   *coverage* (neckline, hem, sleeve, leg opening) and the fitting; the cloth
   solid is the body pushed out 4 mm inside that coverage. Result: closed,
   hole-free cloth that fits like these skin-tight CC0 suits do, but it does
   not carry the garment mesh's own folds or seam geometry. Shoes use the same
   rule at 9 mm, which is why the boots take the foot's shape.
2. **Thin shells self-cancel.** A shell thinner than two sampling cells
   (2.8 mm at 5 mm) punched holes in the cloth on the first attempt; that is
   why the garment formulation changed. The original shell path is kept in
   `fieldShellShape` and is still used for hair (7 mm).
3. **Eyes are spheres**, placed at the reference eye joints with geometric
   iris and pupil. The CC0 eye mesh is an *open* cornea shell; meshing an open
   surface as a solid produces the shattered band seen in the first passes, so
   it is loaded and measured but not meshed.
4. **Teeth, tongue, eyebrows, eyelashes are loaded but not meshed** — same
   open-surface reason. Brows are a painted region on the head, not geometry.
5. **Pose does not retarget the reference arms.** The reference body arrives
   in its own A-pose; `spec.pose` still drives the procedural path only. Hands
   and feet articulate; shoulders and elbows do not yet.
6. **The fist is non-manifold (334 edges) at curl 1.6** because the digits
   interpenetrate, which merges their surfaces. The open hand has 8. The cause
   is the same one-vertex-per-cube limitation documented in WP02.
7. **No textures.** Material response is vertex colour in the GLB plus Cycles'
   physical shading in the renders; the CC0 skin/hair/fabric maps are on disk
   but not yet bound to UVs.

## Reproduce

```bash
node scripts/asre/fetch-cc0.mjs                                   # assets + hashes
npx tsx scripts/asre/cc0-proxy-diag.ts                            # proxy integrity
npx tsx scripts/asre/m58-reference.ts --out artifacts/mission58/reference
npx tsx scripts/asre/m58-variations.ts --out artifacts/mission58/variations
node scripts/asre/m58-render.mjs --dir artifacts/mission58/reference --glb reference-base.glb --views front,side,back,three-quarter
```

## WP04.1 — the occupancy regression, found and fixed

**Diagnosis, measured.** `scripts/asre/m58-iou.ts` attributes every cell that
the per-component build and the whole-object build disagree on:

```
per-component 299159 cells, whole-object 299107 cells
IoU 0.978929   only per 3211   only whole 3159
by component: hair 2143, clothing.top 808, head 111, hands 70, shoes 56 …
procedural control: IoU 1.000000
```

Most of the disagreeing cells were **far from the body surface** (1,168 of
2,143 hair cells at more than 5 cells), which rules out surface jitter. Two
causes, both real:

1. **The reference field was sampled at the component's mesh resolution.**
   `buildComponent` builds a region at `hMesh` (5.5 mm for the torso) while
   `buildWholeObject` builds the same region at the occupancy resolution
   (6 mm). A mesh→SDF field is a *sampled approximation*: its zero set, its
   bounds and its stand-off outside the grid all depend on the cell size, so
   the two paths were meshing two slightly different solids. The stand-off
   outside the grid was the worst part: `2·(band+1)·h` is 32 mm at h = 4 mm
   and 48 mm at 6 mm, which moved the point where a hair shell or a garment
   reach band stopped — hence thousands of hair cells differing a centimetre
   from any surface.
2. **The head frame was snapped with the mesh resolution**, not the occupancy
   cell, so the head region was translated by up to 3 mm between the paths.

**Fix.** `FIELD_H = 0.003` — one canonical reference sampling resolution for
every path and every region (`src/core/asre/reference/provider.ts`). The head
frame now snaps to `CELL` (`character/lattice.ts`), the same cell size
`anchorCells` uses. Outside a field's grid the SDF now returns a large finite
stand-off instead of a resolution-dependent one, so a shell can never mistake
"off the grid" for "near the surface".

**Result.** IoU **1.000000**, 300,060 cells in both paths, zero disagreements
in either direction — the invariant is restored for the reference path, and
the procedural control stays at 1.000000. Cost: the build went from 30–42 s
to 43 s and the character from 1,273,680 to 1,263,616 triangles for the same
visual result (the finer field is a better approximation, not a heavier mesh).

## WP04.2 — articulation topology, every state measured

`scripts/asre/m58-articulation.ts` meshes the hand and foot regions across the
whole articulation range and counts boundary and non-manifold edges;
`scripts/asre/m58-topology-probe.ts` then *locates* every edge shared by more
than two triangles and attributes it to the nearest joint marker, at two
sampling resolutions.

**What the measurement said.** The edges were not between digits and palm.
They sat at the **knuckle creases** (`finger-N-1`, `finger-N-2`), and they got
*worse* when the field was sampled finer (81 → 130 at 2 mm). A thin gap under
one cell would have improved with resolution, so this is not a hole and not
interpenetration: where the skinned surface folds into itself, the sampled
field holds two opposite sign changes inside a single cell, and surface nets
(one vertex per cell) forms a pinch there. A second, independent source was
the sharp clip crease at the wrist and ankle, where `max(field, plane)` is not
a distance field at all.

**Fixes, each verified by re-measurement.**

| change | fist (curl 1.6) | open hand | toe grip |
|---|---:|---:|---:|
| before | 334 (whole build), 81 (region probe) | 6–8 | 56 |
| field blurred once where the body is posed | 20 | 4 | 1 |
| + creases rounded (`softClip`, 5 mm) | 18 | 2 | 1 |
| + articulated fields sampled at 1.8 mm | **64 → see note** | **2** | **12** |

The last row is honest about a trade-off I measured and rejected: blurring the
field twice took the fist to 11 edges but **fused the fingers into a mitten**
(rendered and inspected). Sampling the hand and foot fields at 1.8 mm instead
resolves the 3–5 mm gaps between fingers rather than erasing them, so the
digits stay separate geometry.

**Where it stands.** Open hand: 2 non-manifold edges out of 23,952 triangles,
0 boundary edges — down from 6–8. Toes: 4 at rest, 12–14 curled, from 56.
Clenched fist at curl 1.6: 64 (from 334), concentrated at knuckle creases.
Removing the last of them needs a mesher that can emit more than one vertex
per cell (manifold dual contouring); that is a larger change than this
milestone, and it is recorded here rather than hidden behind a merge of the
digits.
