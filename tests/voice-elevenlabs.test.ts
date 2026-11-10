/**
 * Mission 10 — ElevenLabs ears and voice, server route + client metering.
 * OFFLINE: ElevenLabs is replaced by a stub fetch. The live checks are in
 * scripts/verify-voice-e2e.cjs and docs/voice/MISSION_10_VOICE_MOBILE_MULTIMODAL_REPORT.md.
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createVoiceApi, usageFromHeaders } from "../plugins/voiceApi";
import { normalizeHerName, transcribeWithElevenLabs } from "../src/core/voice/elevenLabsStt";
import UsageLedger from "../src/core/observability/UsageLedger";

async function serve(readEnv: (k: string) => string | undefined) {
  const api = createVoiceApi(readEnv);
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (p, h) => routes.push([p, h as never]) });
  const server = http.createServer((req, res) => {
    const match = routes.find(([p]) => (req.url ?? "").startsWith(p));
    if (!match) { res.statusCode = 404; res.end(); return; }
    match[1](req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => { server.closeAllConnections(); server.close(); } };
}

/** Replace ElevenLabs (and only ElevenLabs) with a stub for one test. */
function stubElevenLabs(handler: (url: string, init: RequestInit) => Response) {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.elevenlabs.io/")) {
      calls.push(url);
      return handler(url, init ?? {});
    }
    return real(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

test("usage headers: ElevenLabs' own numbers pass through; absent means unknown (null), never 0", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.deepEqual(usageFromHeaders(h({ "character-cost": "44" })), { characterCost: 44, fiatCostUsd: null });
  assert.deepEqual(usageFromHeaders(h({ "character-cost": "3", "fiat-cost-before-overages": "0.0003" })), { characterCost: 3, fiatCostUsd: 0.0003 });
  assert.deepEqual(usageFromHeaders(h({ "character-cost": "abc" })), { characterCost: null, fiatCostUsd: null });
});

test("her name as transcription engines mishear it is restored, only as her name", () => {
  assert.equal(normalizeHerName("Lei Liu, what's the weather on Mars?"), "Lélu, what's the weather on Mars?"); // heard live
  assert.equal(normalizeHerName("hey lelu can you help"), "hey Lélu can you help");
  assert.equal(normalizeHerName("Hey Leilou, what is the capital of Peru?"), "Hey Lélu, what is the capital of Peru?"); // heard live
  assert.equal(normalizeHerName("I visited Honolulu yesterday"), "I visited Honolulu yesterday");
  assert.equal(normalizeHerName("the dog is called Lulu"), "the dog is called Lulu", "not at the start, not after a greeting");
});

test("status reports STT and TTS availability without a network call or the key", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  const stub = stubElevenLabs(() => new Response("{}"));
  try {
    const body = await (await fetch(`${s.base}/api/voice/status`)).json();
    assert.deepEqual(body, { configured: true, stt: true, voiceId: "cgSgspJ2msm6clMCkdW9", modelId: "eleven_v3", sttModelId: "scribe_v1" });
    assert.equal(stub.calls.length, 0);
    assert.doesNotMatch(JSON.stringify(body), /xi-test-key/);
  } finally { stub.restore(); s.close(); }
});

test("STT: audio goes to Scribe with the server's key, the transcript and reported usage come back", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  let sentKey = "";
  const stub = stubElevenLabs((_url, init) => {
    sentKey = new Headers(init.headers).get("xi-api-key") ?? "";
    return new Response(JSON.stringify({ text: "what is the capital of Peru", language_code: "eng" }), {
      headers: { "content-type": "application/json", "character-cost": "3", "fiat-cost-before-overages": "0.0003" },
    });
  });
  try {
    const r = await fetch(`${s.base}/api/voice/stt?lang=en`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: new Uint8Array(4000) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.text, "what is the capital of Peru");
    assert.deepEqual(body.usage, { characterCost: 3, fiatCostUsd: 0.0003 });
    assert.equal(sentKey, "xi-test-key", "the key is attached on the server");
    assert.equal(stub.calls[0], "https://api.elevenlabs.io/v1/speech-to-text");
  } finally { stub.restore(); s.close(); }
});

test("STT refuses what it should: cross-origin, non-audio, empty, oversized — before any upstream call", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  const stub = stubElevenLabs(() => new Response("{}"));
  try {
    const post = (headers: Record<string, string>, body: Uint8Array) => fetch(`${s.base}/api/voice/stt`, { method: "POST", headers, body });
    assert.equal((await post({ "Content-Type": "audio/webm", Origin: "https://evil.example" }, new Uint8Array(4000))).status, 403);
    assert.equal((await post({ "Content-Type": "text/plain" }, new Uint8Array(4000))).status, 415);
    assert.equal((await post({ "Content-Type": "audio/webm" }, new Uint8Array(10))).status, 400);
    assert.equal((await post({ "Content-Type": "audio/webm" }, new Uint8Array(12_000_001))).status, 413);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); s.close(); }
});

test("TTS and STT are rate-limited per client", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  const stub = stubElevenLabs(() => new Response(JSON.stringify({ text: "x" }), { headers: { "content-type": "application/json" } }));
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 42; i += 1) {
      statuses.push((await fetch(`${s.base}/api/voice/stt`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: new Uint8Array(400) })).status);
    }
    assert.equal(statuses.filter((x) => x === 200).length, 40);
    assert.equal(statuses.at(-1), 429);
  } finally { stub.restore(); s.close(); }
});

test("no key: both routes say so (503) and nothing is sent upstream", async () => {
  const s = await serve(() => undefined);
  const stub = stubElevenLabs(() => new Response("{}"));
  try {
    assert.equal((await fetch(`${s.base}/api/voice/stt`, { method: "POST", headers: { "Content-Type": "audio/webm" }, body: new Uint8Array(400) })).status, 503);
    assert.equal((await fetch(`${s.base}/api/voice/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hi" }) })).status, 503);
    assert.equal(stub.calls.length, 0);
  } finally { stub.restore(); s.close(); }
});

test("a spent account cools and the next account speaks instead of failing", async () => {
  const keys = new Map([
    ["Elevenlabs", "xi-spent-key-1"],
    ["Elevenlabs2", "xi-fresh-key-2"],
    ["Elevenlabs3", "xi-fresh-key-3"],
  ]);
  const s = await serve((k) => keys.get(k));
  const seen: string[] = [];
  const stub = stubElevenLabs((_url, init) => {
    const key = new Headers(init.headers).get("xi-api-key") ?? "";
    seen.push(key);
    // The first account's month is spent; the others still speak.
    if (key === "xi-spent-key-1") {
      return new Response(JSON.stringify({ detail: { status: "quota_exceeded" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
      headers: { "content-type": "audio/mpeg", "character-cost": "9" },
    });
  });
  const speak = () =>
    fetch(`${s.base}/api/voice/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
  try {
    const first = await speak();
    assert.equal(first.status, 200, "a spent account must not silence her");
    assert.equal(first.headers.get("content-type"), "audio/mpeg");
    assert.equal(seen.at(-1), "xi-fresh-key-2", "the second account's key is the one that spoke");
    const second = await speak();
    assert.equal(second.status, 200);
    assert.notEqual(seen.at(-1), "xi-spent-key-1", "a cooling credential is not handed out again");
    assert.equal(
      seen.filter((key) => key === "xi-spent-key-1").length,
      1,
      "the spent key is paid for once, not once per synthesis",
    );
  } finally { stub.restore(); s.close(); }
});

test("client STT is metered with ElevenLabs' reported character and USD cost, and a spent budget refuses before uploading", async () => {
  const ledger = UsageLedger.getInstance();
  const real = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = (async () => {
    uploads += 1;
    return new Response(JSON.stringify({ ok: true, text: "Lei Liu, hello", model: "scribe_v1", usage: { characterCost: 3, fiatCostUsd: 0.0003 } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const text = await transcribeWithElevenLabs(new Blob([new Uint8Array(500)], { type: "audio/webm" }));
    assert.equal(text, "Lélu, hello");
    const e = ledger.recent(5).find((x) => x.source === "elevenlabs-stt");
    assert.equal(e?.results, 3);
    assert.equal(e?.costUsd, 0.0003);
    assert.equal(e?.costKind, "reported");
    ledger.setBudget("api", "elevenlabs-stt", { dailyCalls: 1 });
    await assert.rejects(transcribeWithElevenLabs(new Blob([new Uint8Array(500)], { type: "audio/webm" })), /daily calls budget reached/);
    assert.equal(uploads, 1, "the refused call never uploaded audio");
  } finally {
    globalThis.fetch = real;
    ledger.setBudget("api", "elevenlabs-stt", null);
  }
});
