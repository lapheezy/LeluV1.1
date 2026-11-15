/**
 * ==========================================================
 * LÉLU — CREATIVE ENGINE EXPORTS
 *
 * Real files, written from the same geometry the engine holds:
 *
 *   GLB   — glTF 2.0 binary, metres, y-up, one mesh per part,
 *           a PBR material per part, component ids in extras.
 *   OBJ   — vertices/faces with a group and usemtl per part.
 *   SVG   — pattern sheets and orthographic technical drawings.
 *   JSON  — the object project: identity, components, hierarchy,
 *           transforms, materials and revision history.
 *
 * Every exporter is paired with a reader that re-parses the bytes
 * it produced (validateGlb / validateObj / validateSvg), because
 * "the file was written" is not the same claim as "the file
 * opens and its geometry is intact".
 *
 * glTF's own conventions are followed: metres, y-up, right-handed.
 * Internally the engine is millimetres, z-up.
 * ==========================================================
 */

import { meshNormals, meshToScene, type Mesh } from "./geometry";
import type { CreativeObject } from "./objects";
import type { Pattern } from "./pattern";

/* ==========================================================
 * GLB
 * ========================================================== */

interface GltfPrimitive {
  attributes: { POSITION: number; NORMAL: number };
  indices: number;
  material: number;
}

interface GltfJson {
  asset: { version: string; generator: string };
  scene: number;
  scenes: Array<{ nodes: number[]; name: string }>;
  nodes: Array<{ name: string; mesh?: number; translation?: number[]; extras?: Record<string, unknown> }>;
  meshes: Array<{ name: string; primitives: GltfPrimitive[]; extras?: Record<string, unknown> }>;
  materials: Array<Record<string, unknown>>;
  accessors: Array<Record<string, unknown>>;
  bufferViews: Array<Record<string, unknown>>;
  buffers: Array<{ byteLength: number }>;
}

export interface GlbPart {
  id: string;
  label: string;
  mesh: Mesh;
  color: string;
  materialId: string;
  opacity: number;
  componentId?: string;
}

const PAD4 = (n: number) => (n + 3) & ~3;

/**
 * Write a GLB. Meshes are converted to metres and y-up here, so the file
 * opens at a sane size in Blender, a glTF viewer, or three.js.
 */
export function exportGlb(parts: GlbPart[], meta: Record<string, unknown> = {}): Uint8Array {
  const bin: number[] = [];
  const json: GltfJson = {
    asset: { version: "2.0", generator: "LÉLU creative engine (offline)" },
    scene: 0,
    scenes: [{ nodes: [], name: "LÉLU scene" }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };

  const pushView = (bytes: number[], target: number): number => {
    while (bin.length % 4 !== 0) bin.push(0);
    const byteOffset = bin.length;
    bin.push(...bytes);
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
    return json.bufferViews.length - 1;
  };

  const materialIndex = new Map<string, number>();
  const materialFor = (part: GlbPart): number => {
    const key = `${part.color}|${part.opacity}`;
    const existing = materialIndex.get(key);
    if (existing !== undefined) return existing;
    const alpha = part.opacity < 1;
    json.materials.push({
      name: part.materialId,
      pbrMetallicRoughness: {
        baseColorFactor: [...hexToUnit(part.color), part.opacity],
        metallicFactor: 1,
        roughnessFactor: 0.4,
      },
      ...(alpha ? { alphaMode: "BLEND", doubleSided: true } : { doubleSided: true }),
    });
    materialIndex.set(key, json.materials.length - 1);
    return json.materials.length - 1;
  };

  for (const part of parts) {
    const sceneMesh = meshToScene(part.mesh);
    const positions = new Float32Array(sceneMesh.positions);
    const normals = new Float32Array(sceneMesh.normals ?? meshNormals(sceneMesh.positions, sceneMesh.indices));
    const indices = new Uint32Array(sceneMesh.indices);

    const positionBytes: number[] = [];
    const posView = new DataView(new ArrayBuffer(positions.byteLength));
    positions.forEach((n, i) => posView.setFloat32(i * 4, n, true));
    positionBytes.push(...new Uint8Array(posView.buffer));

    const normalBytes: number[] = [];
    const normView = new DataView(new ArrayBuffer(normals.byteLength));
    normals.forEach((n, i) => normView.setFloat32(i * 4, n, true));
    normalBytes.push(...new Uint8Array(normView.buffer));

    const indexBytes: number[] = [];
    const idxView = new DataView(new ArrayBuffer(indices.byteLength));
    indices.forEach((n, i) => idxView.setUint32(i * 4, n, true));
    indexBytes.push(...new Uint8Array(idxView.buffer));

    const posViewIndex = pushView(positionBytes, 34962);
    const normViewIndex = pushView(normalBytes, 34962);
    const idxViewIndex = pushView(indexBytes, 34963);

    let min: [number, number, number] = [Infinity, Infinity, Infinity];
    let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], positions[i + k]);
        max[k] = Math.max(max[k], positions[i + k]);
      }
    }

    json.accessors.push({ bufferView: posViewIndex, componentType: 5126, count: positions.length / 3, type: "VEC3", min, max });
    const posAccessor = json.accessors.length - 1;
    json.accessors.push({ bufferView: normViewIndex, componentType: 5126, count: normals.length / 3, type: "VEC3" });
    const normAccessor = json.accessors.length - 1;
    json.accessors.push({ bufferView: idxViewIndex, componentType: 5125, count: indices.length, type: "SCALAR" });
    const idxAccessor = json.accessors.length - 1;

    json.meshes.push({
      name: part.id,
      primitives: [{ attributes: { POSITION: posAccessor, NORMAL: normAccessor }, indices: idxAccessor, material: materialFor(part) }],
      extras: { label: part.label, componentId: part.componentId ?? null },
    });
    json.nodes.push({ name: part.label || part.id, mesh: json.meshes.length - 1 });
    json.scenes[0].nodes.push(json.nodes.length - 1);
  }

  json.buffers[0].byteLength = bin.length;
  json.nodes.push({ name: "LÉLU meta", extras: { ...meta } });

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPadded = new Uint8Array(PAD4(jsonBytes.length));
  jsonPadded.fill(0x20);
  jsonPadded.set(jsonBytes);

  const binPadded = new Uint8Array(PAD4(bin.length));
  binPadded.set(bin);

  const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // glTF
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded.length, true);
  view.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(jsonPadded, 20);
  const binHeader = 20 + jsonPadded.length;
  view.setUint32(binHeader, binPadded.length, true);
  view.setUint32(binHeader + 4, 0x004e4942, true); // BIN
  out.set(binPadded, binHeader + 8);
  return out;
}

function hexToUnit(hex: string): [number, number, number] {
  const full = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}

export interface GlbReport {
  ok: boolean;
  version: number;
  meshes: number;
  triangles: number;
  vertices: number;
  materials: number;
  errors: string[];
  bytes: number;
}

/**
 * Re-parse a GLB and check it against the glTF spec constraints that matter
 * for opening it: magic, version, chunk layout, accessor bounds and index
 * range. This is what "the export was validated" means here.
 */
export function validateGlb(bytes: Uint8Array): GlbReport {
  const errors: string[] = [];
  const report: GlbReport = { ok: false, version: 0, meshes: 0, triangles: 0, vertices: 0, materials: 0, errors, bytes: bytes.length };
  if (bytes.length < 20) {
    errors.push(`file is ${bytes.length} bytes, shorter than a GLB header`);
    return report;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) errors.push("magic is not glTF");
  report.version = view.getUint32(4, true);
  if (report.version !== 2) errors.push(`version ${report.version}, expected 2`);
  const declared = view.getUint32(8, true);
  if (declared !== bytes.length) errors.push(`declared length ${declared} but file is ${bytes.length} bytes`);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a) errors.push("first chunk is not JSON");
  if (jsonLength % 4 !== 0) errors.push("JSON chunk is not 4-byte aligned");
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
  let gltf: GltfJson;
  try {
    gltf = JSON.parse(jsonText) as GltfJson;
  } catch (error) {
    errors.push(`JSON chunk does not parse: ${(error as Error).message}`);
    return report;
  }
  const binHeader = 20 + jsonLength;
  if (binHeader + 8 > bytes.length) {
    errors.push("no BIN chunk");
    return report;
  }
  const binLength = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== 0x004e4942) errors.push("second chunk is not BIN");
  const binStart = binHeader + 8;
  if (binStart + binLength > bytes.length) errors.push(`BIN chunk ${binLength} bytes overruns the file`);

  report.meshes = gltf.meshes?.length ?? 0;
  report.materials = gltf.materials?.length ?? 0;
  if (!gltf.asset || gltf.asset.version !== "2.0") errors.push("asset.version is not 2.0");
  for (const [i, accessor] of (gltf.accessors ?? []).entries()) {
    const bufferView = gltf.bufferViews?.[Number(accessor.bufferView)];
    if (!bufferView) {
      errors.push(`accessor ${i} points at a missing bufferView`);
      continue;
    }
    const byteLength = Number(bufferView.byteLength);
    const byteOffset = Number(bufferView.byteOffset ?? 0);
    if (byteOffset + byteLength > binLength) errors.push(`bufferView ${accessor.bufferView} overruns the BIN chunk`);
    const components = accessor.type === "VEC3" ? 3 : 1;
    const size = accessor.componentType === 5126 ? 4 : accessor.componentType === 5125 ? 4 : 2;
    const needed = Number(accessor.count) * components * size;
    if (needed > byteLength) errors.push(`accessor ${i} needs ${needed} bytes but its bufferView holds ${byteLength}`);
  }
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const positionAccessor = gltf.accessors?.[primitive.attributes.POSITION];
      const indexAccessor = gltf.accessors?.[primitive.indices];
      if (!positionAccessor || !indexAccessor) {
        errors.push(`mesh ${mesh.name} is missing POSITION or indices`);
        continue;
      }
      report.vertices += Number(positionAccessor.count);
      report.triangles += Number(indexAccessor.count) / 3;
      if (Number(indexAccessor.count) % 3 !== 0) errors.push(`mesh ${mesh.name} index count is not a multiple of 3`);
      const bufferView = gltf.bufferViews?.[Number(indexAccessor.bufferView)];
      if (bufferView) {
        const offset = binStart + Number(bufferView.byteOffset ?? 0);
        let maxIndex = 0;
        for (let k = 0; k < Number(indexAccessor.count); k += 1) {
          maxIndex = Math.max(maxIndex, view.getUint32(offset + k * 4, true));
        }
        if (maxIndex >= Number(positionAccessor.count)) errors.push(`mesh ${mesh.name} indexes vertex ${maxIndex} of ${positionAccessor.count}`);
      }
      if (primitive.material !== undefined && !gltf.materials?.[primitive.material]) errors.push(`mesh ${mesh.name} uses a missing material`);
    }
  }
  report.ok = errors.length === 0;
  return report;
}

/* ==========================================================
 * OBJ
 * ========================================================== */

export function exportObj(parts: GlbPart[], name = "lelu-object"): string {
  const lines: string[] = [`# LÉLU creative engine — ${name}`, "# units: metres, y-up (glTF convention)", `o ${name.replace(/\s+/g, "_")}`];
  let base = 1;
  for (const part of parts) {
    const scene = meshToScene(part.mesh);
    lines.push(`g ${part.id}`);
    lines.push(`usemtl ${part.materialId}`);
    for (let i = 0; i < scene.positions.length; i += 3) {
      lines.push(`v ${scene.positions[i].toFixed(5)} ${scene.positions[i + 1].toFixed(5)} ${scene.positions[i + 2].toFixed(5)}`);
    }
    for (let i = 0; i < scene.indices.length; i += 3) {
      lines.push(`f ${scene.indices[i] + base} ${scene.indices[i + 1] + base} ${scene.indices[i + 2] + base}`);
    }
    base += scene.positions.length / 3;
  }
  return `${lines.join("\n")}\n`;
}

export interface ObjReport {
  ok: boolean;
  vertices: number;
  faces: number;
  groups: number;
  materials: string[];
  errors: string[];
}

export function validateObj(text: string): ObjReport {
  const report: ObjReport = { ok: false, vertices: 0, faces: 0, groups: 0, materials: [], errors: [] };
  const lines = text.split("\n");
  const materials = new Set<string>();
  let maxIndex = 0;
  for (const [i, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("v ")) report.vertices += 1;
    else if (trimmed.startsWith("f ")) {
      report.faces += 1;
      const corners = trimmed.slice(2).trim().split(/\s+/);
      if (corners.length !== 3) report.errors.push(`line ${i + 1}: face with ${corners.length} corners`);
      for (const c of corners) {
        const index = Number(c.split("/")[0]);
        if (!Number.isInteger(index) || index < 1) report.errors.push(`line ${i + 1}: bad vertex index "${c}"`);
        maxIndex = Math.max(maxIndex, index);
      }
    } else if (trimmed.startsWith("g ")) report.groups += 1;
    else if (trimmed.startsWith("usemtl ")) materials.add(trimmed.slice(7).trim());
  }
  if (maxIndex > report.vertices) report.errors.push(`a face indexes vertex ${maxIndex} but only ${report.vertices} vertices exist`);
  report.materials = [...materials];
  report.ok = report.errors.length === 0 && report.vertices > 0 && report.faces > 0;
  return report;
}

/* ==========================================================
 * SVG
 * ========================================================== */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A pattern sheet as vector art: net, seam allowance, grainline, notches, dimensions. */
export function patternSvg(pattern: Pattern, options: { width?: number; height?: number } = {}): string {
  const width = options.width ?? 1600;
  const height = options.height ?? 1100;
  const pad = 48;
  const cols = Math.ceil(Math.sqrt(pattern.pieces.length));
  const rows = Math.ceil(pattern.pieces.length / cols);
  const cellW = (width - pad * 2) / cols;
  const cellH = (height - pad * 2) / rows;
  const body: string[] = [];

  pattern.pieces.forEach((piece, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const xs = piece.outline.map((p) => p.x);
    const ys = piece.outline.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((cellW - 60) / Math.max(1, maxX - minX), (cellH - 70) / Math.max(1, maxY - minY));
    const ox = pad + col * cellW + (cellW - (maxX - minX) * scale) / 2 - minX * scale;
    // pattern y grows downward in draft space for skirts; flip so hems point down on the page
    const oy = pad + row * cellH + (cellH - (maxY - minY) * scale) / 2 + maxY * scale;
    const map = (x: number, y: number) => `${(ox + x * scale).toFixed(2)},${(oy - y * scale).toFixed(2)}`;
    const net = piece.outline.map((p) => map(p.x, p.y)).join(" ");
    const cut = piece.outline.map((p) => {
      const nx = p.x;
      const ny = p.y;
      const allowance = piece.seamAllowance;
      return map(nx, ny + (ny < (minY + maxY) / 2 ? -allowance : allowance));
    }).join(" ");
    body.push(`<g id="piece-${esc(piece.id)}">`);
    body.push(`<polygon points="${cut}" fill="#141019" stroke="#6d5a7a" stroke-width="1" stroke-dasharray="7 5"/>`);
    body.push(`<polygon points="${net}" fill="#1d1726" stroke="#e9dcc4" stroke-width="1.6"/>`);
    body.push(`<line x1="${map(piece.grainline.a.x, piece.grainline.a.y).split(",")[0]}" y1="${map(piece.grainline.a.x, piece.grainline.a.y).split(",")[1]}" x2="${map(piece.grainline.b.x, piece.grainline.b.y).split(",")[0]}" y2="${map(piece.grainline.b.x, piece.grainline.b.y).split(",")[1]}" stroke="#b9a3c9" stroke-width="1" stroke-dasharray="4 4"/>`);
    body.push(`<text x="${(ox + (maxX + minX) / 2 * scale).toFixed(1)}" y="${(pad + row * cellH + cellH - 22).toFixed(1)}" fill="#e9dcc4" font-family="monospace" font-size="15" text-anchor="middle">${esc(piece.label)}</text>`);
    body.push(`<text x="${(ox + (maxX + minX) / 2 * scale).toFixed(1)}" y="${(pad + row * cellH + cellH - 4).toFixed(1)}" fill="#8f7f9f" font-family="monospace" font-size="11" text-anchor="middle">${(maxX - minX).toFixed(0)} × ${(maxY - minY).toFixed(0)} mm · cut ${piece.cut} · SA ${piece.seamAllowance} mm</text>`);
    body.push(`</g>`);
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#0d0a12"/>
<text x="${pad}" y="30" fill="#f2ead9" font-family="monospace" font-size="18">${esc(pattern.name)} — size ${esc(pattern.size)} — ${pattern.pieces.length} pieces, ${pattern.seams.length} seams</text>
${body.join("\n")}
</svg>
`;
}

/** Orthographic technical drawing from real geometry: front, side and top projections. */
export function orthographicSvg(parts: GlbPart[], options: { title?: string; width?: number; height?: number } = {}): string {
  const width = options.width ?? 1500;
  const height = options.height ?? 620;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const part of parts) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
      minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
      minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
    }
  }
  if (!Number.isFinite(minX)) return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`;
  const views: Array<{ name: string; project: (x: number, y: number, z: number) => [number, number] }> = [
    { name: "FRONT", project: (x, _y, z) => [x, z] },
    { name: "SIDE", project: (_x, y, z) => [y, z] },
    { name: "TOP", project: (x, y) => [x, y] },
  ];
  const cellW = width / 3;
  const body: string[] = [];
  for (const [index, view] of views.entries()) {
    const points = parts.flatMap((part) => {
      const p = part.mesh.positions;
      const out: Array<[number, number]> = [];
      for (let i = 0; i < p.length; i += 3) out.push(view.project(p[i], p[i + 1], p[i + 2]));
      return out;
    });
    const vx = points.map((p) => p[0]);
    const vy = points.map((p) => p[1]);
    const w = Math.max(1, Math.max(...vx) - Math.min(...vx));
    const h = Math.max(1, Math.max(...vy) - Math.min(...vy));
    const scale = Math.min((cellW - 70) / w, (height - 110) / h);
    const ox = index * cellW + (cellW - w * scale) / 2 - Math.min(...vx) * scale;
    const oy = height - 50 + Math.min(...vy) * scale;
    body.push(`<g id="view-${view.name.toLowerCase()}">`);
    body.push(`<text x="${index * cellW + 20}" y="26" fill="#8f7f9f" font-family="monospace" font-size="13">${view.name}</text>`);
    parts.forEach((part) => {
      const p = part.mesh.positions;
      const idx = part.mesh.indices;
      for (let t = 0; t < idx.length; t += 3) {
        const corners = [idx[t], idx[t + 1], idx[t + 2]].map((k) => {
          const [a, b] = view.project(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
          return `${(ox + a * scale).toFixed(1)},${(oy - b * scale).toFixed(1)}`;
        });
        body.push(`<polygon points="${corners.join(" ")}" fill="${part.color}" fill-opacity="0.5" stroke="${part.color}" stroke-opacity="0.9" stroke-width="0.4"/>`);
      }
    });
    body.push(`</g>`);
  }
  const dims = `${(maxX - minX).toFixed(0)} × ${(maxY - minY).toFixed(0)} × ${(maxZ - minZ).toFixed(0)} mm`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="#0d0a12"/>
<text x="20" y="${height - 16}" fill="#e9dcc4" font-family="monospace" font-size="14">${esc(options.title ?? "Technical drawing")} — overall ${dims} — ${parts.length} parts</text>
${body.join("\n")}
</svg>
`;
}

export interface SvgReport {
  ok: boolean;
  elements: number;
  polygons: number;
  errors: string[];
}

export function validateSvg(text: string): SvgReport {
  const errors: string[] = [];
  if (!text.startsWith("<?xml")) errors.push("missing XML declaration");
  if (!text.includes("<svg")) errors.push("no <svg> root");
  if (!text.trimEnd().endsWith("</svg>")) errors.push("svg is not closed");
  const openRect = (text.match(/<rect/g) ?? []).length;
  if (openRect === 0) errors.push("no background rect, the drawing may render invisible");
  const polygons = (text.match(/<polygon/g) ?? []).length;
  if (polygons === 0) errors.push("no polygons: nothing would be drawn");
  const unclosed = (text.match(/<g\b/g) ?? []).length - (text.match(/<\/g>/g) ?? []).length;
  if (unclosed !== 0) errors.push(`${unclosed} unclosed <g> elements`);
  return { ok: errors.length === 0, elements: (text.match(/<[a-z]/g) ?? []).length, polygons, errors };
}

/* ==========================================================
 * JSON project
 * ========================================================== */

export function exportProject(objects: CreativeObject[], meta: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      format: "lelu.creative.project",
      version: 1,
      generator: "LÉLU creative engine",
      offline: true,
      ...meta,
      objects: objects.map((o) => ({
        id: o.id,
        kind: o.kind,
        name: o.name,
        revision: o.revision,
        location: o.location,
        workspaceId: o.workspaceId,
        roomId: o.roomId ?? null,
        transform: o.transform,
        motion: o.motion,
        visible: o.visible,
        locked: o.locked,
        anchored: o.anchored,
        archived: o.archived,
        components: o.components,
        sockets: o.sockets,
        attachment: o.attachment ?? null,
        absorbedInto: o.absorbedInto ?? null,
        source: o.source,
        data: o.data,
        provenance: o.provenance,
        checks: o.checks,
        history: o.history,
        parts: o.parts.map((p) => ({ id: p.id, label: p.label, componentId: p.componentId, materialId: p.materialId, color: p.color, opacity: p.opacity, thin: p.thin, triangles: Math.floor(p.mesh.indices.length / 3), vertices: p.mesh.positions.length / 3 })),
      })),
    },
    null,
    2,
  );
}

export interface ProjectReport {
  ok: boolean;
  objects: number;
  parts: number;
  components: number;
  identitiesUnique: boolean;
  errors: string[];
}

export function validateProject(json: string): ProjectReport {
  const report: ProjectReport = { ok: false, objects: 0, parts: 0, components: 0, identitiesUnique: true, errors: [] };
  let parsed: { format?: string; objects?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch (error) {
    report.errors.push(`project JSON does not parse: ${(error as Error).message}`);
    return report;
  }
  if (parsed.format !== "lelu.creative.project") report.errors.push("format marker missing");
  const ids = new Set<string>();
  for (const object of parsed.objects ?? []) {
    report.objects += 1;
    const id = String(object.id ?? "");
    if (!id) report.errors.push("an object has no id");
    if (ids.has(id)) {
      report.identitiesUnique = false;
      report.errors.push(`duplicate object id ${id}`);
    }
    ids.add(id);
    const parts = Array.isArray(object.parts) ? object.parts : [];
    const components = Array.isArray(object.components) ? object.components : [];
    report.parts += parts.length;
    report.components += components.length;
    if (parts.length === 0) report.errors.push(`${id} has no geometry`);
    const componentIds = new Set(components.map((c) => String((c as Record<string, unknown>).id)));
    for (const part of parts) {
      const componentId = String((part as Record<string, unknown>).componentId ?? "");
      if (!componentIds.has(componentId)) report.errors.push(`${id}: part ${String((part as Record<string, unknown>).id)} belongs to missing component ${componentId}`);
    }
  }
  report.ok = report.errors.length === 0 && report.objects > 0 && report.identitiesUnique;
  return report;
}
