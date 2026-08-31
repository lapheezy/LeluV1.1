/**
 * LÉLU AI CREDENTIAL RELAY — VERIFICATION
 *
 * The problem this proves fixed is measured, not assumed: building with
 * canary provider keys previously put them verbatim into 11 chunks of
 * dist/assets/ (see `scripts/verify-bundle-secrets.ts`, which fails the
 * build if that ever comes back).
 *
 * This script proves the replacement path actually works, end to end,
 * with BOTH halves real:
 *
 *   src/providers/GroqProvider.generate()      ← the real provider
 *     → src/providers/aiRelay.providerFetch()  ← the real client half
 *       → plugins/aiProxyApi.ts handler        ← the real server half
 *         → upstream                            ← the only stubbed part
 *
 * Only the network is stubbed. Nothing in between is faked, so a
 * regression in either half fails here.
 *
 * Run: bun run scripts/verify-ai-relay.ts
 */

import { createAiProxyApi } from "../plugins/aiProxyApi";

let failures = 0;
function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** The server's key. It must never appear in anything the client sees. */
const SERVER_KEY = "gsk_SERVER_ONLY_SECRET_a1b2c3d4";

/* ---------------------------------------------------------------- */
/* An in-process stand-in for the runtime that mounts the middleware. */
/* Connect-shaped req/res, so the REAL handler runs unmodified.       */
/* ---------------------------------------------------------------- */

type Handler = (req: any, res: any, next: () => void) => void;
const routes: Array<{ path: string; handler: Handler }> = [];

createAiProxyApi((key) => (key === "GROQ_API_KEY" ? SERVER_KEY : undefined)).attach({
  use(path: string, handler: Handler) {
    routes.push({ path, handler });
  },
});

interface ServedResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

function serve(url: string, init?: RequestInit): Promise<ServedResponse | null> {
  const path = new URL(url, "http://localhost").pathname;
  // Longest prefix first, the way a connect stack resolves overlapping mounts.
  const route = [...routes]
    .sort((a, b) => b.path.length - a.path.length)
    .find((entry) => path === entry.path || path.startsWith(`${entry.path}/`));
  if (!route) return Promise.resolve(null);

  return new Promise((resolve) => {
    const chunks: string[] = [];
    const handlers: Record<string, ((chunk?: unknown) => void)[]> = {};
    const req = {
      method: init?.method ?? "GET",
      url: path,
      headers: (init?.headers ?? {}) as Record<string, string>,
      on(event: string, handler: (chunk?: unknown) => void) {
        (handlers[event] ??= []).push(handler);
      },
    };
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) {
        this.headers[name] = value;
      },
      write(chunk: Uint8Array | string) {
        chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      },
      end(body?: string) {
        if (body !== undefined) chunks.push(body);
        resolve({ status: this.statusCode, headers: this.headers, body: chunks.join("") });
      },
    };

    route.handler(req, res, () => resolve({ status: 404, headers: {}, body: "" }));

    // Deliver the POST body the way Node streams it.
    if (init?.body !== undefined) {
      queueMicrotask(() => {
        for (const handler of handlers.data ?? []) {
          handler(new TextEncoder().encode(String(init.body)));
        }
        for (const handler of handlers.end ?? []) handler();
      });
    } else {
      queueMicrotask(() => {
        for (const handler of handlers.end ?? []) handler();
      });
    }
  });
}

/* ---------------------------------------------------------------- */
/* Upstream stub — records exactly what the relay sent it.           */
/* ---------------------------------------------------------------- */

interface UpstreamCall {
  url: string;
  authorization: string;
  headers: Record<string, string>;
  body: unknown;
}
const upstreamCalls: UpstreamCall[] = [];
let upstreamMode: "ok" | "error" | "stream" = "ok";

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);

  // Same-origin app routes go to the middleware under test.
  if (url.startsWith("/api/")) {
    const served = await serve(url, init);
    if (!served) throw new Error(`no route for ${url}`);
    return new Response(served.body, { status: served.status, headers: served.headers });
  }

  // Anything else is "the internet" — recorded, never really called.
  const headers = Object.fromEntries(
    Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
  );
  upstreamCalls.push({
    url,
    authorization: headers.authorization ?? "",
    headers,
    body: init?.body ? JSON.parse(String(init.body)) : null,
  });

  if (upstreamMode === "error") {
    return new Response(JSON.stringify({ error: { message: "simulated upstream outage" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
  if (upstreamMode === "stream") {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo."},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  return new Response(
    JSON.stringify({
      choices: [{ index: 0, message: { role: "assistant", content: "Relayed answer." }, finish_reason: "stop" }],
      usage: { total_tokens: 12 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

async function main(): Promise<void> {
  const { refreshRelayStatus, providerFetch } = await import("../src/providers/aiRelay");
  const { default: GroqProvider } = await import("../src/providers/GroqProvider");

  console.log("== The capability report exposes availability, never the credential ==");
  {
    const response = await fetch("/api/ai/providers");
    const raw = await response.text();
    const payload = JSON.parse(raw) as { ok: boolean; providers: Record<string, { configured: boolean }> };

    assert(payload.ok === true, "GET /api/ai/providers answers");
    assert(payload.providers.groq?.configured === true, "the provider holding a server key reports configured");
    assert(
      payload.providers.openrouter?.configured === false,
      "a provider with no server key reports unconfigured — honestly, not optimistically",
    );
    assert(!raw.includes(SERVER_KEY), "THE RESPONSE DOES NOT CONTAIN THE KEY");
    assert(
      !raw.includes("gsk_") && !/"[^"]*SECRET[^"]*"/i.test(raw),
      "nor any prefix or fragment of it",
      raw.slice(0, 200),
    );
    assert(
      !/length|chars|prefix/i.test(raw),
      "nor any length/prefix hint that would help narrow the key",
      raw.slice(0, 200),
    );
  }

  console.log("\n== The relay attaches the SERVER's credential, and only the server's ==");
  {
    upstreamCalls.length = 0;
    const response = await providerFetch("groq", "https://api.groq.com/openai/v1/chat/completions", {
      apiKey: "", // the production case: the browser holds nothing
      body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
    });
    const text = await response.text();

    assert(upstreamCalls.length === 1, "the request reached the upstream exactly once", `calls=${upstreamCalls.length}`);
    assert(
      upstreamCalls[0]?.url === "https://api.groq.com/openai/v1/chat/completions",
      "at the provider's real endpoint, unchanged",
      upstreamCalls[0]?.url,
    );
    assert(
      upstreamCalls[0]?.authorization === `Bearer ${SERVER_KEY}`,
      "carrying the server-side key the browser never had",
    );
    assert(
      (upstreamCalls[0]?.body as { model?: string })?.model === "test-model",
      "with the provider's own payload passed through untouched",
      JSON.stringify(upstreamCalls[0]?.body),
    );
    assert(response.status === 200 && text.includes("Relayed answer."), "and the upstream body returns verbatim");
  }

  console.log("\n== A client-supplied Authorization is DROPPED, never honoured ==");
  {
    upstreamCalls.length = 0;
    // The relay must not become a way to make the server forward an
    // attacker's own bearer token to a third-party API.
    await fetch("/api/ai/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "groq",
        path: "/openai/v1/chat/completions",
        headers: { Authorization: "Bearer ATTACKER_TOKEN", "X-Title": "Lélu" },
        body: { model: "m" },
      }),
    });
    assert(
      upstreamCalls[0]?.authorization === `Bearer ${SERVER_KEY}`,
      "the attacker's Authorization did not reach the upstream — the server's key replaced it",
      upstreamCalls[0]?.authorization,
    );
    assert(
      upstreamCalls[0]?.headers["x-title"] === "Lélu",
      "while an allowlisted non-secret header still passes through",
      JSON.stringify(upstreamCalls[0]?.headers),
    );
  }

  console.log("\n== It is not an open proxy ==");
  {
    upstreamCalls.length = 0;
    const unknown = await fetch("/api/ai/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "evil", path: "/v1/x", body: {} }),
    });
    assert(unknown.status === 400, "an unknown provider id is refused", `status=${unknown.status}`);

    const escaped = await fetch("/api/ai/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "groq", path: "/admin/keys", body: {} }),
    });
    assert(escaped.status === 400, "a path outside the provider's own prefix is refused", `status=${escaped.status}`);

    const traversal = await fetch("/api/ai/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "groq", path: "/openai/v1/../../admin", body: {} }),
    });
    assert(traversal.status === 400, "a traversal attempt is refused", `status=${traversal.status}`);

    const unconfigured = await fetch("/api/ai/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "mistral", path: "/v1/chat/completions", body: {} }),
    });
    const unconfiguredBody = await unconfigured.text();
    assert(
      unconfigured.status === 503,
      "a provider with no server credential fails honestly (503), it does not pretend",
      `status=${unconfigured.status}`,
    );
    assert(!unconfiguredBody.includes(SERVER_KEY), "and that error leaks nothing");

    const crossOrigin = await fetch("/api/ai/relay", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://evil.example", host: "localhost:5173" },
      body: JSON.stringify({ provider: "groq", path: "/openai/v1/chat/completions", body: {} }),
    });
    assert(crossOrigin.status === 403, "a cross-origin POST is rejected (CSRF)", `status=${crossOrigin.status}`);
    assert(upstreamCalls.length === 0, "none of those refusals reached any upstream", `calls=${upstreamCalls.length}`);
  }

  console.log("\n== THE REAL GroqProvider works with NO key in the browser at all ==");
  {
    refreshRelayStatus();
    upstreamMode = "ok";
    upstreamCalls.length = 0;
    const provider = new GroqProvider();
    await provider.initialize();

    assert(
      await provider.isAvailable(),
      "the provider reports itself AVAILABLE on the strength of the server credential alone",
    );
    const health = await provider.health();
    assert(health.available === true && !health.lastError, "and its health check agrees", JSON.stringify(health));

    const response = await provider.generate({
      messages: [{ role: "user", content: "hello" }],
      prompt: "hello",
      timestamp: Date.now(),
    });
    assert(response.text === "Relayed answer.", "generate() returns the real upstream answer", response.text);
    assert(response.provider === "Groq", "attributed to the real provider, so the router is unchanged");
    assert(
      upstreamCalls[0]?.authorization === `Bearer ${SERVER_KEY}`,
      "and the credential came from the server, not the bundle",
    );
  }

  console.log("\n== An upstream failure still reads as a failure (so fallback still engages) ==");
  {
    upstreamMode = "error";
    upstreamCalls.length = 0;
    const provider = new GroqProvider();
    await provider.initialize();
    let thrown: Error | null = null;
    try {
      await provider.generate({ messages: [], prompt: "hello", timestamp: Date.now() });
    } catch (error) {
      thrown = error as Error;
    }
    assert(thrown !== null, "a 500 from the upstream still throws through the relay");
    assert(
      Boolean(thrown?.message.includes("500")),
      "carrying the real upstream status, which is what drives ProviderResolver's failover",
      thrown?.message,
    );
    assert(!String(thrown?.message).includes(SERVER_KEY), "and the error message leaks nothing");
  }

  console.log("\n== Token streaming survives the relay (it is not buffered into one blob) ==");
  {
    upstreamMode = "stream";
    upstreamCalls.length = 0;
    const provider = new GroqProvider();
    await provider.initialize();
    const deltas: string[] = [];
    const response = await provider.generate({
      messages: [],
      prompt: "hello",
      timestamp: Date.now(),
      onDelta: (accumulated) => deltas.push(accumulated),
    });
    assert(deltas.length >= 2, `the stream arrived progressively (${deltas.length} deltas)`, JSON.stringify(deltas));
    assert(response.text === "Hello.", "and reassembled into the right answer", response.text);
    assert(response.metadata?.streamed === true, "flagged as genuinely streamed");
  }

  globalThis.fetch = realFetch;
  console.log(`\n${failures === 0 ? "ALL AI RELAY CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
