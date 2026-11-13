/**
 * Provider chain budgets.
 *
 * Measured live (2026-11-06): an ordinary chat turn spent 20.1 s inside the
 * fallback chain and then answered with the offline notice, while the first
 * rung was out of daily quota and the rung that answers in under a second was
 * handed an 89 KB request it refused as too large.
 *
 * These lock the three behaviours that fix it: a slow rung is cut off at its
 * own deadline, a size refusal is retried without the tool schemas, and a
 * spent daily quota is not retried every thirty seconds.
 */

import assert from "node:assert/strict";
import test from "node:test";

import AIProviderRegistry, { classifyProviderFailure } from "../src/core/AIProviderRegistry";
import ExecutionLogger from "../src/core/ExecutionLogger";
import ProviderResolver from "../src/core/router/ProviderResolver";
import type AIProvider from "../src/providers/AIProvider";
import type { AIRequest, AIResponse } from "../src/providers/AIProvider";

function fakeProvider(
  name: string,
  priority: number,
  generate: AIProvider["generate"],
  supportsTools = false,
): AIProvider {
  return {
    name,
    priority,
    enabled: true,
    timeout: 1000,
    requiresApiKey: false,
    capabilities: ["chat"],
    ...(supportsTools ? { supportsTools: true } : {}),
    async initialize() {},
    async isAvailable() {
      return true;
    },
    async health() {
      return { available: true, initialized: true, lastChecked: Date.now() };
    },
    canHandle() {
      return true;
    },
    generate,
  };
}

function harness(
  providers: AIProvider[],
  extras: Partial<AIRequest> = {},
): { context: Parameters<ProviderResolver["execute"]>[0]; logger: ExecutionLogger } {
  const registry = new AIProviderRegistry();
  registry.registerMany(providers);
  const logger = new ExecutionLogger();
  return {
    logger,
    context: {
      request: { prompt: "write me a short poem about the sea", messages: [], ...extras },
      started: Date.now(),
      brain: {} as never,
      knowledgeProviders: {} as never,
      aiProviders: registry,
      logger,
    } as never,
  };
}

/** A provider that hangs until its request is aborted. */
function hangingProvider(name: string, priority: number): AIProvider {
  return fakeProvider(
    name,
    priority,
    (request) =>
      new Promise<AIResponse>((_resolve, reject) => {
        request.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true },
        );
      }),
  );
}

test("a slow provider is cut off at its own budget and the next one answers", async () => {
  const { context } = harness([
    hangingProvider("Slow", 1),
    fakeProvider("Fast", 2, async () => ({
      text: "Blue horizons kiss the restless tide.",
      provider: "Fast",
      model: "fast-1",
      processingTime: 3,
    })),
  ]);

  const started = Date.now();
  const result = await new ProviderResolver({ rungBudgetMs: 60 }).execute(context);
  const elapsed = Date.now() - started;

  assert.equal(result.response?.provider, "Fast", "the turn was not answered by the next rung");
  assert.ok(elapsed < 2_000, `the slow rung held the turn for ${elapsed} ms`);
  const failure = context.aiProviders.failure("Slow");
  assert.match(failure?.reason ?? "", /budget/, "the cut-off was not recorded as the provider's failure");
  assert.equal(failure?.kind, "timeout");
});

test("a request refused for its size degrades its tool set instead of dropping every tool", async () => {
  const seen: AIRequest[] = [];
  const provider = fakeProvider(
    "Groq",
    1,
    async (request) => {
      seen.push(request);
      if (request.tools && request.tools.length > 0) {
        // The measured refusal: a per-minute token ceiling on the 89 KB
        // request that carried 87 schemas.
        throw new Error(
          "Groq failed 429: Rate limit reached for model on tokens per minute (TPM): Limit 8000, Requested 22000.",
        );
      }
      return {
        text: "Blue horizons kiss the restless tide.",
        provider: "Groq",
        model: "groq-1",
        processingTime: 452,
      };
    },
    true,
  );

  const { context } = harness([provider], { allowTools: true });
  const result = await new ProviderResolver().execute(context);

  assert.equal(result.response?.provider, "Groq");
  // TWO degradations, not one: the refused turn first retries with a REDUCED
  // tool set, and only a second refusal drops tools entirely. Dropping every
  // tool on the first refusal is what made the model describe work it could
  // not do.
  assert.equal(seen.length, 3, "the oversized attempt was not retried twice");
  assert.ok((seen[0].tools?.length ?? 0) > 0, "the first attempt did not carry the schemas");
  assert.ok((seen[1].tools?.length ?? 0) > 0, "the reduced retry dropped every tool");
  assert.ok(
    (seen[1].tools?.length ?? 0) <= (seen[0].tools?.length ?? 0),
    "the reduced retry was not smaller than the first attempt",
  );
  assert.equal(seen[2].tools, undefined, "the final retry still carried the schemas");
  // Every retry is the same turn: the request itself is unchanged.
  for (const retry of [seen[1], seen[2]]) {
    assert.equal(retry.allowTools, true);
    assert.equal(retry.prompt, "write me a short poem about the sea");
  }
});

test("a spent daily allowance is not retried smaller", async () => {
  let calls = 0;
  const provider = fakeProvider(
    "Groq",
    1,
    async () => {
      calls += 1;
      throw new Error(
        "Groq failed 429: on tokens per day (TPD): Limit 200000, Used 199144, Requested 5786.",
      );
    },
    true,
  );

  const { context } = harness([provider], { allowTools: true });
  const result = await new ProviderResolver().execute(context);

  assert.equal(calls, 1, "an exhausted daily allowance was retried");
  assert.equal(result.response?.provider, "offline");
  assert.equal(context.aiProviders.failure("Groq")?.kind, "quota-exhausted");
});

test("a refusal that is not about size is not retried smaller", async () => {
  let calls = 0;
  const provider = fakeProvider(
    "Groq",
    1,
    async () => {
      calls += 1;
      throw new Error("Groq failed 401: invalid api key");
    },
    true,
  );

  const { context } = harness([provider], { allowTools: true });
  const result = await new ProviderResolver().execute(context);

  assert.equal(calls, 1, "a credential refusal was retried");
  assert.equal(result.response?.provider, "offline");
});

test("the rung budget never turns a user Stop into a fallback", async () => {
  const controller = new AbortController();
  let secondCalled = false;

  const primary = fakeProvider("Primary", 1, async () => {
    controller.abort();
    throw new DOMException("The operation was aborted.", "AbortError");
  });
  const secondary = fakeProvider("Secondary", 2, async () => {
    secondCalled = true;
    return { text: "should never run", provider: "Secondary", model: "m", processingTime: 1 };
  });

  const { context } = harness([primary, secondary], { signal: controller.signal });

  await assert.rejects(
    new ProviderResolver({ rungBudgetMs: 60 }).execute(context),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(secondCalled, false, "another provider was tried after the user stopped");
  assert.equal(context.aiProviders.failure("Primary"), undefined);
});

test("the chain stops starting rungs once its own budget is spent", async () => {
  const { context } = harness([
    hangingProvider("First", 1),
    hangingProvider("Second", 2),
    hangingProvider("Third", 3),
  ]);

  const started = Date.now();
  const result = await new ProviderResolver({ rungBudgetMs: 40, chainBudgetMs: 70 }).execute(context);
  const elapsed = Date.now() - started;

  assert.equal(result.response?.provider, "offline");
  assert.ok(elapsed < 2_000, `the chain ran for ${elapsed} ms`);
});

test("a spent daily quota is classified apart from a transient rate limit", () => {
  assert.equal(
    classifyProviderFailure(
      "OpenRouter HTTP 429: Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
    ),
    "quota-exhausted",
  );
  // The exact body Groq returned on 2026-11-06.
  assert.equal(
    classifyProviderFailure(
      "Groq failed 429: Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` " +
        "service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199144, Requested 5786. " +
        "Please try again in 35m29s.",
    ),
    "quota-exhausted",
  );
  assert.equal(classifyProviderFailure("Groq failed 429: rate limit reached, try again shortly"), "server");

  const registry = new AIProviderRegistry();
  registry.markFailure(
    "OpenRouter",
    "OpenRouter HTTP 429: Rate limit exceeded: free-models-per-day.",
  );
  assert.equal(registry.cooldownFor("OpenRouter"), 15 * 60_000);

  registry.markFailure("Groq", "Groq failed 429: rate limit reached");
  assert.equal(registry.cooldownFor("Groq"), 30_000, "a per-minute limit must still clear quickly");
});

/**
 * A tool turn is several provider rounds plus the tools they ask for.
 *
 * The rung deadline bounds a provider that has gone SILENT — it must not
 * bound a turn that is visibly working, or the deadline becomes the stall it
 * was added to prevent. Measured live (2026-11-06): product creation ran
 * multi-tool rounds inside one rung and the 12 s cut fired mid-work.
 */
test("a turn that keeps executing tools is not cut off by the rung deadline", async () => {
  let round = 0;
  const provider = fakeProvider(
    "Working",
    1,
    async () => {
      round += 1;
      // Every single round is inside the rung budget; the TURN is not.
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (round <= 2) {
        return {
          text: "",
          provider: "Working",
          model: "working-1",
          processingTime: 60,
          toolCalls: [{ id: `call-${round}`, name: "lelu_no_such_tool_for_rung_test", arguments: {} }],
        } as AIResponse;
      }
      return {
        text: "Both files are written.",
        provider: "Working",
        model: "working-1",
        processingTime: 60,
      };
    },
    true,
  );

  const { context } = harness([provider], { allowTools: true });
  const started = Date.now();
  const result = await new ProviderResolver({ rungBudgetMs: 100 }).execute(context);
  const elapsed = Date.now() - started;

  assert.ok(elapsed > 100, `the turn finished in ${elapsed} ms, inside one rung budget`);
  assert.equal(result.response?.provider, "Working", "a working multi-round turn was cut off mid-work");
  assert.equal(result.response?.text, "Both files are written.");
  assert.equal(result.response?.metadata?.toolsExecuted?.length, 2);
});

/**
 * The other half of that report: the work must not be replayed.
 *
 * A provider that dies after running a tool leaves edits behind. Handing the
 * same messages and tools to the next provider repeats every one of them, and
 * the second attempt's failure then replaces the reply with the offline
 * notice — a conversation that looks stuck after a successful tool run.
 */
test("a rung that already ran tools is not replayed on the next provider", async () => {
  let primaryCalls = 0;
  let secondaryCalled = false;

  const primary = fakeProvider(
    "Primary",
    1,
    async () => {
      primaryCalls += 1;
      if (primaryCalls === 1) {
        return {
          text: "",
          provider: "Primary",
          model: "p-1",
          processingTime: 5,
          toolCalls: [{ id: "call-1", name: "lelu_no_such_tool_for_rung_test", arguments: {} }],
        } as AIResponse;
      }
      throw new Error("Primary failed 500: upstream went away");
    },
    true,
  );
  const secondary = fakeProvider(
    "Secondary",
    2,
    async () => {
      secondaryCalled = true;
      return { text: "the second provider answered", provider: "Secondary", model: "s-1", processingTime: 2 };
    },
    true,
  );

  const { context } = harness([primary, secondary], { allowTools: true });
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.equal(secondaryCalled, false, "the work was handed to another provider, which would run it again");
  assert.equal(primaryCalls, 2, "the failed rung was not the one that answered");
  assert.equal(result.response?.provider, "Primary");
  assert.match(
    result.response?.text ?? "",
    /lelu_no_such_tool_for_rung_test/,
    "the reply did not say what actually ran",
  );
  assert.equal(result.response?.metadata?.toolsExecuted?.length, 1);
  assert.equal(result.response?.metadata?.toolLoopStopped, "provider-failed-after-tools");
});

/**
 * A provider that suspended the ACCOUNT for billing refuses every request
 * until someone pays. Measured live: Fireworks answered 412 to every
 * self-study cycle (~49 s apart) because the failure read as "unknown" and
 * cooled for 30 s, so each cycle paid a failed round-trip before falling back.
 */
test("a billing-suspended account classifies as billing and sits out like a spent quota", () => {
  const reason =
    'Fireworks failed 412: {"error":{"message":"Account acme is suspended, possibly due to reaching the monthly spending limit or failure to pay past invoices.","code":"PRECONDITION_FAILED"}}';
  assert.equal(classifyProviderFailure(reason), "billing");
  assert.equal(classifyProviderFailure("OpenRouter failed 402: Payment Required"), "billing");

  const registry = new AIProviderRegistry();
  registry.markFailure("Fireworks", reason);
  assert.equal(registry.cooldownFor("Fireworks"), 15 * 60_000);
  assert.equal(registry.isInCooldown("Fireworks"), true);

  // A transient failure still clears quickly.
  registry.markFailure("Groq", "Groq failed 503: service unavailable");
  assert.equal(registry.cooldownFor("Groq"), 30_000);
});
