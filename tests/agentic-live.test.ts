/**
 * ==========================================================
 * LÉLU — LIVE AGENCY: cancellation, tool-loop replay, and the
 * Orchestrator's planned execution
 *
 * CATEGORY: integration. The real ProviderResolver tool loop,
 * the real ToolDispatcher, the real AnthropicProvider transport
 * and the real Orchestrator → TaskPlanner → TaskExecutor path.
 * Substituted: the model (a scripted provider, a scripted plan
 * reply, a stubbed fetch). Tools execute for real.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import ProviderResolver from "../src/core/router/ProviderResolver";
import ExecutionLogger from "../src/core/ExecutionLogger";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { registerExecutor, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import AnthropicProvider from "../src/providers/AnthropicProvider";
import AIService from "../src/core/AIService";
import Orchestrator from "../src/core/orchestrator/Orchestrator";
import { registerAgenticTools } from "../src/core/agentic/AgenticTools";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import type { AIRequest, AIResponse } from "../src/providers/AIProvider";

registerAgenticTools();
ToolRegistry.getInstance().updateAvailability("project.manage", true);
AutonomyGate.getInstance().setLevel(2);

const unique = () => Math.random().toString(36).slice(2, 8);

function countingTool(onRun?: () => void) {
  const id = `livekit.t${unique()}`;
  const calls: number[] = [];
  registerExecutor(
    { id, parameters: { type: "object", properties: {} }, run: async () => { calls.push(Date.now()); onRun?.(); return { ok: true, content: `${id} ran` }; } },
    { id, name: id, description: "live test tool", category: "Test", permissions: ["READ"], riskLevel: 0, available: true },
  );
  return { id, calls };
}

function scriptedProvider(name: string, replies: AIResponse[]) {
  const requests: AIRequest[] = [];
  const provider = {
    name, priority: 1, enabled: true, timeout: 10_000, requiresApiKey: false,
    capabilities: ["chat"] as const, supportsTools: true,
    initialize: async () => {}, isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async (request: AIRequest) => {
      requests.push(request);
      return replies[Math.min(requests.length - 1, replies.length - 1)];
    },
  };
  return { provider, requests };
}

function context(providers: unknown[], request: Partial<AIRequest>) {
  return {
    request: { prompt: "do it", messages: [], timestamp: Date.now(), allowTools: true, ...request },
    started: Date.now(),
    logger: new ExecutionLogger(),
    aiProviders: {
      available: async () => providers,
      names: () => providers.map((p) => (p as { name: string }).name),
      markFailure: () => {},
      markSuccess: () => {},
      all: () => providers,
      get: () => providers[0],
    },
  } as never;
}

const reply = (text: string, extra: Partial<AIResponse> = {}): AIResponse => ({ text, provider: "scripted", model: "m", processingTime: 1, ...extra });

test("stopping a turn mid tool loop runs no further tool and does not fall back", async () => {
  const controller = new AbortController();
  const first = countingTool(() => controller.abort("user pressed stop"));
  const second = countingTool();
  const primary = scriptedProvider("Primary", [
    reply("", {
      toolCalls: [
        { id: "a", name: toolNameForModel(first.id), arguments: {} },
        { id: "b", name: toolNameForModel(second.id), arguments: {} },
      ],
    }),
    reply("should never be asked"),
  ]);
  const backup = scriptedProvider("Backup", [reply("backup answer")]);

  const result = await new ProviderResolver().execute(context([primary.provider, backup.provider], { signal: controller.signal }));
  assert.equal(result.handled, true);
  assert.equal(result.response?.provider, "cancelled");
  assert.match(result.response!.text, /Stopped/);
  assert.match(result.response!.text, new RegExp(first.id), "the reply must say what already ran");
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 0, "a tool ran after the user stopped the turn");
  assert.equal(primary.requests.length, 1, "the model was asked again after stop");
  assert.equal(backup.requests.length, 0, "a stopped turn fell back to another provider");
});

test("a provider's raw blocks are carried onto the replayed assistant tool turn", async () => {
  const tool = countingTool();
  const blocks = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id: "x1", name: toolNameForModel(tool.id), input: {} },
  ];
  const primary = scriptedProvider("Primary", [
    reply("", { toolCalls: [{ id: "x1", name: toolNameForModel(tool.id), arguments: {} }], providerBlocks: { provider: "anthropic", blocks } }),
    reply("final answer"),
  ]);
  const result = await new ProviderResolver().execute(context([primary.provider], {}));
  assert.equal(result.response?.text, "final answer");
  const replayed = primary.requests[1].messages.find((m) => m.role === "assistant" && m.toolCalls?.length);
  assert.deepEqual(replayed?.providerBlocks, { provider: "anthropic", blocks });
});

test("the Anthropic request is aborted in flight and not retried", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  const realFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = ((_input: unknown, init: RequestInit) => {
    attempts += 1;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  }) as typeof fetch;
  try {
    const provider = new AnthropicProvider();
    await provider.initialize();
    const controller = new AbortController();
    const pending = provider.generate({ prompt: "hi", messages: [], signal: controller.signal });
    setTimeout(() => controller.abort("stop"), 10);
    await assert.rejects(pending, /cancelled/);
    assert.equal(attempts, 1, "a cancelled request was retried");
  } finally {
    globalThis.fetch = realFetch;
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

test("AIService.cancelActiveTurn is a no-op when nothing is running", () => {
  const ai = AIService.getInstance();
  assert.equal(ai.isTurnActive(), false);
  assert.equal(ai.cancelActiveTurn(), false);
});

test("the Orchestrator plans a multi-step request and executes it for real", async () => {
  const ai = AIService.getInstance();
  const marker = `Orchestrated ${unique()}`;
  const original = ai.reason.bind(ai);
  const prompts: string[] = [];
  ai.reason = (async (prompt: string) => {
    prompts.push(prompt);
    return reply(
      JSON.stringify({
        steps: [
          { id: "s1", title: "Create the project", tool: "project.manage", args: { action: "create", name: marker } },
          { id: "s2", title: "Confirm it exists", tool: "project.manage", args: { action: "list" }, verify: { operator: "contains", value: marker } },
        ],
      }),
      { provider: "Anthropic" },
    );
  }) as typeof ai.reason;
  try {
    const result = await Orchestrator.getInstance().process(`First create a project called ${marker} and then confirm it exists`);
    assert.equal(result.task?.status, "completed", result.response);
    assert.match(result.response, /Completed and verified/);
    assert.deepEqual(result.actions.map((a) => [a.tool, a.status]), [
      ["project.manage", "success"],
      ["project.manage", "success"],
    ]);
    assert.match(result.task!.steps[1].output!, new RegExp(marker), "the second step did not observe the first step's real effect");
    assert.match(prompts[0], /capability\.discover|project\.manage/, "the planner was not given the live capabilities");
  } finally {
    ai.reason = original;
  }
});
