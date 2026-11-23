/**
 * ==========================================================
 * LÉLU 2.1 — WP05: PROJECTION COST, MEASURED ON THE FILES
 *
 * What a viewer has to load and draw is a property of the GLB, not of a render.
 * This reads the files LÉLU 2.1 wrote and reports, per representation:
 *
 *   draw calls     one per glTF primitive (three.js issues one per mesh)
 *   triangles      summed from the index accessors
 *   buffer bytes   the BIN chunk a browser must download and parse
 *   parse time     read + JSON decode + accessor walk, measured here
 *   GPU bytes      an estimate from the accessor byte lengths actually used
 *
 * LOD levels are compared directly. Frame times are NOT measured here: this runs
 * in Node with no GPU. A real mobile number needs a real device, and this report
 * says so instead of quoting a desktop number as if it were an iPhone.
 *
 *   npx tsx scripts/asre/lelu2/project.ts
 *   → artifacts/lelu2/projection.json
 * ==========================================================
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

interface GlbSummary {
  file: string;
  bytes: number;
  nodes: number;
  meshes: number;
  primitives: number;
  triangles: number;
  binBytes: number;
  jsonBytes: number;
  parseMs: number;
  gpuBytes: number;
  components: string[];
}

const COMPONENT_TYPE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function summarise(file: string): GlbSummary {
  const t0 = performance.now();
  const buffer = readFileSync(file);
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error(`${file} is not a GLB`);
  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let binBytes = 0;
  let jsonBytes = 0;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) {
      jsonBytes = length;
      json = JSON.parse(chunk.toString("utf8")) as Record<string, unknown>;
    } else if (type === 0x004e4942) binBytes = length;
    offset += 8 + length;
  }
  if (!json) throw new Error(`${file} has no JSON chunk`);
  const gltf = json as {
    nodes?: { name?: string }[];
    meshes?: { primitives?: { indices?: number; attributes?: Record<string, number>; mode?: number }[] }[];
    accessors?: { count: number; type: string; componentType: number; byteOffset?: number }[];
    bufferViews?: { byteLength: number }[];
  };
  let triangles = 0;
  let primitives = 0;
  let gpuBytes = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      primitives++;
      if (prim.indices !== undefined && gltf.accessors?.[prim.indices]) {
        triangles += gltf.accessors[prim.indices].count / 3;
      }
      const view = gltf.bufferViews ?? [];
      if (prim.indices !== undefined) {
        const acc = gltf.accessors?.[prim.indices];
        if (acc?.indices !== undefined) gpuBytes += view[acc.indices]?.byteLength ?? 0;
      }
      for (const accessor of Object.values(prim.attributes ?? {})) {
        const acc = gltf.accessors?.[accessor];
        if (!acc) continue;
        gpuBytes += acc.count * (TYPE_COUNT[acc.type] ?? 3) * (COMPONENT_TYPE[acc.componentType] ?? 4);
      }
    }
  }
  return {
    file,
    bytes: buffer.length,
    nodes: (gltf.nodes ?? []).length,
    meshes: (gltf.meshes ?? []).length,
    primitives,
    triangles: Math.round(triangles),
    binBytes,
    jsonBytes,
    parseMs: Number((performance.now() - t0).toFixed(1)),
    gpuBytes,
    components: (gltf.nodes ?? []).map((n) => n.name ?? "").filter(Boolean),
  };
}

const dirs = ["voxel", "tubes-high", "tubes-medium", "tubes-low"];
const files: string[] = [];
for (const dir of dirs) {
  const folder = path.join("artifacts/lelu2/hair", dir);
  try {
    for (const f of readdirSync(folder)) if (f.endsWith(".glb")) files.push(path.join(folder, f));
  } catch {
    /* a variant that was not built */
  }
}

const summaries = files.map(summarise);
const simple = summaries.filter((s) => !s.file.includes("-head.glb"));
const table = simple.map((s) => ({
  variant: path.basename(s.file).replace("lelu2-", "").replace(".glb", ""),
  drawCalls: s.primitives,
  triangles: s.triangles,
  glbMB: Number((s.bytes / 1e6).toFixed(1)),
  binMB: Number((s.binBytes / 1e6).toFixed(1)),
  jsonKB: Number((s.jsonBytes / 1e3).toFixed(0)),
  gpuMB: Number((s.gpuBytes / 1e6).toFixed(1)),
  parseMs: s.parseMs,
  loadedFromDiskMs: Number((statSync(s.file).size / 1e6).toFixed(1)),
}));

/** Hair LOD table read from the experiment's own metrics, not re-derived. */
const lod: { variant: string; hairTriangles: number; totalTriangles: number; glbMB: number }[] = [];
for (const dir of dirs) {
  try {
    const m = JSON.parse(readFileSync(path.join("artifacts/lelu2/hair", dir, `metrics-${dir}.json`), "utf8")) as {
      hairTriangles: number;
      triangles: number;
      glbBytes: number;
    };
    lod.push({ variant: dir, hairTriangles: m.hairTriangles, totalTriangles: m.triangles, glbMB: Number((m.glbBytes / 1e6).toFixed(1)) });
  } catch {
    /* not built */
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  note:
    "Structural projection cost only. No frame time was measured on a device, so no real-time or iPhone claim is made here. " +
    "A browser/device benchmark has to run on that device; this file does not substitute for one.",
  files: table,
  lod,
  lodRatios: lod.length
    ? lod
        .filter((l) => l.variant !== "voxel")
        .map((l) => ({
          variant: l.variant,
          hairShareOfVoxel: Number((l.hairTriangles / (lod.find((v) => v.variant === "voxel")?.hairTriangles ?? 1)).toFixed(3)),
          totalShareOfVoxel: Number((l.totalTriangles / (lod.find((v) => v.variant === "voxel")?.totalTriangles ?? 1)).toFixed(3)),
        }))
    : [],
};
writeFileSync("artifacts/lelu2/projection.json", JSON.stringify(report, null, 2));

console.log("representation        draw calls   triangles    GLB MB   GPU MB   parse ms");
for (const f of table) console.log(`${f.variant.padEnd(20)} ${String(f.drawCalls).padStart(6)}   ${f.triangles.toLocaleString().padStart(12)}   ${String(f.glbMB).padStart(6)}   ${String(f.gpuMB).padStart(6)}   ${String(f.parseMs).padStart(7)}`);
console.log("\nhair LOD:");
for (const l of lod) console.log(`  ${l.variant.padEnd(14)} ${l.hairTriangles.toLocaleString().padStart(10)} hair tris, ${l.totalTriangles.toLocaleString().padStart(12)} total, ${l.glbMB} MB`);
console.log(`\n${report.note}`);
console.log("written: artifacts/lelu2/projection.json");
