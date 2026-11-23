/**
 * ==========================================================
 * LÉLU ASRE — SILHOUETTE RECONSTRUCTION (TS-native, CPU, offline)
 *
 * The reconstruction path that needs nothing but this repository:
 * no Python, no weights, no network. It turns one or more views of
 * an object into NRE grids whose every cell says how it is known.
 *
 *   image → foreground mask (alpha, or distance from the border colour)
 *         → normalised silhouette (object height = N cells)
 *         → competing depth hypotheses from ONE view:
 *              inflation  depth ∝ distance to the silhouette edge
 *              ellipse    elliptical cross-section per row (depth/width 0.6)
 *              slab       constant thickness
 *         → each hypothesis is an NRE grid with three observations:
 *              OBSERVED   visible-surface cells inside the silhouette
 *              INFERRED   the near half of the prior's depth
 *              GENERATED  the far (unseen) half of the prior's depth
 *         → more views refine it through the Flipbook (see observeView)
 *
 * Frame: Y up, right-handed; the object stands on y = 0, centred on
 * x = z = 0. Views are orthographic and share the vertical axis:
 *   front  camera on +Z (image right = +X)    back   camera on −Z
 *   right  camera on +X (image right = −Z)    left   camera on −X
 * Real-world scale is UNKNOWN from a photo; it is assumed (default
 * 1 m tall) and reported as an assumption.
 * ==========================================================
 */

import { mortonDecode } from "../nre/morton.ts";
import { noisyOr, SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import { Provenance } from "../nre/types.ts";
import type { Observation, Vec3 } from "../nre/types.ts";
import type { RgbaImage } from "../image/png.ts";

export type ViewName = "front" | "back" | "left" | "right";
export const VIEWS: readonly ViewName[] = ["front", "back", "left", "right"];

export interface Silhouette {
  view: ViewName;
  /** N×N cells, row 0 at the bottom (v up), column 0 at image left. 1 = object. */
  mask: Uint8Array;
  n: number;
  /** Mean RGB of the object pixels in each cell (0..1), for colouring. */
  color: Float32Array;
  /** Fraction of image pixels classified as object. */
  coverage: number;
  /** How the mask was obtained. */
  method: "alpha" | "background-distance";
  /** Source pixel box (x0, y0, x1, y1) of the object. */
  bbox: [number, number, number, number];
}

export class ReconstructionInputError extends Error {}

/** Foreground mask of an image: its alpha when it has one, else distance from the border colour. */
export function foregroundMask(img: RgbaImage, threshold = 0.12): { mask: Uint8Array; method: Silhouette["method"] } {
  const { width: w, height: h, data } = img;
  const mask = new Uint8Array(w * h);
  let transparent = 0;
  for (let i = 0; i < w * h; i++) if (data[4 * i + 3] < 128) transparent++;
  if (transparent > 0.01 * w * h) {
    for (let i = 0; i < w * h; i++) mask[i] = data[4 * i + 3] >= 128 ? 1 : 0;
    return { mask, method: "alpha" };
  }
  // background = median of the border pixels
  const border: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    for (let c = 0; c < 3; c++) border[c].push(data[4 * (y * w + x) + c]);
  };
  for (let x = 0; x < w; x++) {
    take(x, 0);
    take(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    take(0, y);
    take(w - 1, y);
  }
  const bg = border.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  const t = threshold * 255 * Math.sqrt(3);
  for (let i = 0; i < w * h; i++) {
    const d = Math.hypot(data[4 * i] - bg[0], data[4 * i + 1] - bg[1], data[4 * i + 2] - bg[2]);
    mask[i] = d > t ? 1 : 0;
  }
  return { mask, method: "background-distance" };
}

/** Normalise one view: crop to the object, scale its height to n cells, centre it horizontally. */
export function silhouetteOf(img: RgbaImage, view: ViewName, n: number): Silhouette {
  const { width: w, height: h, data } = img;
  const { mask, method } = foregroundMask(img);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (count < 16) throw new ReconstructionInputError(`the ${view} image shows no object: no foreground pixels were found (needs transparency or a plain background)`);
  if (count > 0.97 * w * h) throw new ReconstructionInputError(`the ${view} image has no separable background: the object fills the frame`);
  const s = (y1 - y0 + 1) / n; // source pixels per cell
  const cx = (x0 + x1 + 1) / 2;
  const out = new Uint8Array(n * n);
  const color = new Float32Array(n * n * 3);
  for (let v = 0; v < n; v++)
    for (let u = 0; u < n; u++) {
      // cell (u, v) covers source pixels [px0, px1) × [py0, py1)
      const px0 = cx + (u - n / 2) * s, px1 = px0 + s;
      const py1 = y1 + 1 - v * s, py0 = py1 - s;
      let inside = 0, total = 0, r = 0, g = 0, b = 0;
      const step = Math.max(1, Math.floor(s / 3));
      for (let py = Math.floor(py0); py < Math.ceil(py1); py += step)
        for (let px = Math.floor(px0); px < Math.ceil(px1); px += step) {
          total++;
          if (px < 0 || py < 0 || px >= w || py >= h) continue;
          const i = py * w + px;
          if (!mask[i]) continue;
          inside++;
          r += data[4 * i];
          g += data[4 * i + 1];
          b += data[4 * i + 2];
        }
      if (total && inside * 2 >= total) {
        out[v * n + u] = 1;
        color.set([r / inside / 255, g / inside / 255, b / inside / 255], 3 * (v * n + u));
      }
    }
  return { view, mask: out, n, color, coverage: count / (w * h), method, bbox: [x0, y0, x1, y1] };
}

/* ------------------------------- projection ------------------------------- */

/** Where a cell projects in a view: (u, v) and its depth toward the camera (larger = nearer). */
export function project(view: ViewName, n: number, x: number, y: number, z: number): { u: number; v: number; near: number } {
  switch (view) {
    case "front":
      return { u: x, v: y, near: z };
    case "back":
      return { u: n - 1 - x, v: y, near: n - 1 - z };
    case "right":
      return { u: n - 1 - z, v: y, near: x };
    case "left":
      return { u: z, v: y, near: n - 1 - x };
  }
}

/** The cell at (u, v, near) of a view — inverse of `project`. */
export function unproject(view: ViewName, n: number, u: number, v: number, near: number): Vec3 {
  switch (view) {
    case "front":
      return [u, v, near];
    case "back":
      return [n - 1 - u, v, n - 1 - near];
    case "right":
      return [near, v, n - 1 - u];
    case "left":
      return [n - 1 - near, v, u];
  }
}

/** Unit vector from the object toward the camera of a view (grid axes). */
export function viewDirection(view: ViewName): Vec3 {
  return ({ front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0] } as Record<ViewName, Vec3>)[view];
}

/* -------------------------------- hypotheses -------------------------------- */

export type HypothesisId = "inflation" | "ellipse" | "slab";
export const HYPOTHESES: Record<HypothesisId, { label: string; method: string }> = {
  inflation: { label: "Inflated silhouette", method: "depth ∝ √(distance to the silhouette edge) — round where the outline is wide, thin at its edges" },
  ellipse: { label: "Elliptical sections", method: "each row's span gets an elliptical cross-section, depth/width 0.6" },
  slab: { label: "Constant-thickness slab", method: "uniform thickness of 0.3 × the object's width (a relief)" },
};

/** 2D chamfer distance (in cells) from each inside cell to the nearest outside cell. */
export function distanceInside(mask: Uint8Array, n: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) d[i] = mask[i] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  const at = (u: number, v: number) => (u < 0 || v < 0 || u >= n || v >= n ? 0 : d[v * n + u]);
  for (let v = 0; v < n; v++)
    for (let u = 0; u < n; u++) {
      const i = v * n + u;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(u - 1, v) + a, at(u, v - 1) + a, at(u - 1, v - 1) + b, at(u + 1, v - 1) + b);
    }
  for (let v = n - 1; v >= 0; v--)
    for (let u = n - 1; u >= 0; u--) {
      const i = v * n + u;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(u + 1, v) + a, at(u, v + 1) + a, at(u + 1, v + 1) + b, at(u - 1, v + 1) + b);
    }
  return d;
}

/** Half-depth (cells) of the object at each silhouette cell under a hypothesis. */
export function halfDepths(sil: Silhouette, id: HypothesisId): Float32Array {
  const { mask, n } = sil;
  const out = new Float32Array(n * n);
  if (id === "inflation") {
    const dt = distanceInside(mask, n);
    let max = 0;
    for (const v of dt) if (v > max) max = v;
    for (let i = 0; i < n * n; i++) if (mask[i]) out[i] = Math.max(0.5, Math.sqrt(Math.max(0, dt[i] * (2 * max - dt[i]))) * 0.85);
  } else if (id === "ellipse") {
    for (let v = 0; v < n; v++) {
      let u = 0;
      while (u < n) {
        if (!mask[v * n + u]) {
          u++;
          continue;
        }
        const a = u;
        while (u < n && mask[v * n + u]) u++;
        const b = u - 1, c = (a + b) / 2, w = (b - a + 1) / 2;
        for (let k = a; k <= b; k++) {
          const t = (k - c) / w;
          out[v * n + k] = Math.max(0.5, 0.6 * w * Math.sqrt(Math.max(0, 1 - t * t)));
        }
      }
    }
  } else {
    let u0 = n, u1 = -1;
    for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) if (mask[v * n + u]) [u0, u1] = [Math.min(u0, u), Math.max(u1, u)];
    const t = Math.max(0.5, 0.15 * (u1 - u0 + 1));
    for (let i = 0; i < n * n; i++) if (mask[i]) out[i] = t;
  }
  return out;
}

export interface ReconstructionFrame {
  n: number;
  /** Assumed height of the object in metres (scale is not observable from one photo). */
  heightMeters: number;
}

export function gridSpecFor(frame: ReconstructionFrame) {
  const h = frame.heightMeters / frame.n;
  return { resolution: h, origin: [-(frame.n / 2) * h, 0, -(frame.n / 2) * h] as Vec3, dims: [frame.n, frame.n, frame.n] as Vec3, coordinateSystem: "y-up-right-handed" as const };
}

export interface ViewEvidence {
  view: ViewName;
  /** Content fingerprint of the input image (hex SHA-256). */
  imageSha256: string;
  source: string;
  capturedAt: number;
}

const obs = (id: string, ev: ViewEvidence, provenance: Observation["provenance"], confidence: number, modality: Observation["modality"], parameters: Observation["parameters"], tag: string): Observation => ({
  id,
  capturedAt: ev.capturedAt,
  source: ev.source,
  modality,
  provenance,
  confidence,
  parameters,
  fingerprint: `${tag}:${ev.imageSha256}`,
  lineage: [`sha256:${ev.imageSha256}`, `view:${ev.view}`],
});

/** One hypothesis → an NRE grid (OBSERVED visible surface, INFERRED near half, GENERATED far half). */
export function hypothesisGrid(sil: Silhouette, id: HypothesisId, frame: ReconstructionFrame, ev: ViewEvidence): SparseVoxelGrid {
  const n = frame.n;
  const g = new SparseVoxelGrid(gridSpecFor(frame));
  const hd = halfDepths(sil, id);
  const seen = g.addObservation(obs(`silhouette:${ev.view}`, ev, "OBSERVED", 0.9, "silhouette", { view: ev.view, rule: "visible-surface cell inside the silhouette" }, `silhouette:${ev.view}`)).index;
  const near = g.addObservation(obs(`${id}:near:${ev.view}`, ev, "INFERRED", 0.6, "silhouette", { hypothesis: id, half: "near" }, `${id}:near:${ev.view}`)).index;
  const far = g.addObservation(obs(`${id}:far:${ev.view}`, ev, "SYNTHESIZED", 0.4, "procedural", { hypothesis: id, half: "far" }, `${id}:far:${ev.view}`)).index;
  const mid = (n - 1) / 2;
  for (let v = 0; v < n; v++)
    for (let u = 0; u < n; u++) {
      const i = v * n + u;
      if (!sil.mask[i]) continue;
      const d = hd[i];
      const lo = Math.max(0, Math.round(mid - d)), hi = Math.min(n - 1, Math.round(mid + d));
      for (let k = lo; k <= hi; k++) {
        const [x, y, z] = unproject(sil.view, n, u, v, k);
        g.addEvidence(x, y, z, k >= mid ? near : far);
      }
      const [x, y, z] = unproject(sil.view, n, u, v, hi);
      g.addEvidence(x, y, z, seen);
    }
  return g;
}

/* ------------------------------ multi-view pages ------------------------------ */

export interface ViewPages {
  /** OBSERVED: the nearest cell under each silhouette pixel, plus free space outside the silhouette. */
  surface: { occupied: Array<{ x: number; y: number; z: number; p?: number }>; free: Vec3[]; observation: Observation };
  /** INFERRED: cells behind a newly seen surface that every silhouette allows (visual hull). */
  hull: { occupied: Array<{ x: number; y: number; z: number; p?: number }>; observation: Observation };
}

/**
 * A new view of the same object as two Flipbook pages:
 *   surface   OBSERVED — under each silhouette pixel, the nearest current cell;
 *             where the current state has nothing under the pixel (the view
 *             shows more object than the prior had), the nearest cell every
 *             earlier silhouette allows. Free space = current cells that
 *             project OUTSIDE the silhouette (the camera saw through them).
 *   hull      INFERRED — the cells behind those newly seen surfaces that every
 *             silhouette allows: two views agree, but neither saw them.
 */
export function viewPages(state: SparseVoxelGrid, sil: Silhouette, earlier: Silhouette[], frame: ReconstructionFrame, ev: ViewEvidence): ViewPages {
  const n = frame.n;
  const free: Vec3[] = [];
  const nearest = new Int32Array(n * n).fill(-1);
  for (const [, , , xyz] of cellsOf(state)) {
    const [x, y, z] = xyz;
    const { u, v, near } = project(sil.view, n, x, y, z);
    const i = v * n + u;
    if (!sil.mask[i]) free.push([x, y, z]);
    else if (near > nearest[i]) nearest[i] = near;
  }
  const surface: ViewPages["surface"]["occupied"] = [];
  const hull: ViewPages["hull"]["occupied"] = [];
  const allowed = (x: number, y: number, z: number) =>
    earlier.every((e) => {
      const p = project(e.view, n, x, y, z);
      return e.mask[p.v * n + p.u] === 1;
    });
  for (let v = 0; v < n; v++)
    for (let u = 0; u < n; u++) {
      const i = v * n + u;
      if (!sil.mask[i]) continue;
      if (nearest[i] >= 0) {
        const [x, y, z] = unproject(sil.view, n, u, v, nearest[i]);
        surface.push({ x, y, z });
        continue;
      }
      let first = true;
      for (let k = n - 1; k >= 0; k--) {
        const [x, y, z] = unproject(sil.view, n, u, v, k);
        if (!allowed(x, y, z)) continue;
        if (first) surface.push({ x, y, z });
        else hull.push({ x, y, z });
        first = false;
      }
    }
  return {
    surface: { occupied: surface, free, observation: obs(`silhouette:${ev.view}`, ev, "OBSERVED", 0.9, "silhouette", { view: ev.view, rule: "nearest cell under each silhouette pixel; free space outside it" }, `silhouette:${ev.view}`) },
    hull: { occupied: hull, observation: obs(`hull:${ev.view}`, ev, "INFERRED", 0.6, "silhouette", { view: ev.view, rule: "behind a newly seen surface, inside every silhouette" }, `hull:${ev.view}`) },
  };
}

/**
 * A silhouette sees a RAY, not a depth: its OBSERVED support belongs to the
 * nearest occupied cell under each of its pixels. After new geometry has
 * been added (or carved), that nearest cell can change; this moves each
 * view's silhouette evidence to the current nearest cells and strips it
 * from cells that are now hidden behind others. Other evidence is kept.
 */
export function resurface(state: SparseVoxelGrid, silhouettes: Silhouette[], n: number): { grid: SparseVoxelGrid; stripped: number; attached: number } {
  const grid = state.clone();
  const observations = grid.getObservations();
  let stripped = 0, attached = 0;
  for (const s of silhouettes) {
    const idx = observations.findIndex((o) => o.id === `silhouette:${s.view}`);
    if (idx < 0) continue;
    const nearest = new Int32Array(n * n).fill(-1);
    for (const [x, y, z] of grid.coords()) {
      const p = project(s.view, n, x, y, z);
      if (s.mask[p.v * n + p.u] && p.near > nearest[p.v * n + p.u]) nearest[p.v * n + p.u] = p.near;
    }
    for (const [code, cell] of [...grid.entries()]) {
      const e = cell.evidence.find((v) => v.obs === idx);
      if (!e) continue;
      const [x, y, z] = mortonDecode(code);
      const p = project(s.view, n, x, y, z);
      if (nearest[p.v * n + p.u] === p.near) continue;
      const evidence = cell.evidence.filter((v) => v.obs !== idx);
      let provenance = 0;
      for (const v of evidence) provenance |= Provenance[observations[v.obs].provenance];
      grid.setCellByCode(code, { evidence, provenance, confidence: noisyOr(evidence.map((v) => v.p)) });
      stripped++;
    }
    for (let i = 0; i < n * n; i++) {
      if (nearest[i] < 0) continue;
      const [x, y, z] = unproject(s.view, n, i % n, Math.floor(i / n), nearest[i]);
      if (grid.get(x, y, z)!.evidence.some((v) => v.obs === idx)) continue;
      grid.addEvidence(x, y, z, idx);
      attached++;
    }
  }
  return { grid, stripped, attached };
}

/** Every occupied cell of a grid as [code, confidence, provenance, xyz]. */
export function* cellsOf(g: SparseVoxelGrid): Generator<[number, number, number, Vec3]> {
  for (const [code, cell] of g.entries()) {
    const xyz = mortonXyz(code);
    yield [code, cell.confidence, cell.provenance, xyz];
  }
}

const mortonXyz = (code: number): Vec3 => mortonDecode(code) as Vec3;
