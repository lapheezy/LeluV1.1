/**
 * ==========================================================
 * LÉLU — MULTI-STEP TOOL ORCHESTRATION & EXECUTION RELIABILITY
 *
 * CATEGORY: integration. No network.
 *
 * Mission 6.1.5 proved one tool call completes. A real multi-step task needs
 * the loop to survive a SEQUENCE: request A, execute A, read A's result,
 * request B, execute B, read both, answer. These tests drive the production
 * loop (ProviderResolver → generateWithTools → dispatchToolCall → real
 * executors) with only the MODEL scripted, and pin:
 *
 *   1. two sequential tool rounds, both results present and ordered, and a
 *      final answer produced after the second;
 *   2. an identical call repeated in one round runs ONCE (no double side
 *      effects) and says so;
 *   3. a partial failure does not erase the tool that worked;
 *   4. a deactivated capability cannot execute even when the model asks;
 *   5. the execution deadline stops a tool that never settles, without
 *      reporting it as done.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import ProviderResolver from "../src/core/router/ProviderResolver";
import ExecutionLogger from "../src/core/ExecutionLogger";
import { ToolTimeoutError, withDeadline } from "../src/core/tools/ToolDeadline";

interface ScriptedTurn {
  toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>;
  text?: string;
}

function scriptedProvider(turns: ScriptedTurn[]) {
  const requests: Array<Record<string, unknown>> = [];
  let index = 0;
  const provider = {
    name: "ScriptedNative",
    priority: 1,
    enabled: true,
    timeout: 10_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    supportsTools: true,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async (request: Record<string, unknown>) => {
      requests.push(request);
      const turn = turns[Math.min(index, turns.length - 1)];
      index += 1;
      return {
        text: turn.text ?? "",
        provider: "scripted",
        model: "scripted-1",
        processingTime: 1,
        ...(turn.toolCalls ? { toolCalls: turn.toolCalls } : {}),
      };
    },
  };
  return { provider, requests };
}

function harness(provider: unknown) {
  return {
    request: { prompt: "check the configuration and then the workflows", messages: [], timestamp: Date.now(), allowTools: true },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => [provider],
      names: () => ["scripted"],
      markFailure: () => {},
      markSuccess: () => {},
      all: () => [provider],
      get: () => provider,
    },
  } as never;
}

const toolMessages = (request: Record<string, unknown>) =>
  ((request.messages ?? []) as Array<Record<string, unknown>>).filter((message) => message.role === "tool");

test("two sequential tool rounds both return real results, and the answer comes after the second", async () => {
  const { provider, requests } = scriptedProvider([
    { toolCalls: [{ id: "step-a", name: "system_config", arguments: {} }] },
    { toolCalls: [{ id: "step-b", name: "workflow_list", arguments: {} }] },
    { text: "Configuration read, then workflows listed." },
  ]);

  const result = (await new ProviderResolver().execute(harness(provider))) as unknown as {
    handled: boolean;
    response: { text: string };
  };

  assert.equal(result.handled, true);
  assert.ok(requests.length >= 3, `the loop stopped after ${requests.length} round(s); it did not continue to the second tool`);

  // Round 2 saw exactly the first result.
  const afterFirst = toolMessages(requests[1]);
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0].toolCallId, "step-a");
  assert.match(String(afterFirst[0].content), /Configured:/i);

  // Round 3 saw BOTH, in order, under their own call ids.
  const afterSecond = toolMessages(requests[2]);
  assert.equal(afterSecond.length, 2, "the second round did not carry both tool results");
  assert.deepEqual(afterSecond.map((message) => message.toolCallId), ["step-a", "step-b"]);
  const firstContent = String(afterSecond[0].content);
  const secondContent = String(afterSecond[1].content);
  assert.match(firstContent, /Configured:/i);
  assert.ok(
    secondContent.length > 0 && !/no tool named|not permitted|no executor/i.test(secondContent),
    `the second tool did not run: ${secondContent.slice(0, 120)}`,
  );
  // Both results are still readable together when the final answer is asked for.
  assert.notEqual(firstContent, secondContent, "both steps returned the same text — was only one tool executed?");

  assert.match(String(result.response.text), /Configuration read, then workflows listed\./);
});

test("an identical call repeated in one round runs once, and the repeat says so", async () => {
  const { provider, requests } = scriptedProvider([
    {
      toolCalls: [
        { id: "dup-1", name: "system_config", arguments: {} },
        { id: "dup-2", name: "system_config", arguments: {} },
      ],
    },
    { text: "Checked once." },
  ]);

  await new ProviderResolver().execute(harness(provider));

  const results = toolMessages(requests[1]);
  assert.equal(results.length, 2, "the model must get one answer per call id it asked for");
  const first = String(results[0].content);
  const second = String(results[1].content);
  assert.match(first, /Configured:/i);
  assert.match(second, /not run again/i, `the duplicate was not recognised: ${second.slice(0, 120)}`);
  assert.ok(second.includes(first), "the repeat did not carry the result of the execution it replaced");
});

test("a partial failure keeps the tool that worked and names the one that did not", async () => {
  const { provider, requests } = scriptedProvider([
    {
      toolCalls: [
        { id: "ok-1", name: "system_config", arguments: {} },
        { id: "bad-1", name: "definitely_not_a_tool", arguments: {} },
      ],
    },
    { text: "One of the two steps could not run." },
  ]);

  await new ProviderResolver().execute(harness(provider));

  const results = toolMessages(requests[1]);
  assert.equal(results.length, 2);
  assert.match(String(results[0].content), /Configured:/i);
  assert.match(String(results[1].content), /no tool named|not found|unknown tool/i);
  assert.equal(results[0].toolError, false);
  assert.equal(results[1].toolError, true, "a failed tool was reported as a success");
});

test("a deactivated capability cannot execute even when the model asks for it by name", async () => {
  // The activation store persists through KvStore → localStorage.
  const scope = globalThis as Record<string, unknown>;
  if (!scope.localStorage) {
    const store = new Map<string, string>();
    const shim = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    };
    scope.localStorage = shim;
    scope.window = scope.window ?? scope;
    (scope.window as Record<string, unknown>).localStorage = shim;
  }

  const { default: CapabilityActivation } = await import("../src/core/acquisition/CapabilityActivation");
  const activation = CapabilityActivation.getInstance();
  const registryId = "kb.describe";

  try {
    activation.setCapability("acceptance.sequence", false, [registryId]);

    const { provider, requests } = scriptedProvider([
      { toolCalls: [{ id: "off-1", name: "kb_describe", arguments: {} }] },
      { text: "That step was not permitted." },
    ]);
    await new ProviderResolver().execute(harness(provider));

    const results = toolMessages(requests[1]);
    assert.equal(results.length, 1);
    const content = String(results[0].content);
    assert.equal(results[0].toolError, true, "a disabled tool executed anyway");
    assert.match(content, /permitted|enabled|not run/i, `unhelpful refusal: ${content.slice(0, 160)}`);
    assert.doesNotMatch(content, /knowledge base is empty/i, "the disabled executor ran and returned its real output");
  } finally {
    activation.setCapability("acceptance.sequence", true, [registryId]);
  }
});

test("the execution deadline stops a tool that never settles, and never calls it a success", async () => {
  const never = new Promise<string>(() => {});
  const started = Date.now();
  await assert.rejects(withDeadline(never, 60, "kb.describe"), (error: unknown) => {
    assert.ok(error instanceof ToolTimeoutError, "a hung tool did not raise the timeout error");
    assert.match(String((error as Error).message), /did not finish within/i);
    return true;
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 50 && elapsed < 2000, `the deadline fired at ${elapsed}ms, not near 60ms`);

  // A tool that answers in time is untouched by the deadline.
  assert.equal(await withDeadline(Promise.resolve("ok"), 1_000, "x"), "ok");
});
