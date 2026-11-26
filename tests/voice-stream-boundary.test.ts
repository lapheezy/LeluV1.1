/**
 * LÉLU — A STREAMED "22.8" IS SPOKEN AS ONE NUMBER (Mission 3.8)
 *
 * MEASURED: a live voice turn spoke "mission 22.8 is wrapped" as
 * "twenty-two." … "eight is wrapped": the streamed text so far ended at
 * "22." and a full stop at the end of the text counted as a sentence end.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { nextSpeechBoundary } from "../src/core/voice/VoiceEngine";

test("a full stop after a digit at the end of the stream waits for more", () => {
  assert.equal(nextSpeechBoundary("Right, so mission 22."), null);
  const whole = "Right, so mission 22.8 is wrapped. What next";
  assert.equal(whole.slice(0, nextSpeechBoundary(whole)!).trim(), "Right, so mission 22.8 is wrapped.");
});

test("ordinary sentence ends are still spoken as soon as they arrive", () => {
  assert.equal(nextSpeechBoundary("Hello there."), "Hello there.".length);
  assert.equal(nextSpeechBoundary("Ready?"), 6);
  assert.equal(nextSpeechBoundary("Done! More"), "Done! ".length);
  assert.equal(nextSpeechBoundary("Version 3. Next"), "Version 3. ".length, "a digit-ended sentence followed by a space is complete");
  assert.equal(nextSpeechBoundary("**Key facts**\nOne"), "**Key facts**\n".length);
  assert.equal(nextSpeechBoundary("still typing"), null);
});
