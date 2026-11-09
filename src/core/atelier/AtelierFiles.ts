/**
 * ==========================================================
 * LÉLU — ATELIER: FILES FROM ONE DESIGN
 *
 *   STL (binary)   one solid, every component
 *   OBJ            one object per component, named by its ID
 *   glTF 2.0       one node per component, named by its ID, with
 *                  its name/material in extras; buffer embedded
 *   DXF (R12)      three orthographic views; one layer per component
 *   SVG drawings   orthographic views with dimensions and ID
 *                  callouts, an exploded assembly, a component /
 *                  wiring map, a manufacturing workflow
 *
 * STEP is not written: a valid AP214/AP242 B-rep writer is not
 * part of this build, and a file that only looks like STEP would
 * be a false claim. The export reports it as unsupported.
 * ==========================================================
 */

import { assemblyOrder, componentBounds, componentMesh, meshBounds, type Bounds, type Mesh } from "./AtelierGeometry";
import type { Component, DesignDirection } from "./AtelierTypes";

const enc = new TextEncoder();
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r2 = (n: number) => Math.round(n * 100) / 100;

export const ATELIER_FORMATS = ["stl", "obj", "gltf", "dxf", "svg-orthographic", "svg-exploded", "svg-wiring", "svg-workflow"] as const;
export type AtelierFormat = (typeof ATELIER_FORMATS)[number];
export const UNSUPPORTED_FORMATS: Record<string, string> = {
  step: "STEP (AP214/AP242) needs a B-rep CAD kernel, which this build does not include; use glTF/OBJ/STL for the mesh, or open the OBJ in a CAD tool to convert.",
  stp: "STEP (AP214/AP242) needs a B-rep CAD kernel, which this build does not include.",
  iges: "IGES is not written by this build.",
};

export function meshesOf(d: DesignDirection, explode = 0): Mesh[] {
  const order = assemblyOrder(d.components);
  return order.map((c, i) => componentMesh(c, { x: 0, y: 0, z: i * explode }));
}

/* ---------------- STL ---------------- */

export function writeStl(d: DesignDirection): Uint8Array {
  const meshes = meshesOf(d);
  const tris = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  const header = enc.encode(`LELU Atelier ${d.id} ${d.name}`.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(header);
  view.setUint32(80, tris, true);
  let o = 84;
  for (const m of meshes) for (let t = 0; t < m.indices.length; t += 3) {
    const i0 = m.indices[t] * 3;
    view.setFloat32(o, m.normals[i0], true); view.setFloat32(o + 4, m.normals[i0 + 1], true); view.setFloat32(o + 8, m.normals[i0 + 2], true);
    o += 12;
    for (let k = 0; k < 3; k += 1) {
      const i = m.indices[t + k] * 3;
      view.setFloat32(o, m.positions[i], true); view.setFloat32(o + 4, m.positions[i + 1], true); view.setFloat32(o + 8, m.positions[i + 2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

/* ---------------- OBJ ---------------- */

export function writeObj(d: DesignDirection): Uint8Array {
  const lines = [`# LÉLU Atelier — ${d.name} (${d.id})`, "# units: millimetres; one object per component, named by its ID"];
  let vBase = 1;
  for (const m of meshesOf(d)) {
    lines.push(`o ${m.id} ${m.name.replace(/\s+/g, "_")}`);
    for (let i = 0; i < m.positions.length; i += 3) lines.push(`v ${r2(m.positions[i])} ${r2(m.positions[i + 1])} ${r2(m.positions[i + 2])}`);
    for (let t = 0; t < m.indices.length; t += 3) lines.push(`f ${m.indices[t] + vBase} ${m.indices[t + 1] + vBase} ${m.indices[t + 2] + vBase}`);
    vBase += m.positions.length / 3;
  }
  return enc.encode(`${lines.join("\n")}\n`);
}

/* ---------------- glTF 2.0 (embedded) ---------------- */

const PALETTE = [[0.49, 0.36, 1], [0.18, 0.72, 0.67], [0.95, 0.65, 0.25], [0.89, 0.34, 0.18], [0.31, 0.65, 0.91], [0.63, 0.32, 0.58], [0.56, 0.7, 0.22], [0.98, 0.36, 0.42]];

function base64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  return Buffer.from(bytes).toString("base64");
}

export function writeGltf(d: DesignDirection, explode = 0): Uint8Array {
  const meshes = meshesOf(d, explode);
  const parts: Uint8Array[] = [];
  let offset = 0;
  const bufferViews: unknown[] = [];
  const accessors: unknown[] = [];
  const gMeshes: unknown[] = [];
  const nodes: unknown[] = [];
  const materials: unknown[] = [];
  const byId = new Map(d.components.map((c) => [c.id, c]));
  meshes.forEach((m, i) => {
    // glTF is metres, Y-up: convert mm, Z-up → Y-up.
    const pos = new Float32Array(m.positions.length);
    const nor = new Float32Array(m.normals.length);
    for (let k = 0; k < m.positions.length; k += 3) {
      pos[k] = m.positions[k] / 1000; pos[k + 1] = m.positions[k + 2] / 1000; pos[k + 2] = -m.positions[k + 1] / 1000;
      nor[k] = m.normals[k]; nor[k + 1] = m.normals[k + 2]; nor[k + 2] = -m.normals[k + 1];
    }
    const idx = new Uint32Array(m.indices);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < pos.length; k += 3) for (let a = 0; a < 3; a += 1) { min[a] = Math.min(min[a], pos[k + a]); max[a] = Math.max(max[a], pos[k + a]); }
    for (const [arr, target] of [[pos, 34962], [nor, 34962], [idx, 34963]] as const) {
      const bytes = new Uint8Array(arr.buffer.slice(0));
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
      parts.push(bytes);
      offset += bytes.length;
      const pad = (4 - (offset % 4)) % 4;
      if (pad) { parts.push(new Uint8Array(pad)); offset += pad; }
    }
    const bv = i * 3;
    accessors.push({ bufferView: bv, componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    accessors.push({ bufferView: bv + 1, componentType: 5126, count: nor.length / 3, type: "VEC3" });
    accessors.push({ bufferView: bv + 2, componentType: 5125, count: idx.length, type: "SCALAR" });
    const c = byId.get(m.id)!;
    materials.push({ name: c.material, pbrMetallicRoughness: { baseColorFactor: [...PALETTE[i % PALETTE.length], 1], metallicFactor: /steel|alumin|copper|brass/i.test(c.material) ? 0.8 : 0.05, roughnessFactor: 0.55 } });
    gMeshes.push({ name: `${m.id} ${m.name}`, primitives: [{ attributes: { POSITION: i * 3, NORMAL: i * 3 + 1 }, indices: i * 3 + 2, material: i }] });
    nodes.push({ name: m.id, mesh: i, extras: { componentId: m.id, name: c.name, material: c.material, quantity: c.quantity } });
  });
  const all = new Uint8Array(offset);
  let p = 0;
  for (const part of parts) { all.set(part, p); p += part.length; }
  const gltf = {
    asset: { version: "2.0", generator: "LÉLU Atelier" },
    extras: { design: d.id, name: d.name, units: "metres (source mm)" },
    scene: 0,
    scenes: [{ name: d.name, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: all.length, uri: `data:application/octet-stream;base64,${base64(all)}` }],
  };
  return enc.encode(JSON.stringify(gltf));
}

/* ---------------- orthographic projection ---------------- */

type View = "front" | "top" | "side";
/** front: x→right, z→up. top: x→right, y→up. side: y→right, z→up. */
function project(b: Bounds, view: View): { x0: number; x1: number; y0: number; y1: number } {
  if (view === "front") return { x0: b.min.x, x1: b.max.x, y0: b.min.z, y1: b.max.z };
  if (view === "top") return { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y };
  return { x0: b.min.y, x1: b.max.y, y0: b.min.z, y1: b.max.z };
}

interface ViewOutline { id: string; kind: "rect" | "circle"; x0: number; x1: number; y0: number; y1: number }

function outlines(components: Component[], view: View): ViewOutline[] {
  return components.map((c) => {
    const p = project(componentBounds(c), view);
    const round = c.shape === "sphere" || (c.shape === "cylinder" && view === "top");
    return { id: c.id, kind: round ? "circle" : "rect", ...p };
  });
}

export interface DrawingMeta { project: string; version: number; level: string; date?: string }

export function writeOrthographicSvg(d: DesignDirection, meta: DrawingMeta): Uint8Array {
  const all = meshBounds(meshesOf(d));
  const W = 1188, H = 840; // A-series landscape proportion, in drawing units
  const views: Array<{ view: View; label: string; ox: number; oy: number }> = [
    // Third-angle-style sheet: front bottom-left, top above it, right side
    // upper-right; the callout list and title block take the lower right.
    { view: "front", label: "FRONT", ox: 60, oy: 440 },
    { view: "side", label: "RIGHT SIDE", ox: 640, oy: 60 },
    { view: "top", label: "TOP", ox: 60, oy: 60 },
  ];
  const span = Math.max(all.max.x - all.min.x, all.max.y - all.min.y, all.max.z - all.min.z, 1);
  const scale = Math.min(1, 280 / span) >= 1 ? Math.floor(280 / span) || 1 : 280 / span;
  const parts: string[] = [];
  for (const v of views) {
    const b = project(all, v.view);
    const tx = (x: number) => v.ox + 40 + (x - b.x0) * scale;
    const ty = (y: number) => v.oy + 320 - (y - b.y0) * scale;
    parts.push(`<g class="view" data-view="${v.view}"><text x="${v.ox}" y="${v.oy + 12}" class="lbl">${v.label}</text>`);
    for (const o of outlines(d.components, v.view)) {
      const x = tx(o.x0), y = ty(o.y1), w = (o.x1 - o.x0) * scale, h = (o.y1 - o.y0) * scale;
      parts.push(o.kind === "circle"
        ? `<ellipse cx="${r2(x + w / 2)}" cy="${r2(y + h / 2)}" rx="${r2(w / 2)}" ry="${r2(h / 2)}" class="part" data-component="${o.id}"/>`
        : `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" class="part" data-component="${o.id}"/>`);
    }
    // Overall dimensions.
    const wmm = r2(b.x1 - b.x0), hmm = r2(b.y1 - b.y0);
    const xa = tx(b.x0), xb = tx(b.x1), ya = ty(b.y0), yb = ty(b.y1);
    parts.push(`<line x1="${r2(xa)}" y1="${r2(ya + 24)}" x2="${r2(xb)}" y2="${r2(ya + 24)}" class="dim"/><text x="${r2((xa + xb) / 2)}" y="${r2(ya + 40)}" class="dimt" text-anchor="middle">${wmm} mm</text>`);
    parts.push(`<line x1="${r2(xb + 24)}" y1="${r2(ya)}" x2="${r2(xb + 24)}" y2="${r2(yb)}" class="dim"/><text x="${r2(xb + 30)}" y="${r2((ya + yb) / 2)}" class="dimt">${hmm} mm</text>`);
    parts.push("</g>");
  }
  // Callouts on the front view, one balloon per component ID.
  const fv = views[0], fb = project(all, "front");
  d.components.forEach((c, i) => {
    const o = project(componentBounds(c), "front");
    const cx = fv.ox + 40 + ((o.x0 + o.x1) / 2 - fb.x0) * scale, cy = fv.oy + 320 - ((o.y0 + o.y1) / 2 - fb.y0) * scale;
    const bx = 700, by = 470 + i * 26;
    parts.push(`<line x1="${r2(cx)}" y1="${r2(cy)}" x2="${bx - 14}" y2="${by}" class="leader"/><circle cx="${bx}" cy="${by}" r="13" class="balloon"/><text x="${bx}" y="${by + 4}" class="bt" text-anchor="middle">${esc(c.id.replace(/^C-?/, ""))}</text><text x="${bx + 20}" y="${by + 4}" class="ct" data-callout="${esc(c.id)}">${esc(c.id)} ${esc(c.name)}</text>`);
  });
  const date = meta.date ?? new Date().toISOString().slice(0, 10);
  const titleBlock = `<g class="title"><rect x="${W - 420}" y="${H - 130}" width="400" height="110" class="tb"/><text x="${W - 410}" y="${H - 104}" class="tbt">${esc(meta.project)}</text><text x="${W - 410}" y="${H - 82}">${esc(d.id)} · ${esc(d.name)} · design v${meta.version}</text><text x="${W - 410}" y="${H - 62}">Units mm · scale ${scale >= 1 ? `${scale}:1` : `1:${r2(1 / scale)}`} · ${esc(date)}</text><text x="${W - 410}" y="${H - 40}" class="warn">Evidence: ${esc(meta.level)} — not for manufacture until verified</text></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif" font-size="13"><style>.part{fill:#efeafd;stroke:#2a2440;stroke-width:1.4}.dim{stroke:#c0392b;stroke-width:1}.dimt{fill:#c0392b;font-size:12px}.lbl{font-weight:700;letter-spacing:.1em}.leader{stroke:#555;stroke-width:.8}.balloon{fill:#fff;stroke:#2a2440}.bt{font-size:11px;font-weight:700}.ct{font-size:12px}.tb{fill:none;stroke:#2a2440;stroke-width:1.4}.tbt{font-weight:700;font-size:15px}.warn{fill:#b03a2e;font-size:11.5px}</style><rect width="${W}" height="${H}" fill="#fff"/><rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="#2a2440" stroke-width="2"/>${parts.join("")}${titleBlock}</svg>`;
  return enc.encode(svg);
}

/* ---------------- exploded isometric ---------------- */

export function writeExplodedSvg(d: DesignDirection, meta: DrawingMeta): Uint8Array {
  const order = assemblyOrder(d.components);
  const span = Math.max(...d.components.map((c) => Math.max(c.size.width, c.size.depth, c.size.height)), 1);
  const gap = span * 0.6;
  const iso = (x: number, y: number, z: number) => ({ X: (x - y) * 0.866, Y: -(z + (x + y) * 0.5) });
  const faces: string[] = [];
  const labels: string[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pts: Array<{ X: number; Y: number }> = [];
  order.forEach((c, i) => {
    const b = componentBounds(c);
    const dz = i * gap;
    const corner = (x: number, y: number, z: number) => { const p = iso(x, y, z + dz); pts.push(p); return p; };
    const P = (xs: number[], ys: number[], zs: number[]) => xs.map((x, k) => corner(x, ys[k], zs[k]));
    const { min: a, max: z } = b;
    const top = P([a.x, z.x, z.x, a.x], [a.y, a.y, z.y, z.y], [z.z, z.z, z.z, z.z]);
    // Y = -(z + (x + y) / 2): larger x + y is higher (farther) on the sheet, so the
    // viewer is on the -x -y side and the visible faces are y = min, x = min and the top.
    const left = P([a.x, z.x, z.x, a.x], [a.y, a.y, a.y, a.y], [a.z, a.z, z.z, z.z]);
    const right = P([a.x, a.x, a.x, a.x], [a.y, z.y, z.y, a.y], [a.z, a.z, z.z, z.z]);
    const color = PALETTE[i % PALETTE.length].map((v) => Math.round(v * 255));
    const shade = (k: number) => `rgb(${color.map((v) => Math.round(v * k + 255 * (1 - k) * 0.35)).join(",")})`;
    for (const [poly, k] of [[left, 0.75], [right, 0.6], [top, 0.95]] as const) {
      faces.push(`<polygon points="${poly.map((p) => `${r2(p.X)},${r2(p.Y)}`).join(" ")}" fill="${shade(k)}" stroke="#2a2440" stroke-width="0.6" data-component="${c.id}"/>`);
    }
    const anchor = iso(z.x, (a.y + z.y) / 2, (a.z + z.z) / 2 + dz);
    labels.push(`<g data-callout="${esc(c.id)}"><line x1="${r2(anchor.X)}" y1="${r2(anchor.Y)}" x2="${r2(anchor.X + span * 0.9)}" y2="${r2(anchor.Y)}" stroke="#555" stroke-width="0.6"/><text x="${r2(anchor.X + span * 0.95)}" y="${r2(anchor.Y + 4)}" font-size="${r2(span * 0.11)}">${esc(c.id)} ${esc(c.name)} ×${c.quantity}</text></g>`);
  });
  for (const p of pts) { minX = Math.min(minX, p.X); maxX = Math.max(maxX, p.X); minY = Math.min(minY, p.Y); maxY = Math.max(maxY, p.Y); }
  const pad = span * 0.4;
  const vbW = maxX - minX + span * 3.2 + pad * 2, vbH = maxY - minY + pad * 2 + span * 0.4;
  const title = `<text x="${r2(minX - pad)}" y="${r2(minY - pad + span * 0.18)}" font-size="${r2(span * 0.085)}" font-weight="700">${esc(meta.project)} — ${esc(d.name)}: exploded assembly, parts as bounding boxes (v${meta.version}, ${esc(meta.level)})</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r2(minX - pad)} ${r2(minY - pad)} ${r2(vbW)} ${r2(vbH)}" width="1100" height="${Math.round((1100 * vbH) / vbW)}" font-family="Helvetica, Arial, sans-serif"><rect x="${r2(minX - pad)}" y="${r2(minY - pad)}" width="${r2(vbW)}" height="${r2(vbH)}" fill="#fff"/>${title}${faces.join("")}${labels.join("")}</svg>`;
  return enc.encode(svg);
}

/* ---------------- component / wiring map ---------------- */

export function writeWiringSvg(d: DesignDirection, meta: DrawingMeta): Uint8Array {
  const comps = d.components;
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(comps.length))));
  const pos = new Map(comps.map((c, i) => [c.id, { x: 60 + (i % cols) * 250, y: 90 + Math.floor(i / cols) * 140 }]));
  const W = 60 + cols * 250, H = 120 + Math.ceil(comps.length / cols) * 140;
  const wires: string[] = [];
  const signals: string[] = [];
  for (const c of comps) for (const w of c.connects ?? []) {
    const a = pos.get(c.id), b = pos.get(w.to);
    if (!a || !b) continue;
    const color = /gnd|ground|-/i.test(w.signal) ? "#2a2440" : /\+|vcc|vbat|power|v\b/i.test(w.signal) ? "#c0392b" : "#2f7fd1";
    // Leave from the side of the box that faces the other one.
    let x1: number, y1: number, x2: number, y2: number, c1: string, c2: string;
    if (b.x >= a.x + 180) { x1 = a.x + 180; y1 = a.y + 30; x2 = b.x; y2 = b.y + 30; c1 = `${x1 + 40} ${y1}`; c2 = `${x2 - 40} ${y2}`; }
    else if (b.x + 180 <= a.x) { x1 = a.x; y1 = a.y + 30; x2 = b.x + 180; y2 = b.y + 30; c1 = `${x1 - 40} ${y1}`; c2 = `${x2 + 40} ${y2}`; }
    else if (b.y > a.y) { x1 = a.x + 90; y1 = a.y + 60; x2 = b.x + 90; y2 = b.y; c1 = `${x1} ${y1 + 30}`; c2 = `${x2} ${y2 - 30}`; }
    else { x1 = a.x + 90; y1 = a.y; x2 = b.x + 90; y2 = b.y + 60; c1 = `${x1} ${y1 - 30}`; c2 = `${x2} ${y2 + 30}`; }
    wires.push(`<path d="M${x1} ${y1} C ${c1}, ${c2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" data-wire="${esc(c.id)}-${esc(w.to)}"/>`);
    signals.push(`<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2 - 6}" font-size="11" fill="${color}" text-anchor="middle">${esc(w.signal)}</text>`);
  }
  const boxes = comps.map((c) => {
    const p = pos.get(c.id)!;
    return `<g data-component="${esc(c.id)}"><rect x="${p.x}" y="${p.y}" width="180" height="60" rx="10" fill="#efeafd" stroke="#2a2440"/><text x="${p.x + 10}" y="${p.y + 24}" font-weight="700" font-size="13">${esc(c.id)}</text><text x="${p.x + 10}" y="${p.y + 44}" font-size="12">${esc(c.name.slice(0, 24))}</text></g>`;
  });
  const none = wires.length === 0 ? `<text x="60" y="${H - 20}" font-size="12" fill="#6b6480">No electrical connections are defined for this direction; this is a component map.</text>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/><text x="60" y="44" font-size="16" font-weight="700">${esc(meta.project)} — ${esc(d.name)}: ${wires.length ? "wiring diagram" : "component map"} (v${meta.version})</text>${wires.join("")}${boxes.join("")}${signals.join("")}${none}</svg>`;
  return enc.encode(svg);
}

/* ---------------- manufacturing workflow ---------------- */

export function workflowSteps(d: DesignDirection): Array<{ n: number; title: string; components: string[] }> {
  const fab = d.components.filter((c) => (c.make ?? "fabricate") === "fabricate");
  const buy = d.components.filter((c) => c.make === "buy");
  const steps: Array<{ n: number; title: string; components: string[] }> = [];
  if (buy.length) steps.push({ n: 0, title: "Source purchased parts", components: buy.map((c) => c.id) });
  if (fab.length) steps.push({ n: 0, title: "Fabricate parts", components: fab.map((c) => c.id) });
  steps.push({ n: 0, title: "Inspect parts against drawing tolerances", components: d.components.map((c) => c.id) });
  for (const c of assemblyOrder(d.components)) steps.push({ n: 0, title: `Fit ${c.id} ${c.name}`, components: [c.id] });
  if (d.components.some((c) => c.connects?.length)) steps.push({ n: 0, title: "Wire and test electrical connections", components: d.components.filter((c) => c.connects?.length).map((c) => c.id) });
  steps.push({ n: 0, title: "Final quality-control inspection", components: d.components.map((c) => c.id) });
  return steps.map((s, i) => ({ ...s, n: i + 1 }));
}

export function writeWorkflowSvg(d: DesignDirection, meta: DrawingMeta): Uint8Array {
  const steps = workflowSteps(d);
  const W = 760, rowH = 64, H = 90 + steps.length * rowH;
  const rows = steps.map((s, i) => {
    const y = 70 + i * rowH;
    return `<g data-step="${s.n}"><rect x="60" y="${y}" width="640" height="44" rx="10" fill="#efeafd" stroke="#2a2440"/><text x="80" y="${y + 27}" font-size="13"><tspan font-weight="700">${s.n}.</tspan> ${esc(s.title)}</text><text x="690" y="${y + 27}" font-size="11" text-anchor="end" fill="#6b6480">${esc(s.components.slice(0, 6).join(", "))}${s.components.length > 6 ? " …" : ""}</text>${i < steps.length - 1 ? `<path d="M380 ${y + 44} L380 ${y + rowH} M374 ${y + rowH - 8} L380 ${y + rowH} L386 ${y + rowH - 8}" stroke="#2a2440" fill="none"/>` : ""}</g>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/><text x="60" y="44" font-size="16" font-weight="700">${esc(meta.project)} — ${esc(d.name)}: manufacturing workflow (v${meta.version})</text>${rows.join("")}</svg>`;
  return enc.encode(svg);
}

/* ---------------- DXF (R12, ASCII) ---------------- */

export function writeDxf(d: DesignDirection): Uint8Array {
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  const all = meshBounds(meshesOf(d));
  const spanX = all.max.x - all.min.x, spanY = all.max.y - all.min.y;
  const offsets: Record<View, { dx: number; dy: number }> = {
    front: { dx: 0, dy: 0 },
    side: { dx: spanX + 60, dy: 0 },
    top: { dx: 0, dy: (all.max.z - all.min.z) + 60 },
  };
  const layers = d.components.map((c) => c.id.replace(/[^A-Za-z0-9_-]/g, "_"));
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1009"); g(9, "$INSUNITS"); g(70, 4); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES"); g(0, "TABLE"); g(2, "LAYER"); g(70, layers.length + 1);
  for (const [i, name] of ["ANNOTATION", ...layers].entries()) { g(0, "LAYER"); g(2, name); g(70, 0); g(62, (i % 7) + 1); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => { g(0, "LINE"); g(8, layer); g(10, r2(x1)); g(20, r2(y1)); g(30, 0); g(11, r2(x2)); g(21, r2(y2)); g(31, 0); };
  const text = (layer: string, x: number, y: number, h: number, t: string) => { g(0, "TEXT"); g(8, layer); g(10, r2(x)); g(20, r2(y)); g(30, 0); g(40, r2(h)); g(1, t.replace(/[^\x20-\x7e]/g, "?")); };
  for (const view of ["front", "side", "top"] as View[]) {
    const off = offsets[view];
    const base = project(all, view);
    text("ANNOTATION", off.dx + base.x0, off.dy + base.y1 + 12, 6, view.toUpperCase());
    for (const [i, o] of outlines(d.components, view).entries()) {
      const layer = layers[i];
      const x0 = o.x0 + off.dx, x1 = o.x1 + off.dx, y0 = o.y0 + off.dy, y1 = o.y1 + off.dy;
      if (o.kind === "circle") {
        g(0, "CIRCLE"); g(8, layer); g(10, r2((x0 + x1) / 2)); g(20, r2((y0 + y1) / 2)); g(30, 0); g(40, r2((x1 - x0) / 2));
      } else {
        line(layer, x0, y0, x1, y0); line(layer, x1, y0, x1, y1); line(layer, x1, y1, x0, y1); line(layer, x0, y1, x0, y0);
      }
      if (view === "front") text(layer, (x0 + x1) / 2, (y0 + y1) / 2, 4, d.components[i].id);
    }
  }
  text("ANNOTATION", 0, -20, 5, `${d.id} ${d.name} - units mm - overall ${r2(spanX)} x ${r2(spanY)} x ${r2(all.max.z - all.min.z)}`);
  g(0, "ENDSEC"); g(0, "EOF");
  return enc.encode(`${out.join("\n")}\n`);
}

export function writeAtelierFile(d: DesignDirection, format: AtelierFormat, meta: DrawingMeta): { bytes: Uint8Array; mime: string; ext: string } {
  switch (format) {
    case "stl": return { bytes: writeStl(d), mime: "model/stl", ext: "stl" };
    case "obj": return { bytes: writeObj(d), mime: "model/obj", ext: "obj" };
    case "gltf": return { bytes: writeGltf(d), mime: "model/gltf+json", ext: "gltf" };
    case "dxf": return { bytes: writeDxf(d), mime: "image/vnd.dxf", ext: "dxf" };
    case "svg-orthographic": return { bytes: writeOrthographicSvg(d, meta), mime: "image/svg+xml", ext: "orthographic.svg" };
    case "svg-exploded": return { bytes: writeExplodedSvg(d, meta), mime: "image/svg+xml", ext: "exploded.svg" };
    case "svg-wiring": return { bytes: writeWiringSvg(d, meta), mime: "image/svg+xml", ext: "wiring.svg" };
    case "svg-workflow": return { bytes: writeWorkflowSvg(d, meta), mime: "image/svg+xml", ext: "workflow.svg" };
  }
}
