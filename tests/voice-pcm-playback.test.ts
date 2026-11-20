/**
 * ==========================================================
 * LÉLU — PLAYBACK BEGINS ON THE FIRST CHUNK
 *
 * CATEGORY: unit. elevenLabsTts.ts with a streaming fake broker and a
 * fake AudioContext. No network, no audio device.
 *
 * The claim under test: the first scheduled buffer starts while the rest
 * of the sentence is still arriving, chunks are scheduled after one
 * another (never over each other), and a stop halts playback and aborts
 * the stream rather than letting it finish unhead.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

const starts: number[] = [];
let stopped = 0;

class FakeBuffer {
  duration: number;
  constructor(public length: number, public rate: number) {
    this.duration = length / rate;
  }
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  connect(): void {}
  disconnect(): void {}
  start(when: number): void {
    starts.push(when);
  }
  stop(): void {
    stopped += 1;
  }
}

class FakeContext {
  currentTime = 0;
  state = "running" as const;
  destination = {};
  createBuffer(_channels: number, length: number, rate: number): FakeBuffer {
    return new FakeBuffer(length, rate);
  }
  createBufferSource(): FakeSource {
    return new FakeSource();
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.AudioContext = FakeContext;
g.Audio = class {
  play(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  removeAttribute(): void {}
  load(): void {}
};

/** A body that delivers chunk 1 now and chunk 2 only when released. */
function gatedStream(): { stream: ReadableStream<Uint8Array>; release: () => void; delivered: () => number } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let count = 0;
  const chunk = (value: number) => new Uint8Array(new Int16Array([value, value, value, value]).buffer);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(chunk(1000));
      count += 1;
      await gate;
      controller.enqueue(chunk(2000));
      count += 1;
      controller.close();
    },
  });
  return { stream, release, delivered: () => count };
}

let current: { stream: ReadableStream<Uint8Array>; release: () => void; delivered: () => number } | null = null;

g.fetch = async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/voice/status")) {
    return new Response(JSON.stringify({ configured: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("/api/voice/tts")) {
    current = gatedStream();
    return new Response(current.stream, {
      status: 200,
      headers: { "Content-Type": "audio/L16;rate=16000;channels=1", "X-Lelu-Sample-Rate": "16000" },
    });
  }
  return new Response("{}", { status: 404 });
};

const { speakText, stopSpeaking } = await import("../src/core/voice/elevenLabsTts");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("audio starts while the rest of the sentence is still arriving", async () => {
  starts.length = 0;
  stopSpeaking();
  let startedAt = 0;
  const started = new Promise<void>((resolve) => {
    void speakText("A streamed sentence.", {
      onStart: () => {
        startedAt = Date.now();
        resolve();
      },
    });
  });
  await started;
  assert.ok(current, "the stream was requested");
  assert.equal(current!.delivered(), 1, "only the first chunk had arrived when playback began");
  assert.equal(starts.length, 1, "and one buffer was scheduled");

  const secondChunkArrivedAt: number[] = [];
  const before = Date.now();
  current!.release();
  await wait(80);
  secondChunkArrivedAt.push(Date.now() - before);
  assert.equal(current!.delivered(), 2, "the second chunk arrived");
  assert.ok(startedAt > 0, "playback had already started");
  assert.equal(starts.length, 2, "the second chunk was scheduled too");
  assert.ok(
    starts[1] >= starts[0] + 4 / 16000 - 1e-6,
    "the second buffer starts after the first, never over it",
  );
});

test("a stop halts playback and aborts the stream", async () => {
  starts.length = 0;
  stopped = 0;
  stopSpeaking();
  const ended = new Promise<void>((resolve) => {
    void speakText("This sentence is interrupted.", { onEnd: () => resolve() });
  });
  await wait(40);
  assert.equal(starts.length, 1, "playback started");
  stopSpeaking();
  await ended;
  assert.ok(stopped >= 1, "the scheduled buffer was stopped");
  assert.equal(starts.length, 1, "nothing else was scheduled after the stop");
});
