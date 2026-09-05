/**
 * ==========================================================
 * LÉLU — CONTINUOUS COGNITION, END TO END
 *
 * CATEGORY: integration, started from the REAL application
 * runtime entry point (LeluRuntime.initialize — the same call
 * GenesisScene makes through useLeluRuntime).
 *
 * WHAT IS REAL HERE: the runtime boot, the objective store and
 * its persistence, the wake conditions, the self-continuation
 * timers, the budgets, the tool dispatcher, the workflow
 * engine, the learning pipeline and every recorded cycle.
 *
 * WHAT IS SUBSTITUTED, AND ONLY THIS (labelled MOCKED-MODEL):
 * the model's CHOICE of action, because no provider key exists
 * in this runtime. The stub does not fabricate results — it
 * dispatches the tool for real through the same ToolDispatcher
 * a native tool call uses, and reports what actually came back.
 * Every "executed" entry below is a tool that really ran.
 *
 * The decisive property this file exists to prove: after the
 * objective is created, THE TEST DOES NOTHING. It never invokes
 * a cycle. Cycles 2, 3 and 4 happen because the runtime starts
 * them itself.
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

import LeluRuntime from "../src/core/runtime/LeluRuntime";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import ObjectiveLearning from "../src/core/cognition/ObjectiveLearning";
import AgentStore from "../src/core/agents/AgentStore";
import AgentEventBus from "../src/core/agent/AgentEvents";
import AIService from "../src/core/AIService";
import KvStore from "../src/core/storage/KvStore";
import WorkflowStore from "../src/core/workflows/WorkflowStore";
import WorkQueue from "../src/core/cognition/WorkQueue";
import SelfStudyEngine from "../src/core/cognition/SelfStudyEngine";
import CognitiveLoop from "../src/core/cognition/CognitiveLoop";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import { dispatchToolCall } from "../src/core/tools/ToolDispatcher";
import {
  buildCognitiveContext,
  formatCognitiveContext,
} from "../src/core/cognition/CognitiveContext";

const objectives = AgentObjectives.getInstance();
const runtime = AgentCognitionRuntime.getInstance();
const kv = KvStore.getInstance();

ToolRegistry.getInstance().updateAvailability("project.manage", true);

/* ------------------------------ helpers ------------------------------ */

type Deliberation = {
  text: string;
  provider: string;
  model: string;
  processingTime: number;
  metadata?: Record<string, unknown>;
};

/**
 * Replace ONLY the model's choice. Everything the choice leads to —
 * dispatch, workflow execution, recording — stays real.
 *
 * Prompts that do not carry this objective's marker belong to some
 * other objective left over from another test; they are answered with a
 * terminal decision so they cannot interfere with the run under test.
 */
function mockModelDecisions(
  marker: string,
  script: (cycle: number, prompt: string) => Promise<Deliberation>,
): { restore: () => void; prompts: string[] } {
  const ai = AIService.getInstance() as unknown as { deliberate: unknown };
  const original = ai.deliberate;
  const prompts: string[] = [];
  // Counted PER OBJECTIVE: two objectives running at once each get their
  // own cycle 1, exactly as the runtime treats them.
  const counts = new Map<string, number>();
  ai.deliberate = async (prompt: string) => {
    if (!prompt.includes(marker)) {
      return { text: "DONE: not part of this test.", provider: "MOCKED-MODEL", model: "stub", processingTime: 0 };
    }
    const key = prompt.match(/^OBJECTIVE: (.*)$/m)?.[1] ?? "unknown";
    const cycle = (counts.get(key) ?? 0) + 1;
    counts.set(key, cycle);
    prompts.push(prompt);
    return script(cycle, prompt);
  };
  return { restore: () => { ai.deliberate = original; }, prompts };
}

/** A real tool call, reported exactly as the tool loop would report it. */
async function reallyExecute(
  name: string,
  args: Record<string, unknown>,
  text: string,
): Promise<Deliberation> {
  const result = await dispatchToolCall(
    { id: `e2e-${name}-${Date.now()}`, name, arguments: args },
    "e2e-autonomy",
  );
  return {
    text: `${text}\n${result.content.slice(0, 400)}`,
    provider: "MOCKED-MODEL",
    model: "stub",
    processingTime: 1,
    metadata: { toolsExecuted: [{ tool: name, ok: result.ok }] },
  };
}

async function waitUntil(
  condition: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for: ${what}`);
}

const rest = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Park the SELF-STUDY loop and wait until it is really idle.
 *
 * Booting LÉLU starts two independent things: the objective runtime
 * this file is about, and the self-study loop, which is a separate,
 * network-bound engine that generates its own questions. Only the first
 * is under test here. The second would keep running cycles underneath
 * every assertion below — and, being slower than this file, underneath
 * whatever runs next — so it is stopped as soon as its having started
 * has been observed. The autonomous objective runtime is untouched and
 * keeps running: nothing this file proves depends on stopping it.
 */
async function quiesceSelfStudy(): Promise<void> {
  CognitiveLoop.getInstance().stop();
  const study = SelfStudyEngine.getInstance();
  const queue = WorkQueue.getInstance();
  const deadline = Date.now() + 120_000;
  while (study.isBusy() && Date.now() < deadline) await rest(250);
  for (const item of queue.list()) queue.remove(item.id);
}

/** Nothing from one test may keep cycling during the next. */
function cancelEverything(): void {
  for (const objective of objectives.list()) {
    if (["active", "waiting", "scheduled", "awaiting-approval"].includes(objective.state)) {
      objectives.yieldObjective(objective.id, "cancelled", "cleaned up by the test");
    }
  }
}

/* ====================================================================
 * §1 — THE PRODUCTION RUNTIME OWNS AUTONOMY
 * ==================================================================== */

test("autonomy starts with the real application runtime, not with a developer calling start()", async () => {
  assert.equal(runtime.isRunning(), false, "the cognition runtime was already running before boot");

  // The same entry point GenesisScene reaches through useLeluRuntime.
  await LeluRuntime.getInstance().initialize();

  assert.equal(
    runtime.isRunning(),
    true,
    "booting LÉLU did not start autonomous cognition",
  );

  // The fact under test is now established. Park the unrelated
  // self-study loop so the rest of this file measures one thing.
  await quiesceSelfStudy();
  assert.equal(runtime.isRunning(), true, "parking self-study stopped the objective runtime");
});

/* ====================================================================
 * §11 — THE HARD END-TO-END TEST
 * ==================================================================== */

test("a multi-cycle objective runs to completion with nothing driving it but the runtime", { timeout: 180_000 }, async () => {
  cancelEverything();
  const agentId = AgentStore.getInstance().create({
    name: "Autonomy E2E",
    role: "Works objectives without a user watching",
  }).id;

  const marker = `E2E-${Math.random().toString(36).slice(2, 8)}`;
  const workflowName = `${marker} routine`;

  // Every real tool result the dispatcher emits during this run, so the
  // cycle records can be checked against what actually happened rather
  // than against what the cycle said happened.
  const realToolEvents: string[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type === "tool_result" && event.tool && event.tool !== "cognition.cycle") {
      realToolEvents.push(event.tool);
    }
  });

  const { restore, prompts } = mockModelDecisions(marker, async (cycle) => {
    if (cycle === 1) {
      return reallyExecute("workflow_list", {}, "Looking at what reusable procedures already exist.");
    }
    if (cycle === 2) {
      return reallyExecute(
        "workflow_author",
        {
          name: workflowName,
          description: "Take a project inventory, then confirm it, as a repeatable procedure.",
          outputs: "A confirmed listing of the projects that exist.",
          steps: [
            { id: "inventory", name: "take inventory", tool: "project.manage", arguments: { action: "list" } },
            {
              id: "confirm",
              name: "confirm the inventory",
              tool: "project.manage",
              arguments: { action: "list" },
              dependsOn: ["inventory"],
              condition: { step: "inventory", operator: "succeeded" },
              retry: { maxAttempts: 2 },
            },
          ],
        },
        "No procedure covers this, so I am writing one.",
      );
    }
    if (cycle === 3) {
      return reallyExecute(
        "workflow_run",
        { workflow: workflowName, reason: "Executing the procedure I just wrote." },
        "Running the procedure.",
      );
    }
    return {
      text: `DONE: the ${workflowName} procedure exists and ran successfully.`,
      provider: "MOCKED-MODEL",
      model: "stub",
      processingTime: 1,
      metadata: { toolsExecuted: [] },
    };
  });

  const objective = objectives.create({
    agentId,
    objective:
      `${marker}: find out whether a reusable procedure covers taking a project inventory, ` +
      `create one if it does not, and run it.`,
    source: "user",
  });

  /* ---------- FROM HERE THE TEST DOES NOTHING AT ALL ---------- */
  await waitUntil(
    () => {
      const current = objectives.get(objective.id);
      return current !== undefined && current.state !== "active";
    },
    120_000,
    "the objective to reach a terminal state on its own",
  );
  // Give a stray continuation a chance to misbehave, so the "no cycles
  // after completion" assertion below means something.
  await rest(2_500);
  restore();
  unsubscribe();

  const finished = objectives.get(objective.id)!;
  const cycles = objectives.cycles(objective.id).slice().reverse();

  /* 1. the objective really completed, on its own terms */
  assert.equal(finished.state, "completed", `ended as ${finished.state}: ${finished.conclusion}`);
  assert.match(String(finished.conclusion), new RegExp(workflowName));

  /* 2. it took several cycles */
  assert.ok(cycles.length >= 4, `expected at least 4 cycles, got ${cycles.length}`);

  /* 3. the FIRST cycle was started by the runtime because an objective
   *    appeared — not by the test, and not by an unrelated event. */
  assert.equal(cycles[0].trigger, "runtime:objective-created", `first trigger was ${cycles[0].trigger}`);

  /* 4. THE DECISIVE POINT: later cycles were started by the runtime
   *    itself. Nothing in this test invoked a cycle. */
  const selfDriven = cycles.filter((cycle) => cycle.trigger === "runtime:self-continuation");
  assert.ok(
    selfDriven.length >= 2,
    `only ${selfDriven.length} cycle(s) were self-continued: ${cycles.map((c) => c.trigger).join(", ")}`,
  );

  /* 5. each working cycle really executed a tool, and every tool it
   *    claims appears in the dispatcher's own event stream */
  const claimed = cycles.flatMap((cycle) => cycle.executed.map((entry) => entry.tool));
  assert.ok(claimed.length >= 3, `only ${claimed.length} action(s) were taken`);
  for (const tool of claimed) {
    assert.ok(
      realToolEvents.some((real) => real.replace(/\./g, "_") === tool.replace(/\./g, "_")),
      `cycle claimed "${tool}" but the dispatcher never ran it`,
    );
  }
  assert.ok(cycles.every((cycle) => cycle.executed.every((entry) => entry.ok)), "a claimed action had failed");

  /* 6. LÉLU wrote a workflow during the run, and it is real */
  const authored = WorkflowStore.getInstance().list().find((entry) => entry.name === workflowName);
  assert.ok(authored, "the objective never actually authored the workflow");
  assert.equal(authored.steps.length, 2);
  assert.equal(authored.steps[1].condition?.operator, "succeeded", "the authored branch condition was lost");

  /* 7. and then really ran it, through the real engine */
  const execution = WorkflowStore.getInstance().executions(authored.id)[0];
  assert.ok(execution, "the authored workflow was never executed");
  assert.equal(execution.status, "succeeded", execution.summary);
  assert.ok(execution.finalResult, "the workflow run produced no real output");
  assert.equal(execution.steps.filter((step) => step.status === "succeeded").length, 2);

  /* 8. each cycle observed the real work of the ones before it */
  assert.match(prompts[2], /WORK SO FAR/);
  assert.match(prompts[2], /workflow_list/, "cycle 3 could not see cycle 1's action");
  assert.match(prompts[2], /workflow_author/, "cycle 3 could not see cycle 2's action");

  /* 9. the counters describe what really happened */
  assert.equal(finished.cyclesRun, cycles.length, "cyclesRun disagrees with the cycle records");
  assert.equal(finished.actionsTaken, claimed.length, "actionsTaken disagrees with the actions");

  /* 10. everything is persisted through the existing store, so a reader
   *     (or a restart) can reconstruct the run */
  const persisted = kv.get<Array<{ objectiveId: string }>>("lelu.agent.cognition.cycles.v1") ?? [];
  assert.equal(
    persisted.filter((record) => record.objectiveId === objective.id).length,
    cycles.length,
    "cycles were not persisted through KvStore",
  );

  /* 11. the runtime stopped when the objective did */
  assert.equal(
    objectives.cycles(objective.id).length,
    cycles.length,
    "a cycle ran after the objective was already complete",
  );

  /* 12. and it learned something durable from the run */
  const lessons = ObjectiveLearning.getInstance().relevantTo(finished.objective, 5);
  assert.ok(lessons.length > 0, "the completed objective produced no lesson");
  assert.ok(
    lessons.some((lesson) => lesson.confidence > 0),
    "a lesson was recorded with no confidence at all",
  );
});

/* ====================================================================
 * §3 — LEARNING REACHES THE NEXT DECISION
 * ==================================================================== */

test("what an earlier objective learned is put in front of the next one before it plans", { timeout: 60_000 }, async () => {
  cancelEverything();
  const agentId = AgentStore.getInstance().create({ name: "Learning" }).id;
  const marker = `LEARN-${Math.random().toString(36).slice(2, 8)}`;
  const topic = `${marker} inventory of projects`;

  // A REAL lesson, written through the real learning pipeline from a
  // real (yielded) objective — not injected into a fixture.
  const failed = objectives.create({ agentId, objective: topic });
  objectives.recordCycle({
    cycleId: crypto.randomUUID(),
    agentId,
    objectiveId: failed.id,
    trigger: "test:seed",
    startedAt: Date.now(),
    finishedAt: Date.now(),
    decision: "Tried to write to long-term memory first.",
    executed: [{ tool: "memory.store", ok: false }],
    nextState: "yielded",
    yieldReason: "repeated-failure",
  });
  objectives.yieldObjective(failed.id, "repeated-failure", "memory.store is unavailable here");
  await ObjectiveLearning.getInstance().extract(objectives.get(failed.id)!, objectives.cycles(failed.id));

  const guidance = ObjectiveLearning.getInstance().guidanceFor(topic);
  assert.ok(guidance, "nothing was learned from a real failed objective");
  assert.match(guidance, /memory\.store/, "the lesson does not name what actually failed");

  // The next objective on the same topic must SEE it before deciding.
  const { restore, prompts } = mockModelDecisions(marker, async () => ({
    text: "DONE: nothing further needed.",
    provider: "MOCKED-MODEL",
    model: "stub",
    processingTime: 0,
    metadata: { toolsExecuted: [] },
  }));
  const next = objectives.create({ agentId, objective: `${topic} again` });
  await waitUntil(
    () => objectives.get(next.id)?.state !== "active",
    30_000,
    "the follow-up objective to run",
  );
  restore();

  assert.ok(prompts.length > 0, "the follow-up objective never ran a cycle");
  assert.match(prompts[0], /memory\.store/, "prior learning did not reach the planning prompt");
});

/* ====================================================================
 * §6 — SCHEDULING AND APPROVAL ARE RUNTIME STATE
 * ==================================================================== */

test("a deferred objective resumes on its own when the time comes", { timeout: 60_000 }, async () => {
  cancelEverything();
  const agentId = AgentStore.getInstance().create({ name: "Scheduling" }).id;
  const marker = `SCHED-${Math.random().toString(36).slice(2, 8)}`;

  let seen = 0;
  const { restore } = mockModelDecisions(marker, async (cycle) => {
    seen = cycle;
    if (cycle === 1) {
      return {
        text: "SCHEDULE: nothing to do until the inventory settles; back in 1 min.",
        provider: "MOCKED-MODEL",
        model: "stub",
        processingTime: 0,
        metadata: { toolsExecuted: [] },
      };
    }
    return {
      text: "DONE: resumed and finished.",
      provider: "MOCKED-MODEL",
      model: "stub",
      processingTime: 0,
      metadata: { toolsExecuted: [] },
    };
  });

  const objective = objectives.create({ agentId, objective: `${marker}: defer then finish` });
  await waitUntil(() => objectives.get(objective.id)?.state === "scheduled", 30_000, "the objective to be deferred");

  const deferred = objectives.get(objective.id)!;
  assert.ok(deferred.resumeAt && deferred.resumeAt > Date.now(), "no real resume time was stored");
  // Persisted, so the deferral survives a reload rather than being a
  // sentence in a chat log.
  const stored = (kv.get<Array<{ id: string; resumeAt?: number }>>("lelu.agent.objectives.v1") ?? [])
    .find((entry) => entry.id === objective.id);
  assert.equal(stored?.resumeAt, deferred.resumeAt);

  // Bring the deferral forward — the same state change a passing minute
  // would make — and let the runtime notice it by itself.
  objectives.update(objective.id, { resumeAt: Date.now() - 1 });
  await waitUntil(() => objectives.get(objective.id)?.state === "completed", 30_000, "the deferral to resume");
  restore();

  assert.ok(seen >= 2, "the objective never ran a second cycle after resuming");
  const triggers = objectives.cycles(objective.id).map((cycle) => cycle.trigger);
  assert.ok(
    triggers.some((trigger) => trigger.startsWith("runtime:")),
    `no runtime-initiated cycle: ${triggers.join(", ")}`,
  );
});

test("an objective awaiting approval does nothing until a person decides, and refusal is not completion", { timeout: 60_000 }, async () => {
  cancelEverything();
  const agentId = AgentStore.getInstance().create({ name: "Approval" }).id;
  const marker = `APPR-${Math.random().toString(36).slice(2, 8)}`;

  const { restore } = mockModelDecisions(marker, async (cycle) =>
    cycle === 1
      ? {
          text: "APPROVAL: this would change the real project — may I proceed?",
          provider: "MOCKED-MODEL",
          model: "stub",
          processingTime: 0,
          metadata: { toolsExecuted: [] },
        }
      : {
          text: "DONE: proceeded after approval.",
          provider: "MOCKED-MODEL",
          model: "stub",
          processingTime: 0,
          metadata: { toolsExecuted: [] },
        },
  );

  const refused = objectives.create({ agentId, objective: `${marker}: needs a decision` });
  await waitUntil(
    () => objectives.get(refused.id)?.state === "awaiting-approval",
    30_000,
    "the objective to ask for approval",
  );

  const asked = objectives.get(refused.id)!;
  assert.match(String(asked.approval?.request), /may I proceed/);
  const cyclesAtAsk = objectives.cycles(refused.id).length;

  // Waiting on a person means waiting: no further cycles happen.
  await rest(4_000);
  assert.equal(objectives.cycles(refused.id).length, cyclesAtAsk, "it kept working while awaiting approval");

  objectives.decideApproval(refused.id, false, "the user");
  const decided = objectives.get(refused.id)!;
  assert.equal(decided.state, "yielded", "a refused objective must never be recorded as completed");
  assert.equal(decided.yieldReason, "cancelled");
  assert.equal(decided.approval?.granted, false);
  assert.equal(decided.approval?.decidedBy, "the user");

  // Granting resumes the work, and the runtime picks it up unaided.
  const granted = objectives.create({ agentId, objective: `${marker}: needs a decision, granted` });
  await waitUntil(
    () => objectives.get(granted.id)?.state === "awaiting-approval",
    30_000,
    "the second objective to ask for approval",
  );
  objectives.decideApproval(granted.id, true, "the user");
  await waitUntil(
    () => objectives.get(granted.id)?.state === "completed",
    30_000,
    "the approved objective to resume and finish",
  );
  restore();
});

/* ====================================================================
 * §11 (16) — A RESTART RESUMES UNFINISHED WORK
 * ==================================================================== */

test("restarting the runtime resumes an objective that was left unfinished", { timeout: 60_000 }, async () => {
  cancelEverything();
  const agentId = AgentStore.getInstance().create({ name: "Restart" }).id;
  const marker = `RESTART-${Math.random().toString(36).slice(2, 8)}`;

  let calls = 0;
  const { restore } = mockModelDecisions(marker, async (cycle) => {
    calls = cycle;
    return cycle >= 2
      ? {
          text: "DONE: finished after the restart.",
          provider: "MOCKED-MODEL",
          model: "stub",
          processingTime: 0,
          metadata: { toolsExecuted: [] },
        }
      : reallyExecute("workflow_list", {}, "First step, before the restart.");
  });

  const objective = objectives.create({ agentId, objective: `${marker}: survive a restart` });
  await waitUntil(() => objectives.get(objective.id)!.cyclesRun >= 1, 30_000, "the first cycle");

  // A real teardown: every pending continuation timer is dropped.
  LeluRuntime.getInstance().shutdown();
  assert.equal(runtime.isRunning(), false);
  const cyclesAtShutdown = objectives.cycles(objective.id).length;
  await rest(3_000);
  assert.equal(
    objectives.cycles(objective.id).length,
    cyclesAtShutdown,
    "a cycle ran after the runtime was shut down",
  );
  assert.equal(objectives.get(objective.id)?.state, "active", "the unfinished objective was lost");

  // Boot again — the same production entry point — and the objective is
  // picked up from persistence without anyone re-submitting it.
  await LeluRuntime.getInstance().initialize();
  await quiesceSelfStudy();
  await waitUntil(
    () => objectives.get(objective.id)?.state === "completed",
    30_000,
    "the restarted runtime to finish the objective",
  );
  restore();

  assert.ok(calls >= 2, "the objective did not continue after the restart");
  const triggers = objectives.cycles(objective.id).map((cycle) => cycle.trigger);
  assert.ok(
    triggers.includes("runtime:resumed"),
    `the restart did not resume the objective: ${triggers.join(", ")}`,
  );
});

/* ====================================================================
 * §7 — LÉLU KNOWS WHAT SHE IS DOING, AND SAYS IT TRUTHFULLY
 * ==================================================================== */

test("her own autonomous work reaches the cognitive context as recorded state", () => {
  cancelEverything();
  const agentId = AgentStore.getInstance().create({ name: "Awareness" }).id;

  const live = objectives.create({ agentId, objective: "AWARE-live: an objective in progress" });
  const parked = objectives.create({ agentId, objective: "AWARE-parked: an objective needing a decision" });
  objectives.requestApproval(parked.id, "may I change the real project?");
  const stopped = objectives.create({ agentId, objective: "AWARE-stopped: an objective that ran out" });
  objectives.yieldObjective(stopped.id, "cycle-budget-exhausted", "It was NOT completed.");

  const text = formatCognitiveContext(buildCognitiveContext());

  assert.match(text, /## YOUR OWN AUTONOMOUS WORK/);
  assert.match(text, /AWARE-live/, "an active objective is missing from her own context");
  assert.match(text, /may I change the real project\?/, "a pending approval is invisible to her");
  // The distinction that matters: a yielded objective must not read as done.
  assert.match(text, /\[yielded: cycle-budget-exhausted\] AWARE-stopped/);

  objectives.yieldObjective(live.id, "cancelled", "cleaned up by the test");
});

test("teardown leaves nothing running", async () => {
  cancelEverything();
  LeluRuntime.getInstance().shutdown();
  assert.equal(runtime.isRunning(), false);

  // Booting the real runtime also starts the cognitive loop, which
  // queues real work. Left behind, it becomes another test's starting
  // state — this file booted LÉLU, so this file puts the queue back.
  //
  // Stopping a loop does not un-run the cycle already inside it, and a
  // cycle still in flight would go on advancing cognition — and the
  // next test file's starting state — after this file finished. Wait
  // for real quiescence, then leave the shared buffers as they were
  // found: this file booted LÉLU, so this file cleans up after her.
  await quiesceSelfStudy();
  const study = SelfStudyEngine.getInstance();
  assert.equal(study.isBusy(), false, "a self-study cycle was still running after shutdown");
  assert.equal(WorkQueue.getInstance().list().length, 0);
});
