/**
 * LÉLU — M23.0 turn speech outcomes.
 *
 * The M22.9 run produced four turns with no speech and no recorded reason,
 * which is why they could not be classified afterwards. These tests pin the
 * vocabulary that makes silence explainable, and the wording of the notice
 * that is spoken instead of nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TURN_SPEECH_OUTCOMES,
  holdingLineFor,
  isSilentOutcome,
  outcomeForFailure,
  summarizeOutcomes,
  type TurnSpeechOutcome,
} from "../src/core/voice/speechOutcome";
import type { VoiceTurnFailureKind } from "../src/core/voice/turnFailure";

test("every outcome is listed exactly once", () => {
  assert.equal(new Set(TURN_SPEECH_OUTCOMES).size, TURN_SPEECH_OUTCOMES.length);
  const expected: TurnSpeechOutcome[] = [
    "spoke",
    "superseded",
    "provider-unavailable",
    "provider-timeout",
    "network-failure",
    "transcription-failure",
    "empty-reply",
    "unpronounceable",
    "playback-failed",
    "cancelled",
    "echo-suppressed",
    "duplicate-suppressed",
  ];
  assert.deepEqual([...TURN_SPEECH_OUTCOMES].sort(), [...expected].sort());
});

test("only \"spoke\" counts as audible", () => {
  for (const outcome of TURN_SPEECH_OUTCOMES) {
    assert.equal(isSilentOutcome(outcome), outcome !== "spoke", outcome);
  }
});

test("every turn failure kind maps onto an outcome", () => {
  const kinds: VoiceTurnFailureKind[] = [
    "provider-timeout",
    "transcription-failure",
    "playback-failure",
    "user-cancellation",
    "network-failure",
    "provider-unavailable",
  ];
  const mapped = kinds.map(outcomeForFailure);
  assert.deepEqual(mapped, [
    "provider-timeout",
    "transcription-failure",
    "playback-failed",
    "cancelled",
    "network-failure",
    "provider-unavailable",
  ]);
  for (const outcome of mapped) {
    assert.ok(TURN_SPEECH_OUTCOMES.includes(outcome), `${outcome} must be a known outcome`);
  }
});

test("a provider refusal now speaks a notice instead of nothing", () => {
  // The M22.9 four-turn silence: provider quota exhausted, reply treated as a
  // failure notice, notice deliberately unspoken → no audio at all.
  const line = holdingLineFor("provider-unavailable");
  assert.ok(line && line.length > 20, "a refusal must say something");
  assert.ok(line.length < 140, "the holding line must stay short enough to speak");
});

test("the notice is her wording, never the provider's error text", () => {
  for (const outcome of ["provider-unavailable", "provider-timeout", "network-failure"] as TurnSpeechOutcome[]) {
    const line = holdingLineFor(outcome);
    assert.ok(line, `${outcome} must have a holding line`);
    assert.doesNotMatch(line!, /429|rate limit|quota|OpenAI|Groq|OpenRouter|http|token/i);
    assert.match(line!, /[.!?]$/, "the notice must be a spoken sentence");
  }
});

test("there is nothing to say when she was stopped or cannot play audio", () => {
  for (const outcome of ["cancelled", "playback-failed", "superseded", "spoke", "echo-suppressed"] as TurnSpeechOutcome[]) {
    assert.equal(holdingLineFor(outcome), null, `${outcome} must not speak a notice`);
  }
});

test("unexplained counts turns that ended with no reason at all", () => {
  const summary = summarizeOutcomes(["spoke", "spoke", "provider-unavailable"], 5, 1, "provider-unavailable");
  assert.equal(summary.started, 5);
  assert.equal(summary.recorded, 3);
  assert.equal(summary.unexplained, 2);
  assert.equal(summary.spoken, 2);
  assert.equal(summary.silent, 1);
  assert.equal(summary.noticeSpoken, 1);
  assert.deepEqual(summary.byOutcome, { spoke: 2, "provider-unavailable": 1 });
  assert.equal(summary.last, "provider-unavailable");
});

test("a fully recorded session has zero unexplained turns", () => {
  const outcomes: TurnSpeechOutcome[] = [
    "spoke",
    "superseded",
    "provider-unavailable",
    "echo-suppressed",
    "duplicate-suppressed",
    "spoke",
  ];
  const summary = summarizeOutcomes(outcomes, outcomes.length);
  assert.equal(summary.unexplained, 0);
  assert.equal(summary.silent, 4);
  assert.equal(summary.started, summary.recorded);
});
