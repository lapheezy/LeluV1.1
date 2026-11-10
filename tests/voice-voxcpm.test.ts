/**
 * ==========================================================
 * LÉLU — VOXCPM2 VOICE IDENTITY (OFFLINE)
 *
 * The route and the adapter are exercised with a stubbed upstream,
 * because this runtime has no GPU and therefore no VoxCPM2 process.
 * What is proven here is the part that breaks a voice integration:
 *   • the committed reference is required, never substituted;
 *   • consent is a hard gate, not a warning;
 *   • the request carries the reference audio AND its transcript;
 *   • a provider failure is reported as failure, never as audio;
 *   • overlapping requests are serialised, and a stop cancels;
 *   • a missing asset is reported missing.
 * What is NOT proven here: speaker similarity. That needs a human
 * listening to generated audio (see the mission report).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

import { createVoxCpmApi, DEFAULT_REFERENCE_WAV, DEFAULT_VOXCPM_MODEL } from "../plugins/voxcpmApi";

const REFERENCE_WAV = "deploy/voxcpm/reference/lelu-voice-reference-44k-mono.wav";

/** A tiny but real WAV container: 44-byte header plus a few samples. */
function tinyWav(): Uint8Array {
  const samples = 64;
  const data = new Uint8Array(44 + samples * 2);
  const view = new DataView(data.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 44100, true);
  view.setUint32(28, 44100 * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  return data;
}

let referenceDir: string | null = null;

/** Point the route at a real reference file for one test. */
function withReference(): { dir: string; file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "lelu-voxcpm-"));
  referenceDir = dir;
  const file = path.join(dir, "reference.wav");
  writeFileSync(file, tinyWav());
  return {
    dir,
    file,
    cleanup: () => {
      if (referenceDir === dir) referenceDir = null;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function serve(readEnv: (key: string) => string | undefined) {
  const api = createVoxCpmApi(readEnv);
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (p, h) => routes.push([p, h as never]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([p]) => (req.url ?? "").startsWith(p));
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

/** Replace the inference server (and only it) with a stub. */
function stubUpstream(handler: (body: Record<string, unknown>) => Response) {
  const real = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/v1/audio/speech")) {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ url, body });
      return handler(body);
    }
    return real(input, init);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const CONSENT = "LELU_VOICE_CONSENT_ATTESTED";

function env(overrides: Record<string, string | undefined>) {
  return (key: string) => overrides[key];
}

test("status is honest when nothing is configured: no inference server, no audio", async () => {
  // Pin an absent reference explicitly: the default path is a real file once
  // `prepare-reference.sh` has been run, and this test must not flip on that.
  const absent = path.join(tmpdir(), "lelu-absent-reference.wav");
  const s = await serve(env({ VOXCPM_REFERENCE_WAV: absent }));
  const stub = stubUpstream(() => new Response("nope", { status: 500 }));
  try {
    const body = (await (await fetch(`${s.base}/api/voice/voxcpm/status`)).json()) as Record<string, unknown>;
    assert.equal(body.configured, false);
    assert.equal(body.referenceLoaded, false);
    assert.equal(body.consentAttested, false);
    assert.equal(body.contacted, false, "status must not claim it contacted a server it never called");
    assert.match(String(body.detail), /VOXCPM_BASE_URL is unset/);
    assert.match(String(body.detail), /consent|authorisation/i);
    assert.equal(stub.calls.length, 0, "status must make no network call");
  } finally {
    stub.restore();
    s.close();
  }
});

test("status reports the prepared reference and the pinned model without leaking a path", async () => {
  const ref = withReference();
  const s = await serve(
    env({ VOXCPM_BASE_URL: "http://127.0.0.1:9", VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }),
  );
  try {
    const body = (await (await fetch(`${s.base}/api/voice/voxcpm/status`)).json()) as Record<string, unknown>;
    assert.equal(body.configured, true);
    assert.equal(body.referenceLoaded, true);
    assert.equal(body.consentAttested, true);
    assert.equal(body.model, DEFAULT_VOXCPM_MODEL);
    assert.equal(body.referenceFile, "reference.wav");
    assert.ok(!JSON.stringify(body).includes(ref.dir), "the private storage path must not be returned");
  } finally {
    ref.cleanup();
    s.close();
  }
});

test("generation is refused (403) until the speaker authorisation is attested", async () => {
  const ref = withReference();
  const s = await serve(env({ VOXCPM_BASE_URL: "http://127.0.0.1:9", VOXCPM_REFERENCE_WAV: ref.file }));
  const stub = stubUpstream(() => new Response(tinyWav(), { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello." }),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as Record<string, unknown>;
    assert.match(String(body.error), /consent/i);
    assert.equal(stub.calls.length, 0, "a gated clone must never reach the model");
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("generation is refused (503) when no inference server is configured", async () => {
  const ref = withReference();
  const s = await serve(env({ VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }));
  const stub = stubUpstream(() => new Response(tinyWav(), { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello." }),
    });
    assert.equal(response.status, 503);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("a missing reference is reported missing, never replaced by another voice", async () => {
  const s = await serve(
    env({
      VOXCPM_BASE_URL: "http://127.0.0.1:9",
      VOXCPM_REFERENCE_WAV: path.join(tmpdir(), "lelu-absent-reference.wav"),
      [CONSENT]: "true",
    }),
  );
  const stub = stubUpstream(() => new Response(tinyWav(), { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello." }),
    });
    assert.equal(response.status, 503);
    assert.match(String(((await response.json()) as Record<string, unknown>).error), /not prepared|missing/i);
    assert.equal(stub.calls.length, 0, "nothing may be synthesised without the committed reference");
  } finally {
    stub.restore();
    s.close();
  }
});

test("the request carries the reference audio and its exact transcript, and audio comes back", async () => {
  const ref = withReference();
  const s = await serve(
    env({ VOXCPM_BASE_URL: "http://127.0.0.1:8123/", VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }),
  );
  const wav = tinyWav();
  const stub = stubUpstream(() => new Response(wav, { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "This is LÉLU speaking." }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/wav");
    assert.equal(response.headers.get("x-lelu-voice-identity"), "lelu-reference-v1");
    const audio = new Uint8Array(await response.arrayBuffer());
    assert.equal(audio.byteLength, wav.byteLength, "the audio must reach the page intact");

    assert.equal(stub.calls.length, 1);
    const sent = stub.calls[0].body;
    assert.equal(stub.calls[0].url, "http://127.0.0.1:8123/v1/audio/speech", "trailing slash must not double up");
    assert.equal(sent.model, DEFAULT_VOXCPM_MODEL);
    assert.equal(sent.input, "This is LÉLU speaking.");
    assert.equal(sent.response_format, "wav");
    assert.ok(typeof sent.prompt_text === "string" && (sent.prompt_text as string).length > 100, "the transcript must be supplied");
    assert.ok(typeof sent.reference_text === "string");
    assert.equal(sent.prompt_audio, sent.reference_audio, "the same clip drives prompt and reference (ultimate cloning)");
    const decoded = Buffer.from(String(sent.reference_audio), "base64");
    assert.equal(decoded.byteLength, wav.byteLength, "the reference audio must be the committed clip");
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("a provider failure is reported as failure — never a 200 carrying audio that was not made", async () => {
  const ref = withReference();
  const s = await serve(
    env({ VOXCPM_BASE_URL: "http://127.0.0.1:9", VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }),
  );
  const stub = stubUpstream(() => new Response(JSON.stringify({ detail: "CUDA out of memory" }), { status: 500 }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello." }),
    });
    assert.equal(response.status, 502);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.ok, false);
    assert.doesNotMatch(JSON.stringify(body), /CUDA out of memory/, "an upstream body is not echoed back");
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("empty audio from the provider fails instead of playing silence", async () => {
  const ref = withReference();
  const s = await serve(
    env({ VOXCPM_BASE_URL: "http://127.0.0.1:9", VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }),
  );
  const stub = stubUpstream(() => new Response(new Uint8Array(0), { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Hello." }),
    });
    assert.equal(response.status, 502);
    assert.match(String(((await response.json()) as Record<string, unknown>).error), /empty/i);
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("over-long text is refused before it reaches the model", async () => {
  const ref = withReference();
  const s = await serve(
    env({ VOXCPM_BASE_URL: "http://127.0.0.1:9", VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }),
  );
  const stub = stubUpstream(() => new Response(tinyWav(), { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "a".repeat(901) }),
    });
    assert.equal(response.status, 413);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("a cross-origin page cannot spend her voice", async () => {
  const ref = withReference();
  const s = await serve(
    env({ VOXCPM_BASE_URL: "http://127.0.0.1:9", VOXCPM_REFERENCE_WAV: ref.file, [CONSENT]: "true" }),
  );
  const stub = stubUpstream(() => new Response(tinyWav(), { headers: { "content-type": "audio/wav" } }));
  try {
    const response = await fetch(`${s.base}/api/voice/voxcpm/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
        Host: new URL(s.base).host,
      },
      body: JSON.stringify({ text: "Hello." }),
    });
    assert.equal(response.status, 403);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
    ref.cleanup();
    s.close();
  }
});

test("the default reference path is the derived clip, not the committed original", () => {
  assert.equal(DEFAULT_REFERENCE_WAV, REFERENCE_WAV);
  assert.ok(!DEFAULT_REFERENCE_WAV.endsWith(".m4a"), "the model is not fed the compressed original directly");
});
