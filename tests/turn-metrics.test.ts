/**
 * LÉLU — TURN METRICS
 * CATEGORY: unit. Counts and timings only; nothing here may carry content.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTurnMetrics,
  newTurnMeasurement,
  noteFallback,
  noteFirstText,
  noteProviderAttempt,
  noteProviderFailure,
  summarizeTurn,
} from "../src/core/router/TurnMetrics";

test("time to first text is measured at the first delta, and only once", () => {
  const measurement = newTurnMeasurement(1_000);
  noteProviderAttempt(measurement);
  noteFirstText(measurement, 2_200);
  noteFirstText(measurement, 2_900);
  const summary = summarizeTurn(measurement, 0, 3_000);
  assert.equal(summary.timeToFirstTextMs, 1_200);
  assert.equal(summary.totalMs, 2_000);
});

test("no delta means no measurement — never an estimate from the final text", () => {
  const measurement = newTurnMeasurement(5_000);
  noteProviderAttempt(measurement);
  const summary = summarizeTurn(measurement, 2, 9_000);
  assert.equal(summary.timeToFirstTextMs, null);
  assert.equal(summary.toolsRun, 2);
});

test("attempts, failures and fallbacks are counted where they happen", () => {
  const measurement = newTurnMeasurement(0);
  noteProviderAttempt(measurement); // OpenRouter
  noteProviderFailure(measurement);
  noteFallback(measurement); // → Groq
  noteProviderAttempt(measurement); // Groq answers
  const summary = summarizeTurn(measurement, 3, 1_500);
  assert.deepEqual(summary, {
    timeToFirstTextMs: null,
    totalMs: 1_500,
    providerAttempts: 2,
    providerFailures: 1,
    fallbacks: 1,
    toolsRun: 3,
  });
});

test("the log line is one line of counts and milliseconds, with no content", () => {
  const measurement = newTurnMeasurement(0);
  noteProviderAttempt(measurement);
  noteFirstText(measurement, 750);
  const line = formatTurnMetrics(summarizeTurn(measurement, 1, 4_000));
  assert.equal(line, "[turn] firstText=750ms total=4000ms attempts=1 failures=0 fallbacks=0 tools=1");
  assert.match(line, /^\[turn\] /);
  assert.doesNotMatch(line, /\n/);
});
