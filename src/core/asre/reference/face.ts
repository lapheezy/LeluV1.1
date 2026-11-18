/**
 * ==========================================================
 * LÉLU ASRE — HER FACE, MEASURED ON HER OWN HEAD
 *
 * What made her face read as artificial, and what replaces it:
 *
 *   - Her iris was invisible: the eye was coloured by direction from a
 *     WORLD-space centre while the eye component is built in the head's local
 *     frame, so every vertex was ~1.5 m from "the iris" and came out sclera.
 *     (The provider now evaluates colour in the same frame as the field.)
 *   - Eyes were 24 mm spheres 4 mm behind her lids; the CC0 eye is a 29 mm
 *     globe with its cornea at the lid line. Here: a 29 mm globe on the eye
 *     joint, a real corneal bulge, and an iris with radial fibres, collarette
 *     and limbal ring at 96 × 64 segments — resolution a 2.2 mm sampled
 *     sphere never had.
 *   - Lashes were beads and the liner a straight bar of spheres. Both now
 *     follow her lid MARGIN, which is measured: rays through her head surface
 *     find where her lid ends and her eye begins, column by column.
 *   - Brows were one bar across both eyes (each brow's inner end was 2 mm
 *     from the midline). They are now two arched, tapering brows with hair
 *     strokes and a 2.2 cm glabella, from identity "full, dark, softly arched
 *     brows with a clean tail".
 *   - Skin was one flat colour. It now varies like skin: tone, warmth at the
 *     cheeks and nose, darker around the eyes, pores.
 * ==========================================================
 */
import type { V3 } from "../character/sdf.ts";
import type { Rgb } from "../character/shape.ts";
import type { Mesh } from "../volume/mesh.ts";
import { mergeMeshes, v3 } from "./garment.ts";
import { smoothNormals } from "./surface.ts";
import { sweep } from "./sweep.ts";
import { fbm, MAT } from "./wardrobe.ts";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const srgb2lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

/** Radius of her eyeball: the CC0 eye proxy is 30 mm across on this body. */
export const EYE_R = 0.0145;

/* -------------------------- her head, ray-cast --------------------------- */
/**
 * Front-most head-surface depth along −z at (x, y), from a 2 mm bin grid of
 * her head triangles: exact ray/triangle hits, fast enough to sample a lid.
 */
export class HeadRays {
  private bins = new Map<number, number[]>();
  constructor(private P: Float32Array, private I: Uint32Array, tris: number[]) {
    for (const t of tris) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const x0 = Math.min(P[3 * a], P[3 * b], P[3 * c]), x1 = Math.max(P[3 * a], P[3 * b], P[3 * c]);
      const y0 = Math.min(P[3 * a + 1], P[3 * b + 1], P[3 * c + 1]), y1 = Math.max(P[3 * a + 1], P[3 * b + 1], P[3 * c + 1]);
      for (let i = Math.floor(x0 / 0.002); i <= Math.floor(x1 / 0.002); i++)
        for (let j = Math.floor(y0 / 0.002); j <= Math.floor(y1 / 0.002); j++) {
          const k = i * 100003 + j;
          let l = this.bins.get(k);
          if (!l) this.bins.set(k, (l = []));
          l.push(t);
        }
    }
  }
  /** All hit depths at (x, y), front first. */
  hits(x: number, y: number): number[] {
    const l = this.bins.get(Math.floor(x / 0.002) * 100003 + Math.floor(y / 0.002));
    const out: number[] = [];
    if (!l) return out;
    const P = this.P, I = this.I;
    for (const t of l) {
      const a = I[3 * t], b = I[3 * t + 1], c = I[3 * t + 2];
      const ax = P[3 * a], ay = P[3 * a + 1], bx = P[3 * b], by = P[3 * b + 1], cx = P[3 * c], cy = P[3 * c + 1];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-14) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den, l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 >= 0 && l2 >= 0 && l3 >= 0) out.push(l1 * P[3 * a + 2] + l2 * P[3 * b + 2] + l3 * P[3 * c + 2]);
    }
    return out.sort((p, q) => q - p);
  }
  front(x: number, y: number): number | null {
    const h = this.hits(x, y);
    return h.length ? h[0] : null;
  }
}

export interface EyeRig {
  center: V3;
  side: 1 | -1;
  /** Upper and lower lid margins, inner corner → outer corner, on her skin. */
  upper: V3[];
  lower: V3[];
  /** Height of the upper margin at x (null outside the opening). */
  upperAt: (x: number) => number | null;
  lowerAt: (x: number) => number | null;
  inner: V3;
  outer: V3;
}

/**
 * Her lid opening, measured: at each column x, scanning down from above
 * the eye, the upper margin is where the first surface the ray meets stops
 * being lid (in front of the globe) and becomes the eye itself.
 */
export function measureEye(rays: HeadRays, center: V3, side: 1 | -1): EyeRig {
  const R = EYE_R;
  const globeZ = (x: number, y: number) => {
    const q = R * R - (x - center[0]) ** 2 - (y - center[1]) ** 2;
    return q > 0 ? center[2] + Math.sqrt(q) : -Infinity;
  };
  const open = (x: number, y: number) => {
    const f = rays.front(x, y);
    return f === null || f < globeZ(x, y) + 0.0004;
  };
  const up: V3[] = [], lo: V3[] = [];
  for (let k = -28; k <= 28; k++) {
    const x = center[0] + side * k * 0.0006;
    let top: number | null = null, bot: number | null = null;
    for (let y = center[1] + 0.012; y > center[1] - 0.012; y -= 0.0002) {
      if (open(x, y)) {
        if (top === null) top = y;
        bot = y;
      } else if (top !== null) break;
    }
    if (top === null || bot === null || top - bot < 0.0008) continue;
    const zt = rays.front(x, top + 0.0004) ?? globeZ(x, top), zb = rays.front(x, bot - 0.0004) ?? globeZ(x, bot);
    up.push([x, top + 0.0002, zt]);
    lo.push([x, bot - 0.0002, zb]);
  }
  // inner (toward the nose) first
  const order = (a: V3, b: V3) => side * (a[0] - b[0]);
  up.sort(order);
  lo.sort(order);
  const interp = (pts: V3[]) => (x: number) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if ((x - a[0]) * (x - b[0]) <= 0) return a[1] + ((x - a[0]) / (b[0] - a[0] || 1e-9)) * (b[1] - a[1]);
    }
    return null;
  };
  const inner = up.length ? up[0] : center, outer = up.length ? up[up.length - 1] : center;
  return { center, side, upper: up, lower: lo, upperAt: interp(up), lowerAt: interp(lo), inner, outer };
}

/* ------------------------------- eyeball --------------------------------- */
export interface EyePalette { iris: Rgb; irisRing: Rgb; sclera: Rgb; pupil: Rgb }

/** One eyeball as an explicit mesh, pole along +z (gaze forward), with a corneal bulge. */
export function eyeball(c: V3, pal: EyePalette): Mesh {
  const NU = 96, NV = 64, R = EYE_R;
  const P: number[] = [], C: number[] = [];
  const irisA = Math.asin(0.0062 / R), pupilA = Math.asin(0.0021 / R);
  const dark = mix(pal.iris, pal.irisRing, 0.55), light = mix(pal.iris, [0.6, 0.38, 0.18], 0.3);
  for (let j = 0; j <= NV; j++) {
    const th = (j / NV) * Math.PI;
    for (let i = 0; i < NU; i++) {
      const ph = (i / NU) * Math.PI * 2;
      // cornea: a clear dome over the iris, ~1 mm proud of the globe
      const bulge = 0.0011 * smoothstep(irisA + 0.05, irisA * 0.4, th);
      const r = R + bulge;
      const dir: V3 = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      P.push(c[0] + dir[0] * r, c[1] + dir[1] * r, c[2] + dir[2] * r);
      let col: Rgb;
      if (th < pupilA) col = pal.pupil;
      else if (th < irisA) {
        const u = (th - pupilA) / (irisA - pupilA);
        // radial fibres, a lighter collarette ring, darker toward the limbus
        const fib = 0.5 + 0.5 * Math.sin(ph * 41 + 2.5 * Math.sin(ph * 7 + u * 5));
        col = mix(dark, light, 0.25 + 0.45 * fib * (1 - u * 0.6));
        col = mix(col, light, 0.35 * Math.exp(-(((u - 0.3) / 0.08) ** 2)));
        col = mix(col, pal.irisRing, smoothstep(0.72, 1, u));
      } else if (th < irisA + 0.04) col = pal.irisRing;
      else {
        // sclera: warm, faintly pink toward the corners, never pure white
        const corner = Math.abs(Math.cos(ph)) * smoothstep(0.9, 1.5, th);
        col = mix(pal.sclera, [0.75, 0.55, 0.52], 0.35 * corner);
      }
      C.push(srgb2lin(col[0]), srgb2lin(col[1]), srgb2lin(col[2]), MAT.gloss);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NU; i++) {
      const a = j * NU + i, b = j * NU + ((i + 1) % NU), cc = (j + 1) * NU + i, d = (j + 1) * NU + ((i + 1) % NU);
      if (j > 0) idx.push(a, cc, b);
      if (j < NV - 1) idx.push(b, cc, d);
    }
  // the poles are rings of coincident vertices: weld them so the globe is closed
  const positions = new Float32Array(P), indices = new Uint32Array(idx);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (v < NU) indices[i] = 0;
    else if (v >= NV * NU) indices[i] = NV * NU;
  }
  return { positions, indices, normals: smoothNormals(positions, indices), colors: new Float32Array(C) };
}

/* -------------------------------- lashes --------------------------------- */
/** Lashes growing from the measured margin: long and fanned on the upper lid, short below. */
export function lashes(rig: EyeRig, color: Rgb): { mesh: Mesh; tips: V3[][] } {
  const out: Mesh[] = [];
  const tips: V3[][] = [];
  const lc: [number, number, number, number] = [srgb2lin(color[0]), srgb2lin(color[1]), srgb2lin(color[2]), MAT.hair];
  const grow = (pts: V3[], upper: boolean) => {
    const n = pts.length;
    if (n < 4) return;
    const count = upper ? 46 : 18;
    for (let k = 0; k < count; k++) {
      const u = (k + 0.5) / count;
      const f = u * (n - 1), i = Math.min(n - 2, Math.floor(f));
      const root = v3.add(pts[i], v3.sub(pts[i + 1], pts[i]), f - i);
      // longest toward the outer third, which is what lifts an almond eye
      const len = upper ? 0.0065 + 0.0045 * Math.sin(Math.PI * Math.min(1, u * 1.25)) : 0.0028 + 0.0012 * u;
      const outward = rig.side * (u - 0.35) * (upper ? 0.7 : 0.4);
      const d0: V3 = v3.unit([outward, upper ? 0.25 : -0.3, 1]);
      const d1: V3 = v3.unit([outward * 1.3, upper ? 1.1 : -0.9, 0.55]);
      const row = (k % 2) * 0.0004;
      const a = v3.add(root, [0, upper ? row : -row, -0.0004]);
      const b = v3.add(a, d0, len * 0.5);
      const c = v3.add(b, d1, len * 0.5);
      const m = sweep([a, v3.add(a, d0, len * 0.25), b, v3.add(b, d1, len * 0.25), c], { profile: "round", width: 0.00018, height: 0.00018, sides: 3, scale: (t) => 1 - 0.85 * t });
      const colors = new Float32Array((m.positions.length / 3) * 4);
      for (let v = 0; v < m.positions.length / 3; v++) colors.set(lc, 4 * v);
      out.push({ positions: m.positions, indices: m.indices, normals: smoothNormals(m.positions, m.indices), colors });
      tips.push([a, b, c]);
    }
  };
  grow(rig.upper, true);
  grow(rig.lower, false);
  return { mesh: mergeMeshes(out), tips };
}

/* ---------------------------- her skin and face --------------------------- */
export interface FacePalette {
  skin: Rgb;
  shade: Rgb;
  lip: Rgb;
  lipHighlight: Rgb;
  ink: Rgb;
  brow: Rgb;
}

/**
 * Skin that varies like skin: a low-frequency tone field, pores, and her own
 * warmth. Used for every region of her body so the transitions match.
 */
export function skinTone(x: number, y: number, z: number, skin: Rgb): Rgb {
  const low = fbm(x * 18, y * 18, z * 18, 71, 3) - 0.5;
  const pores = fbm(x * 900, y * 900, z * 900, 73, 1) - 0.5;
  const k = 1 + 0.09 * low + 0.05 * pores;
  return [skin[0] * k * (1 + 0.03 * low), skin[1] * k, skin[2] * k * (1 - 0.03 * low)];
}

export interface FaceLandmarks {
  eyes: [EyeRig, EyeRig];
  mouth: V3;
  head: V3;
  noseTip: V3;
}


/** Her face paint, evaluated in WORLD space: makeup, brows, marks and skin. */
export function faceColour(x: number, y: number, z: number, lm: FaceLandmarks, pal: FacePalette): { c: Rgb; m: number } {
  const [eL, eR] = lm.eyes;
  const eyeY = (eL.center[1] + eR.center[1]) / 2;
  // Every painted feature is placed in HER units: the interpupillary
  // distance (IOD) and her measured lid margins, using the proportions
  // measured on her six frontal references (artifacts/lelu/wp04). Fixed
  // millimetre offsets could not follow her geometry when it was fitted.
  const IOD = Math.abs(eL.center[0] - eR.center[0]) || 0.062;
  const front = z > lm.head[2] + 0.03;
  let c = skinTone(x, y, z, pal.skin);
  if (!front) return { c, m: MAT.skin };

  // warmth: blush on the apples of her cheeks and the tip of her nose; a
  // darker, cooler tone around the eyes
  for (const e of [eL, eR]) {
    const blush = Math.exp(-(((x - (e.center[0] + e.side * 0.006)) / 0.022) ** 2 + ((y - (eyeY - 0.032)) / 0.016) ** 2));
    c = mix(c, [0.56, 0.24, 0.2], 0.22 * blush);
    const orbit = Math.exp(-(((x - e.center[0]) / 0.02) ** 2 + ((y - e.center[1]) / 0.012) ** 2));
    c = mix(c, pal.shade, 0.25 * orbit);
  }
  c = mix(c, [0.55, 0.26, 0.2], 0.18 * Math.exp(-(((x - lm.noseTip[0]) / 0.012) ** 2 + ((y - lm.noseTip[1]) / 0.01) ** 2)));

  // lips: berry, a darker liner at the edge, gloss through the centre
  const mo = lm.mouth;

  // vermilion: upper 0.133 IOD at the bow (0.82 of the ellipse), lower 0.190 IOD, half-width 0.37 IOD
  const lu = (x - mo[0]) / (0.37 * IOD), lv = (y - mo[1]) / (y > mo[1] ? (0.133 * IOD) / 0.82 : 0.19 * IOD);
  const bow = y > mo[1] ? 0.18 * Math.exp(-((lu / 0.18) ** 2)) : 0;
  const lipR = Math.hypot(lu * (1 + 0.15 * lu * lu), lv + bow);
  // inside her mouth: within the inner lip ellipse and behind the lip line
  // (the corners are as deep as the interior, so depth alone is not enough)
  if (lipR < 0.8 && Math.abs(y - mo[1]) < 0.045 * IOD && z < mo[2] - 0.0025) return { c: [0.12, 0.035, 0.04], m: MAT.skin };
  if (lipR < 1 && z > mo[2] - 0.006) {
    let lc = mix(pal.lip, pal.ink, 0.35 * smoothstep(0.78, 1, lipR));
    // a soft highlight on the lower lip; the gloss itself is the material
    const gloss = Math.exp(-((lu / 0.45) ** 2 + ((y - (mo[1] - 0.09 * IOD)) / (0.07 * IOD)) ** 2));
    lc = mix(lc, pal.lipHighlight, 0.28 * gloss);
    return { c: mix(c, lc, smoothstep(1, 0.9, lipR)), m: MAT.gloss };
  }

  for (const e of [eL, eR]) {
    const s = e.side, ex = e.center[0], ey = e.center[1];
    // brows: inner end 1.1 cm from the midline, arch at 2/3, a clean tail
    // brows: inner end 0.18 IOD from the midline, tail 0.48 IOD past the pupil,
    // peak 0.40 IOD over the upper lid (her references)
    const lidTop = e.upper.length ? Math.max(...e.upper.map((q) => q[1])) : ey + 0.09 * IOD;
    const inner = s * 0.18 * IOD, tail = ex + s * 0.48 * IOD;
    const u = (x - inner) / (tail - inner);
    if (u > -0.05 && u < 1.05) {
      const uu = Math.max(0, Math.min(1, u));
      const th = IOD * (0.094 * (1 - uu) + 0.055 * uu - 0.039 * smoothstep(0.7, 1, uu));
      // the brow's centre line peaks 0.40 IOD over the lid at 2/3 of its length
      // (0.358, not 0.40: the detector's brow landmark sits on the brow's upper
      // edge, 0.042 IOD above the centre line; calibrated once on her head)
      const base = lidTop + IOD * (0.258 + 0.1 * Math.sin(Math.PI * Math.min(1, uu / 0.66) * 0.5) - 0.137 * smoothstep(0.66, 1, uu)) - th * 0.5;
      const dy = y - base;
      if (dy > -0.0006 && dy < th + 0.0006) {
        // hair strokes angled up and out, feathered at the edges
        const stroke = 0.5 + 0.5 * Math.sin((x * s * 0.6 - y) * 2600 + fbm(x * 400, y * 400, 0, 77, 1) * 6);
        const edge = smoothstep(-0.0006, 0.0005, dy) * smoothstep(th + 0.0006, th - 0.0005, dy) * smoothstep(-0.05, 0.06, u) * smoothstep(1.05, 0.92, u);
        c = mix(c, pal.brow, edge * (0.62 + 0.38 * stroke));
        return { c, m: MAT.skin };
      }
    }
    // winged liner along her measured upper lid margin, flicking up at the outer corner
    if (e.upper.length > 3) {
      const ux = e.upperAt(x);
      if (ux !== null && y >= ux - 0.0003) {
        const t = Math.abs(x - e.inner[0]) / (Math.abs(e.outer[0] - e.inner[0]) || 1);
        const w = 0.0006 + 0.0016 * smoothstep(0.2, 1, t);
        if (y - ux < w) return { c: mix(c, pal.ink, 0.92), m: MAT.skin };
        // lid shade between liner and crease, a soft rose-bronze
        if (y - ux < 0.0075) c = mix(c, [0.34, 0.17, 0.14], 0.4 * smoothstep(0.0075, w, y - ux));
      }
      // the wing: from the outer corner up and out, tapering to a point
      const o = e.outer;
      const wx = (x - o[0]) * s, wy = y - o[1];
      if (wx > -0.001 && wx < 0.0085) {
        const lineY = wx * 0.5 + 0.0008;
        const half = 0.0011 * (1 - wx / 0.0085);
        if (Math.abs(wy - lineY) < half) return { c: mix(c, pal.ink, 0.92), m: MAT.skin };
      }
      // fine lower liner, smudged toward the outer half
      const lx = e.lowerAt(x);
      if (lx !== null && y <= lx + 0.0002 && lx - y < 0.0007 * (0.4 + Math.abs(x - e.inner[0]) / (Math.abs(e.outer[0] - e.inner[0]) || 1))) return { c: mix(c, pal.ink, 0.6), m: MAT.skin };
    }
    // star marks high on the cheekbone, under the outer corner (ref10)
    const sx = ex + s * 0.012, sy = ey - 0.021;
    const r = Math.hypot(x - sx, y - sy), a = Math.atan2(y - sy, x - sx);
    if (r < 0.0042 * (0.42 + 0.58 * Math.pow(Math.abs(Math.cos(2.5 * a + Math.PI / 2)), 2.2))) return { c: mix(c, pal.ink, 0.85), m: MAT.skin };
    const s2x = ex + s * 0.021, s2y = ey - 0.03;
    if (Math.hypot(x - s2x, y - s2y) < 0.0017 * (0.45 + 0.55 * Math.abs(Math.cos(2.5 * Math.atan2(y - s2y, x - s2x) + Math.PI / 2)))) return { c: mix(c, pal.ink, 0.8), m: MAT.skin };
  }

  // (her forehead and temple swirls are laid baby hairs: real strand
  // geometry in hairArch.ts, no longer painted ink)
  // freckles across her nose and cheeks: sparse, soft, 1–1.5 mm
  if (y < eyeY - 0.012 && y > lm.mouth[1] + 0.015 && Math.abs(x) < 0.055) {
    const g = 0.0042;
    const i = Math.floor(x / g), j = Math.floor(y / g);
    const fx = (i + fbm(i * 0.37, j * 0.37, 1, 81, 1)) * g, fy = (j + fbm(i * 0.41, j * 0.41, 2, 83, 1)) * g;
    if (fbm(i * 1.3, j * 1.3, 3, 85, 1) > 0.62 && Math.hypot(x - fx, y - fy) < 0.0007) c = mix(c, pal.shade, 0.55);
  }
  return { c, m: MAT.skin };
}

/**
 * Her tattoos (identity: "ornamental filigree across collarbones and chest;
 * rose and filigree tattoos on hands and forearms"): fine line art, not
 * stripes. Chest: mirrored scrolls along each collarbone and a filigree
 * crest at the sternum. Forearms: two intertwined vines with leaves.
 */
export function tattoo(x: number, y: number, z: number, skin: Rgb, ink: Rgb, where: "chest" | "forearm" | "hand", J: (n: string) => V3, n?: V3): Rgb | null {
  const line = (d: number, w: number) => smoothstep(w, w * 0.4, d);
  if (where === "hand") {
    // a rose on the back of each hand, over the metacarpals (ref04)
    const l = x > 0 ? "l" : "r";
    const wr = J(`joint-${l}-hand`), k3 = J(`joint-${l}-finger-3-1`), k2 = J(`joint-${l}-finger-2-1`), k5 = J(`joint-${l}-finger-5-1`);
    const c = v3.add(wr, v3.sub(k3, wr), 0.55);
    // the back of a hanging hand faces AWAY from her body; the cross product's
    // sign flips between the mirrored hands, so orient it explicitly
    let back = v3.unit(v3.cross(v3.sub(k2, k5), v3.sub(wr, k3)));
    if (back[0] * Math.sign(x) < 0) back = [-back[0], -back[1], -back[2]];
    const q = v3.sub([x, y, z], c);
    const h = v3.dot(q, back);
    if (h < 0) return null;
    const along = v3.unit(v3.sub(k3, wr)), across = v3.cross(back, along);
    const u = v3.dot(q, across), w = v3.dot(q, along);
    const r = Math.hypot(u, w);
    if (r > 0.016) return null;
    const a = Math.atan2(w, u);
    // spiral petals and a ring of outer petals, in line work
    const spiral = Math.abs(((r / 0.0034 - a / (2 * Math.PI)) % 1 + 1) % 1 - 0.5);
    const outer = Math.abs(r - 0.012 * (1 + 0.16 * Math.cos(5 * a)));
    const k = Math.max(r < 0.0095 ? line(spiral * 0.0034, 0.00105) : line(outer, 0.0011), 0.35 * smoothstep(0.0095, 0.0085, r));
    void n;
    return k > 0.02 ? mix(skin, ink, 0.75 * k) : null;
  }
  if (where === "chest") {
    if (z < 0.03) return null;
    const collarY = J("joint-l-shoulder")[1] - 0.035;
    const ax = Math.abs(x);
    let k = 0;
    // scroll along the collarbone: a wave with curling ends
    if (ax > 0.03 && ax < 0.13) {
      const wave = collarY - 0.012 - 0.008 * Math.sin((ax - 0.03) * 60) - 0.025 * ((ax - 0.08) / 0.05) ** 2;
      k = Math.max(k, line(Math.abs(y - wave), 0.0007));
      for (const cx of [0.05, 0.1]) {
        const px = ax - cx, py = y - (wave - 0.008);
        const r = Math.hypot(px, py);
        if (r < 0.007) {
          const a = Math.atan2(py, px) + Math.PI;
          k = Math.max(k, line(Math.abs(r - (0.007 * a) / (2 * Math.PI * 1.4)), 0.0006));
        }
      }
    }
    // sternum crest: a small mirrored rosette
    const cy = collarY - 0.05;
    const r = Math.hypot(x, y - cy), a = Math.atan2(y - cy, ax);
    if (r < 0.026) k = Math.max(k, line(Math.abs(r - 0.014 * (1 + 0.45 * Math.cos(3 * a))), 0.0006), line(Math.abs(r - 0.006), 0.0005));
    return k > 0.02 ? mix(skin, ink, 0.75 * k) : null;
  }
  // forearm vines, along the forearm between elbow and wrist
  const side = x > 0 ? "l" : "r";
  const el = J(`joint-${side}-elbow`), w = J(`joint-${side}-hand`);
  const axis = v3.sub(w, el);
  const L = v3.len(axis);
  const ad = v3.unit(axis);
  const p: V3 = [x - el[0], y - el[1], z - el[2]];
  const s = v3.dot(p, ad) / L;
  if (s < 0.15 || s > 0.92) return null;
  const radial = v3.sub(p, [ad[0] * s * L, ad[1] * s * L, ad[2] * s * L]);
  const ref = v3.unit(v3.cross(ad, [0, 0, 1]));
  const th = Math.atan2(v3.dot(radial, v3.cross(ad, ref)), v3.dot(radial, ref));
  let k = 0;
  for (const ph of [0, Math.PI]) {
    const vine = 0.55 * Math.sin(s * L * 70 + ph);
    const d = Math.abs(((th - vine + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.035;
    k = Math.max(k, line(d, 0.0008));
    // leaves at the vine's crests
    const crest = (s * L * 70 + ph) / Math.PI;
    const ci = Math.round(crest);
    const lsx = ((ci * Math.PI - ph) / 70) / L;
    const lth = 0.55 * Math.sin(ci * Math.PI) + (ci % 2 ? 0.35 : -0.35);
    const ds = (s - lsx) * L, dth = (((th - lth + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.035;
    if (Math.hypot(ds / 0.006, dth / 0.0028) < 1) k = Math.max(k, 0.7);
  }
  return k > 0.02 ? mix(skin, ink, 0.72 * k) : null;
}
