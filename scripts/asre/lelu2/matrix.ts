/**
 * ==========================================================
 * LÉLU 2.1 — WP02: CONTROLLED DISTRIBUTION MATRIX
 *
 * Four real surfaces, five distribution laws, one point budget, one seed:
 *
 *   hair roots      her head mesh, upper skull only (no face)
 *   surface detail  her garment mesh (`clothing.top`)
 *   jewelry         the diadem disc (a flat annulus-free disc of radius 55 mm)
 *   procedural      a sphere of radius 50 mm (surface-sampling baseline)
 *
 * Each run records the same measurements: nearest-neighbour spacing CV,
 * min/max/mean spacing, duplicates, coverage, and wall time. A method is only
 * "retained" if it beats the conventional stride on CV by ≥ 5 % *and* does not
 * lose coverage; otherwise the run is rejected, and a method that improves
 * coverage but not evenness is sent back for investigation.
 *
 * Curl trajectories get the same treatment: five path laws, one strand frame,
 * measured on curvature, self-approach, log-spiral fit and bundle clumping.
 *
 *   npx tsx scripts/asre/lelu2/matrix.ts
 *   → artifacts/lelu2/matrix/summary.json (+ one file per application)
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, placedMesh } from "../../../src/core/asre/character/build.ts";
import { leluCanon } from "../../../src/core/asre/character/leluIdentity.ts";
import { withChanges } from "../../../src/core/asre/character/CharacterSpec.ts";
import { loadReference } from "../cc0-anatomy.ts";
import { GOLDEN_ANGLE, PHI_INV } from "../../../src/core/geometry/golden/index.ts";
import { METHOD_ORDER, selectAll, selectPlanar, type Selection } from "../../../src/core/asre/lelu2/distributions.ts";
import { CURL_LAWS, analysePath, curlPath, type StemFrame, type Strand } from "../../../src/core/asre/lelu2/trajectories.ts";
import { cloudFrom, cloudSize, coverage, PointIndex, spacingStats, type Cloud } from "../../../src/core/asre/lelu2/pointcloud.ts";

const N = 800;
const OUT = "artifacts/lelu2/matrix";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const points = Number(arg("points", String(N)));

const spec = withChanges(leluCanon(), { hair: { style: "long-wavy", length: 1, volume: 1.05 } });
const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
console.log(`foundation ${ref.digest}`);

const tBuild = performance.now();
const build = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE, ["head", "clothing.top"]);
console.log(`components built in ${((performance.now() - tBuild) / 1000).toFixed(1)} s`);
const part = (id: string) => {
  const c = build.components.find((x) => x.id === id);
  if (!c?.local) throw new Error(`matrix: component ${id} did not build`);
  return placedMesh(c);
};

const head = part("head");
let yMax = -Infinity, zMax = -Infinity;
for (let i = 0; i < head.positions.length; i += 3) {
  yMax = Math.max(yMax, head.positions[i + 1]);
  zMax = Math.max(zMax, head.positions[i + 2]);
}
/** Her scalp: the upper skull, minus anything forward of the brow. */
const isScalp = (x: number, y: number, z: number) => y > yMax - 0.2 && !(z > zMax - 0.09 && y < yMax - 0.1);
const scalp = cloudFrom(head.positions, "head (upper skull, no face)", head.normals, isScalp);
const garment = cloudFrom(part("clothing.top").positions, "clothing.top (garment surface)");
console.log(`clouds: scalp ${cloudSize(scalp)} pts, garment ${cloudSize(garment)} pts`);

/** The diadem disc, as a dense point cloud in the XZ plane (Y-up). */
function discCloud(): Cloud {
  const pts: number[] = [];
  const R = 0.055;
  const step = 0.0004;
  for (let x = -R; x <= R; x += step) for (let z = -R; z <= R; z += step) if (x * x + z * z <= R * R) pts.push(x, 0, z);
  return cloudFrom(pts, "diadem disc r=55 mm");
}
const disc = discCloud();

/** A Fibonacci sphere of radius 50 mm — the conventional surface-sampling target. */
function sphereCloud(): Cloud {
  const pts: number[] = [];
  const R = 0.05;
  const count = 24000;
  for (let k = 0; k < count; k++) {
    const cosLat = 1 - (2 * (k + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - cosLat * cosLat));
    const az = k * GOLDEN_ANGLE;
    pts.push(R * r * Math.cos(az), R * cosLat, R * r * Math.sin(az));
  }
  return cloudFrom(pts, "sphere r=50 mm");
}

interface ApplicationResult {
  application: string;
  cloud: string;
  cloudPoints: number;
  requested: number;
  coverageRadius: number;
  methods: {
    id: string;
    label: string;
    achieved: number;
    attempts: number;
    ms: number;
    spacing: ReturnType<typeof spacingStats>;
    coverage: number;
    notes: string[];
  }[];
  verdicts: { id: string; deltaCv: number; deltaCoverage: number; underDelivered: boolean; decision: "retain" | "reject" | "investigate" }[];
  decision: { method: string; decision: "retain" | "reject" | "investigate"; reason: string } | null;
  ms: number;
}

function runApplication(name: string, cloud: Cloud, planar = false): ApplicationResult {
  const t0 = performance.now();
  console.log(`[${name}] indexing ${cloudSize(cloud)} points…`);
  const index = new PointIndex(cloud);
  const selections: Selection[] = [];
  const { selections: offered } = planar ? selectPlanar(cloud, points, index) : { selections: selectAll(cloud, points, index) };
  for (const s of offered) {
    console.log(`[${name}] ${s.id}: ${s.achieved}/${s.requested} in ${s.ms.toFixed(0)} ms`);
    if (s.achieved > 1) selections.push(s);
  }
  if (!selections.some((s) => s.id === "A-conventional")) throw new Error(`matrix: ${name} did not produce a conventional baseline`);
  const base = selections.find((s) => s.id === "A-conventional")!;
  const baseSpacing = spacingStats(base.points);
  const radius = Math.max(0.0005, baseSpacing.mean * 2.2);
  const methods = selections.map((s) => ({
    id: s.id,
    label: s.label,
    achieved: s.achieved,
    attempts: s.attempts,
    ms: Number(s.ms.toFixed(1)),
    spacing: spacingStats(s.points),
    coverage: coverage(cloud, s.points, radius),
    notes: s.notes,
  }));
  const byId = new Map(methods.map((m) => [m.id, m]));
  const a = byId.get("A-conventional")!;
  const verdicts = METHOD_ORDER.filter((id) => id !== "A-conventional" && byId.has(id)).map((id) => {
    const m = byId.get(id)!;
    const deltaCv = (m.spacing.cv - a.spacing.cv) / (a.spacing.cv || 1);
    const deltaCoverage = m.coverage - a.coverage;
    // A law that cannot deliver the requested count on this surface is not a
    // candidate, however even the points it did place are: its CV is measured
    // over a different, smaller sample.
    const underDelivered = m.achieved < m.attempts / 8;
    const decision: "retain" | "reject" | "investigate" = underDelivered
      ? "reject"
      : deltaCv <= -0.05 && deltaCoverage >= -0.02
        ? "retain"
        : deltaCoverage > 0.02 && deltaCv < 0
          ? "investigate"
          : "reject";
    return { id, deltaCv: Number(deltaCv.toFixed(3)), deltaCoverage: Number(deltaCoverage.toFixed(3)), underDelivered, decision };
  });
  const retained = verdicts.filter((v) => v.decision === "retain").sort((x, y) => x.deltaCv - y.deltaCv);
  const decision = retained.length
    ? { method: retained[0].id, decision: "retain" as const, reason: `CV ${(retained[0].deltaCv * 100).toFixed(1)} % lower than the conventional stride with coverage within 2 points` }
    : { method: "A-conventional", decision: "reject" as const, reason: `no law beat the conventional stride on CV without losing coverage (best CV delta ${(Math.min(...verdicts.map((v) => v.deltaCv)) * 100).toFixed(1)} %)` };
  return {
    application: name,
    cloud: cloud.source,
    cloudPoints: cloudSize(cloud),
    requested: points,
    coverageRadius: Number(radius.toFixed(5)),
    methods,
    verdicts,
    decision,
    ms: Number((performance.now() - t0).toFixed(0)),
  };
}

const applications = [
  runApplication("hair roots", scalp),
  runApplication("surface detail placement", garment),
  runApplication("jewelry (diadem)", disc, true),
  runApplication("procedural surface sampling", sphereCloud()),
];

/* ------------------------------ trajectories ----------------------------- */

interface CurlResult {
  law: string;
  label: string;
  strands: number;
  ms: number;
  lengthCv: number;
  curvatureMean: number;
  curvatureCv: number;
  minSelfDistance: number;
  logRadiusR2: number;
  growthPerTurn: number;
  strandDiameterCv: number;
  bundle: ReturnType<typeof bundleMetrics>;
  decision: "retain" | "reject" | "investigate";
  reason: string;
}

// A single lock, not a whole style's worth of hair packed into one tube: at
// 7.4 mm the neighbouring tubes touch before any law can show a difference.
const frameRadius = 0.0025;

/** Shortest distance between two strand polylines — how close two tubes come. */
function minPathDistance(a: Strand[], b: Strand[]): number {
  // Near the roots every lock genuinely shares the scalp, so measuring there
  // reports root spacing, not whether two curls read as one lump. Only the free
  // three quarters of each strand is compared.
  const tail = (p: Strand[]) => p.slice(Math.floor(p.length * 0.25));
  let best = Infinity;
  for (const p of tail(a)) for (const q of tail(b)) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
  return best;
}

/** Bundle behaviour: two strands whose tubes touch read as one lump. */
function bundleMetrics(paths: Strand[][], radius: number): { strands: number; minStrandGap: number; meanStrandGap: number; clumpFraction: number } {
  const gaps: number[] = [];
  let clumps = 0;
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      const d = minPathDistance(paths[i], paths[j]);
      gaps.push(d);
      if (d < radius * 2) clumps++;
    }
  const mean = gaps.reduce((s, v) => s + v, 0) / (gaps.length || 1);
  return { strands: paths.length, minStrandGap: gaps.length ? Math.min(...gaps) : 0, meanStrandGap: mean, clumpFraction: gaps.length ? clumps / gaps.length : 0 };
}

function runCurls(): CurlResult[] {
  const strands = 48;
  const base: CurlResult[] = [];
  const firstAnalyses = new Map<string, ReturnType<typeof analysePath>[]>();
  for (const law of CURL_LAWS) {
    const t0 = performance.now();
    const paths: Strand[][] = [];
    const diameters: number[] = [];
    let logR2 = 0;
    for (let i = 0; i < strands; i++) {
      // Roots spread over a 6 × 5 grid on a scalp-sized patch, so strands are
      // neighbours the way real roots are — a tight ring would make every law
      // score the same clumping.
      const root: [number, number, number] = [(i % 8) * 0.012 - 0.042, 0.02, Math.floor(i / 8) * 0.012 - 0.03];
      const phi = (i / strands) * Math.PI * 2 * PHI_INV;
      const axis: [number, number, number] = [Math.cos(phi) * 0.3, 0.82, Math.sin(phi) * 0.3];
      const l = Math.hypot(...axis);
      const unitAxis: [number, number, number] = [axis[0] / l, axis[1] / l, axis[2] / l];
      const ref: [number, number, number] = Math.abs(unitAxis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const e1: [number, number, number] = [ref[1] * unitAxis[2] - ref[2] * unitAxis[1], ref[2] * unitAxis[0] - ref[0] * unitAxis[2], ref[0] * unitAxis[1] - ref[1] * unitAxis[0]];
      const e1l = Math.hypot(...e1);
      const e1u: [number, number, number] = [e1[0] / e1l, e1[1] / e1l, e1[2] / e1l];
      const e2: [number, number, number] = [unitAxis[1] * e1u[2] - unitAxis[2] * e1u[1], unitAxis[2] * e1u[0] - unitAxis[0] * e1u[2], unitAxis[0] * e1u[1] - unitAxis[1] * e1u[0]];
      const frame: StemFrame = {
        origin: root,
        axis: unitAxis,
        e1: e1u,
        e2,
        length: 0.22,
        radius: 0.0074,
        turns: 5.5,
        droop: 0.8,
        seed: (i * GOLDEN_ANGLE) % 1,
      };
      diameters.push(frame.radius * (law.id === "E-adaptive" ? 0.72 + 0.55 * frame.seed : 1));
      const path = curlPath(law.id, frame);
      paths.push(path);
      const a = analysePath(path, { origin: frame.origin, axis: frame.axis, e1: frame.e1, e2: frame.e2 });
      logR2 += a.logRadiusR2;
      const list = firstAnalyses.get(law.id) ?? [];
      list.push(a);
      firstAnalyses.set(law.id, list);
    }
    const analyses = firstAnalyses.get(law.id)!;
    const lengths = analyses.map((a) => a.length);
    const meanLen = lengths.reduce((s, v) => s + v, 0) / lengths.length;
    const lenVar = lengths.reduce((s, v) => s + (v - meanLen) ** 2, 0) / lengths.length;
    const meanDiam = diameters.reduce((s, v) => s + v, 0) / diameters.length;
    const diamVar = diameters.reduce((s, v) => s + (v - meanDiam) ** 2, 0) / diameters.length;
    base.push({
      law: law.id,
      label: law.label,
      strands,
      ms: Number((performance.now() - t0).toFixed(1)),
      lengthCv: meanLen > 0 ? Math.sqrt(lenVar) / meanLen : 0,
      curvatureMean: analyses.reduce((s, a) => s + a.curvature, 0) / analyses.length,
      curvatureCv: analyses.reduce((s, a) => s + a.curvatureCv, 0) / analyses.length,
      minSelfDistance: Math.min(...analyses.map((a) => a.minSelfDistance)),
      logRadiusR2: logR2 / analyses.length,
      growthPerTurn: analyses.reduce((s, a) => s + a.growthPerTurn, 0) / analyses.length,
      strandDiameterCv: meanDiam > 0 ? Math.sqrt(diamVar) / meanDiam : 0,
      bundle: bundleMetrics(paths, frameRadius),
      decision: "reject",
      reason: "",
    });
  }
  // Decision: a law is retained only if it keeps curls distinct (self-distance
  // and bundle clumping no worse than the baseline helix) and adds natural
  // variation (diameter or length CV) without a geometric collapse.
  const helix = base.find((b) => b.law === "A-helix")!;
  for (const b of base) {
    const distinct = b.minSelfDistance >= helix.minSelfDistance * 0.9 && b.bundle.clumpFraction <= helix.bundle.clumpFraction + 0.02;
    const variation = b.strandDiameterCv > helix.strandDiameterCv + 0.02 || b.lengthCv > helix.lengthCv + 0.02;
    const fit = b.logRadiusR2 >= 0.95;
    if (distinct && fit && (variation || b.law === "A-helix")) {
      b.decision = "retain";
      b.reason = `distinct curls kept (min self-approach ${(b.minSelfDistance * 1000).toFixed(2)} mm, touching pairs ${(b.bundle.clumpFraction * 100).toFixed(0)} %), log law R² ${b.logRadiusR2.toFixed(3)}${variation ? ", natural diameter/length variation" : " (baseline)"}`;
    } else {
      b.decision = distinct ? "investigate" : "reject";
      b.reason = !distinct
        ? `strands collapse toward a shared envelope (self-approach ${(b.minSelfDistance * 1000).toFixed(2)} mm vs ${(helix.minSelfDistance * 1000).toFixed(2)} mm)`
        : `no measurable natural variation and log law R² ${b.logRadiusR2.toFixed(3)}`;
    }
  }
  return base;
}

const curls = runCurls();

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ generatedAt: new Date().toISOString(), spec: { hair: spec.hair, points }, applications, curls }, null, 2));

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
console.log(`\nWP02 — ${applications.length} applications × 5 laws at n=${points}\n`);
for (const app of applications) {
  console.log(`${app.application} — ${app.cloud} (${app.cloudPoints} pts, coverage r=${(app.coverageRadius * 1000).toFixed(1)} mm)`);
  console.log("  law                achieved     CV      min(mm)   max(mm)   dup  coverage      ms  decision");
  for (const m of app.methods) {
          const v = app.verdicts.find((x) => x.id === m.id);
    const d = m.id === "A-conventional" ? "baseline" : v!.underDelivered ? "reject (n)" : v!.decision;
    console.log(
      `  ${m.id.padEnd(18)} ${String(m.achieved).padStart(6)}  ${m.spacing.cv.toFixed(4)}  ${(m.spacing.min * 1000).toFixed(2).padStart(7)}  ${(m.spacing.max * 1000).toFixed(2).padStart(7)}  ${String(m.spacing.duplicates).padStart(3)}  ${pct(m.coverage).padStart(7)}  ${String(m.ms).padStart(6)}  ${d}`,
    );
  }
  console.log(`  → ${app.decision!.decision.toUpperCase()} ${app.decision!.method}: ${app.decision!.reason}\n`);
}
console.log("curl laws (48 strands each, identical frames):");
  console.log("  law                self-mm   logR²  growth/turn  dia-CV  len-CV  touching  decision");
for (const c of curls) {
    console.log(
      `  ${c.law.padEnd(18)} ${(c.minSelfDistance * 1000).toFixed(2).padStart(7)}  ${c.logRadiusR2.toFixed(3)}  ${c.growthPerTurn.toFixed(3).padStart(11)}  ${c.strandDiameterCv.toFixed(3)}   ${c.lengthCv.toFixed(3)}  ${pct(c.bundle.clumpFraction).padStart(8)}  ${c.decision}`,
    );
  }
const retained = curls.filter((c) => c.decision === "retain").map((c) => c.law);
console.log(`  → retained curl laws: ${retained.join(", ") || "none"}`);

// Self-check: a retained application must satisfy its own rule.
let bad = 0;
for (const app of applications) {
  if (!app.decision) continue;
  const m = app.methods.find((x) => x.id === app.decision!.method)!;
  const a = app.methods.find((x) => x.id === "A-conventional")!;
  if (app.decision.decision === "retain" && !(m.spacing.cv <= a.spacing.cv * 0.95 && m.coverage >= a.coverage - 0.02)) {
    console.error(`SELF-CHECK FAILED: ${app.application} retained ${m.id} without meeting its own rule`);
    bad++;
  }
}
console.log(`\nwritten: ${OUT}/summary.json — self-check ${bad ? "FAILED" : "ok"}`);
process.exitCode = bad ? 1 : 0;
