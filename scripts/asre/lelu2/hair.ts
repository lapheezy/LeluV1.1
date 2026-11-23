/**
 * ==========================================================
 * LÉLU 2.1 — WP03: HAIR REPRESENTATION EXPERIMENT
 *
 * The same character, the same strands, the same hair laws. The only variable is
 * how the hair is REPRESENTED:
 *
 *   voxel         the 2.5 mm occupancy field meshed with surface nets (2.0)
 *   tubes-high    swept tubes, 7 sides × 26 segments
 *   tubes-medium  swept tubes, 5 sides × 14 segments
 *   tubes-low     swept tubes, 3 sides × 7 segments
 *
 * The occupancy cells are compared between representations: a rendering change
 * must not move her structure. Root clearance is measured against the skull
 * field, so "no floating roots, no scalp penetration" is a number.
 *
 *   npx tsx scripts/asre/lelu2/hair.ts --variant voxel|tubes-high|tubes-medium|tubes-low
 *   → artifacts/lelu2/hair/<variant>/lelu2-<variant>.glb + metrics.json
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, glbParts, occupancyCodes } from "../../../src/core/asre/character/build.ts";
import { leluCanon } from "../../../src/core/asre/character/leluIdentity.ts";
import { withChanges, type CharacterSpec } from "../../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../../src/core/asre/gltf/GlbWriter.ts";
import { hairDiagnostics } from "../../../src/core/asre/reference/provider.ts";
import { hairRootPoints, tubeDiagnostics } from "../../../src/core/asre/hair/tubes.ts";
import { PointIndex } from "../../../src/core/asre/lelu2/pointcloud.ts";
import { loadReference } from "../cc0-anatomy.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const variant = arg("variant", "tubes-high") as "voxel" | "tubes-high" | "tubes-medium" | "tubes-low";
const tubes = variant !== "voxel";
const lod = variant === "tubes-high" ? "high" : variant === "tubes-medium" ? "medium" : "low";
const outDir = `artifacts/lelu2/hair/${variant}`;

const spec: CharacterSpec = withChanges(leluCanon(), {
  hair: { style: "long-wavy", length: 1, volume: 1.05 },
  geometry: tubes ? { golden: true, hairTubes: true, hairLod: lod } : { golden: true },
});

const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
console.log(`foundation ${ref.digest}`);

const started = performance.now();
const build = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE);
const ms = performance.now() - started;
const parts = glbParts(build, spec);
let tris = 0;
for (const p of parts) tris += p.mesh.indices.length / 3;
const hairPart = parts.find((p) => p.name === "hair");
const glb = writeGlb(parts, { generator: `LÉLU 2.1 — hair representation (${variant})` });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `lelu2-${variant}.glb`), glb);
// Head-only GLB so a close-up is framed on her head by construction, not by
// reusing a full-body camera and hoping.
const headParts = parts.filter((p) => ["head", "face", "hair"].includes(p.name));
writeFileSync(join(outDir, `lelu2-${variant}-head.glb`), writeGlb(headParts, { generator: `LÉLU 2.1 — head close-up (${variant})` }));

const cells = occupancyCodes(build, DEFAULT_LATTICE);
const report = {
  variant,
  lod: tubes ? lod : null,
  ms: Math.round(ms),
  triangles: tris,
  hairTriangles: hairPart ? hairPart.mesh.indices.length / 3 : 0,
  glbBytes: glb.length,
  occupancyCells: cells.size,
  /** Sorted hash so two builds can be compared for identical occupancy. */
  occupancyDigest: [...cells].sort((a, b) => a - b).slice(0, 2000).join(",").length,
  hair: hairDiagnostics,
  tubes: tubeDiagnostics,
  components: build.components.map((c) => ({ id: c.id, triangles: c.local ? c.local.mesh.indices.length / 3 : 0 })),
  rootClearance: null as null | { measured: number; p50Mm: number; p95Mm: number; maxMm: number; over4mm: number; note: string },
};

// Root clearance against her head MESH: nearest head vertex. A 3 mm occupancy
// field cannot resolve the 0.5 mm question "is this root on the skin?", and
// measuring against the mesh is the question the acceptance criterion asks.
if (tubes && hairRootPoints && hairRootPoints.length) {
  const headPart = parts.find((p) => p.name === "head");
  if (headPart) {
    const index = new PointIndex({ points: headPart.mesh.positions, centre: [0, 0, 0], source: "head" }, 0.005);
    const distances: number[] = [];
    for (let i = 0; i < hairRootPoints.length; i += 3) {
      const hit = index.nearest(hairRootPoints[i], hairRootPoints[i + 1], hairRootPoints[i + 2]);
      if (hit.index >= 0) distances.push(hit.distance * 1000);
    }
    distances.sort((a, b) => a - b);
    report.rootClearance = {
      measured: distances.length,
      p50Mm: distances[Math.floor(distances.length / 2)] ?? 0,
      p95Mm: distances[Math.floor(distances.length * 0.95)] ?? 0,
      maxMm: distances[distances.length - 1] ?? 0,
      over4mm: distances.filter((d) => d > 4).length,
      note: "distance from each drawn root to the nearest head-mesh vertex",
    };
  }
}
writeFileSync(join(outDir, `metrics-${variant}.json`), JSON.stringify(report, null, 2));
console.log(
  `${variant}: ${(ms / 1000).toFixed(1)} s — ${tris.toLocaleString()} tris (hair ${report.hairTriangles.toLocaleString()}), ${(glb.length / 1e6).toFixed(1)} MB, ${cells.size} cells`,
);
if (report.rootClearance) console.log(`  roots vs head mesh: p50 ${report.rootClearance.p50Mm.toFixed(2)} mm, p95 ${report.rootClearance.p95Mm.toFixed(2)} mm, max ${report.rootClearance.maxMm.toFixed(2)} mm, >4 mm ${report.rootClearance.over4mm}/${report.rootClearance.measured}`);
if (tubes) {
  console.log(
    `  tubes: lod ${lod} ${tubeDiagnostics.sides}×${tubeDiagnostics.segments}, ${tubeDiagnostics.strands} strands, ` +
      `roots ${tubeDiagnostics.rootOffsetMinMm.toFixed(2)}…${tubeDiagnostics.rootOffsetMaxMm.toFixed(2)} mm ` +
      `(penetrating ${tubeDiagnostics.rootPenetrations}, floating ${tubeDiagnostics.floatingRoots}), ` +
      `diameter ${tubeDiagnostics.diameterMinMm.toFixed(2)}…${tubeDiagnostics.diameterMaxMm.toFixed(2)} mm CV ${tubeDiagnostics.diameterCv.toFixed(2)}, ` +
      `baby hairs ${tubeDiagnostics.babyStrands}`,
  );
}
