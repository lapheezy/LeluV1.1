/**
 * ==========================================================
 * LÉLU — NATURAL END OF TURN
 *
 * CATEGORY: unit, offline. The rule in turnTaking.ts and its wiring into the
 * engine's capture path. Found in the live conversation runs: a fixed 0.9 s
 * silence split "What day comes after Monday? … One short sentence." (a
 * 1.13-1.23 s pause in the middle) into two turns, the second superseding her
 * answer to the first.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  joinSegments,
  SEGMENT_END_SILENCE_MS,
  TURN_GRACE_MS,
  turnGraceMs,
  turnShape,
} from "../src/core/voice/turnTaking";

test("finished questions and statements are recognised as finished", () => {
  for (const text of [
    "What day comes after Monday?",
    "Can you hear me?",
    "Roughly how tall is it?",
    "Is it far?",
    "Which planet is the largest?",
    "Where are you from?",
    "Is it?",
  ]) {
    assert.equal(turnShape(text), "question", text);
  }
  for (const text of [
    "My favourite colour is green.",
    "Thanks! Bye for now.",
    "One short sentence.",
    "Okay.",
    "Tell me about the moon in three sentences.",
    // Finished, though they end on a pronoun, an auxiliary or a preposition.
    "I really like it.",
    "That's what it is.",
    "Turn it on.",
  ]) {
    assert.equal(turnShape(text), "statement", text);
  }
});

test("a thought that is not finished waits for the rest", () => {
  for (const text of [
    "So I was thinking about",
    "I want to go to Paris and",
    "Well, because",
    "Um.",
    "Uh...",
    "The reason is,",
    "Let me think —",
    "I was wondering if",
    "What about the",
    "Could you tell me whether the",
    "We went there because",
    "The capital of",
    "",
  ]) {
    assert.equal(turnShape(text), "unfinished", JSON.stringify(text));
  }
  // Whisper puts a full stop on fragments: the last word still says unfinished.
  assert.equal(turnShape("I went to the shop and."), "unfinished");
  assert.equal(turnShape("Is it the?"), "unfinished");
});

test("the wait after the last word fits the shape, and covers the measured mid-thought pause", () => {
  const total = (text: string) => SEGMENT_END_SILENCE_MS + turnGraceMs(text);
  // The pauses that split turns in the live runs: 1.13, 1.22, 1.23 s.
  assert.ok(total("What day comes after Monday?") > 1230, "a 1.23 s pause after a question no longer ends the turn");
  assert.ok(total("Can you hear me?") > 1130);
  // Responsive: a finished question is handed over within ~1.3 s of silence.
  // The live runs split at 1.0 and 1.23 s; resuming is noticed within ~0.2 s.
  assert.ok(total("Hi Lélu. What is the capital of France?") >= 1230 + 200);
  assert.ok(total("Can you hear me?") <= 1500, "a finished question is still handed over within 1.5 s");
  assert.ok(total("Thanks.") <= 1600);
  // A thinking pause gets much longer.
  assert.ok(total("So I was thinking about") >= 2500);
  assert.ok(TURN_GRACE_MS.unfinished > TURN_GRACE_MS.statement && TURN_GRACE_MS.statement >= TURN_GRACE_MS.question);
});

test("segments join into one line", () => {
  assert.equal(joinSegments("What day comes after Monday?", "One short sentence."), "What day comes after Monday? One short sentence.");
  assert.equal(joinSegments("So I was thinking...", "about Mars."), "So I was thinking about Mars.");
  assert.equal(joinSegments("", "Hello."), "Hello.");
  assert.equal(joinSegments("Hello.", "  "), "Hello.");
  // The word at the cut heard twice (live run: "Tell me about the The ocean…").
  assert.equal(joinSegments("Tell me about the", "The ocean in three sentences."), "Tell me about the ocean in three sentences.");
});

test("the capture path hands segments to the turn rule, and speech resuming keeps the turn open", () => {
  const source = readFileSync(new URL("../src/core/voice/VoiceEngine.ts", import.meta.url), "utf8");
  const chain = source.slice(source.indexOf("private transcribeInOrder"), source.indexOf("private onTranscriptionError"));
  assert.match(chain, /this\.addTurnSegment\(heard, provenance, speechEndedAt\)/, "a transcript is a segment, not yet a turn");
  assert.doesNotMatch(chain, /this\.handleUserSpeech\(/, "nothing goes to her before the turn rule says it is finished");
  const onset = source.slice(source.indexOf("private onSpeechOnset"), source.indexOf("private onSpeechOnset") + 800);
  assert.match(onset, /pendingTurn\.continuing = true/, "voiced speech during the wait keeps the same turn");
  // Sound in the next segment can arrive before the previous transcript does.
  assert.match(source, /continuing: this\.soundInSegment/, "a turn created while the person is already speaking again waits for them");
  assert.match(source, /this\.pendingTurn\.continuing = this\.soundInSegment/);
  const vad = readFileSync(new URL("../src/core/voice/vadWorklet.ts", import.meta.url), "utf8");
  assert.match(vad, /this\.silence >= \$\{SEGMENT_END_SILENCE_MS\}/, "the audio thread closes segments at the shared constant");
  assert.match(source, /threshold: this\.vadFloor, onActivity: \(\) => this\.onSoundActivity\(\)/, "each segment starts from the last floor, and sound pauses the handover");
});

test("a segment that starts from the previous floor hears resumed speech at once", async () => {
  const { TURN_DETECTOR_SOURCE } = await import("../src/core/voice/vadWorklet");
  const run = (options: unknown, samples: Float32Array, rate: number) => {
    const events: Array<{ kind: string; ms: number }> = [];
    class Port {
      onmessage: unknown = null;
      postMessage(data: Record<string, number | boolean>) {
        if ("activity" in data) events.push({ kind: "activity", ms: Number(data.ms) });
        else if ("onset" in data) events.push({ kind: "onset", ms: Number(data.ms) });
      }
    }
    class AudioWorkletProcessor {
      port = new Port();
    }
    let Processor: (new (o: unknown) => { process: (i: Float32Array[][]) => boolean }) | null = null;
    new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", TURN_DETECTOR_SOURCE)(
      AudioWorkletProcessor,
      (_n: string, cls: typeof Processor) => (Processor = cls),
      rate,
    );
    const node = new (Processor as unknown as new (o: unknown) => { process: (i: Float32Array[][]) => boolean })(options);
    for (let i = 0; i < samples.length; i += 128) if (!node.process([[samples.subarray(i, i + 128)]])) break;
    return events;
  };
  // Speech from the very first sample (a person resuming after a pause).
  const b = readFileSync(new URL("../docs/missions/live-voice-evidence/mic/f4.wav", import.meta.url));
  const rate = b.readUInt32LE(24);
  const data = b.subarray(44);
  const speech = new Float32Array(data.length / 2);
  for (let i = 0; i < speech.length; i++) speech[i] = data.readInt16LE(i * 2) / 32768;
  // Trim the clip's own leading silence so speech starts at once.
  const firstLoud = speech.findIndex((x) => Math.abs(x) > 0.02);
  const resumed = speech.subarray(Math.max(0, firstLoud));

  const fresh = run({}, resumed, rate);
  const carried = run({ processorOptions: { threshold: 0.012 } }, resumed, rate);
  const at = (events: typeof fresh, kind: string) => events.find((e) => e.kind === kind)?.ms ?? Infinity;
  assert.ok(at(carried, "activity") <= 60, `sound is noticed within one window (${at(carried, "activity")} ms)`);
  assert.ok(at(carried, "onset") < 300, `speech is confirmed before the old blind 300 ms ended (${at(carried, "onset")} ms)`);
  assert.ok(at(fresh, "onset") >= 300, "without a carried floor the first 300 ms are spent learning it");
});
