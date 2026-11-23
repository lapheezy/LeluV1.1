/**
 * ==========================================================
 * TEMPORAL STUDIO — MISSION 3 IMAGE RENDERER
 *
 * Turns NRE voxel sets into PNGs with no dependencies at all: an
 * isometric painter's-algorithm rasteriser plus a minimal PNG encoder
 * (node:zlib for the deflate stream, CRC32 written by hand).
 *
 * These are pictures of NUMERICAL STATE — the cells the engine actually
 * holds — not of a reconstructed character. Nothing here implies a
 * model ran; Experiment A is still blocked without a worker.
 * ==========================================================
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createGrid, denseIndexOf, occupancyMask, voxelCount } from "../../src/temporal/nre/voxels.ts";
import { buildSparseVoxels, occupancyKeySet, transformVoxels, withConfidence, unionVoxels } from "../../src/temporal/nre/voxels.ts";
import { irregularBlob, sphereShell, translationMatrix } from "../../src/temporal/nre/shapes.ts";
import { filledBox } from "../../src/temporal/nre/shapes.ts";
import { boxShell } from "../../src/temporal/nre/shapes.ts";
import { meshFromVoxels, voxelizeMesh } from "../../src/temporal/nre/geometry.ts";
import type { SparseVoxels } from "../../src/temporal/nre/types.ts";

type RGBA = [number, number, number, number];

const BACKGROUND: RGBA = [11, 16, 32, 255];
const PANEL_BG: RGBA = [16, 22, 40, 255];

/* ---------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [chunk("IHDR", header), chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))), chunk("IEND", new Uint8Array(0))];
  const total = signature.length + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  out.set(signature, offset);
  offset += signature.length;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/* -------------------------------- raster --------------------------------- */

class Canvas {
  readonly pixels: Uint8Array;
  constructor(readonly width: number, readonly height: number, background: RGBA) {
    this.pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.pixels[i * 4] = background[0];
      this.pixels[i * 4 + 1] = background[1];
      this.pixels[i * 4 + 2] = background[2];
      this.pixels[i * 4 + 3] = background[3];
    }
  }

  blend(x: number, y: number, color: RGBA, alpha: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const a = Math.max(0, Math.min(1, alpha * (color[3] / 255)));
    this.pixels[i] = Math.round(this.pixels[i] * (1 - a) + color[0] * a);
    this.pixels[i + 1] = Math.round(this.pixels[i + 1] * (1 - a) + color[1] * a);
    this.pixels[i + 2] = Math.round(this.pixels[i + 2] * (1 - a) + color[2] * a);
    this.pixels[i + 3] = 255;
  }

  /** Fill a convex polygon (screen coordinates) with even-odd scanlines. */
  polygon(points: Array<[number, number]>, color: RGBA): void {
    const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
    for (let y = minY; y <= maxY; y++) {
      const crossings: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if (y1 === y2) continue;
        const yc = y + 0.5;
        if ((yc >= y1 && yc < y2) || (yc >= y2 && yc < y1)) {
          crossings.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const start = Math.max(0, Math.ceil(crossings[i] - 0.5));
        const end = Math.min(this.width - 1, Math.floor(crossings[i + 1] - 0.5));
        for (let x = start; x <= end; x++) this.blend(x, y, color, 1);
      }
    }
  }

  /** Copy another canvas in at an offset, for compositing panels. */
  blit(source: Canvas, dx: number, dy: number): void {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const si = (y * source.width + x) * 4;
        const alpha = source.pixels[si + 3] / 255;
        if (alpha <= 0) continue;
        this.blend(dx + x, dy + y, [source.pixels[si], source.pixels[si + 1], source.pixels[si + 2], 255], alpha);
      }
    }
  }
}

interface RenderOptions {
  width: number;
  height: number;
  color: (i: number, j: number, k: number, confidence: number) => RGBA;
  background?: RGBA;
  margin?: number;
}

/**
 * Isometric render of an occupied set. Only faces that border an empty
 * cell are drawn — the same rule the mesh extractor uses — so the picture
 * shows the surface, not the interior.
 */
function renderIso(voxels: SparseVoxels, options: RenderOptions): Canvas {
  const canvas = new Canvas(options.width, options.height, options.background ?? PANEL_BG);
  const n = voxelCount(voxels);
  if (n === 0) return canvas;

  const grid = voxels.grid;
  const mask = occupancyMask(voxels);
  const confidence = voxels.attributes.confidence;

  const cos = 0.866;
  const sin = 0.5;
  const project = (x: number, y: number, z: number): [number, number] => [
    (x - z) * cos,
    (x + z) * sin - y,
  ];

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]] as const) {
      const [u, w] = project(i + dx, j + dy, k + dz);
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (w < minV) minV = w;
      if (w > maxV) maxV = w;
    }
  }

  const margin = options.margin ?? 18;
  const scale = Math.min(
    (options.width - margin * 2) / Math.max(1e-9, maxU - minU),
    (options.height - margin * 2) / Math.max(1e-9, maxV - minV),
  );
  const offsetU = (options.width - (maxU - minU) * scale) / 2 - minU * scale;
  const offsetV = (options.height - (maxV - minV) * scale) / 2 - minV * scale;
  const toScreen = (u: number, w: number): [number, number] => [u * scale + offsetU, w * scale + offsetV];

  // Painter's algorithm: cells with a larger x+z are closer to the viewer.
  const order = Array.from({ length: n }, (_, index) => index).sort((a, b) => {
    const ax = voxels.coords[a * 3] + voxels.coords[a * 3 + 2];
    const bx = voxels.coords[b * 3] + voxels.coords[b * 3 + 2];
    if (ax !== bx) return ax - bx;
    return voxels.coords[a * 3 + 1] - voxels.coords[b * 3 + 1];
  });

  const faces: Array<{ neighbour: readonly [number, number, number]; corners: ReadonlyArray<readonly [number, number, number]>; shade: number }> = [
    { neighbour: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0 },
    { neighbour: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.74 },
    { neighbour: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.56 },
  ];

  for (const index of order) {
    const i = voxels.coords[index * 3], j = voxels.coords[index * 3 + 1], k = voxels.coords[index * 3 + 2];
    const base = options.color(i, j, k, confidence?.[index] ?? 0);
    for (const face of faces) {
      const key = denseIndexOf(grid, i + face.neighbour[0], j + face.neighbour[1], k + face.neighbour[2]);
      if (key !== -1 && mask[key] === 1) continue;
      const points = face.corners.map(([dx, dy, dz]) => toScreen(...project(i + dx, j + dy, k + dz)));
      canvas.polygon(points, [
        Math.round(base[0] * face.shade),
        Math.round(base[1] * face.shade),
        Math.round(base[2] * face.shade),
        base[3],
      ]);
    }
  }
  return canvas;
}

function compose(panels: Canvas[], gap = 6): Canvas {
  const width = panels.reduce((s, p) => s + p.width, 0) + gap * (panels.length - 1);
  const height = Math.max(...panels.map((p) => p.height));
  const out = new Canvas(width, height, BACKGROUND);
  let x = 0;
  for (const panel of panels) {
    out.blit(panel, x, 0);
    x += panel.width + gap;
  }
  return out;
}

function save(name: string, canvas: Canvas): string {
  const outDir = path.join(process.cwd(), "artifacts", "mission3");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, name);
  writeFileSync(file, encodePng(canvas.width, canvas.height, canvas.pixels));
  console.log(`wrote artifacts/mission3/${name} (${canvas.width}×${canvas.height})`);
  return file;
}

/* --------------------------------- scenes -------------------------------- */

const G24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });
const G16 = createGrid({ cellSize: 0.05, resolution: [16, 16, 16] });
const G32 = createGrid({ cellSize: 0.05, resolution: [32, 32, 32] });

const SLATE: RGBA = [104, 138, 232, 255];
const TEAL: RGBA = [72, 224, 190, 255];
const RED: RGBA = [255, 84, 104, 255];
const GOLD: RGBA = [255, 200, 96, 255];
const VIOLET: RGBA = [168, 116, 255, 255];
const ORANGE: RGBA = [255, 148, 72, 255];

const panel = (voxels: SparseVoxels, color: RenderOptions["color"], size = 360): Canvas =>
  renderIso(voxels, { width: size, height: size, color });

/* 1 — Experiment B: surface round trip on an irregular blob */
{
  const blob = irregularBlob(G24, [0.6, 0.6, 0.6], 0.34, 7, 0.3);
  const recovered = voxelizeMesh(meshFromVoxels(blob), G24, { samplesPerCell: 2 });
  const original = occupancyKeySet(blob);
  const recoveredKeys = occupancyKeySet(recovered);
  const diff = unionVoxels([blob, recovered], G24);
  const inOriginal = (i: number, j: number, k: number) => original.has(denseIndexOf(G24, i, j, k));
  const inRecovered = (i: number, j: number, k: number) => recoveredKeys.has(denseIndexOf(G24, i, j, k));

  save(
    "exp_b_surface_roundtrip.png",
    compose([
      panel(blob, () => SLATE),
      panel(recovered, () => TEAL),
      panel(diff, (i, j, k) => {
        const a = inOriginal(i, j, k);
        const b = inRecovered(i, j, k);
        if (a && b) return TEAL;
        return a ? RED : GOLD;
      }),
    ]),
  );
}

/* 2 — Experiment B: dense volume, interior loss made visible */
{
  const solid = filledBox(G16, { min: [2, 2, 2], max: [13, 13, 13] });
  const boundaryKeys = occupancyKeySet(boxShell(G16, { min: [2, 2, 2], max: [13, 13, 13] }));
  const interiorKey = new Set<number>();
  const cutCells: Array<[number, number, number]> = [];
  for (let v = 0; v < voxelCount(solid); v++) {
    const i = solid.coords[v * 3], j = solid.coords[v * 3 + 1], k = solid.coords[v * 3 + 2];
    const key = denseIndexOf(G16, i, j, k);
    if (!boundaryKeys.has(key)) interiorKey.add(key);
    // Cut the near corner away: an interior cell behind an opaque wall is
    // invisible, which would make "interior cells are lost" unshowable.
    if (i >= 9 && k >= 9) continue;
    cutCells.push([i, j, k]);
  }
  const cutaway = buildSparseVoxels(G16, cutCells, { occupancy: "sparse-volume" });
  save(
    "exp_b_dense_interior_loss.png",
    compose([
      panel(solid, () => VIOLET),
      panel(cutaway, (i, j, k) => (interiorKey.has(denseIndexOf(G16, i, j, k)) ? RED : ORANGE)),
    ]),
  );
}

/* 3 — Experiment C: temporal sequence */
{
  const head = [0.8, 0.8, 0.8] as [number, number, number];
  const base = withConfidence(sphereShell(G32, head, 0.35, 0.05), 0.6);
  const grown = withConfidence(
    unionVoxels([base, boxShell(G32, { min: [23, 13, 14], max: [25, 19, 18] })], G32),
    0.55,
  );
  const moved = withConfidence(
    transformVoxels(grown, translationMatrix(3 * G32.cellSize, G32.cellSize, 0), {}).voxels,
    0.62,
  );
  const baseKeys = occupancyKeySet(base);

  save(
    "exp_c_temporal_sequence.png",
    compose([
      panel(base, () => SLATE),
      panel(grown, (i, j, k) => (baseKeys.has(denseIndexOf(G32, i, j, k)) ? TEAL : GOLD)),
      panel(moved, () => TEAL),
    ]),
  );

  const accumulated = withConfidence(unionVoxels([grown, moved], G32), 0.91);
  save(
    "exp_c_accumulated.png",
    compose([
      panel(accumulated, () => TEAL),
      panel(accumulated, (_i, _j, _k, confidence) => {
        const t = Math.max(0, Math.min(1, confidence));
        return [
          Math.round(255 - 165 * t),
          Math.round(120 + 110 * t),
          Math.round(90 + 130 * t),
          255,
        ];
      }),
    ]),
  );
}

/* 4 — Experiment C: confidence rising across observations */
{
  const head = [0.8, 0.8, 0.8] as [number, number, number];
  const shape = sphereShell(G32, head, 0.35, 0.05);
  const heat = (_i: number, _j: number, _k: number, confidence: number): RGBA => {
    const t = Math.max(0, Math.min(1, confidence));
    return [Math.round(255 - 165 * t), Math.round(120 + 110 * t), Math.round(90 + 130 * t), 255];
  };
  save(
    "exp_c_confidence_fusion.png",
    compose([
      panel(withConfidence(shape, 0.55), heat),
      panel(withConfidence(shape, 0.8), heat),
      panel(withConfidence(shape, 1 - (1 - 0.55) * (1 - 0.8)), heat),
    ]),
  );
}
