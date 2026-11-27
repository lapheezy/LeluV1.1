/**
 * ==========================================================
 * LÉLU — CONVERSATIONAL RELIABILITY & EXECUTION RECOVERY
 *
 * CATEGORY: integration. No network.
 *
 * Mission 44.4 reported two failures it could not explain: a multi-tool turn
 * whose provider was "killed by the 12 s rung budget", and Groq "returning no
 * usable content" on the same turn. Mission 44.5 traced both to our own code,
 * against the live providers:
 *
 *   1. Both configured providers stream REASONING before content. The
 *      non-streamed reader has always fallen back to that field; the streamed
 *      reader ignored it entirely, so the same provider answered in one mode
 *      and was recorded as broken in the other (measured: 162 characters of
 *      reasoning, 0 of content, HTTP 200).
 *   2. The rung deadline only re-armed when a WHOLE round returned, so a
 *      provider that was visibly streaming — 7.4 s and 4.4 s rounds on
 *      OpenRouter — was cut off at a fixed 12 s mid-turn.
 *
 * These tests pin the recovery that follows: an answer cut off by the output
 * budget is re-asked once with more room, a streamed delta counts as progress,
 * and a provider that dies after its tools ran has the answer WRITTEN from
 * those results by the next provider, with tools withheld so nothing repeats.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import ProviderResolver from "../src/core/router/ProviderResolver";
import ExecutionLogger from "../src/core/ExecutionLogger";
import {
  EmptyCompletionError,
  readOpenAIStream,
  streamedCompletionAnswer,
} from "../src/providers/openaiTools";
import type AIProvider from "../src/providers/AIProvider";
import type { AIRequest, AIResponse } from "../src/providers/AIProvider";
import UsageBudgetGate from "../src/core/observability/UsageBudgetGate";
import { availabilityProbeMs, settleWithin } from "../src/core/tools/ToolRegistry";

/* ------------------------------ fixtures ------------------------------ */

function sse(chunks: Array<Record<string, unknown>>): string {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
}

function eventStream(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

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
    timeout: 1_000,
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

function harness(providers: AIProvider[], extras: Partial<AIRequest> = {}) {
  const registry = {
    available: async () => providers,
    names: () => providers.map((provider) => provider.name),
    markFailure: () => {},
    markSuccess: () => {},
    all: () => providers,
    get: (name: string) => providers.find((provider) => provider.name === name),
    failure: () => undefined,
    cooldownFor: () => 0,
    isInCooldown: () => false,
  };
  const logger = new ExecutionLogger();
  return {
    logger,
    context: {
      request: {
        prompt: "check the configuration and then the workflows",
        messages: [],
        timestamp: Date.now(),
        allowTools: true,
        onDelta: () => {},
        ...extras,
      },
      started: Date.now(),
      logger,
      aiProviders: registry,
    } as never,
  };
}

/* --------------------- an account that never answers --------------------- */

/**
 * Measured live 2026-11-27: in a signed-in session every turn stopped right
 * after memory recall — no provider request, no reply, the composer on
 * "Processing" for minutes, and the same again after a reload. The budget
 * gate's account call is the one await on that path that could never settle.
 * A turn must not be held hostage by a budget check.
 */
test("an account budget check that never answers cannot hold a turn", async () => {
  const previous = process.env.LELU_ACCOUNT_CHECK_TIMEOUT_MS;
  process.env.LELU_ACCOUNT_CHECK_TIMEOUT_MS = "60";
  try {
    const ledger = {
      check: () => ({ allowed: true }),
      budgetsSnapshot: () => ({}),
      getUser: () => null,
      record: (event: Record<string, unknown>) => ({ id: "settled", ...event }),
    };
    const gate = new UsageBudgetGate(ledger as never);
    gate.setRemote(
      () =>
        ({
          reserve: () => new Promise(() => {}),
          settle: () => new Promise(() => {}),
          release: () => new Promise(() => {}),
        }) as never,
    );

    const started = Date.now();
    const reservation = await gate.reserve("ai", "Groq", { reserveTokens: 10 });
    assert.ok(Date.now() - started < 2_000, "the budget check held the call for longer than its deadline");
    // The device ledger decided, and the reply says the account was not consulted.
    assert.equal(reservation.accountChecked, false);
    assert.ok(reservation.warnings.some((warning) => /account could not be checked/i.test(warning)));

    // Now the other half: a reserve that SUCCEEDS and a settle that never
    // answers. The usage sync runs after the answer arrived, so a hang here is
    // a reply on screen with a turn that never settles.
    gate.setRemote(
      () =>
        ({
          reserve: async () => ({ allowed: true }),
          settle: () => new Promise(() => {}),
          release: () => new Promise(() => {}),
        }) as never,
    );
    const seconds = Date.now();
    const checked = await gate.reserve("ai", "Groq", { reserveTokens: 10 });
    assert.equal(checked.accountChecked, true);
    await gate.settle(checked, { model: "m", operation: "generate", ok: true, latencyMs: 5 } as never);
    assert.ok(Date.now() - seconds < 2_000, "the usage sync held the finished turn open");
    assert.deepEqual(gate.unsettledIds(), [checked.id]);
  } finally {
    if (previous === undefined) delete process.env.LELU_ACCOUNT_CHECK_TIMEOUT_MS;
    else process.env.LELU_ACCOUNT_CHECK_TIMEOUT_MS = previous;
  }
});

/* ------------------- a tool catalogue that never answers ------------------- */

/**
 * Measured live 2026-11-27: every chat turn stopped after memory recall with
 * no provider request at all — for minutes, on every turn, across reloads.
 * The router awaits the tool-availability refresh before its first stage, and
 * that refresh settled only when ALL of its probes settled. One probe that
 * never answered therefore held every turn open. The catalogue decides which
 * tools are OFFERED; it must never outrank the answer.
 */
test("a tool-availability probe that never answers cannot hold a turn", async () => {
  const started = Date.now();
  const outcome = await settleWithin(new Promise(() => {}), 60, "development runtime probe");
  assert.equal(outcome.ok, false);
  assert.ok(Date.now() - started < 2_000, "a hung probe held the refresh past its deadline");
  assert.match(
    String((outcome as { error: unknown }).error),
    /did not answer within 60 ms/,
    "the timeout was not reported as a timeout",
  );

  // A working probe is untouched.
  assert.deepEqual(await settleWithin(Promise.resolve(7), 60, "probe"), { ok: true, value: 7 });
  // A failing probe is a failure, not a timeout.
  const failed = await settleWithin(Promise.reject(new Error("HTTP 503")), 60, "probe");
  assert.equal(failed.ok, false);
  assert.match(String((failed as { error: unknown }).error), /503/);

  assert.ok(availabilityProbeMs() >= 50, "the probe budget is not a usable number");
});

/* ------------------------- the streamed reader ------------------------- */

test("a reasoning-only stream is parsed as reasoning, and its truncation is typed", async () => {
  const body = sse([
    { choices: [{ delta: { role: "assistant", reasoning: "I should check the lab " } }] },
    { choices: [{ delta: { reasoning: "history first." } }] },
    { choices: [{ delta: {}, finish_reason: "length" }], usage: { completion_tokens_details: { reasoning_tokens: 9 } } },
  ]);

  const parsed = await readOpenAIStream(eventStream(body), "Groq", () => {});

  // The measured shape: content is empty, reasoning is not.
  assert.equal(parsed.text, "");
  assert.equal(parsed.reasoning, "I should check the lab history first.");
  assert.equal(parsed.finishReason, "length");

  assert.throws(
    () => streamedCompletionAnswer("Groq", parsed),
    (error: unknown) =>
      error instanceof EmptyCompletionError &&
      error.truncated === true &&
      error.finishReason === "length",
    "a truncated, reasoning-only round was reported as an untyped empty answer",
  );
});

test("a reasoning-only stream that ended normally is the answer, the way the non-streamed reader treats it", async () => {
  const body = sse([
    { choices: [{ delta: { reasoning: "The branch is mission/44-5." } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
  ]);

  const parsed = await readOpenAIStream(eventStream(body), "OpenRouter", () => {});
  const answer = streamedCompletionAnswer("OpenRouter", parsed);

  assert.equal(answer.text, "The branch is mission/44-5.");
  assert.equal(answer.fromReasoning, true);
});

test("a tool-call stream is not an empty answer, and reasoning is never streamed as the reply", async () => {
  const streamed: string[] = [];
  const body = sse([
    { choices: [{ delta: { reasoning: "I will list the experiments." } }] },
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "lab_history", arguments: "{}" } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
  ]);

  const parsed = await readOpenAIStream(eventStream(body), "Groq", (text) => streamed.push(text));
  const answer = streamedCompletionAnswer("Groq", parsed);

  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, "lab_history");
  assert.equal(answer.text, "");
  // Thinking is not the answer on screen while a tool request is arriving.
  assert.deepEqual(streamed, []);
});

/* -------------------- one bounded retry for a cut-off round -------------------- */

test("a round cut off by the output budget is re-asked once, with more room and no tools", async () => {
  const requests: AIRequest[] = [];
  let calls = 0;
  const provider = fakeProvider(
    "Groq",
    1,
    async (request) => {
      requests.push(request);
      calls += 1;
      if (calls === 1) {
        throw new EmptyCompletionError(
          "Groq hit the token limit before producing an answer (finish_reason=length). Raise max_tokens — a reasoning model can spend the whole budget thinking.",
          true,
          "length",
        );
      }
      return { text: "The configuration is read.", provider: "Groq", model: "gpt-oss-120b", processingTime: 2 };
    },
    true,
  );

  const { context } = harness([provider]);
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.equal(calls, 2, "the truncated round was not re-asked exactly once");
  assert.equal(result.response?.provider, "Groq");
  assert.match(result.response?.text ?? "", /configuration is read/);
  // The retry gives the model room, and pays for it by withholding schemas so
  // the same per-minute token ceiling is not overshot.
  assert.ok((requests[1].maxTokens ?? 0) > 0, "the retry asked for no reply budget");
  assert.ok(
    (requests[1].maxTokens ?? 0) > (requests[0].maxTokens ?? 0),
    "the retry was sent with the same reply budget",
  );
  assert.equal(
    (requests[1].tools ?? []).length,
    0,
    "the retry still carried tool schemas it would have to pay for",
  );
});

test("a truncation is retried once, not forever", async () => {
  let calls = 0;
  const provider = fakeProvider(
    "Groq",
    1,
    async () => {
      calls += 1;
      throw new EmptyCompletionError("Groq hit the token limit before producing an answer.", true, "length");
    },
    true,
  );

  const { context } = harness([provider]);
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.equal(calls, 2, `the cut-off round was retried ${calls - 1} time(s)`);
  // With no other provider, the turn still says so rather than pretending.
  assert.equal(result.response?.provider, "offline");
});

test("an answer the output budget cut off is completed by one re-ask", async () => {
  const requests: AIRequest[] = [];
  let calls = 0;
  const provider = fakeProvider(
    "Groq",
    1,
    async (request) => {
      requests.push(request);
      calls += 1;
      if (calls === 1) {
        return {
          text: "The first half of the",
          provider: "Groq",
          model: "gpt-oss-120b",
          processingTime: 1,
          metadata: { truncated: true, finishReason: "length" },
        };
      }
      return {
        text: "The first half of the answer, and then the rest of it.",
        provider: "Groq",
        model: "gpt-oss-120b",
        processingTime: 1,
        metadata: { truncated: false, finishReason: "stop" },
      };
    },
    true,
  );

  const { context } = harness([provider]);
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.equal(calls, 2, "a cut-off answer was kept as though it were whole");
  assert.equal(result.response?.text, "The first half of the answer, and then the rest of it.");
  assert.ok((requests[1].maxTokens ?? 0) > 0);
  assert.equal((requests[1].tools ?? []).length, 0, "the re-ask paid for tool schemas it did not use");
});

test("when the re-ask cannot improve on a cut-off answer, the real partial answer is kept", async () => {
  let calls = 0;
  const provider = fakeProvider(
    "Groq",
    1,
    async () => {
      calls += 1;
      return {
        text: "Partial answer that ends mid-sen",
        provider: "Groq",
        model: "gpt-oss-120b",
        processingTime: 1,
        metadata: { truncated: true, finishReason: "length" },
      };
    },
    true,
  );

  const { context } = harness([provider]);
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.equal(calls, 2, "the cut-off answer was re-asked more than once");
  assert.equal(result.response?.text, "Partial answer that ends mid-sen");
  assert.equal(result.response?.provider, "Groq");
});

/* -------------------- progress keeps a working rung alive -------------------- */

test("a provider that is streaming is not cut off by the rung deadline", async () => {
  const provider = fakeProvider("Streaming", 1, async (request) => {
    // Six deltas 40 ms apart: 240 ms of visible work inside a 120 ms deadline.
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      request.onDelta?.(`token ${index}`);
    }
    return { text: "Streamed answer arrived.", provider: "Streaming", model: "s-1", processingTime: 240 };
  });

  const { context } = harness([provider]);
  const started = Date.now();
  const result = await new ProviderResolver({ rungBudgetMs: 120 }).execute(context);

  assert.equal(result.response?.provider, "Streaming", "the streaming rung was cut off mid-work");
  assert.ok(Date.now() - started > 120, "the turn finished inside one rung budget, so the deadline never fired");
  assert.equal(result.response?.text, "Streamed answer arrived.");
});

/* ---------------- a provider failure does not destroy the work ---------------- */

test("a provider that dies after its tools ran has the answer written from those results, and nothing runs twice", async () => {
  let primaryRounds = 0;
  let toolRuns = 0;
  const narrationRequests: AIRequest[] = [];

  const primary = fakeProvider(
    "Primary",
    1,
    async () => {
      primaryRounds += 1;
      if (primaryRounds === 1) {
        return {
          text: "",
          provider: "Primary",
          model: "p-1",
          processingTime: 5,
          toolCalls: [{ id: "call-1", name: "system_config", arguments: {} }],
        } as AIResponse;
      }
      throw new Error("Primary failed 500: upstream went away");
    },
    true,
  );

  const secondary = fakeProvider("Secondary", 2, async (request) => {
    narrationRequests.push(request);
    // Every tool execution in this test goes through the dispatcher; the
    // narrator has no tools, so it cannot add one.
    for (const tool of request.tools ?? []) if (tool.name) toolRuns += 1;
    return {
      text: "The configuration was read; the workflows were never listed.",
      provider: "Secondary",
      model: "s-1",
      processingTime: 2,
    };
  });

  const { context } = harness([primary, secondary]);
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.equal(primaryRounds, 2, "the failed rung did not fail on its second round");
  assert.equal(narrationRequests.length, 1, "the completed results were not narrated, or were narrated twice");
  assert.equal(toolRuns, 0, "the recovering provider was offered tools, so it could repeat the work");

  const narration = narrationRequests[0];
  assert.equal(narration.allowTools, true);
  assert.equal((narration.tools ?? []).length, 0);
  const instruction = (narration.messages ?? []).map((message) => message.content).join("\n");
  assert.match(instruction, /ALREADY RUN/, "the narrator was not told the steps ran");
  assert.match(instruction, /Configured:/, "the narrator was not given the tool's real result");
  assert.match(instruction, /do not ask for one/i, "the narrator was not told it has no tools");

  // The answer is the narrator's prose, attributed honestly.
  assert.equal(result.response?.provider, "Secondary");
  assert.match(result.response?.text ?? "", /workflows were never listed/);
  assert.match(result.response?.text ?? "", /Provenance: this answer was written from the 1 step/);
  assert.equal(result.response?.metadata?.toolLoopStopped, "narration-recovered");
  assert.equal(result.response?.metadata?.success, true);
  assert.equal(result.response?.metadata?.toolsExecuted?.length, 1);
  // A result body belongs to the turn, not to the stored message.
  assert.equal(
    (result.response?.metadata?.toolsExecuted?.[0] as { content?: string } | undefined)?.content,
    undefined,
    "the tool's result body was attached to the reply metadata",
  );
});

test("when nobody can narrate the completed work, the honest step list is reported instead", async () => {
  let primaryRounds = 0;
  const primary = fakeProvider(
    "Primary",
    1,
    async () => {
      primaryRounds += 1;
      if (primaryRounds === 1) {
        return {
          text: "",
          provider: "Primary",
          model: "p-1",
          processingTime: 5,
          toolCalls: [{ id: "call-1", name: "system_config", arguments: {} }],
        } as AIResponse;
      }
      throw new Error("Primary failed 500: upstream went away");
    },
    true,
  );
  const secondary = fakeProvider("Secondary", 2, async () => {
    throw new Error("Secondary failed 429: tokens per minute");
  });

  const { context } = harness([primary, secondary]);
  const result = await new ProviderResolver({ rungBudgetMs: 5_000 }).execute(context);

  assert.match(result.response?.text ?? "", /Partial result/);
  assert.match(result.response?.text ?? "", /NOT complete/);
  assert.match(result.response?.text ?? "", /system_config/);
  assert.equal(result.response?.metadata?.success, false);
  assert.equal(result.response?.metadata?.toolLoopStopped, "provider-failed-after-tools");
});
