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
