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
