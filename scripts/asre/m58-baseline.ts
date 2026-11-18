#!/usr/bin/env node
/**
 * LÉLU — MISSION 5.8 — BASELINE CAPTURE
 *
 * Builds the CURRENT character offline (no server), measures it honestly and
 * writes the GLBs that the Blender renderer turns into the "before" images.
 * Run again after every geometry change to get the "after" side of the
 * same measurement (see m58-measure.ts).
 *
 *   npx tsx scripts/asre/m58-baseline.ts [--out artifacts/mission58/before]
 *
 * Every number printed here is measured on this machine, now:
 *   - triangles / vertices / cells / samples per component
 *   - build time (cold cache, and per-component)
 *   - vertex-to-surface error: |SDF(v)| for every vertex, in millimetres.
 *     It is the distance from the vertex to the true analytic surface, so it
 *     says how well the mesh approximates the described shape — a geometry
 *     number, not a lighting or shading number.
 *   - normal error: angle between the mesh normal and the analytic SDF
 *     gradient at the same point (0° = exact).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { BASE_CHARACTER, OUTFITS, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { DEFAULT_LATTICE, buildCharacter, glbParts, plan, type Lattice } from "../../src/core/asre/character/build.ts";
import { COMPONENTS, COMPONENT_ORDER, contextFor, type ComponentId } from "../../src/core/asre/character/components.ts";
import type { Shape } from "../../src/core/asre/character/shape.ts";
import { analyzeMesh, vertexNormals, type Mesh } from "../../src/core/asre/volume/mesh.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const OUT = path.resolve(flag("out", "artifacts/mission58/before"));
const L: Lattice = DEFAULT_LATTICE;
mkdirSync(OUT, { recursive: true });

/* ------------------------------- measurement ------------------------------- */

interface ComponentMeasure {
  id: ComponentId;
  cells: number;
  vertices: number;
  triangles: number;
  samples: number;
  buildMs: number;
  trianglesPerCell: number;
  surfaceErrorMm: { mean: number; p95: number; max: number } | null;
  normalErrorDeg: { mean: number; p95: number; max: number } | null;
  watertight: boolean;
  degenerate: number;
  signedVolume: number;
}

const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

/** |SDF(v)| and the SDF-gradient normal error at every vertex, in the component's own frame. */
function surfaceAccuracy(shape: Shape, mesh: Mesh): { surfaceErrorMm: ComponentMeasure["surfaceErrorMm"]; normalErrorDeg: ComponentMeasure["normalErrorDeg"] } {
  const n = mesh.positions.length / 3;
  if (!n) return { surfaceErrorMm: null, normalErrorDeg: null };
  const normals = mesh.normals ?? vertexNormals(mesh);
  const h = 1e-4; // 0.1 mm central differences
  const err: number[] = [];
  const ang: number[] = [];
  for (let v = 0; v < n; v++) {
    const x = mesh.positions[3 * v], y = mesh.positions[3 * v + 1], z = mesh.positions[3 * v + 2];
    err.push(Math.abs(shape.f(x, y, z)) * 1000);
    if (!mesh.normals) continue; // analytic normals are checked by the caller
    const gx = shape.f(x + h, y, z) - shape.f(x - h, y, z);
    const gy = shape.f(x, y + h, z) - shape.f(x, y - h, z);
    const gz = shape.f(x, y, z + h) - shape.f(x, y, z - h);
    const gl = Math.hypot(gx, gy, gz) || 1;
    const dot = (normals[3 * v] * gx + normals[3 * v + 1] * gy + normals[3 * v + 2] * gz) / gl;
    ang.push((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
  }
  err.sort((a, b) => a - b);
  ang.sort((a, b) => a - b);
  return {
    surfaceErrorMm: { mean: +(err.reduce((a, b) => a + b, 0) / err.length).toFixed(3), p95: +quantile(err, 0.95).toFixed(3), max: +err[err.length - 1].toFixed(3) },
    normalErrorDeg: { mean: +(ang.reduce((a, b) => a + b, 0) / ang.length).toFixed(2), p95: +quantile(ang, 0.95).toFixed(2), max: +ang[ang.length - 1].toFixed(2) },
  };
}

function measure(spec: CharacterSpec, label: string) {
  const t0 = performance.now();
  const build = buildCharacter(spec, null, L);
  const totalMs = performance.now() - t0;
  const p = plan(spec, L);
  const parts = glbParts(build, L.resolution, spec);
  const glb = writeGlb(parts, { generator: `LÉLU ASRE character (${label})`, extras: { identity: spec.identity.id, label } });
  const file = path.join(OUT, `${label}.glb`);
  writeFileSync(file, glb);

  const components: ComponentMeasure[] = [];
  for (const c of build.components) {
    const local = c.local!;
    const rep = analyzeMesh(local.mesh);
    const def = COMPONENTS[c.id];
    const shape = def.build(contextFor(spec, p.sk));
    const acc = shape && local.mesh.indices.length ? surfaceAccuracy(shape, local.mesh) : { surfaceErrorMm: null, normalErrorDeg: null };
    components.push({
      id: c.id,
      cells: local.cells.length / 3,
      vertices: rep.vertices,
      triangles: rep.triangles,
      samples: local.samples,
      buildMs: +c.ms.toFixed(1),
      trianglesPerCell: local.cells.length ? +(rep.triangles / (local.cells.length / 3)).toFixed(2) : 0,
      ...acc,
      watertight: rep.watertight,
      degenerate: rep.degenerateTriangles,
      signedVolume: +rep.signedVolume.toFixed(6),
    });
  }
  const weighted = (k: "surfaceErrorMm" | "normalErrorDeg") => {
    const withVerts = components.filter((c) => c[k] && c.vertices > 0);
    const v = withVerts.reduce((a, c) => a + c.vertices, 0) || 1;
    return +(withVerts.reduce((a, c) => a + (c[k]!.mean * c.vertices) / v, 0)).toFixed(3);
  };
  const r = {
    label,
    file: path.relative(process.cwd(), file),
    glbBytes: glb.length,
    latticeMm: L.resolution * 1000,
    buildMs: +totalMs.toFixed(1),
    totals: {
      cells: components.reduce((a, c) => a + c.cells, 0),
      vertices: components.reduce((a, c) => a + c.vertices, 0),
      triangles: components.reduce((a, c) => a + c.triangles, 0),
      samples: components.reduce((a, c) => a + c.samples, 0),
      surfaceErrorMm: weighted("surfaceErrorMm"),
      normalErrorDeg: weighted("normalErrorDeg"),
      watertightComponents: components.filter((c) => c.watertight).length,
      nonEmptyComponents: components.filter((c) => c.triangles > 0).length,
    },
    components,
  };
  console.log(`${label.padEnd(26)} ${String(r.totals.triangles).padStart(8)} tris  ${String(r.totals.cells).padStart(7)} cells  ${r.totals.surfaceErrorMm.toFixed(2).padStart(6)} mm err  ${r.totals.normalErrorDeg.toFixed(1).padStart(5)}° nrm  ${String(Math.round(totalMs)).padStart(5)} ms`);
  return r;
}

/* ---------------------------------- suite ---------------------------------- */

const specs: Array<{ label: string; spec: CharacterSpec }> = [
  { label: "base", spec: BASE_CHARACTER },
  { label: "hair-afro", spec: withChanges(BASE_CHARACTER, { hair: { style: "afro", volume: 1.35 } }) },
  { label: "hair-bob", spec: withChanges(BASE_CHARACTER, { hair: { style: "bob" } }) },
  { label: "hair-ponytail", spec: withChanges(BASE_CHARACTER, { hair: { style: "ponytail", length: 1.25 } }) },
  { label: "pose-a", spec: withChanges(BASE_CHARACTER, { pose: "a-pose" }) },
  { label: "pose-wave", spec: withChanges(BASE_CHARACTER, { pose: "wave" }) },
  ...OUTFITS.slice(0, 4).map((o, i) => ({ label: `outfit-${i}-${o.label}`, spec: withChanges(BASE_CHARACTER, { clothing: o.clothing, materials: { top: o.top, bottom: o.bottom } }) })),
];

const started = new Date().toISOString();
const results = specs.map((s) => measure(s.spec, s.label));
const report = {
  mission: "Mission 5.8 — character fidelity baseline",
  startedAt: started,
  finishedAt: new Date().toISOString(),
  node: process.version,
  lattice: L,
  note: "surfaceErrorMm is |SDF(vertex)| — the distance from each mesh vertex to the true analytic surface. normalErrorDeg compares mesh normals with the analytic SDF gradient.",
  runs: results,
};
writeFileSync(path.join(OUT, "metrics.json"), JSON.stringify(report, null, 1));
console.log(`\nwrote ${path.relative(process.cwd(), path.join(OUT, "metrics.json"))} and ${results.length} GLBs`);
