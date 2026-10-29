/**
 * ==========================================================
 * LÉLU — NO PROVIDER CREDENTIAL REACHES THE CLIENT
 *
 * CATEGORY: unit. Real relay handler, real key bridge, real workflow
 * files; no network (upstream fetch is replaced and inspected).
 *
 * Measured before these fixes:
 *   - Meshy (a PAID API) was called from the browser with
 *     VITE_MESHY_API_KEY; verify-bundle-secrets reported it "SHIPPED".
 *   - The runtime key bridge wrote NEWS_API_KEY, YOUTUBE_API_KEY and
 *     MESHY_API_KEY into the served HTML — at build time too, so into
 *     dist/index.html — the same names the knowledge relay reads on
 *     the server to keep them off the page.
 *   - .github/workflows/android-apk.yml passed ten provider keys
 *     (Groq, OpenRouter, Cerebras, Mistral, Fireworks, GitHub,
 *     Anthropic ×2, NewsAPI, YouTube) into the APK build.
 * The build-output proof is scripts/verify-bundle-secrets.ts.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { bridgeScriptBody, BRIDGED_KEYS } from "../plugins/runtimeKeyBridge";
import { createAiProxyApi } from "../plugins/aiProxyApi";

const code = (path: string) => readFileSync(path, "utf8");

/* ------------------------------ workflows ----------------------------- */

/** Configuration a build may receive: names, URLs — never a credential. */
const NON_SECRET = /(_MODEL|_BASE_URL|_URL)$/;

test("no workflow hands a provider credential to a build", () => {
  const dir = ".github/workflows";
  for (const file of readdirSync(dir).filter((name) => /\.ya?ml$/.test(name))) {
    const text = code(join(dir, file));
    for (const match of text.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/gm)) {
      const [, envName, secretName] = match;
      assert.ok(
        NON_SECRET.test(envName) && NON_SECRET.test(secretName),
        `${file}: ${envName} ← secrets.${secretName} would be compiled into a client build`,
      );
    }
    assert.ok(
      !/^\s*VITE_[A-Z0-9_]*(KEY|TOKEN|SECRET)\s*:/m.test(text),
      `${file}: a VITE_*KEY/TOKEN/SECRET in a workflow is inlined into the bundle`,
    );
  }
});

/* ----------------------------- key bridge ----------------------------- */

const SERVER_CREDENTIALS = [
  "NEWS_API_KEY", "NEWSAPI_KEY", "YOUTUBE_API_KEY", "MESHY_API_KEY",
  "GROQ_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "MISTRAL_API_KEY",
  "FIREWORKS_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GITHUB_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY", "LELU_ENGINEER_TOKEN",
];

test("the runtime key bridge never writes a relayed or brokered credential into the page", () => {
  const canary = (name: string) => `CANARY_${name}_NOTONPAGE`;
  const body = bridgeScriptBody((name) => (SERVER_CREDENTIALS.includes(name) ? canary(name) : undefined));
  for (const name of SERVER_CREDENTIALS) {
    assert.ok(!body.includes(canary(name)), `${name} must not be published as a __LELU_*__ global`);
  }
  const bridgedNames = BRIDGED_KEYS.flatMap((key) => [key.viteName, ...key.aliases]);
  for (const name of ["VITE_NEWS_API_KEY", "VITE_YOUTUBE_API_KEY", "VITE_MESHY_API_KEY"]) {
    assert.ok(!bridgedNames.includes(name), `${name} is relayed; it has no bridge entry`);
  }
});

/* --------------------------- browser config --------------------------- */

test("the browser env allowlist holds no relayed or brokered key", () => {
  const allowlist = code("src/core/env/publicEnv.ts");
  for (const name of [
    "VITE_GROQ_API_KEY", "VITE_OPENROUTER_API_KEY", "VITE_CEREBRAS_API_KEY", "VITE_MISTRAL_API_KEY",
    "VITE_FIREWORKS_API_KEY", "VITE_ANTHROPIC_API_KEY", "VITE_GITHUB_TOKEN",
    "VITE_NEWS_API_KEY", "VITE_YOUTUBE_API_KEY", "VITE_MESHY_API_KEY",
  ]) {
    assert.ok(!new RegExp(`${name}:\\s*import\\.meta\\.env`).test(allowlist), `${name} is not read into the browser`);
  }
  const avatar = code("src/core/avatar/Avatar3DReconstructor.ts");
  assert.ok(!/meshyApiKey|Authorization/.test(avatar), "the avatar reconstructor holds no Meshy key");
  assert.match(avatar, /knowledgeFetch\("meshy"/, "Meshy is reached through the relay");
  assert.ok(!/meshyApiKey/.test(code("src/core/Environment.ts")), "no browser getter for the Meshy key");
});

/* ------------------------------- relay -------------------------------- */

interface Sent { status: number; body: string }

function relay(
  env: Record<string, string>,
  request: { method: string; url: string; headers?: Record<string, string>; body?: string },
): Promise<Sent> {
  const routes = new Map<string, (req: unknown, res: unknown, next: () => void) => void>();
  createAiProxyApi((name) => env[name]).attach({ use: (path, handler) => routes.set(path, handler as never) });
  const path = request.url.split("?")[0];
  const handler = routes.get(path)!;
  return new Promise((resolve) => {
    const listeners: Record<string, (chunk?: unknown) => void> = {};
    const req = {
      method: request.method,
      url: request.url.slice(path.length) || "/",
      headers: { host: "localhost:5173", ...request.headers },
      on: (event: string, fn: (chunk?: unknown) => void) => { listeners[event] = fn; },
    };
    const chunks: string[] = [];
    const res = {
      statusCode: 200,
      setHeader: () => {},
      write: (chunk: Uint8Array | string) => { chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)); },
      end: (text?: string) => resolve({ status: res.statusCode, body: chunks.join("") + (text ?? "") }),
    };
    handler(req, res, () => resolve({ status: 404, body: "" }));
    if (request.body !== undefined) listeners.data?.(request.body);
    listeners.end?.();
  });
}

const MESHY_ENV = { MESHY_API_KEY: "meshy-test-key-not-real" };
const meshyUrl = (path: string) => `/api/knowledge/relay?provider=meshy&path=${encodeURIComponent(path)}`;

async function withUpstream<T>(run: (calls: Array<{ url: string; init: RequestInit }>) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify({ result: "task-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("the relay sends Meshy's key as a server-side Bearer header, never in the URL", async () => {
  await withUpstream(async (calls) => {
    const created = await relay(MESHY_ENV, {
      method: "POST",
      url: meshyUrl("/openapi/v1/image-to-3d"),
      headers: { origin: "http://localhost:5173" },
      body: JSON.stringify({ image_url: "data:image/png;base64,AAAA" }),
    });
    assert.equal(created.status, 200, created.body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.meshy.ai/openapi/v1/image-to-3d");
    assert.equal(calls[0].init.method, "POST");
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer meshy-test-key-not-real");
    assert.equal(calls[0].init.body, JSON.stringify({ image_url: "data:image/png;base64,AAAA" }));
    assert.ok(!created.body.includes("meshy-test-key-not-real"), "the key is never returned");

    const polled = await relay(MESHY_ENV, { method: "GET", url: meshyUrl("/openapi/v1/image-to-3d/task-1?key=stolen") });
    assert.equal(polled.status, 200);
    assert.equal(calls[1].url, "https://api.meshy.ai/openapi/v1/image-to-3d/task-1", "a caller-supplied key is dropped");
  });
});

test("the relay refuses what would spend the key for someone else", async () => {
  await withUpstream(async (calls) => {
    const crossSite = await relay(MESHY_ENV, {
      method: "POST",
      url: meshyUrl("/openapi/v1/image-to-3d"),
      headers: { origin: "https://evil.example" },
      body: "{}",
    });
    assert.equal(crossSite.status, 403, "a POST from another site is refused");

    const otherApi = await relay(MESHY_ENV, { method: "GET", url: meshyUrl("/openapi/v1/image-to-3d-other") });
    assert.equal(otherApi.status, 400, "a path outside the provider's own segment is refused");

    const getOnly = await relay({ YOUTUBE_API_KEY: "yt" }, { method: "POST", url: "/api/knowledge/relay?provider=youtube&path=%2Fyoutube%2Fv3%2Fsearch", body: "{}" });
    assert.equal(getOnly.status, 405, "POST is relayed only for a provider that needs it");

    const noKey = await relay({}, { method: "GET", url: meshyUrl("/openapi/v1/image-to-3d/task-1") });
    assert.equal(noKey.status, 503, "no server key → an honest refusal");

    assert.equal(calls.length, 0, "none of these reached the upstream");
  });
});

test("the provider report is booleans only", async () => {
  const report = await relay(MESHY_ENV, { method: "GET", url: "/api/knowledge/providers" });
  const json = JSON.parse(report.body) as { knowledge: Record<string, { configured: boolean }> };
  assert.deepEqual(json.knowledge.meshy, { configured: true });
  assert.ok(!report.body.includes("meshy-test-key-not-real"));
});
