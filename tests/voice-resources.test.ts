/**
 * Mission 5.8 — voice resource intelligence.
 *
 * Offline: ElevenLabs is replaced by a stub fetch, exactly as in
 * tests/voice-elevenlabs.test.ts. Live evidence lives in
 * docs/voice/evidence/2026-11-10-voice-resource-intelligence/.
 *
 * What these tests pin:
 *   · an estimate exists before a request and is what a plan allows;
 *   · reported characters are authoritative, an absent report is an estimate,
 *     and the drift between them is visible;
 *   · a refusal cools one account for one modality and expires by itself;
 *   · a spent allowance is detected, skipped, and not retried per request;
 *   · an account too short for THIS sentence is skipped, not sent a doomed call;
 *   · a lagging upstream counter never lowers the internal lower bound;
 *   · replenishment restarts the ledger while history keeps the spend;
 *   · TTS and STT are independent end to end;
 *   · the status endpoint never leaks a key or an environment name.
 */
import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { createVoiceApi } from "../plugins/voiceApi";
import VoiceResourceManager, { isAnotherAccountWorthTrying } from "../src/core/voice/VoiceResourceManager";
import { DEFAULT_VOICE_IDENTITY, resolveVoiceIdentity } from "../src/core/voice/voiceIdentity";

async function serve(readEnv: (k: string) => string | undefined) {
  const api = createVoiceApi(readEnv);
  const routes: Array<[string, (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void]> = [];
  api.attach({ use: (p, h) => routes.push([p, h as never]) });
  // Connect matches by prefix; the test server must prefer the longest one or
  // /api/voice/resources would swallow /api/voice/resources/reconcile.
  routes.sort((a, b) => b[0].length - a[0].length);
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
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

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
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

const audio = () =>
  new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), {
    headers: { "content-type": "audio/mpeg", "character-cost": "7" },
  });
const refused = (status = 401) =>
  new Response(JSON.stringify({ detail: { status: "quota_exceeded" } }), {
    status,
    headers: { "content-type": "application/json" },
  });

const speak = (base: string, text: string) =>
  fetch(`${base}/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

/* ============================ accounting ============================ */

test("a request is estimated before it is sent, and the estimate is what a plan spends", () => {
  const manager = new VoiceResourceManager({ now: () => 0 });
  manager.sync(["account-1"]);

  const plan = manager.plan("tts", { text: "hello there" });
  assert.equal(plan.estimate, 11, "eleven characters, counted before the call");
  assert.match(plan.estimateBasis, /code points/);
  assert.deepEqual(plan.candidates, ["account-1"]);
  assert.equal(plan.available, true);
  assert.equal(plan.remainingCharacters, 10_000);
  assert.equal(manager.plan("stt", { audioBytes: 4_000 }).estimate, null, "no character estimate is invented for transcription");
});

test("reported characters are authoritative, an unreported call stays an estimate, and the drift is visible", () => {
  const manager = new VoiceResourceManager({ now: () => 0 });
  manager.sync(["account-1"]);
  manager.recordSuccess("tts", "account-1", { estimatedCharacters: 10, reportedCharacters: 12, latencyMs: 40 });
  manager.recordSuccess("tts", "account-1", { estimatedCharacters: 8, reportedCharacters: null, latencyMs: 40 });

  const snapshot = manager.snapshot();
  const credential = snapshot.credentials[0];
  assert.equal(credential.tts.reportedCharacters, 12, "the provider's number is what counts");
  assert.equal(credential.tts.estimatedCharacters, 18, "both calls were estimated before they were sent");
  assert.equal(credential.tts.estimatedForReported, 10, "the estimate the provider then answered");
  assert.equal(credential.tts.unreportedEstimates, 8, "an absent report is charged as an estimate, never a free call");
  assert.equal(credential.usedCharacters, 20);
  assert.equal(credential.remainingCharacters, 9_980);
  // Drift compares comparable pairs only: 12 reported against the 10 estimated
  // for that same call. The unreported call is charged as an estimate instead.
  assert.equal(snapshot.totals.estimateDriftCharacters, 2);
  assert.equal(credential.tts.calls, 2);
  assert.equal(snapshot.activeCredential.tts, "account-1");
  assert.equal(snapshot.lastSuccess?.label, "account-1");
  assert.equal(snapshot.history.length, 2);
  assert.equal(snapshot.history[0].estimatedCharacters, 8, "history is newest first");
});

/* ============================ cooldowns ============================ */

test("a refusal cools that account for that modality only, and the cooldown expires on its own", () => {
  let now = 0;
  const manager = new VoiceResourceManager({ now: () => now, cooldownMs: 60_000 });
  manager.sync(["account-1", "account-2"]);

  manager.recordFailure("tts", "account-1", { status: 429, reason: "ElevenLabs HTTP 429", latencyMs: 30 });

  const tts = manager.plan("tts", { text: "hi" });
  assert.deepEqual(tts.candidates, ["account-2"], "the rate-limited account is not offered");
  assert.deepEqual(tts.skipped.map((s) => s.reason), ["cooling"]);
  assert.ok((tts.skipped[0].retryAfterMs ?? 0) > 0, "the caller is told how long to wait");
  assert.equal(manager.snapshot().credentials[0].health, "cooling");

  assert.deepEqual(
    manager.plan("stt", { audioBytes: 4_000 }).candidates,
    ["account-1", "account-2"],
    "a synthesis rate limit does not close her ears",
  );

  now = 60_001;
  assert.deepEqual(manager.plan("tts", { text: "hi" }).candidates, ["account-1", "account-2"], "the cooldown expires by itself");
});

test("only a refusal another account could fix is worth another account", () => {
  for (const status of [401, 403, 429]) assert.equal(isAnotherAccountWorthTrying(status), true, String(status));
  for (const status of [0, 400, 413, 422, 500]) assert.equal(isAnotherAccountWorthTrying(status), false, String(status));
});

/* ============================ exhaustion ============================ */

test("a spent allowance is detected, skipped, and re-probed once per window instead of every request", () => {
  let now = 0;
  const manager = new VoiceResourceManager({
    now: () => now,
    monthlyCharacterLimit: 100,
    cooldownMs: 1_000,
    exhaustedProbeMs: 60_000,
  });
  manager.sync(["account-1"]);
  manager.recordSuccess("tts", "account-1", { estimatedCharacters: 100, reportedCharacters: 120, latencyMs: 10 });

  const spent = manager.plan("tts", { text: "hello" });
  assert.equal(spent.available, false);
  assert.equal(spent.unavailableReason, "all_credentials_exhausted");
  assert.deepEqual(spent.candidates, []);
  assert.equal(manager.snapshot().credentials[0].health, "exhausted");
  assert.equal(manager.snapshot().availability.tts, false);

  now = 60_001;
  assert.equal(manager.plan("tts", { text: "hello" }).available, true, "one probe is allowed after the window");
});

test("an account too short for THIS sentence is skipped rather than sent a doomed call", () => {
  const manager = new VoiceResourceManager({ now: () => 0, monthlyCharacterLimit: 100 });
  manager.sync(["account-1", "account-2"]);
  manager.recordSuccess("tts", "account-1", { estimatedCharacters: 96, reportedCharacters: 96, latencyMs: 5 });

  const plan = manager.plan("tts", { text: "ten chars!" });
  assert.deepEqual(plan.candidates, ["account-2"]);
  assert.equal(plan.skipped[0].reason, "insufficient_allowance");
  assert.equal(manager.snapshot().credentials[0].health, "ready", "short for this request is not exhausted");
});

test("a provider refusal outranks the ledger, and an allowance report clears it", () => {
  const manager = new VoiceResourceManager({ now: () => 0, monthlyCharacterLimit: 100 });
  manager.sync(["account-1"]);
  // The real shape of the failure this mission started from: the local ledger
  // says 0 characters, the provider says the month is spent.
  manager.recordFailure("tts", "account-1", { status: 401, reason: "ElevenLabs HTTP 401", latencyMs: 4 });
  assert.equal(manager.snapshot().credentials[0].health, "exhausted");

  const applied = manager.applyUpstreamUsage("account-1", { characterCount: 0, characterLimit: 10_000 });
  assert.equal(applied?.lagging, false);
  assert.equal(manager.snapshot().credentials[0].health, "ready", "authoritative allowance clears the refusal and its cooldown");
});

/* ============================ reconciliation ============================ */

test("an upstream counter that lags never lowers the internal lower bound", () => {
  const manager = new VoiceResourceManager({ now: () => 0, monthlyCharacterLimit: 10_000 });
  manager.sync(["account-1"]);
  for (let i = 0; i < 4; i += 1) {
    manager.recordSuccess("tts", "account-1", { estimatedCharacters: 10, reportedCharacters: 10, latencyMs: 5 });
  }

  const applied = manager.applyUpstreamUsage("account-1", { characterCount: 12, characterLimit: 10_000 });
  assert.equal(applied?.internalUsed, 40);
  assert.equal(applied?.upstreamUsed, 12);
  assert.equal(applied?.lagging, true);

  const credential = manager.snapshot().credentials[0];
  assert.equal(credential.usedCharacters, 40, "a lagging number does not erase 28 characters of real spend");
  assert.equal(credential.upstream?.lagging, true, "the lag is reported, not hidden");
});

test("replenishment restarts the ledger and the history keeps what was spent", () => {
  const manager = new VoiceResourceManager({ now: () => 0, monthlyCharacterLimit: 100 });
  manager.sync(["account-1"]);
  manager.recordSuccess("tts", "account-1", { estimatedCharacters: 100, reportedCharacters: 120, latencyMs: 5 });
  assert.equal(manager.snapshot().availability.tts, false);

  assert.deepEqual(manager.replenish(), ["account-1"]);
  const snapshot = manager.snapshot();
  assert.equal(snapshot.availability.tts, true);
  assert.equal(snapshot.credentials[0].remainingCharacters, 100);
  assert.equal(snapshot.history.length, 1, "the spend is still in the history");
});

/* ============================ identity ============================ */

test("her voice identity does not depend on which account is configured or spent", () => {
  const withKeys = resolveVoiceIdentity((name) =>
    name === "ELEVENLABS_API_KEY_2" ? "xi-second" : name === "Elevenlabs" ? "xi-first" : undefined,
  );
  assert.deepEqual(withKeys, DEFAULT_VOICE_IDENTITY, "credentials cannot change who is speaking");

  const overridden = resolveVoiceIdentity((name) => (name === "ELEVENLABS_VOICE_ID" ? "custom-voice" : undefined));
  assert.equal(overridden.voiceId, "custom-voice", "an explicit operator choice still works");
  assert.equal(overridden.speakingStyle.stability, DEFAULT_VOICE_IDENTITY.speakingStyle.stability);
});

/* ============================ routes ============================ */

test("TTS refuses before calling upstream when no account has allowance for the sentence", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  let upstreamCalls = 0;
  const stub = stubElevenLabs(() => {
    upstreamCalls += 1;
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "audio/mpeg", "character-cost": "9995" },
    });
  });
  const sentence = "x".repeat(900);
  try {
    const first = await speak(s.base, sentence);
    assert.equal(first.status, 200);
    assert.equal(upstreamCalls, 1);
    assert.equal(first.headers.get("x-lelu-voice"), "account-1");

    const second = await speak(s.base, sentence);
    assert.equal(second.status, 503);
    const body = await second.json();
    assert.equal(body.reason, "insufficient_allowance");
    assert.ok(second.headers.get("retry-after"), "the caller is told when to come back");
    assert.equal(upstreamCalls, 1, "a spent account is not asked again for a sentence it cannot pay for");
  } finally {
    stub.restore();
    s.close();
  }
});

test("TTS and STT stay independent end to end: a spent mouth does not deafen her", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  const stub = stubElevenLabs((url) => {
    if (url.endsWith("/speech-to-text")) {
      return new Response(JSON.stringify({ text: "hello", language_code: "eng" }), {
        headers: { "content-type": "application/json", "character-cost": "3" },
      });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "audio/mpeg", "character-cost": "10000" },
    });
  });
  try {
    assert.equal((await speak(s.base, "a".repeat(50))).status, 200);
    assert.equal((await speak(s.base, "b".repeat(50))).status, 503, "her synthesis allowance is spent");

    const stt = await fetch(`${s.base}/api/voice/stt?lang=en`, {
      method: "POST",
      headers: { "Content-Type": "audio/webm" },
      body: new Uint8Array(4_000),
    });
    assert.equal(stt.status, 200, "transcription still works");
    assert.equal((await stt.json()).text, "hello");
  } finally {
    stub.restore();
    s.close();
  }
});

test("the resources endpoint is sanitized and reports allowance, rotation, failures and history", async () => {
  const s = await serve((k) =>
    k === "Elevenlabs" ? "xi-test-key-first" : k === "Elevenlabs2" ? "xi-test-key-second" : undefined,
  );
  const stub = stubElevenLabs((_url, init) =>
    new Headers(init.headers).get("xi-api-key") === "xi-test-key-first" ? refused(401) : audio(),
  );
  try {
    const spoken = await speak(s.base, "hello");
    assert.equal(spoken.status, 200);
    assert.equal(spoken.headers.get("x-lelu-voice"), "account-2", "rotation is visible without exposing the key");

    const response = await fetch(`${s.base}/api/voice/resources`);
    assert.equal(response.status, 200);
    const text = await response.text();
    const body = JSON.parse(text) as Record<string, never>;

    assert.equal(body.ok, true);
    assert.equal((body.identity as { voiceId: string }).voiceId, DEFAULT_VOICE_IDENTITY.voiceId);
    assert.equal((body.availability as { tts: boolean }).tts, true);
    assert.equal((body.activeCredential as { tts: string }).tts, "account-2");
    const credentials = body.credentials as Array<{ label: string; health: string; tts: { reportedCharacters: number } }>;
    assert.equal(credentials.length, 2);
    assert.equal(credentials[0].label, "account-1");
    assert.equal(credentials[0].health, "exhausted");
    assert.equal(credentials[1].tts.reportedCharacters, 7);
    assert.equal((body.lastFailure as { status: number }).status, 401);
    assert.equal((body.history as unknown[]).length, 2);

    // Nothing secret, and not even the name of the environment variable.
    assert.doesNotMatch(text, /xi-test-key/);
    assert.doesNotMatch(text, /ELEVENLABS_API_KEY/);
    assert.doesNotMatch(text, /Elevenlabs2/);
  } finally {
    stub.restore();
    s.close();
  }
});

test("the panel's first poll already knows which accounts exist, before anything has spoken", async () => {
  // The dashboard polls /api/voice/resources before it does anything else. A
  // fresh process therefore has to discover its accounts on that call alone,
  // not as a side effect of a status probe or a synthesis.
  const s = await serve((k) =>
    k === "ELEVENLABS_API_KEY" ? "xi-key-one" : k === "ELEVENLABS_API_KEY_2" ? "xi-key-two" : k === "Elevenlabs3" ? "xi-key-three" : undefined,
  );
  try {
    const response = await fetch(`${s.base}/api/voice/resources`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      availability: { tts: boolean; stt: boolean };
      credentials: Array<{ label: string; health: string }>;
      totals: { remainingCharacters: number };
    };
    assert.deepEqual(
      body.credentials.map((credential) => credential.label),
      ["account-1", "account-2", "account-3"],
      "configured accounts are reported without a prior call",
    );
    assert.equal(body.availability.tts, true, "a page load must not claim her voice is blocked");
    assert.equal(body.availability.stt, true);
    assert.equal(body.totals.remainingCharacters, 30_000);
  } finally {
    s.close();
  }
});

test("replenish and reconcile let a spent account speak again", async () => {
  const s = await serve((k) => (k === "Elevenlabs" ? "xi-test-key" : undefined));
  let refuse = true;
  const stub = stubElevenLabs((url) => {
    if (url.endsWith("/user/subscription")) {
      return new Response(JSON.stringify({ character_count: 0, character_limit: 10_000 }), {
        headers: { "content-type": "application/json" },
      });
    }
    return refuse ? refused(401) : audio();
  });
  try {
    // The first attempt is a real request, so it fails as the provider failed it.
    assert.equal((await speak(s.base, "hello")).status, 502);
    // Now the refusal is known, so the next attempt costs nothing upstream.
    assert.equal((await speak(s.base, "hello")).status, 503);

    const replenished = await fetch(`${s.base}/api/voice/resources/replenish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(replenished.status, 200);
    assert.deepEqual((await replenished.json()).replenished, ["account-1"]);

    refuse = false;
    assert.equal((await speak(s.base, "hello")).status, 200, "the account speaks once the operator says it has allowance");

    const reconciled = await fetch(`${s.base}/api/voice/resources/reconcile`, { method: "POST" });
    assert.equal(reconciled.status, 200);
    const body = await reconciled.json();
    assert.equal(body.accounts[0].ok, true);
    assert.equal(body.accounts[0].upstreamUsed, 0);
    assert.equal(body.accounts[0].upstreamLimit, 10_000);
  } finally {
    stub.restore();
    s.close();
  }
});
