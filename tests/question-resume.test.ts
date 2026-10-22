/**
 * ==========================================================
 * LÉLU — ASKING, AND CARRYING ON FROM THE ANSWER
 *
 * CATEGORY: integration. Real ProactiveCore, real
 * AgentObjectives, real AgentCognitionRuntime, real
 * MultiChatStore. MOCKED-MODEL: only the model's decision text
 * is substituted, by registering a provider; everything that
 * reacts to it is the real thing.
 *
 * The property being pinned: a question is a unit of work
 * pausing, not a notification.
 *
 * Before this, the pieces existed and did not meet.
 * ProactiveQuestion carried a project and a task but no
 * conversation and no objective, so an answer had nowhere to go
 * and nothing to resume. resolveQuestion(id, response) took the
 * user's words and its only caller passed the fixed string
 * "Explored in the global conversation." — so a question could
 * be opened or dismissed but never answered. And a runtime
 * cycle that reported BLOCKED on missing information YIELDED,
 * which ends an objective: the work stopped, nobody was asked,
 * and the explanation of what was missing sat in a cycle record.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { readFileSync } from "node:fs";

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
if (typeof sessionStorage === "undefined") {
  (globalThis as Record<string, unknown>).sessionStorage = globalThis.localStorage;
}

import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentStore from "../src/core/agents/AgentStore";
import ProjectStore from "../src/core/projects/ProjectStore";
import ProactiveCore from "../src/core/proactive/ProactiveCore";
import MultiChatStore from "../src/core/multichat/MultiChatStore";
import AIService from "../src/core/AIService";
import { stopBackgroundCognition } from "./support/isolation";

await stopBackgroundCognition();

const objectives = AgentObjectives.getInstance();
const proactive = ProactiveCore.getInstance();
const chats = MultiChatStore.getInstance();
const agentId = AgentStore.getInstance().list()[0].id;

after(async () => {
  await stopBackgroundCognition();
  AgentCognitionRuntime.getInstance().stop();
});

/** Replace only the model's decision, through the real provider chain. */
async function withDecision<T>(
  decide: (request: { prompt?: string; messages?: Array<{ role: string }> }) => string,
  body: (runtime: AgentCognitionRuntime) => Promise<T>,
): Promise<T> {
  const service = AIService.getInstance();
  await service.initialize();
  const registry = service.getAIProviderRegistry();
  const suspended = registry.all().filter((provider) => provider.enabled);
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = false;
  }
  const fake = {
    name: `QuestionTestProvider-${Math.random().toString(36).slice(2, 8)}`,
    priority: -1,
    enabled: true,
    timeout: 20_000,
    requiresApiKey: false,
    capabilities: ["chat"] as const,
    supportsTools: true,
    initialize: async () => {},
    isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async (request: { prompt?: string; messages?: Array<{ role: string }> }) => ({
      text: decide(request),
      provider: "QuestionTestProvider",
      model: "question-test",
      processingTime: 1,
      metadata: {},
    }),
  };
  registry.register(fake as never);
  await registry.initialize();

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  try {
    return await body(runtime);
  } finally {
    (fake as { enabled: boolean }).enabled = false;
    for (const provider of suspended) {
      (provider as { enabled: boolean }).enabled = true;
    }
    runtime.stop();
  }
}

/* ------------------------------------------------------------------ *
 * ONE TEST, FLAT AND SEQUENTIAL.
 *
 * Every scenario here swaps providers in the shared AIProviderRegistry
 * and starts and stops the shared AgentCognitionRuntime. That makes them
 * mutually exclusive, and node:test gives no reliable way to say so
 * across separate cases: as top-level tests they run concurrently, and
 * as awaited subtests they still interleaved — measured, with the
 * capability-gap scenario's withDecision() teardown calling
 * runtime.stop() while the resume scenario was waiting on a scheduled
 * cycle. stop() clears pending continuations and bumps the epoch, so
 * that cycle was discarded and the failure read as "the answer woke
 * nothing" when the real cause was another test stopping the runtime.
 *
 * So this is one function, top to bottom, with each step's assertion
 * message saying which step it is.
 * ------------------------------------------------------------------ */

test("LÉLU asks when blocked, waits, and continues from the real answer", async () => {
  const project = ProjectStore.getInstance().create({
    name: "Question Project",
    description: "Needs a decision only the user can make.",
  });
  const userChat = chats.create("What the user is reading").id;

  // One provider for the whole scenario, because answering the question
  // WAKES the runtime: the cycle that carries the work forward is driven
  // by resolveQuestion, not by this test calling runCycle. Swapping
  // providers in between would mean that cycle ran against whatever
  // happened to be live.
  let phase: "blocked" | "unblocked" = "blocked";

  await withDecision(
    () =>
      phase === "blocked"
        ? "BLOCKED: I need you to clarify which fabric supplier to price against."
        : "DONE: priced both fabrics against the suppliers you named.",
    async (runtime) => {
      /* ---- 1. the block becomes a question; the objective WAITS ---- */
      const objective = objectives.create({
        agentId,
        objective: "Price the first concept set.",
        source: "cognition",
        projectId: project.id,
      });
      const objectiveId = objective.id;

      const blocked = await runtime.runCycle(objectiveId, "test:blocked");
      assert.ok(blocked, "step 1: the runtime declined to run the objective");
      assert.equal(blocked.yieldReason, "awaiting-information", "step 1: wrong block reason");

      // Waiting, not yielded. Yielding ends an objective; waiting is the
      // state revive() can bring back.
      const parked = objectives.get(objectiveId);
      assert.equal(parked?.state, "waiting", `step 1: objective ended as ${parked?.state}`);
      assert.ok(parked?.waitingFor, "step 1: it is waiting without recording what for");

      /* ---- 2. the question knows what it belongs to ---- */
      const question = proactive.listQuestions().find((item) => item.objectiveId === objectiveId);
      assert.ok(question, "step 2: the objective is waiting and nobody was asked");
      assert.equal(question.status, "pending");
      assert.equal(question.objectiveId, objectiveId, "step 2: the question cannot be traced to its work");
      assert.equal(question.relatedProjectId, project.id, "step 2: no project on the question");
      assert.ok(question.conversationId, "step 2: the question has no conversation to be asked in");
      assert.equal(question.blocksExecution, true);
      assert.ok(question.lifecycle, "step 2: the question has no lifecycle state");
      // The model's own account of what is missing, not a rewrite of it.
      assert.match(question.question, /fabric supplier/i, "step 2: the question was reworded");

      /* ---- 3. asking does not move the user ---- */
      assert.equal(chats.getActiveId(), userChat, "step 3: asking a question moved the user");
      assert.notEqual(question.conversationId, userChat, "step 3: the question hijacked the user's chat");
      assert.ok(chats.get(question.conversationId!), "step 3: the question names a conversation that does not exist");

      /* ---- 4. the user's real answer is what gets stored ---- */
      const answer = "Use Mariani for the wool, and price the linen against Albini.";
      phase = "unblocked";
      proactive.resolveQuestion(question.id, answer);

      const resolved = proactive.getQuestion(question.id);
      assert.equal(resolved?.status, "resolved", "step 4: the question was not resolved");
      assert.equal(resolved?.userResponse, answer, "step 4: the stored answer is not what the user said");
      assert.ok(resolved?.resolvedAt, "step 4: no resolution time recorded");
      assert.doesNotMatch(
        resolved?.userResponse ?? "",
        /Explored in the global conversation/,
        "step 4: the canned response is still being written in place of the answer",
      );

      /* ---- 5. the answer wakes the runtime and the SAME work finishes ---- */
      // Nothing here calls runCycle. The answer is the trigger: the
      // objective is revived and the running runtime picks it up on its
      // own continuation, whose cooldown is 1.5s.
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && objectives.get(objectiveId)?.state !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const finished = objectives.get(objectiveId);
      assert.equal(
        finished?.state,
        "completed",
        `step 5: the answer did not carry the work forward; it is ${finished?.state}`,
      );
      assert.equal(finished?.waitingFor, undefined, "step 5: it finished still claiming to be waiting");
      assert.ok(finished?.conclusion, "step 5: completed with no conclusion");
      // Two cycles, one objective: the block did not cost the work.
      assert.ok((finished?.cyclesRun ?? 0) >= 2, `step 5: only ${finished?.cyclesRun} cycle(s) ran`);
      const forProject = objectives.list().filter((item) => item.projectId === project.id);
      assert.equal(forProject.length, 1, `step 5: answering created ${forProject.length} objectives`);
      assert.equal(forProject[0].id, objectiveId, "step 5: a different objective continued");
      assert.equal(chats.getActiveId(), userChat, "step 5: finishing the work moved the user");
    },
  );

  /* ---- 6. a capability gap is NOT a question for the user ---- */
  const gapProject = ProjectStore.getInstance().create({ name: "Capability Gap Project", description: "x" });
  await withDecision(
    () => "BLOCKED: the development runtime is unreachable, so I cannot run the tests.",
    async (runtime) => {
      const objective = objectives.create({
        agentId,
        objective: "Verify the sandbox build.",
        source: "cognition",
        projectId: gapProject.id,
      });
      const outcome = await runtime.runCycle(objective.id, "test:capability");
      assert.equal(outcome?.yieldReason, "capability-unavailable", "step 6: wrong block reason");
      // A fact about the runtime, not something the user can answer — so
      // the objective ends rather than waiting for an answer that would
      // never come.
      assert.equal(objectives.get(objective.id)?.state, "yielded", "step 6: it waited for an unanswerable question");
      assert.equal(
        proactive.listQuestions().some((item) => item.objectiveId === objective.id),
        false,
        "step 6: the user was asked about a runtime that is simply not there",
      );
    },
  );

  /* ---- 7. the same block asked twice is the same question ---- */
  const repeatProject = ProjectStore.getInstance().create({ name: "Repeat Block Project", description: "x" });
  await withDecision(
    () => "BLOCKED: please clarify the deadline you want me to work to.",
    async (runtime) => {
      const objective = objectives.create({
        agentId,
        objective: "Plan the schedule.",
        source: "cognition",
        projectId: repeatProject.id,
      });
      await runtime.runCycle(objective.id, "test:first");
      objectives.revive(objective.id);
      // Past the runtime's own cycle cooldown, then blocked again on the
      // same thing: one question, not two.
      await new Promise((resolve) => setTimeout(resolve, 1_700));
      await runtime.runCycle(objective.id, "test:second");

      const raised = proactive.listQuestions().filter((item) => item.objectiveId === objective.id);
      assert.equal(raised.length, 1, `step 7: the same block raised ${raised.length} questions`);
    },
  );

  /* ---- 8. an answer to work that has since finished changes nothing ---- */
  const stale = objectives.create({ agentId, objective: "Already done.", source: "cognition" });
  const staleQuestion = proactive.enqueueQuestion({
    key: `objective:${stale.id}`,
    question: "Something that no longer matters?",
    category: "EXECUTIVE",
    reason: "step 8 fixture",
    priority: "P2",
    objectiveId: stale.id,
  });
  objectives.complete(stale.id, "Finished before the answer arrived.");

  proactive.resolveQuestion(staleQuestion.id, "Here is my answer anyway.");
  await new Promise((resolve) => setTimeout(resolve, 300));

  // revive() is a no-op unless the objective is waiting, so a late
  // answer must not restart completed work.
  assert.equal(objectives.get(stale.id)?.state, "completed", "step 8: a late answer restarted finished work");
  assert.equal(
    proactive.getQuestion(staleQuestion.id)?.userResponse,
    "Here is my answer anyway.",
    "step 8: the answer was discarded because the work had finished",
  );
});

test("a wake inside the cycle cooldown is deferred, not discarded", async () => {
  // The bug this pins cost the whole phase an afternoon, and it is not a
  // test artifact: a user answering a question within 1.5s of the cycle
  // that asked it left the objective active and abandoned forever. The
  // cooldown is there so a burst of events cannot spin the model; it
  // must not also lose the event.
  await withDecision(
    () => "DONE: finished on the second cycle.",
    async (runtime) => {
      const objective = objectives.create({
        agentId,
        objective: "Something that gets woken immediately.",
        source: "cognition",
      });

      // One real cycle, so lastCycleAt is set and the cooldown is live.
      const first = await runtime.runCycle(objective.id, "test:first");
      assert.ok(first, "the first cycle did not run");
      objectives.update(objective.id, { state: "active" });

      // A wake WELL inside the cooldown. Before the fix this returned
      // null and nothing re-armed it.
      const immediate = await runtime.runCycle(objective.id, "test:too-soon");
      assert.equal(immediate, null, "the cooldown was not honoured");

      // The wake must still be owed. Within a cooldown's length plus
      // slack, a cycle happens without anything else asking for one.
      const before = objectives.get(objective.id)?.cyclesRun ?? 0;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && (objectives.get(objective.id)?.cyclesRun ?? 0) === before) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(
        (objectives.get(objective.id)?.cyclesRun ?? 0) > before,
        "the deferred wake was dropped: the objective stalled active with nothing scheduled",
      );
    },
  );
});

test("the chat card submits the user's words, not a canned string", () => {
  const source = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");
  // There is an input bound to a draft, and the draft is what is sent.
  assert.match(source, /data-lelu-question-answer/, "the question card has no answer input");
  assert.match(source, /proactive\.resolveQuestion\(question\.id, answer\)/, "the answer is not submitted verbatim");
  // Explore still resolves with its own note — that is a different act
  // from answering — but it must no longer be the ONLY way to resolve.
  const resolveCalls = source.match(/resolveQuestion\(/g) ?? [];
  assert.ok(resolveCalls.length >= 2, "answering and exploring are still the same single path");
});
