/**
 * ==========================================================
 * LÉLU — BACKGROUND WORK HAS ITS OWN BUDGET
 *
 * The owner's rule: background work starts with 10 model calls a
 * day, and only the owner gives more. She has to spend what she has
 * wisely, and conversation is never limited by it.
 *
 *   1. every call has a purpose; unlabelled = conversation
 *   2. background stops at the cap; conversation does not
 *   3. the allowance is PACED across the day
 *   4. a provider's daily-limit refusal pauses background until the
 *      next UTC day; conversation keeps going
 *   5. only the owner's budget changes the cap
 *   6. the refusal reaches the callers, and they degrade, not crash
 *   7. usage is visible by purpose
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

import { readFileSync } from "node:fs";
import UsageLedger, {
  BACKGROUND_BUDGET_SOURCE,
  DEFAULT_BACKGROUND_DAILY_CALLS,
  isBackgroundPurpose,
  purposeOf,
} from "../src/core/observability/UsageLedger";
import UsageBudgetGate, { BudgetExhaustedError, isDailyLimitRefusal } from "../src/core/observability/UsageBudgetGate";
import AIProviderRegistry from "../src/core/AIProviderRegistry";
import ExecutionLogger from "../src/core/ExecutionLogger";
import ProviderResolver from "../src/core/router/ProviderResolver";
import Brain from "../src/brain/Brain";
import AIService from "../src/core/AIService";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentStore from "../src/core/agents/AgentStore";
import { formatBackgroundAllowance } from "../src/core/cognition/CognitiveContext";
import { stopBackgroundCognition } from "./support/isolation";
import type AIProvider from "../src/providers/AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "../src/providers/AIProvider";
import type RouterContext from "../src/core/router/RouterContext";
import type ProviderRegistry from "../src/core/ProviderRegistry";

await stopBackgroundCognition();

const HOUR = 60 * 60_000;
/** 06:00 UTC, so a day has 18 h left and spacing is easy to reason about. */
const START = Date.UTC(2026, 10, 16, 6);

/** An isolated ledger + gate on a controllable clock. */
function fresh(): { ledger: UsageLedger; gate: UsageBudgetGate; clock: { t: number } } {
  const clock = { t: START };
  const ledger = new UsageLedger(() => clock.t, null);
  const gate = new UsageBudgetGate(ledger);
  gate.setClock(() => clock.t);
  return { ledger, gate, clock };
}

async function spend(gate: UsageBudgetGate, operation: string, extra: { ok?: boolean; error?: string; continuation?: boolean } = {}) {
  const reservation = await gate.reserve("ai", "Groq", { operation, continuation: extra.continuation });
  await gate.settle(reservation, { operation, ok: extra.ok ?? true, ...(extra.error ? { error: extra.error } : {}) });
}

async function refused(work: Promise<unknown>): Promise<BudgetExhaustedError> {
  try {
    await work;
  } catch (error) {
    assert.ok(error instanceof BudgetExhaustedError, `expected a budget refusal, got ${String(error)}`);
    return error;
  }
  assert.fail("the call was allowed");
}

/* ------------------------------------------------------------------ */

test("every call has a purpose, and an unlabelled call is conversation", () => {
  assert.equal(purposeOf(undefined), "conversation");
  assert.equal(purposeOf("generate"), "conversation");
  assert.equal(isBackgroundPurpose(undefined), false);
  for (const purpose of ["owner-objective", "self-study", "curiosity", "autonomous-objective"]) assert.equal(isBackgroundPurpose(purpose), true);
  assert.equal(isBackgroundPurpose("self-development"), false, "approved development is not background");
});

test("the starting allowance is 10 background calls a day; conversation is never capped by it", async () => {
  const { gate, clock } = fresh();
  assert.equal(DEFAULT_BACKGROUND_DAILY_CALLS, 10);
  for (let index = 0; index < 10; index += 1) {
    clock.t = gate.backgroundAllowance().nextAllowedAt; // wait out the pacing, as she must
    await spend(gate, index % 2 ? "self-study" : "curiosity");
  }
  assert.ok(clock.t < Date.UTC(2026, 10, 17), "all ten fit inside the day");
  clock.t += HOUR;
  const error = await refused(gate.reserve("ai", "Groq", { operation: "autonomous-objective" }));
  assert.equal(error.source, BACKGROUND_BUDGET_SOURCE);
  assert.match(error.message, /10\/10/);
  assert.match(error.message, /only the owner can raise it/);
  assert.equal(gate.backgroundAllowance().blockedBy, "cap");

  // Conversation, at the same moment, goes through.
  for (let index = 0; index < 3; index += 1) await spend(gate, "generate");
  await spend(gate, undefined as unknown as string);
});

test("the allowance is paced across the day, not spent in the first minutes", async () => {
  const { gate, clock } = fresh();
  await spend(gate, "curiosity");
  const allowance = gate.backgroundAllowance();
  assert.equal(allowance.blockedBy, "pacing");
  // 9 left and 18 h until UTC midnight: the 9 calls and the gap after the
  // last share the time, so one every 1.8 h and the last lands before midnight.
  assert.equal(allowance.nextAllowedAt - clock.t, 1.8 * HOUR);
  const error = await refused(gate.reserve("ai", "Groq", { operation: "self-study" }));
  assert.match(error.message, /Pacing/);

  // A later round of a tool loop already under way is not cut off by pacing.
  await spend(gate, "autonomous-objective", { continuation: true });

  clock.t = gate.backgroundAllowance().nextAllowedAt;
  await spend(gate, "self-study");
});

test("a newly available call goes first to the most important work that asked for one", async () => {
  const { gate, clock } = fresh();
  await spend(gate, "curiosity"); // 06:00 — first call of the day
  // Self-study wanted a call while the allowance was pacing.
  clock.t = gate.backgroundAllowance().nextAllowedAt - 20 * 60_000;
  gate.noteDemand("self-study");
  clock.t = gate.backgroundAllowance().nextAllowedAt; // the next call becomes available
  const held = await refused(gate.reserve("ai", "Groq", { operation: "curiosity" }));
  assert.match(held.message, /held for self-study/);
  await spend(gate, "self-study"); // the higher-priority work takes it

  // While self-study keeps asking, curiosity keeps waiting...
  clock.t = gate.backgroundAllowance().nextAllowedAt;
  gate.noteDemand("self-study");
  clock.t += 20 * 60_000;
  await refused(gate.reserve("ai", "Groq", { operation: "curiosity" }));
  // ...but once self-study has not asked for 30 minutes, curiosity may use it.
  clock.t += 31 * 60_000;
  await spend(gate, "curiosity");

  // Work the owner asked for outranks self-study.
  clock.t = gate.backgroundAllowance().nextAllowedAt;
  gate.noteDemand("owner-objective");
  await refused(gate.reserve("ai", "Groq", { operation: "self-study" }));
  await spend(gate, "owner-objective");
});

test("a provider's daily-limit refusal pauses background until the next UTC day; conversation continues", async () => {
  const { gate, ledger, clock } = fresh();
  // The refusal arrives on a CONVERSATION call: the quota is shared.
  await spend(gate, "generate", {
    ok: false,
    error: "Groq failed 429: Rate limit reached for model on tokens per day (TPD): Limit 200000, Used 199990",
  });
  const paused = ledger.backgroundPaused();
  assert.ok(paused, "background was paused");
  assert.equal(paused!.until, Date.UTC(2026, 10, 17));
  const error = await refused(gate.reserve("ai", "OpenRouter", { operation: "curiosity" }));
  assert.match(error.message, /paused until/);
  await spend(gate, "generate"); // conversation is unaffected

  clock.t = Date.UTC(2026, 10, 17, 0, 1);
  assert.equal(ledger.backgroundPaused(), null, "a new UTC day lifts the pause");
  await spend(gate, "self-study");
});

test("only a daily limit pauses background; an ordinary rate limit does not", () => {
  assert.equal(isDailyLimitRefusal("OpenRouter HTTP 429: Rate limit exceeded: free-models-per-day."), true);
  assert.equal(isDailyLimitRefusal("Groq failed 429: Rate limit reached on tokens per day (TPD)"), true);
  assert.equal(isDailyLimitRefusal("Groq failed 429: Rate limit reached on tokens per minute (TPM)"), false);
  assert.equal(isDailyLimitRefusal("Cerebras HTTP 401: Wrong API Key"), false);
});

test("an allowance the owner has made plentiful is not rationed", async () => {
  const { gate, ledger } = fresh();
  ledger.setBudget("ai", BACKGROUND_BUDGET_SOURCE, { dailyCalls: 100_000 });
  for (let index = 0; index < 5; index += 1) await spend(gate, index % 2 ? "curiosity" : "self-study");
  assert.equal(gate.backgroundAllowance().rationed, false);
  assert.equal(gate.backgroundAllowance().blockedBy, null);
});

test("only the owner's budget changes the cap", async () => {
  const { gate, ledger, clock } = fresh();
  ledger.setBudget("ai", BACKGROUND_BUDGET_SOURCE, { dailyCalls: 2 });
  assert.equal(gate.backgroundAllowance().cap, 2);
  assert.equal(gate.backgroundAllowance().ownerSet, true);
  await spend(gate, "self-study");
  clock.t = gate.backgroundAllowance().nextAllowedAt;
  await spend(gate, "self-study");
  clock.t += HOUR;
  await refused(gate.reserve("ai", "Groq", { operation: "self-study" }));

  ledger.setBudget("ai", BACKGROUND_BUDGET_SOURCE, null);
  assert.equal(gate.backgroundAllowance().cap, 10, "clearing the owner's cap returns to the minimal starting allowance");

  // Nothing in LÉLU's own code sets a budget: only the Settings panel and its sync do.
  for (const file of ["src/core/cognition/SelfStudyEngine.ts", "src/core/curiosity/CuriosityEngine.ts", "src/core/curiosity/CuriosityPorts.ts", "src/core/cognition/AgentCognitionRuntime.ts", "src/core/tools/ToolRegistry.ts"]) {
    assert.ok(!/setBudget|saveBudget/.test(readFileSync(file, "utf8")), `${file} can change a budget`);
  }
});

test("usage is visible by purpose", async () => {
  const { gate, ledger, clock } = fresh();
  await spend(gate, "generate");
  await spend(gate, "generate");
  await spend(gate, "self-study");
  clock.t = gate.backgroundAllowance().nextAllowedAt;
  await spend(gate, "curiosity", { ok: false, error: "boom" });
  const rows = Object.fromEntries(ledger.summaryByPurpose("day").map((row) => [row.purpose, row]));
  assert.equal(rows.conversation.totals.calls, 2);
  assert.equal(rows.conversation.background, false);
  assert.equal(rows["self-study"].totals.calls, 1);
  assert.equal(rows.curiosity.totals.failed, 1);
  assert.equal(rows.curiosity.background, true);
  assert.equal(ledger.backgroundCallsToday(), 2);
});

test("she is told her allowance, and that conversation is not limited by it", () => {
  const { gate } = fresh();
  const text = formatBackgroundAllowance(gate.backgroundAllowance());
  assert.match(text, /BACKGROUND MODEL ALLOWANCE/);
  assert.match(text, /10 model call\(s\) per day/);
  assert.match(text, /Only the owner can raise it/);
  assert.match(text, /Conversation with the owner is never limited/);
});

/* ------------------------------------------------------------------ */
/* Through the real resolver and the real callers                      */
/* ------------------------------------------------------------------ */

function provider(onGenerate: () => void): AIProvider {
  const health: AIProviderHealth = { available: true, initialized: true, lastChecked: Date.now() };
  return {
    name: "metered",
    priority: 1,
    enabled: true,
    timeout: 1000,
    requiresApiKey: false,
    capabilities: ["chat"],
    async initialize() {},
    async isAvailable() { return true; },
    async health() { return health; },
    canHandle() { return true; },
    async generate(_request: AIRequest): Promise<AIResponse> {
      onGenerate();
      return { text: "ok", provider: "metered", model: "m", processingTime: 1 };
    },
  };
}

function context(registry: AIProviderRegistry, operation?: string): RouterContext {
  return {
    request: { messages: [{ role: "user" as const, content: "x" }], prompt: "x", ...(operation ? { operation } : {}) },
    started: Date.now(),
    brain: new Brain(),
    knowledgeProviders: { all: () => [] } as unknown as ProviderRegistry,
    aiProviders: registry,
    logger: new ExecutionLogger(),
    intent: "chat" as const,
  } satisfies RouterContext;
}

test("through the resolver: a paused background call is never sent, a conversation call is", async () => {
  const ledger = UsageLedger.getInstance();
  ledger.pauseBackground(Date.now() + HOUR, "test: provider reported its daily limit");
  let sent = 0;
  const registry = new AIProviderRegistry();
  registry.register(provider(() => { sent += 1; }));

  const background = await new ProviderResolver().execute(context(registry, "curiosity"));
  assert.equal(sent, 0, "a background call reached the provider");
  assert.equal(background.response?.provider, "budget");
  assert.equal((background.response?.metadata?.budgetExhausted as { source?: string })?.source, BACKGROUND_BUDGET_SOURCE);

  const conversation = await new ProviderResolver().execute(context(registry));
  assert.equal(sent, 1, "conversation was blocked");
  assert.equal(conversation.response?.text, "ok");
});

test("an autonomous objective refused by the budget waits, visibly, instead of failing", async () => {
  // The singleton ledger is still paused from the previous test.
  assert.ok(UsageLedger.getInstance().backgroundPaused());
  const objectives = AgentObjectives.getInstance();
  const agentId = AgentStore.getInstance().create({ name: `Budget agent ${Math.random().toString(36).slice(2, 6)}` }).id;
  const objective = objectives.create({ agentId, objective: "Summarise the workspace." });

  const ai = AIService.getInstance() as unknown as { deliberate: (p: string, o?: { operation?: string }) => Promise<AIResponse> };
  const original = ai.deliberate;
  let label: string | undefined;
  ai.deliberate = async (_prompt, options) => {
    label = options?.operation;
    return {
      text: "I didn't send this.",
      provider: "budget",
      model: "none",
      processingTime: 0,
      metadata: { success: false, budgetExhausted: { source: BACKGROUND_BUDGET_SOURCE, scope: "device", reason: "Background model use is paused." } },
    };
  };
  try {
    await AgentCognitionRuntime.getInstance().runCycle(objective.id, "test:budget");
  } finally {
    ai.deliberate = original;
  }
  assert.equal(label, "owner-objective", "an objective the owner created is labelled as the owner's work");
  const after = objectives.get(objective.id)!;
  assert.equal(after.state, "scheduled", "it waits for its allowance");
  assert.match(after.conclusion ?? "", /Waiting for background budget/);
  assert.equal(after.consecutiveFailures ?? 0, 0, "a call that was never sent is not a failure");
  objectives.update(objective.id, { state: "cancelled" });
});

test("every background caller labels its calls", () => {
  assert.match(readFileSync("src/core/curiosity/CuriosityPorts.ts", "utf8"), /operation: "curiosity"/);
  assert.match(readFileSync("src/core/cognition/SelfStudyEngine.ts", "utf8"), /operation: "self-study"/);
  assert.match(readFileSync("src/core/cognition/AgentCognitionRuntime.ts", "utf8"), /operation: objective\.source === "user" \? "owner-objective" : "autonomous-objective"/);
  assert.match(readFileSync("src/core/selfdev/ProposalEngineer.ts", "utf8"), /operation: "self-development"/);
});
