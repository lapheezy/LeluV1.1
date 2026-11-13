/**
 * ==========================================================
 * LÉLU — TOOL DISCOVERY, EXECUTION AND CONTINUATION
 *
 * CATEGORY: integration. No network.
 *
 * Mission 6.1.4 cut a conversational turn from 58 tool schemas to
 * 6–14. A smaller payload is worthless if it makes capabilities
 * unreachable, so these tests drive the REAL loop (ProviderResolver
 * → generateWithTools → dispatchToolCall → ToolDispatcher executors)
 * and pin four properties:
 *
 *   1. a tool the turn was offered really executes, through the real
 *      executor, and its REAL output returns to the same conversation;
 *   2. a tool the turn was NOT offered still resolves and executes,
 *      because the dispatcher resolves by name — reachability does not
 *      depend on the selection;
 *   3. several calls in one round all execute and stay correlated;
 *   4. a tool that cannot run is reported honestly, never fabricated.
 *
 * What is mocked: the MODEL only (a provider that returns scripted
 * tool calls). Everything downstream of `response.toolCalls` is the
 * production path, and every tool result asserted here comes from a
 * real executor.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import ProviderResolver from "../src/core/router/ProviderResolver";
import ExecutionLogger from "../src/core/ExecutionLogger";
import { toolSchemasForRequest } from "../src/core/tools/ToolSchemas";

interface ScriptedTurn {
  toolCalls?: Array<{ id: string; name: string; arguments?: Record<string, unknown> }>;
  text?: string;
}

/** A provider that plays a script and records every request it was handed. */
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

function harness(provider: unknown, extras: Record<string, unknown> = {}) {
  return {
    request: { prompt: "which capabilities are configured?", messages: [], timestamp: Date.now(), allowTools: true, ...extras },
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

/** Every message the loop sent back to the model after a tool round. */
const toolMessages = (request: Record<string, unknown>) =>
  ((request.messages ?? []) as Array<Record<string, unknown>>).filter((message) => message.role === "tool");

test("a tool the turn was offered executes through the real dispatcher and returns its real output", async () => {
  const offered = toolSchemasForRequest("which capabilities are configured?");
  assert.ok(
    offered.some((schema) => schema.name === "system_config"),
    "the turn did not even offer the tool this test executes",
  );

  const { provider, requests } = scriptedProvider([
    { toolCalls: [{ id: "tc-1", name: "system_config", arguments: {} }] },
    { text: "Configuration reported." },
  ]);

  const result = (await new ProviderResolver().execute(harness(provider))) as unknown as {
    handled: boolean;
    response: { text: string };
  };

  assert.equal(result.handled, true);
  assert.ok(requests.length >= 2, "the loop did not continue after the tool result");
  const results = toolMessages(requests[1]);
  assert.equal(results.length, 1, "the tool result was not returned to the same conversation");
  const content = String(results[0].content ?? "");
  assert.ok(content.length > 0, "the tool result was empty");
  // The real executor's own words — a fabricated result could not know them.
  assert.match(content, /Configured:/i, `unexpected tool output: ${content.slice(0, 120)}`);
  assert.equal(String(result.response.text).trim(), "Configuration reported.");
});

test("a tool the turn was NOT offered still resolves and executes", async () => {
  const prompt = "which capabilities are configured?";
  const offered = toolSchemasForRequest(prompt).map((schema) => schema.name);
  // Any read-only executable tool this turn did NOT offer proves reachability;
  // hardcoding one made the test depend on a particular selection.
  const SAFE = ["workflow_list", "studio_list", "repo_status", "capabilities_deactivate", "kb_search"];
  const omitted = SAFE.find((name) => !offered.includes(name));
  assert.ok(omitted, `every safe candidate was offered; selection: ${offered.join(", ")}`);

  const { provider, requests } = scriptedProvider([
    { toolCalls: [{ id: "tc-2", name: String(omitted), arguments: {} }] },
    { text: "Knowledge base described." },
  ]);

  await new ProviderResolver().execute(harness(provider));
  const results = toolMessages(requests[1]);
  assert.equal(results.length, 1);
  const content = String(results[0].content ?? "");
  assert.ok(
    content.length > 0 && !/no tool named|not permitted|no executor/i.test(content),
    `the omitted tool did not run through its real executor: ${content.slice(0, 120)}`,
  );
});

test("several calls in one round all execute and stay correlated to one task", async () => {
  const { provider, requests } = scriptedProvider([
    {
      toolCalls: [
        { id: "tc-a", name: "system_config", arguments: {} },
        { id: "tc-b", name: "workflow_list", arguments: {} },
      ],
    },
    { text: "Both reported." },
  ]);

  await new ProviderResolver().execute(harness(provider));
  const results = toolMessages(requests[1]);
  assert.equal(results.length, 2, `expected two tool results, got ${results.length}`);
  const correlated = results.map((message) => String(message.toolCallId ?? message.tool_call_id ?? ""));
  assert.ok(correlated.includes("tc-a") && correlated.includes("tc-b"), `results were not correlated: ${correlated.join(", ")}`);
});

test("a tool that cannot run is reported honestly, never fabricated", async () => {
  const { provider, requests } = scriptedProvider([
    { toolCalls: [{ id: "tc-x", name: "definitely_not_a_tool", arguments: {} }] },
    { text: "That tool does not exist." },
  ]);

  await new ProviderResolver().execute(harness(provider));
  const results = toolMessages(requests[1]);
  assert.equal(results.length, 1);
  const content = String(results[0].content ?? "");
  assert.match(content, /no tool named|not permitted|not run/i, `a missing tool was not reported honestly: ${content.slice(0, 120)}`);
});

test("a caller's output budget survives the request path untouched", async () => {
  const { provider, requests } = scriptedProvider([{ text: "ok" }]);
  await new ProviderResolver().execute(harness(provider, { maxTokens: 6_000 }));
  assert.equal(requests[0].maxTokens, 6_000, "the caller's maxTokens was overwritten");
});

test("a deactivated capability is refused honestly, and comes back when activated", async () => {
  // CapabilityActivation persists through KvStore → localStorage. Node has
  // none, and without it every write is a silent no-op, which would make this
  // test pass while proving nothing.
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
  const { dispatchToolCall, toolPermitted } = await import("../src/core/tools/ToolDispatcher");
  const { toolNameForModel } = await import("../src/core/tools/ToolDispatcher");
  const activation = CapabilityActivation.getInstance();
  // The activation store is keyed by REGISTRY id; the model sees the mapped name.
  const registryId = "kb.describe";
  const tool = toolNameForModel(registryId);

  try {
    activation.setCapability("acceptance.probe", false, [registryId]);
    assert.equal(toolPermitted(registryId), false, "a deactivated capability's tool was still permitted");
    const refused = await dispatchToolCall({ id: "tc-d", name: tool, arguments: {} }, "acceptance");
    assert.equal(refused.ok, false, "a deactivated tool executed anyway");
    assert.match(String(refused.content), /not permitted|not enabled|not run/i, `unhelpful refusal: ${String(refused.content).slice(0, 120)}`);

    activation.setCapability("acceptance.probe", true, [registryId]);
    assert.equal(toolPermitted(registryId), true, "reactivating the capability did not restore the tool");
    const allowed = await dispatchToolCall({ id: "tc-d2", name: tool, arguments: {} }, "acceptance");
    assert.equal(allowed.ok, true, "the tool did not run after reactivation");
  } finally {
    activation.setCapability("acceptance.probe", true, [registryId]);
  }
});

test("the payload stays small even on a tool turn", async () => {
  const { provider, requests } = scriptedProvider([{ text: "ok" }]);
  await new ProviderResolver().execute(harness(provider));
  const tools = (requests[0].tools ?? []) as Array<{ name: string }>;
  assert.ok(tools.length > 0, "a tool turn was offered nothing");
  assert.ok(tools.length <= 14, `a tool turn carried ${tools.length} schemas`);
});
