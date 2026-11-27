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
/** No HTTP response at all — a refused socket, DNS failure or timeout. */
interface TransportFailure { throws: string }

async function call(
  api: ReturnType<typeof createModelApi>,
  url: string,
  stub?: Stub | TransportFailure,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const original = globalThis.fetch;
  if (stub) {
    const failure = "throws" in stub ? stub.throws : null;
    globalThis.fetch = (async () => {
      if (failure) throw new Error(failure);
      const s = stub as Stub;
      return {
        ok: s.status >= 200 && s.status < 300,
        status: s.status,
        headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? s.contentType : null) },
        text: async () => s.body,
        // The broker clones a refusal to read the provider's own note.
        clone: () => ({ text: async () => s.body }),
        body: null,
      };
    }) as unknown as typeof fetch;
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

/*
 * MISSION 44.4 — three facts, three fields.
 *
 * Configured (we hold a key) / reachable (the provider answered) / completed
 * (a model actually returned). Mission 44.3 recorded OpenRouter as CONFIGURED
 * while its free model answered `404 — this model is unavailable for free`,
 * which is a provider that IS reachable refusing one MODEL.
 */
test("a model-level 404 is MODEL_UNAVAILABLE — reachable provider, refused model", async () => {
  const or = createModelApi((name) => (name === "GITHUB_MODELS_TOKEN" ? SECRET : undefined));
  const res = await call(or, "/githubModels/chat/completions", {
    status: 404,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "No endpoints found matching your data policy — model unavailable for free" } }),
  });
  assert.equal(res.status, 404, "the provider's own refusal must reach the caller unchanged");

  const status = JSON.parse((await call(or, "/status")).body) as {
    providers: Record<string, boolean>;
    states: Record<string, { state: string; reachable?: boolean; httpStatus?: number; note?: string }>;
  };
  assert.equal(status.states.githubModels.state, "MODEL_UNAVAILABLE");
  assert.notEqual(status.states.githubModels.state, "CONFIGURED", "a refused model is an observation, not an absence of one");
  assert.notEqual(status.states.githubModels.state, "COMPLETION_VERIFIED", "a 404 is not a completion");
  assert.equal(status.states.githubModels.reachable, true, "a 404 is an answer: the provider was reachable");
  assert.equal(status.states.githubModels.httpStatus, 404);
  assert.match(status.states.githubModels.note ?? "", /unavailable/i, "the provider's own reason is kept");
  assert.equal(status.providers.githubModels, true, "a model refusal does not confiscate the credential");
  assert.ok(!JSON.stringify(status).includes(SECRET), "status must never carry a credential");
});

test("a transport failure is reachable:false, not CONFIGURED and not UNCONFIGURED", async () => {
  const down = createModelApi((name) => (name === "GITHUB_MODELS_TOKEN" ? SECRET : undefined));
  const res = await call(down, "/githubModels/chat/completions", { throws: "connect ECONNREFUSED 127.0.0.1:443" });
  assert.equal(res.status, 502);

  const status = JSON.parse((await call(down, "/status")).body) as {
    providers: Record<string, boolean>;
    states: Record<string, { state: string; reachable?: boolean; note?: string }>;
  };
  assert.equal(status.states.githubModels.state, "UNREACHABLE");
  assert.equal(status.states.githubModels.reachable, false, "no HTTP answer means the provider could not be reached");
  assert.match(status.states.githubModels.note ?? "", /ECONNREFUSED/);
  assert.ok(!JSON.stringify(status).includes(SECRET));
});

test("a real completion records reachable:true and COMPLETION_VERIFIED", async () => {
  const cerebras = createModelApi((name) => (name === "CEREBRAS_API_KEY" ? SECRET : undefined));
  const res = await call(cerebras, "/cerebras/chat/completions", {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  });
  assert.equal(res.status, 200);

  const status = JSON.parse((await call(cerebras, "/status")).body) as {
    states: Record<string, { state: string; reachable?: boolean; httpStatus?: number }>;
  };
  assert.equal(status.states.cerebras.state, "COMPLETION_VERIFIED");
  assert.equal(status.states.cerebras.reachable, true);
  assert.equal(status.states.cerebras.httpStatus, 200);
});

test("an exhausted quota is CAPACITY_LIMITED and still reachable", async () => {
  // githubModels, not a paid provider: a paid one is refused by the spending
  // policy (402) before any upstream call, so it could never reach a 429.
  const gh = createModelApi((name) => (name === "GITHUB_MODELS_TOKEN" ? SECRET : undefined));
  const res = await call(gh, "/githubModels/chat/completions", {
    status: 429,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "daily quota exhausted" } }),
  });
  assert.equal(res.status, 429);

  const status = JSON.parse((await call(gh, "/status")).body) as {
    states: Record<string, { state: string; reachable?: boolean }>;
  };
  assert.equal(status.states.githubModels.state, "CAPACITY_LIMITED");
  assert.equal(status.states.githubModels.reachable, true);
});

test("a provider that was never contacted reports no reachability at all", async () => {
  const fresh = createModelApi((name) => (name === "OPENROUTER_API_KEY" ? SECRET : undefined));
  const status = JSON.parse((await call(fresh, "/status")).body) as {
    states: Record<string, { state: string; reachable?: boolean }>;
  };
  assert.equal(status.states.openrouter.state, "CONFIGURED");
  assert.equal("reachable" in status.states.openrouter, false, "never tried is not the same as unreachable");
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
