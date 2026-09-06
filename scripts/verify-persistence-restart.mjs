/**
 * ==========================================================
 * LÉLU — LIVE VERIFICATION: PERSISTENCE ACROSS A REAL RESTART
 *
 * A reload is a real restart: every singleton is destroyed and
 * rebuilt from storage. This script proves what actually
 * survives it, in the real browser runtime, through the real
 * production persistence routes:
 *
 *   • objectives, cycle records, scheduling and approval state
 *     — KvStore → localStorage
 *   • learned lessons — the local index (KvStore) AND long-term
 *     memory (Brain → IndexedDB), which only exists in a browser
 *   • workflows and their execution records — KvStore
 *
 * It also proves the runtime RESUMES: an objective left
 * unfinished before the reload is picked up afterwards by the
 * runtime itself, with a runtime:resumed trigger.
 *
 * Usage: vite on :5199, then
 *        node scripts/verify-persistence-restart.mjs [url]
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

/* ---- set up three kinds of state, then leave them alone ---- */

const created = await page.evaluate(async () => {
  // The self-study loop is a separate engine; parking it keeps this
  // measurement about persistence. The objective runtime keeps running.
  (await import("/src/core/cognition/CognitiveLoop.ts")).default.getInstance().stop();

  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const agents = (await import("/src/core/agents/AgentStore.ts")).default.getInstance();
  const registry = (await import("/src/core/tools/ToolRegistry.ts")).default.getInstance();
  const { dispatchToolCall } = await import("/src/core/tools/ToolDispatcher.ts");
  registry.updateAvailability("project.manage", true);

  const agentId = agents.create({ name: "Persistence check" }).id;
  const stamp = Math.random().toString(36).slice(2, 7);

  const running = objectives.create({
    agentId,
    objective: `PERSIST-${stamp}: unfinished work that must survive a restart`,
    maxCycles: 8,
  });
  const deferred = objectives.create({
    agentId,
    objective: `DEFER-${stamp}: work deliberately postponed`,
  });
  objectives.schedule(deferred.id, Date.now() + 45 * 60_000, "waiting for the inventory to settle");
  const parked = objectives.create({
    agentId,
    objective: `APPROVE-${stamp}: work that needs a person's decision`,
  });
  objectives.requestApproval(parked.id, "may I change the real project?");

  // A deferral that comes due AFTER the restart. Nothing in this script
  // wakes it: if it runs, the rebuilt runtime re-armed it from storage.
  const dueSoon = objectives.create({
    agentId,
    objective: `RESUME-${stamp}: deferred work that must resume after a restart`,
  });
  objectives.schedule(dueSoon.id, Date.now() + 25_000, "resuming shortly");

  const workflowName = `persist-${stamp}`;
  await dispatchToolCall(
    {
      id: "persist-author",
      name: "workflow_author",
      arguments: {
        name: workflowName,
        description: "Authored before a restart, to prove definitions survive one.",
        outputs: "A project listing.",
        steps: [{ id: "a", name: "list", tool: "project.manage", arguments: { action: "list" } }],
      },
    },
    "persistence-check",
  );
  await dispatchToolCall(
    { id: "persist-run", name: "workflow_run", arguments: { workflow: workflowName } },
    "persistence-check",
  );

  return {
    stamp,
    running: running.id,
    deferred: deferred.id,
    parked: parked.id,
    dueSoon: dueSoon.id,
    workflowName,
  };
});

// Let the runtime take at least one cycle on the running objective,
// entirely on its own.
await page.waitForFunction(
  async (id) => {
    const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
    return (objectives.get(id)?.cyclesRun ?? 0) >= 1;
  },
  created.running,
  { timeout: 120_000, polling: 500 },
);

const before = await page.evaluate(async (ids) => {
  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const learning = (await import("/src/core/cognition/ObjectiveLearning.ts")).default.getInstance();
  const running = objectives.get(ids.running);
  const dueSoon = objectives.get(ids.dueSoon);
  return {
    cyclesRun: running?.cyclesRun ?? 0,
    state: running?.state,
    cycleRecords: objectives.cycles(ids.running).length,
    dueSoonState: dueSoon?.state,
    dueSoonResumeAt: dueSoon?.resumeAt,
    dueSoonCycles: objectives.cycles(ids.dueSoon).length,
    lessons: learning.lessons().length,
    localStorageKeys: Object.keys(localStorage).filter((key) => key.startsWith("lelu.")).sort(),
  };
}, created);

/* ---- THE RESTART: every singleton is destroyed here ---- */
await page.reload({ waitUntil: "load", timeout: 120_000 });
// Park self-study again in the rebuilt page, then wait past the
// deferral's due time so the rebuilt runtime has the chance to act.
await page.evaluate(async () => {
  (await import("/src/core/cognition/CognitiveLoop.ts")).default.getInstance().stop();
});
await page.waitForTimeout(35_000);

const after = await page.evaluate(async (ids) => {
  const objectives = (await import("/src/core/cognition/AgentObjectives.ts")).default.getInstance();
  const learning = (await import("/src/core/cognition/ObjectiveLearning.ts")).default.getInstance();
  const workflows = (await import("/src/core/workflows/WorkflowStore.ts")).default.getInstance();
  const ai = (await import("/src/core/AIService.ts")).default.getInstance();
  const cognition = (await import("/src/core/cognition/AgentCognitionRuntime.ts")).default.getInstance();

  const running = objectives.get(ids.running);
  const deferred = objectives.get(ids.deferred);
  const parked = objectives.get(ids.parked);
  const dueSoon = objectives.get(ids.dueSoon);
  const workflow = workflows.list().find((entry) => entry.name === ids.workflowName);

  // Long-term memory lives in IndexedDB and is rebuilt from disk on a
  // fresh page — reading it here is a real round trip through the store.
  let longTermLessons = 0;
  let memoryError = null;
  try {
    const memories = await ai.getMemories(200);
    longTermLessons = memories.filter((entry) =>
      JSON.stringify(entry).includes("LESSON ("),
    ).length;
  } catch (error) {
    memoryError = String(error).slice(0, 200);
  }

  return {
    autonomyRunning: cognition.isRunning(),
    running: running
      ? { state: running.state, cyclesRun: running.cyclesRun, objective: running.objective }
      : null,
    cycleRecords: objectives.cycles(ids.running).length,
    triggers: objectives.cycles(ids.running).map((cycle) => cycle.trigger),
    deferred: deferred ? { state: deferred.state, resumeAt: deferred.resumeAt } : null,
    parked: parked
      ? { state: parked.state, request: parked.approval?.request, requestedAt: parked.approval?.requestedAt }
      : null,
    dueSoon: dueSoon
      ? {
          state: dueSoon.state,
          cyclesRun: dueSoon.cyclesRun,
          objective: dueSoon.objective,
          triggers: objectives.cycles(ids.dueSoon).map((cycle) => cycle.trigger),
        }
      : null,
    workflow: workflow ? { steps: workflow.steps.length } : null,
    workflowRuns: workflow ? workflows.executions(workflow.id).length : 0,
    lessons: learning.lessons().map((lesson) => ({
      kind: lesson.kind,
      confidence: lesson.confidence,
      persistedDurably: lesson.persistedDurably,
    })),
    longTermLessons,
    memoryError,
    indexedDbAvailable: typeof indexedDB !== "undefined",
  };
}, created);

await browser.close();

console.log(JSON.stringify({ created, before, after, pageErrors: pageErrors.slice(0, 5) }, null, 2));

const failures = [];
if (!after.running) failures.push("the unfinished objective did not survive the restart");
if (after.cycleRecords < before.cycleRecords) failures.push("cycle records were lost");
if (after.deferred?.state !== "scheduled" || !after.deferred?.resumeAt) {
  failures.push("the deferred objective lost its scheduled state");
}
if (after.parked?.state !== "awaiting-approval" || !after.parked?.request) {
  failures.push("the approval request did not survive the restart");
}
if (!after.workflow) failures.push("the authored workflow did not survive the restart");
if (after.workflowRuns < 1) failures.push("the workflow execution record was lost");
// CONTINUATION AFTER A RESTART. The deferral was set before the reload
// and came due after it; a cycle for it can only exist because the
// rebuilt runtime read it back from storage and re-armed it.
if ((after.dueSoon?.cyclesRun ?? 0) < 1) {
  failures.push("the deferred objective was not resumed after the restart");
}
if (!(after.dueSoon?.triggers ?? []).some((trigger) => trigger.startsWith("runtime:"))) {
  failures.push("the objective resumed after the restart was not started by the runtime itself");
}
if (!after.autonomyRunning) failures.push("autonomy did not restart with the application");

console.log(
  `\nResumed after restart: ${after.dueSoon?.state} after ${after.dueSoon?.cyclesRun} cycle(s) ` +
    `via ${(after.dueSoon?.triggers ?? []).join(", ") || "nothing"}` +
    `\nRestart survived: objective=${Boolean(after.running)} cycles=${before.cycleRecords}->${after.cycleRecords} ` +
    `deferred=${after.deferred?.state} approval=${after.parked?.state} workflow=${Boolean(after.workflow)}` +
    `\nIndexedDB present: ${after.indexedDbAvailable}; lessons in long-term memory after restart: ${after.longTermLessons}` +
    `${after.memoryError ? ` (read error: ${after.memoryError})` : ""}`,
);

if (failures.length > 0) {
  console.error(`FAIL:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
