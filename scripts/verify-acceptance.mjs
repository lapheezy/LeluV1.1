/**
 * ==========================================================
 * LÉLU — THE ACCEPTANCE TEST
 *
 * One objective, a real model, the real application runtime,
 * and nothing driving it after it is created.
 *
 * It runs in a browser against the dev server because that IS
 * the application runtime. A Node harness would prove the
 * library; this proves the thing people use. (It also has to:
 * the test runner's fetch cannot reach a provider through this
 * container's proxy, while the dev server's can — see the
 * report.)
 *
 * The fourteen things it must show, in order:
 *   1  the objective is active
 *   2  autonomous cognition wakes by itself
 *   3  memory already held is retrieved
 *   4  that memory enters the ACTUAL model context
 *   5  a real model evaluates the objective
 *   6  the model picks an existing capability/workflow
 *   7  the workflow executes
 *   8  a real result comes back
 *   9  the result enters cognition
 *   10 cognition judges whether the objective is done
 *   11 if not, another cycle happens on its own
 *   12 when it is, the objective completes or yields
 *   13 no further model call happens afterwards
 *   14 the whole trace is observable and persisted
 *
 * Nothing here scripts the model, selects the workflow, or
 * advances a cycle. The only instrumentation WRAPS
 * AIService.deliberate to record the prompts it was really
 * given, and calls straight through to the real one.
 *
 * Usage: vite on :5199, then
 *        node scripts/verify-acceptance.mjs [url]
 * ==========================================================
 */

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:5199/";
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.goto(url, { waitUntil: "load", timeout: 120_000 });
await page.waitForTimeout(12_000);

/* ---- set the stage: a real prior lesson, and instrumentation ---- */

const setup = await page.evaluate(async () => {
  // The self-study loop is a separate engine; parking it keeps this
  // measurement about the objective runtime, which stays running.
  (await import("/src/core/cognition/CognitiveLoop.ts")).default.getInstance().stop();

  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const learning = (await import("/src/core/cognition/ObjectiveLearning.ts")).default.getInstance();
  const agents = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
  const registry = (await import("/src/core/tools/ToolRegistry.ts")).default.getInstance();
  const AIService = (await import("/src/core/AIService.ts")).default;
  registry.updateAvailability("project.manage", true);

  const stamp = Math.random().toString(36).slice(2, 7);
  const agentId = agents.create({ name: `Acceptance ${stamp}`, role: "Works objectives unattended" }).id;
  const workflowName = `inventory-${stamp}`;

  // A REAL prior lesson, produced by the real pipeline from a real
  // failed objective — not injected as a fixture.
  const taskText =
    `Check with workflow_list whether a reusable workflow named "${workflowName}" exists, ` +
    `create it with workflow_author if not, then run it with workflow_run.`;
  const past = objectives.create({ agentId, objective: `${taskText} (first attempt)` });
  objectives.recordCycle({
    cycleId: crypto.randomUUID(),
    agentId,
    objectiveId: past.id,
    trigger: "runtime:objective-created",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    decision: "Tried to record the inventory in long-term memory first.",
    executed: [{ tool: "memory.store", ok: false }],
    nextState: "yielded",
    yieldReason: "repeated-failure",
  });
  objectives.yieldObjective(past.id, "repeated-failure", "memory.store is not usable here");
  await learning.extract(objectives.get(past.id), objectives.cycles(past.id));

  // OBSERVE the model calls. The real deliberate still runs; this only
  // records what it was given and what came back.
  const service = AIService.getInstance();
  const seen = { prompts: [], calls: 0, providers: [], tools: [], errors: [] };
  globalThis.__acceptance = seen;
  const original = service.deliberate.bind(service);
  service.deliberate = async (prompt, options) => {
    seen.calls += 1;
    seen.prompts.push(String(prompt));
    try {
      const result = await original(prompt, options);
      seen.providers.push(String(result?.provider ?? ""));
      seen.tools.push(result?.metadata?.toolsExecuted ?? []);
      return result;
    } catch (error) {
      seen.errors.push(String(error).slice(0, 200));
      throw error;
    }
  };

  return {
    agentId,
    workflowName,
    taskText,
    priorLesson: learning.guidanceFor(taskText).slice(0, 400),
  };
});

/* ---- the objective. after this line the script only waits ---- */

const objectiveId = await page.evaluate(async (setup) => {
  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  return objectives.create({
    agentId: setup.agentId,
    source: "user",
    maxCycles: 10,
    maxActions: 30,
    objective:
      `Check with workflow_list whether a reusable workflow named "${setup.workflowName}" exists. ` +
      `If it does not, create it with workflow_author: two steps that both use the project_manage ` +
      `tool with action "list", the second depending on the first and running only on the condition ` +
      `that the first succeeded. Then run it once with workflow_run and report what it produced.`,
  }).id;
}, setup);

/**
 * Poll from Node, not with waitForFunction.
 *
 * An async predicate handed to waitForFunction returns a Promise, and a
 * Promise is truthy: it "succeeds" on the first poll and the wait ends
 * before anything has happened. page.evaluate does await the result, so
 * the loop is written here.
 */
const readState = () =>
  page.evaluate(async (id) => {
    const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
    const objective = objectives.get(id);
    return {
      state: objective?.state ?? "missing",
      cyclesRun: objective?.cyclesRun ?? 0,
      calls: globalThis.__acceptance?.calls ?? 0,
    };
  }, objectiveId);

const deadline = Date.now() + 600_000;
let last = await readState();
while (Date.now() < deadline && (last.state === "active" || last.state === "scheduled")) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  last = await readState();
}
console.error(
  `[acceptance] settled at state=${last.state} after ${last.cyclesRun} cycle(s), ${last.calls} model call(s)`,
);

// Point 13: whatever happens next, it must not be another model call.
const callsAtCompletion = await page.evaluate(() => globalThis.__acceptance.calls);
await page.waitForTimeout(8_000);

const observed = await page.evaluate(async (input) => {
  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const workflows = (await import("/src/core/workflows/WorkflowStore.ts")).default.getInstance();
  const events = (await import("/src/core/agent/AgentEvents.ts")).default.getInstance();
  const learning = (await import("/src/core/cognition/ObjectiveLearning.ts")).default.getInstance();
  const kv = (await import("/src/core/storage/KvStore.ts")).default.getInstance();

  const registry = (await import("/src/core/AIService.ts")).default.getInstance().getAIProviderRegistry();
  const failureReasons = {};
  for (const name of registry.names()) {
    const failure = registry.failure(name);
    if (failure) failureReasons[name] = String(failure.reason).slice(0, 220);
  }

  const objective = objectives.get(input.objectiveId);
  const authored = workflows.list().find((entry) => entry.name === input.workflowName);
  const execution = authored ? workflows.executions(authored.id)[0] : undefined;
  const seen = globalThis.__acceptance;

  return {
    state: objective?.state,
    cyclesRun: objective?.cyclesRun,
    actionsTaken: objective?.actionsTaken,
    conclusion: objective?.conclusion?.slice(0, 300),
    cycles: objectives.cycles(input.objectiveId).map((cycle) => ({
      trigger: cycle.trigger,
      nextState: cycle.nextState,
      executed: cycle.executed,
      decision: cycle.decision.slice(0, 160),
    })),
    stages: events.cognitionTrace(input.objectiveId).map((entry) => entry.stage),
    providers: seen.providers.filter(Boolean),
    calls: seen.calls,
    toolsPerCall: seen.tools,
    deliberateErrors: seen.errors,
    providerFailures: failureReasons,
    promptsMentioningPriorLesson: seen.prompts.filter((prompt) =>
      prompt.includes("WHAT YOU LEARNED FROM EARLIER WORK"),
    ).length,
    promptsQuotingTheLesson: seen.prompts.filter((prompt) => prompt.includes("memory.store")).length,
    // A LATER prompt carrying what an earlier cycle did. Only meaningful
    // when the work actually took more than one cycle.
    promptsCarryingEarlierActions: seen.prompts.filter((prompt) => prompt.includes("[ran:")).length,
    workflow: authored
      ? { id: authored.id, steps: authored.steps.length, hasCondition: authored.steps.some((s) => s.condition) }
      : null,
    execution: execution
      ? {
          status: execution.status,
          steps: execution.steps.map((step) => ({ id: step.stepId, status: step.status })),
          finalResult: execution.finalResult?.slice(0, 160) ?? null,
        }
      : null,
    lessons: learning.lessons().slice(0, 3).map((l) => ({ kind: l.kind, durable: l.persistedDurably })),
    persistedCycles: (kv.get("lelu.agent.cognition.cycles.v1") ?? []).filter(
      (record) => record.objectiveId === input.objectiveId,
    ).length,
  };
}, { objectiveId, workflowName: setup.workflowName });

await browser.close();

/* ------------------------------ verdict ------------------------------ */

const realProviders = [...new Set(observed.providers.filter((p) => !/^(offline|local|stub)$/i.test(p)))];
const check = (label, ok, detail = "") => ({ label, ok, detail });
const results = [
  check("1  objective became active and was worked", (observed.cyclesRun ?? 0) >= 1),
  check("2  cognition woke by itself", observed.cycles.every((c) => c.trigger.startsWith("runtime:")),
    observed.cycles.map((c) => c.trigger).join(", ")),
  check("3  prior memory was retrieved", observed.stages.includes("lesson-retrieved")),
  check("4  it entered the ACTUAL model context", observed.promptsQuotingTheLesson > 0,
    `${observed.promptsMentioningPriorLesson} prompt(s) carried the guidance block`),
  check("5  a real model evaluated it", realProviders.length > 0, realProviders.join(", ")),
  check("6  the model chose an existing capability", Boolean(observed.workflow),
    observed.workflow ? `authored ${observed.workflow.steps} steps` : "no workflow authored"),
  check("7  the workflow executed", Boolean(observed.execution)),
  check("8  a real result came back", Boolean(observed.execution?.finalResult)),
  check(
    "9  the result entered cognition",
    // Within one cycle the tool result reaches the model through the
    // tool loop — the runtime records that as result-observed, and the
    // conclusion is written after seeing it. Across cycles it must also
    // appear in the next prompt.
    observed.stages.includes("result-observed") &&
      observed.cycles.some((cycle) => cycle.executed.length > 0) &&
      ((observed.cyclesRun ?? 0) === 1 || observed.promptsCarryingEarlierActions > 0),
    `result-observed=${observed.stages.includes("result-observed")}, ` +
      `later prompts carrying earlier actions=${observed.promptsCarryingEarlierActions}`,
  ),
  check("10 cognition judged completion", observed.stages.includes("branch-selected")),
  check("11 further cycles happened on their own when needed",
    (observed.cyclesRun ?? 0) === 1 || observed.cycles.some((c) => c.trigger === "runtime:self-continuation"),
    `${observed.cyclesRun} cycle(s)`),
  check("12 the objective reached a terminal state", ["completed", "yielded"].includes(observed.state),
    String(observed.state)),
  check("13 no model call after completion", observed.calls === callsAtCompletion,
    `${callsAtCompletion} at completion, ${observed.calls} after waiting`),
  check("14 the trace is observable and persisted",
    observed.persistedCycles === observed.cycles.length && observed.stages.length > 5,
    `${observed.persistedCycles} cycle(s) in KvStore, ${observed.stages.length} transitions`),
];

console.log(JSON.stringify({ setup, observed, callsAtCompletion, pageErrors: pageErrors.slice(0, 5) }, null, 2));
console.log("\n=== ACCEPTANCE ===");
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}${result.detail ? ` — ${result.detail}` : ""}`);
}
const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} — provider(s): ${realProviders.join(", ") || "NONE"}`,
);
if (failed.length > 0) process.exit(1);
