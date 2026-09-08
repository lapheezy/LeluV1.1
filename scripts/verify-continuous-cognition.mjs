/**
 * ==========================================================
 * LÉLU — LIVE VERIFICATION: CONTINUOUS COGNITION
 *
 * Runs against a REAL browser and a REAL dev server. It proves
 * three things that a unit test cannot:
 *
 *   1. booting the actual application starts autonomous
 *      cognition — nothing in this script starts it;
 *   2. a workflow can be authored and executed through the real
 *      native tool path inside that runtime;
 *   3. an objective created and then LEFT ALONE runs further
 *      cycles that the runtime itself initiates.
 *
 * Point 3 is the one that matters: after creating the objective
 * this script only waits. Any cycle recorded with the trigger
 * "runtime:self-continuation" was started by LÉLU.
 *
 * Usage:  bun run dev  (or vite on :5199)
 *         node scripts/verify-continuous-cognition.mjs [url]
 *
 * It reports what actually happened. With no AI provider
 * configured the decision itself cannot run, and the script says
 * so rather than calling the run a success.
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
await page.waitForTimeout(15_000);

/* ---- 1 + 2: boot state, and authoring through the real tool path ---- */

const surface = await page.evaluate(async () => {
  const cognition = (await import("/src/core/cognition/AgentCognitionRuntime.ts")).default.getInstance();
  const bridge = (await import("/src/core/workflows/AgentWorkflowBridge.ts")).default.getInstance();
  const registry = (await import("/src/core/tools/ToolRegistry.ts")).default.getInstance();
  const { dispatchToolCall } = await import("/src/core/tools/ToolDispatcher.ts");

  const autonomyRunningBeforeAnythingElse = cognition.isRunning();
  const name = `live-check-${Math.random().toString(36).slice(2, 7)}`;
  registry.updateAvailability("project.manage", true);

  const authored = await dispatchToolCall(
    {
      id: "verify-author",
      name: "workflow_author",
      arguments: {
        name,
        description: "Authored live to verify the authoring and control-flow path.",
        outputs: "A project listing, confirmed.",
        steps: [
          { id: "a", name: "list", tool: "project.manage", arguments: { action: "list" } },
          {
            id: "b",
            name: "confirm",
            tool: "project.manage",
            arguments: { action: "list" },
            dependsOn: ["a"],
            condition: { step: "a", operator: "succeeded" },
          },
        ],
      },
    },
    "verify-continuous-cognition",
  );

  const ran = await dispatchToolCall(
    { id: "verify-run", name: "workflow_run", arguments: { workflow: name } },
    "verify-continuous-cognition",
  );

  return {
    autonomyRunningBeforeAnythingElse,
    authored: { ok: authored.ok, content: authored.content.slice(0, 300) },
    ran: { ok: ran.ok, content: ran.content.slice(0, 600) },
    discoverable: bridge.discover().some((offer) => offer.name === name),
  };
});

/* ---- 2b: the model path, as the application really routes it ---- */

const model = await page.evaluate(async () => {
  const { endpointUrl } = await import("/src/core/Endpoints.ts");
  const routedTo = endpointUrl("anthropic", "messages");

  // What the page could do BEFORE the broker existed: call the provider
  // directly. Kept as the control, because it is the thing that failed.
  let direct = "not-attempted";
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    direct = `HTTP ${response.status}`;
  } catch (error) {
    direct = `NETWORK ERROR: ${String(error).slice(0, 80)}`;
  }

  let brokerStatus = null;
  try {
    brokerStatus = await (await fetch("/api/model/status")).json();
  } catch (error) {
    brokerStatus = { error: String(error).slice(0, 120) };
  }

  // THE REAL PROVIDER OBJECT, from the real registry, making a real call.
  const ai = (await import("/src/core/AIService.ts")).default.getInstance();
  const anthropic = ai.getAIProviderRegistry().get("Anthropic");
  let providerCall = { reached: false, detail: "no Anthropic provider registered" };
  if (anthropic) {
    try {
      const result = await anthropic.generate({
        prompt: "Reply with the single word: ready.",
        messages: [{ role: "user", content: "Reply with the single word: ready." }],
        timestamp: Date.now(),
      });
      providerCall = { reached: true, answered: true, detail: String(result.text).slice(0, 120) };
    } catch (error) {
      const detail = String(error).slice(0, 200);
      // An HTTP status from the provider means the request ARRIVED. A
      // network error means it never left. Only the second is a broken
      // path, and the difference is the whole point of this check.
      providerCall = { reached: /\b\d{3}\b/.test(detail), answered: false, detail };
    }
  }

  return { routedTo, direct, brokerStatus, providerCall };
});

/* ---- 3: an objective, then nothing but waiting ---- */

const objectiveId = await page.evaluate(async () => {
  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const agents = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
  const agentId = agents.create({ name: "Live autonomy check" }).id;
  return objectives.create({
    agentId,
    objective: "Report which reusable workflows exist and whether any can run right now.",
    source: "user",
  }).id;
});

await page.waitForTimeout(30_000);

const observed = await page.evaluate(async (id) => {
  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const agents = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
  const events = (await import("/src/core/agent/AgentEvents.ts")).default.getInstance();
  const learning = (await import("/src/core/cognition/ObjectiveLearning.ts")).default.getInstance();
  const { buildCognitiveContext, formatCognitiveContext } = await import(
    "/src/core/cognition/CognitiveContext.ts"
  );

  const objective = objectives.get(id);
  const context = formatCognitiveContext(buildCognitiveContext());
  const trace = events.cognitionTrace(id);

  return {
    // WHOSE work it is.
    agentId: objective?.agentId,
    agentName: objective ? agents.get(objective.agentId)?.name : undefined,
    objectiveText: objective?.objective,
    // WHERE it got to.
    state: objective?.state,
    cyclesRun: objective?.cyclesRun,
    actionsTaken: objective?.actionsTaken,
    yieldReason: objective?.yieldReason,
    conclusion: objective?.conclusion?.slice(0, 300),
    cycles: objectives.cycles(id).map((cycle) => ({
      trigger: cycle.trigger,
      agentId: cycle.agentId,
      nextState: cycle.nextState,
      executed: cycle.executed,
      decision: cycle.decision.slice(0, 200),
    })),
    // WHAT THE RUNTIME RECORDED as it happened.
    stages: trace.map((entry) => entry.stage),
    // WHETHER SHE CAN SEE HER OWN WORK.
    contextNamesTheObjective: objective ? context.includes(objective.objective.slice(0, 40)) : false,
    contextHasRecentPass: context.includes("YOUR MOST RECENT COGNITIVE PASS"),
    // WHAT SHE LEARNED, and whether the durable write really landed.
    lessons: learning.lessons().slice(0, 3).map((lesson) => ({
      kind: lesson.kind,
      confidence: lesson.confidence,
      persistedDurably: lesson.persistedDurably,
    })),
  };
}, objectiveId);

await browser.close();

const selfDriven = observed.cycles.filter((cycle) => cycle.trigger === "runtime:self-continuation").length;
console.log(JSON.stringify({ surface, model, observed, pageErrors: pageErrors.slice(0, 5) }, null, 2));

const modelAnswered = model.providerCall.answered === true;
console.log(
  `\nAutonomy running at boot: ${surface.autonomyRunningBeforeAnythingElse}` +
    `\nAgent: ${observed.agentName} (${observed.agentId})` +
    `\nObjective: ${observed.objectiveText}` +
    `\nModel route: ${model.routedTo}` +
    `\n  direct from the page: ${model.direct}` +
    `\n  through the broker:   ${model.providerCall.detail}` +
    `\n  request reached the provider: ${model.providerCall.reached}; provider answered: ${modelAnswered}` +
    `\nCycles recorded: ${observed.cycles.length} (self-continued: ${selfDriven})` +
    `\nTransitions: ${[...new Set(observed.stages)].join(", ")}` +
    `\nObjective ended: ${observed.state}${observed.yieldReason ? ` (${observed.yieldReason})` : ""}` +
    `\nLessons: ${observed.lessons.map((l) => `${l.kind}(durable=${l.persistedDurably})`).join(", ") || "none"}` +
    `\nREAL-MODEL COGNITION IN THE BROWSER: ${modelAnswered ? "VERIFIED" : "NOT VERIFIED — no provider answered"}`,
);

const failures = [];
if (!surface.autonomyRunningBeforeAnythingElse) {
  failures.push("booting the application did not start autonomous cognition");
}
if (selfDriven < 1) failures.push("no cycle was started by the runtime itself");
if (!observed.agentId) failures.push("the objective has no owning agent");
if ((observed.cyclesRun ?? 0) < 1) failures.push("no cognition cycle ran");
if (!observed.cycles.every((cycle) => cycle.agentId === observed.agentId)) {
  failures.push("a cycle was recorded against a different agent");
}
for (const stage of ["objective-created", "cycle-started", "context-retrieved", "decision-made", "cycle-completed"]) {
  if (!observed.stages.includes(stage)) failures.push(`the trace has no "${stage}"`);
}
if (observed.state === "active") failures.push("the objective never reached a terminal state");
if (!observed.contextHasRecentPass) failures.push("her own last cognitive pass is not in her context");
// THE BROKER: the page's request has to reach the provider. Whether the
// provider then accepts the credential is a separate fact.
if (!model.routedTo.startsWith("/api/model/")) {
  failures.push(`the browser is not routing through the broker (${model.routedTo})`);
}
if (!model.providerCall.reached) {
  failures.push(`the browser could not reach the provider at all: ${model.providerCall.detail}`);
}

if (failures.length > 0) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
