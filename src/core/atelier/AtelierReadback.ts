/**
 * ==========================================================
 * LÉLU — ATELIER: READING DESIGN FILES BACK
 *
 * Each written file is parsed again from its bytes and compared
 * with the design: every component ID present where the format
 * carries IDs, triangle/vertex counts consistent, the model's
 * bounds equal to the assembly's, dimension text on drawings.
 * A file is reported as exported only if this passes.
 * ==========================================================
 */

import { componentMesh, meshBounds, type Bounds } from "./AtelierGeometry";
import type { AtelierFormat } from "./AtelierFiles";
import type { DesignDirection } from "./AtelierTypes";

export interface FileCheck { name: string; ok: boolean; detail?: string }
export interface FileVerification { ok: boolean; checks: FileCheck[]; summary: Record<string, unknown> }

const dec = new TextDecoder();
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

function expectedBounds(d: DesignDirection): Bounds {
  return meshBounds(d.components.map((c) => componentMesh(c)));
}

export function parseStl(bytes: Uint8Array): { triangles: number; bounds: Bounds; degenerate: number } {
  if (bytes.length < 84) throw new Error("too short for a binary STL");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = view.getUint32(80, true);
  if (84 + n * 50 !== bytes.length) throw new Error(`header says ${n} triangles but the file holds ${(bytes.length - 84) / 50}`);
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let degenerate = 0;
  for (let t = 0; t < n; t += 1) {
    const o = 84 + t * 50 + 12;
    const v: number[][] = [];
    for (let k = 0; k < 3; k += 1) {
      const x = view.getFloat32(o + k * 12, true), y = view.getFloat32(o + k * 12 + 4, true), z = view.getFloat32(o + k * 12 + 8, true);
      if (![x, y, z].every(Number.isFinite)) throw new Error(`triangle ${t} has a non-finite vertex`);
      v.push([x, y, z]);
      min.x = Math.min(min.x, x); max.x = Math.max(max.x, x); min.y = Math.min(min.y, y); max.y = Math.max(max.y, y); min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
    }
    const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2], wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
    if (Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) < 1e-9) degenerate += 1;
  }
  return { triangles: n, bounds: { min, max }, degenerate };
}

export function parseObj(text: string): { objects: string[]; vertices: number; faces: number; badFaces: number; bounds: Bounds } {
  const objects: string[] = [];
  let vertices = 0, faces = 0, badFaces = 0;
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("o ")) objects.push(line.slice(2).split(/\s+/)[0]);
    else if (line.startsWith("v ")) {
      const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
      vertices += 1;
      min.x = Math.min(min.x, x); max.x = Math.max(max.x, x); min.y = Math.min(min.y, y); max.y = Math.max(max.y, y); min.z = Math.min(min.z, z); max.z = Math.max(max.z, z);
    } else if (line.startsWith("f ")) {
      faces += 1;
      const idx = line.slice(2).trim().split(/\s+/).map((p) => Number(p.split("/")[0]));
      if (idx.length < 3 || idx.some((i) => !Number.isInteger(i) || i < 1 || i > vertices)) badFaces += 1;
    }
  }
  return { objects, vertices, faces, badFaces, bounds: { min, max } };
}

export function parseGltf(text: string): { nodes: string[]; meshes: number; triangles: number; bounds: Bounds; bufferOk: boolean } {
  const g = JSON.parse(text) as {
    asset?: { version?: string };
    nodes?: Array<{ name?: string; mesh?: number }>;
    meshes?: Array<{ primitives: Array<{ attributes: { POSITION: number }; indices?: number }> }>;
    accessors?: Array<{ count: number; min?: number[]; max?: number[]; bufferView?: number }>;
    bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
    buffers?: Array<{ byteLength: number; uri?: string }>;
  };
  if (g.asset?.version !== "2.0") throw new Error(`asset.version is ${g.asset?.version ?? "missing"}, not 2.0`);
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let triangles = 0;
  for (const m of g.meshes ?? []) for (const p of m.primitives) {
    const a = g.accessors?.[p.attributes.POSITION];
    if (!a?.min || !a.max) throw new Error("a POSITION accessor has no min/max (required by glTF 2.0)");
    // Back from metres, Y-up to mm, Z-up.
    min.x = Math.min(min.x, a.min[0] * 1000); max.x = Math.max(max.x, a.max[0] * 1000);
    min.z = Math.min(min.z, a.min[1] * 1000); max.z = Math.max(max.z, a.max[1] * 1000);
    min.y = Math.min(min.y, -a.max[2] * 1000); max.y = Math.max(max.y, -a.min[2] * 1000);
    if (p.indices !== undefined) triangles += (g.accessors?.[p.indices]?.count ?? 0) / 3;
  }
  const buffer = g.buffers?.[0];
  let bufferOk = false;
  if (buffer?.uri?.startsWith("data:")) {
    const b64 = buffer.uri.slice(buffer.uri.indexOf(",") + 1);
    const length = Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
    const viewsFit = (g.bufferViews ?? []).every((v) => (v.byteOffset ?? 0) + v.byteLength <= length);
    bufferOk = length === buffer.byteLength && viewsFit;
  }
  return { nodes: (g.nodes ?? []).map((n) => n.name ?? ""), meshes: g.meshes?.length ?? 0, triangles, bounds: { min, max }, bufferOk };
}

export function parseDxf(text: string): { layers: string[]; entities: Record<string, number>; texts: string[]; valid: boolean } {
  const lines = text.split(/\r?\n/);
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1]]);
  const layers: string[] = [];
  const entities: Record<string, number> = {};
  const texts: string[] = [];
  let section = "";
  let inTable = false;
  for (let i = 0; i < pairs.length; i += 1) {
    const [code, value] = pairs[i];
    if (code === 0 && value === "SECTION") section = pairs[i + 1]?.[1] ?? "";
    if (code === 0 && value === "TABLE") inTable = true;
    if (code === 0 && value === "ENDTAB") inTable = false;
    if (section === "TABLES" && inTable && code === 0 && value === "LAYER") layers.push(pairs[i + 1]?.[1] ?? "");
    if (section === "ENTITIES" && code === 0 && value !== "ENDSEC") entities[value] = (entities[value] ?? 0) + 1;
    if (section === "ENTITIES" && code === 1) texts.push(value);
  }
  return { layers, entities, texts, valid: pairs.length > 0 && pairs[pairs.length - 1][1] === "EOF" && pairs.every(([c]) => Number.isInteger(c)) };
}

export function verifyAtelierFile(d: DesignDirection, format: AtelierFormat, bytes: Uint8Array): FileVerification {
  const checks: FileCheck[] = [];
  const ids = d.components.map((c) => c.id);
  const exp = expectedBounds(d);
  const sameBounds = (b: Bounds, tol = 0.02) => near(b.min.x, exp.min.x, tol) && near(b.max.x, exp.max.x, tol) && near(b.min.y, exp.min.y, tol) && near(b.max.y, exp.max.y, tol) && near(b.min.z, exp.min.z, tol) && near(b.max.z, exp.max.z, tol);
  const fmtB = (b: Bounds) => `${Math.round(b.max.x - b.min.x)} × ${Math.round(b.max.y - b.min.y)} × ${Math.round(b.max.z - b.min.z)} mm`;
  const expectedTris = d.components.reduce((n, c) => n + componentMesh(c).indices.length / 3, 0);
  let summary: Record<string, unknown> = {};
  try {
    if (format === "stl") {
      const s = parseStl(bytes);
      summary = { triangles: s.triangles, size: fmtB(s.bounds) };
      checks.push({ name: "opens", ok: true, detail: `binary STL, ${s.triangles} triangles` });
      checks.push({ name: "triangles", ok: s.triangles === expectedTris, detail: `${s.triangles} of ${expectedTris}` });
      checks.push({ name: "no degenerate triangles", ok: s.degenerate === 0, detail: `${s.degenerate}` });
      checks.push({ name: "size", ok: sameBounds(s.bounds), detail: `${fmtB(s.bounds)} (assembly ${fmtB(exp)})` });
    } else if (format === "obj") {
      const o = parseObj(dec.decode(bytes));
      summary = { objects: o.objects, vertices: o.vertices, faces: o.faces };
      checks.push({ name: "opens", ok: o.vertices > 0, detail: `${o.objects.length} objects, ${o.vertices} vertices, ${o.faces} faces` });
      checks.push({ name: "component IDs", ok: ids.every((id) => o.objects.includes(id)), detail: ids.filter((id) => !o.objects.includes(id)).join(", ") || "all present" });
      checks.push({ name: "faces reference real vertices", ok: o.badFaces === 0, detail: `${o.badFaces} bad` });
      checks.push({ name: "size", ok: sameBounds(o.bounds), detail: fmtB(o.bounds) });
    } else if (format === "gltf") {
      const g = parseGltf(dec.decode(bytes));
      summary = { nodes: g.nodes, meshes: g.meshes, triangles: g.triangles };
      checks.push({ name: "opens", ok: true, detail: `glTF 2.0, ${g.meshes} meshes` });
      checks.push({ name: "component IDs", ok: ids.every((id) => g.nodes.includes(id)), detail: ids.filter((id) => !g.nodes.includes(id)).join(", ") || "all nodes named" });
      checks.push({ name: "embedded buffer", ok: g.bufferOk, detail: g.bufferOk ? "length and views consistent" : "buffer length or views inconsistent" });
      checks.push({ name: "triangles", ok: g.triangles === expectedTris, detail: `${g.triangles} of ${expectedTris}` });
      checks.push({ name: "size", ok: sameBounds(g.bounds), detail: fmtB(g.bounds) });
    } else if (format === "dxf") {
      const x = parseDxf(dec.decode(bytes));
      summary = { layers: x.layers.length, entities: x.entities };
      const layerIds = ids.map((id) => id.replace(/[^A-Za-z0-9_-]/g, "_"));
      checks.push({ name: "opens", ok: x.valid, detail: x.valid ? "group codes well-formed, ends with EOF" : "malformed" });
      checks.push({ name: "a layer per component", ok: layerIds.every((l) => x.layers.includes(l)), detail: `${x.layers.length} layers` });
      checks.push({ name: "geometry", ok: (x.entities.LINE ?? 0) + (x.entities.CIRCLE ?? 0) >= d.components.length * 3, detail: JSON.stringify(x.entities) });
      checks.push({ name: "IDs labelled", ok: ids.every((id) => x.texts.includes(id)), detail: "front-view labels" });
    } else {
      const svg = dec.decode(bytes);
      const ok = svg.startsWith("<svg") && svg.trimEnd().endsWith("</svg>") && (svg.match(/<svg/g) ?? []).length === 1;
      checks.push({ name: "opens", ok, detail: ok ? "one well-formed SVG root" : "not a single SVG document" });
      const tagBalance = (svg.match(/<g[\s>]/g) ?? []).length === (svg.match(/<\/g>/g) ?? []).length;
      checks.push({ name: "balanced groups", ok: tagBalance });
      const missing = ids.filter((id) => !svg.includes(`data-component="${id}"`) && !svg.includes(`data-callout="${id}"`));
      if (format !== "svg-workflow") checks.push({ name: "every component drawn", ok: missing.length === 0, detail: missing.join(", ") || "all IDs present" });
      if (format === "svg-orthographic") {
        const dims = (svg.match(/\d+(\.\d+)? mm</g) ?? []).length;
        checks.push({ name: "dimensions", ok: dims >= 6, detail: `${dims} dimension labels (3 views × 2)` });
        checks.push({ name: "callouts", ok: ids.every((id) => svg.includes(`data-callout="${id}"`)), detail: "one per component" });
      }
      if (format === "svg-workflow") checks.push({ name: "steps", ok: (svg.match(/data-step=/g) ?? []).length >= d.components.length + 2 });
      summary = { bytes: bytes.length };
    }
  } catch (error) {
    checks.push({ name: "opens", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return { ok: checks.length > 0 && checks.every((c) => c.ok), checks, summary };
}
