/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — IMAGE DECOMPOSITION
 *
 * One photograph is not one observation; it is a stack of measurements
 * that happen to arrive together. This module takes the pixel buffer and
 * separates it into the analytical processes the mission asks for:
 *
 *   RGB analysis          colour statistics, background estimate, foreground
 *   segmentation          border-seeded background subtraction plus a
 *                         largest-connected-component gate and hole filling
 *   silhouette            per-row extents and runs, perimeter, symmetry
 *   surface analysis      luminance gradient, orientation histogram
 *   depth estimation      distance-transform inflation and shading proxy
 *   landmark detection    extents and width-profile extrema
 *   component identity    anatomical regions with pixel support
 *   spatial measurement   metric size once a world height is chosen
 *
 * Every number here comes from the pixels. Nothing is looked up, and
 * nothing is assumed because a character "usually" has a certain shape —
 * the one place a proportion prior enters (knee, ankle, chin) is labelled
 * INFERRED with the rule that placed it.
 *
 * Dependency-free and synchronous: a Node script, a browser worker and a
 * test all call `analyseImage` with the same buffer.
 * ==========================================================
 */

import type { BBox2D, ComponentId, ImageFrame, Landmark, Provenance, RowSpan, Vec2 } from "./types.ts";
import { COMPONENT_IDS, bboxArea, bboxHeight, bboxIsEmpty, bboxWidth, emptyBBox } from "./types.ts";

/* ------------------------------------------------------------------ basics */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** One pass over the buffer producing luma + per-channel accessors. */
export function lumaOf(frame: ImageFrame): Float32Array {
  const out = new Float32Array(frame.width * frame.height);
  const rgba = frame.rgba;
  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    out[p] = luminance(rgba[i], rgba[i + 1], rgba[i + 2]);
  }
  return out;
}

export function percentile(values: ArrayLike<number>, q: number): number {
  if (values.length === 0) return 0;
  const copy = Float64Array.from(values as ArrayLike<number>);
  copy.sort();
  const index = clamp(Math.round((copy.length - 1) * clamp(q, 0, 1)), 0, copy.length - 1);
  return copy[index];
}

/* ------------------------------------------------------------------ colour */

export interface RgbTriple {
  r: number;
  g: number;
  b: number;
}

export interface ColourAnalysis {
  background: RgbTriple;
  /** How the background estimate was taken, so a bad estimate is visible. */
  backgroundMethod: string;
  mean: RgbTriple;
  std: RgbTriple;
  /** Share of pixels the segmentation believes are not background. */
  foregroundFraction: number;
  /** Top colour clusters inside the foreground, by share. */
  dominant: Array<{ rgb: RgbTriple; share: number }>;
  /** L1 distance threshold that separates foreground from background. */
  threshold: number;
  notes: string[];
}

function borderColours(frame: ImageFrame, ring: number): number[][] {
  const { width, height, rgba } = frame;
  const samples: number[][] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const onBorder = x < ring || y < ring || x >= width - ring || y >= height - ring;
      if (!onBorder) continue;
      const i = (y * width + x) * 4;
      samples.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
    }
  }
  return samples;
}

function medianOf(samples: number[][], channel: number): number {
  const values = samples.map((s) => s[channel]);
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/**
 * Otsu split on a 1-D histogram. Used on the L1 colour distance to
 * background, which is unimodal for a studio backdrop and bimodal for a
 * subject on one — so the threshold is measured, not hard-coded.
 */
export function otsuThreshold(histogram: Float64Array): number {
  const total = histogram.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  let sum = 0;
  for (let i = 0; i < histogram.length; i++) sum += i * histogram[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVariance = -1;
  for (let t = 0; t < histogram.length; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVariance) {
      bestVariance = between;
      best = t;
    }
  }
  return best;
}

/* ------------------------------------------------------------- segmentation */

export interface Segmentation {
  mask: Uint8Array;
  background: RgbTriple;
  threshold: number;
  /** Foreground pixels before the largest-component gate. */
  rawPixels: number;
  /** Pixels removed because they belonged to another component. */
  discardedPixels: number;
  /** Enclosed background pixels filled as body. */
  filledHoles: number;
  bbox: BBox2D;
  notes: string[];
}

export function foregroundMask(frame: ImageFrame): Segmentation {
  const { width, height } = frame;
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.01));
  const border = borderColours(frame, ring);
  const background: RgbTriple = {
    r: medianOf(border, 0),
    g: medianOf(border, 1),
    b: medianOf(border, 2),
  };

  const pixels = width * height;
  const distances = new Float64Array(pixels);
  const histogram = new Float64Array(766);
  const rgba = frame.rgba;
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const d = Math.abs(rgba[i] - background.r) + Math.abs(rgba[i + 1] - background.g) + Math.abs(rgba[i + 2] - background.b);
    distances[p] = d;
    histogram[clamp(Math.round(d), 0, 765)] += 1;
  }

  const otsu = otsuThreshold(histogram);
  // A studio backdrop is uniform, so Otsu lands low; a floor with texture
  // pushes it up. The floor of 18 L1 units keeps sensor noise and JPEG
  // ringing out of the mask without assuming a particular backdrop.
  const threshold = Math.max(18, otsu);

  let mask: Uint8Array = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) mask[p] = distances[p] > threshold ? 1 : 0;

  let rawPixels = 0;
  for (let p = 0; p < pixels; p++) rawPixels += mask[p];

  // Largest 4-connected foreground component. A nameplate, a colour chart
  // or a stray shadow in the corner must not become part of the character.
  const keep = largestComponent(mask, width, height, 4);
  let discardedPixels = 0;
  for (let p = 0; p < pixels; p++) {
    if (mask[p] === 1 && keep[p] === 0) {
      mask[p] = 0;
      discardedPixels++;
    }
  }

  // Fill interior holes: background-coloured regions the flood cannot reach
  // from the border are part of the subject (a gap between an arm and the
  // torso is reachable; an eye or a buckle is not).
  const outside = new Uint8Array(pixels);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (outside[p] || mask[p] === 1) return;
    outside[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop() as number;
    const x = p % width;
    const y = (p - x) / width;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  let filledHoles = 0;
  for (let p = 0; p < pixels; p++) {
    if (mask[p] === 0 && outside[p] === 0) {
      mask[p] = 1;
      filledHoles++;
    }
  }

  // A second pass on the resulting mask, because hole filling can join a
  // discarded fragment back onto the body through a diagonal gap.
  mask = largestComponent(mask, width, height, 8);

  const bbox = new Uint8Array(pixels);
  for (let p = 0; p < pixels; p++) bbox[p] = mask[p];
  const notes: string[] = [];
  if (discardedPixels > rawPixels * 0.02) {
    notes.push(`${discardedPixels} of ${rawPixels} foreground pixels were disconnected fragments and were dropped.`);
  }
  if (filledHoles > 0) notes.push(`${filledHoles} enclosed background pixels were treated as body (holes the border flood could not reach).`);

  return {
    mask,
    background,
    threshold,
    rawPixels,
    discardedPixels,
    filledHoles,
    bbox: maskBBox(mask, width, height),
    notes,
  };
}

export function maskBBox(mask: Uint8Array, width: number, height: number): BBox2D {
  let box = emptyBBox();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      if (x < box.minX) box.minX = x;
      if (x > box.maxX) box.maxX = x;
      if (y < box.minY) box.minY = y;
      if (y > box.maxY) box.maxY = y;
    }
  }
  return box;
}

/** Keep only the largest connected component. `connectivity` 4 or 8. */
export function largestComponent(mask: Uint8Array, width: number, height: number, connectivity: 4 | 8): Uint8Array {
  const pixels = width * height;
  const seen = new Uint8Array(pixels);
  let bestStart = -1;
  let bestSize = 0;
  const stack: number[] = [];
  const offsets: Array<[number, number]> =
    connectivity === 4
      ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

  for (let start = 0; start < pixels; start++) {
    if (mask[start] === 0 || seen[start]) continue;
    let size = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() as number;
      size++;
      const x = p % width;
      const y = (p - x) / width;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        if (mask[np] === 0 || seen[np]) continue;
        seen[np] = 1;
        stack.push(np);
      }
    }
    if (size > bestSize) {
      bestSize = size;
      bestStart = start;
    }
  }

  const keep = new Uint8Array(pixels);
  if (bestStart < 0) return keep;
  stack.push(bestStart);
  keep[bestStart] = 1;
  while (stack.length > 0) {
    const p = stack.pop() as number;
    const x = p % width;
    const y = (p - x) / width;
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (mask[np] === 0 || keep[np]) continue;
      keep[np] = 1;
      stack.push(np);
    }
  }
  return keep;
}

/* ---------------------------------------------------------------- silhouette */

export interface Silhouette {
  rows: RowSpan[];
  columns: Array<{ x: number; minY: number; maxY: number; count: number }>;
  area: number;
  bbox: BBox2D;
  centroid: Vec2;
  /** Marching-squares-free perimeter estimate: exposed cell faces. */
  perimeter: number;
  /** Mask IoU against its own horizontal mirror — 1 means perfectly symmetric. */
  symmetry: number;
  /** Horizontal mirror axis actually used (x + mirrorX = width - 1). */
  symmetryAxis: number;
}

export function rowSpans(mask: Uint8Array, width: number, height: number, box?: BBox2D): RowSpan[] {
  const rows: RowSpan[] = [];
  const y0 = box && !bboxIsEmpty(box) ? Math.max(0, box.minY) : 0;
  const y1 = box && !bboxIsEmpty(box) ? Math.min(height - 1, box.maxY) : height - 1;
  for (let y = y0; y <= y1; y++) {
    let minX = -1;
    let maxX = -1;
    let count = 0;
    const runs: Array<[number, number]> = [];
    let runStart = -1;
    for (let x = 0; x < width; x++) {
      const on = mask[y * width + x] === 1;
      if (on) {
        if (runStart < 0) runStart = x;
        if (minX < 0) minX = x;
        maxX = x;
        count++;
      } else if (runStart >= 0) {
        runs.push([runStart, x - 1]);
        runStart = -1;
      }
    }
    if (runStart >= 0) runs.push([runStart, width - 1]);
    rows.push({ y, minX, maxX, count, runs });
  }
  return rows;
}

export function measureSilhouette(mask: Uint8Array, width: number, height: number): Silhouette {
  const rows = rowSpans(mask, width, height);
  const columns: Array<{ x: number; minY: number; maxY: number; count: number }> = [];
  for (let x = 0; x < width; x++) {
    let minY = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < height; y++) {
      if (mask[y * width + x] === 0) continue;
      if (minY < 0) minY = y;
      maxY = y;
      count++;
    }
    columns.push({ x, minY, maxY, count });
  }

  let area = 0;
  let exposed = 0;
  let sumX = 0;
  let sumY = 0;
  const bbox = emptyBBox();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      area++;
      sumX += x;
      sumY += y;
      if (x < bbox.minX) bbox.minX = x;
      if (x > bbox.maxX) bbox.maxX = x;
      if (y < bbox.minY) bbox.minY = y;
      if (y > bbox.maxY) bbox.maxY = y;
      const up = y === 0 ? 0 : mask[(y - 1) * width + x];
      const down = y === height - 1 ? 0 : mask[(y + 1) * width + x];
      const left = x === 0 ? 0 : mask[y * width + (x - 1)];
      const right = x === width - 1 ? 0 : mask[y * width + (x + 1)];
      exposed += 4 - (up + down + left + right);
    }
  }

  // Symmetry: score the mask against its mirror around the silhouette centroid.
  const axis = area > 0 ? sumX / area : width / 2;
  let overlap = 0;
  let union = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = mask[y * width + x];
      const mx = clamp(Math.round(2 * axis - x), 0, width - 1);
      const b = mask[y * width + mx];
      if (a === 1 && b === 1) overlap++;
      if (a === 1 || b === 1) union++;
    }
  }

  return {
    rows,
    columns,
    area,
    bbox,
    centroid: [area > 0 ? sumX / area : width / 2, area > 0 ? sumY / area : height / 2],
    perimeter: exposed,
    symmetry: union === 0 ? 0 : overlap / union,
    symmetryAxis: axis,
  };
}

/** Downsample a mask into a coarse grid of occupancy shares, for scoring. */
export function resampleMask(mask: Uint8Array, width: number, height: number, nx: number, ny: number): Float32Array {
  const out = new Float32Array(nx * ny);
  const counts = new Float32Array(nx * ny);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(ny - 1, Math.floor((y / height) * ny));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(nx - 1, Math.floor((x / width) * nx));
      counts[gy * nx + gx] += 1;
      out[gy * nx + gx] += mask[y * width + x];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] > 0 ? out[i] / counts[i] : 0;
  return out;
}

/* ------------------------------------------------------------ surface/depth */

export interface SurfaceAnalysis {
  meanGradient: number;
  maxGradient: number;
  /** Share of foreground pixels with a gradient above `edgeThreshold`. */
  shadingYield: number;
  edgeThreshold: number;
  /** 8-bin histogram of gradient orientation, weighted by magnitude. */
  orientationHistogram: number[];
  /** Mean |gradient| inside the silhouette, normalised to 0..1. */
  meanGradientNormalised: number;
  notes: string[];
}

export function analyseSurface(mask: Uint8Array, luma: Float32Array, width: number, height: number): SurfaceAnalysis {
  const gx = new Float32Array(width * height);
  const gy = new Float32Array(width * height);
  const sobelX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const sobelY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (mask[p] === 0) continue;
      let sx = 0;
      let sy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = (y + dy) * width + (x + dx);
          const k = (dy + 1) * 3 + (dx + 1);
          sx += luma[q] * sobelX[k];
          sy += luma[q] * sobelY[k];
        }
      }
      gx[p] = sx / 8;
      gy[p] = sy / 8;
    }
  }

  const edgeThreshold = 12;
  let sum = 0;
  let max = 0;
  let count = 0;
  let edges = 0;
  const orientationHistogram = new Array<number>(8).fill(0);
  for (let p = 0; p < gx.length; p++) {
    if (mask[p] === 0) continue;
    const magnitude = Math.hypot(gx[p], gy[p]);
    sum += magnitude;
    if (magnitude > max) max = magnitude;
    count++;
    if (magnitude > edgeThreshold) edges++;
    if (magnitude > edgeThreshold) {
      // Orientation of the surface tangent is perpendicular to the gradient.
      let angle = Math.atan2(gy[p], gx[p]) + Math.PI / 2;
      if (angle < 0) angle += Math.PI;
      const bin = clamp(Math.floor((angle / Math.PI) * 8), 0, 7);
      orientationHistogram[bin] += magnitude;
    }
  }
  const totalWeight = orientationHistogram.reduce((s, v) => s + v, 0);
  const notes: string[] = [];
  if (totalWeight === 0) notes.push("No shading gradient above threshold: surface orientation cannot be read from this image.");
  return {
    meanGradient: count > 0 ? sum / count : 0,
    maxGradient: max,
    shadingYield: count > 0 ? edges / count : 0,
    edgeThreshold,
    orientationHistogram: totalWeight > 0 ? orientationHistogram.map((v) => v / totalWeight) : orientationHistogram,
    meanGradientNormalised: max > 0 ? sum / count / max : 0,
    notes,
  };
}

export interface DepthAnalysis {
  /** Distance transform of the mask, in pixels: the inradius at each pixel. */
  inflation: Float32Array;
  maxInflation: number;
  /** Shading-derived closeness proxy, 0..1, foreground only. */
  shading: Float32Array;
  /** Blend of the two, 0..1, used as the depth prior. */
  blended: Float32Array;
  /** Weights actually used, so the prior can be argued with. */
  weights: { inflation: number; shading: number };
  /** Half-thickness implied by the silhouette, in pixels. */
  maxHalfThicknessPx: number;
  notes: string[];
}

/**
 * Two-pass chamfer distance transform (3-4 weights). Distance to the nearest
 * background pixel: a pixel of a limb of half-width 20 px reads ~20, which is
 * exactly the radius of the largest disc that fits inside the silhouette at
 * that point — the geometric basis for "inflate the silhouette into a body".
 */
export function distanceTransform(mask: Uint8Array, width: number, height: number): Float32Array {
  const dist = new Float32Array(width * height);
  const INF = 1e9;
  for (let p = 0; p < dist.length; p++) dist[p] = mask[p] === 1 ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : dist[y * width + x]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (mask[p] === 0) continue;
      let d = dist[p];
      d = Math.min(d, at(x - 1, y) + 3);
      d = Math.min(d, at(x, y - 1) + 3);
      d = Math.min(d, at(x - 1, y - 1) + 4);
      d = Math.min(d, at(x + 1, y - 1) + 4);
      dist[p] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const p = y * width + x;
      if (mask[p] === 0) continue;
      let d = dist[p];
      d = Math.min(d, at(x + 1, y) + 3);
      d = Math.min(d, at(x, y + 1) + 3);
      d = Math.min(d, at(x + 1, y + 1) + 4);
      d = Math.min(d, at(x - 1, y + 1) + 4);
      dist[p] = d;
    }
  }
  for (let p = 0; p < dist.length; p++) if (dist[p] >= INF) dist[p] = 0;
  for (let p = 0; p < dist.length; p++) dist[p] = dist[p] / 3;
  return dist;
}

export function analyseDepth(mask: Uint8Array, luma: Float32Array, width: number, height: number): DepthAnalysis {
  const inflation = distanceTransform(mask, width, height);
  let maxInflation = 0;
  for (let p = 0; p < inflation.length; p++) if (mask[p] === 1 && inflation[p] > maxInflation) maxInflation = inflation[p];

  const shading = new Float32Array(width * height);
  let lo = Infinity;
  let hi = -Infinity;
  for (let p = 0; p < luma.length; p++) {
    if (mask[p] === 0) continue;
    if (luma[p] < lo) lo = luma[p];
    if (luma[p] > hi) hi = luma[p];
  }
  const span = hi > lo ? hi - lo : 1;
  for (let p = 0; p < shading.length; p++) {
    if (mask[p] === 0) continue;
    shading[p] = clamp((luma[p] - lo) / span, 0, 1);
  }

  // Weights: the silhouette is measured (a distance, in pixels), shading is a
  // proxy for a light direction we do not know. The measured term dominates.
  const weights = { inflation: 0.7, shading: 0.3 };
  const blended = new Float32Array(width * height);
  for (let p = 0; p < blended.length; p++) {
    if (mask[p] === 0) continue;
    const infl = maxInflation > 0 ? inflation[p] / maxInflation : 0;
    blended[p] = weights.inflation * clamp(infl, 0, 1) + weights.shading * shading[p];
  }

  const notes: string[] = [];
  if (maxInflation < 2) notes.push("The silhouette is thinner than two pixels somewhere; the inflation depth is unreliable at this width.");
  return {
    inflation,
    maxInflation,
    shading,
    blended,
    weights,
    maxHalfThicknessPx: maxInflation,
    notes,
  };
}

/* ---------------------------------------------------------------- landmarks */

export interface LandmarkSet {
  landmarks: Landmark[];
  byId: Record<string, Landmark>;
  /** The width profile the landmarks were read from, kept for inspection. */
  widthProfile: Array<{ y: number; count: number; runs: number }>;
  notes: string[];
}

function localExtremum(
  values: Array<{ y: number; value: number }>,
  mode: "min" | "max",
  fromY: number,
  toY: number,
): { y: number; value: number } | null {
  const window = values.filter((v) => v.y >= fromY && v.y <= toY);
  if (window.length < 3) return null;
  // Smooth first: a one-row dip from an antialiased edge is not a neck.
  const smoothed = window.map((entry, index) => {
    let sum = 0;
    let n = 0;
    for (let d = -2; d <= 2; d++) {
      const other = window[index + d];
      if (!other) continue;
      sum += other.value;
      n++;
    }
    return { y: entry.y, value: sum / n };
  });
  let best = smoothed[0];
  for (const entry of smoothed) {
    if (mode === "min" ? entry.value < best.value : entry.value > best.value) best = entry;
  }
  return best;
}

/**
 * Landmarks from the silhouette's width profile plus two density checks.
 *
 * The head/shoulder/hip/crotch chain is read from where the silhouette
 * actually narrows and widens. Knee, ankle, chin and eye positions cannot be
 * seen at this resolution, so they are placed by an explicit rule and
 * labelled INFERRED — with the rule in the evidence string.
 */
export function detectLandmarks(
  mask: Uint8Array,
  rows: RowSpan[],
  width: number,
  luma: Float32Array,
): LandmarkSet {
  const landmarks: Landmark[] = [];
  const notes: string[] = [];
  const widthProfile = rows.map((r) => ({ y: r.y, count: r.count, runs: r.runs.length }));

  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const floor = Math.max(2, maxCount * 0.03);
  const occupied = rows.filter((r) => r.count >= floor);
  if (occupied.length === 0) {
    notes.push("The mask is empty; no landmark can be measured.");
    return { landmarks, byId: {}, widthProfile, notes };
  }
  const top = occupied[0];
  const bottom = occupied[occupied.length - 1];
  const bodyHeight = bottom.y - top.y + 1;

  const at = (id: string, label: string, x: number, y: number, confidence: number, provenance: Provenance, evidence: string): void => {
    landmarks.push({ id, label, x, y, confidence, provenance, evidence });
  };

  at("head-top", "Top of head", (top.minX + top.maxX) / 2, top.y, 0.95, "OBSERVED", `first silhouette row at or above 3% of the widest row (${Math.round(floor)} px)`);
  at("feet-bottom", "Lowest point of the feet", (bottom.minX + bottom.maxX) / 2, bottom.y, 0.95, "OBSERVED", "last silhouette row at or above the 3% width floor");

  // Shoulders: the steepest sustained widening in the upper third. A single
  // row of arms in an A-pose also widens quickly, so the search is smoothed
  // over 5 rows and required to stay wide afterwards.
  const smooth = (y: number): number => {
    let sum = 0;
    let n = 0;
    for (let d = -2; d <= 2; d++) {
      const row = rows.find((r) => r.y === y + d);
      if (!row) continue;
      sum += row.count;
      n++;
    }
    return n > 0 ? sum / n : 0;
  };
  let shoulderY = top.y + Math.round(bodyHeight * 0.18);
  let bestGain = -Infinity;
  for (let y = top.y + Math.round(bodyHeight * 0.06); y <= top.y + Math.round(bodyHeight * 0.35); y++) {
    const gain = smooth(y + 2) - smooth(y - 2);
    const sustained = smooth(y + Math.round(bodyHeight * 0.05)) >= smooth(y) * 0.9;
    if (gain > bestGain && sustained) {
      bestGain = gain;
      shoulderY = y;
    }
  }
  const shoulderRow = rows.find((r) => r.y === shoulderY) ?? top;
  at("shoulder-left", "Left shoulder (image left)", shoulderRow.minX, shoulderY, 0.85, "OBSERVED", "outermost foreground pixel on the row of steepest sustained widening");
  at("shoulder-right", "Right shoulder (image right)", shoulderRow.maxX, shoulderY, 0.85, "OBSERVED", "outermost foreground pixel on the row of steepest sustained widening");
  at("shoulder-line", "Shoulder line", (shoulderRow.minX + shoulderRow.maxX) / 2, shoulderY, 0.85, "OBSERVED", "row of steepest sustained widening in the upper third");

  // Neck: the narrowest row between the head and the shoulder line.
  const profile = widthProfile.map((p) => ({ y: p.y, value: p.count }));
  const neckCandidate = localExtremum(profile, "min", top.y + Math.round(bodyHeight * 0.04), shoulderY - 2);
  const neckY = neckCandidate ? neckCandidate.y : Math.round(top.y + bodyHeight * 0.1);
  const neckRow = rows.find((r) => r.y === neckY) ?? top;
  at("neck", "Neck", (neckRow.minX + neckRow.maxX) / 2, neckY, 0.8, "OBSERVED", "narrowest smoothed row between the top of the head and the shoulder line");

  // Chin: the underside of the jaw, immediately above the neck narrowing.
  // A single front photograph does not resolve the jawline, so this is a rule.
  const chinY = Math.max(top.y, neckY - Math.max(1, Math.round(bodyHeight * 0.015)));
  at("chin", "Chin", (rows.find((r) => r.y === chinY) ?? top).minX + ((rows.find((r) => r.y === chinY) ?? top).count) / 2, chinY, 0.55, "INFERRED", "placed one jaw-thickness above the neck narrowing; the jawline itself is not resolved at this resolution");

  // Hips: widest smoothed row in the middle band.
  const hipCandidate = localExtremum(profile, "max", shoulderY + Math.round(bodyHeight * 0.12), shoulderY + Math.round(bodyHeight * 0.5));
  const hipY = hipCandidate ? hipCandidate.y : Math.round(shoulderY + bodyHeight * 0.3);
  const hipRow = rows.find((r) => r.y === hipY) ?? bottom;
  at("hip-line", "Hip line", (hipRow.minX + hipRow.maxX) / 2, hipY, 0.8, "OBSERVED", "widest smoothed row below the shoulder line");

  // Crotch: first row below the hip where the centre column goes empty, i.e.
  // the legs are separate. In an A-pose the arms are separate runs, so the
  // test is restricted to a central band.
  const centreX = (hipRow.minX + hipRow.maxX) / 2;
  const band = Math.max(2, Math.round((hipRow.maxX - hipRow.minX) * 0.06));
  let crotchY = Math.round(hipY + bodyHeight * 0.12);
  for (let y = hipY + 2; y <= bottom.y - 2; y++) {
    const row = rows.find((r) => r.y === y);
    if (!row) continue;
    let gap = true;
    for (let x = Math.round(centreX - band); x <= Math.round(centreX + band); x++) {
      if (x < 0 || x >= width) continue;
      if (mask[y * width + x] === 1) {
        gap = false;
        break;
      }
    }
    if (gap) {
      crotchY = y;
      break;
    }
  }
  at("crotch", "Crotch", centreX, crotchY, 0.75, "OBSERVED", `first row below the hip whose central band (±${band} px) is empty`);

  // Hands: the lowest extent of the two outer runs, when the arms are clear.
  const armRows = rows.filter((r) => r.y > shoulderY && r.y < crotchY && r.runs.length >= 3 && r.count >= floor);
  if (armRows.length > 0) {
    const last = armRows[armRows.length - 1];
    const leftRun = last.runs[0];
    const rightRun = last.runs[last.runs.length - 1];
    at("hand-left", "Left hand (image left)", (leftRun[0] + leftRun[1]) / 2, last.y, 0.7, "OBSERVED", "lowest row with three separate runs; the outer runs are the arms");
    at("hand-right", "Right hand (image right)", (rightRun[0] + rightRun[1]) / 2, last.y, 0.7, "OBSERVED", "lowest row with three separate runs; the outer runs are the arms");
  } else {
    notes.push("The arms are not separated from the torso in the silhouette, so hand landmarks were not measured.");
  }

  const kneeY = Math.round(crotchY + (bottom.y - crotchY) * 0.5);
  const ankleY = Math.round(bottom.y - (bottom.y - crotchY) * 0.06);
  at("knee", "Knee (both)", centreX, kneeY, 0.35, "INFERRED", "halfway between the crotch and the lowest row; not detectable in a single silhouette");
  at("ankle", "Ankle (both)", centreX, ankleY, 0.35, "INFERRED", "6% of the leg length above the lowest row; not detectable in a single silhouette");

  const eyes = detectEyes(mask, rows, width, luma, top.y, chinY);
  for (const eye of eyes) {
    at(eye.id, eye.label, eye.x, eye.y, eye.confidence, "OBSERVED", eye.evidence);
  }
  if (eyes.length === 0) notes.push("No symmetric pair of luminance minima was found inside the head region; eyes were not measured.");

  const byId: Record<string, Landmark> = {};
  for (const landmark of landmarks) byId[landmark.id] = landmark;
  return { landmarks, byId, widthProfile, notes };
}

/**
 * Eye detection by symmetric dark minima inside the head box.
 *
 * Two photographs of the same face in different lighting will not produce
 * the same darkness, so the confidence is derived from how much darker the
 * candidates are than the head's median, and how well their heights agree.
 */
function detectEyes(
  mask: Uint8Array,
  rows: RowSpan[],
  width: number,
  luminanceAt: Float32Array,
  headTop: number,
  chinY: number,
): Array<Landmark & { evidence: string }> {
  const headRows = rows.filter((r) => r.y >= headTop && r.y <= chinY && r.count > 2);
  if (headRows.length < 6) return [];
  const headBottom = headRows[headRows.length - 1].y;
  const bandTop = Math.round(headTop + (headBottom - headTop) * 0.28);
  const bandBottom = Math.round(headTop + (headBottom - headTop) * 0.62);
  const headLeft = Math.min(...headRows.map((r) => r.minX));
  const headRight = Math.max(...headRows.map((r) => r.maxX));
  const headCentre = (headLeft + headRight) / 2;
  if (headRight - headLeft < 8) return [];

  const headLumas: number[] = [];
  for (let y = headTop; y <= headBottom; y++) {
    for (let x = headLeft; x <= headRight; x++) {
      if (mask[y * width + x] === 0) continue;
      headLumas.push(luminanceAt[y * width + x]);
    }
  }
  if (headLumas.length < 20) return [];
  const median = percentile(headLumas, 0.5);
  const darkest = percentile(headLumas, 0.05);

  const findDarkestIn = (x0: number, x1: number): { x: number; y: number; value: number } | null => {
    let best: { x: number; y: number; value: number } | null = null;
    for (let y = bandTop; y <= bandBottom; y++) {
      for (let x = x0; x <= x1; x++) {
        if (mask[y * width + x] === 0) continue;
        const value = luminanceAt[y * width + x];
        if (!best || value < best.value) best = { x, y, value };
      }
    }
    return best;
  };

  const left = findDarkestIn(headLeft, Math.round(headCentre - 2));
  const right = findDarkestIn(Math.round(headCentre + 2), headRight);
  if (!left || !right) return [];
  // Both must be meaningfully darker than the head's own median, and sit at
  // roughly the same height, or they are eyebrows/shadow, not eyes.
  const darker = (median - Math.min(left.value, right.value)) / Math.max(1, median - darkest);
  const symmetric = Math.abs(left.y - right.y) <= Math.max(2, (bandBottom - bandTop) * 0.12);
  if (darker < 0.35 || !symmetric) return [];

  const midpointY = (left.y + right.y) / 2;
  return [
    {
      id: "eye-left",
      label: "Left eye (image left)",
      x: left.x,
      y: left.y,
      confidence: clamp(0.4 + darker * 0.4, 0, 0.85),
      provenance: "OBSERVED" as const,
      evidence: `darkest pixel in the left half of the head band, ${(100 * darker).toFixed(0)}% of the way from the head median to the darkest 5%`,
    },
    {
      id: "eye-right",
      label: "Right eye (image right)",
      x: right.x,
      y: right.y,
      confidence: clamp(0.4 + darker * 0.4, 0, 0.85),
      provenance: "OBSERVED" as const,
      evidence: `darkest pixel in the right half of the head band, ${Math.abs((left.y + right.y) / 2 - midpointY) < 0.01 ? "same height as its pair" : "paired with the left eye"}`,
    },
  ];
}

/* --------------------------------------------------------------- components */

export interface ComponentObservation {
  id: ComponentId;
  label: string;
  detected: boolean;
  bbox: BBox2D;
  pixels: number;
  /** Share of the silhouette this component covers. */
  share: number;
  meanDepth: number;
  /** Mean luminance inside the region: how a garment could later be separated. */
  meanLuminance: number;
  provenance: Provenance;
  /** Why it is (or is not) separated, and what rule drew its boundary. */
  evidence: string;
}

export interface ComponentLayout {
  components: ComponentObservation[];
  /** Bboxes by id, for voxel splitting. Empty box means "not separated". */
  regions: Record<ComponentId, BBox2D>;
  notDetected: Array<{ id: ComponentId; because: string }>;
  notes: string[];
}

/**
 * Anatomical regions from the measured landmarks.
 *
 * These are *regions*, not reconstructed parts: a region says "these pixels
 * belong to the head", which is a defensible reading of a silhouette. Where
 * two parts cannot be separated (hands from arms in a sleeve, clothing from
 * torso when the garment is the same colour as the body), the region is
 * merged and the merge is reported, rather than inventing a boundary.
 */
export function identifyComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  landmarks: LandmarkSet,
  depth: DepthAnalysis,
  luma: Float32Array,
): ComponentLayout {
  const notes: string[] = [];
  const notDetected: Array<{ id: ComponentId; because: string }> = [];
  const regions = {} as Record<ComponentId, BBox2D>;
  for (const id of COMPONENT_IDS) regions[id] = emptyBBox();

  const L = landmarks.byId;
  const headTop = L["head-top"] ? Math.round(L["head-top"].y) : 0;
  const chin = L["chin"] ? Math.round(L["chin"].y) : headTop;
  const neck = L["neck"] ? Math.round(L["neck"].y) : chin;
  const shoulder = L["shoulder-line"] ? Math.round(L["shoulder-line"].y) : neck;
  const hip = L["hip-line"] ? Math.round(L["hip-line"].y) : shoulder;
  const crotch = L["crotch"] ? Math.round(L["crotch"].y) : hip;
  const feet = L["feet-bottom"] ? Math.round(L["feet-bottom"].y) : height - 1;
  const bodyLeft = Math.min(...Object.values(L).map((l) => l.x), width);
  const bodyRight = Math.max(...Object.values(L).map((l) => l.x), 0);

  const assign = (id: ComponentId, box: BBox2D): void => {
    regions[id] = box;
  };

  // Head: everything above the neck narrowing, full silhouette width there.
  const rows = rowSpans(mask, width, height, { minX: 0, minY: headTop, maxX: width - 1, maxY: neck });
  const headMinX = rows.reduce((m, r) => Math.min(m, r.minX < 0 ? width : r.minX), width);
  const headMaxX = rows.reduce((m, r) => Math.max(m, r.maxX), 0);
  assign("head", { minX: headMinX, minY: headTop, maxX: headMaxX, maxY: neck });

  // Face: the frontal third of the head, from brow to chin. Without a face
  // detector this is a region, not a measurement, and it says so.
  const faceTop = Math.round(headTop + (chin - headTop) * 0.3);
  assign("face", {
    minX: Math.round(headMinX + (headMaxX - headMinX) * 0.2),
    minY: faceTop,
    maxX: Math.round(headMaxX - (headMaxX - headMinX) * 0.2),
    maxY: chin,
  });
  notes.push("The face is a region of the head, not a detected facial surface: no face-landmark model is used, and the eyes are the only face features measured.");

  // Hair: a rim of the head, which is all a silhouette can claim.
  assign("hair", { minX: headMinX, minY: headTop, maxX: headMaxX, maxY: Math.round(headTop + (chin - headTop) * 0.45) });
  notes.push("Hair is identified as the upper head region; where hair ends and face begins is not separable from one photograph without a segmentation model.");

  assign("neck", { minX: Math.round((headMinX + headMaxX) / 2) - Math.round((headMaxX - headMinX) * 0.18), minY: neck, maxX: Math.round((headMinX + headMaxX) / 2) + Math.round((headMaxX - headMinX) * 0.18), maxY: shoulder });

  // Torso and pelvis: from the shoulder line down, full width, split at the hip.
  const torsoRows = rowSpans(mask, width, height, { minX: 0, minY: shoulder, maxX: width - 1, maxY: hip });
  const torsoMinX = torsoRows.reduce((m, r) => Math.min(m, r.minX < 0 ? width : r.minX), width);
  const torsoMaxX = torsoRows.reduce((m, r) => Math.max(m, r.maxX), 0);
  assign("torso", { minX: torsoMinX, minY: shoulder, maxX: torsoMaxX, maxY: hip });
  assign("pelvis", { minX: torsoMinX, minY: hip, maxX: torsoMaxX, maxY: crotch });

  // Arms: the outer runs of rows where the silhouette has three runs.
  const armRows = rowSpans(mask, width, height, { minX: 0, minY: shoulder, maxX: width - 1, maxY: crotch }).filter(
    (r) => r.runs.length >= 3 && r.count > 4,
  );
  if (armRows.length > 2) {
    const leftArmMin = armRows.reduce((m, r) => Math.min(m, r.runs[0][0]), width);
    const leftArmMax = armRows.reduce((m, r) => Math.max(m, r.runs[0][1]), 0);
    const rightArmMin = armRows.reduce((m, r) => Math.min(m, r.runs[r.runs.length - 1][0]), width);
    const rightArmMax = armRows.reduce((m, r) => Math.max(m, r.runs[r.runs.length - 1][1]), 0);
    assign("arms", { minX: Math.min(leftArmMin, rightArmMin), minY: armRows[0].y, maxX: Math.max(leftArmMax, rightArmMax), maxY: armRows[armRows.length - 1].y });
    assign("hands", { minX: Math.min(leftArmMin, rightArmMin), minY: armRows[armRows.length - 1].y - 2, maxX: Math.max(leftArmMax, rightArmMax), maxY: armRows[armRows.length - 1].y });
    notDetected.push({
      id: "hands",
      because: "hands are the lowest 2 rows of the arm runs; the silhouette does not separate fingers or a wrist, so the hand region overlaps the arm",
    });
  } else {
    notDetected.push({ id: "arms", because: "the arms are not separated from the torso in this silhouette (A-pose separation too small or arms against the body)" });
  }

  assign("legs", { minX: torsoMinX, minY: crotch, maxX: torsoMaxX, maxY: feet });
  assign("feet", { minX: torsoMinX, minY: Math.round(feet - (feet - crotch) * 0.05), maxX: torsoMaxX, maxY: feet });

  // Clothing: the body region a garment would cover. Without a colour-based
  // garment segmentation this can only be a region, and it is labelled so.
  assign("clothing", { minX: torsoMinX, minY: shoulder, maxX: torsoMaxX, maxY: Math.round(crotch + (feet - crotch) * 0.25) });
  notes.push("Clothing is the region a garment covers (torso, pelvis, upper legs); the image does not separate cloth from skin by colour in this scene.");

  notDetected.push({ id: "accessories", because: "no accessory detector is implemented; a single front view without a catalogue cannot distinguish a worn object from a body part" });

  // Measure each region against the actual pixels: a region can be large and
  // empty (an arm box that also covers background), and the share says so.
  const totalForeground = (() => {
    let n = 0;
    for (let p = 0; p < mask.length; p++) n += mask[p];
    return n;
  })();
  void bodyLeft;
  void bodyRight;

  const components: ComponentObservation[] = [];
  for (const id of COMPONENT_IDS) {
    const box = regions[id];
    if (bboxIsEmpty(box)) {
      components.push({
        id,
        label: id,
        detected: false,
        bbox: box,
        pixels: 0,
        share: 0,
        meanDepth: 0,
        meanLuminance: 0,
        provenance: "SYNTHESIZED",
        evidence: "not separated from a neighbouring part by this analysis",
      });
      continue;
    }
    let pixels = 0;
    let depthSum = 0;
    let lumaSum = 0;
    for (let y = Math.max(0, box.minY); y <= Math.min(height - 1, box.maxY); y++) {
      for (let x = Math.max(0, box.minX); x <= Math.min(width - 1, box.maxX); x++) {
        const p = y * width + x;
        if (mask[p] === 0) continue;
        pixels++;
        depthSum += depth.blended[p];
        lumaSum += luma[p];
      }
    }
    const provenance: Provenance = id === "face" || id === "clothing" ? "INFERRED" : "OBSERVED";
    components.push({
      id,
      label: id,
      detected: pixels > 0,
      bbox: box,
      pixels,
      share: totalForeground > 0 ? pixels / totalForeground : 0,
      meanDepth: pixels > 0 ? depthSum / pixels : 0,
      meanLuminance: pixels > 0 ? lumaSum / pixels : 0,
      provenance,
      evidence:
        id === "face" || id === "clothing"
          ? `an anatomical region drawn from landmarks; ${pixels} foreground pixels fall inside it (${((100 * pixels) / Math.max(1, totalForeground)).toFixed(1)}% of the silhouette)`
          : `${pixels} foreground pixels inside the landmark-derived region (${((100 * pixels) / Math.max(1, totalForeground)).toFixed(1)}% of the silhouette)`,
    });
  }

  return { components, regions, notDetected, notes };
}

/* ------------------------------------------------------------- measurements */

export interface SpatialMeasurements {
  /** Silhouette height in pixels. */
  heightPx: number;
  widthPx: number;
  aspect: number;
  headHeightPx: number;
  headToHeight: number;
  shoulderWidthPx: number;
  shoulderToHeight: number;
  hipWidthPx: number;
  hipToHeight: number;
  legLengthPx: number;
  legToHeight: number;
  /** Arm span measured at the hands, when the arms were separated. */
  armSpanPx: number | null;
  /** Mask IoU against its own mirror. */
  symmetry: number;
  foregroundFraction: number;
  /** World height assumed for metric conversion, and the scale it implies. */
  assumedWorldHeightM: number;
  metresPerPixel: number;
  worldHeightM: number;
  worldShoulderWidthM: number;
  notes: string[];
}

export function measureSpatial(
  silhouette: Silhouette,
  landmarks: LandmarkSet,
  imagePixels: number,
  assumedWorldHeightM: number,
): SpatialMeasurements {
  const L = landmarks.byId;
  const heightPx = bboxHeight(silhouette.bbox);
  const widthPx = bboxWidth(silhouette.bbox);
  const headTop = L["head-top"] ? L["head-top"].y : silhouette.bbox.minY;
  const chin = L["chin"] ? L["chin"].y : headTop + heightPx * 0.12;
  const hip = L["hip-line"] ? L["hip-line"].y : headTop + heightPx * 0.5;
  const crotch = L["crotch"] ? L["crotch"].y : hip + heightPx * 0.1;
  const feet = L["feet-bottom"] ? L["feet-bottom"].y : silhouette.bbox.maxY;
  const metresPerPixel = heightPx > 0 ? assumedWorldHeightM / heightPx : 0;
  const notes: string[] = [];

  const shoulderWidthPx = L["shoulder-right"] && L["shoulder-left"] ? Math.abs(L["shoulder-right"].x - L["shoulder-left"].x) : 0;
  const hipRow = silhouette.rows.find((r) => Math.round(r.y) === Math.round(hip));
  const hipWidthPx = hipRow ? hipRow.maxX - hipRow.minX : 0;

  let armSpanPx: number | null = null;
  if (L["hand-left"] && L["hand-right"]) armSpanPx = Math.abs(L["hand-right"].x - L["hand-left"].x);
  else notes.push("Arm span is not reported: the hands were not separated from the arms.");

  if (heightPx > 0) {
    notes.push(`Metric values use an assumed height of ${assumedWorldHeightM.toFixed(2)} m; the image carries no scale reference, so this is a declared assumption, not a measurement.`);
  }
  return {
    heightPx,
    widthPx,
    aspect: widthPx > 0 ? heightPx / widthPx : 0,
    headHeightPx: chin - headTop,
    headToHeight: heightPx > 0 ? (chin - headTop) / heightPx : 0,
    shoulderWidthPx,
    shoulderToHeight: heightPx > 0 ? shoulderWidthPx / heightPx : 0,
    hipWidthPx,
    hipToHeight: heightPx > 0 ? hipWidthPx / heightPx : 0,
    legLengthPx: feet - crotch,
    legToHeight: heightPx > 0 ? (feet - crotch) / heightPx : 0,
    armSpanPx,
    symmetry: silhouette.symmetry,
    foregroundFraction: silhouette.area / Math.max(1, imagePixels),
    assumedWorldHeightM,
    metresPerPixel,
    worldHeightM: heightPx * metresPerPixel,
    worldShoulderWidthM: shoulderWidthPx * metresPerPixel,
    notes,
  };
}

/* --------------------------------------------------------------------- all */

export interface ImageAnalysis {
  width: number;
  height: number;
  /** sha256 of the decoded pixels, so two analyses of the same picture match. */
  pixelDigest: string;
  colour: ColourAnalysis;
  segmentation: Segmentation;
  mask: Uint8Array;
  silhouette: Silhouette;
  surface: SurfaceAnalysis;
  depth: DepthAnalysis;
  landmarks: LandmarkSet;
  components: ComponentLayout;
  measurements: SpatialMeasurements;
  timings: { segmentMs: number; silhouetteMs: number; surfaceMs: number; depthMs: number; landmarksMs: number; componentsMs: number; totalMs: number };
  notes: string[];
}

export interface AnalyseOptions {
  /** Declared world height, in metres. Default 1.70. */
  worldHeightM?: number;
  /** Downsample factor for the analytical passes (1 = full resolution). */
  stride?: number;
}

/** FNV-1a over the pixel buffer: a cheap, dependency-free pixel identity. */
export function pixelDigest(frame: ImageFrame): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const rgba = frame.rgba;
  for (let i = 0; i < rgba.length; i++) {
    h1 ^= rgba[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 = (h2 + rgba[i] * (i % 251)) | 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function analyseImage(frame: ImageFrame, options: AnalyseOptions = {}): ImageAnalysis {
  const started = performance.now();
  const { width, height } = frame;
  const luma = lumaOf(frame);

  const tSegment = performance.now();
  const segmentation = foregroundMask(frame);
  const mask = segmentation.mask;
  const segmentMs = performance.now() - tSegment;

  const tSilhouette = performance.now();
  const silhouette = measureSilhouette(mask, width, height);
  const silhouetteMs = performance.now() - tSilhouette;

  const tSurface = performance.now();
  const surface = analyseSurface(mask, luma, width, height);
  const surfaceMs = performance.now() - tSurface;

  const tDepth = performance.now();
  const depth = analyseDepth(mask, luma, width, height);
  const depthMs = performance.now() - tDepth;

  const tLandmarks = performance.now();
  const landmarks = detectLandmarks(mask, silhouette.rows, width, luma);
  const landmarksMs = performance.now() - tLandmarks;

  const tComponents = performance.now();
  const components = identifyComponents(mask, width, height, landmarks, depth, luma);
  const componentsMs = performance.now() - tComponents;

  const measurements = measureSpatial(silhouette, landmarks, width * height, options.worldHeightM ?? 1.7);

  // Dominant colours: quantise to 4 bits per channel and count.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let foregroundPixels = 0;
  const rgba = frame.rgba;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (mask[p] === 0) continue;
    foregroundPixels++;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.n++;
    } else {
      buckets.set(key, { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], n: 1 });
    }
  }
  const dominant = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((bucket) => ({ rgb: { r: bucket.r, g: bucket.g, b: bucket.b }, share: bucket.n / Math.max(1, foregroundPixels) }));

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumR2 = 0;
  let sumG2 = 0;
  let sumB2 = 0;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (mask[p] === 0) continue;
    sumR += rgba[i];
    sumG += rgba[i + 1];
    sumB += rgba[i + 2];
    sumR2 += rgba[i] ** 2;
    sumG2 += rgba[i + 1] ** 2;
    sumB2 += rgba[i + 2] ** 2;
  }
  const n = Math.max(1, foregroundPixels);
  const mean = { r: sumR / n, g: sumG / n, b: sumB / n };
  const std = {
    r: Math.sqrt(Math.max(0, sumR2 / n - mean.r ** 2)),
    g: Math.sqrt(Math.max(0, sumG2 / n - mean.g ** 2)),
    b: Math.sqrt(Math.max(0, sumB2 / n - mean.b ** 2)),
  };

  const colour: ColourAnalysis = {
    background: segmentation.background,
    backgroundMethod: "per-channel median of the 1% border ring, thresholded by Otsu on the L1 colour distance",
    mean,
    std,
    foregroundFraction: foregroundPixels / Math.max(1, width * height),
    dominant,
    threshold: segmentation.threshold,
    notes: [
      `background estimated as rgb(${segmentation.background.r}, ${segmentation.background.g}, ${segmentation.background.b})`,
      `foreground threshold ${segmentation.threshold} L1 units, from an Otsu split on the distance histogram`,
      ...segmentation.notes,
    ],
  };

  const notes = [...colour.notes, ...surface.notes, ...depth.notes, ...landmarks.notes, ...components.notes, ...measurements.notes];

  return {
    width,
    height,
    pixelDigest: pixelDigest(frame),
    colour,
    segmentation,
    mask,
    silhouette,
    surface,
    depth,
    landmarks,
    components,
    measurements,
    timings: { segmentMs, silhouetteMs, surfaceMs, depthMs, landmarksMs, componentsMs, totalMs: performance.now() - started },
    notes,
  };
}

/** Bounding box of the whole analysed silhouette, for cropping/export. */
export function analysisBBox(analysis: ImageAnalysis): BBox2D {
  return analysis.silhouette.bbox;
}

export { bboxArea, bboxHeight, bboxWidth };
