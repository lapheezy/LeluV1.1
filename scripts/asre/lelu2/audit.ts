/**
 * ==========================================================
 * LÉLU 2.1 — WP01: AUDIT THE PUBLISHED NUMBERS
 *
 * Reads the raw artefacts the LÉLU 2.0 experiment wrote and re-derives every
 * claim in the report from them, with the variant label checked against the
 * file each number came from. Prints what holds, what must be corrected, and
 * what is not comparable at all; writes the same thing to JSON.
 *
 *   npx tsx scripts/asre/lelu2/audit.ts
 *   → artifacts/lelu2/audit.json  (exit 1 if a claim is contradicted)
 * ==========================================================
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { audit, type Comparison, type Measurement } from "../../../src/core/asre/lelu2/claims.ts";

const ornament = JSON.parse(readFileSync("artifacts/lelu2/ornament/comparison.json", "utf8")) as Record<
  "baseline" | "golden",
  { beads: number; beadSpacing: { mean: number; cv: number; min: number; max: number; maxOverMin: number }; radialExponent: number; divergenceDeg: number }
>;
const charMetrics = (variant: "baseline" | "golden") =>
  JSON.parse(readFileSync(`artifacts/lelu2/${variant}/lelu2-${variant}-metrics.json`, "utf8")) as {
    hair: { roots: number; rootCv: number; meanSpacing: number; minSpacing: number; maxSpacing: number };
    proportions: { shareWithinTolerance: number; pairsTested: number };
    triangles: number;
    ms: number;
  };
const ch = { baseline: charMetrics("baseline"), golden: charMetrics("golden") };

const ORN = "artifacts/lelu2/ornament/comparison.json";
const MATRIX = "artifacts/lelu2/matrix/summary.json";
const matrixDoc = JSON.parse(readFileSync(MATRIX, "utf8")) as {
  applications: { application: string; methods: { id: string; achieved: number; spacing: { cv: number } }[] }[];
};
/** A measurement taken from the WP02 matrix at equal n. */
function matrixMeasure(appIndex: number, method: string, variant: "baseline" | "golden"): Measurement {
  const app = matrixDoc.applications[appIndex];
  const index = app.methods.findIndex((m) => m.id === method);
  if (index < 0) throw new Error(`audit: ${app.application} has no ${method}`);
  return verify({
    metric: `hair root spacing CV at equal n=800 (${app.application})`,
    variant,
    value: app.methods[index].spacing.cv,
    direction: "lower",
    source: MATRIX,
    field: `applications[${appIndex}].methods[${index}].spacing.cv`,
    n: app.methods[index].achieved,
    layout: method,
    variantTag: `${method} (${variant})`,
  });
}
const metricsSrc = (v: "baseline" | "golden") => `artifacts/lelu2/${v}/lelu2-${v}-metrics.json`;

const m = (p: Partial<Measurement> & Pick<Measurement, "metric" | "variant" | "value" | "direction" | "source">): Measurement => p;

/** Read a dotted path, with `name[index]` support. */
function at(doc: unknown, path: string): unknown {
  let node: unknown = doc;
  for (const part of path.split(".")) {
    const indexed = /^(\w+)\[(\d+)\]$/.exec(part);
    if (indexed) {
      const holder = (node as Record<string, unknown> | undefined)?.[indexed[1]];
      node = Array.isArray(holder) ? holder[Number(indexed[2])] : undefined;
    } else {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
  }
  return node;
}

/** Re-read a number from the artefact at `variant.field` and require it to match. */
function verify(m: Measurement): Measurement {
  if (!m.field) return m;
  const doc = JSON.parse(readFileSync(m.source, "utf8")) as Record<string, unknown>;
  const node = at(doc, m.field);
  if (typeof node !== "number")
    throw new Error(`audit: ${m.metric} claims ${m.value} from ${m.source}#${m.field}, but that path holds ${JSON.stringify(node)}`);
  if (Math.abs(node - m.value) > 1e-9)
    throw new Error(`audit: ${m.metric} assigned ${m.value} but ${m.source}#${m.field} holds ${node} — the labels are swapped`);
  return m;
}
const of = (variant: "baseline" | "golden", field: string, p: Partial<Measurement> & Pick<Measurement, "metric" | "value" | "direction">): Measurement =>
  verify(m({ ...p, variant, source: ORN, field: `${variant}.${field}` }));

/**
 * The comparisons. `claimed` is what the 2.0 report actually said, so the audit
 * can disagree with it. Metrics whose applicability was overstated in 2.0 are
 * marked here rather than silently dropped.
 */
const ORN_M = (variant: "baseline" | "golden", field: string, p: Partial<Measurement> & Pick<Measurement, "metric" | "value" | "direction">) => of(variant, field, p);
const comparisons: Comparison[] = [
  // ---- character: hair roots -------------------------------------------------
  {
    metric: "hair root spacing CV",
    baseline: m({ metric: "hair root spacing CV", variant: "baseline", value: ch.baseline.hair.rootCv, direction: "lower",     source: metricsSrc("baseline"), n: ch.baseline.hair.roots, layout: "asset vertex order" }),
    golden: m({ metric: "hair root spacing CV", variant: "golden", value: ch.golden.hair.rootCv, direction: "lower", source: metricsSrc("golden"), n: ch.golden.hair.roots, layout: "area-even Fibonacci subset" }),
    // RETRACTED in 2.1: the 2.0 report claimed this win, but the two runs placed
    // 928 and 1350 roots. A nearest-neighbour CV depends on how many points it
    // sees, so the claim is not certified here. The equal-n replication is two
    // entries below, and that is the number the report now quotes.
    sampleSizeSensitive: true,
  },
  {
    metric: "hair root spacing CV at equal n=800 (WP02)",
    baseline: matrixMeasure(0, "A-conventional", "baseline"),
    golden: matrixMeasure(0, "E-hybrid", "golden"),
    claimed: "golden",
    sampleSizeSensitive: true,
  },
  {
    metric: "hair root count",
    baseline: m({ metric: "hair root count", variant: "baseline", value: ch.baseline.hair.roots, direction: "higher", source: metricsSrc("baseline") }),
    golden: m({ metric: "hair root count", variant: "golden", value: ch.golden.hair.roots, direction: "higher", source: metricsSrc("golden") }),
  },
  {
    metric: "closest hair root pair (metres)",
    baseline: m({ metric: "closest hair root pair (metres)", variant: "baseline", value: ch.baseline.hair.minSpacing, direction: "higher", source: metricsSrc("baseline") }),
    golden: m({ metric: "closest hair root pair (metres)", variant: "golden", value: ch.golden.hair.minSpacing, direction: "higher", source: metricsSrc("golden") }),
  },
  // ---- ornament: bead placement ---------------------------------------------
  {
    metric: "bead spacing CV",
    baseline: ORN_M("baseline", "beadSpacing.cv", { metric: "bead spacing CV", value: ornament.baseline.beadSpacing.cv, direction: "lower", n: ornament.baseline.beads, layout: "concentric rings" }),
    golden: ORN_M("golden", "beadSpacing.cv", { metric: "bead spacing CV", value: ornament.golden.beadSpacing.cv, direction: "lower", n: ornament.golden.beads, layout: "Vogel disc" }),
    claimed: "golden",
    sampleSizeSensitive: true,
  },
  {
    metric: "bead max/min spacing",
    baseline: ORN_M("baseline", "beadSpacing.maxOverMin", { metric: "bead max/min spacing", value: ornament.baseline.beadSpacing.maxOverMin, direction: "lower", n: ornament.baseline.beads, layout: "concentric rings" }),
    golden: ORN_M("golden", "beadSpacing.maxOverMin", { metric: "bead max/min spacing", value: ornament.golden.beadSpacing.maxOverMin, direction: "lower", n: ornament.golden.beads, layout: "Vogel disc" }),
    claimed: "golden",
  },
  {
    metric: "mean bead spacing (metres)",
    // Descriptive: a larger mean gap is not "better", it is a different ring
    // radius. 2.0's table implied a direction; the audit refuses to score it.
    baseline: ORN_M("baseline", "beadSpacing.mean", { metric: "mean bead spacing (metres)", value: ornament.baseline.beadSpacing.mean, direction: "higher", descriptive: true }),
    golden: ORN_M("golden", "beadSpacing.mean", { metric: "mean bead spacing (metres)", value: ornament.golden.beadSpacing.mean, direction: "higher", descriptive: true }),
  },
  {
    // A ring layout has no spiral turn to recover, so a divergence angle for it
    // is a fitted number with no meaning. 2.0 printed 27.5° vs 137.5° as though
    // the pair were comparable; the audit marks that as not applicable.
    metric: "recovered divergence (degrees)",
    baseline: ORN_M("baseline", "divergenceDeg", { metric: "recovered divergence (degrees)", value: ornament.baseline.divergenceDeg, direction: "lower", layout: "concentric rings", applicable: false }),
    golden: ORN_M("golden", "divergenceDeg", { metric: "recovered divergence (degrees)", value: ornament.golden.divergenceDeg, direction: "lower", layout: "Vogel disc" }),
    // RETRACTED: 2.0 printed 27.5° vs 137.5° as a win. A ring layout has no
    // spiral turn to recover, so the comparison is withdrawn, not reframed.
  },
  {
    // Same for the radial exponent: three discrete rings fit a power law poorly
    // by construction, so the "0.432 vs 0.490" line measures ring discreteness,
    // not evenness.
    metric: "radial exponent (0.5 = equal area)",
    baseline: ORN_M("baseline", "radialExponent", { metric: "radial exponent (0.5 = equal area)", value: ornament.baseline.radialExponent, direction: "higher", layout: "concentric rings", applicable: false }),
    golden: ORN_M("golden", "radialExponent", { metric: "radial exponent (0.5 = equal area)", value: ornament.golden.radialExponent, direction: "higher", layout: "Vogel disc" }),
    // RETRACTED for the same reason: three discrete rings fit a power law badly
    // by construction, so 0.432 vs 0.490 measures ring discreteness.
  },
  // ---- character: proportions and cost --------------------------------------
  {
    metric: "share of landmark ratios within 2% of a phi power",
    baseline: m({ metric: "share of landmark ratios within 2% of a phi power", variant: "baseline", value: ch.baseline.proportions.shareWithinTolerance, direction: "higher", source: metricsSrc("baseline"), n: ch.baseline.proportions.pairsTested }),
    golden: m({ metric: "share of landmark ratios within 2% of a phi power", variant: "golden", value: ch.golden.proportions.shareWithinTolerance, direction: "higher", source: metricsSrc("golden"), n: ch.golden.proportions.pairsTested }),
  },
  {
    metric: "triangles",
    baseline: m({ metric: "triangles", variant: "baseline", value: ch.baseline.triangles, direction: "lower", source: metricsSrc("baseline") }),
    golden: m({ metric: "triangles", variant: "golden", value: ch.golden.triangles, direction: "lower", source: metricsSrc("golden") }),
  },
];

const result = audit(comparisons);
mkdirSync("artifacts/lelu2", { recursive: true });
writeFileSync("artifacts/lelu2/audit.json", JSON.stringify({ generatedAt: new Date().toISOString(), comparisons, ...result }, null, 2));

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(4));
console.log("LÉLU 2.1 — WP01 audit of the published 2.0 numbers\n");
console.log("metric".padEnd(46), "baseline".padStart(10), "golden".padStart(10), "winner".padStart(14), "  note");
for (const v of result.verdicts) {
  const note = v.confounded ? "confounded (unequal n)" : v.applicable ? "" : "not comparable";
  console.log(v.metric.padEnd(46), fmt(v.baseline).padStart(10), fmt(v.golden).padStart(10), v.winner.padStart(14), ` ${note}`);
}
console.log("\nwarnings:");
for (const w of result.warnings) console.log("  -", w);
console.log("\nviolations:");
for (const v of result.violations) console.log("  !", v);
if (!result.violations.length) console.log("  (none)");
console.log(`\nwritten to artifacts/lelu2/audit.json — ok=${result.ok}`);
process.exitCode = result.ok ? 0 : 1;
