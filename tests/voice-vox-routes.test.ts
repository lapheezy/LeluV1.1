/**
 * App routes to the VoxCPM2 worker (plugins/voxApi.ts), against a fake worker.
 *
 *   · no worker configured → 503 not-configured
 *   · a worker that is not READY → 503 no-ready-worker, with its state
 *   · WAV is relayed with the worker's X-Lelu-* headers
 *   · a PCM stream is relayed chunk by chunk with its L16 content type
 *   · closing the client request aborts the worker request (STOP reaches the worker)
 *   · timeouts grow with the text
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createVoxApi, speechTimeoutMs } from "../plugins/voxApi";

type Fake = { url: string; aborted: () => boolean; close: () => Promise<void> };

async function fakeWorker(state: string): Promise<Fake> {
  let aborted = false;
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, state, ready: state === "READY", loaded: state === "READY", sampleRate: 48000, device: "cpu" }));
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "audio/L16;rate=48000;channels=1" });
        let sent = 0;
        const timer = setInterval(() => {
          sent += 1;
          res.write(Buffer.alloc(960));
          if (sent === 50) {
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
      res.writeHead(200, { "Content-Type": "audio/wav", "X-Lelu-Rtf": "4.2", "X-Lelu-Engine": "voxcpm2" });
      res.end(Buffer.from("RIFF....WAVEfake"));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, aborted: () => aborted, close: () => new Promise((r) => server.close(() => r())) };
}

async function app(env: Record<string, string>): Promise<{ base: string; close: () => Promise<void> }> {
  const api = createVoxApi({ readEnv: (k) => env[k] });
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (path, handler) => routes.push([path, handler]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([path]) => req.url?.startsWith(path));
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }
    match[1](req, res, () => {
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}

const post = (base: string, body: unknown, signal?: AbortSignal) =>
  fetch(`${base}/api/voice/vox/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

test("no worker configured is 503 not-configured", async () => {
  const server = await app({ VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const response = await post(server.base, { input: "hi" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "not-configured");
  } finally {
    await server.close();
  }
});

test("a LOADING worker is not used, and the reason says so", async () => {
  const worker = await fakeWorker("LOADING");
  const server = await app({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const response = await post(server.base, { input: "hi" });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.reason, "no-ready-worker");
    assert.match(JSON.stringify(body.snapshot), /LOADING/);
  } finally {
    await server.close();
    await worker.close();
  }
});

test("WAV is relayed with the worker's measurements", async () => {
  const worker = await fakeWorker("READY");
  const server = await app({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const response = await post(server.base, { input: "hello" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("x-lelu-rtf"), "4.2");
    assert.equal(response.headers.get("x-lelu-worker"), "local");
    assert.match(Buffer.from(await response.arrayBuffer()).toString(), /^RIFF/);
  } finally {
    await server.close();
    await worker.close();
  }
});

test("a PCM stream is relayed in chunks", async () => {
  const worker = await fakeWorker("READY");
  const server = await app({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const response = await post(server.base, { input: "hello", stream: true, response_format: "pcm" });
    assert.equal(response.headers.get("content-type"), "audio/L16;rate=48000;channels=1");
    let bytes = 0;
    let chunks = 0;
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      chunks += 1;
    }
    assert.equal(bytes, 50 * 960);
    assert.ok(chunks > 1, "arrives incrementally");
  } finally {
    await server.close();
    await worker.close();
  }
});

test("closing the client request aborts the worker request (STOP)", async () => {
  const worker = await fakeWorker("READY");
  const server = await app({ VOXCPM_BASE_URL: worker.url, VOXCPM_LOCAL_FALLBACK: "0" });
  try {
    const controller = new AbortController();
    const response = await post(server.base, { input: "hello", stream: true, response_format: "pcm" }, controller.signal);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    controller.abort();
    for (let i = 0; i < 50 && !worker.aborted(); i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(worker.aborted(), true);
  } finally {
    await server.close();
    await worker.close();
  }
});

test("timeouts grow with text length and are capped", () => {
  assert.ok(speechTimeoutMs(500) > speechTimeoutMs(20));
  assert.equal(speechTimeoutMs(100_000), 600_000);
});
