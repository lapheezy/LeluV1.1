/**
 * ==========================================================
 * LÉLU — VOICE FINALIZATION: HER VOICE ON A WORKER SLOWER THAN REAL TIME
 *
 * CATEGORY: unit + route, offline. Found in the real app with VoxCPM2 on a
 * 4-core CPU (RTF 6–10, docs/missions/VOICE-VOXCPM-FINALIZATION.md):
 *
 *   1. the page aborted every sentence at a fixed 15 s header timeout, so
 *      she never spoke — the wait now scales with the worker's measured pace;
 *   2. a PCM stream from such a worker plays as fragments separated by
 *      silence — the relay asks it for one whole WAV per sentence instead;
 *   3. every sentence of a reply was requested at once, the worker's queue
 *      answered 503 from the sixth on and the reply switched to the browser
 *      voice — look-ahead is now bounded, and a stop aborts what is queued;
 *   4. "Speaking" was shown through 20 s of synthesis with nothing audible —
 *      the label now follows the real audio state.
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { voiceStatus } from "../src/core/voice/voiceStatus";
import { workerRtf } from "../src/core/voice/gpuWorkers";
import { createVoiceApi } from "../plugins/voiceApi";

/* ------------------------------ label ------------------------------ */

test("the label follows the audio, not the turn", () => {
  const base = { active: true, captureSuspended: false, audioPlaying: false } as const;
  assert.equal(voiceStatus({ ...base, phase: "listening", ttsStage: "idle" }).key, "listening");
  assert.equal(voiceStatus({ ...base, phase: "processing", ttsStage: "idle" }).key, "transcribing");
  assert.equal(voiceStatus({ ...base, phase: "responding", ttsStage: "idle" }).key, "thinking");
  // Her turn, reply text still arriving, nothing sent to the voice yet.
  assert.equal(voiceStatus({ ...base, phase: "speaking", ttsStage: "idle" }).key, "thinking");
  // The worker is generating: NOT "Speaking", but she can be stopped.
  const generating = voiceStatus({ ...base, phase: "speaking", ttsStage: "requested" });
  assert.equal(generating.key, "generating");
  assert.equal(generating.canStopSpeech, true);
  const speaking = voiceStatus({ ...base, phase: "speaking", ttsStage: "playing", audioPlaying: true });
  assert.equal(speaking.key, "speaking");
  assert.equal(speaking.canStopSpeech, true);
  assert.equal(voiceStatus({ ...base, phase: "speaking", ttsStage: "failed" }).key, "voice-failed");
  assert.equal(voiceStatus({ ...base, active: false, phase: "idle", ttsStage: "idle" }).key, "off");
  assert.equal(voiceStatus({ ...base, captureSuspended: true, phase: "listening", ttsStage: "idle" }).key, "paused");
  // A typed reply spoken with the microphone off still shows that she speaks.
  assert.equal(voiceStatus({ ...base, active: false, phase: "speaking", ttsStage: "playing", audioPlaying: true }).key, "speaking");
});

/* ------------------------------ pace ------------------------------ */

test("the worker's pace comes from its own measurements", () => {
  assert.equal(workerRtf({ last: { rtf: 7.95 } }), 7.95);
  assert.equal(workerRtf({ last: null, selftest: { ms: 12317, audioSeconds: 1.28 } }), 9.62);
  assert.equal(workerRtf({}), null);
  assert.equal(workerRtf({ last: { rtf: 0 } }), null);
});

/* ------------------------------ route ------------------------------ */

type Fake = { url: string; bodies: Array<Record<string, unknown>>; close: () => Promise<void> };

async function fakeWorker(rtf: number): Promise<Fake> {
  const bodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, state: "READY", ready: true, loaded: true, sampleRate: 48000, device: "cpu", engine: "voxcpm2", last: { rtf } }));
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      bodies.push(body);
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "audio/L16;rate=48000;channels=1", "X-Lelu-Engine": "voxcpm2" });
        res.end(Buffer.alloc(960));
        return;
      }
      res.writeHead(200, { "Content-Type": "audio/wav", "X-Lelu-Engine": "voxcpm2" });
      res.end(Buffer.from("RIFF\0\0\0\0WAVEfmt fake"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    bodies,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function serve(env: Record<string, string>) {
  const api = createVoiceApi((name) => env[name]);
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (path, handler) => routes.push([path, handler as never]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([path]) => (req.url ?? "").startsWith(path));
    const notFound = () => {
      res.statusCode = 404;
      res.end();
    };
    if (!match) return notFound();
    match[1](req, res, notFound);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

const speak = (base: string, body: unknown) =>
  fetch(`${base}/api/voice/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("a worker slower than real time answers a stream request with one whole WAV, and says why", async () => {
  const worker = await fakeWorker(7.95);
  const app = await serve({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const status = (await (await fetch(`${app.base}/api/voice/status`)).json()) as { workerRtf?: number; provider?: string };
    assert.equal(status.provider, "speech-worker");
    assert.equal(status.workerRtf, 7.95, "the page is told the worker's pace");
    const response = await speak(app.base, { text: "Your favorite color is green.", stream: true });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /audio\/wav/);
    assert.equal(response.headers.get("x-lelu-streaming"), "off:slower-than-realtime");
    assert.equal(response.headers.get("x-lelu-worker-rtf"), "7.95");
    await response.arrayBuffer();
    assert.equal(worker.bodies.at(-1)?.stream, false, "the worker was asked for the whole sentence");
  } finally {
    app.close();
    await worker.close();
  }
});

test("a worker that keeps up still streams", async () => {
  const worker = await fakeWorker(0.9);
  const app = await serve({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const response = await speak(app.base, { text: "Streaming still works.", stream: true });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^audio\/L16/i);
    assert.equal(response.headers.get("x-lelu-streaming"), "worker");
    await response.arrayBuffer();
    assert.equal(worker.bodies.at(-1)?.stream, true);
  } finally {
    app.close();
    await worker.close();
  }
});

test("VOXCPM_STREAM_MAX_RTF moves the line", async () => {
  const worker = await fakeWorker(1.5);
  const app = await serve({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0", VOXCPM_STREAM_MAX_RTF: "1" });
  try {
    const response = await speak(app.base, { text: "A stricter line.", stream: true });
    assert.equal(response.headers.get("x-lelu-streaming"), "off:slower-than-realtime");
    await response.arrayBuffer();
  } finally {
    app.close();
    await worker.close();
  }
});

test("a page that buffers gets a stream even from a slow worker (live conversation)", async () => {
  const worker = await fakeWorker(6.9);
  const app = await serve({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const response = await speak(app.base, { text: "She starts a sentence-length sooner.", stream: true, buffered: true });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^audio\/L16/i, "PCM as it is generated, not one whole WAV");
    assert.equal(response.headers.get("x-lelu-streaming"), "buffered", "and the page is told it must buffer");
    assert.equal(response.headers.get("x-lelu-worker-rtf"), "6.9", "with the worker's pace to buffer by");
    await response.arrayBuffer();
    assert.equal(worker.bodies.at(-1)?.stream, true);
    // A page that does not buffer still gets the whole WAV.
    const plain = await speak(app.base, { text: "Without buffering.", stream: true });
    assert.equal(plain.headers.get("x-lelu-streaming"), "off:slower-than-realtime");
    await plain.arrayBuffer();
  } finally {
    app.close();
    await worker.close();
  }
});

test("a buffered stream starts once the rest of the sentence cannot overtake it", async () => {
  const { pcmStartReady, estimateSpeechSeconds } = await import("../src/core/voice/elevenLabsTts");
  // RTF 3: a 3 s sentence needs 2 s buffered (+0.3 s margin) before it may start.
  assert.equal(pcmStartReady({ producedSeconds: 1.9, expectedSeconds: 3, pace: 1 / 3, complete: false }), false);
  assert.equal(pcmStartReady({ producedSeconds: 2.35, expectedSeconds: 3, pace: 1 / 3, complete: false }), true);
  // A worker that keeps up starts with the first chunk.
  assert.equal(pcmStartReady({ producedSeconds: 0.1, expectedSeconds: 3, pace: 1.2, complete: false }), true);
  // The stream ended: play what there is.
  assert.equal(pcmStartReady({ producedSeconds: 0.8, expectedSeconds: 3, pace: 0.3, complete: true }), true);
  assert.equal(pcmStartReady({ producedSeconds: 0, expectedSeconds: 3, pace: 0.3, complete: true }), false);
  // Longer than estimated: never waits for more than it has already produced.
  assert.equal(pcmStartReady({ producedSeconds: 4, expectedSeconds: 3, pace: 1 / 3, complete: false }), true);
  // The estimate: ~0.068 s per character, never under 0.6 s.
  assert.ok(Math.abs(estimateSpeechSeconds("The Eiffel Tower is the most famous tower in France.") - 3.5) < 0.1);
  assert.equal(estimateSpeechSeconds("Hi."), 0.6);
});

/* ------------------------------ page queue ------------------------------ */

test("the page waits as long as the worker needs, and no longer than it must", async () => {
  const g = globalThis as Record<string, unknown>;
  const started: string[] = [];
  const signals: AbortSignal[] = [];
  g.window = globalThis;
  g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/voice/status")) {
      return new Response(JSON.stringify({ configured: true, workerRtf: 9.6 }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { text: string };
    started.push(body.text);
    if (init?.signal) signals.push(init.signal);
    // A slow worker: nothing comes back until aborted.
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  const tts = await import("../src/core/voice/elevenLabsTts");

  assert.equal(tts.ttsHeaderTimeoutMs(30, null), 15_000, "unknown pace: a hung engine still fails fast");
  assert.equal(tts.ttsHeaderTimeoutMs(30, 0.9), 15_000);
  assert.equal(tts.ttsHeaderTimeoutMs(30, 9.6), 15_000 + 2 * 30 * 0.08 * 9.6 * 1000);
  assert.equal(tts.ttsHeaderTimeoutMs(5000, 9.6), 300_000, "capped");

  assert.equal(await tts.elevenLabsReady(), true);
  for (let index = 1; index <= 8; index += 1) void tts.speakText(`Sentence number ${index}.`);
  await new Promise((resolve) => setTimeout(resolve, 30));
  // Live conversation: against a worker slower than real time, ONE request
  // is in flight at a time (it generates one sentence at a time anyway, and
  // two sent together reached it out of order in the live run — see
  // tests/voice-live-conversation.test.ts). Look-ahead stays bounded either way.
  assert.equal(started.length, 1, "only one sentence is requested from a slow worker at a time");
  assert.ok(started.length <= 1 + tts.SYNTHESIS_AHEAD, "never more than the playing sentence and the look-ahead");

  tts.stopSpeaking();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(signals.length > 0 && signals.every((signal) => signal.aborted), "a stop aborts every request already sent");
  assert.equal(started.length, 1, "and nothing further is requested");
});

/* ------------------------------ ears ------------------------------ */

test("noise transcribed as the name hint is not a user turn", async () => {
  const { isPromptEcho, WHISPER_NAME_HINT } = await import("../src/core/voice/transcriptionTransport");
  assert.equal(isPromptEcho(" Talking with Lélu."), true, "measured: pink noise came back as the prompt");
  assert.equal(isPromptEcho("talking with lelu"), true);
  assert.equal(isPromptEcho(WHISPER_NAME_HINT), true);
  assert.equal(isPromptEcho("Hello Lélu. My favorite color is green."), false);
  assert.equal(isPromptEcho("I was talking with Lélu yesterday."), false, "a real sentence that contains it is kept");
  assert.equal(isPromptEcho(""), false);
});

test("a frame without microphone permission is not reported as the person's refusal", async () => {
  const { mapMediaError } = await import("../src/core/voice/speechToText");
  const denied = { name: "NotAllowedError" };
  assert.equal(mapMediaError(denied, () => false).kind, "blocked-embed", "measured: Chromium says NotAllowedError for a policy block");
  assert.match(mapMediaError(denied, () => false).message, /allow="microphone"/);
  assert.equal(mapMediaError(denied, () => true).kind, "permission");
  assert.equal(mapMediaError(denied, () => null).kind, "permission", "a browser that does not say keeps the old answer");
  assert.equal(mapMediaError({ name: "NotFoundError" }, () => false).kind, "no-device");
});
