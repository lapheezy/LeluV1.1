/**
 * ==========================================================
 * LÉLU — THE MODEL BROKER
 *
 * CATEGORY: integration. The real plugin, the real endpoint
 * resolution, the real routing decision. The one thing
 * substituted is global fetch, so the upstream request can be
 * inspected without spending a real call — and inspecting it
 * is the point: what matters is WHERE the request goes and
 * WHOSE credential is on it.
 *
 * Why this exists: the browser could not call a provider
 * directly (no CORS, no egress from a sandboxed page), which
 * is why real-model cognition was NOT VERIFIED in the
 * browser. The repository already solved this once, for
 * GitHub Models, with a same-origin proxy holding the token
 * server-side. This is that rule generalised — and these
 * tests pin the properties that make it safe.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createModelApi, BROKERED, brokerPath } from "../plugins/modelApi";
import { endpointUrl, endpoint } from "../src/core/Endpoints";

/* ------------------------------ harness ------------------------------ */

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Drive one request through the middleware the servers mount. */
async function call(
  api: ReturnType<typeof createModelApi>,
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ response: Captured; nextCalled: boolean }> {
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({
    use: (path, fn) => {
      assert.equal(path, "/api/model", "the broker mounted somewhere unexpected");
      handler = fn as never;
    },
  });
  assert.ok(handler, "the broker did not register a handler");

  const chunks = options.body ? [options.body] : [];
  const req = {
    method: options.method ?? "POST",
    url,
    headers: options.headers ?? {},
    on: (event: string, fn: (chunk?: unknown) => void) => {
      if (event === "data") for (const chunk of chunks) fn(Buffer.from(chunk));
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

  return { response, nextCalled };
}

const SECRET = "sk-test-do-not-leak-0123456789";

/* ------------------------------ routing ------------------------------ */

test("under Node a provider still calls the upstream directly", () => {
  // Nothing about the server-side path changes: the same URL as before.
  assert.equal(endpointUrl("anthropic", "messages"), `${endpoint("anthropic")}/messages`);
  assert.match(endpointUrl("anthropic", "messages"), /^https:\/\//);
});

test("with a document present the same call is routed to the same-origin broker", () => {
  const host = globalThis as { document?: unknown };
  const had = "document" in host;
  host.document = {};
  try {
    // Same provider, same call site, same fallback chain — only the
    // transport changes, and only where a page is making the request.
    assert.equal(endpointUrl("anthropic", "messages"), "/api/model/anthropic/messages");
    assert.equal(endpointUrl("groq", "chat/completions"), "/api/model/groq/chat/completions");
    // A provider that was never brokered is untouched.
    assert.match(endpointUrl("github", "repos"), /^https:\/\//);
  } finally {
    if (!had) delete host.document;
  }
});

test("the broker path helper and the routing agree", () => {
  for (const id of Object.keys(BROKERED)) {
    assert.equal(brokerPath(id, "/messages"), `/api/model/${id}/messages`);
  }
});

/* ------------------------------ status ------------------------------ */

test("status reports which providers have a credential, and never what it is", async () => {
  const api = createModelApi((name) => (name === "ANTHROPIC_API_KEY" ? SECRET : undefined));
  const { response } = await call(api, "/status", { method: "GET" });

  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body) as { providers: Record<string, boolean> };
  assert.equal(payload.providers.anthropic, true);
  assert.equal(payload.providers.groq, false);
  assert.equal(
    response.body.includes(SECRET),
    false,
    "the status route leaked the credential it was reporting on",
  );
});

/* ------------------------------ forwarding ------------------------------ */

test("a brokered call reaches the real upstream carrying the SERVER's credential", async () => {
  const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: Record<string, unknown>) => {
    seen.push({
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ""),
    });
    return {
      status: 200,
      headers: new Map([["content-type", "application/json"]]) as never,
      text: async () => JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
    };
  }) as never;

  try {
    const api = createModelApi((name) => (name === "ANTHROPIC_API_KEY" ? SECRET : undefined));
    const { response } = await call(api, "/anthropic/messages", {
      body: JSON.stringify({ model: "m", messages: [] }),
      // A page trying to supply its own credential must not be trusted.
      headers: { "x-api-key": "sk-from-the-browser", authorization: "Bearer sk-from-the-browser" },
    });

    assert.equal(seen.length, 1, "the request was not forwarded exactly once");
    assert.equal(seen[0].url, `${endpoint("anthropic")}/messages`, "forwarded to the wrong upstream");
    assert.equal(seen[0].headers["x-api-key"], SECRET, "the server's credential was not attached");
    assert.equal(seen[0].headers["anthropic-version"], "2023-06-01");
    // The browser is not a source of authority: whatever it sent is gone.
    assert.equal(
      JSON.stringify(seen[0].headers).includes("sk-from-the-browser"),
      false,
      "a credential supplied by the page was forwarded upstream",
    );
    assert.equal(seen[0].body, JSON.stringify({ model: "m", messages: [] }), "the body was altered");
    assert.equal(response.status, 200);
    assert.equal(response.body.includes(SECRET), false, "the response leaked the credential");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("an upstream error is returned as it happened, not softened", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    status: 401,
    headers: new Map([["content-type", "application/json"]]) as never,
    text: async () => JSON.stringify({ error: { message: "API key is invalid." } }),
  })) as never;

  try {
    const api = createModelApi(() => SECRET);
    const { response } = await call(api, "/anthropic/messages", { body: "{}" });
    // The caller has to be able to tell "your key is wrong" from
    // "the network is down"; a broker that hid that would cost hours.
    assert.equal(response.status, 401);
    assert.match(response.body, /API key is invalid/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("no credential is reported as a missing credential, not as a failed call", async () => {
  const api = createModelApi(() => undefined);
  const { response } = await call(api, "/anthropic/messages", { body: "{}" });

  assert.equal(response.status, 503);
  const payload = JSON.parse(response.body) as { error: string; expected: string[] };
  assert.match(payload.error, /No credential configured/);
  // It names what to set, so the fix is obvious.
  assert.ok(payload.expected.includes("ANTHROPIC_API_KEY"));
});

test("the broker is an allowlist, not an open proxy", async () => {
  const api = createModelApi(() => SECRET);
  const { response } = await call(api, "/not-a-provider/messages", { body: "{}" });

  assert.equal(response.status, 404);
  const payload = JSON.parse(response.body) as { providers: string[] };
  assert.ok(payload.providers.includes("anthropic"));
  assert.equal(response.body.includes(SECRET), false);
});

test("a request that is not a provider call is passed on rather than swallowed", async () => {
  const api = createModelApi(() => SECRET);
  const { nextCalled } = await call(api, "/", { method: "GET" });
  assert.equal(nextCalled, true);
});
