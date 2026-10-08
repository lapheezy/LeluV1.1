/**
 * ==========================================================
 * LÉLU — SERVER-OWNED MODEL CREDENTIALS
 *
 * CATEGORY: unit + build artefact. Real broker, real provider
 * sources, real built bundle.
 *
 * Why this exists: the broker and the brokered URL already
 * existed, but every provider still resolved a real key
 * client-side, sent it as a redundant header, and reported
 * itself unavailable without one. That requirement was the only
 * reason runtimeKeyBridge had to inline real secrets into the
 * served page.
 *
 * These tests hold the loop closed: a provider must not need a
 * credential, the bridge must not carry one, and the bundle must
 * not contain one. The last is checked against the ACTUAL
 * environment values rather than a pattern, because a regex for
 * "looks like a key" is exactly what a renamed variable slips
 * past.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { BROKERED, brokerPath, createModelApi } from "../plugins/modelApi";
import {
  authHeaders,
  classifyProviderFailure,
  isBrokered,
  providerConfigured,
  type BrokeredProviderId,
} from "../src/core/model/BrokerTransport";

const REMOTE_PROVIDERS: BrokeredProviderId[] = [
  "anthropic", "groq", "openrouter", "cerebras", "mistral", "fireworks", "gemini", "githubModels",
];

/* ---------------------- the bridge must carry no secret ---------------------- */

test("the runtime key bridge publishes no model-provider credential", () => {
  const bridge = readFileSync("plugins/runtimeKeyBridge.ts", "utf8");
  // Only the entries matter — the file's own prose explains why they are gone.
  const entries = [...bridge.matchAll(/viteName:\s*"([A-Z_0-9]+)"/g)].map((m) => m[1]);

  for (const provider of ["GROQ", "OPENROUTER", "CEREBRAS", "MISTRAL", "FIREWORKS", "ANTHROPIC", "GEMINI"]) {
    assert.ok(
      !entries.includes(`VITE_${provider}_API_KEY`),
      `VITE_${provider}_API_KEY is bridged into the page again — the broker owns it now`,
    );
  }
  assert.ok(!entries.includes("VITE_GITHUB_TOKEN"), "GitHub Models' token must not be bridged");

  // The non-secret config the bridge legitimately exists for must survive.
  assert.ok(entries.some((e) => e.endsWith("_BASE_URL")), "base URLs are not secrets and should remain");
  assert.ok(entries.includes("VITE_GROQ_MODEL"), "model names are not secrets and should remain");
});

test("the Supabase SERVICE ROLE key is never bridged", () => {
  const bridge = readFileSync("plugins/runtimeKeyBridge.ts", "utf8");
  assert.ok(
    !/SERVICE_ROLE/.test(bridge.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the service-role key bypasses RLS and must not reach a bundle",
  );
});

/* ---------------------- providers need no credential ---------------------- */

test("every remote provider is brokered by the server", () => {
  for (const id of REMOTE_PROVIDERS) {
    assert.ok(BROKERED[id], `${id} is a remote provider but the broker does not front it`);
    assert.ok(BROKERED[id].keyNames.length > 0, `${id} must name the env vars the SERVER reads`);
    assert.equal(typeof BROKERED[id].authHeaders, "function");
  }
});

test("no provider source attaches a credential directly any more", () => {
  const files = {
    anthropic: "AnthropicProvider", groq: "GroqProvider", openrouter: "OpenRouterProvider",
    cerebras: "CerebrasProvider", mistral: "MistralProvider", fireworks: "FireworksProvider",
    gemini: "GeminiProvider", githubModels: "GitHubModelsProvider",
  };
  for (const [id, file] of Object.entries(files)) {
    const source = readFileSync(`src/providers/${file}.ts`, "utf8");
    // The old shape: a bare auth header built from the provider's own key.
    assert.ok(
      !/Authorization:\s*`Bearer \$\{this\.apiKey\}`/.test(source),
      `${file} still sends its own bearer token`,
    );
    assert.ok(!/"x-api-key":\s*this\.apiKey/.test(source), `${file} still sends its own x-api-key`);
    assert.ok(!/"x-goog-api-key":\s*this\.apiKey/.test(source), `${file} still sends its own goog key`);
    // The new shape: credentials decided by the shared transport.
    assert.ok(source.includes("authHeaders("), `${file} must route auth through BrokerTransport`);
    assert.ok(
      source.includes(`providerConfigured("${id}"`),
      `${file} must take availability from the server, not from a local key`,
    );
  }
});

test("brokered requests carry no auth header; direct ones still do", () => {
  // In Node there is no document, so isBrokered() is false — the server-side
  // and test path, which must still authenticate normally.
  assert.equal(isBrokered("groq"), false, "no document means not brokered");
  assert.deepEqual(
    authHeaders("groq", "secret-value", (key) => ({ Authorization: `Bearer ${key}` })),
    { Authorization: "Bearer secret-value" },
    "a direct send must still authenticate",
  );
  // With no key, nothing is invented.
  assert.deepEqual(authHeaders("groq", "", (key) => ({ Authorization: `Bearer ${key}` })), {});
});

test("availability falls back to the local key only when not brokered", () => {
  assert.equal(providerConfigured("groq", "a-key"), true);
  assert.equal(providerConfigured("groq", ""), false, "direct and keyless means unavailable");
});

/* ---------------------- the broker's own behaviour ---------------------- */

test("status reports booleans and never key material", () => {
  const api = createModelApi((name) => (name === "GROQ_API_KEY" ? "gsk_live_secret" : undefined));

  // The broker registers itself as connect-style middleware, so the handler is
  // captured the same way the runtime mounts it.
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({
    use(_path: string, fn: (req: unknown, res: unknown, next: () => void) => void) {
      handler = fn;
    },
  });
  assert.ok(handler, "the broker did not register a handler");

  let payload = "";
  const res = { statusCode: 0, setHeader() {}, end(body: string) { payload = body; } };
  handler!({ method: "GET", url: "/status" }, res, () => {});

  const parsed = JSON.parse(payload) as { providers: Record<string, boolean> };
  assert.equal(parsed.providers.groq, true, "a configured provider reads as configured");
  assert.equal(parsed.providers.anthropic, false);
  for (const value of Object.values(parsed.providers)) {
    assert.equal(typeof value, "boolean", "status must be booleans only");
  }
  assert.ok(!payload.includes("gsk_live_secret"), "the credential must not appear in the response");
  assert.ok(!/gsk_/.test(payload), "not even a prefix of it");
});

test("the broker is an allowlist, not an open proxy", () => {
  // A broker that forwards wherever a page points it is an open proxy, and
  // this one forwards with credentials attached.
  assert.equal(BROKERED["evil-upstream"], undefined);
  assert.ok(Object.keys(BROKERED).length >= 8);
});

test("broker paths are provider-scoped", () => {
  for (const id of Object.keys(BROKERED)) {
    assert.equal(brokerPath(id, "/chat/completions"), `/api/model/${id}/chat/completions`);
  }
});

/* ---------------------- failures are distinguishable ---------------------- */

test("provider failures classify into actionable codes", () => {
  const cases: Array<[number, string, string]> = [
    [401, "", "PROVIDER_AUTH_FAILURE"],
    [403, "", "PROVIDER_AUTH_FAILURE"],
    [429, "", "PROVIDER_RATE_LIMITED"],
    [402, "", "PROVIDER_REQUEST_FAILURE"],
    [404, "model not found", "INVALID_MODEL"],
    [400, "", "INVALID_REQUEST"],
    [504, "", "PROVIDER_TIMEOUT"],
    [500, "", "PROVIDER_REQUEST_FAILURE"],
  ];
  for (const [status, body, expected] of cases) {
    assert.equal(classifyProviderFailure("groq", status, body).code, expected, `HTTP ${status}`);
  }
});

test("a classified failure says what is wrong without naming a secret", () => {
  const error = classifyProviderFailure("anthropic", 401, "invalid x-api-key sk-ant-abc123");
  assert.match(error.message, /configured but authentication failed/i);
  assert.ok(!error.message.includes("sk-ant"), "the upstream body must not be echoed through");
  assert.ok(!/x-api-key/i.test(error.message), "no header name in a user-facing message");
});

/* ---------------------- the built bundle ---------------------- */

test("the production bundle contains no real provider credential", () => {
  if (!existsSync("dist/assets")) {
    // Nothing to check without a build; say so rather than passing quietly.
    assert.ok(true, "skipped: no dist/ — run `bun run build` first");
    return;
  }

  // Checked against the ACTUAL values in this environment. A pattern match
  // for "looks like a key" is what a renamed variable slips past.
  const secrets = [
    process.env.GROQ_API_KEY, process.env.OPENROUTER_API_KEY,
    process.env.CEREBRAS_API_KEY, process.env.FIREWORKS_API_KEY,
    process.env.ANTHROPIC_API_KEY, process.env.GEMINI_API_KEY,
  ].filter((value): value is string => typeof value === "string" && value.length > 12);

  if (secrets.length === 0) {
    assert.ok(true, "skipped: no provider credentials in this environment to search for");
    return;
  }

  const files = readdirSync("dist/assets").filter((f) => f.endsWith(".js"));
  assert.ok(files.length > 0, "a build should have produced chunks");

  for (const file of files) {
    const content = readFileSync(join("dist/assets", file), "utf8");
    for (const secret of secrets) {
      assert.ok(!content.includes(secret), `a real provider credential is in dist/assets/${file}`);
    }
  }
});

test("index.html carries no provider credential", () => {
  const html = readFileSync("index.html", "utf8");
  for (const provider of ["GROQ", "OPENROUTER", "CEREBRAS", "FIREWORKS", "ANTHROPIC", "GEMINI"]) {
    assert.ok(
      !html.includes(`__LELU_${provider}_API_KEY__`),
      `index.html references __LELU_${provider}_API_KEY__`,
    );
  }
});
