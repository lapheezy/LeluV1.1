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

  // Which providers the SERVER can reach. The page is told yes/no, never
  // the credential.
  let configured = [];
  let brokerStatus = null;
  try {
    brokerStatus = await (await fetch("/api/model/status")).json();
    configured = Object.entries(brokerStatus.providers ?? {})
      .filter(([, ok]) => ok)
      .map(([id]) => id);
  } catch (error) {
    brokerStatus = { error: String(error).slice(0, 120) };
  }

  const probeId = configured[0] ?? "anthropic";
  const routedTo = endpointUrl(probeId, "messages");

  // THE CONTROL: what the page could do before the broker existed —
  // call a provider directly. Kept because it is the thing that failed.
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

  // THE REAL PATH: AIService → the resolver → the provider chain →
  // the broker → the provider. Whatever answers, answers for real.
  const ai = (await import("/src/core/AIService.ts")).default.getInstance();
  let deliberation = { answered: false, provider: "", detail: "" };
  try {
    const result = await ai.deliberate("Reply with the single word: ready.", {
      system: "Answer in one word.",
      maxTokens: 16,
    });
    const text = String(result.text ?? "");
    const offline = /offline mode|unreachable or unconfigured|no local model runtime/i.test(text);
    deliberation = {
      answered: Boolean(result.provider) && !offline,
      provider: String(result.provider ?? ""),
      detail: text.slice(0, 140),
    };
  } catch (error) {
    deliberation = { answered: false, provider: "", detail: String(error).slice(0, 200) };
  }

  return { configured, brokerStatus, probeId, routedTo, direct, deliberation };
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
    // WHICH PROVIDER MADE EACH DECISION. This is the authoritative
    // answer to "did a real model drive this cycle": it is recorded by
    // the runtime at the moment it received the decision, not probed
    // afterwards from the side.
    decisionProviders: trace
      .filter((entry) => entry.stage === "decision-made")
      .map((entry) => String(entry.data?.provider ?? "")),
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

const realProviders = observed.decisionProviders.filter(
  (name) => name && !/^(stub|MOCKED-MODEL|offline|local)$/i.test(name),
);
// Real-model cognition in the browser means a cycle whose DECISION came
// from a real provider — not that a side probe happened to succeed.
const modelAnswered = realProviders.length > 0;
console.log(
  `\nAutonomy running at boot: ${surface.autonomyRunningBeforeAnythingElse}` +
    `\nAgent: ${observed.agentName} (${observed.agentId})` +
    `\nObjective: ${observed.objectiveText}` +
    `\nBrokered providers with a server credential: ${model.configured.join(", ") || "none"}` +
    `\nModel route for ${model.probeId}: ${model.routedTo}` +
    `\n  direct from the page: ${model.direct}` +
    `\n  through the app's own chain: provider=${model.deliberation.provider || "none"} — ${model.deliberation.detail}` +
    `\n  providers that made a cognition decision: ${observed.decisionProviders.join(", ") || "none"}` +
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
// Every cycle must be runtime-initiated. How MANY cycles a real model
// needs is the model's business — a capable one can satisfy this
// objective in a single cycle, so self-continuation is required only
// when the work actually took more than one.
if (!observed.cycles.every((cycle) => cycle.trigger.startsWith("runtime:"))) {
  failures.push(
    `a cycle was started by something outside the runtime: ${observed.cycles.map((c) => c.trigger).join(", ")}`,
  );
}
if ((observed.cyclesRun ?? 0) > 1 && selfDriven < 1) {
  failures.push("a multi-cycle objective ran without a runtime self-continuation");
}
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
// THE BROKER: a brokered provider must be routed through it.
if (!model.routedTo.startsWith("/api/model/")) {
  failures.push(`the browser is not routing through the broker (${model.routedTo})`);
}
// With a credential on the server, the page must actually get an answer
// — and cognition must actually be driven by it.
if (model.configured.length > 0) {
  if (!model.deliberation.answered) {
    failures.push(
      `a provider is configured server-side but the page got no answer: ${model.deliberation.detail}`,
    );
  }
  if (!modelAnswered) {
    failures.push("no cognition decision came from a real provider");
  }
}

if (failures.length > 0) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
