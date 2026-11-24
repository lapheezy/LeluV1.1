/**
 * ==========================================================
 * LÉLU — ONE PROVIDER CREDENTIAL CONTRACT
 *
 * CATEGORY: integration. The real broker middleware, the real
 * env/health middleware, the real key ring, Environment,
 * ConfigStatus and the real provider classes from the real
 * registry. Only `fetch` is substituted, so no request leaves
 * the machine and no real key is needed or read.
 *
 * What it pins down (src/core/model/ProviderCredentials.ts):
 *   - every accepted name for every authorised provider is seen
 *     identically by the broker, the key ring, Environment,
 *     ConfigStatus and /api/env-check;
 *   - an unusable value (placeholder, another provider's key)
 *     is INVALID everywhere and is never sent;
 *   - one provider's credential never stands in for another's;
 *   - each provider's request reaches its own upstream with its
 *     own credential;
 *   - voice asks the same contract;
 *   - Anthropic is never contacted while the policy is off.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
}
// Node runtimes shim `window` for storage only — no `location`. That is the
// shape that used to break OpenRouter, so it is the shape used here.
(globalThis as Record<string, unknown>).window ??= { localStorage: new FakeStorage(), sessionStorage: new FakeStorage(), name: "" };

import {
  AUTHORIZED_CHAT_PROVIDERS,
  CREDENTIAL_SPECS,
  credentialReport,
  resolveProviderCredentials,
  type CredentialProviderId,
} from "../src/core/model/ProviderCredentials";
import ProviderKeyRing from "../src/core/model/ProviderKeyRing";
import { reloadEnvironment } from "../src/core/Environment";
import { configCapabilities } from "../src/core/config/ConfigStatus";
import { createModelApi } from "../plugins/modelApi";
import { createEnvApi } from "../plugins/envApi";
import { localTranscriptionKey } from "../src/core/voice/transcriptionTransport";
import registerAIProviders from "../src/core/RegisterAIProviders";
import { costOf, createSpendPolicy, setSpendPolicyForTests } from "../plugins/spendPolicy";
import { defaultModel } from "../src/core/ProviderModels";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The zero-spend default, isolated in a temp dir (no audit written to the repo). */
const zeroSpend = () =>
  setSpendPolicyForTests(createSpendPolicy({ stateDir: mkdtempSync(path.join(tmpdir(), "lelu-cred-test-")), read: () => undefined }));
zeroSpend();

/** Distinct, realistic-looking fakes. Each carries its own provider's prefix. */
const FAKE: Record<CredentialProviderId, string> = {
  groq: "gsk_fake_groq_0123456789",
  openrouter: "sk-or-fake-openrouter-0123456789",
  cerebras: "csk-fake-cerebras-0123456789",
  fireworks: "fw_fake_fireworks_0123456789",
  mistral: "fakeMistral0123456789abcdef",
  gemini: "AIzaFakeGemini0123456789",
  githubModels: "github_pat_fake_0123456789",
  anthropic: "sk-ant-fake-anthropic-0123456789",
};

const ALL_NAMES = [
  ...new Set(
    Object.values(CREDENTIAL_SPECS).flatMap((spec) => [...spec.names, ...spec.lists, ...Object.keys(spec.refused)]),
  ),
  "LELU_ENABLE_ANTHROPIC",
];

/** Run with exactly these variables set (and every provider name unset). */
async function withEnv<T>(vars: Record<string, string>, fn: () => T | Promise<T>): Promise<T> {
  const saved = new Map(ALL_NAMES.map((name) => [name, process.env[name]]));
  for (const name of ALL_NAMES) delete process.env[name];
  Object.assign(process.env, vars);
  ProviderKeyRing.reset();
  try {
    return await fn();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    ProviderKeyRing.reset();
    reloadEnvironment();
  }
}

const readProcess = (name: string) => process.env[name];

type Handler = (req: unknown, res: unknown, next: () => void) => void;

function mount(api: { attach: (m: { use: (p: string, h: Handler) => void }) => void }): Map<string, Handler> {
  const routes = new Map<string, Handler>();
  api.attach({ use: (path, handler) => routes.set(path, handler) });
  return routes;
}

async function invoke(handler: Handler, url: string, method = "GET"): Promise<{ status: number; body: string }> {
  const out = { status: 200, body: "" };
  await new Promise<void>((resolve) => {
    const req = {
      method,
      url,
      headers: {},
      on: (event: string, fn: (chunk?: unknown) => void) => {
        if (event === "data") fn(Buffer.from("{}"));
        if (event === "end") fn();
      },
    };
    const res = {
      set statusCode(v: number) { out.status = v; },
      get statusCode() { return out.status; },
      setHeader: () => {},
      end: (body?: string) => { out.body = body ?? ""; resolve(); },
    };
    handler(req, res, () => resolve());
  });
  return out;
}

interface Sent { url: string; credential: string }

async function withFetch<T>(respond: (url: string) => Response, fn: (sent: Sent[]) => Promise<T>): Promise<T> {
  const sent: Sent[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers ?? {});
    const auth = headers.get("authorization") ?? headers.get("x-goog-api-key") ?? headers.get("x-api-key") ?? "";
    sent.push({ url, credential: auth.replace(/^Bearer\s+/i, "") });
    return respond(url);
  }) as typeof fetch;
  try {
    return await fn(sent);
  } finally {
    globalThis.fetch = real;
  }
}

async function brokerStatus(): Promise<{ providers: Record<string, boolean>; states: Record<string, { state: string }> }> {
  const routes = mount(createModelApi(readProcess));
  const handler = [...routes.values()][0];
  const out = await invoke(handler, "/status");
  return JSON.parse(out.body);
}

/* ------------------------- 1. the compatibility matrix ------------------------- */

for (const id of [...AUTHORIZED_CHAT_PROVIDERS, "githubModels"] as CredentialProviderId[]) {
  const spec = CREDENTIAL_SPECS[id];
  for (const name of [...spec.names, ...spec.lists]) {
    test(`${id}: ${name} is seen the same way by the broker, key ring, Environment and ConfigStatus`, async () => {
      await withEnv({ [name]: FAKE[id] }, async () => {
        const resolution = resolveProviderCredentials(id);
        assert.equal(resolution.state, "configured");
        assert.equal(resolution.credentials[0].key, FAKE[id]);

        // The broker sees the credential. Whether it may SPEND on it is a
        // separate gate (plugins/spendPolicy.ts): a paid provider without the
        // user's authorization is SPEND_NOT_AUTHORIZED, never UNCONFIGURED.
        const status = await brokerStatus();
        // OpenRouter is judged on the model it would send: the default is a $0 ":free" model.
        const paid = costOf(id, { model: id === "openrouter" ? defaultModel("openrouter") : undefined }).cost === "paid";
        assert.equal(status.states[id].state, paid ? "SPEND_NOT_AUTHORIZED" : "CONFIGURED", "broker state");
        assert.equal(status.providers[id], !paid, "broker /status");

        assert.equal(ProviderKeyRing.readEnvironment(id)[0]?.key, FAKE[id], "key ring");

        const env = reloadEnvironment();
        const envKey = id === "githubModels" ? "githubModels" : id;
        assert.equal((env as unknown as Record<string, { configured: boolean }>)[envKey].configured, true, "Environment");

        const capability = configCapabilities().find((entry) =>
          entry.id === (id === "githubModels" ? "provider.github-models" : `provider.${id}`));
        assert.ok(capability, `ConfigStatus lists ${id}`);
        assert.equal(capability.configured, true, "ConfigStatus");
        assert.equal(capability.missing.length, 0);
      });
    });
  }
}

test("paid providers (Fireworks, Mistral, Gemini) become available only once the user authorizes spend", async () => {
  const vars = Object.fromEntries(
    AUTHORIZED_CHAT_PROVIDERS.map((id) => [CREDENTIAL_SPECS[id].canonical, FAKE[id]]),
  );
  await withEnv(vars, async () => {
    const before = await brokerStatus();
    for (const id of ["fireworks", "mistral", "gemini"]) assert.equal(before.providers[id], false, `${id} before consent`);
    const policy = createSpendPolicy({ stateDir: mkdtempSync(path.join(tmpdir(), "lelu-cred-paid-")), read: () => undefined });
    for (const service of ["fireworks", "mistral", "gemini", "openrouter"]) {
      policy.authorize({ service, maxRequests: 5, ttlMs: 60_000, consent: "test: the user authorized paid use for this check" });
    }
    setSpendPolicyForTests(policy);
    try {
      const after = await brokerStatus();
      for (const id of AUTHORIZED_CHAT_PROVIDERS) assert.equal(after.providers[id], true, `${id} after consent`);
      assert.equal(after.providers.anthropic, false, "Anthropic stays off: it is not authorised here");
    } finally {
      zeroSpend();
    }
  });
});

test("a comma list (GROQ_API_KEYS) now reaches the broker, not only the key ring", async () => {
  await withEnv({ GROQ_API_KEYS: "gsk_fake_list_one_01, gsk_fake_list_two_02" }, async () => {
    assert.equal((await brokerStatus()).providers.groq, true);
    assert.equal(ProviderKeyRing.readEnvironment("groq").length, 2);
  });
});

/* ------------------------- 2. no false positives ------------------------- */

test("the ambient GITHUB_TOKEN is refused everywhere, including ConfigStatus", async () => {
  await withEnv({ GITHUB_TOKEN: "ghp_ambient_ci_token_0123456789" }, async () => {
    const report = credentialReport("githubModels");
    assert.equal(report.state, "missing");
    assert.equal(report.ignored[0]?.name, "GITHUB_TOKEN");
    assert.equal((await brokerStatus()).providers.githubModels, false);
    const capability = configCapabilities().find((entry) => entry.id === "provider.github-models");
    assert.equal(capability?.configured, false, "ConfigStatus used to call this configured");
  });
});

for (const [label, value] of [
  ["a placeholder", "your-groq-api-key-here"],
  ["another provider's key", FAKE.openrouter],
  ["a value with whitespace", "gsk_fake with space"],
] as const) {
  test(`${label} in GROQ_API_KEY is INVALID everywhere and is never sent`, async () => {
    await withEnv({ GROQ_API_KEY: value }, async () => {
      assert.equal(resolveProviderCredentials("groq").state, "invalid");
      const status = await brokerStatus();
      assert.equal(status.providers.groq, false);
      assert.equal(status.states.groq.state, "INVALID_CREDENTIAL");
      assert.equal(reloadEnvironment().groq.hasKey, false);
      assert.equal(reloadEnvironment().groq.credentialState, "invalid");

      const routes = mount(createModelApi(readProcess));
      await withFetch(() => new Response("{}"), async (sent) => {
        const out = await invoke([...routes.values()][0], "/groq/chat/completions", "POST");
        assert.equal(out.status, 503);
        assert.equal(JSON.parse(out.body).state, "invalid");
        assert.equal(sent.length, 0, "nothing was sent upstream");
        assert.ok(!out.body.includes(value), "the rejected value is not echoed back");
      });
    });
  });
}

test("a real key that merely starts with a placeholder word is NOT rejected", () => {
  assert.equal(
    resolveProviderCredentials("mistral", (name) => (name === "MISTRAL_API_KEY" ? "myQ8x2Lr0placeholderZ" : undefined)).state,
    "configured",
  );
});

/* ------------------------- 3. no substitution ------------------------- */

test("one provider's credential never configures another", async () => {
  await withEnv({ GROQ_API_KEY: FAKE.groq }, async () => {
    const status = await brokerStatus();
    for (const id of AUTHORIZED_CHAT_PROVIDERS) {
      assert.equal(status.providers[id], id === "groq", `${id} broker status`);
      assert.equal(resolveProviderCredentials(id).state, id === "groq" ? "configured" : "missing", id);
    }
  });
});

/* ------------------------- 4. request path ------------------------- */

const UPSTREAM: Record<(typeof AUTHORIZED_CHAT_PROVIDERS)[number], { name: string; host: string }> = {
  groq: { name: "Groq", host: "api.groq.com" },
  openrouter: { name: "OpenRouter", host: "openrouter.ai" },
  cerebras: { name: "Cerebras", host: "api.cerebras.ai" },
  fireworks: { name: "Fireworks", host: "api.fireworks.ai" },
  mistral: { name: "Mistral", host: "api.mistral.ai" },
  gemini: { name: "Gemini", host: "generativelanguage.googleapis.com" },
};

const completion = (url: string) =>
  url.includes("generativelanguage")
    ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] }), { status: 200 })
    : new Response(
        JSON.stringify({
          id: "x",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200 },
      );

test("every authorised provider is registered, available, and reaches its own upstream with its own key", async () => {
  const vars = Object.fromEntries(
    AUTHORIZED_CHAT_PROVIDERS.map((id) => [CREDENTIAL_SPECS[id].canonical, FAKE[id]]),
  );
  await withEnv(vars, async () => {
    const registry = registerAIProviders();
    await registry.initialize();
    for (const id of AUTHORIZED_CHAT_PROVIDERS) {
      const provider = registry.get(UPSTREAM[id].name);
      assert.ok(provider, `${id} is registered`);
      assert.equal(await provider.isAvailable(), true, `${id} is available`);
      await withFetch(completion, async (sent) => {
        const response = await provider.generate({ messages: [{ role: "user", content: "hi" }], prompt: "hi" } as never);
        assert.equal((response as { text?: string }).text, "OK", `${id} returned the completion`);
        assert.equal(sent.length, 1, `${id} sent exactly one request`);
        assert.equal(new URL(sent[0].url).host, UPSTREAM[id].host, `${id} reached its own upstream`);
        assert.equal(sent[0].credential, FAKE[id], `${id} used its own credential`);
      });
    }
    const anthropic = registry.get("Anthropic");
    assert.ok(anthropic, "Anthropic stays registered (its boundary is unchanged)");
    assert.equal(await anthropic.isAvailable(), false, "but unavailable: policy off");
  });
});

test("with no credentials, every authorised provider reports unavailable — registration is not readiness", async () => {
  await withEnv({}, async () => {
    const registry = registerAIProviders();
    await registry.initialize();
    for (const id of AUTHORIZED_CHAT_PROVIDERS) {
      assert.equal(await registry.get(UPSTREAM[id].name)!.isAvailable(), false, id);
    }
  });
});

/* ------------------------- 5. diagnostics and Anthropic ------------------------- */

test("/api/env-check reports state per provider and contains no key material", async () => {
  const vars = { GROQ_API_KEY_2: FAKE.groq, OPENROUTER_API_KEY: "replace-me-here", ANTHROPIC_API_KEY: FAKE.anthropic };
  await withEnv(vars, async () => {
    const routes = mount(createEnvApi(readProcess, "test"));
    const out = await invoke(routes.get("/api/env-check")!, "/");
    const body = JSON.parse(out.body);
    assert.equal(body.providers.groq.state, "configured");
    assert.equal(body.providers.groq.source, "GROQ_API_KEY_2");
    assert.equal(body.providers.openrouter.state, "invalid");
    assert.equal(body.providers.cerebras.state, "missing");
    assert.match(body.providers.cerebras.diagnosis, /Set CEREBRAS_API_KEY on the server/);
    assert.equal(body.providers.anthropic.enabledByPolicy, false);
    assert.equal(body.VITE_GROQ_API_KEY, "SET");
    for (const value of Object.values(vars)) assert.ok(!out.body.includes(value), "no value in the response");
  });
});

test("/api/provider-health never contacts Anthropic while LELU_ENABLE_ANTHROPIC is off", async () => {
  await withEnv({ ANTHROPIC_API_KEY: FAKE.anthropic }, async () => {
    const routes = mount(createEnvApi(readProcess, "test"));
    await withFetch(() => new Response("{}", { status: 200 }), async (sent) => {
      const out = await invoke(routes.get("/api/provider-health")!, "/");
      const body = JSON.parse(out.body);
      assert.equal(body.anthropic.status, "disabled-by-policy");
      assert.ok(!sent.some((request) => request.url.includes("anthropic")), "no Anthropic request");
    });
  });
});

test("/api/provider-health verifies Cerebras, Mistral, Fireworks and Gemini by model discovery", async () => {
  const vars = {
    CEREBRAS_API_KEY: FAKE.cerebras,
    MISTRAL_API_KEY: FAKE.mistral,
    FIREWORKS_API_KEY: FAKE.fireworks,
    GEMINI_API_KEY: FAKE.gemini,
  };
  await withEnv(vars, async () => {
    const routes = mount(createEnvApi(readProcess, "test"));
    const models = (url: string) =>
      url.includes("generativelanguage")
        ? new Response(JSON.stringify({ models: [{ name: "models/gemini-2.0-flash" }] }))
        : new Response(JSON.stringify({ data: [{ id: "gpt-oss-120b" }, { id: "mistral-large-latest" }, { id: "accounts/fireworks/models/gpt-oss-120b" }] }));
    await withFetch(models, async (sent) => {
      const body = JSON.parse((await invoke(routes.get("/api/provider-health")!, "/")).body);
      for (const id of ["cerebras", "mistral", "fireworks", "gemini"] as const) {
        assert.equal(body[id].ok, true, `${id} discovery ok`);
        assert.equal(body[id].configuredModelListed, true, `${id} configured model is listed`);
        const request = sent.find((entry) => entry.url.includes(UPSTREAM[id].host));
        assert.ok(request, `${id} was probed`);
        assert.equal(request.credential, FAKE[id], `${id} probed with its own key`);
      }
      assert.equal(body.groq.status, "missing-key");
    });
  });
});

/* ------------------------- 6. voice ------------------------- */

test("voice transcription asks the same Groq contract (a numbered slot is enough)", async () => {
  await withEnv({ GROQ_API_KEY_3: FAKE.groq }, () => {
    assert.equal(localTranscriptionKey(), FAKE.groq);
  });
  await withEnv({ GROQ_API_KEY: FAKE.openrouter }, () => {
    assert.equal(localTranscriptionKey(), "", "an OpenRouter key is never used for Whisper");
  });
});

test("no voice module keeps its own Groq key reader", () => {
  for (const file of [
    "src/core/voice/speechToText.ts",
    "src/core/voice/VoiceEngine.ts",
    "src/core/native/capabilities/speech.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /__LELU_GROQ_API_KEY__\?/, `${file} reads the global itself`);
    assert.doesNotMatch(source, /import\.meta\.env\.VITE_GROQ_API_KEY(?!`)/, `${file} reads the Vite env`);
    assert.match(source, /localTranscriptionKey/, `${file} asks the shared function`);
  }
});
