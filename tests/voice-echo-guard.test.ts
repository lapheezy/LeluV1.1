/**
 * LÉLU — M23.0 echo guard.
 *
 * `isEchoUtterance` has two error directions and they are not symmetric:
 * a missed echo makes her answer herself, a false catch makes her talk over a
 * person who is trying to stop her. The measured matrix
 * (MISSION-23.0/logs/echo-guard-matrix.json) found the guard caught 100% of
 * echoes but swallowed 37.5% of short interruptions, because "no" is three
 * characters and the old rule treated every fragment that short as her own
 * trailing audio. These tests pin the corrected behaviour in both directions.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isEchoUtterance } from "../src/core/voice/VoiceEngine";

const HER = "Binary search halves the search space each step, so it runs in logarithmic time.";

test("an interruption is never mistaken for her own voice", () => {
  // The measured defect: every one of these was classified as echo.
  for (const utterance of ["no", "No!", "hey", "no, stop", "wait", "hold on", "that's wrong"]) {
    assert.equal(isEchoUtterance(utterance, HER), false, `"${utterance}" must be heard`);
  }
});

test("a question addressed to her is a turn, even in her own words", () => {
  const spoken = "An API is a contract that lets one program ask another for something.";
  assert.equal(isEchoUtterance("is an API a contract or a protocol?", spoken), false);
  assert.equal(isEchoUtterance("what about the worst case?", spoken), false);
});

test("her own words coming back are still recognised as echo", () => {
  assert.equal(isEchoUtterance(HER, HER), true, "a perfect loopback is echo");
  assert.equal(isEchoUtterance("binary search halves the search space", HER), true, "a partial return is echo");
  assert.equal(isEchoUtterance("binary search halves", HER), true);
  assert.equal(isEchoUtterance("halves the search space each step", HER), true);
});

test("a non-question echo of her words is still echo", () => {
  // The interruption and question rules must not open a hole for the echo
  // path: a plain fragment with no interrogation mark stays echo.
  assert.equal(isEchoUtterance("logarithmic time", HER), true);
  assert.equal(isEchoUtterance("the search space each step", HER), true);
});

test("unrelated short speech is not echo", () => {
  assert.equal(isEchoUtterance("tell me about volcanoes", HER), false);
  assert.equal(isEchoUtterance("what is the capital of Chile?", HER), false);
  assert.equal(isEchoUtterance("thanks", HER), false);
});

test("empty input is never echo", () => {
  assert.equal(isEchoUtterance("", HER), false);
  assert.equal(isEchoUtterance(HER, ""), false);
  assert.equal(isEchoUtterance("   ", "   "), false);
});
