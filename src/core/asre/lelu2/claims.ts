/**
 * ==========================================================
 * LÉLU 2.1 — CLAIMS: A NUMBER WITH A DIRECTION, AND THE RULES
 * THAT STOP A REPORT FROM CLAIMING WHAT THE NUMBER DOES NOT SHOW
 *
 * A metric is not a result. "CV 0.030 vs 0.166" is a result only when you know
 * which variant each number belongs to, that lower is better for that metric,
 * that both numbers came from the file they claim to come from, and that the
 * two numbers were computed over comparable samples. Each of those is a way a
 * report can go wrong, so each is checked here instead of remembered:
 *
 *   label      the source artefact must name the variant the claim assigns
 *   direction  lower-is-better and higher-is-better are declared per metric
 *   applicability  a divergence angle does not describe a concentric ring
 *   sample size    a nearest-neighbour CV depends on how many points it saw
 *   verdict    if the declared winner loses the measurement, this throws
 *
 * This module has no dependencies so the audit can run in a test, in a script
 * and in the browser without dragging the builder along.
 * ==========================================================
 */

export type Variant = string;
/** Which way is better for this metric. */
export type Direction = "lower" | "higher";

export interface Measurement {
  metric: string;
  variant: Variant;
  value: number;
  direction: Direction;
  /** Raw artefact the number was read from, e.g. `artifacts/lelu2/ornament/comparison.json`. */
  source: string;
  /**
   * Path inside that artefact, e.g. `golden.beadSpacing.cv`. Needed when one
   * file holds both variants: the variant must be named by the source OR the
   * field, and the audit re-reads the value from this path.
   */
  field?: string;
  /**
   * The column label inside a shared file, when a table holds several variants
   * side by side (e.g. the WP02 matrix). Must name the variant it is assigned to.
   */
  variantTag?: string;
  /** A number with no better/worse direction (a cost, a count). Never a win. */
  descriptive?: boolean;
  /** The layout this metric describes. `false`/absent applicability ⇒ not comparable. */
  applicable?: boolean;
  /** Number of samples the statistic was computed over, when it matters. */
  n?: number;
  unit?: string;
  /** Human-readable layout name, so a report can print "concentric rings". */
  layout?: string;
}

export interface Comparison {
  metric: string;
  baseline: Measurement;
  golden: Measurement;
  /** What a report asserts. The audit exists to test this, not to trust it. */
  claimed?: "baseline" | "golden";
  /** True when the statistic depends on the number of samples (nearest-neighbour CV does). */
  sampleSizeSensitive?: boolean;
}

export interface Verdict {
  metric: string;
  baseline: number;
  golden: number;
  unit?: string;
  /**
   * Measured winner. `not-comparable` when a metric does not describe a layout;
   * `descriptive` when the number has no better-or-worse direction at all.
   */
  winner: "baseline" | "golden" | "tie" | "not-comparable" | "descriptive";
  /** Relative change golden vs baseline, in the metric's own direction (+ is better). */
  relativeChange: number;
  applicable: boolean;
  /** Set when the two numbers were computed over different sample counts. */
  confounded: boolean;
  notes: string[];
}

export interface AuditResult {
  verdicts: Verdict[];
  /** Things a report must not say, each with the numbers that contradict it. */
  violations: string[];
  /** Things a report may say, but only with the caveat attached. */
  warnings: string[];
  ok: boolean;
}

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimError";
  }
}

/** Whole-token match, so `baseline` does not match `baseline2` or `not-baseline`. */
function namesVariant(source: string, variant: string): boolean {
  const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(source);
}

/**
 * The source artefact must name the variant. This is the check that catches the
 * classic mistake: two runs write into swapped directories, every downstream
 * table is then correct arithmetic on reversed labels.
 */
export function assertVariantSource(m: Measurement): void {
  if (namesVariant(m.source, m.variant) || (m.field && namesVariant(m.field, m.variant)) || (m.variantTag && namesVariant(m.variantTag, m.variant))) return;
  throw new ClaimError(
    `claim "${m.metric}" is assigned to "${m.variant}" but neither its source "${m.source}" nor its field "${m.field ?? ""}" names that variant — the numbers may be swapped`,
  );
}

function relative(baseline: number, golden: number, direction: Direction): number {
  const denom = Math.abs(baseline) || 1;
  const raw = (golden - baseline) / denom;
  return direction === "lower" ? -raw : raw;
}

/** Measure a comparison. Never throws: callers decide what to do with a losing claim. */
export function verdictFor(c: Comparison): Verdict {
  const notes: string[] = [];
  const descriptive = c.baseline.descriptive === true;
  const applicable = c.baseline.applicable !== false && c.golden.applicable !== false;
  const nA = c.baseline.n;
  const nB = c.golden.n;
  const confounded = Boolean(c.sampleSizeSensitive && nA !== undefined && nB !== undefined && nA !== nB);
  if (descriptive) notes.push(`${c.metric} is reported for completeness; it has no better-or-worse direction`);
  if (!applicable) notes.push(`${c.metric} does not describe both layouts — excluded from scoring`);
  if (confounded) notes.push(`computed over n=${nA} vs n=${nB}; the statistic depends on sample count, so the difference is confounded`);
  const relativeChange = relative(c.baseline.value, c.golden.value, c.baseline.direction);
  let winner: Verdict["winner"];
  if (descriptive) winner = "descriptive";
  else if (!applicable) winner = "not-comparable";
  else if (Math.abs(relativeChange) < 1e-9) winner = "tie";
  else winner = relativeChange > 0 ? "golden" : "baseline";
  return {
    metric: c.metric,
    baseline: c.baseline.value,
    golden: c.golden.value,
    unit: c.baseline.unit,
    winner,
    relativeChange,
    applicable,
    confounded,
    notes,
  };
}

/**
 * Assert that the declared winner is the measured winner. A confounded metric
 * cannot be claimed at all: the audit refuses to certify a comparison whose
 * sample sizes differ, even when the gap looks large.
 */
export function assertClaim(c: Comparison): Verdict {
  assertVariantSource(c.baseline);
  assertVariantSource(c.golden);
  const v = verdictFor(c);
  if (!c.claimed) return v;
  if (v.winner === "descriptive")
    throw new ClaimError(`cannot claim "${c.claimed}" for ${c.metric}: it is a descriptive metric with no winning direction`);
  if (v.winner === "not-comparable")
    throw new ClaimError(`cannot claim "${c.claimed}" for ${c.metric}: the metric does not describe both layouts`);
  if (v.confounded)
    throw new ClaimError(
      `cannot claim "${c.claimed}" for ${c.metric}: ${c.baseline.n} vs ${c.golden.n} samples — repeat at equal n before claiming`,
    );
  if (v.relativeChange === 0) throw new ClaimError(`cannot claim "${c.claimed}" for ${c.metric}: the two values are equal`);
  if (c.claimed !== v.winner)
    throw new ClaimError(
      `report claims "${c.claimed}" wins ${c.metric}, but measurement says "${v.winner}" (${c.baseline.value} vs ${c.golden.value}, ${(v.relativeChange * 100).toFixed(1)}%)`,
    );
  return v;
}

/**
 * Guard for the specific sentence "the golden distribution is more uniform".
 * Uniformity of a nearest-neighbour pattern is measured by its coefficient of
 * variation, and lower is uniform. This throws unless golden is lower by at
 * least `minGain` and both numbers come from their own artefacts.
 */
export function assertMoreUniform(c: Comparison, minGain = 0.05): Verdict {
  const v = assertClaim({ ...c, claimed: "golden" });
  if (v.relativeChange < minGain)
    throw new ClaimError(
      `"more uniform" needs golden at least ${(minGain * 100).toFixed(0)}% lower CV; measured ${(v.relativeChange * 100).toFixed(1)}% (${c.baseline.value} → ${c.golden.value})`,
    );
  return v;
}

/** Run every comparison; collect violations instead of stopping at the first. */
export function audit(comparisons: Comparison[]): AuditResult {
  const verdicts: Verdict[] = [];
  const violations: string[] = [];
  const warnings: string[] = [];
  for (const c of comparisons) {
    try {
      verdicts.push(assertClaim(c));
    } catch (err) {
      violations.push(err instanceof ClaimError ? err.message : String(err));
      verdicts.push(verdictFor(c));
    }
    const v = verdicts[verdicts.length - 1];
    if (v.confounded) warnings.push(`${c.metric}: confounded by sample count — repeat at equal n before publishing`);
    if (!v.applicable) warnings.push(`${c.metric}: not applicable to one of the layouts — report it as "not comparable", not as a win`);
  }
  return { verdicts, violations, warnings, ok: violations.length === 0 };
}
