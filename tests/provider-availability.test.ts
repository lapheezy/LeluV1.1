/**
 * ==========================================================
 * LÉLU — A REVOKED KEY IS NOT AN AVAILABLE PROVIDER
 *
 * CATEGORY: integration. The real broker middleware; only the
 * upstream fetch is substituted.
 *
 * Why this exists: measured on a live deployment, three of
 * the four configured provider keys were revoked. The broker
 * answered "configured" for all three, because it was asking
 * whether a key STRING was present — a different question
 * from whether the provider can be reached. So every turn
 * went through three providers that returned 401 before
 * reaching the one that worked, which from the outside reads
 * as LÉLU not responding.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createModelApi } from "../plugins/modelApi";

const SECRET = "revoked-key-value";

interface Captured { status: number; body: string }

/** Drive one request through the middleware the servers mount. */
async function call(
  api: ReturnType<typeof createModelApi>,
  url: string,
  upstream: () => Response,
): Promise<Captured> {
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_p, fn) => { handler = fn as never; } });
  assert.ok(handler);

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => upstream()) as typeof fetch;
  try {
    const req = {
      method: "POST",
      url,
      headers: {},
      on: (event: string, fn: (chunk?: unknown) => void) => {
        if (event === "data") fn(Buffer.from("{}"));
        if (event === "end") fn();
      },
    };
    const out: Captured = { status: 200, body: "" };
    await new Promise<void>((resolve) => {
      const res = {
        set statusCode(v: number) { out.status = v; },
        get statusCode() { return out.status; },
        setHeader: () => {},
        end: (body?: string) => { out.body = body ?? ""; resolve(); },
      };
      (handler as never as (r: unknown, s: unknown, n: () => void) => void)(req, res, () => resolve());
    });
    return out;
  } finally {
    globalThis.fetch = realFetch;
  }
}

function statusOf(api: ReturnType<typeof createModelApi>): Promise<Record<string, boolean>> {
  return call(api, "/status", () => new Response("{}")).then(
    (r) => (JSON.parse(r.body) as { providers: Record<string, boolean> }).providers,
  );
}

const ok = () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
const rejected = (status: number) =>
  () => new Response(JSON.stringify({ error: "Invalid API Key" }), { status });

test("a configured key reports available before anything is known", () => {
  const api = createModelApi((k) => (k === "GROQ_API_KEY" ? SECRET : undefined));
  return statusOf(api).then((providers) => {
    assert.equal(providers.groq, true, "nothing has failed yet, so it is worth trying");
  });
});

test("a 401 takes the provider out of the chain", async () => {
  const api = createModelApi((k) => (k === "GROQ_API_KEY" ? SECRET : undefined));
  assert.equal((await statusOf(api)).groq, true);
  await call(api, "/groq/chat/completions", rejected(401));
  assert.equal(
    (await statusOf(api)).groq,
    false,
    "a revoked key must stop being offered, or every turn pays for it again",
  );
});

test("a 403 counts the same as a 401", async () => {
  const api = createModelApi((k) => (k === "GROQ_API_KEY" ? SECRET : undefined));
  await call(api, "/groq/chat/completions", rejected(403));
  assert.equal((await statusOf(api)).groq, false);
});

test("a rotated key brings the provider back without a restart", async () => {
  const api = createModelApi((k) => (k === "GROQ_API_KEY" ? SECRET : undefined));
  await call(api, "/groq/chat/completions", rejected(401));
  assert.equal((await statusOf(api)).groq, false);
  await call(api, "/groq/chat/completions", ok);
  assert.equal(
    (await statusOf(api)).groq,
    true,
    "it self-heals from real traffic; an operator should not have to restart",
  );
});

test("an upstream error that is not about the credential does not disable it", async () => {
  // A 500, a timeout or a bad model name says nothing about the key, and
  // treating it as a revocation would disable a working provider.
  const api = createModelApi((k) => (k === "GROQ_API_KEY" ? SECRET : undefined));
  for (const status of [404, 429, 500, 503]) {
    await call(api, "/groq/chat/completions", rejected(status));
    assert.equal(
      (await statusOf(api)).groq,
      true,
      `HTTP ${status} is not a credential failure`,
    );
  }
});

test("one dead provider does not take down a healthy one", async () => {
  const api = createModelApi((k) =>
    k === "GROQ_API_KEY" || k === "FIREWORKS_API_KEY" ? SECRET : undefined,
  );
  await call(api, "/groq/chat/completions", rejected(401));
  const providers = await statusOf(api);
  assert.equal(providers.groq, false);
  assert.equal(providers.fireworks, true, "the chain must still reach what works");
});

test("status never carries key material", async () => {
  const api = createModelApi((k) => (k === "GROQ_API_KEY" ? SECRET : undefined));
  const raw = await call(api, "/status", () => new Response("{}"));
  assert.ok(!raw.body.includes(SECRET));
  assert.ok(!/length|prefix|chars/i.test(raw.body));
});
