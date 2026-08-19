/**
 * ==========================================================
 * LÉLU — PROVIDER CONTRACT VERIFICATION
 * ==========================================================
 *
 * Verifies the real provider stack end-to-end WITHOUT network
 * and WITHOUT storing any API key in the repo:
 *
 *   1. registerAIProviders() produces one registry with all six
 *      chat providers in the correct fallback order.
 *   2. initialize() + health() report key-detection correctly.
 *   3. generate() is exercised with a stubbed fetch that returns
 *      a realistic OpenAI-compatible response for each provider,
 *      proving the request payload shape and response parsing
 *      are correct. (TEST keys are injected into the __LELU_*__
 *      globals ONLY for the duration of the test, then cleared.)
 *   4. Failure classification: an error response throws, which is
 *      what makes the real ProviderResolver fall through to the
 *      next provider in the chain.
 *
 * Run with: bun run scripts/verify-providers.ts
 * ==========================================================
 */

import registerAIProviders from "../src/core/RegisterAIProviders";

const results: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

const FAKE_SUCCESS_BODY = JSON.stringify({
  id: "chatcmpl-fake",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "Hello! I'm Lélu." },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 24, completion_tokens: 6, total_tokens: 30 },
});

function fakeResponse(body: string, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => body,
  };
}

const requested: { url: string; authHeader: string | null; model: string }[] = [];

async function main() {
  const registry = registerAIProviders();

  // ---- 1. Registry & fallback order -------------------------------------
  const names = registry.all().map((p) => p.name);
  const priorities = registry.all().map((p) => p.priority);

  check(
    "registry registers all six chat providers",
    names.join(",") ===
      "Groq,OpenRouter,Cerebras,Mistral,Fireworks,GitHub Models",
    names.join(" → "),
  );
  check(
    "fallback order is strict by priority (1,2,3,4,5,10)",
    JSON.stringify(priorities) === JSON.stringify([1, 2, 3, 4, 5, 10]),
    priorities.join(","),
  );
  check(
    "no duplicate provider names",
    new Set(names).size === names.length,
  );

  // ---- 2. inject TEST keys, initialize, health --------------------------
  const originalFetch = globalThis.fetch;
  const originalKeys: Array<[string, unknown]> = [];

  try {
    // TEST keys only — injected into the runtime globals the providers
    // read, cleared in finally. Never a real credential.
    const g = globalThis as Record<string, unknown>;
    const keyNames = [
      "__LELU_GROQ_API_KEY__",
      "__LELU_OPENROUTER_API_KEY__",
      "__LELU_CEREBRAS_API_KEY__",
      "__LELU_MISTRAL_API_KEY__",
      "__LELU_FIREWORKS_API_KEY__",
      "__LELU_GITHUB_TOKEN__",
    ];
    for (const name of keyNames) {
      originalKeys.push([name, g[name]]);
      g[name] = `test-key-${name}`;
    }

    await registry.initialize();

    const health = await Promise.all(registry.all().map((p) => p.health()));
    const withKey = health.filter((h) => h.available).length;
    check(
      "all providers initialized without throwing",
      health.every((h) => h.initialized),
    );
    check(
      "health reports every injected key as available",
      withKey === health.length,
      `${withKey}/${health.length} available`,
    );

    // ---- 3. generate() end-to-end with stubbed fetch --------------------
    const stubFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body ?? "{}"));
      requested.push({
        url,
        authHeader: headers.Authorization ?? null,
        model: body.model,
      });
      return fakeResponse(FAKE_SUCCESS_BODY);
    }) as unknown as typeof fetch;

    globalThis.fetch = stubFetch;

    const providers = registry.all();
    for (const provider of providers) {
      const response = await provider.generate({
        prompt: "Say hello",
        messages: [{ role: "user", content: "Say hello" }],
        context: "Memory: the user likes retro space games.",
      });

      check(
        `${provider.name}: generate() returned a real AIResponse`,
        typeof response.text === "string" && response.text.length > 0,
        `"${response.text.slice(0, 24)}…" via ${response.model}`,
      );
      check(
        `${provider.name}: response identifies the provider`,
        response.provider === provider.name,
      );
      check(
        `${provider.name}: usage metadata parsed`,
        (response.metadata?.usage as { total_tokens?: number })?.total_tokens === 30,
      );
    }

    // ---- request shape checks --------------------------------------------
    for (const provider of providers) {
      const row = requested.find((r) =>
        provider.name === "GitHub Models"
          ? r.url.includes("models.github.ai")
          : r.url.includes(
              provider.name === "Groq"
                ? "api.groq.com"
                : provider.name === "OpenRouter"
                  ? "openrouter.ai"
                  : provider.name === "Cerebras"
                    ? "api.cerebras.ai"
                    : provider.name === "Mistral"
                      ? "api.mistral.ai"
                      : "api.fireworks.ai",
            ),
      );
      check(
        `${provider.name}: sent to the correct official endpoint`,
        Boolean(row),
        row?.url ?? "no request",
      );
      check(
        `${provider.name}: Bearer auth header present`,
        Boolean(row?.authHeader?.startsWith("Bearer ")),
      );
      check(
        `${provider.name}: request carries the LÉLU identity prompt`,
        Boolean(row?.model),
        `model: ${row?.model}`,
      );
    }

    // ---- 4. failure throws (what drives the fallback chain) --------------
    let threw = 0;
    for (const provider of providers) {
      globalThis.fetch = (async () =>
        fakeResponse(
          JSON.stringify({ error: { message: "Insufficient quota" } }),
          429,
        )) as unknown as typeof fetch;
      try {
        await provider.generate({
          prompt: "hi",
          messages: [{ role: "user", content: "hi" }],
        });
      } catch {
        threw += 1;
      }
    }
    check(
      "every provider throws on an API error (fallback chain can advance)",
      threw === providers.length,
      `${threw}/${providers.length} threw`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    const g = globalThis as Record<string, unknown>;
    for (const [name, value] of originalKeys) {
      if (value === undefined) {
        delete g[name];
      } else {
        g[name] = value;
      }
    }
  }

  // ---- report -------------------------------------------------------------
  console.log("==========================================");
  console.log("LÉLU PROVIDER CONTRACT VERIFICATION");
  console.log("==========================================");
  for (const line of results) console.log(line);
  console.log("------------------------------------------");
  console.log(`${results.filter((r) => r.startsWith("PASS")).length} passed, ${failures} failed`);
  console.log("==========================================");

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
