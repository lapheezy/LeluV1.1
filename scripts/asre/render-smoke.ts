/** Smoke render: an NRE sphere → GLB → Blender Cycles PNG. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SparseVoxelGrid } from "../../src/core/asre/nre";
import { ballCells } from "../../src/core/asre/volume/shapes";
import { surfaceNets } from "../../src/core/asre/volume/mesh";
import { signedDistance, unionBox } from "../../src/core/asre/volume/volumetric";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter";
import { inspectGlb } from "../../src/core/forge/GlbInspector";
import { ROOT, renderGlb } from "./runtime";

const out = path.join(ROOT, "artifacts/asre/smoke");
mkdirSync(out, { recursive: true });
const g = new SparseVoxelGrid({ resolution: 0.00625, origin: [-0.2, 0, -0.2], dims: [64, 64, 64], coordinateSystem: "y-up-right-handed" });
g.fuse({ id: "s", capturedAt: 0, source: "smoke", modality: "procedural", provenance: "OBSERVED", confidence: 1, parameters: {}, fingerprint: "s", lineage: [] }, ballCells([32, 32, 32], 8.77 * 2));
const box = unionBox([g])!;
const mesh = surfaceNets({ values: signedDistance(g, box), dims: box.dim, origin: box.lo.map((v, i) => g.spec.origin[i] + (v + 0.5) * 0.00625) as [number, number, number], spacing: 0.00625 });
const glb = writeGlb([{ name: "sphere", mesh, material: { name: "clay", baseColor: [0.85, 0.55, 0.4, 1], roughness: 0.5 } }]);
console.log("inspect", inspectGlb(glb).verdict);
writeFileSync(path.join(out, "sphere.glb"), glb);
console.log(await renderGlb({ inputs: [path.join(out, "sphere.glb")], output: path.join(out, "sphere.png"), resolution: [384, 384], samples: 16 }));
