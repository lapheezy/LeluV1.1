/**
 * ==========================================================
 * LÉLU 2.3 — BABY HAIR: A STRAND SYSTEM, NOT A FRINGE
 *
 * The 2.1 hair drew 120 untracked arcs along the hairline band, projected them
 * onto the skin and reported a single number: `babyStrands`. That is not a
 * system. A strand nobody can identify afterwards cannot be measured, moved,
 * debugged, or compared between two builds — and the defects the mission lists
 * (strands that vanish, thicken, clip or float) are all per-strand facts.
 *
 * So every baby hair here is a RECORD before it is geometry:
 *
 *   root + tip coordinates           where it starts and ends, in metres
 *   curve control points             the path that is actually swept
 *   length, root and tip thickness   measured on that path, in millimetres
 *   growth direction, curvature      unit vector at the root; 1/R of the
 *                                    circumcircle through root, mid and tip
 *   facial landmark relationships    distance to the front hairline, the brow
 *                                    line, the nearest eye, the temple
 *   visibility, collision            which view sees it; how close its path
 *                                    comes to the skin (clear / contact /
 *                                    penetrating) from the probe
 *
 * The module is pure: it is handed a scalp cloud, her landmark points and a
 * `SurfaceProbe` (signed distance + gradient, both injected), and it returns
 * strands plus a report. That is what lets it run inside the browser build and
 * in a Node CLI, and be tested without a body.
 *
 * Baby hairs stay their own system: they are generated here, drawn as their own
 * tapered tubes, and counted under their own region names. The scalp hair, the
 * ringlets, the sideburns and the flyaways keep their own laws; nothing in this
 * file changes how a main lock grows.
 * ==========================================================
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Signed distance (negative inside) plus an outward unit gradient. */
export interface SurfaceProbe {
  distance(p: Vec3): number;
  gradient(p: Vec3): Vec3;
}

export type BabyRegion = "front" | "temple-left" | "temple-right" | "sideburn-left" | "sideburn-right" | "flyaway";

export const BABY_REGIONS: BabyRegion[] = ["front", "temple-left", "temple-right", "sideburn-left", "sideburn-right", "flyaway"];

export interface BabyLandmarks {
  /** Head centre, metres — the origin of the scalp's azimuth. */
  centre: Vec3;
  /** Lowest root at the front of the skull (the forehead hairline), metres. */
  hairlineFrontY: number;
  /** Lowest root anywhere on the scalp, metres. */
  hairlineY: number;
  /** The brow line's height at the centre of the face, metres. */
  browY: number;
  /** Her eye joints (world metres). */
  eyes: [Vec3, Vec3];
  /** Her temples, at the outer end of each brow (world metres). */
  temples: [Vec3, Vec3];
  /** Interpupillary distance, metres — the face's own unit of length. */
  faceSpan: number;
}

export interface BabyStrand {
  /** Stable across builds: region + ordinal, e.g. "front-007". */
  id: string;
  region: BabyRegion;
  root: Vec3;
  tip: Vec3;
  /** The swept path, including root and tip: 3–9 points. */
  controlPoints: Vec3[];
  lengthMm: number;
  rootThicknessMm: number;
  tipThicknessMm: number;
  /** Unit growth direction at the root. */
  growth: Vec3;
  /** 1/R of the circumcircle through root, mid and tip, in 1/m. */
  curvaturePerM: number;
  landmarks: {
    /** Signed vertical distance from the root to the front hairline (+ = above). */
    hairlineMm: number;
    /** Vertical distance from the strand's tip to the brow line (+ = above). */
    browMm: number;
    /** Shortest distance from any point of the strand to an eye centre. */
    eyeMm: number;
    /** Distance from the root to the nearer temple. */
    templeMm: number;
  };
  visibility: "front" | "side" | "occluded";
  collision: "clear" | "contact" | "penetrating";
  /** Min / max signed clearance of the path from the skin, millimetres. */
  minSkinGapMm: number;
  maxSkinGapMm: number;
}

export interface Stats {
  min: number;
  median: number;
  mean: number;
  max: number;
}

export interface BabyHairReport {
  strands: BabyStrand[];
  count: number;
  byRegion: Record<string, number>;
  lengthMm: Stats;
  rootThicknessMm: Stats;
  curvaturePerM: Stats;
  hairline: {
    /** Share of the front hairline arc that has a baby hair within 3 mm of it. */
    coveragePct: number;
    /** Largest unoccupied run along that arc, millimetres. */
    maxGapMm: number;
    /** Median height of the roots above the brow line, millimetres. */
    medianRootAboveBrowMm: number;
    /** How far the front roots sit above the hairline (+ = above it). */
    rootAboveHairlineMm: Stats;
  };
  collision: Record<"clear" | "contact" | "penetrating", number>;
  /** Roots the scalp cloud offered per region — a shortage is visible here. */
  available: { front: number; temples: number; sideburns: number };
  /** The forehead hairline the strands were placed against (world metres). */
  hairlineFrontY: number;
  /** True only when the numbers came from a real probe, not from defaults. */
  measured: boolean;
  note: string;
}

export interface BabyHairInput {
  /** Scalp roots (x,y,z triples, world metres) — where hair actually grows. */
  roots: Float32Array;
  landmarks: BabyLandmarks;
  probe: SurfaceProbe;
  /** How many strands to ask for per region. */
  counts?: Partial<Record<BabyRegion, number>>;
  /** Lift above the skin, metres. A baby hair lies ON the forehead. */
  lift?: number;
  /** Deterministic seed, so two builds of the same head draw the same strands. */
  seed?: number;
  /** Length range per region, metres. */
  lengths?: Partial<Record<BabyRegion, [number, number]>>;
  /** Root thickness range per region, metres. */
  thickness?: Partial<Record<BabyRegion, [number, number]>>;
}

const DEFAULT_COUNTS: Record<BabyRegion, number> = {
  front: 36,
  "temple-left": 12,
  "temple-right": 12,
  "sideburn-left": 6,
  "sideburn-right": 6,
  flyaway: 16,
};

/** Baby hair is fine and short: 6–30 mm, 0.18–0.45 mm at the root. */
const DEFAULT_LENGTHS: Record<BabyRegion, [number, number]> = {
  front: [0.008, 0.016],
  "temple-left": [0.012, 0.022],
  "temple-right": [0.012, 0.022],
  "sideburn-left": [0.016, 0.03],
  "sideburn-right": [0.016, 0.03],
  flyaway: [0.014, 0.028],
};

const DEFAULT_THICKNESS: Record<BabyRegion, [number, number]> = {
  front: [0.00018, 0.00032],
  "temple-left": [0.0002, 0.00038],
  "temple-right": [0.0002, 0.00038],
  "sideburn-left": [0.00026, 0.00045],
  "sideburn-right": [0.00026, 0.00045],
  flyaway: [0.00016, 0.0003],
};

/** How much a region curls sideways over its own length. */
const CURL: Record<BabyRegion, number> = {
  front: 0.2,
  "temple-left": 0.26,
  "temple-right": 0.26,
  "sideburn-left": 0.3,
  "sideburn-right": 0.3,
  flyaway: 0.42,
};

function hash(i: number, j = 0): number {
  let x = Math.imul(i + 1, 374761393) ^ Math.imul(j + 7, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/**
 * Move `p` onto the isosurface at `lift` from the skin.
 *
 * Newton along the gradient, bounded and guarded: a probe that returns NaN, a
 * zero gradient, or a point far outside its own field must not produce a strand
 * at an invented position, so the step is clamped and the caller is told how
 * many iterations it took (a non-converged projection is a real defect, and
 * `collision` reflects it rather than hiding it).
 */
export function projectToSkin(probe: SurfaceProbe, p: Vec3, lift: number, iterations = 5): { point: Vec3; converged: boolean } {
  let q = { ...p };
  let converged = false;
  for (let i = 0; i < iterations; i++) {
    const d = probe.distance(q);
    if (!Number.isFinite(d)) break;
    const err = d - lift;
    if (Math.abs(err) < 5e-5) {
      converged = true;
      break;
    }
    const g = probe.gradient(q);
    const gl = len(g);
    if (!Number.isFinite(gl) || gl < 1e-6) break;
    const step = Math.max(-0.004, Math.min(0.004, err));
    q = add(q, scale(g, -step / gl));
  }
  return { point: q, converged };
}

/**
 * Curvature of the circumcircle through three points, in 1/m.
 *
 * R = abc / 4A, so 1/R = 2·|b−a × c−a| / (ab·bc·ca). The cross product's
 * magnitude is already twice the triangle's area; doubling it again (an easy
 * slip) reports every strand at half its real radius of curvature.
 */
export function curvatureOf(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = len(add(b, scale(a, -1)));
  const bc = len(add(c, scale(b, -1)));
  const ca = len(add(a, scale(c, -1)));
  const crossX = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  const crossY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  const crossZ = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const twiceArea = Math.hypot(crossX, crossY, crossZ);
  if (twiceArea < 1e-12) return 0;
  return (2 * twiceArea) / (ab * bc * ca || 1e-12);
}

/** Path length of a polyline, metres. */
export function pathLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += len(add(points[i], scale(points[i - 1], -1)));
  return total;
}

function stats(values: number[]): Stats {
  if (!values.length) return { min: 0, median: 0, mean: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))];
  return {
    min: sorted[0],
    median: at(0.5),
    mean: sorted.reduce((s, v) => s + v, 0) / sorted.length,
    max: sorted[sorted.length - 1],
  };
}

/** Azimuth around the skull: 0 = dead front (+z), ±π = back. */
function azimuth(p: Vec3, centre: Vec3): number {
  return Math.atan2(p.x - centre.x, p.z - centre.z);
}

const nearest = (p: Vec3, points: readonly Vec3[]): number => Math.min(...points.map((q) => len(add(p, scale(q, -1)))));

/**
 * Grow the baby hairs.
 *
 * Roots are chosen from the real scalp cloud — the same points the main locks
 * grow from — so a baby hair starts exactly where hair starts, never on a card
 * floating above the skull. Each strand is then walked along the forehead under
 * projection, so it hugs the skin instead of cutting through it or hovering over
 * it, and every step is recorded.
 */
export function growBabyHair(input: BabyHairInput): BabyHairReport {
  const { roots, landmarks: lm, probe } = input;
  const counts = { ...DEFAULT_COUNTS, ...(input.counts ?? {}) };
  const lengths = { ...DEFAULT_LENGTHS, ...(input.lengths ?? {}) };
  const thickness = { ...DEFAULT_THICKNESS, ...(input.thickness ?? {}) };
  const lift = input.lift ?? 0.00055;
  const seed = input.seed ?? 17;

  const rootCount = Math.floor(roots.length / 3);

  /**
   * Which way a root faces, from the head's own centre.
   *
   * This is why a global "lowest root" cannot be the hairline: her scalp cloud
   * includes the length of the hairstyle, and the lowest root anywhere sits
   * ~100 mm BELOW her eyes (hair hanging beside the neck). Classifying roots by
   * their direction from the skull — front, temple, side — is anatomy, and it is
   * what makes "the front hairline" mean the forehead.
   */
  const facing = (p: Vec3): Vec3 => unit({ x: p.x - lm.centre.x, y: p.y - lm.centre.y, z: p.z - lm.centre.z });

  // The forehead band: roots on the front of the skull, not the hanging hair.
  const forehead: { p: Vec3; az: number; u: Vec3 }[] = [];
  for (let i = 0; i < rootCount; i++) {
    const p = { x: roots[3 * i], y: roots[3 * i + 1], z: roots[3 * i + 2] };
    const u = facing(p);
    if (u.z > 0.5 && u.y > -0.35) forehead.push({ p, az: azimuth(p, lm.centre), u });
  }
  // The forehead hairline is the LOWEST forehead root; the hairline band is the
  // fringe of the scalp at the skin's edge — where baby hairs actually grow.
  const foreheadHairlineY = forehead.length ? Math.min(...forehead.map((f) => f.p.y)) : lm.hairlineFrontY;
  const frontBand = foreheadHairlineY + 0.012;

  const candidates: { p: Vec3; az: number; region: BabyRegion | null }[] = [];
  for (let i = 0; i < rootCount; i++) {
    const p = { x: roots[3 * i], y: roots[3 * i + 1], z: roots[3 * i + 2] };
    const u = facing(p);
    const az = azimuth(p, lm.centre);
    let region: BabyRegion | null = null;
    if (u.z > 0.5 && p.y <= frontBand) region = "front";
    else if (u.z > 0.15 && u.z <= 0.6 && Math.abs(u.x) > 0.45 && p.y <= frontBand + 0.02) region = u.x > 0 ? "temple-left" : "temple-right";
    else if (u.z > -0.1 && u.z <= 0.4 && Math.abs(u.x) > 0.68 && p.y <= lm.eyes[0].y + 0.02) region = u.x > 0 ? "sideburn-left" : "sideburn-right";
    candidates.push({ p, az, region });
  }
  const available = {
    front: candidates.filter((c) => c.region === "front").length,
    temples: candidates.filter((c) => c.region === "temple-left" || c.region === "temple-right").length,
    sideburns: candidates.filter((c) => c.region === "sideburn-left" || c.region === "sideburn-right").length,
  };

  const strands: BabyStrand[] = [];
  const ordinal: Record<string, number> = {};
  const push = (region: BabyRegion, root: Vec3, az: number, index: number) => {
    const [l0, l1] = lengths[region];
    const target = l0 + (l1 - l0) * hash(index, seed);
    const rootR = thickness[region][0] + (thickness[region][1] - thickness[region][0]) * hash(index, seed + 3);
    // Growth: down the face, swept sideways along the hairline, and — at the
    // temples and sideburns — slightly back toward the ear.
    const side = Math.sign(Math.sin(az)) || 1;
    const sweep = (region === "front" ? 0.5 : region === "flyaway" ? 1.1 : 0.95) * (hash(index, seed + 5) > 0.5 ? 1 : -1);
    const back = region.startsWith("sideburn") || region === "flyaway" ? 0.35 : 0;
    const dir = unit({ x: side * sweep * 0.45, y: -1, z: -back * 0.4 });
    const curl = CURL[region];
    const steps = 7;
    const raw: Vec3[] = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      // A baby hair leaves the scalp, then lies along the forehead: the lateral
      // sweep grows with t², the outward lift decays (it starts 1 mm proud of
      // the skin and is projected back onto it below).
      const lateral = Math.sin(t * Math.PI * 0.9) * target * curl * 2.1;
      const point = {
        x: root.x + dir.x * target * t + side * lateral * (0.35 + 0.65 * t),
        y: root.y + dir.y * target * t,
        z: root.z + 0.0012 * (1 - t),
      };
      const projected = projectToSkin(probe, point, lift);
      raw.push(projected.point);
    }
    // A strand whose path never leaves the root (the probe rejected it) is not
    // drawn and not counted as a success.
    if (pathLength(raw) < 0.002) return;

    const gaps = raw.map((p) => probe.distance(p) * 1000);
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);
    const tip = raw[raw.length - 1];
    const eyeMm = Math.min(nearest(tip, lm.eyes), ...raw.map((p) => nearest(p, lm.eyes))) * 1000;
    const mid = raw[Math.floor(raw.length / 2)];
    const visibility: BabyStrand["visibility"] =
      root.z > lm.centre.z + 0.03 ? "front" : Math.abs(root.x - lm.centre.x) > 0.045 ? "side" : "occluded";
    const collision: BabyStrand["collision"] = minGap < -0.1 ? "penetrating" : minGap < 0.15 ? "contact" : "clear";
    const n = (ordinal[region] = (ordinal[region] ?? 0) + 1);
    strands.push({
      id: `${region}-${String(n).padStart(3, "0")}`,
      region,
      root,
      tip,
      controlPoints: raw,
      lengthMm: pathLength(raw) * 1000,
      rootThicknessMm: rootR * 1000,
      tipThicknessMm: rootR * 0.18 * 1000,
      growth: dir,
      curvaturePerM: curvatureOf(raw[0], mid, tip),
      landmarks: {
        hairlineMm: (root.y - foreheadHairlineY) * 1000,
        browMm: (tip.y - lm.browY) * 1000,
        eyeMm,
        templeMm: Math.min(len(add(root, scale(lm.temples[0], -1))), len(add(root, scale(lm.temples[1], -1)))) * 1000,
      },
      visibility,
      collision,
      minSkinGapMm: minGap,
      maxSkinGapMm: maxGap,
    });
  };

  // Even selection along each region's azimuth range: a fringe of baby hairs is
  // continuous, so picking every k-th candidate is what makes it read as an
  // edge instead of as clumps.
  for (const region of BABY_REGIONS) {
    if (region === "flyaway") continue;
    const group = candidates.filter((c) => c.region === region).sort((a, b) => a.az - b.az);
    const want = counts[region];
    if (!group.length || want <= 0) continue;
    const stepIdx = Math.max(1, Math.floor(group.length / want));
    for (let k = 0; k < group.length && (ordinal[region] ?? 0) < want; k += stepIdx) {
      const c = group[k];
      push(region, c.p, c.az, k + Math.round(region.length * 101));
    }
  }
  // Flyaways: a few strands off the crown-side of the hairline that leave the
  // head under their own curl. They are the same system, not a separate effect.
  const flyRoots = candidates.filter((c) => c.region === null && c.p.y > foreheadHairlineY + 0.02).sort((a, b) => hash(a.p.x * 1e4 + a.p.y * 1e4, seed) - hash(b.p.x * 1e4 + b.p.y * 1e4, seed));
  for (let k = 0; k < Math.min(counts.flyaway, flyRoots.length); k++) push("flyaway", flyRoots[k].p, flyRoots[k].az, k + 977);

  /* ------------------------------ report ------------------------------ */
  const lengthsMm = strands.map((s) => s.lengthMm);
  const thick = strands.map((s) => s.rootThicknessMm);
  const curv = strands.map((s) => s.curvaturePerM);
  const byRegion: Record<string, number> = {};
  for (const s of strands) byRegion[s.region] = (byRegion[s.region] ?? 0) + 1;

  // Hairline coverage: divide the front hairline arc into 2 mm bins and ask
  // whether any front root sits within 3 mm of that bin's azimuth.
  const frontRoots = strands.filter((s) => s.region === "front").map((s) => azimuth(s.root, lm.centre)).sort((a, b) => a - b);
  const bins = 32;
  const covered = new Array<boolean>(bins).fill(false);
  for (const az of frontRoots) {
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(((az + 0.52) / 1.04) * bins)));
    covered[bin] = true;
    if (bin > 0) covered[bin - 1] = true;
    if (bin < bins - 1) covered[bin + 1] = true;
  }
  let run = 0;
  let maxRun = 0;
  for (const c of covered) {
    run = c ? 0 : run + 1;
    maxRun = Math.max(maxRun, run);
  }
  const arcMm = (2 * 0.52 * 0.1) * 1000; // ~10 cm front arc, metres → mm
  const collisionCounts = { clear: 0, contact: 0, penetrating: 0 };
  for (const s of strands) collisionCounts[s.collision] += 1;

  return {
    strands,
    count: strands.length,
    byRegion,
    lengthMm: stats(lengthsMm),
    rootThicknessMm: stats(thick),
    curvaturePerM: stats(curv),
    hairline: {
      coveragePct: (covered.filter(Boolean).length / bins) * 100,
      maxGapMm: (maxRun / bins) * arcMm,
      medianRootAboveBrowMm: stats(strands.filter((s) => s.region === "front").map((s) => (s.root.y - lm.browY) * 1000)).median,
      rootAboveHairlineMm: stats(strands.map((s) => s.landmarks.hairlineMm)),
    },
    collision: collisionCounts,
    available,
    /** The forehead hairline the strands were placed against, world metres. */
    hairlineFrontY: foreheadHairlineY,
    measured: true,
    note:
      "strands grown from the scalp cloud and projected onto the head field; length, thickness, curvature, clearance and landmark distances are measured on the swept path",
  };
}

/* ------------------------------- overlays ------------------------------- */

const fmt = (v: number, digits = 1) => v.toFixed(digits);

/**
 * A technical overlay of the placement, in the front view.
 *
 * This is the picture the mission asks for — where every strand's root is, which
 * way it grows, how long it is, and where the hairline and brow line it is
 * measured against actually are. It is drawn from the strand records, so if a
 * strand is missing from the overlay it is missing from the build.
 */
export function babyHairOverlaySvg(
  report: BabyHairReport,
  options: { width?: number; height?: number; title?: string; showFlyaways?: boolean } = {},
): string {
  const width = options.width ?? 900;
  const height = options.height ?? 720;
  const strands = report.strands.filter((s) => options.showFlyaways === true || s.region !== "flyaway");
  if (!strands.length) return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="20" y="30" fill="#fff">no strands</text></svg>`;
  const xs = strands.flatMap((s) => s.controlPoints.map((p) => p.x * 1000));
  const ys = strands.flatMap((s) => s.controlPoints.map((p) => p.y * 1000));
  const pad = 26;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const k = Math.min((width - 150) / spanX, (height - 130) / spanY);
  const sx = (x: number) => 110 + (x - minX) * k;
  const sy = (y: number) => height - 70 - (y - minY) * k;

  const COLOUR: Record<BabyRegion, string> = {
    front: "#f3b6dc",
    "temple-left": "#8ee6c8",
    "temple-right": "#8ee6c8",
    "sideburn-left": "#f5b261",
    "sideburn-right": "#f5b261",
    flyaway: "#9db4ff",
  };
  const parts: string[] = [];
  parts.push(`<rect width="${width}" height="${height}" fill="#140d2b"/>`);
  parts.push(`<text x="24" y="34" fill="#f6efff" font-family="Inter, system-ui, sans-serif" font-size="19" font-weight="600">${options.title ?? "Baby hair placement — front view"}</text>`);
  parts.push(
    `<text x="24" y="56" fill="#b6a9d6" font-family="Inter, system-ui, sans-serif" font-size="13">${report.count} strands · length ${fmt(report.lengthMm.min)}–${fmt(report.lengthMm.max)} mm (median ${fmt(report.lengthMm.median)}) · roots ${fmt(report.rootThicknessMm.min, 2)}–${fmt(report.rootThicknessMm.max, 2)} mm · hairline coverage ${fmt(report.hairline.coveragePct, 0)} %</text>`,
  );

  // mm grid
  for (let x = Math.ceil(minX / 10) * 10; x <= maxX; x += 10) {
    parts.push(`<line x1="${sx(x)}" y1="${sy(minY)}" x2="${sx(x)}" y2="${sy(maxY)}" stroke="#2a2050" stroke-width="0.6"/>`);
    if (x % 20 === 0) parts.push(`<text x="${sx(x)}" y="${sy(minY) + 16}" fill="#6b5f93" font-family="Inter, sans-serif" font-size="9" text-anchor="middle">${x}</text>`);
  }
  for (let y = Math.ceil(minY / 10) * 10; y <= maxY; y += 10) {
    parts.push(`<line x1="${sx(minX)}" y1="${sy(y)}" x2="${sx(maxX)}" y2="${sy(y)}" stroke="#2a2050" stroke-width="0.6"/>`);
    if (y % 20 === 0) parts.push(`<text x="${sx(minX) - 8}" y="${sy(y) + 3}" fill="#6b5f93" font-family="Inter, sans-serif" font-size="9" text-anchor="end">${y}</text>`);
  }

  for (const s of strands) {
    const d = s.controlPoints.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x * 1000).toFixed(1)},${sy(p.y * 1000).toFixed(1)}`).join(" ");
    const thickness = s.collision === "penetrating" ? "#ff6b6b" : s.collision === "contact" ? COLOUR[s.region] : "#ffffff";
    parts.push(`<path d="${d}" fill="none" stroke="${thickness}" stroke-width="${Math.max(0.9, s.rootThicknessMm * 3.2)}" stroke-linecap="round" opacity="0.92"/>`);
    parts.push(`<circle cx="${sx(s.root.x * 1000).toFixed(1)}" cy="${sy(s.root.y * 1000).toFixed(1)}" r="2.1" fill="${COLOUR[s.region]}" stroke="#140d2b" stroke-width="0.6"/>`);
  }

  // Legend + measured hairline numbers.
  const legend: [string, string][] = [
    ["front", `${report.byRegion.front ?? 0} front`],
    ["temple-left", `${(report.byRegion["temple-left"] ?? 0) + (report.byRegion["temple-right"] ?? 0)} temples`],
    ["sideburn-left", `${(report.byRegion["sideburn-left"] ?? 0) + (report.byRegion["sideburn-right"] ?? 0)} sideburns`],
    ["flyaway", `${report.byRegion.flyaway ?? 0} flyaways`],
  ];
  legend.forEach(([region, label], i) => {
    const y = 96 + i * 22;
    parts.push(`<circle cx="30" cy="${y - 4}" r="5" fill="${COLOUR[region as BabyRegion]}"/>`);
    parts.push(`<text x="44" y="${y}" fill="#d9cff0" font-family="Inter, sans-serif" font-size="13">${label}</text>`);
  });
  parts.push(`<text x="24" y="${height - 40}" fill="#8d80b3" font-family="Inter, sans-serif" font-size="11">axes in millimetres · roots on the scalp cloud · paths projected onto the head field · red = skin collision</text>`);
  parts.push(`<text x="24" y="${height - 22}" fill="#8d80b3" font-family="Inter, sans-serif" font-size="11">median root ${fmt(report.hairline.rootAboveHairlineMm.median)} mm above the front hairline · tip-to-eye min ${fmt(Math.min(...strands.map((s) => s.landmarks.eyeMm)))} mm · coverage ${fmt(report.hairline.coveragePct, 0)} %</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** One strand's full record, as text — the form a reviewer can check. */
export function describeStrand(s: BabyStrand): string {
  return [
    `${s.id} (${s.region})`,
    `  root ${s.root.x.toFixed(4)}, ${s.root.y.toFixed(4)}, ${s.root.z.toFixed(4)} m`,
    `  tip  ${s.tip.x.toFixed(4)}, ${s.tip.y.toFixed(4)}, ${s.tip.z.toFixed(4)} m`,
    `  length ${s.lengthMm.toFixed(1)} mm, thickness ${s.rootThicknessMm.toFixed(2)} → ${s.tipThicknessMm.toFixed(2)} mm`,
    `  growth ${s.growth.x.toFixed(2)}, ${s.growth.y.toFixed(2)}, ${s.growth.z.toFixed(2)} · curvature ${s.curvaturePerM.toFixed(1)} 1/m`,
    `  hairline ${s.landmarks.hairlineMm.toFixed(1)} mm · brow ${s.landmarks.browMm.toFixed(1)} mm · eye ${s.landmarks.eyeMm.toFixed(1)} mm · temple ${s.landmarks.templeMm.toFixed(1)} mm`,
    `  ${s.visibility} · ${s.collision} · skin gap ${s.minSkinGapMm.toFixed(2)}…${s.maxSkinGapMm.toFixed(2)} mm`,
  ].join("\n");
}

/** State of the last in-build run, read by the CLI after `buildCharacter`. */
export const babyHairState: { report: BabyHairReport | null } = { report: null };
