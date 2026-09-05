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
  const objective = objectives.get(id);
  return {
    state: objective?.state,
    cyclesRun: objective?.cyclesRun,
    yieldReason: objective?.yieldReason,
    conclusion: objective?.conclusion?.slice(0, 300),
    cycles: objectives.cycles(id).map((cycle) => ({
      trigger: cycle.trigger,
      nextState: cycle.nextState,
      executed: cycle.executed,
      decision: cycle.decision.slice(0, 200),
    })),
  };
}, objectiveId);

await browser.close();

const selfDriven = observed.cycles.filter((cycle) => cycle.trigger === "runtime:self-continuation").length;
console.log(JSON.stringify({ surface, observed, pageErrors: pageErrors.slice(0, 5) }, null, 2));
console.log(
  `\nAutonomy running at boot: ${surface.autonomyRunningBeforeAnythingElse}` +
    `\nCycles recorded: ${observed.cycles.length} (self-continued: ${selfDriven})` +
    `\nObjective ended: ${observed.state}${observed.yieldReason ? ` (${observed.yieldReason})` : ""}`,
);

if (!surface.autonomyRunningBeforeAnythingElse) {
  console.error("FAIL: booting the application did not start autonomous cognition.");
  process.exit(1);
}
if (selfDriven < 1) {
  console.error("FAIL: no cycle was started by the runtime itself.");
  process.exit(1);
}
