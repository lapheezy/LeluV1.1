/**
 * ==========================================================
 * LÉLU — THE RUNTIME DIAGNOSTIC SAYS WHAT IS ACTUALLY WIRED
 *
 * CATEGORY: route, offline. createVoiceApi against a real local HTTP
 * server, with the environment supplied by the test. No provider call is
 * made by the route itself, and the test proves it (fetch is stubbed).
 *
 * Mission 22.8 WP06 asks for one answer that names the transcriber, the
 * speaker, the voice identity status, the streaming/interruption paths and
 * what is explicitly NOT this server's to know (a physical microphone, a
 * speaker, the browser's echo cancellation).
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { basename, join } from "node:path";

import { createVoiceApi } from "../plugins/voiceApi";
import { authorizePaidForTests } from "./support/spendAuthorized";

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

/** Any request that leaves the process fails the test (loopback is the test's own server). */
function forbidNetwork(): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (/^https?:\/\/127\.0\.0\.1:/.test(url)) return real(input, init);
    throw new Error(`diagnostic opened a socket: ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

test("with no provider, the diagnostic says so instead of claiming a voice", async () => {
  const restore = forbidNetwork();
  const s = await serve(() => undefined);
  try {
    const body = await (await fetch(`${s.base}/api/voice/diagnostic`)).json();
    assert.equal(body.ok, true);
    assert.equal(body.tts.provider, "none");
    assert.equal(body.tts.configured, false);
    assert.equal(body.voiceIdentity.status, "absent");
    assert.equal(body.voiceIdentity.cloned, false, "Piper is never presented as her clone");
    assert.equal(body.streaming.sentenceStreaming, true);
    assert.equal(body.interruption.fullDuplexCapture, true);
    assert.equal(body.hardware.verified, false, "no physical device was used, so hardware is unverified");
    assert.equal(body.voxcpm.configured, false);
    assert.equal(body.voxcpm.reachable, "unprobed", "the worker's own /health is the authority");
  } finally {
    s.close();
    restore();
  }
});

test("the local speaker is reported as a fallback voice, not as her identity", async () => {
  const model = join(process.cwd(), "package.json");
  const restore = forbidNetwork();
  const s = await serve((key) =>
    key === "LELU_LOCAL_TTS_BIN" ? process.execPath : key === "LELU_LOCAL_TTS_MODEL" ? model : undefined,
  );
  try {
    const body = await (await fetch(`${s.base}/api/voice/diagnostic`)).json();
    assert.equal(body.tts.provider, "local-piper");
    assert.equal(body.tts.configured, true);
    assert.equal(body.tts.localBinary, true);
    assert.equal(body.voiceIdentity.provider, "piper");
    assert.equal(body.voiceIdentity.status, "fallback");
    assert.equal(body.voiceIdentity.cloned, false);
    assert.match(String(body.tts.voiceId), new RegExp(`^local-piper:${basename(model).replace(/\\.onnx$/, "")}$`));
  } finally {
    s.close();
    restore();
  }
});

test("a configured ElevenLabs account is reported as her identity", async () => {
  authorizePaidForTests();
  const restore = forbidNetwork();
  const s = await serve((key) => (key === "ELEVENLABS_API_KEY" ? "xi-test-key-0123456789" : undefined));
  try {
    const body = await (await fetch(`${s.base}/api/voice/diagnostic`)).json();
    assert.equal(body.tts.provider, "elevenlabs");
    assert.equal(body.voiceIdentity.status, "identity");
    assert.equal(body.voiceIdentity.cloned, false);
    assert.doesNotMatch(JSON.stringify(body), /xi-test-key/, "no key is ever echoed");
    assert.equal(body.asr.provider, "elevenlabs-scribe");
  } finally {
    s.close();
    restore();
  }
});
