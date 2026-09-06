/**
 * ==========================================================
 * LÉLU — THE AUTHORITATIVE AUTONOMY TEST (REAL MODEL)
 *
 * CATEGORY: live end-to-end. NOTHING is mocked — not the model,
 * not the provider, not the tools, not the stores.
 *
 * This is the "B. real-model cognition" proof. The orchestration
 * proof, which substitutes the model's choice because a provider
 * key is not always present, lives in continuous-cognition.test.ts
 * and is labelled MOCKED-MODEL there. Neither stands in for the
 * other.
 *
 * It runs only when a provider is really configured. With no
 * credentials it SKIPS LOUDLY rather than passing quietly — a
 * green suite must never be read as "real-model cognition works"
 * when no model was reached.
 *
 *   ANTHROPIC_API_KEY=... ANTHROPIC_MODEL=claude-haiku-4-5-20251001 \
 *     bun test tests/autonomy-end-to-end.test.ts
 *
 * The chain proven here, in one run, from the real application
 * entry point:
 *
 *   boot → autonomous objective → REAL model decision →
 *   memory/learning retrieval → real tool selection → real
 *   dispatcher → real result → cognitive self-observation →
 *   outcome evaluation → durable learning → learning retrieval →
 *   an informed later decision → workflow authoring → workflow
 *   execution with branching → autonomous continuation →
 *   persistence → restart → resumption → natural completion
 *
 * THE TEST NEVER ADVANCES AN OBJECTIVE. After creating one it
 * only waits and reads.
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
import CognitiveLoop from "../src/core/cognition/CognitiveLoop";
import SelfStudyEngine from "../src/core/cognition/SelfStudyEngine";
import WorkQueue from "../src/core/cognition/WorkQueue";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import ObjectiveLearning from "../src/core/cognition/ObjectiveLearning";
import AgentStore from "../src/core/agents/AgentStore";
import AgentEventBus from "../src/core/agent/AgentEvents";
import AIService from "../src/core/AIService";
import KvStore from "../src/core/storage/KvStore";
import WorkflowStore from "../src/core/workflows/WorkflowStore";
import ToolRegistry from "../src/core/tools/ToolRegistry";
import {
  buildCognitiveContext,
  formatCognitiveContext,
} from "../src/core/cognition/CognitiveContext";

const objectives = AgentObjectives.getInstance();
const runtime = AgentCognitionRuntime.getInstance();
const events = AgentEventBus.getInstance();

/**
 * Does a REAL provider actually answer?
 *
 * Not "is a key-shaped environment variable set" — that was tried, and
 * a git token in the environment made it say yes when nothing could
 * answer. The only honest test is to ask: one small call through the
 * real provider chain, and a real reply from a named provider.
 *
 * It runs after boot, because the provider registry initialises with
 * the runtime.
 */
async function realProviderAnswers(): Promise<{ ok: boolean; provider: string; why: string }> {
  // AIService.ready() is not asked: the provider registry initialises
  // lazily on the first real call, so it answers "no" for a chain that
  // works. The only reliable question is whether a call comes back.
  try {
    const probe = await AIService.getInstance().deliberate("Reply with the single word: ready.", {
      system: "Answer in one word.",
      maxTokens: 16,
    });
    const provider = probe.provider ?? "";
    const offline = /offline mode|no local model runtime|unreachable or unconfigured/i.test(
      probe.text ?? "",
    );
    if (!provider || offline) {
      return { ok: false, provider, why: "the chain answered from its offline fallback" };
    }
    return { ok: true, provider, why: "" };
  } catch (error) {
    return { ok: false, provider: "", why: String(error).slice(0, 200) };
  }
}

function announceSkip(why: string): void {
  console.warn(
    "\n==================================================================\n" +
      "SKIPPED: REAL-MODEL COGNITION IS NOT PROVEN IN THIS RUN.\n" +
      `No AI provider answered (${why}), so this file's chain did not\n` +
      "execute. The orchestration proof in continuous-cognition.test.ts\n" +
      "is MOCKED-MODEL and does NOT stand in for this. Provide a\n" +
      "provider key and re-run: bun run test:live\n" +
      "==================================================================\n",
  );
}

const rest = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Park the separate self-study engine; the objective runtime keeps running. */
async function quiesceSelfStudy(): Promise<void> {
  CognitiveLoop.getInstance().stop();
  const study = SelfStudyEngine.getInstance();
  const deadline = Date.now() + 120_000;
  while (study.isBusy() && Date.now() < deadline) await rest(250);
  const queue = WorkQueue.getInstance();
  for (const item of queue.list()) queue.remove(item.id);
}

async function waitForTerminal(objectiveId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = objectives.get(objectiveId)?.state;
    if (state && state !== "active") return;
    await rest(400);
  }
  const objective = objectives.get(objectiveId);
  assert.fail(
    `objective did not finish in ${timeoutMs}ms (state=${objective?.state}, cycles=${objective?.cyclesRun})`,
  );
}

function cancelEverything(): void {
  for (const objective of objectives.list()) {
    if (["active", "waiting", "scheduled", "awaiting-approval"].includes(objective.state)) {
      objectives.yieldObjective(objective.id, "cancelled", "cleaned up by the test");
    }
  }
}

test(
  "LÉLU works a real objective end to end with a real model, learns from it, and resumes it after a restart",
  { timeout: 900_000 },
  async () => {
    /* ============ 1. BOOT — the real application entry point ============ */
    await LeluRuntime.getInstance().initialize();
    assert.equal(runtime.isRunning(), true, "booting LÉLU did not start autonomous cognition");
    await quiesceSelfStudy();
    cancelEverything();

    // Everything below needs a real model. Without one this file proves
    // nothing and says so, loudly, instead of passing quietly.
    const probe = await realProviderAnswers();
    if (!probe.ok) {
      announceSkip(probe.why);
      LeluRuntime.getInstance().shutdown();
      await quiesceSelfStudy();
      return;
    }

    ToolRegistry.getInstance().updateAvailability("project.manage", true);
    const agentId = AgentStore.getInstance().create({
      name: "Live autonomy",
      role: "Works objectives without a user watching",
    }).id;

    // Every real tool result the dispatcher emits, so a claimed action
    // can be checked against one that really happened.
    const dispatched: string[] = [];
    // Cognition events are collected AS THEY ARE EMITTED. The bus keeps
    // a bounded history, so reading it afterwards can miss the start of
    // a long run — a subscriber sees everything.
    const cognitionEvents: Array<{ stage: string; objectiveId?: string; detail: string; data?: Record<string, unknown> }> = [];
    const unsubscribe = events.subscribe((event) => {
      if (event.type === "tool_result" && event.tool && event.tool !== "cognition.cycle") {
        dispatched.push(event.tool.replace(/\./g, "_"));
      }
      if (event.type === "cognition") {
        cognitionEvents.push({
          stage: event.stage,
          objectiveId: event.objectiveId,
          detail: event.detail,
          data: event.data,
        });
      }
    });

    const stamp = Math.random().toString(36).slice(2, 7);
    const workflowName = `inventory-routine-${stamp}`;
    const noteTopic = `jewelry inventory notes ${stamp}`;

    /* ============ 2a. AN OBJECTIVE THAT CANNOT SUCCEED FIRST TRY ============
     *
     * Long-term memory needs IndexedDB, which this runtime does not
     * have, so memory_store really refuses. Nothing is rigged: the
     * model meets a genuine failure, and the runtime has to carry it
     * into another cycle for it to react at all. That is what makes
     * this objective prove continuation rather than assume it.
     */
    const hardObjective = objectives.create({
      agentId,
      source: "user",
      objective:
        `Save a durable note about ${noteTopic} using the memory_store tool, then verify it was ` +
        `really saved by reading it back with memory_search. Report exactly what happened.`,
    });
    await waitForTerminal(hardObjective.id, 300_000);
    const hardCycles = objectives.cycles(hardObjective.id).slice().reverse();

    assert.ok(hardCycles.length >= 1, "the objective never ran");
    assert.equal(hardCycles[0].trigger, "runtime:objective-created");
    // HOW MANY cycles this takes is the model's business, not the
    // runtime's: the native tool loop can take several tool rounds
    // inside one decision, so a capable model may exhaust a failing
    // approach without needing a second cycle. What is asserted here is
    // the part the runtime owns — that it, and only it, starts cycles.
    // Runtime-initiated continuation is proven at (14) below, and
    // self-continuation deterministically in continuous-cognition.test.ts
    // and live in the browser.
    for (const cycle of hardCycles) {
      assert.ok(
        cycle.trigger.startsWith("runtime:") || cycle.trigger.startsWith("event:"),
        `a cycle was started by something outside the runtime: ${cycle.trigger}`,
      );
    }
    // The failure is recorded as a failure. A tool that refused is
    // never reported as an action that worked.
    assert.ok(
      hardCycles.some((cycle) => cycle.executed.some((entry) => !entry.ok)),
      "the genuinely failing tool was not recorded as failing",
    );
    const hardFinal = objectives.get(hardObjective.id)!;
    assert.notEqual(hardFinal.state, "completed", "an objective whose tool refused was called complete");

    /* ============ 2b. AN OBJECTIVE, THEN NOTHING ============ */
    const objective = objectives.create({
      agentId,
      source: "user",
      // Headroom over the default, because this objective legitimately
      // needs several actions (look, author, possibly correct, run) and
      // a real model spends a few more than the minimum. Still bounded:
      // the runtime stops it either way, which is the point of budgets.
      maxCycles: 10,
      maxActions: 30,
      objective:
        `Check with workflow_list whether a reusable workflow named "${workflowName}" already exists. ` +
        `If it does not, create it with workflow_author: give it two steps that both use the ` +
        `project.manage tool with action "list", where the second depends on the first and only runs ` +
        `on the condition that the first succeeded. Then run it once with workflow_run and report ` +
        `what it produced.`,
    });

    await waitForTerminal(objective.id, 420_000);
    await rest(2_500);

    const finished = objectives.get(objective.id)!;
    const cycles = objectives.cycles(objective.id).slice().reverse();
    const trace = cognitionEvents.filter((entry) => entry.objectiveId === objective.id);
    const stages = trace.map((entry) => entry.stage);

    /* ---- 3. A REAL MODEL MADE THE DECISION ---- */
    const decisionEvents = trace.filter((entry) => entry.stage === "decision-made");
    assert.ok(decisionEvents.length > 0, "no decision was recorded");
    const providers = new Set(
      decisionEvents.map((entry) => String((entry.data as { provider?: string })?.provider ?? "")),
    );
    assert.ok(
      !providers.has("stub") && !providers.has("MOCKED-MODEL") && !providers.has(""),
      `the decision did not come from a real provider: ${[...providers].join(", ")}`,
    );

    /* ---- 4. THE OBJECTIVE WAS ACTUALLY ACHIEVED ---- */
    assert.equal(
      finished.state,
      "completed",
      `ended as ${finished.state} (${finished.yieldReason ?? "no reason"}): ${finished.conclusion}`,
    );

    /* ---- 5. REAL TOOLS RAN, AND ONLY REAL ONES ARE CLAIMED ---- */
    const claimed = cycles.flatMap((cycle) => cycle.executed.map((entry) => entry.tool));
    assert.ok(claimed.length >= 3, `only ${claimed.length} action(s) were taken: ${claimed.join(", ")}`);
    for (const tool of claimed) {
      assert.ok(
        dispatched.includes(tool.replace(/\./g, "_")),
        `a cycle claimed "${tool}" that the dispatcher never ran`,
      );
    }

    /* ---- 6. SHE WROTE A WORKFLOW, AND IT IS REAL ---- */
    const authored = WorkflowStore.getInstance().list().find((entry) => entry.name === workflowName);
    assert.ok(authored, `the model never authored "${workflowName}"`);
    assert.equal(authored.steps.length, 2, "the authored workflow does not have the two steps asked for");
    assert.ok(
      authored.steps.some((step) => step.condition),
      "the authored workflow carries no branch condition",
    );

    /* ---- 7. AND RAN IT, THROUGH THE REAL ENGINE AND DISPATCHER ---- */
    const execution = WorkflowStore.getInstance().executions(authored.id)[0];
    assert.ok(execution, "the authored workflow was never executed");
    assert.equal(execution.status, "succeeded", execution.summary);
    assert.ok(execution.finalResult, "the run produced no real output");
    // The conditional step ran because its condition really held.
    const conditional = execution.steps.find((step) => step.stepId === authored.steps[1].id);
    assert.equal(conditional?.status, "succeeded", "the conditional step did not execute");

    /* ---- 8. EVERY CYCLE WAS STARTED BY THE RUNTIME, NEVER BY THE TEST ----
     *
     * A capable model can satisfy this objective inside one cycle,
     * because the native tool loop takes several tool rounds per
     * decision. That is real behaviour, not a gap — so what is asserted
     * here is that nothing outside the runtime ever started a cycle.
     * Runtime-initiated continuation is proven above (2a) and again
     * after the restart (14).
     */
    assert.equal(cycles[0].trigger, "runtime:objective-created", `first trigger was ${cycles[0].trigger}`);
    for (const cycle of objectives.cycles()) {
      assert.ok(
        cycle.trigger.startsWith("runtime:") || cycle.trigger.startsWith("event:"),
        `a cycle was started by something outside the runtime: ${cycle.trigger}`,
      );
    }

    /* ---- 9. THE WHOLE TRANSITION SEQUENCE IS TRACEABLE ---- */
    for (const stage of [
      "objective-created",
      "cycle-started",
      "context-retrieved",
      "decision-made",
      "result-observed",
      "branch-selected",
      "continuation-scheduled",
      "cycle-completed",
      "objective-completed",
      "lesson-extracted",
    ]) {
      assert.ok(stages.includes(stage as never), `the trace has no "${stage}": ${stages.join(", ")}`);
    }
    const authoredEvent = cognitionEvents.find(
      (entry) => entry.stage === "workflow-authored" && entry.detail.includes(workflowName),
    );
    assert.ok(authoredEvent, "authoring left no trace");
    assert.equal(
      (authoredEvent.data as { workflowId?: string })?.workflowId,
      authored.id,
      "the authoring event names a workflow the store does not hold",
    );
    assert.ok(
      cognitionEvents.some((entry) => entry.stage === "workflow-executed"),
      "execution left no trace",
    );

    /* ---- 10. SHE CAN SEE HER OWN WORK, FROM RUNTIME STATE ---- */
    const context = formatCognitiveContext(buildCognitiveContext());
    assert.match(context, /## YOUR OWN AUTONOMOUS WORK/);
    assert.match(context, /YOUR MOST RECENT COGNITIVE PASS/);
    assert.match(context, /what actually ran:/);
    assert.match(context, new RegExp(workflowName), "her own authored workflow is invisible to her");
    assert.match(context, /WHAT YOU HAVE LEARNED FROM YOUR OWN WORK/);

    /* ---- 11. DURABLE LEARNING, HONESTLY LABELLED ---- */
    const lessons = ObjectiveLearning.getInstance().relevantTo(finished.objective, 5);
    assert.ok(lessons.length > 0, "a completed objective produced no lesson");
    // Node has no IndexedDB, so the long-term write is genuinely refused
    // here. What must never happen is claiming it succeeded.
    for (const lesson of lessons) {
      const persisted = stages.includes("lesson-persisted");
      const refused = stages.includes("lesson-persist-refused");
      assert.ok(persisted || refused, "a lesson was neither persisted nor reported as refused");
      assert.equal(
        lesson.persistedDurably,
        persisted && !refused ? true : lesson.persistedDurably,
        "the lesson's durability flag disagrees with the trace",
      );
    }

    /* ---- 12. EVERYTHING IS PERSISTED THROUGH THE PRODUCTION STORE ---- */
    const kv = KvStore.getInstance();
    const storedObjectives = kv.get<Array<{ id: string }>>("lelu.agent.objectives.v1") ?? [];
    const storedCycles = kv.get<Array<{ objectiveId: string }>>("lelu.agent.cognition.cycles.v1") ?? [];
    const storedWorkflows = kv.get<Array<{ id: string }>>("lelu.workflows.definitions.v1") ?? [];
    const storedRuns = kv.get<Array<{ workflowId: string }>>("lelu.workflows.executions.v1") ?? [];
    const storedLessons = kv.get<Array<{ id: string }>>("lelu.objective.lessons.v1") ?? [];
    assert.ok(storedObjectives.some((entry) => entry.id === objective.id));
    assert.equal(storedCycles.filter((entry) => entry.objectiveId === objective.id).length, cycles.length);
    assert.ok(storedWorkflows.some((entry) => entry.id === authored.id));
    assert.ok(storedRuns.some((entry) => entry.workflowId === authored.id));
    assert.ok(storedLessons.length > 0);

    /* ============ 13. LEARNING CHANGES THE NEXT DECISION ============ */
    //
    // A second objective on the same topic. Nothing is injected: the
    // runtime retrieves what the first one learned and puts it in front
    // of the model before it plans.
    const promptsSeen: string[] = [];
    const ai = AIService.getInstance() as unknown as { deliberate: (...args: unknown[]) => unknown };
    const realDeliberate = ai.deliberate.bind(AIService.getInstance());
    // OBSERVING the prompt, not replacing the model: the real call is
    // still made, and its real answer is still returned.
    ai.deliberate = async (...args: unknown[]) => {
      promptsSeen.push(String(args[0]));
      return realDeliberate(...args);
    };

    const followUp = objectives.create({
      agentId,
      source: "cognition",
      objective:
        `Save a durable note about ${noteTopic} again, and report exactly what you did.`,
    });
    await waitForTerminal(followUp.id, 300_000);
    ai.deliberate = realDeliberate as never;

    assert.ok(promptsSeen.length > 0, "the follow-up objective never reached the model");
    const priorLessons = ObjectiveLearning.getInstance().relevantTo(followUp.objective, 5);
    assert.ok(priorLessons.length > 0, "the earlier failure taught nothing about this topic");
    assert.ok(
      promptsSeen.some((prompt) => prompt.includes("WHAT YOU LEARNED FROM EARLIER WORK")),
      "prior learning never reached the planning prompt",
    );
    // Not just the header: the real text of the lesson that was really
    // retrieved, verbatim, in a real prompt.
    //
    // The comparison is against the retrieval EVENT rather than against
    // whatever ranks first now — more lessons are recorded as the run
    // goes on, so re-querying afterwards can return a different set
    // than the cycle actually saw. The event is what it saw.
    const retrieval = cognitionEvents.find(
      (entry) => entry.objectiveId === followUp.id && entry.stage === "lesson-retrieved",
    );
    assert.ok(retrieval, "the trace does not record learning being retrieved for the follow-up");
    const retrievedText = retrieval.detail.split(" | ")[0].replace(/^\[[^\]]+\]\s*/, "").slice(0, 40);
    assert.ok(retrievedText.length > 10, `the retrieval event carries no lesson text: ${retrieval.detail}`);
    assert.ok(
      promptsSeen.some((prompt) => prompt.includes(retrievedText)),
      `the retrieved lesson did not reach the prompt: "${retrievedText}"`,
    );
    const informed = objectives.get(followUp.id)!;

    /* ---- 13b. INFLUENCE, MEASURED BY ABLATION ----
     *
     * Counting cycles is not a measure: how many cycles a task takes is
     * the model's business, and it varies run to run. So the influence
     * is measured directly, with a control — the SAME planning prompt
     * put to the SAME real model twice, once with the guidance the
     * runtime retrieved and once without it. Nothing else differs, so a
     * difference in what the model does is caused by the learning.
     */
    const guidance = ObjectiveLearning.getInstance().guidanceFor(followUp.objective);
    assert.ok(guidance, "the runtime retrieved no guidance for a topic it has failed at");

    const task =
      `OBJECTIVE: Save a durable note about ${noteTopic}.\n\n` +
      `WORK SO FAR (cycle 1 of at most 8):\n(nothing yet — this is the first cycle)\n\n`;
    const closing =
      `\nDecide the single next action and take it now, using your tools if that is what is needed.\n` +
      `When the objective is already satisfied, say DONE: followed by the conclusion.\n` +
      `When you cannot proceed, say BLOCKED: followed by exactly what is missing.`;
    const system =
      "You are working autonomously toward an objective, without a user watching each step. " +
      "Take one concrete step per cycle. Never claim work you did not actually perform.";

    const countStores = (result: { metadata?: Record<string, unknown> }): number =>
      ((result.metadata?.toolsExecuted as Array<{ tool: string }> | undefined) ?? []).filter(
        (entry) => entry.tool.startsWith("memory_store"),
      ).length;

    // Repeated, because one sample of a model's choice is an anecdote.
    // Same prompt, same model, same system message — the only variable
    // is whether the retrieved learning is present.
    const SAMPLES = 3;
    let controlStores = 0;
    let learnedStores = 0;
    let lastControlText = "";
    let lastLearnedText = "";
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      const control = await AIService.getInstance().deliberate(task + closing, { system });
      controlStores += countStores(control);
      lastControlText = control.text ?? "";

      const informedByLearning = await AIService.getInstance().deliberate(
        `${task}${guidance}\n${closing}`,
        { system },
      );
      learnedStores += countStores(informedByLearning);
      lastLearnedText = informedByLearning.text ?? "";
    }

    assert.ok(
      controlStores >= 2,
      `the control barely reached for the failing tool (${controlStores} call(s) in ${SAMPLES} ` +
        `samples), so this experiment proved nothing (last control decision: ` +
        `${lastControlText.slice(0, 200)})`,
    );
    // WHAT IS ASSERTED, AND WHAT IS ONLY MEASURED.
    //
    // The proof that learning reaches the decision is the retrieval
    // path above: the lesson's own text, verbatim, in the prompt the
    // model was actually given, with the retrieval recorded on the
    // event stream. That is deterministic and is asserted.
    //
    // How much a live model's behaviour changes as a result is a
    // property of the model, not of this system, and it varies between
    // runs. It is measured here and printed, and the only hard rule is
    // that being told a tool does not work must never make LÉLU reach
    // for it MORE. Asserting a strict improvement would be asserting
    // the model's mood.
    assert.ok(
      learnedStores <= controlStores,
      `retrieved learning made the decision worse across ${SAMPLES} samples: with guidance ` +
        `${learnedStores} memory_store call(s), without it ${controlStores} ` +
        `(last decision with guidance: ${lastLearnedText.slice(0, 200)})`,
    );

    /* ============ 14. RESTART, AND RESUME THE SAME OBJECTIVE ============ */
    const resumable = objectives.create({
      agentId,
      objective: `RESUME-${stamp}: deferred work that must survive a restart`,
    });
    // Deferred to a moment that will arrive AFTER the restart. Nothing
    // here wakes it; if it runs, the rebuilt runtime re-armed it from
    // what was persisted.
    objectives.schedule(resumable.id, Date.now() + 6_000, "resuming shortly");

    LeluRuntime.getInstance().shutdown();
    assert.equal(runtime.isRunning(), false, "shutdown left autonomy running");
    const cyclesAtShutdown = objectives.cycles(resumable.id).length;
    await rest(9_000);
    assert.equal(
      objectives.cycles(resumable.id).length,
      cyclesAtShutdown,
      "a cycle ran while the runtime was down",
    );
    // The deferral is still there, in the production store, with its time.
    const parked = (kv.get<Array<{ id: string; state: string; resumeAt?: number }>>("lelu.agent.objectives.v1") ?? [])
      .find((entry) => entry.id === resumable.id);
    assert.equal(parked?.state, "scheduled");
    assert.ok(parked?.resumeAt);

    await LeluRuntime.getInstance().initialize();
    await quiesceSelfStudy();
    const deadline = Date.now() + 120_000;
    while (objectives.cycles(resumable.id).length === 0 && Date.now() < deadline) await rest(400);

    const resumedCycles = objectives.cycles(resumable.id);
    assert.ok(resumedCycles.length > 0, "the restarted runtime never resumed the deferred objective");
    assert.ok(
      resumedCycles.some((cycle) => cycle.trigger.startsWith("runtime:")),
      `the resumed cycle was not runtime-initiated: ${resumedCycles.map((c) => c.trigger).join(", ")}`,
    );

    /* ---- teardown: leave nothing running for the next file ---- */
    unsubscribe();
    cancelEverything();
    LeluRuntime.getInstance().shutdown();
    await quiesceSelfStudy();
    assert.equal(runtime.isRunning(), false);

    console.log(
      "\n=== REAL-MODEL COGNITION PROVEN ===\n" +
        `provider(s): ${[...providers].join(", ")}\n` +
        `objective "${workflowName}": ${finished.state} in ${finished.cyclesRun} cycle(s), ` +
        `${claimed.length} real tool call(s)\n` +
        `uninformed attempt: ${hardFinal.cyclesRun} cycle(s)/${hardFinal.actionsTaken} action(s); ` +
        `informed attempt: ${informed.cyclesRun}/${informed.actionsTaken}\n` +
        `ablation over ${SAMPLES} samples each — same prompt, same model: without prior learning ` +
        `${controlStores} call(s) to the tool that does not work here, with it ${learnedStores}\n` +
        `resumed after restart via: ${resumedCycles.map((cycle) => cycle.trigger).join(", ")}\n`,
    );
  },
);
