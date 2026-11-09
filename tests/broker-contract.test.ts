/**
 * ==========================================================
 * LÉLU — BROKER COMPLETION CONTRACT & CAPABILITY TRUTHFULNESS
 *
 * CATEGORY: integration. The real broker plugin; only global fetch is stubbed,
 * so what is pinned is the CONTRACT between the broker and the app.
 *
 * Measured 2026-11-08: models.github.ai answered `200 text/plain "OK"` for
 * every path from this host — even with no credential — while the same egress
 * refused arXiv. The broker forwarded that as a successful completion. A 2xx
 * that is not a completion is not a success, and `CONFIGURED` is not a
 * capability claim.
 * ==========================================================
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createModelApi } from "../plugins/modelApi";

const SECRET = "test-secret-value-0123456789";

interface Stub { status: number; contentType: string; body: string }

async function call(
  api: ReturnType<typeof createModelApi>,
  url: string,
  stub?: Stub,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const original = globalThis.fetch;
  if (stub) {
    globalThis.fetch = (async () => ({
      ok: stub.status >= 200 && stub.status < 300,
      status: stub.status,
      headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? stub.contentType : null) },
      text: async () => stub.body,
      body: null,
    })) as unknown as typeof fetch;
  }

  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_path: string, fn: never) => { handler = fn as never; } });
  assert.ok(handler, "the broker did not register a handler");

  const req = {
    method: "POST",
    url,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    on: (event: string, fn: (chunk?: unknown) => void) => {
      if (event === "data") fn(Buffer.from("{}"));
      if (event === "end") fn();
    },
  };
  const captured = { status: 200, body: "", headers: {} as Record<string, string> };

  await new Promise<void>((resolve) => {
    const res = {
      set statusCode(value: number) { captured.status = value; },
      get statusCode() { return captured.status; },
      setHeader: (name: string, value: string) => { captured.headers[name.toLowerCase()] = value; },
      end: (body?: string) => { captured.body = body ?? ""; resolve(); },
    };
    (handler as never as (r: unknown, s: unknown, n: () => void) => void)(req, res, () => resolve());
  });

  if (stub) globalThis.fetch = original;
  return captured;
}

const keyed = createModelApi((name) => (name === "GROQ_API_KEY" || name === "GITHUB_MODELS_TOKEN" ? SECRET : undefined));
const keyless = createModelApi(() => undefined);

test("a 2xx that is not a completion is refused, not passed through", async () => {
  const res = await call(keyed, "/githubModels/chat/completions", {
    status: 200,
    contentType: "text/plain",
    body: "OK",
  });
  assert.equal(res.status, 502, "a non-completion 2xx must not read as success");
  const parsed = JSON.parse(res.body) as { ok: boolean; code: string };
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, "BROKER_CONTRACT_VIOLATION");
  assert.ok(!res.body.includes(SECRET), "the refusal must not carry the credential");

  const status = JSON.parse((await call(keyed, "/status")).body) as {
    states: Record<string, { state: string }>;
  };
  assert.equal(status.states.githubModels.state, "CONTRACT_VIOLATION");
});

test("an authenticated completion passes through and is recorded as verified", async () => {
  const res = await call(keyed, "/groq/chat/completions", {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "hello" } }] }),
  });
  assert.equal(res.status, 200);
  const status = JSON.parse((await call(keyed, "/status")).body) as {
    states: Record<string, { state: string }>;
  };
  assert.equal(status.states.groq.state, "COMPLETION_VERIFIED");
  assert.notEqual(status.states.groq.state, "TOOL_CALLING_VERIFIED", "text alone must not claim tool calling");
});

test("tool calling is claimed only from a real tool call", async () => {
  await call(keyed, "/groq/chat/completions", {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "1", function: { name: "environment_compose", arguments: "{}" } }] } }],
    }),
  });
  const status = JSON.parse((await call(keyed, "/status")).body) as {
    states: Record<string, { state: string }>;
  };
  assert.equal(status.states.groq.state, "TOOL_CALLING_VERIFIED");
});

test("a rejected credential is reported as such, and the provider falls out of the chain", async () => {
  const res = await call(keyed, "/groq/chat/completions", {
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({ error: "invalid api key" }),
  });
  assert.equal(res.status, 401, "the upstream refusal must reach the caller unchanged");
  const status = JSON.parse((await call(keyed, "/status")).body) as {
    providers: Record<string, boolean>;
    states: Record<string, { state: string }>;
  };
  assert.equal(status.states.groq.state, "COOLDOWN");
  assert.equal(status.providers.groq, false, "a known-rejected provider must not be offered");
  assert.ok(!JSON.stringify(status).includes(SECRET), "status must never carry a credential");
});

test("a quota refusal is reported as capacity-limited", async () => {
  await call(keyless, "/openrouter/chat/completions", { status: 429, contentType: "application/json", body: "{}" });
  const status = JSON.parse((await call(keyless, "/status")).body) as {
    states: Record<string, { state: string }>;
  };
  // No credential here, so UNCONFIGURED wins: configuration is the first fact.
  assert.equal(status.states.openrouter.state, "UNCONFIGURED");
});

test("configuration alone is never reported as capability", async () => {
  // A FRESH broker: this test is about the absence of evidence, so it must not
  // inherit the 401/429 recorded by the tests above.
  // githubModels, because the rejection set is module-scoped: the 401 above
  // takes groq out of EVERY instance, which is correct for one server and
  // wrong for a test about a provider that has never been refused.
  const fresh = createModelApi((name) => (name === "GITHUB_MODELS_TOKEN" ? SECRET : undefined));
  const status = JSON.parse((await call(fresh, "/status")).body) as {
    providers: Record<string, boolean>;
    states: Record<string, { state: string }>;
  };
  assert.equal(status.providers.githubModels, true, "a configured provider is still tried");
  assert.equal(status.states.githubModels.state, "CONFIGURED", "configured is the honest default, not a capability claim");
  for (const state of Object.values(status.states)) {
    assert.ok(
      !["COMPLETION_VERIFIED", "TOOL_CALLING_VERIFIED"].includes(state.state),
      "no verification may be claimed before a real completion",
    );
  }
  assert.equal(status.states.cerebras.state, "UNCONFIGURED");
});
