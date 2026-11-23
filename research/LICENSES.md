# LÉLU 2 — acquired sources: licence and revision manifest

Every repository below was cloned into `research/sources/` (git-ignored), its
`LICENSE` file read directly, and its revision recorded by full SHA. Nothing is
vendored into `src/`: where an algorithm was useful it was **reimplemented in
LÉLU's own TypeScript** against the published mathematics, and the
reimplementation is verified by `tests/golden-geometry.test.ts`. Where a whole
tool was useful (trimesh, meshoptimizer) it is used as an **external process or
module**, not copied.

| # | Repository | Revision | Licence | Copyright |
|---|---|---|---|---|
| 1 | [geometor/phyllotaxis](https://github.com/geometor/phyllotaxis) | `a1eea285544edc8d5b831a07aa7e20a807317af6` | MIT | © 2022 GEOMETOR |
| 2 | [HollandRisley/sacred-sandbox](https://github.com/HollandRisley/sacred-sandbox) | `d66f77d66688c175e25091d55aa3b9d17c48ac93` | MIT | © 2026 Holland Risley |
| 3 | [mikedh/trimesh](https://github.com/mikedh/trimesh) | `7fe4ac4405ba5af02756c2db729da6822510304c` | MIT | © 2023 Michael Dawson-Haggerty |
| 4 | [zeux/meshoptimizer](https://github.com/zeux/meshoptimizer) | `f0a684f11ead064e176775c9b796f82a55910e92` | MIT | © 2016-2026 Arseny Kapoulkine |
| 5 | [mrdoob/three.js](https://github.com/mrdoob/three.js) | `0.185.1` (already installed in LÉLU's `node_modules/three`) | MIT | © 2010-2025 three.js authors |

## Required notices

The MIT licence requires the copyright notice and permission notice to be

included in all copies or substantial portions of the Software. **No source code
from these repositories is copied into LÉLU 2.** The notices are reproduced here
so that the engine's provenance is auditable:

```
MIT License

Copyright (c) 2022 GEOMETOR                          — geometor/phyllotaxis
Copyright (c) 2026 Holland Risley                    — HollandRisley/sacred-sandbox
Copyright (c) 2023 Michael Dawson-Haggerty           — mikedh/trimesh
Copyright (c) 2016-2026 Arseny Kapoulkine            — zeux/meshoptimizer
Copyright © 2010-2025 three.js authors               — mrdoob/three.js

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## What was taken from each, precisely

### 1. geometor/phyllotaxis — MIT

Read: `src/geometor/phyllotaxis/angles.py`, `planar.py`, `paths3d.py`, `builder.py`.

Adopted as mathematics (reimplemented in `src/core/geometry/golden/`):

* the short golden sweep is `2π/φ²` (137.507764…) and the long sweep `2π/φ`
  — `constants.ts`, `sequences.ts`;
* the rational divergence family `2π(1 − n/m)` and the Lucas angle
  `2π/(3 + 1/φ)` — `sequences.ts`, `constants.ts`;
* the growth-frame law: node *i* of *N* at radius `N − i`, angle `i·sweep`
  — `phyllotaxis.growthFrame`;
* Fibonacci/Lucas integer generation and convergent ratios — `sequences.ts`.

Not adopted: the SymPy symbolic layer and the Matplotlib/Rich rendering stack.
They are the reason `pip install phyllotaxis` pulls four packages to compute a
constant; LÉLU's engine needs none of them.

### 2. HollandRisley/sacred-sandbox — MIT

Read: `src/geometry/fibonacci.js`, `emitter.js`, `metatronSpiral.js`,
`solidsFromMetatron.js`, `toroid.js`, `hopf.js`.

Adopted as mathematics (reimplemented):

* `GOLDEN_ANGLE = π(3 − √5)` — identical to geometor's short sweep — `constants.ts`;
* Vogel phyllotaxis `r = R·√((i + 0.5)/n)` — `phyllotaxis.vogel`;
* the normalised golden spiral `r = a·φ^{2θ/π}`, including the `φ^{4·turns}`
  normalisation that stops a multi-turn spiral overshooting — `spirals.goldenSpiral`;
* the sphere-emitter law (equal-area longitudes turned by the golden angle)
  — `sphere.fibonacciSphere`.

**Not imported.** `fibonacci.js` imports `three/webgpu` at module scope, so
importing it in a headless script drags a WebGPU renderer in for a `cos`/`sin`.
The reimplementation is dependency-free.

### 3. mikedh/trimesh — MIT — **used as a tool, not copied**

Verified importable offline in this workspace (`PYTHONPATH=research/sources/trimesh`,
Python 3.12.3, `trimesh 5.2.1`, `numpy 2.5.2`). Used by
`research/mesh-verify.py` to open the GLBs LÉLU 2 generates and report
watertightness, winding, component count and volume — independent of LÉLU's own
mesh code, so a topology claim is not the pipeline marking its own homework.

### 4. zeux/meshoptimizer — MIT — **used as a module, not copied**

The prebuilt JS/WASM builds in `js/` run unmodified in Node (verified by
`research/meshopt-probe.mjs`). Used only to measure what mesh simplification and
vertex-cache optimisation actually recover; those numbers are reported separately
and **never** attributed to the golden-ratio work.

### 5. mrdoob/three.js — MIT — **already present, not upgraded**

LÉLU already depends on `three@0.185.1`, which is the same version
sacred-sandbox pins. Nothing was installed or upgraded; the live visualisation
imports the installed copy.

## Rejected on inspection

| Candidate | Why rejected |
|---|---|
| `geometor-model`, `geometor-divine` (transitive deps of geometor/phyllotaxis) | not needed for the mathematics; would add a symbolic-geometry framework to compute `π(3−√5)` |
| sacred-sandbox's Vite app, worker, UI and WebGPU pipeline | a whole application for four functions |
| trimesh's optional backends (scipy, shapely, networkx, pyglet, manifold3d) | not required for offline GLB inspection; the base package works with numpy alone |
| meshoptimizer's C++ sources / CMake build | needs emsdk or a native toolchain; the shipped WASM already covers the measurement |
| any paid service, hosted API or network-bound functionality | none of the five needs one; all work offline |
