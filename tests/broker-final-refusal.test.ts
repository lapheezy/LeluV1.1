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
