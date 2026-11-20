/**
 * ==========================================================
 * LÉLU — SYNTHESIS RUNS AHEAD, PLAYBACK STAYS IN ORDER
 *
 * CATEGORY: unit. elevenLabsTts.ts with a stubbed broker, counted
 * requests and a fake HTMLAudioElement. No network, no audio device.
 *
 * Before this, one sentence was synthesised and played, then the next was
 * requested: between two streamed sentences the listener waited out a
 * whole synthesis. The pipeline now requests the next sentence's audio as
 * soon as its text exists — while the current sentence is still playing —
 * and one pump keeps playback strictly in order.
 *
 * What must stay true: requests may run ahead, playback may not overlap,
 * a failure is reported as a failure, and a stop drops everything that was
 * already synthesising instead of letting it start late.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

const audios: FakeAudio[] = [];
let requests: string[] = [];
let ttsStatus = 200;
let synthesisDelayMs = 25;

class FakeAudio {
  src: string;
  ended = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    audios.push(this);
  }
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {
    this.ended = true;
  }
  removeAttribute(): void {}
  load(): void {}
}

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.Audio = FakeAudio;
g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/voice/status")) {
    return new Response(JSON.stringify({ configured: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/api/voice/tts")) {
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { text?: string }) : {};
    requests.push(String(body.text ?? ""));
    await new Promise((resolve) => setTimeout(resolve, synthesisDelayMs));
    if (ttsStatus !== 200) return new Response("{}", { status: ttsStatus });
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  }
  return new Response("{}", { status: 404 });
};

const { speakText, stopSpeaking, ttsQueueDepth, getLastSynthesis } = await import(
  "../src/core/voice/elevenLabsTts"
);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the next sentence is synthesised while the current one is still playing", async () => {
  requests = [];
  audios.length = 0;
  stopSpeaking();

  void speakText("First sentence.");
  void speakText("Second sentence.");
  await wait(60);

  assert.deepEqual(requests, ["First sentence.", "Second sentence."], "both syntheses were requested up front");
  assert.equal(audios.length, 1, "but only the first is playing — playback never overlaps");
  assert.ok(getLastSynthesis(), "the synthesis time of the last request is recorded");

  // The first ends; the already-synthesised second starts immediately.
  const first = audios[0];
  first.ended = true;
  first.onended?.();
  await wait(40);
  assert.equal(audios.length, 2, "the second sentence was already ready and started without a new wait");
});

test("order is preserved: the queue plays the segments in the order they arrived", async () => {
  requests = [];
  audios.length = 0;
  stopSpeaking();

  const started: string[] = [];
  void speakText("Alpha.", { onStart: () => started.push("alpha") });
  void speakText("Beta.", { onStart: () => started.push("beta") });
  await wait(50);
  assert.deepEqual(started, ["alpha"], "beta waits for alpha to finish");

  audios[0].ended = true;
  audios[0].onended?.();
  await wait(40);
  assert.deepEqual(started, ["alpha", "beta"], "then beta starts, in order");
});

test("a stop drops what was already synthesising instead of playing it late", async () => {
  requests = [];
  audios.length = 0;
  stopSpeaking();

  void speakText("One.");
  void speakText("Two.");
  void speakText("Three.");
  await wait(50);
  const playing = audios.length;
  assert.equal(playing, 1, "one segment is playing, two are queued");

  stopSpeaking();
  await wait(60);
  assert.equal(audios.length, playing, "nothing queued behind the stop started playing");
  assert.equal(ttsQueueDepth(), 0, "and the queue is empty");
});

test("a refused synthesis is a failure, never silent success", async () => {
  requests = [];
  audios.length = 0;
  stopSpeaking();
  ttsStatus = 401;
  const failures: string[] = [];
  const ends: string[] = [];
  void speakText("Cannot be spoken.", { onFail: () => failures.push("fail"), onEnd: () => ends.push("end") });
  await wait(60);
  assert.deepEqual(failures, ["fail"], "the caller is told it failed");
  assert.deepEqual(ends, [], "and it is not reported as spoken");
  ttsStatus = 200;
});

test("an empty segment ends without asking a provider", async () => {
  requests = [];
  let ended = 0;
  await speakText("   ", { onEnd: () => (ended += 1) });
  assert.equal(ended, 1);
  assert.deepEqual(requests, [], "no synthesis request for whitespace");
});
