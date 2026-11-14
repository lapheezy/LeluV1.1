/**
 * The broker's credential-retry loop must hand the caller the REAL final
 * refusal. It used to cancel the upstream body before deciding it had
 * nothing left to try, so a 429 with no retry hint and no second key went
 * out as a 502 "Body is unusable: Body has already been read" (measured on
 * Groq tool turns) — a quota refusal disguised as a server fault.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createModelApi } from "../plugins/modelApi";

async function call(api: ReturnType<typeof createModelApi>, url: string) {
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_path, fn) => (handler = fn as never) });
  const out = { status: 200, body: "" };
  await new Promise<void>((resolve) => {
    const res = {
      set statusCode(v: number) { out.status = v; }, get statusCode() { return out.status; },
      setHeader: () => undefined, write: (c: unknown) => { out.body += String(c); return true; },
      end: (b?: unknown) => { if (b !== undefined) out.body += typeof b === "string" ? b : Buffer.from(b as Uint8Array).toString(); resolve(); },
      on: () => undefined, writableFinished: false, flushHeaders: () => undefined,
    };
    const body = JSON.stringify({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "hi" }] });
    const req = { method: "POST", url, headers: { "content-type": "application/json" },
      on: (e: string, fn: (c?: unknown) => void) => { if (e === "data") fn(Buffer.from(body)); if (e === "end") fn(); } };
    handler!(req, res, () => resolve());
  });
  return out;
}

test("a final 429 with no retry hint and no other key reaches the caller as a 429 with its reason", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: "Rate limit reached on tokens per day (TPD): Limit 200000, Used 199999" } }), {
      status: 429, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const api = createModelApi((n) => (n === "GROQ_API_KEY" ? "gsk_one_key" : undefined));
    const out = await call(api, "/groq/chat/completions");
    assert.equal(out.status, 429, `got ${out.status}: ${out.body}`);
    assert.match(out.body, /tokens per day/);
    assert.doesNotMatch(out.body, /Body is unusable/);
    assert.equal(calls, 1, "nothing to rotate to, no hint to wait for: one request");
  } finally {
    globalThis.fetch = real;
  }
});

test("a 429 on the first of two keys still rotates to the second", async () => {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const auth = String((init.headers as Record<string, string>).Authorization ?? "");
    seen.push(auth);
    return auth.endsWith("gsk_two")
      ? new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const api = createModelApi((n) => (n === "GROQ_API_KEY" ? "gsk_one" : n === "GROQ_API_KEY_2" ? "gsk_two" : undefined));
    const out = await call(api, "/groq/chat/completions");
    assert.equal(out.status, 200, out.body);
    assert.equal(seen.length, 2);
  } finally {
    globalThis.fetch = real;
  }
});

function fakeOpenRouter(afford: number | null, seen: number[]) {
  return (async (_u: unknown, init: RequestInit) => {
    const asked = Number(JSON.parse(String(init.body)).max_tokens);
    seen.push(asked);
    if (afford !== null && asked <= afford) {
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const message = afford === null
      ? "Insufficient credits. Add more using https://openrouter.ai/settings/credits"
      : `This request requires more credits, or fewer max_tokens. You requested up to ${asked} tokens, but can only afford ${afford}.`;
    return new Response(JSON.stringify({ error: { message, code: 402 } }), { status: 402, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

async function orCall(maxTokens: number) {
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  const api = createModelApi((n) => (n === "OPENROUTER_API_KEY" ? "sk-or-test" : undefined));
  api.attach({ use: (_p, fn) => (handler = fn as never) });
  const out = { status: 200, body: "" };
  await new Promise<void>((resolve) => {
    const res = { set statusCode(v: number) { out.status = v; }, get statusCode() { return out.status; }, setHeader: () => undefined,
      write: (c: unknown) => { out.body += String(c); return true; }, end: (b?: unknown) => { if (b !== undefined) out.body += typeof b === "string" ? b : Buffer.from(b as Uint8Array).toString(); resolve(); },
      on: () => undefined, writableFinished: false, flushHeaders: () => undefined };
    const body = JSON.stringify({ model: "openai/gpt-4o-mini", max_tokens: maxTokens, messages: [{ role: "user", content: "hi" }] });
    handler!({ method: "POST", url: "/openrouter/chat/completions", headers: { "content-type": "application/json" },
      on: (e: string, fn: (c?: unknown) => void) => { if (e === "data") fn(Buffer.from(body)); if (e === "end") fn(); } }, res, () => resolve());
  });
  return out;
}

test("a 402 naming an affordable amount is retried once, smaller, and served", async () => {
  const real = globalThis.fetch; const seen: number[] = [];
  globalThis.fetch = fakeOpenRouter(1709, seen);
  try {
    const out = await orCall(2048);
    assert.equal(out.status, 200, out.body);
    assert.deepEqual(seen, [2048, Math.floor(1709 * 0.95)], "one retry, never above what the account can afford");
  } finally { globalThis.fetch = real; }
});

test("a 402 that leaves too little to be useful, or names no amount, is passed through untouched", async () => {
  const real = globalThis.fetch;
  try {
    let seen: number[] = [];
    globalThis.fetch = fakeOpenRouter(120, seen);
    let out = await orCall(2048);
    assert.equal(out.status, 402); assert.deepEqual(seen, [2048]);
    seen = [];
    globalThis.fetch = fakeOpenRouter(null, seen);
    out = await orCall(2048);
    assert.equal(out.status, 402); assert.match(out.body, /Insufficient credits/); assert.deepEqual(seen, [2048]);
  } finally { globalThis.fetch = real; }
});

test("all four configured Groq keys are tried before the provider is refused", async () => {
  const real = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => {
    const auth = String((init.headers as Record<string, string>).Authorization ?? "");
    seen.push(auth.slice(-2));
    return auth.endsWith("k4")
      ? new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ error: { message: "tokens per day (TPD) spent" } }), { status: 429, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const env: Record<string, string> = { GROQ_API_KEY: "gsk_k1", GROQ_API_KEY_2: "gsk_k2", GROQ_API_KEY_3: "gsk_k3", GROQ_API_KEY_4: "gsk_k4" };
    const out = await call(createModelApi((n) => env[n]), "/groq/chat/completions");
    assert.equal(out.status, 200, out.body);
    assert.deepEqual(seen, ["k1", "k2", "k3", "k4"]);
  } finally {
    globalThis.fetch = real;
  }
});
