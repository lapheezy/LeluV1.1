/**
 * ==========================================================
 * LÉLU — arXiv GOES THROUGH HER OWN SERVER, NOT A STRANGER'S PROXY
 *
 * CATEGORY: unit. No network: fetch is stubbed, the relay middleware is
 * driven directly, and the browser is faked with window/document globals.
 *
 * MEASURED (Mission 3.5, iPhone-sized browser): arXiv research failed.
 * export.arxiv.org sends no CORS header, so the browser could not read
 * it, and the fallback sent every query to a third-party public CORS
 * proxy (api.allorigins.win). arXiv now goes through
 * /api/knowledge/relay?provider=arxiv: keyless, path-scoped, signed-in
 * users only, paced to arXiv's one request every 3 s.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createAiProxyApi } from "../plugins/aiProxyApi";
import ArxivProvider from "../src/providers/ArxivProvider";
import { queryConnector } from "../src/core/data/PublicDataConnectors";

const ATOM = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.00001v1</id><published>2024-01-01T00:00:00Z</published><title>Relayed Paper</title><summary>An abstract.</summary><author><name>A. Author</name></author><link rel="alternate" href="http://arxiv.org/abs/2401.00001v1"/></entry></feed>`;

type Guard = { check: () => Promise<{ ok: true; userId: string; email: null; role: string } | { ok: false; status: number; reason: string }> };
const admitted: Guard = { check: async () => ({ ok: true, userId: "test-user", email: null, role: "user" }) };
const anonymous: Guard = { check: async () => ({ ok: false, status: 401, reason: "No Supabase access token was presented." }) };

async function relay(provider: string, path: string, guard: Guard = admitted, env: Record<string, string> = {}) {
  const calls: Array<{ url: string; headers: Record<string, string>; at: number }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: { ...(init?.headers as Record<string, string>) }, at: Date.now() });
    return new Response(ATOM, { status: 200, headers: { "content-type": "application/atom+xml" } });
  }) as typeof fetch;
  try {
    const handlers: Record<string, (req: unknown, res: unknown, next: () => void) => void> = {};
    createAiProxyApi((name) => env[name], { guard: guard as never }).attach({ use: (route, handler) => { handlers[route] = handler as never; } });
    const out = { status: 0, body: "", type: "" };
    await new Promise<void>((resolve) => {
      const res = {
        statusCode: 200,
        setHeader: (name: string, value: string) => { if (name.toLowerCase() === "content-type") out.type = value; },
        write: (chunk: Uint8Array | string) => { out.body += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk); },
        end: (body?: string) => { out.body += body ?? ""; out.status = res.statusCode; resolve(); },
      };
      handlers["/api/knowledge/relay"]({ method: "GET", url: `/?provider=${provider}&path=${encodeURIComponent(path)}`, headers: {}, on: () => undefined }, res, () => resolve());
    });
    return { ...out, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the server relays arXiv with no key, an Atom Accept header and the query unchanged", async () => {
  const result = await relay("arxiv", "/api/query?search_query=all:graphene&start=0&max_results=3", admitted, { NEWS_API_KEY: "CANARY_news" });
  assert.equal(result.status, 200, result.body);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].url, "https://export.arxiv.org/api/query?search_query=all:graphene&start=0&max_results=3");
  assert.match(result.calls[0].headers.Accept, /application\/atom\+xml/);
  assert.ok(!result.calls[0].headers.Authorization, "no credential of any kind goes to arXiv");
  assert.ok(!result.calls[0].url.includes("CANARY"), "no other provider's key leaks into the arXiv call");
  assert.match(result.body, /Relayed Paper/);
});

test("the arXiv relay is scoped to the query API and to signed-in users", async () => {
  for (const path of ["/api/queryX", "/api/query/../../abs/1", "/abs/2401.00001", "https://evil.example/api/query"]) {
    const result = await relay("arxiv", path);
    assert.equal(result.status, 400, `${path} must be refused`);
    assert.equal(result.calls.length, 0, `${path}: no upstream call`);
  }
  const anon = await relay("arxiv", "/api/query?search_query=all:x", anonymous);
  assert.equal(anon.status, 401);
  assert.equal(anon.calls.length, 0, "an anonymous caller cannot use the server as a proxy");
});

test("the capability report lists arXiv as available (booleans only)", async () => {
  const handlers: Record<string, (req: unknown, res: unknown, next: () => void) => void> = {};
  createAiProxyApi(() => undefined, { guard: admitted as never }).attach({ use: (route, handler) => { handlers[route] = handler as never; } });
  const body = await new Promise<string>((resolve) => {
    handlers["/api/knowledge/providers"]({ method: "GET", url: "/", headers: {}, on: () => undefined }, { setHeader() {}, write() {}, end: (b: string) => resolve(b) }, () => resolve(""));
  });
  assert.deepEqual(JSON.parse(body).knowledge.arxiv, { configured: true });
});

/** A browser for the length of one call: window/document exist, fetch is recorded. */
async function inBrowser<T>(run: () => Promise<T>): Promise<{ result: T; urls: string[] }> {
  const urls: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, document: g.document, fetch: globalThis.fetch };
  g.window = globalThis;
  g.document = { cookie: "" };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(ATOM, { status: 200, headers: { "content-type": "application/atom+xml" } });
  }) as typeof fetch;
  try {
    return { result: await run(), urls };
  } finally {
    g.window = saved.window;
    g.document = saved.document;
    globalThis.fetch = saved.fetch;
  }
}

test("in the browser, the arXiv provider calls only LÉLU's own relay", async () => {
  const { result, urls } = await inBrowser(() => new ArxivProvider().search("graphene"));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^\/api\/knowledge\/relay\?provider=arxiv&path=%2Fapi%2Fquery%3Fsearch_query%3Dall%3Agraphene/);
  assert.ok(!urls.some((u) => /arxiv\.org|allorigins/.test(u)), urls.join(" "));
  assert.equal(result[0]?.title, "Relayed Paper");
});

test("in the browser, the arxiv.search data connector calls only LÉLU's own relay", async () => {
  const { result, urls } = await inBrowser(() => queryConnector("arxiv.search", { query: "quantum dots", max: 2 }));
  assert.ok(urls.length >= 1);
  assert.ok(urls.every((u) => u.startsWith("/api/knowledge/relay?provider=arxiv&path=%2Fapi%2Fquery")), urls.join(" "));
  assert.ok(result.ok, JSON.stringify(result));
});
