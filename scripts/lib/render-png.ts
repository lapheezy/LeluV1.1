/**
 * ==========================================================
 * LÉLU — CPU RENDERER → PNG
 *
 * High-quality previews that do not need a browser, a GPU or
 * any external service: a small software rasteriser with a
 * depth buffer, three-point studio lighting, Blinn-Phong
 * specular, sheen, transmission blending and 2× supersampling,
 * written straight to PNG with Node's zlib.
 *
 * This is a preview renderer, not Cycles. It exists so every
 * construction step can be looked at immediately; the
 * workstation render job is separate and is never claimed to
 * have run here.
 * ==========================================================
 */

import { deflateSync } from "node:zlib";

/* ---------------- PNG ---------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** RGB (no alpha) 8-bit PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))), chunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}

/* ---------------- colour ---------------- */

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const linear = (c: RGB): RGB => [toLinear(c[0]), toLinear(c[1]), toLinear(c[2])];

/* ---------------- scene ---------------- */

export interface RenderMaterial {
  baseColor: string;
  roughness: number;
  metallic: number;
  sheen: number;
  sheenColor: string;
  transmission: number;
  opacity: number;
}

export interface RenderPart {
  id: string;
  /** mm, z-up. */
  positions: number[];
  indices: number[];
  material: RenderMaterial;
  opacity: number;
  thin: boolean;
}

export interface Camera {
  targetMm: [number, number, number];
  distanceMm: number;
  azimuthDeg: number;
  elevationDeg: number;
  fovDeg?: number;
}

export interface RenderOptions {
  width: number;
  height: number;
  background?: string;
  /** 0 = none, 1 = full studio floor. */
  floor?: number;
  supersample?: number;
  exposure?: number;
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const KEY = norm([0.45, -0.75, 0.85]);
const FILL = norm([-0.8, -0.35, 0.25]);
const RIM = norm([0.1, 0.9, 0.35]);
const KEY_COLOR: RGB = [1.0, 0.96, 0.9];
const FILL_COLOR: RGB = [0.62, 0.72, 0.95];
const RIM_COLOR: RGB = [1.0, 0.88, 0.72];

interface Frame {
  eye: number[];
  right: number[];
  up: number[];
  forward: number[];
  focal: number;
  cx: number;
  cy: number;
}

function frameFor(cam: Camera, width: number, height: number): Frame {
  const az = (cam.azimuthDeg * Math.PI) / 180;
  const el = (cam.elevationDeg * Math.PI) / 180;
  const dir = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  const target = cam.targetMm;
  const eye = [target[0] + dir[0] * cam.distanceMm, target[1] + dir[1] * cam.distanceMm, target[2] + dir[2] * cam.distanceMm];
  const forward = norm(sub(target, eye));
  const right = norm(cross(forward, [0, 0, 1]));
  const up = norm(cross(right, forward));
  const fov = ((cam.fovDeg ?? 32) * Math.PI) / 180;
  const focal = (Math.max(width, height) / 2) / Math.tan(fov / 2);
  return { eye, right, up, forward, focal, cx: width / 2, cy: height / 2 };
}

interface Target {
  width: number;
  height: number;
  color: Float32Array;
  depth: Float32Array;
}

function shade(material: RenderMaterial, n: number[], view: number[], base: RGB): RGB {
  const nDotL = Math.max(0, dot(n, KEY));
  const fill = Math.max(0, dot(n, FILL)) * 0.4;
  const rim = Math.max(0, dot(n, RIM)) * 0.45;
  const half = norm([KEY[0] + view[0], KEY[1] + view[1], KEY[2] + view[2]]);
  const shininess = Math.min(2000, 2 / Math.max(0.004, material.roughness ** 4));
  // Dielectrics reflect ~4% at normal incidence; only metals are broadly
  // reflective. Getting this wrong is what turns dark velvet into white plastic.
  const specStrength = (0.045 + material.metallic * 1.6) * nDotL * (1 - material.roughness * 0.55);
  const spec = Math.max(0, dot(n, half)) ** shininess * specStrength;
  const fres = (1 - Math.max(0, dot(n, view))) ** 4;
  const sheenRgb = linear(hexToRgb(material.sheenColor));
  const sheen = fres * material.sheen * 0.55;
  const amb = 0.13 + 0.07 * Math.max(0, n[2]);
  const out: RGB = [0, 0, 0];
  for (let k = 0; k < 3; k += 1) {
    const diffuse = base[k] * (amb + nDotL * KEY_COLOR[k] + fill * FILL_COLOR[k] + rim * RIM_COLOR[k]);
    const metalTint = 0.6 + base[k] * 0.8;
    out[k] = diffuse + spec * metalTint + sheen * sheenRgb[k];
  }
  return out;
}

/** Render one camera into a float colour buffer (linear, then tone-mapped on export). */
function renderView(parts: RenderPart[], cam: Camera, opts: RenderOptions, backgroundLum: number): { color: Uint8Array; width: number; height: number } {
  const ss = Math.max(1, Math.min(3, opts.supersample ?? 2));
  const width = opts.width * ss;
  const height = opts.height * ss;
  const frame = frameFor(cam, width, height);
  const color = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height).fill(Infinity);

  // Background: a soft vertical studio gradient with a warm centre.
  const bg = linear(hexToRgb(opts.background ?? "#15131c"));
  for (let y = 0; y < height; y += 1) {
    const t = y / height;
    for (let x = 0; x < width; x += 1) {
      const u = x / width - 0.5;
      const v = t - 0.45;
      const glow = Math.max(0, 1 - Math.hypot(u * 1.15, v) * 1.7) ** 2;
      const i = (y * width + x) * 3;
      color[i] = bg[0] + glow * backgroundLum * 0.22;
      color[i + 1] = bg[1] + glow * backgroundLum * 0.2;
      color[i + 2] = bg[2] + glow * backgroundLum * 0.18;
    }
  }

  const project = (p: Float64Array | number[], i: number) => {
    const vx = p[i] - frame.eye[0], vy = p[i + 1] - frame.eye[1], vz = p[i + 2] - frame.eye[2];
    const x = dot([vx, vy, vz], frame.right);
    const y = dot([vx, vy, vz], frame.up);
    const z = dot([vx, vy, vz], frame.forward);
    return { x, y, z, sx: frame.cx + (x * frame.focal) / Math.max(1e-6, z), sy: frame.cy - (y * frame.focal) / Math.max(1e-6, z) };
  };

  const drawPart = (part: RenderPart, isTransparent: boolean) => {
    const base = linear(hexToRgb(part.material.baseColor));
    const p = part.positions;
    const alpha = Math.max(0, Math.min(1, part.opacity * (isTransparent ? 1 : 1)));
    const tris = part.indices.length / 3;
    const order: number[] = [];
    for (let t = 0; t < tris; t += 1) order.push(t);
    // Draw back-to-front for transparency so the layers read correctly.
    if (isTransparent) {
      const centre = (t: number) => {
        let z = 0;
        for (let k = 0; k < 3; k += 1) {
          const idx = part.indices[t * 3 + k] * 3;
          z += project(p, idx).z;
        }
        return z / 3;
      };
      order.sort((a, b) => centre(b) - centre(a));
    }
    for (const t of order) {
      const i0 = part.indices[t * 3] * 3, i1 = part.indices[t * 3 + 1] * 3, i2 = part.indices[t * 3 + 2] * 3;
      const a = project(p, i0), b = project(p, i1), c = project(p, i2);
      if (a.z <= 1 || b.z <= 1 || c.z <= 1) continue;
      const area = (b.sx - a.sx) * (c.sy - a.sy) - (c.sx - a.sx) * (b.sy - a.sy);
      if (Math.abs(area) < 1e-9) continue;
      const nWorld = norm(cross([p[i1] - p[i0], p[i1 + 1] - p[i0 + 1], p[i1 + 2] - p[i0 + 2]], [p[i2] - p[i0], p[i2 + 1] - p[i0 + 1], p[i2 + 2] - p[i0 + 2]]));
      const centre = [(p[i0] + p[i1] + p[i2]) / 3, (p[i0 + 1] + p[i1 + 1] + p[i2 + 1]) / 3, (p[i0 + 2] + p[i1 + 2] + p[i2 + 2]) / 3];
      const view = norm(sub(frame.eye, centre));
      let n = nWorld;
      if (dot(n, view) < 0) {
        if (!part.thin) continue; // backface cull for solids
        n = [-n[0], -n[1], -n[2]];
      }
      const lit = shade(part.material, n, view, base);
      const minX = Math.max(0, Math.floor(Math.min(a.sx, b.sx, c.sx)));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(a.sx, b.sx, c.sx)));
      const minY = Math.max(0, Math.floor(Math.min(a.sy, b.sy, c.sy)));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(a.sy, b.sy, c.sy)));
      if (maxX < minX || maxY < minY) continue;
      const inv = 1 / area;
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const w0 = ((b.sx - x) * (c.sy - y) - (c.sx - x) * (b.sy - y)) * inv;
          const w1 = ((c.sx - x) * (a.sy - y) - (a.sx - x) * (c.sy - y)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
          const z = w0 * a.z + w1 * b.z + w2 * c.z;
          const idx = y * width + x;
          if (z >= depth[idx]) continue;
          if (isTransparent) {
            for (let k = 0; k < 3; k += 1) color[idx * 3 + k] = color[idx * 3 + k] * (1 - alpha) + lit[k] * alpha;
          } else {
            depth[idx] = z;
            for (let k = 0; k < 3; k += 1) color[idx * 3 + k] = lit[k];
          }
        }
      }
    }
  };

  const opaque = parts.filter((x) => x.opacity >= 0.98);
  const transparent = parts.filter((x) => x.opacity < 0.98);
  for (const part of opaque) drawPart(part, false);
  for (const part of transparent) drawPart(part, true);

  // Downsample with a box filter (the actual anti-aliasing).
  const out = new Uint8Array(opts.width * opts.height * 3);
  const exposure = opts.exposure ?? 1;
  for (let y = 0; y < opts.height; y += 1) {
    for (let x = 0; x < opts.width; x += 1) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < ss; dy += 1) for (let dx = 0; dx < ss; dx += 1) {
        const i = ((y * ss + dy) * width + (x * ss + dx)) * 3;
        r += color[i]; g += color[i + 1]; b += color[i + 2];
      }
      const n = ss * ss;
      const map = (v: number) => {
        const t = (v / n) * exposure;
        const tm = (t * (2.51 * t + 0.03)) / (t * (2.43 * t + 0.59) + 0.14); // ACES-ish curve
        return Math.max(0, Math.min(255, Math.round(toSrgb(tm) * 255)));
      };
      const o = (y * opts.width + x) * 3;
      out[o] = map(r); out[o + 1] = map(g); out[o + 2] = map(b);
    }
  }
  return { color: out, width: opts.width, height: opts.height };
}

/** One image from one camera. */
export function renderPng(parts: RenderPart[], cam: Camera, opts: RenderOptions): { png: Uint8Array; width: number; height: number } {
  const view = renderView(parts, cam, opts, opts.floor ?? 0.5);
  return { png: encodePng(view.width, view.height, view.color), width: view.width, height: view.height };
}

/**
 * A contact sheet: each camera in its own cell, composited into one PNG.
 * This is how a multi-view is shown without a browser.
 */
export function renderSheet(
  parts: RenderPart[],
  cameras: Camera[],
  cell: { width: number; height: number },
  cols: number,
  opts: Omit<RenderOptions, "width" | "height"> = {},
): { png: Uint8Array; width: number; height: number } {
  const rows = Math.ceil(cameras.length / cols);
  const width = cell.width * cols;
  const height = cell.height * rows;
  const sheet = new Uint8Array(width * height * 3);
  cameras.forEach((cam, i) => {
    const view = renderView(parts, cam, { ...opts, width: cell.width, height: cell.height }, opts.floor ?? 0.5);
    const cx = (i % cols) * cell.width;
    const cy = Math.floor(i / cols) * cell.height;
    for (let y = 0; y < cell.height; y += 1) {
      const src = y * cell.width * 3;
      const dst = ((cy + y) * width + cx) * 3;
      sheet.set(view.color.subarray(src, src + cell.width * 3), dst);
    }
  });
  return { png: encodePng(width, height, sheet), width, height };
}

/**
 * A contact sheet where each cell has its own scene and camera — how several
 * garments are compared side by side without compositing encoded PNGs.
 */
export function renderCells(
  cells: Array<{ parts: RenderPart[]; camera: Camera }>,
  cell: { width: number; height: number },
  cols: number,
  opts: Omit<RenderOptions, "width" | "height"> = {},
): { png: Uint8Array; width: number; height: number } {
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const width = cell.width * cols;
  const height = cell.height * rows;
  const sheet = new Uint8Array(width * height * 3);
  cells.forEach((entry, i) => {
    const view = renderView(entry.parts, entry.camera, { ...opts, width: cell.width, height: cell.height }, opts.floor ?? 0.5);
    const cx = (i % cols) * cell.width;
    const cy = Math.floor(i / cols) * cell.height;
    for (let y = 0; y < cell.height; y += 1) {
      const src = y * cell.width * 3;
      sheet.set(view.color.subarray(src, src + cell.width * 3), ((cy + y) * width + cx) * 3);
    }
  });
  return { png: encodePng(width, height, sheet), width, height };
}

/** Camera that frames a bounding box of mm coordinates comfortably. */
export function framingCamera(positions: number[][], azimuthDeg: number, elevationDeg: number, pad = 1.18): Camera {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of positions) for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]); maxZ = Math.max(maxZ, p[i + 2]);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const radius = Math.max(1, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  // 4.4 puts the whole bounding sphere inside a 30° field with a little air.
  return { targetMm: [cx, cy, cz], distanceMm: radius * 4.4 * pad, azimuthDeg, elevationDeg, fovDeg: 30 };
}

/* ---------------- 2D pattern sheet ---------------- */

export interface FlatPiece {
  id: string;
  net: Array<[number, number]>;
  cut: Array<[number, number]>;
  grainline: { a: [number, number]; b: [number, number] };
  notches: Array<[number, number]>;
}

export interface PatternSheetOptions {
  width: number;
  height: number;
  background?: string;
  columns?: number;
  /** Draw the seam allowance outline. */
  allowance?: boolean;
}

/**
 * A pattern sheet as a PNG: every piece at a common scale, seam allowance
 * dashed, grainline with an arrowhead, notches as ticks.
 */
export function renderPatternSheet(pieces: FlatPiece[], opts: PatternSheetOptions): { png: Uint8Array; width: number; height: number } {
  const width = opts.width;
  const height = opts.height;
  const color = new Uint8Array(width * height * 3);
  const bg = hexToRgb(opts.background ?? "#101820");
  for (let i = 0; i < width * height; i += 1) {
    color[i * 3] = Math.round(bg[0] * 255);
    color[i * 3 + 1] = Math.round(bg[1] * 255);
    color[i * 3 + 2] = Math.round(bg[2] * 255);
  }
  if (pieces.length === 0) return { png: encodePng(width, height, color), width, height };

  const columns = Math.max(1, opts.columns ?? Math.min(4, pieces.length));
  const rows = Math.ceil(pieces.length / columns);
  const cellW = width / columns;
  const cellH = height / rows;

  const px = (x: number, y: number) => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    const i = (yi * width + xi) * 3;
    color[i] = 240; color[i + 1] = 236; color[i + 2] = 226;
  };
  const line = (a: [number, number], b: [number, number], step = 0.5) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= steps; i += 1) px(a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps);
  };
  const dashed = (pts: Array<[number, number]>, on = 5, off = 4) => {
    let draw = true, count = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(len));
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        if (draw) pixelDashed(a, b, t);
        count += 1;
        if (count > (draw ? on : off)) { draw = !draw; count = 0; }
      }
    }
  };
  const pixelDashed = (a: [number, number], b: [number, number], t: number) => px(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);

  pieces.forEach((piece, i) => {
    const cx = (i % columns) * cellW + cellW / 2;
    const cy = Math.floor(i / columns) * cellH + cellH / 2;
    const all = [...piece.net, ...piece.cut];
    const minX = Math.min(...all.map((p) => p[0]));
    const maxX = Math.max(...all.map((p) => p[0]));
    const minY = Math.min(...all.map((p) => p[1]));
    const maxY = Math.max(...all.map((p) => p[1]));
    const scale = Math.min((cellW * 0.78) / Math.max(1, maxX - minX), (cellH * 0.78) / Math.max(1, maxY - minY));
    const map = (p: [number, number]): [number, number] => [cx + (p[0] - (minX + maxX) / 2) * scale, cy - (p[1] - (minY + maxY) / 2) * scale];
    const net = piece.net.map(map);
    const cut = piece.cut.map(map);
    if (opts.allowance !== false) dashed(cut);
    for (let k = 0; k < net.length; k += 1) line(net[k], net[(k + 1) % net.length], 0.6);
    const ga = map([piece.grainline.a[0], piece.grainline.a[1]]);
    const gb = map([piece.grainline.b[0], piece.grainline.b[1]]);
    line(ga, gb, 0.6);
    // Arrowheads point along the grain.
    const ang = Math.atan2(gb[1] - ga[1], gb[0] - ga[0]);
    const head = 7;
    line(gb, [gb[0] - head * Math.cos(ang - 0.4), gb[1] - head * Math.sin(ang - 0.4)], 0.6);
    line(gb, [gb[0] - head * Math.cos(ang + 0.4), gb[1] - head * Math.sin(ang + 0.4)], 0.6);
    for (const notch of piece.notches) {
      const n = map(notch);
      line([n[0] - 4, n[1] - 4], [n[0] + 4, n[1] + 4], 0.8);
      line([n[0] - 4, n[1] + 4], [n[0] + 4, n[1] - 4], 0.8);
    }
    // Cell separator.
    if (i % columns !== columns - 1) line([(i % columns) * cellW + cellW, 0], [(i % columns) * cellW + cellW, height], 0.9);
  });
  return { png: encodePng(width, height, color), width, height };
}
