/**
 * ==========================================================
 * LÉLU — ONE SERVER-OWNED CREDENTIAL MECHANISM
 *
 * CATEGORY: integration. The real broker middleware and the
 * real routing decision; only global fetch is substituted, so
 * the upstream request can be inspected without spending a
 * call — and inspecting it is the point.
 *
 * Why this exists: there used to be TWO server-owned
 * credential mechanisms. The broker (/api/model/<provider>)
 * carried chat; a second relay (/api/ai/relay, /api/ai/relay-raw,
 * /api/ai/providers) carried audio and had its own allowlist,
 * status endpoint and provider-id spelling. Both were correct
 * and neither leaked a key, but two mechanisms for one
 * responsibility is two places to register the next provider
 * and one of them to forget — and the id vocabularies had
 * already drifted ("githubmodels" vs "githubModels").
 *
 * Audio needed its own path for exactly one reason: the broker
 * forwarded every body as application/json and decoded it as
 * utf8, which corrupts a multipart audio part while leaving the
 * envelope readable. So these tests pin the two properties that
 * let the second mechanism be deleted — the broker forwards
 * bytes unchanged, and it forwards the caller's content-type —
 * plus the guards the deleted relay had, which consolidation
 * must not have dropped.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createModelApi } from "../plugins/modelApi";

/* ------------------------------ harness ------------------------------ */

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

async function call(
  url: string,
  options: {
    method?: string;
    body?: Buffer | string;
    headers?: Record<string, string>;
    env?: Record<string, string>;
    upstream?: () => Response;
  } = {},
): Promise<{ response: Captured; nextCalled: boolean; calls: UpstreamCall[] }> {
  const env = options.env ?? { GROQ_API_KEY: SECRET };
  const api = createModelApi((key) => env[key]);

  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_path, fn) => { handler = fn as never; } });
  assert.ok(handler, "the broker did not register a handler");

  const calls: UpstreamCall[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    });
    return options.upstream
      ? options.upstream()
      : new Response(JSON.stringify({ text: "transcribed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  }) as typeof fetch;

  try {
    const payload = options.body;
    const req = {
      method: options.method ?? "POST",
      url,
      headers: options.headers ?? {},
      on: (event: string, fn: (chunk?: unknown) => void) => {
        if (event === "data" && payload !== undefined) fn(Buffer.from(payload as never));
        if (event === "end") fn();
      },
    };

    const response: Captured = { status: 200, headers: {}, body: "" };
    let nextCalled = false;
    await new Promise<void>((resolve) => {
      const res = {
        set statusCode(value: number) { response.status = value; },
        get statusCode() { return response.status; },
        setHeader: (name: string, value: string) => { response.headers[name.toLowerCase()] = value; },
        end: (body?: string) => { response.body = body ?? ""; resolve(); },
      };
      (handler as never as (r: unknown, s: unknown, n: () => void) => void)(req, res, () => {
        nextCalled = true;
        resolve();
      });
    });
    return { response, nextCalled, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const SECRET = "gsk-test-do-not-leak-0123456789";

/* --------------------- audio carried by the broker --------------------- */

test("a multipart body survives the broker byte for byte", async () => {
  // Audio bytes that are NOT valid utf8. A string round trip replaces them
  // with U+FFFD, which upstream reports as a malformed multipart part —
  // an encoding bug that looks like anything but one.
  const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0xff, 0xfe, 0x00, 0x42]);
  const body = Buffer.concat([
    Buffer.from("--bound\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n"),
    audio,
    Buffer.from("\r\n--bound--\r\n"),
  ]);

  const { calls } = await call("/groq/openai/v1/audio/transcriptions", {
    body,
    headers: { "content-type": "multipart/form-data; boundary=bound" },
  });

  assert.equal(calls.length, 1, "the request reached the upstream exactly once");
  const forwarded = calls[0].body as Buffer;
  assert.ok(Buffer.isBuffer(forwarded), "the body must be forwarded as bytes, not a string");
  assert.ok(
    forwarded.includes(audio),
    "the audio bytes were altered in transit — a utf8 round trip corrupts them",
  );
});

test("the caller's multipart content-type reaches the upstream with its boundary", async () => {
  const { calls } = await call("/groq/openai/v1/audio/transcriptions", {
    body: Buffer.from("--b--"),
    headers: { "content-type": "multipart/form-data; boundary=b" },
  });
  assert.equal(
    calls[0].headers["Content-Type"],
    "multipart/form-data; boundary=b",
    "replacing this with application/json is what forced audio onto a second relay",
  );
});

test("a chat request with no content-type still defaults to JSON", async () => {
  const { calls } = await call("/groq/openai/v1/chat/completions", {
    body: JSON.stringify({ model: "m" }),
  });
  assert.equal(calls[0].headers["Content-Type"], "application/json");
});

test("audio carries the SERVER's credential and the browser sends none", async () => {
  const { calls } = await call("/groq/openai/v1/audio/transcriptions", {
    body: Buffer.from("x"),
    headers: {
      "content-type": "multipart/form-data; boundary=b",
      // A page trying to assert its own authority must be ignored.
      authorization: "Bearer attacker-supplied",
    },
  });
  assert.equal(calls[0].headers.Authorization, `Bearer ${SECRET}`);
  assert.ok(
    !JSON.stringify(calls[0].headers).includes("attacker-supplied"),
    "a client-supplied credential must be dropped, never forwarded",
  );
});

/* ------------- guards the deleted relay had, kept on the broker ------------- */

test("a cross-origin page cannot drive the broker", async () => {
  const { response, calls } = await call("/groq/openai/v1/chat/completions", {
    body: "{}",
    headers: { origin: "https://evil.example", host: "localhost:5173" },
  });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0, "nothing may reach the upstream on a refused request");
  assert.ok(!response.body.includes(SECRET), "a refusal must not name the credential");
});

test("a same-origin page is allowed through", async () => {
  const { response } = await call("/groq/openai/v1/chat/completions", {
    body: "{}",
    headers: { origin: "http://localhost:5173", host: "localhost:5173" },
  });
  assert.equal(response.status, 200);
});

test("a caller with no origin header is allowed through", async () => {
  // A CLI or same-process caller; the deleted relay behaved this way too.
  const { response } = await call("/groq/openai/v1/chat/completions", { body: "{}" });
  assert.equal(response.status, 200);
});

test("the upstream path cannot be walked off the provider's own API", async () => {
  for (const path of [
    "/groq/../../etc/passwd",
    "/groq/openai/../../../admin",
    "/groq/%2e%2e%2fadmin",
  ]) {
    const { response, calls } = await call(path, { body: "{}" });
    assert.equal(response.status, 400, `${path} must be refused`);
    assert.equal(calls.length, 0, `${path} must not reach an upstream`);
  }
});

test("an oversized body is refused rather than forwarded with a credential", async () => {
  const api = readFileSync("plugins/modelApi.ts", "utf8");
  const match = api.match(/MAX_BODY_BYTES\s*=\s*([\d_]+)/);
  assert.ok(match, "the broker must cap the body it will forward");
  const limit = Number(match[1].replace(/_/g, ""));
  // Whisper accepts uploads up to 25 MB and shares this broker, so the cap
  // has to clear that while still being a cap.
  assert.ok(limit >= 25 * 1024 * 1024, `cap ${limit} would reject real audio`);
  assert.ok(limit <= 64 * 1024 * 1024, `cap ${limit} is not meaningfully a cap`);
});

test("the broker bounds how long it will wait on an upstream", () => {
  const api = readFileSync("plugins/modelApi.ts", "utf8");
  assert.match(api, /AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/);
});

/* ---------------------- the duplicate really is gone ---------------------- */

test("no second server-owned model credential mechanism remains", () => {
  const proxy = readFileSync("plugins/aiProxyApi.ts", "utf8");
  for (const route of ["/api/ai/relay", "/api/ai/relay-raw", "/api/ai/providers"]) {
    assert.ok(
      !proxy.includes(`middlewares.use("${route}"`),
      `${route} is a second mechanism for a responsibility the broker owns`,
    );
  }
  // The duplicate model allowlist is what drifted; it must not come back.
  assert.ok(
    !/const PROVIDERS\s*:/.test(proxy),
    "a second model-provider allowlist must not exist beside BROKERED",
  );
});

test("the client relay no longer carries model traffic", () => {
  const relay = readFileSync("src/providers/aiRelay.ts", "utf8");
  for (const gone of ["providerFetch", "providerFetchRaw", "relayAvailable", "relayStatus"]) {
    assert.ok(!relay.includes(`export async function ${gone}`), `${gone} must be gone`);
    assert.ok(!relay.includes(`export function ${gone}`), `${gone} must be gone`);
  }
  assert.ok(relay.includes("knowledgeFetch"), "the knowledge relay is a different registry and stays");
  // The drifted spelling that could never match the broker's id.
  assert.ok(!relay.includes("githubmodels"), "the stale lowercase provider id must not survive");
});

test("voice routes through the broker, not a relay of its own", () => {
  const transport = readFileSync("src/core/voice/transcriptionTransport.ts", "utf8");
  assert.ok(transport.includes("endpointUrl"), "must use the one routing decision");
  assert.ok(transport.includes("authHeaders"), "must use the one auth-header rule");
  // The header comment explains the history deliberately, so this checks for
  // a real call to the deleted relay rather than any mention of it.
  assert.ok(
    !/fetch\(\s*["'`][^"'`]*\/api\/ai\/relay/.test(transport),
    "must not call the deleted relay",
  );

  for (const file of ["src/core/voice/speechToText.ts", "src/core/voice/VoiceEngine.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !source.includes("providerFetchRaw"),
      `${file} must not use the deleted raw relay`,
    );
    assert.ok(
      !source.includes("https://api.groq.com"),
      `${file} must not hard-code the upstream; endpointUrl owns that`,
    );
  }
});
