/**
 * ==========================================================
 * LÉLU — THE SPEAKING ROUTE USES THE WARM RUNTIME
 *
 * CATEGORY: route, offline. createVoiceApi against a real local HTTP server
 * with a protocol-faithful fake Piper (MISSION-22.9/scripts/fake-piper.mjs):
 * no model, no provider, no audio device.
 *
 * The contract that matters to the page is unchanged — one POST, audio back
 * — but what the server says about HOW it answered is new, and these tests
 * pin it: the delivery profile used, that the voice was not reloaded, and
 * that the old cold streaming path is still reachable when the warm runtime
 * is switched off.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { createVoiceApi } from "../plugins/voiceApi";
import { shutdownPersistentPipers } from "../plugins/persistentPiper";

const FAKE = join(process.cwd(), "MISSION-22.9", "scripts", "fake-piper.mjs");

async function serve(readEnv: (key: string) => string | undefined) {
  const api = createVoiceApi(readEnv);
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (path, handler) => routes.push([path, handler as never]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([path]) => (req.url ?? "").startsWith(path));
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
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

interface Fixture {
  bin: string;
  model: string;
  directory: string;
}

function fixture(extraEnv = ""): Fixture {
  const directory = mkdtempSync(join(tmpdir(), "lelu-warm-route-"));
  const model = join(directory, "voice.onnx");
  writeFileSync(model, "not a real model");
  writeFileSync(`${model}.json`, JSON.stringify({ audio: { sample_rate: 16_000 } }));
  const bin = join(directory, "piper");
  writeFileSync(bin, `#!/bin/sh\n${extraEnv} exec "${process.execPath}" "${FAKE}" "$@"\n`.trimStart());
  chmodSync(bin, 0o755);
  return { bin, model, directory };
}

function textOf(fixtureValue: Fixture): (key: string) => string | undefined {
  return (key) =>
    key === "LELU_LOCAL_TTS_BIN" ? fixtureValue.bin : key === "LELU_LOCAL_TTS_MODEL" ? fixtureValue.model : undefined;
}

test("stream:true is answered by the warm worker, and says so", async () => {
  const files = fixture();
  const s = await serve(textOf(files));
  try {
    const response = await fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "The warm runtime answers this.", stream: true }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("x-lelu-streaming"), "warm-wav", "a complete WAV is never labelled as PCM");
    assert.equal(response.headers.get("x-lelu-worker-profile"), "warm");
    assert.equal(response.headers.get("x-lelu-model-loads"), "1", "the voice was loaded once");
    assert.equal(response.headers.get("x-lelu-cold-start"), "1", "the first sentence paid for the load");
    assert.equal(Number(response.headers.get("x-lelu-sample-rate")), 16_000);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.toString("ascii", 0, 4), "RIFF");
    assert.ok(body.length > 44);
  } finally {
    s.close();
    shutdownPersistentPipers();
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("the same worker answers again without reloading, and a profile is one load", async () => {
  const files = fixture();
  const s = await serve(textOf(files));
  const speak = (delivery?: string) =>
    fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Another sentence.", stream: true, ...(delivery ? { delivery } : {}) }),
    });
  try {
    const first = await speak();
    assert.equal(first.headers.get("x-lelu-model-loads"), "1");
    await first.arrayBuffer();

    const second = await speak();
    assert.equal(second.headers.get("x-lelu-model-loads"), "1", "no reload for a subsequent sentence");
    assert.equal(second.headers.get("x-lelu-cold-start"), "0");
    await second.arrayBuffer();

    const bright = await speak("bright");
    assert.equal(bright.headers.get("x-lelu-worker-profile"), "bright", "the requested delivery is the one used");
    assert.equal(bright.headers.get("x-lelu-model-loads"), "2", "a second delivery is a second warm worker");
    await bright.arrayBuffer();

    const invalid = await speak("shouting");
    assert.equal(invalid.headers.get("x-lelu-worker-profile"), "warm", "an unknown delivery falls back to her default");
    await invalid.arrayBuffer();
  } finally {
    s.close();
    shutdownPersistentPipers();
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("the diagnostic reports the real runtime, not an intention", async () => {
  const files = fixture();
  const s = await serve(textOf(files));
  try {
    await (await fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "One sentence to start the worker.", stream: true }),
    })).arrayBuffer();
    const body = (await (await fetch(`${s.base}/api/voice/diagnostic`)).json()) as {
      tts: { runtime: Record<string, unknown> & { workers: Array<Record<string, unknown>> } };
    };
    const runtime = body.tts.runtime;
    assert.equal(runtime.persistent, true);
    assert.equal(runtime.modelLoads, 1);
    assert.equal(runtime.warmWorkers, 1);
    assert.equal(runtime.requests, 1);
    assert.equal(runtime.restarts, 0);
    assert.equal(runtime.queueDepth, 0);
    const worker = runtime.workers[0];
    assert.ok(worker);
    assert.equal(worker.profile, "warm");
    assert.equal(worker.state, "ready");
    assert.equal(typeof worker.pid, "number");
    assert.equal(typeof worker.rssMiB, "number");
    assert.match(String(worker.lastError), /^(null|undefined)$/);
    // A diagnostic must never carry her words or a credential.
    assert.doesNotMatch(JSON.stringify(body), /One sentence to start/);
  } finally {
    s.close();
    shutdownPersistentPipers();
    rmSync(files.directory, { recursive: true, force: true });
  }
});

test("LELU_PIPER_PERSISTENT=0 restores the M22.8 streaming path exactly", async () => {
  // The cold path runs the binary with `--output_raw` and forwards stdout as
  // PCM, so this fake emits raw bytes instead of answering JSON lines.
  const directory = mkdtempSync(join(tmpdir(), "lelu-cold-route-"));
  const model = join(directory, "voice.onnx");
  writeFileSync(model, "not a real model");
  writeFileSync(`${model}.json`, JSON.stringify({ audio: { sample_rate: 16_000 } }));
  const raw = join(directory, "piper");
  writeFileSync(raw, "#!/bin/sh\nhead -c 2000 /dev/zero\n");
  chmodSync(raw, 0o755);
  const files = { bin: raw, model, directory };
  const s = await serve((key) => {
    if (key === "LELU_PIPER_PERSISTENT") return "0";
    return textOf(files)(key);
  });
  try {
    const response = await fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Cold process speech.", stream: true }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/L16;rate=16000;channels=1");
    assert.equal(response.headers.get("x-lelu-streaming"), "pcm16");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, 2000, "the cold path forwards the raw bytes unchanged");
    const diagnostic = (await (await fetch(`${s.base}/api/voice/diagnostic`)).json()) as {
      tts: { runtime: { persistent: boolean; mode: string } };
    };
    assert.equal(diagnostic.tts.runtime.persistent, false);
    assert.equal(diagnostic.tts.runtime.mode, "cold-process-per-sentence");
  } finally {
    s.close();
    shutdownPersistentPipers();
    rmSync(files.directory, { recursive: true, force: true });
  }
});
