/**
 * ==========================================================
 * LÉLU — PROVIDER FALLBACK UNDERNEATH COGNITION
 *
 * CATEGORY: integration. The real ProviderResolver, the real
 * AIProviderRegistry, the real cognition runtime. The two
 * providers in the first half are stubs because the point is
 * WHICH provider answers when one fails, and that needs a
 * failure on demand; the chain doing the choosing is real.
 *
 * What must hold:
 *   • a provider failing is not cognition failing — the next
 *     provider answers and the cycle continues;
 *   • when every provider is genuinely unreachable, cognition
 *     receives that failure, records it, and yields. It does
 *     not invent an answer, and it does not quietly stop
 *     existing.
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

import AIProviderRegistry from "../src/core/AIProviderRegistry";
import ProviderResolver from "../src/core/router/ProviderResolver";
import ExecutionLogger from "../src/core/ExecutionLogger";
import AIService from "../src/core/AIService";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentStore from "../src/core/agents/AgentStore";
import AgentEventBus from "../src/core/agent/AgentEvents";
import { stopBackgroundCognition } from "./support/isolation";

const objectives = AgentObjectives.getInstance();
const runtime = AgentCognitionRuntime.getInstance();

await stopBackgroundCognition();

function provider(name: string, priority: number, mode: "ok" | "fail") {
  return {
    name,
    priority,
    enabled: true,
    timeout: 5_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async () => {
      if (mode === "fail") throw new Error(`${name}: 529 overloaded`);
      return {
        text: `answer from ${name}`,
        provider: name,
        model: `${name}-model`,
        processingTime: 1,
        metadata: {},
      };
    },
  };
}

const baseContext = () => ({
  request: { prompt: "hi", messages: [{ role: "user", content: "hi" }], timestamp: Date.now() },
  started: Date.now(),
  logger: new ExecutionLogger(),
});

/* ====================================================================
 * A FAILING PROVIDER IS NOT A FAILING CHAIN
 * ==================================================================== */

test("when the leading provider fails, the next one really answers", async () => {
  const registry = new AIProviderRegistry();
  registry.register(provider("Alpha", 1, "fail") as never);
  registry.register(provider("Beta", 2, "ok") as never);
  await registry.initialize();

  const result = await new ProviderResolver().execute({
    ...baseContext(),
    aiProviders: registry,
  } as never);

  assert.equal(result.response?.provider, "Beta", "the chain did not fall through to the next provider");
  assert.match(String(result.response?.text), /answer from Beta/);
  // The failure is recorded against the provider that failed, not hidden.
  assert.ok(registry.failure("Alpha"), "the failing provider was not marked");
  assert.equal(registry.getActiveProvider(), "Beta");
});

test("the whole chain is tried before anything gives up", async () => {
  const registry = new AIProviderRegistry();
  registry.register(provider("One", 1, "fail") as never);
  registry.register(provider("Two", 2, "fail") as never);
  registry.register(provider("Three", 3, "ok") as never);
  await registry.initialize();

  const result = await new ProviderResolver().execute({
    ...baseContext(),
    aiProviders: registry,
  } as never);

  assert.equal(result.response?.provider, "Three");
  assert.ok(registry.failure("One") && registry.failure("Two"), "an earlier failure went unrecorded");
});

test("when every provider fails, the answer says so instead of inventing one", async () => {
  const registry = new AIProviderRegistry();
  registry.register(provider("Only", 1, "fail") as never);
  await registry.initialize();

  const result = await new ProviderResolver().execute({
    ...baseContext(),
    aiProviders: registry,
  } as never);

  const text = String(result.response?.text ?? "");
  assert.ok(text.length > 0, "an exhausted chain returned nothing at all");
  // The one thing that must never happen: content presented as a model's
  // answer when no model answered.
  assert.match(text, /offline|unreachable|unconfigured|can't generate|cannot generate/i);
  assert.notEqual(result.response?.provider, "Only", "a failed provider was credited with the answer");
});

/* ====================================================================
 * COGNITION SURVIVES IT
 * ==================================================================== */

test("cognition receives a real provider failure, records it, and yields safely", { timeout: 120_000 }, async () => {
  await stopBackgroundCognition();
  const agentId = AgentStore.getInstance().create({ name: "Fallback" }).id;

  // Make the condition real rather than assumed: every registered
  // provider is disabled for the duration, through the real registry
  // the real resolver reads, and restored afterwards.
  const registry = AIService.getInstance().getAIProviderRegistry();
  const previous = registry.all().map((entry) => [entry, entry.enabled] as const);
  for (const [entry] of previous) entry.enabled = false;

  const stages: string[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type === "cognition") stages.push(event.stage);
  });

  try {
    const objective = objectives.create({
      agentId,
      objective: "FALLBACK: work an objective while nothing can answer",
      maxCycles: 4,
    });

    runtime.start();
    const deadline = Date.now() + 90_000;
    while (objectives.get(objective.id)?.state === "active" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    runtime.stop();

    const finished = objectives.get(objective.id)!;
    const cycles = objectives.cycles(objective.id);

    // Cognition ran — it did not silently disappear because the
    // providers were gone.
    assert.ok(cycles.length > 0, "cognition never ran a cycle at all");
    assert.ok(stages.includes("cycle-started"), "no cycle was recorded on the event stream");

    // It ended, with a real reason, and NOT as a success.
    assert.notEqual(finished.state, "active", "cognition never terminated");
    assert.notEqual(finished.state, "completed", "an objective with no model was reported complete");
    assert.ok(finished.yieldReason, "it stopped without recording why");

    // And nothing was fabricated: the recorded decision is the honest
    // offline account, and no tool was credited with running.
    const decisions = cycles.map((cycle) => cycle.decision).join(" ");
    assert.match(decisions, /offline|unreachable|unconfigured|can't generate|cannot generate/i);
    assert.equal(
      cycles.some((cycle) => cycle.executed.length > 0),
      false,
      "an action was recorded although no model chose one",
    );
  } finally {
    unsubscribe();
    for (const [entry, enabled] of previous) entry.enabled = enabled;
    runtime.cleanup();
  }
});

/* ====================================================================
 * AN ACTION THAT HAPPENED IS NEVER UNREPORTED
 * ==================================================================== */

test("tools a provider ran before it failed are still reported to cognition", async () => {
  // Found by running the real thing: a provider executed workflow_author
  // for real, threw on the next round, and the chain fell through to the
  // offline answer — which carried no toolsExecuted. The cycle recorded
  // "no action taken" about a workflow that existed on disk. Silence in
  // this direction is worse than noise: the runtime believed an action
  // it had performed had never happened.
  const registry = new AIProviderRegistry();

  let round = 0;
  registry.register({
    ...provider("Tooler", 1, "ok"),
    supportsTools: true,
    generate: async () => {
      round += 1;
      if (round === 1) {
        // Round one asks for a tool, which really executes.
        return {
          text: "",
          provider: "Tooler",
          model: "tooler-1",
          processingTime: 1,
          toolCalls: [{ id: "call-1", name: "workflow_list", arguments: {} }],
          metadata: {},
        };
      }
      // Round two — after the tool ran — the provider dies.
      throw new Error("Tooler: 529 overloaded");
    },
  } as never);
  registry.register(provider("Backstop", 2, "fail") as never);
  await registry.initialize();

  const result = await new ProviderResolver().execute({
    ...baseContext(),
    request: {
      prompt: "List the workflows.",
      messages: [{ role: "user", content: "List the workflows." }],
      timestamp: Date.now(),
      allowTools: true,
    },
    aiProviders: registry,
  } as never);

  const executed = (result.response?.metadata?.toolsExecuted ?? []) as Array<{ tool: string }>;
  assert.ok(
    executed.some((entry) => entry.tool === "workflow_list"),
    `an action that really ran was not reported: ${JSON.stringify(result.response?.metadata)}`,
  );
  // And it is marked as having happened before the fallback, so nobody
  // reads it as the answering provider's work.
  assert.equal(result.response?.metadata?.toolsRanBeforeFallback, true);
});
