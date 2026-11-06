/**
 * ==========================================================
 * LÉLU — VOICE ADAPTERS
 *
 * CATEGORY: unit. No microphone exists in this runtime, so
 * nothing here claims to have tested audio. These are the parts
 * that break conversations and CAN be proven without one:
 *   • chunked text loses and repeats nothing at a boundary;
 *   • background noise does not open the detector;
 *   • a thinking pause does not end the utterance;
 *   • overlapping recognition windows are de-duplicated;
 *   • an interruption stops synthesis at the next chunk;
 *   • an unconfigured service refuses instead of pretending;
 *   • the benchmark computes median/p95 from real samples.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  KokoroAdapter,
  VadDetector,
  WhisperAdapter,
  mergeTranscripts,
  normaliseSpeechText,
  planSpeechChunks,
  summariseBenchmark,
} from "../src/core/voice/adapters/VoiceAdapters";

test("chunking preserves every word exactly once", () => {
  const text =
    "Good evening. I have inspected the failing parser test, and the cause is a stale fixture that still expects three arguments. " +
    "I have updated it and the suite passes. Would you like me to show you the diff?";
  const chunks = planSpeechChunks(text, 80);
  assert.ok(chunks.length > 1);
  assert.equal(
    normaliseSpeechText(chunks.map((chunk) => chunk.text).join(" ")),
    normaliseSpeechText(text),
    "a boundary must not drop or duplicate a word",
  );
  assert.ok(chunks.every((chunk) => chunk.text.length <= 80), "no chunk exceeds the limit");
  assert.ok(chunks.at(-1)?.terminal, "the last chunk ends a sentence");
});

test("a chunk never ends mid-word", () => {
  const text = "antidisestablishmentarianism ".repeat(10);
  for (const chunk of planSpeechChunks(text, 40)) {
    assert.ok(!/^\S*[a-z]$/.test(chunk.text) || chunk.text.endsWith("m"), chunk.text);
  }
});

test("steady background noise never opens the detector", () => {
  const vad = new VadDetector({ initialFloor: 0.01 });
  let opened = false;
  for (let frame = 0; frame < 300; frame += 1) {
    // A fridge: constant, slightly varying room tone, never speech.
    if (vad.push({ at: frame * 30, energy: 0.012 + (frame % 3) * 0.001 }) === "started") opened = true;
  }
  assert.equal(opened, false, "constant room tone was treated as speech");
  assert.equal(vad.isSpeaking(), false);
});

test("speech opens the detector, and a thinking pause does not end it", () => {
  const vad = new VadDetector({ initialFloor: 0.01 });
  for (let frame = 0; frame < 5; frame += 1) vad.push({ at: frame * 30, energy: 0.09 });
  assert.equal(vad.isSpeaking(), true, "sustained speech must open the detector");

  // 300 ms of silence — a thinking pause, not the end of the turn (500 ms).
  for (let frame = 0; frame < 10; frame += 1) {
    assert.equal(vad.push({ at: frame * 30, energy: 0.002 }), null);
  }
  assert.equal(vad.isSpeaking(), true, "a pause shorter than the silence threshold ended the utterance");

  for (let frame = 0; frame < 10; frame += 1) vad.push({ at: frame * 30, energy: 0.002 });
  assert.equal(vad.isSpeaking(), false, "the utterance must end after the silence threshold");
});

test("a loud interruption while speaking closes the turn sooner than the threshold", () => {
  const vad = new VadDetector({ initialFloor: 0.01 });
  for (let frame = 0; frame < 5; frame += 1) vad.push({ at: frame * 30, energy: 0.05 });
  assert.equal(vad.isSpeaking(), true);
  assert.equal(vad.flush(), "ended", "a barge-in must be able to close the turn immediately");
  assert.equal(vad.isSpeaking(), false);
});

test("overlapping recognition windows are merged without duplication", () => {
  assert.equal(mergeTranscripts("I have inspected the", "the failing parser test"), "I have inspected the failing parser test");
  assert.equal(mergeTranscripts("Hello there.", "How are you?"), "Hello there. How are you?");
  assert.equal(mergeTranscripts("", "first words"), "first words");
  assert.equal(mergeTranscripts("only words", ""), "only words");
});

test("an unconfigured recogniser refuses and reports nothing transcribed", async () => {
  const whisper = new WhisperAdapter({ baseUrl: undefined });
  const health = whisper.health();
  assert.equal(health.configured, false);
  assert.match(health.detail, /WHISPER_BASE_URL is unset/);

  const previous = process.env.WHISPER_BASE_URL;
  delete process.env.WHISPER_BASE_URL;
  try {
    const result = await whisper.transcribe(new Blob(["audio"]));
    assert.equal(result.text, "");
    assert.match(result.detail, /nothing was transcribed/);
  } finally {
    if (previous !== undefined) process.env.WHISPER_BASE_URL = previous;
  }
});

test("an unconfigured synthesiser refuses and reports nothing synthesised", async () => {
  const previous = process.env.KOKORO_BASE_URL;
  delete process.env.KOKORO_BASE_URL;
  try {
    const kokoro = new KokoroAdapter({ baseUrl: undefined });
    assert.equal(kokoro.health().configured, false);
    const outcome = await kokoro.speak("Hello.", () => {});
    assert.equal(outcome.spoken, 0);
    assert.match(outcome.detail, /nothing was synthesised/);
  } finally {
    if (previous !== undefined) process.env.KOKORO_BASE_URL = previous;
  }
});

test("interruption stops synthesis at the next chunk boundary", async () => {
  const kokoro = new KokoroAdapter({ baseUrl: "http://127.0.0.1:9" });
  const realFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { text: string };
    requested.push(body.text);
    return new Response("audio", { status: 200 });
  }) as typeof fetch;
  try {
    const spoken: string[] = [];
    const outcome = await kokoro.speak("First sentence. Second sentence. Third sentence.", async (chunk) => {
      spoken.push(chunk.text);
      if (spoken.length === 1) kokoro.interrupt();
    }, { maxChars: 20 });
    assert.equal(outcome.interrupted, true);
    assert.equal(spoken.length, 1, "the remaining chunks must not be synthesised after a barge-in");
    assert.equal(requested.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the benchmark computes median and p95 from measured samples, and claims nothing with none", () => {
  const report = summariseBenchmark([
    { transcriptionMs: 100, synthesisMs: 200, responseMs: 300 },
    { transcriptionMs: 120, synthesisMs: 260, responseMs: 420 },
    { transcriptionMs: 900, synthesisMs: 400, responseMs: 1200 },
  ]);
  assert.equal(report.samples, 3);
  assert.equal(report.median.transcriptionMs, 120);
  assert.equal(report.p95.transcriptionMs, 900);
  assert.equal(report.median.responseMs, 420);

  const empty = summariseBenchmark([]);
  assert.equal(empty.median.transcriptionMs, null);
  assert.match(empty.detail, /Nothing is claimed about latency/);
});
