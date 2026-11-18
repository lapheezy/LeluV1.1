# LÉLU 2 — compatibility manifest

Measured in this workspace: Node `v26.13.0`, Python `3.12.3`, TypeScript 5.x via
`tsx 4.23.7`, Blender `4.2.23` (offline toolchain), `three@0.185.1` already
installed, `numpy 2.5.2`.

| Source | Runtime needed | Runs offline | Integrates with LÉLU's TS / Blender / ASRE | How it is used |
|---|---|---|---|---|
| geometor/phyllotaxis | Python ≥3.10 + sympy, matplotlib, rich, geometor-model, geometor-divine | yes (pure Python), but the dependency set is heavy | **No** — nothing in it is TS, and it is symbolic, not geometric output | mathematics reimplemented in TypeScript (`src/core/geometry/golden/`) |
| HollandRisley/sacred-sandbox | Node + `three/webgpu` (0.185.1), Vite for the app | yes | **Partially** — its `geometry/*.js` import `three/webgpu` at module scope, which is unusable in headless scripts | mathematics reimplemented in TypeScript; the installed Three.js is used for the live visualisation |
| mikedh/trimesh | Python ≥3.10 + numpy | **yes, verified** (`trimesh 5.2.1` imported from source) | **Yes, as a validator** — reads the GLBs LÉLU's writer produces | `research/mesh-verify.py` checks topology of generated assets |
| zeux/meshoptimizer | Node ≥16 for the JS/WASM build, or emsdk for the C++ | **yes, verified** (`js/meshopt_simplifier.js` in Node) | **Yes, as a post-process** — takes `Float32Array` positions + `Uint32Array` indices, which is exactly LÉLU's mesh layout | simplification / cache-optimisation measurements |
| mrdoob/three.js | browser or Node | yes | **Yes, already installed** at 0.185.1 | live visualisation only; not upgraded, not duplicated |

## Integration decisions

1. **The engine is native TypeScript, zero new runtime dependencies.** Everything
   in `src/core/geometry/golden/` imports only its own modules. It runs inside
   LÉLU's existing build, typecheck (`tsc -b`) and test runner
   (`tsx --test tests/*.test.ts`).
2. **No framework was imported for small mathematics.** sacred-sandbox's
   `fibonacci.js` is a good file inside an application that needs WebGPU; importing
   it would have added a renderer to a headless geometry pass. The four laws it
   provides were reimplemented and tested instead.
3. **trimesh and meshoptimizer are used out-of-process / as standalone modules**,
   so their Python and WASM runtimes never enter LÉLU's application bundle.
4. **Blender** stays the renderer of record: every before/after image is produced
   by `services/asre-reconstruct/blender_render.py` from the GLB that was actually
   written, so the pixels come from the geometry.
5. **ASRE/NRE invariants are preserved.** The golden hair changes only the hair
   component; the canonical occupancy test (`scripts/asre/m58-iou.ts`) must still
   report IoU = 1.000000 for LÉLU herself, and it is run after every build.
6. **Platform compatibility.** Node-only imports (`node:fs`, `node:path`) appear
   only in the experiment scripts under `scripts/asre/lelu2/`; the engine itself
   is browser-safe and is imported by the live visualisation as an ES module.

## Known constraints

* `mapDirectionsToSurface` is O(n·k) with a uniform-grid nearest-point query; it
  is built for thousands of roots, not millions of vertices.
* `nearestNeighbourStats` is O(n²) by design; the experiment scripts cap the
  sample sets they hand it.
* meshoptimizer's simplifier is only meaningful for indexed triangle meshes; the
  voxel-built hair is not a simplification target without a remesh step, so the
  simplification measurements are reported on a dedicated test mesh and on the
  full character GLB, never on hair alone.
