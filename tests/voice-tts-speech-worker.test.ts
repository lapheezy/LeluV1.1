/**
 * ==========================================================
 * LÉLU — /api/voice/tts SPEAKS THROUGH HER SPEECH WORKER (MOSS on Contabo)
 *
 * CATEGORY: route, offline. createVoiceApi against a real local HTTP server
 * and a fake worker that answers like services/mossnano/server.py:
 * GET /health → {state, ready, loaded, sampleRate}; POST /v1/audio/speech →
 * audio/wav, or chunked `audio/L16;rate=48000;channels=1` when streaming.
 *
 * Production answered 503 "No speech engine is configured." because this
 * route only knew ElevenLabs and Piper while the VPS runs MOSS on :8789.
 *
 *   · worker READY, no paid key → 200 audio from the worker (WAV and PCM)
 *   · the PCM rate reaches the page as X-Lelu-Sample-Rate (48 kHz, not 16)
 *   · /api/voice/status reports configured, so the page asks for speech
 *   · worker not READY and no Piper → the same honest 503 as before
 *   · no VOXCPM_* configured, or VOICE_PROVIDER=elevenlabs → route unchanged
 *   · STOP (client abort) reaches the worker
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createVoiceApi } from "../plugins/voiceApi";
import { l16SampleRate } from "../plugins/voxApi";

type Fake = { url: string; speechCalls: () => number; aborted: () => boolean; close: () => Promise<void> };

async function fakeMoss(state: string): Promise<Fake> {
  let aborted = false;
  let calls = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, state, ready: state === "READY", loaded: state === "READY", sampleRate: 48000, device: "cpu" }));
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls += 1;
      const body = JSON.parse(raw);
      assert.equal(typeof body.input, "string");
      if (body.stream) {
        assert.equal(body.response_format, "pcm");
        res.writeHead(200, { "Content-Type": "audio/L16;rate=48000;channels=1", "X-Lelu-Engine": "moss-tts-nano" });
        let sent = 0;
        const timer = setInterval(() => {
          sent += 1;
          res.write(Buffer.alloc(960));
          if (sent === 20) {
            clearInterval(timer);
            res.end();
          }
        }, 20);
        res.on("close", () => {
          if (!res.writableFinished) aborted = true;
          clearInterval(timer);
        });
        return;
      }
      res.writeHead(200, { "Content-Type": "audio/wav", "X-Lelu-Engine": "moss-tts-nano", "X-Lelu-Synthesis-Ms": "321" });
      res.end(Buffer.from("RIFF\0\0\0\0WAVEfmt fake"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    speechCalls: () => calls,
    aborted: () => aborted,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

async function serve(env: Record<string, string>) {
  const api = createVoiceApi((k) => env[k]);
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
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

const tts = (base: string, body: unknown, signal?: AbortSignal) =>
  fetch(`${base}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/*" },
    body: JSON.stringify(body),
    signal,
  });

/** No paid key, no Piper, no stray loopback worker: only the fake. */
const envFor = (url: string, extra: Record<string, string> = {}) => ({ VOXCPM_BASE_URL: url, VOXCPM_LOCAL_FALLBACK: "0", ...extra });

test("l16SampleRate reads the rate the worker declares", () => {
  assert.equal(l16SampleRate("audio/L16;rate=48000;channels=1"), 48000);
  assert.equal(l16SampleRate("audio/l16; rate=22050"), 22050);
  assert.equal(l16SampleRate("audio/wav"), null);
  assert.equal(l16SampleRate(null), null);
});

test("streamed speech comes from the worker, with its rate in X-Lelu-Sample-Rate", async () => {
  const moss = await fakeMoss("READY");
  const app = await serve(envFor(moss.url));
  try {
    const response = await tts(app.base, { text: "Bonjour, je suis là.", stream: true });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^audio\/L16;rate=48000/i);
    assert.equal(response.headers.get("x-lelu-sample-rate"), "48000");
    assert.equal(response.headers.get("x-lelu-voice-provider"), "worker:lelu-reference");
    assert.equal(response.headers.get("x-lelu-engine"), "moss-tts-nano");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, 20 * 960);
    assert.equal(moss.speechCalls(), 1);
  } finally {
    app.close();
    await moss.close();
  }
});

test("non-streamed speech is the worker's WAV", async () => {
  const moss = await fakeMoss("READY");
  const app = await serve(envFor(moss.url));
  try {
    const response = await tts(app.base, { text: "Bonjour." });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("x-lelu-synthesis-ms"), "321");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  } finally {
    app.close();
    await moss.close();
  }
});

test("status reports a configured worker so the page asks for speech", async () => {
  const moss = await fakeMoss("READY");
  const app = await serve(envFor(moss.url));
  try {
    const status = (await (await fetch(`${app.base}/api/voice/status`)).json()) as Record<string, unknown>;
    assert.equal(status.configured, true);
    assert.equal(status.provider, "speech-worker");
    assert.equal(status.voiceId, "worker:lelu-reference");
    const diagnostic = (await (await fetch(`${app.base}/api/voice/diagnostic`)).json()) as { tts: { provider: string; configured: boolean } };
    assert.equal(diagnostic.tts.provider, "speech-worker");
    assert.equal(diagnostic.tts.configured, true);
  } finally {
    app.close();
    await moss.close();
  }
});

test("a paid key without spend authorization does not silence her: the worker speaks", async () => {
  const moss = await fakeMoss("READY");
  const app = await serve(envFor(moss.url, { ELEVENLABS_API_KEY: "test-key-not-authorized" }));
  try {
    const status = (await (await fetch(`${app.base}/api/voice/status`)).json()) as Record<string, unknown>;
    assert.equal(status.provider, "speech-worker");
    const response = await tts(app.base, { text: "Bonjour.", stream: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-lelu-voice-provider"), "worker:lelu-reference");
    await response.arrayBuffer();
    assert.equal(moss.speechCalls(), 1);
  } finally {
    app.close();
    await moss.close();
  }
});

test("a paid key without spend authorization and no READY worker keeps the 402", async () => {
  const moss = await fakeMoss("LOADING");
  const app = await serve(envFor(moss.url, { ELEVENLABS_API_KEY: "test-key-not-authorized" }));
  try {
    const response = await tts(app.base, { text: "Bonjour." });
    assert.equal(response.status, 402);
  } finally {
    app.close();
    await moss.close();
  }
});

test("a worker that is not READY, with no Piper, keeps the honest 503", async () => {
  const moss = await fakeMoss("LOADING");
  const app = await serve(envFor(moss.url));
  try {
    const response = await tts(app.base, { text: "Bonjour.", stream: true });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /No (streaming )?speech engine is configured\./);
    assert.equal(moss.speechCalls(), 0);
  } finally {
    app.close();
    await moss.close();
  }
});

test("without VOXCPM_* the route and status are unchanged", async () => {
  const app = await serve({});
  try {
    const response = await tts(app.base, { text: "Bonjour." });
    assert.equal(response.status, 503);
    const status = (await (await fetch(`${app.base}/api/voice/status`)).json()) as Record<string, unknown>;
    assert.equal(status.configured, false);
    assert.equal(status.provider, undefined);
  } finally {
    app.close();
  }
});

test("VOICE_PROVIDER=elevenlabs keeps the worker out of this route", async () => {
  const moss = await fakeMoss("READY");
  const app = await serve(envFor(moss.url, { VOICE_PROVIDER: "elevenlabs" }));
  try {
    const response = await tts(app.base, { text: "Bonjour." });
    assert.equal(response.status, 503);
    assert.equal(moss.speechCalls(), 0);
  } finally {
    app.close();
    await moss.close();
  }
});

test("STOP: aborting the page's request stops the worker's stream", async () => {
  const moss = await fakeMoss("READY");
  const app = await serve(envFor(moss.url));
  try {
    const controller = new AbortController();
    const response = await tts(app.base, { text: "Une longue phrase.", stream: true }, controller.signal);
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    for (let i = 0; i < 50 && !moss.aborted(); i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(moss.aborted(), true);
  } finally {
    app.close();
    await moss.close();
  }
});
