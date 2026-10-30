/**
 * ==========================================================
 * LÉLU 3D FORGE — REFERENCE INGESTION (server only)
 *
 * Turns a folder of supplied images into a manifest the
 * pipeline can reason about BEFORE any credit is spent:
 *
 *   - exact duplicates      sha256 of the bytes
 *   - near duplicates       64-bit dHash, Hamming distance ≤ 6
 *   - measured quality      resolution, mean luminance,
 *                           contrast, Laplacian sharpness
 *   - what each image is FOR — a geometry reference (drives
 *     the mesh), a texture reference (drives the surface) or
 *     a design reference (read by people and by LÉLU, never
 *     submitted) — supplied as a classification, because an
 *     image does not say which of those it is.
 *
 * Decoding uses node:zlib only. It supports what reference
 * art is in practice — 8-bit, non-interlaced PNG (grey, RGB,
 * RGBA) — and refuses anything else rather than guess. JPEG
 * and WebP are hashed and recorded but get no pixel metrics.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export type ReferenceUse = "geometry" | "texture" | "design";

export type ReferenceCategory =
  | "identity"
  | "body"
  | "hair"
  | "clothing"
  | "accessories";

/** What a person (or a vision model) decided an image is. */
export interface ReferenceClassification {
  id: string;
  sourceName: string;
  category: ReferenceCategory;
  view: string;
  outfitVariant: string;
  intendedUse: string;
  uses: ReferenceUse[];
  notes?: string;
}

export interface ImageMetrics {
  format: "png" | "jpeg" | "webp" | "unknown";
  width: number | null;
  height: number | null;
  bytes: number;
  sha256: string;
  dhash: string | null;
  meanLuminance: number | null;
  contrast: number | null;
  sharpness: number | null;
}

export interface ReferenceRecord extends ReferenceClassification {
  file: string;
  metrics: ImageMetrics;
  quality: "high" | "usable" | "poor";
  reconstructionSuitability: "primary" | "supporting" | "not-for-geometry";
  duplicateOf: string | null;
  nearDuplicateOf: string | null;
}

/* ------------------------------ decoding ------------------------------ */

interface Decoded {
  width: number;
  height: number;
  channels: number;
  pixels: Uint8Array;
}

function sniff(bytes: Uint8Array): ImageMetrics["format"] {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "webp";
  return "unknown";
}

export function decodePng(bytes: Uint8Array): Decoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      const depth = data[8];
      const colour = data[9];
      const interlace = data[12];
      if (depth !== 8 || interlace !== 0) throw new Error("Only 8-bit non-interlaced PNG is decoded.");
      channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
      if (!channels) throw new Error(`PNG colour type ${colour} is not decoded.`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function luminanceAt(img: Decoded, x: number, y: number): number {
  const i = (y * img.width + x) * img.channels;
  if (img.channels < 3) return img.pixels[i];
  return 0.299 * img.pixels[i] + 0.587 * img.pixels[i + 1] + 0.114 * img.pixels[i + 2];
}

/** 64-bit difference hash: 9×8 area-sampled greyscale, left vs right neighbour. */
function dhash(img: Decoded): string {
  const grid: number[] = [];
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      const x0 = Math.floor((gx * img.width) / 9);
      const x1 = Math.floor(((gx + 1) * img.width) / 9);
      const y0 = Math.floor((gy * img.height) / 8);
      const y1 = Math.floor(((gy + 1) * img.height) / 8);
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          sum += luminanceAt(img, x, y);
          n++;
        }
      }
      grid.push(n ? sum / n : 0);
    }
  }
  let bits = "";
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) bits += grid[gy * 9 + gx] > grid[gy * 9 + gx + 1] ? "1" : "0";
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

export function measureImage(bytes: Uint8Array): ImageMetrics {
  const metrics: ImageMetrics = {
    format: sniff(bytes),
    width: null,
    height: null,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    dhash: null,
    meanLuminance: null,
    contrast: null,
    sharpness: null,
  };
  if (metrics.format !== "png") return metrics;
  const img = decodePng(bytes);
  metrics.width = img.width;
  metrics.height = img.height;
  metrics.dhash = dhash(img);

  // Luminance statistics and 4-neighbour Laplacian variance (focus measure),
  // on a 2-pixel lattice: every metric below is relative, so sampling keeps
  // the cost proportionate without changing the ranking.
  let sum = 0;
  let sumSq = 0;
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  let m = 0;
  for (let y = 2; y < img.height - 2; y += 2) {
    for (let x = 2; x < img.width - 2; x += 2) {
      const l = luminanceAt(img, x, y);
      sum += l;
      sumSq += l * l;
      n++;
      const lap = 4 * l - luminanceAt(img, x - 1, y) - luminanceAt(img, x + 1, y) - luminanceAt(img, x, y - 1) - luminanceAt(img, x, y + 1);
      lapSum += lap;
      lapSq += lap * lap;
      m++;
    }
  }
  const mean = sum / n;
  metrics.meanLuminance = Math.round(mean * 10) / 10;
  metrics.contrast = Math.round(Math.sqrt(Math.max(0, sumSq / n - mean * mean)) * 10) / 10;
  const lapMean = lapSum / m;
  metrics.sharpness = Math.round((lapSq / m - lapMean * lapMean) * 10) / 10;
  return metrics;
}

/* ------------------------------ manifest ------------------------------ */

const NEAR_DUPLICATE_BITS = 6;

function gradeQuality(m: ImageMetrics): ReferenceRecord["quality"] {
  if (m.width === null || m.height === null) return "usable";
  const pixels = m.width * m.height;
  if (pixels < 512 * 512 || (m.sharpness ?? 0) < 20 || (m.contrast ?? 0) < 15) return "poor";
  if (pixels >= 1024 * 1024 && (m.sharpness ?? 0) >= 60) return "high";
  return "usable";
}

function suitability(c: ReferenceClassification, quality: ReferenceRecord["quality"]): ReferenceRecord["reconstructionSuitability"] {
  if (!c.uses.includes("geometry") || quality === "poor") return "not-for-geometry";
  return c.view.startsWith("front") && c.view.includes("full-body") ? "primary" : "supporting";
}

/**
 * Build records for a batch, flagging exact and near duplicates against
 * everything already ingested plus everything earlier in the batch.
 */
export function buildRecords(
  batch: Array<{ classification: ReferenceClassification; file: string; bytes: Uint8Array }>,
  existing: ReferenceRecord[] = [],
): ReferenceRecord[] {
  const seen: ReferenceRecord[] = [...existing];
  const out: ReferenceRecord[] = [];
  for (const item of batch) {
    const metrics = measureImage(item.bytes);
    const quality = gradeQuality(metrics);
    const exact = seen.find((r) => r.metrics.sha256 === metrics.sha256) ?? null;
    const near = !exact && metrics.dhash
      ? seen.find((r) => r.metrics.dhash && hamming(r.metrics.dhash, metrics.dhash as string) <= NEAR_DUPLICATE_BITS) ?? null
      : null;
    const record: ReferenceRecord = {
      ...item.classification,
      file: item.file,
      metrics,
      quality,
      reconstructionSuitability: suitability(item.classification, quality),
      duplicateOf: exact?.id ?? null,
      nearDuplicateOf: near?.id ?? null,
    };
    seen.push(record);
    out.push(record);
  }
  return out;
}
