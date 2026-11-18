# Mission 5.8 — evidence manifest

Everything here was produced on this machine by the scripts named below and
committed with the step that produced it. Branch
`claude/mission5-lelu-asre-integration-mm6xau`.

## Step 1 — baseline (audit)

| file | what it is | produced by |
|---|---|---|
| `before/base.glb` … `before/outfit-3-jacket-pants.glb` | the character **as Mission 5.7 left it**, written offline from `buildCharacter` + `writeGlb` | `npx tsx scripts/asre/m58-baseline.ts` |
| `before/metrics.json` | per-component cells, vertices, triangles, samples, build ms, vertex-to-surface error (mm), normal error (°), watertightness — for 10 specs | same |
| `before/base-front.png` | full body, front, Cycles CPU 640², 32 samples, AgX, floor | `node scripts/asre/m58-render.mjs --dir artifacts/mission58/before --glb base.glb --closeups` |
| `before/base-side.png`, `before/base-back.png`, `before/base-three-quarter.png` | the other three orthographic-ish views | same |
| `before/base-face-front.png`, `before/base-face-three-quarter.png` | face close-up, framed on the real `head`+`face`+`hair` nodes | same |
| `before/base-hands-front.png`, `before/base-hands-three-quarter.png` | hands close-up | same |
| `before/base-feet-front.png`, `before/base-feet-three-quarter.png` | feet close-up | same |
| `before/renders-closeups.json` | the camera, bounds, triangle count and render time of every image | same |
| `before/cameras.json` | the derived close-up cameras, reused for every later comparison | same |

Read: [docs/asre/08_MISSION58_AUDIT.md](../../docs/asre/08_MISSION58_AUDIT.md).

## Step 3 — WP02.1 hands

| file | what it is | produced by |
|---|---|---|
| `hands/hands-base.glb` … `hands-clenched.glb`, `hands-tall.glb` | the hands + forearms for six articulation/body states, written by the committed code | `npx tsx scripts/asre/m58-family.ts --family hands` |
| `hands/full-body.glb` | the whole character carrying the new hands | same |
| `hands/metrics.json` | triangles, cells, surface error, normal error, topology, articulation at joint landmarks, regeneration matrix, determinism, IoU | same |
| `hands/hands-base-hands-front.png`, `-side.png`, `-three-quarter.png` | hand close-ups, Cycles CPU 720², 40 samples, AgX | `node scripts/asre/m58-render.mjs --dir artifacts/mission58/hands --glb hands-base.glb --closeups --closeup hands --closeup-views front,side,three-quarter` |
| `hands/hands-base-wire-hands-front.png`, `-three-quarter.png` | wireframe, same framing | same, with `--wire` |
| `hands/hands-open-hands-*.png`, `hands-fist-hands-*.png` | open hand vs clenched fist, same camera | same, `--glb hands-open.glb` / `hands-fist.glb` |
| `hands/full-body-front.png`, `-three-quarter.png` | the figure | same, `--glb full-body.glb --views front,three-quarter` |

Read: [docs/asre/09_MISSION58_WP02_HANDS.md](../../docs/asre/09_MISSION58_WP02_HANDS.md).

## Step 4 — WP03 reference anatomy (CC0)

| file | what it is | produced by |
|---|---|---|
| `reference/reference-base.glb` | **the deliverable**: the character rebuilt from a fitted CC0 human body, 1,273,680 triangles | `npx tsx scripts/asre/m58-reference.ts --out artifacts/mission58/reference` |
| `reference/reference-report.json` | component-by-component triangles, timings, occupancy, IoU, proxy list | same |
| `reference/reference-base-{front,side,back,three-quarter}.png` | full-body views, Cycles CPU, 800², 36 samples | `node scripts/asre/m58-render.mjs --dir artifacts/mission58/reference --glb reference-base.glb --views front,side,back,three-quarter` |
| `reference/reference-base-face-{front,three-quarter}.png` | face close-up | same, `--closeups --closeup face` |
| `reference/reference-base-hands-*.png`, `-feet-*.png` | hands and feet close-ups | same, `--closeup hands,feet` |
| `variations/v1-long.glb` … `v5-afro-broad.glb` | five generated variations (long, bob, ponytail taller, braids petite, afro broad) | `npx tsx scripts/asre/m58-variations.ts` |
| `variations/hands-{open,relaxed,fist}.glb` | hand articulation on the reference rig | same |
| `variations/feet-{flat,grip}.glb` | toe articulation and ground contact | same |
| `variations/hands-{open,fist}-front.png` | open hand vs fist, same camera | `node scripts/asre/m58-render.mjs --dir artifacts/mission58/variations --glb hands-fist.glb --views front` |
| `variations/variations-report.json` | regeneration matrix, articulation measurements, hand topology | same |

Read: [docs/asre/10_MISSION58_WP03_REFERENCE.md](../../docs/asre/10_MISSION58_WP03_REFERENCE.md)
and the licence audit in [resources/cc0/README.md](../../resources/cc0/README.md).
