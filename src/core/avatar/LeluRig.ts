/**
 * ==========================================================
 * LÉLU — HER CHARACTER RIG
 *
 * LÉLU's appearance is the reference the owner supplied, not a stand-in:
 * each look (public/avatar/lelu/<look>/) is that reference with its
 * background removed (body.webp, alpha) plus the landmarks found on it
 * (rig.json: eyes, irises, brows, mouth, chin, head, neck, chest, feet,
 * earrings) — built by scripts/avatar/build_lelu_look.py.
 *
 * She is animated by warping that image on the GPU, in real time, from
 * those landmarks: eyelids close over her eyes, her irises move, brows
 * lift, lips part to show the inside of her mouth, corners smile, her
 * head tilts and turns on her neck with her hair and hoops, the hoops
 * swing, her chest breathes and her body sways from the feet. One
 * fragment shader (below) does all of it, for every surface: a plain
 * WebGL canvas (the companion overlay, the Avatar panel) and a three.js
 * material in the Cosmos scene share the same GLSL and the same
 * animation state (LeluAnimation).
 *
 * Why not a rigged 3D mesh: a photoreal 3D LÉLU needs an image-to-3D
 * reconstruction and a facial rig (blendshapes) built from her reference
 * — no such service or asset exists in this project (the Meshy path has
 * no key, and its meshes carry no face rig). Warping the reference keeps
 * her exactly as she looks. A rigged GLB can replace the renderer later
 * and read the same AnimationParams.
 * ==========================================================
 */

import type { AnimationParams } from "./LeluAnimation";

export type LeluLookId = "gothic" | "earthy";

export const LELU_LOOKS: ReadonlyArray<{ id: LeluLookId; label: string }> = [
  { id: "gothic", label: "Gothic lace" },
  { id: "earthy", label: "Earthy" },
];

export type LeluFraming = "full" | "face";
export type LeluForm = "embodied" | "hologram";

type Ellipse = [number, number, number, number]; // cx, cy, rx, ry (image px)
type Point = [number, number];

export interface LeluRigData {
  name: string;
  size: [number, number];
  eyes: Record<"left" | "right", { ellipse: Ellipse; iris: [number, number, number] }>;
  brows: Record<"left" | "right", Ellipse>;
  mouth: {
    left: Point;
    right: Point;
    center: Point;
    /** Inner lip edges at the centre (parted lips show her teeth between them). */
    upperInner?: Point;
    lowerInner?: Point;
    lipHeight: number;
  };
  chin: Point;
  face: Ellipse;
  head: Ellipse;
  neck: Point;
  chest: Ellipse;
  shoulders: [number, number, number, number];
  feet: Point;
  top: number;
  bottom: number;
  /** Hook x, hook y, hoop radius; radius 0 = no visible hoop. */
  earrings: Record<"left" | "right", [number, number, number]>;
  /** A hand resting on her face moves with her head. */
  hand?: [number, number, number];
  /** How freely her head moves in this pose (1 = freely). */
  headMotion?: number;
}

export interface LoadedLook {
  id: LeluLookId;
  rig: LeluRigData;
  image: HTMLImageElement;
}

export function lookUrl(id: LeluLookId, file: "rig.json" | "body.webp"): string {
  const base = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  return `${base.endsWith("/") ? base : `${base}/`}avatar/lelu/${id}/${file}`;
}

const looks = new Map<LeluLookId, Promise<LoadedLook>>();

/** Her look: the rig and the image, loaded once per page. */
export function loadLook(id: LeluLookId): Promise<LoadedLook> {
  let pending = looks.get(id);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(lookUrl(id, "rig.json"));
      if (!response.ok) throw new Error(`LÉLU's ${id} rig is missing (${response.status}).`);
      const rig = (await response.json()) as LeluRigData;
      const image = new Image();
      image.decoding = "async";
      image.src = lookUrl(id, "body.webp");
      await image.decode();
      return { id, rig, image };
    })();
    pending.catch(() => looks.delete(id));
    looks.set(id, pending);
  }
  return pending;
}

/**
 * The part of the image a surface shows, in image px [x0, y0, x1, y1],
 * for a canvas of `aspect` (width / height). Full: all of her, feet to
 * hair. Face: head and shoulders.
 */
export function viewFor(rig: LeluRigData, framing: LeluFraming, aspect: number): [number, number, number, number] {
  if (framing === "face") {
    const [hx, hy, , hry] = rig.head;
    const top = hy - hry * 1.12;
    const bottom = rig.chest[1] - rig.chest[3] * 0.15;
    const height = bottom - top;
    const width = height * aspect;
    return [hx - width / 2, top, hx + width / 2, bottom];
  }
  const margin = (rig.bottom - rig.top) * 0.03;
  const top = rig.top - margin;
  const bottom = rig.bottom + margin;
  const height = bottom - top;
  const width = height * aspect;
  const cx = (rig.feet[0] + rig.neck[0]) / 2;
  return [cx - width / 2, top, cx + width / 2, bottom];
}

/**
 * Where her mouth opens. The jaw drops with the LOWER lip: the line runs
 * from corner to corner through the lower lip's inner edge, so where her
 * lips are already parted her own upper teeth stay with her upper lip
 * (they are in the reference) and only a closed mouth needs drawn teeth.
 */
export function mouthPivot(rig: LeluRigData): { center: Point; ownTeeth: boolean } {
  const { upperInner, lowerInner, center } = rig.mouth;
  if (!upperInner || !lowerInner) return { center, ownTeeth: false };
  const gap = Math.hypot(lowerInner[0] - upperInner[0], lowerInner[1] - upperInner[1]);
  if (gap < 2) return { center, ownTeeth: false };
  return { center: [lowerInner[0], lowerInner[1] - 0.6], ownTeeth: true };
}

/** The mouth's own frame: axis, half-width, corner positions, parting curve. */
export function mouthFrame(rig: LeluRigData) {
  const [lx, ly] = rig.mouth.left;
  const [rx, ry] = rig.mouth.right;
  const [cx, cy] = mouthPivot(rig).center;
  const len = Math.hypot(rx - lx, ry - ly) || 1;
  const ax = (rx - lx) / len;
  const ay = (ry - ly) / len;
  const halfWidth = len / 2;
  // Local coords: u along the mouth (in half-widths), v across it (px, down +).
  const local = (x: number, y: number) => ({ u: ((x - cx) * ax + (y - cy) * ay) / halfWidth, v: (x - cx) * -ay + (y - cy) * ax });
  const L = local(lx, ly);
  const R = local(rx, ry);
  // Parting line v(u) = a·u² + b·u through both corners and the centre.
  const det = L.u * L.u * R.u - R.u * R.u * L.u || 1e-6;
  const a = (L.v * R.u - R.v * L.u) / det;
  const b = (L.u * L.u * R.v - R.u * R.u * L.v) / det;
  const chin = local(rig.chin[0], rig.chin[1]);
  return { axis: [ax, ay] as Point, halfWidth, cornerU: [L.u, R.u] as Point, curve: [a, b] as Point, chinV: chin.v };
}

/** Every uniform the shader reads, by name (shared by WebGL and three.js). */
export function rigUniforms(
  rig: LeluRigData,
  params: AnimationParams,
  options: { view: [number, number, number, number]; framing: LeluFraming; holo: number; time: number },
): Record<string, number | number[]> {
  const mouth = mouthFrame(rig);
  const [x0, y0, x1, y1] = options.view;
  const viewH = y1 - y0;
  const motion = rig.headMotion ?? 1;
  const ear = (side: "left" | "right") => rig.earrings[side];
  return {
    uSize: rig.size,
    uView: [x0, y0, x1, y1],
    // Face framing dissolves at the bottom and sides: no edge, no box.
    uFade: options.framing === "face" ? [y1 - viewH * 0.3, y1, (x1 - x0) * 0.16, 1] : [0, 0, 0, 0],
    uEyeL: rig.eyes.left.ellipse,
    uEyeR: rig.eyes.right.ellipse,
    uBrowL: rig.brows.left,
    uBrowR: rig.brows.right,
    uMouthC: mouthPivot(rig).center,
    uTeeth: mouthPivot(rig).ownTeeth ? 0 : 1,
    uMouthAxis: mouth.axis,
    uMouthHW: mouth.halfWidth,
    uMouthCurve: mouth.curve,
    uChinV: mouth.chinV,
    uLipH: rig.mouth.lipHeight,
    uChin: rig.chin,
    uFace: rig.face,
    uHead: rig.head,
    uNeck: rig.neck,
    uChest: rig.chest,
    uFeet: rig.feet,
    uTop: rig.top,
    uEarL: ear("left"),
    uEarR: ear("right"),
    uHand: rig.hand ?? [0, 0, 0],
    uRoll: params.roll * motion,
    uHeadOff: [params.headX * motion * rig.head[2] * 0.06, params.headY * motion * rig.head[3] * 0.06],
    uYaw: params.yaw * motion,
    uSway: params.sway * (rig.bottom - rig.top) * 0.006,
    uBreath: params.breath,
    uBlink: [params.blinkL, params.blinkR],
    uGaze: [params.gazeX, params.gazeY],
    uBrow: params.brow,
    uOpen: params.open,
    uWide: params.wide,
    uSmile: params.smile,
    uEarSwing: [params.earL, params.earR],
    uHolo: options.holo,
    uTime: options.time,
  };
}

export const RIG_VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/** The warp, applied backwards: for each pixel shown, where in her image it comes from. */
export const RIG_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform vec4 uView;
uniform vec4 uFade;
uniform vec4 uEyeL;
uniform vec4 uEyeR;
uniform vec4 uBrowL;
uniform vec4 uBrowR;
uniform vec2 uMouthC;
uniform vec2 uMouthAxis;
uniform float uMouthHW;
uniform vec2 uMouthCurve;
uniform float uChinV;
uniform float uLipH;
uniform float uTeeth;
uniform vec2 uChin;
uniform vec4 uFace;
uniform vec4 uHead;
uniform vec2 uNeck;
uniform vec4 uChest;
uniform vec2 uFeet;
uniform float uTop;
uniform vec3 uEarL;
uniform vec3 uEarR;
uniform vec3 uHand;
uniform float uRoll;
uniform vec2 uHeadOff;
uniform float uYaw;
uniform float uSway;
uniform float uBreath;
uniform vec2 uBlink;
uniform vec2 uGaze;
uniform float uBrow;
uniform float uOpen;
uniform float uWide;
uniform float uSmile;
uniform vec2 uEarSwing;
uniform float uHolo;
uniform float uTime;

vec2 rot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

float ellipseD(vec2 p, vec4 e) {
  return length((p - e.xy) / max(e.zw, vec2(1.0)));
}

float ringWeight(vec2 p, vec3 ear) {
  if (ear.z <= 0.0) return 0.0;
  float d = distance(p, ear.xy + vec2(0.0, ear.z));
  return 1.0 - smoothstep(ear.z * 1.1, ear.z * 1.45, d);
}

// How much of her head (hair, hoops, a resting hand) a point belongs to.
float headWeight(vec2 p) {
  float w = 1.0 - smoothstep(0.9, 1.2, ellipseD(p, uHead));
  // Down the neck it fades out, so the head turns ON her neck.
  float neckW = (1.0 - smoothstep(uChin.y, uNeck.y, p.y)) * (1.0 - smoothstep(uHead.z * 0.3, uHead.z * 0.6, abs(p.x - uNeck.x)));
  w = max(w, p.y > uChin.y ? neckW : 0.0);
  w = max(w, ringWeight(p, uEarL));
  w = max(w, ringWeight(p, uEarR));
  if (uHand.z > 0.0) w = max(w, 1.0 - smoothstep(uHand.z, uHand.z * 1.35, distance(p, uHand.xy)));
  return clamp(w, 0.0, 1.0);
}

vec2 swingEar(vec2 p, vec3 ear, float angle) {
  float w = ringWeight(p, ear);
  if (w <= 0.0) return p;
  return ear.xy + rot(p - ear.xy, -angle * w);
}

// Upper lid closes over the eye; then the iris looks where she looks.
vec2 eye(vec2 p, vec4 e, float k, vec2 gaze) {
  float dx = (p.x - e.x) / max(e.z, 1.0);
  if (abs(dx) < 1.0 && k > 0.001) {
    float prof = sqrt(1.0 - dx * dx);
    float top = e.y - e.w * prof;
    float bot = e.y + e.w * prof * 0.9;
    float lidT = top - e.w * 1.7 * prof - 1.0;
    float lid = mix(top, bot, k);
    if (p.y > lidT && p.y < lid) {
      p.y = lidT + (p.y - lidT) * (top - lidT) / max(lid - lidT, 0.001);
    }
  }
  float wg = 1.0 - smoothstep(0.35, 1.0, ellipseD(p, e));
  return p - vec2(gaze.x * e.z * 0.3, gaze.y * e.w * 0.32) * wg;
}

vec2 brow(vec2 p, vec4 b, float raise) {
  vec2 d = (p - b.xy) / max(b.zw * vec2(1.5, 3.2), vec2(1.0));
  float w = exp(-dot(d, d));
  return p + vec2(0.0, raise * max(b.w, 3.0) * 1.4 * w);
}

// Lips part (the jaw drops with the lower lip and chin), widen or round,
// and smile. Returns the point to sample, or, inside the opening, the
// colour of her mouth in .rgb with mouth = 1.
vec2 mouthWarp(vec2 p, out vec4 inside) {
  inside = vec4(0.0);
  vec2 n = vec2(-uMouthAxis.y, uMouthAxis.x);
  vec2 d = p - uMouthC;
  float hw = max(uMouthHW, 1.0);
  float u = dot(d, uMouthAxis) / hw;
  float v = dot(d, n);
  float lip = max(uLipH, 2.0);

  float area = exp(-(u * u) / 2.6) * exp(-(v * v) / (lip * lip * 5.0));
  u = u / (1.0 + uWide * 0.16 * area);
  float corner = exp(-pow(abs(u) - 1.0, 2.0) / 0.12) * exp(-(v * v) / (lip * lip * 2.6));
  v = v + uSmile * lip * 0.45 * corner;

  float lineV = uMouthCurve.x * u * u + uMouthCurve.y * u;
  float J = uOpen * hw * 0.85;
  // The opening stays inside the lip corners, rounded at its ends.
  float uo = u / 0.82;
  float prof = pow(max(0.0, 1.0 - uo * uo), 0.75);
  float gap = J * prof;
  float jaw = 1.0 - smoothstep(1.1, 2.4, abs(u));
  if (v > lineV) {
    float t = v - lineV;
    if (t < gap && abs(uo) < 1.0) {
      float s = t / max(gap, 0.001);
      float au = abs(uo);
      // Depth: dark, warmer near the lips, darkest at the back and corners.
      vec3 cavity = mix(vec3(0.13, 0.04, 0.045), vec3(0.035, 0.01, 0.012), smoothstep(0.05, 0.55, s));
      // Upper teeth: enamel, shaded, narrower than the mouth, only once open.
      float teeth = (1.0 - smoothstep(0.16, 0.3, s)) * (1.0 - smoothstep(0.5, 0.72, au)) * smoothstep(0.12, 0.35, uOpen) * uTeeth;
      vec3 enamel = vec3(0.74, 0.68, 0.62) * (0.7 + 0.3 * (1.0 - au)) * (0.82 + 0.18 * (1.0 - s / 0.3));
      cavity = mix(cavity, enamel, teeth);
      float tongue = smoothstep(0.6, 0.92, s) * (1.0 - smoothstep(0.45, 0.85, au));
      cavity = mix(cavity, vec3(0.38, 0.11, 0.12), tongue * 0.8);
      cavity *= 1.0 - 0.6 * smoothstep(0.55, 1.0, au);
      // Soft where the opening meets her lips: no cut-out edge.
      float edge = smoothstep(0.0, 1.4, t) * smoothstep(gap, gap - 1.4, t) * (1.0 - smoothstep(0.9, 1.0, au));
      inside = vec4(cavity, edge);
      // What the edge blends with: the upper lip above, the lower lip's rim below.
      float vLip = s < 0.5 ? lineV - 0.5 : lineV + 0.5;
      return uMouthC + uMouthAxis * (u * hw) + n * vLip;
    }
    float chinV = max(uChinV, lip * 2.0);
    float fall = 1.0 - smoothstep(chinV, chinV * 1.9, v);
    float drop = mix(gap, J * jaw, smoothstep(0.0, lip * 2.6, t - gap)) * fall;
    v -= drop;
  } else {
    v += J * 0.14 * prof * (1.0 - smoothstep(0.0, lip * 2.0, lineV - v));
  }
  return uMouthC + uMouthAxis * (u * hw) + n * v;
}

void main() {
  vec2 q = mix(uView.xy, uView.zw, vec2(vUv.x, 1.0 - vUv.y));
  vec2 shown = q;

  if (uHolo > 0.0) {
    // A projection's occasional line glitch.
    float band = step(0.985, fract(sin(floor(q.y / 6.0) * 91.7 + floor(uTime * 8.0) * 13.1) * 4375.5));
    q.x += band * uHolo * 6.0;
  }

  // Body: sway from the feet up, breath in the chest.
  float h = clamp((uFeet.y - q.y) / max(uFeet.y - uTop, 1.0), 0.0, 1.0);
  q.x -= uSway * pow(h, 1.4);
  float chestW = 1.0 - smoothstep(0.6, 1.4, ellipseD(q, uChest));
  q = uChest.xy + (q - uChest.xy) / (1.0 + uBreath * 0.014 * chestW);
  q.y += uBreath * 1.6 * smoothstep(uChest.y + uChest.w * 1.6, uChest.y, q.y);

  // Head on her neck: tilt, nod, turn.
  float hw = headWeight(q);
  vec2 p = mix(q, uNeck + rot(q - uNeck - uHeadOff, -uRoll), hw);
  float faceW = 1.0 - smoothstep(0.55, 1.05, ellipseD(p, uFace));
  p.x -= uYaw * uFace.z * 0.07 * faceW;

  // Face and jewellery, in her head's own frame.
  p = swingEar(p, uEarL, uEarSwing.x);
  p = swingEar(p, uEarR, uEarSwing.y);
  vec4 inside;
  p = mouthWarp(p, inside);
  p = eye(p, uEyeL, uBlink.x, uGaze);
  p = eye(p, uEyeR, uBlink.y, uGaze);
  p = brow(p, uBrowL, uBrow);
  p = brow(p, uBrowR, uBrow);

  vec2 uv = p / uSize;
  vec4 col = vec4(0.0);
  if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) col = texture2D(uTex, uv);
  if (inside.a > 0.0) col = mix(col, vec4(inside.rgb, 1.0), inside.a);

  if (uHolo > 0.0) {
    vec2 px = 3.0 / uSize;
    float a1 = texture2D(uTex, uv + vec2(px.x, 0.0)).a;
    float a2 = texture2D(uTex, uv - vec2(px.x, 0.0)).a;
    float a3 = texture2D(uTex, uv + vec2(0.0, px.y)).a;
    float a4 = texture2D(uTex, uv - vec2(0.0, px.y)).a;
    float edge = clamp(col.a - min(min(a1, a2), min(a3, a4)), 0.0, 1.0);
    float lum = dot(col.rgb, vec3(0.3, 0.59, 0.11)) / max(col.a, 0.001);
    float scan = 0.62 + 0.38 * sin(shown.y * 1.7 - uTime * 6.0);
    float flicker = 0.93 + 0.07 * sin(uTime * 37.0) * sin(uTime * 13.0);
    vec3 holoRgb = mix(vec3(0.12, 0.5, 0.95), vec3(0.78, 0.98, 1.0), clamp(lum * 1.5, 0.0, 1.0)) * (0.6 + 0.7 * lum);
    holoRgb += edge * vec3(0.55, 0.95, 1.0) * 1.8;
    float a = clamp(col.a * (0.5 + 0.28 * scan) + edge * 0.7, 0.0, 1.0) * flicker;
    col = mix(col, vec4(holoRgb * a, a), uHolo);
  }

  if (uFade.w > 0.0) {
    float f = 1.0 - smoothstep(uFade.x, uFade.y, shown.y);
    f *= smoothstep(uView.x, uView.x + uFade.z, shown.x) * smoothstep(uView.z, uView.z - uFade.z, shown.x);
    col *= f;
  }
  gl_FragColor = col;
}
`;
