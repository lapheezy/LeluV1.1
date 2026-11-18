/**
 * LÉLU 2.1 — the audit's own tests.
 *
 * A guard that never fires is decoration. Each test below feeds the claim
 * checker a mistake of the kind the 2.0 report could have made and requires it
 * to throw.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { audit, assertClaim, assertMoreUniform, assertVariantSource, ClaimError, type Comparison, verdictFor } from "../src/core/asre/lelu2/claims.ts";

const ORN = "artifacts/lelu2/ornament/comparison.json";
const cmp = (over: Partial<Comparison> = {}): Comparison => ({
  metric: "bead spacing CV",
  baseline: { metric: "bead spacing CV", variant: "baseline", value: 0.166, direction: "lower", source: ORN, field: "baseline.beadSpacing.cv", n: 34 },
  golden: { metric: "bead spacing CV", variant: "golden", value: 0.03, direction: "lower", source: ORN, field: "golden.beadSpacing.cv", n: 34 },
  claimed: "golden",
  sampleSizeSensitive: true,
  ...over,
});

test("accepts a claim the numbers support", () => {
  const v = assertClaim(cmp());
  assert.equal(v.winner, "golden");
  assert.ok(v.relativeChange > 0.8);
});

test("rejects a label that its own source file does not name", () => {
  // the classic swap: golden numbers written into the baseline directory
  assert.throws(
    () =>
      assertVariantSource({
        metric: "bead spacing CV",
        variant: "baseline",
        value: 0.03,
        direction: "lower",
        source: "artifacts/lelu2/golden/lelu2-golden-metrics.json",
      }),
    ClaimError,
  );
});

test("rejects a uniformity claim when the CV went up", () => {
  const reversed = cmp({
    golden: { metric: "bead spacing CV", variant: "golden", value: 0.4, direction: "lower", source: ORN, field: "golden.beadSpacing.cv", n: 34 },
  });
  assert.throws(() => assertMoreUniform(reversed), /more uniform|wins/);
  const v = verdictFor(reversed);
  assert.equal(v.winner, "baseline");
  assert.ok(v.relativeChange < 0);
});

test("rejects a claim that is confounded by unequal sample counts", () => {
  const confounded = cmp({
    baseline: { metric: "hair root spacing CV", variant: "baseline", value: 1.345, direction: "lower", source: "artifacts/lelu2/baseline/lelu2-baseline-metrics.json", n: 928 },
    golden: { metric: "hair root spacing CV", variant: "golden", value: 0.643, direction: "lower", source: "artifacts/lelu2/golden/lelu2-golden-metrics.json", n: 1350 },
    metric: "hair root spacing CV",
  });
  assert.throws(() => assertClaim(confounded), /equal n/);
  assert.equal(verdictFor(confounded).confounded, true);
});

test("a metric that does not describe both layouts cannot be a win", () => {
  const notApplicable = cmp({
    metric: "recovered divergence (degrees)",
    baseline: { metric: "recovered divergence (degrees)", variant: "baseline", value: 27.5, direction: "lower", source: ORN, field: "baseline.divergenceDeg", applicable: false },
    golden: { metric: "recovered divergence (degrees)", variant: "golden", value: 137.5, direction: "lower", source: ORN, field: "golden.divergenceDeg" },
  });
  assert.throws(() => assertClaim(notApplicable), /does not describe/);
  assert.equal(verdictFor(notApplicable).winner, "not-comparable");
});

test("a descriptive metric has no winner and cannot be claimed", () => {
  const descriptive = cmp({
    metric: "mean bead spacing",
    baseline: { metric: "mean bead spacing", variant: "baseline", value: 0.0178, direction: "higher", source: ORN, field: "baseline.beadSpacing.mean", descriptive: true },
    golden: { metric: "mean bead spacing", variant: "golden", value: 0.0159, direction: "higher", source: ORN, field: "golden.beadSpacing.mean", descriptive: true },
  });
  assert.equal(verdictFor(descriptive).winner, "descriptive");
  assert.throws(() => assertClaim(descriptive), /descriptive/);
});

test("a tie is not an improvement", () => {
  const tie = cmp({
    golden: { metric: "bead spacing CV", variant: "golden", value: 0.166, direction: "lower", source: ORN, field: "golden.beadSpacing.cv", n: 34 },
  });
  assert.throws(() => assertClaim(tie), /equal/);
});

test("audit collects every violation and stays non-ok", () => {
  const r = audit([cmp(), cmp({ claimed: "baseline" })]);
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.verdicts.length, 2);
});
