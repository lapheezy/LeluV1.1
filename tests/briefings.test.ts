/**
 * ==========================================================
 * LÉLU — A BRIEFING IS NOT A CHAT MESSAGE
 *
 * CATEGORY: integration. Real BriefingStore, real
 * AgentCognitionRuntime, real MultiChatStore. MOCKED-MODEL:
 * only the decision text is substituted.
 *
 * The property being pinned: what LÉLU tells you off her own
 * initiative has its own identity and its own lifecycle.
 *
 * Before this, a briefing WAS an assistant ChatMessage, built
 * from a string template by a React effect on mount. So it was
 * triggered by the app opening rather than by anything
 * happening; it was permanent in the transcript; it could not
 * be dismissed or marked read; it had no history separate from
 * whichever conversation it happened to land in; and it
 * competed for the same place on screen as the reply to the
 * question the user had just asked.
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

import BriefingStore from "../src/core/proactive/BriefingStore";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import AgentCognitionRuntime from "../src/core/cognition/AgentCognitionRuntime";
import AgentStore from "../src/core/agents/AgentStore";
import ProjectStore from "../src/core/projects/ProjectStore";
import MultiChatStore from "../src/core/multichat/MultiChatStore";
import AIService from "../src/core/AIService";
import { openWorkstream } from "../src/core/proactive/Workstream";
import { stopBackgroundCognition } from "./support/isolation";

await stopBackgroundCognition();

const briefings = BriefingStore.getInstance();
const objectives = AgentObjectives.getInstance();
const chats = MultiChatStore.getInstance();
const agentId = AgentStore.getInstance().list()[0].id;

after(async () => {
  await stopBackgroundCognition();
  AgentCognitionRuntime.getInstance().stop();
});

/* ------------------------------------------------------------------ *
 * THE STORE
 * ------------------------------------------------------------------ */

test("a briefing has its own lifecycle: unread, read, dismissed", () => {
  briefings.clear();
  const created = briefings.create({
    title: "Finished: price the concepts",
    summary: "Priced both fabrics.",
    category: "work-completed",
    priority: "P2",
  });

  assert.equal(briefings.unreadCount(), 1);
  assert.equal(created.readAt, undefined);
  assert.equal(created.dismissedAt, undefined);

  briefings.markRead(created.id);
  assert.ok(briefings.get(created.id)?.readAt, "marking read did not stick");
  assert.equal(briefings.unreadCount(), 0);

  briefings.dismiss(created.id);
  const dismissed = briefings.get(created.id);
  assert.ok(dismissed?.dismissedAt, "dismissing did not stick");
  // Dismissed is history, not deletion: the panel can still show it.
  assert.ok(briefings.list().some((item) => item.id === created.id));
});

test("dismissing an unread briefing also marks it read, so it leaves the count", () => {
  briefings.clear();
  const created = briefings.create({
    title: "Stopped: something",
    summary: "It stopped.",
    category: "work-stopped",
    priority: "P1",
  });
  briefings.dismiss(created.id);
  assert.equal(briefings.unreadCount(), 0, "a dismissed briefing is still being counted as unread");
  assert.ok(briefings.get(created.id)?.readAt);
});

test("the same objective finishing twice is told once", () => {
  briefings.clear();
  const first = briefings.create({
    title: "Finished: a thing",
    summary: "Did it.",
    category: "work-completed",
    priority: "P2",
    relatedObjectiveId: "objective-1",
  });
  const again = briefings.create({
    title: "Finished: a thing",
    summary: "Did it again.",
    category: "work-completed",
    priority: "P2",
    relatedObjectiveId: "objective-1",
  });
  assert.equal(again.id, first.id, "the same completion was reported twice");
  assert.equal(briefings.list().length, 1);

  // But finishing and STOPPING are two different things to say about
  // the same objective.
  briefings.create({
    title: "Stopped: a thing",
    summary: "Then it stopped.",
    category: "work-stopped",
    priority: "P1",
    relatedObjectiveId: "objective-1",
  });
  assert.equal(briefings.list().length, 2);
});

test("briefings are newest first and survive a reload", () => {
  briefings.clear();
  const older = briefings.create({ title: "Older", summary: "a", category: "system", priority: "P3" });
  // Push them apart so this is not a test about sort stability.
  const newer = briefings.create({ title: "Newer", summary: "b", category: "system", priority: "P3" });

  const order = briefings.list().map((item) => item.id);
  assert.ok(order.indexOf(newer.id) <= order.indexOf(older.id), "briefings are not newest first");

  // A fresh instance reads the same persisted state.
  const reloaded = BriefingStore.getInstance().list();
  assert.equal(reloaded.length, 2, "briefings did not persist");
});

/* ------------------------------------------------------------------ *
 * WHAT CREATES ONE
 * ------------------------------------------------------------------ */

test("a briefing comes from real work ending, carries what it came from, and is not a chat message", async () => {
  briefings.clear();
  const project = ProjectStore.getInstance().create({
    name: "Briefing Project",
    description: "Work that will finish.",
  });
  // The workstream exists in the background, so the briefing has
  // somewhere to point without having moved the user.
  const userChat = chats.create("Where the user is").id;
  const workstream = openWorkstream(project.id, { seed: false, activate: false });
  assert.ok(workstream);

  const service = AIService.getInstance();
  await service.initialize();
  const registry = service.getAIProviderRegistry();
  const suspended = registry.all().filter((provider) => provider.enabled);
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = false;
  }
  const path = `briefings/${Date.now()}.txt`;
  let asked = false;
  const fake = {
    name: "BriefingTestProvider",
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
    generate: async () => {
      if (!asked) {
        asked = true;
        return {
          text: "",
          provider: "BriefingTestProvider",
          model: "briefing-test",
          processingTime: 1,
          toolCalls: [{ id: "c1", name: "sandbox_write", arguments: { path, content: "done" } }],
          metadata: {},
        };
      }
      return {
        text: "DONE: wrote the note and checked it is there.",
        provider: "BriefingTestProvider",
        model: "briefing-test",
        processingTime: 1,
        metadata: {},
      };
    },
  };
  registry.register(fake as never);
  await registry.initialize();

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = objectives.create({
    agentId,
    objective: "Write the note.",
    source: "cognition",
    projectId: project.id,
  });

  const messagesBefore = chats.listAll().reduce((total, c) => total + c.messages.length, 0);
  const outcome = await runtime.runCycle(objective.id, "test:briefing");
  assert.ok(outcome);
  assert.equal(objectives.get(objective.id)?.state, "completed");

  // 1. A briefing exists, and it came from the work ending.
  const briefing = briefings.list().find((item) => item.relatedObjectiveId === objective.id);
  assert.ok(briefing, "work finished and the user was never told");
  assert.equal(briefing.category, "work-completed");
  assert.equal(briefing.relatedProjectId, project.id, "the briefing lost its project");
  assert.equal(briefing.conversationId, workstream.conversation.id, "the briefing cannot be opened");

  // 2. It reports what REALLY ran. The tool execution is the evidence.
  assert.ok(
    outcome.executed.some((entry) => entry.tool === "sandbox_write" && entry.ok),
    "no tool actually ran, so there is nothing to brief about",
  );
  assert.match(briefing.reason ?? "", /sandbox_write/, "the briefing does not say what ran");

  // 3. It is NOT a chat message. Nothing was appended to any transcript.
  const messagesAfter = chats.listAll().reduce((total, c) => total + c.messages.length, 0);
  assert.equal(
    messagesAfter,
    messagesBefore,
    "the briefing was written into a conversation as a message after all",
  );

  // 4. And the user did not move.
  assert.equal(chats.getActiveId(), userChat, "briefing the user moved them");

  (fake as { enabled: boolean }).enabled = false;
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = true;
  }
  runtime.stop();
});

/* ------------------------------------------------------------------ *
 * WHAT NO LONGER CREATES ONE
 * ------------------------------------------------------------------ */

test("mounting the app no longer manufactures a briefing", () => {
  const source = readFileSync("src/app/scene/genesis/ProactiveBridge.tsx", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  // The templated briefing and the message it was written as are gone.
  assert.ok(!/buildBriefing\(/.test(code), "the boot briefing is still being built");
  assert.ok(!/formatBriefing/.test(code), "the briefing-to-message formatter is still here");
  assert.ok(
    !/addMessage\(/.test(code),
    "ProactiveBridge still writes chat messages, which is what a briefing used to be",
  );
  // Session bookkeeping is kept — it was never the problem.
  assert.match(code, /beginSession\(\)/);
  assert.match(code, /endSession\(\)/);
});

test("the Briefings panel is reachable and reads the store", () => {
  const dock = readFileSync("src/app/scene/genesis/GenesisDock.tsx", "utf8");
  assert.match(dock, /id: "briefings"/, "there is no Briefings entry in the dock");

  const host = readFileSync("src/app/scene/genesis/GenesisInterface.tsx", "utf8");
  assert.match(host, /briefings: \(\{ onClose \}\) => <GenesisBriefingsPanel/, "the panel is not mounted");

  const panel = readFileSync("src/app/scene/genesis/GenesisBriefingsPanel.tsx", "utf8");
  assert.match(panel, /BriefingStore\.getInstance\(\)/, "the panel does not read the store");
  assert.match(panel, /markRead\(/);
  assert.match(panel, /dismiss\(/);
  // It navigates to the work rather than describing it.
  assert.match(panel, /switchConversation\(/, "the panel cannot open the related conversation");
});

/* ------------------------------------------------------------------ *
 * WHAT A BRIEFING IS ALLOWED TO CLAIM
 *
 * Found by running the live end-to-end test, which is the only place
 * a real model decides when it is finished. Two defects, both in the
 * one place a person actually reads about autonomous work.
 * ------------------------------------------------------------------ */

/**
 * Install a provider that answers from a script, disabling the real
 * ones for the duration. Returns a restore function.
 *
 * Each entry is one round of the tool loop: a round with toolCalls runs
 * them and asks again, a round with text ends the deliberation.
 */
async function withScriptedProvider(
  name: string,
  rounds: Array<{ text?: string; toolCalls?: Array<{ id: string; name: string; arguments: unknown }> }>,
): Promise<() => void> {
  const service = AIService.getInstance();
  await service.initialize();
  const registry = service.getAIProviderRegistry();
  const suspended = registry.all().filter((provider) => provider.enabled);
  for (const provider of suspended) {
    (provider as { enabled: boolean }).enabled = false;
  }

  let round = 0;
  const fake = {
    name,
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
    generate: async () => {
      const step = rounds[Math.min(round, rounds.length - 1)];
      round += 1;
      return {
        text: step.text ?? "",
        provider: name,
        model: "scripted",
        processingTime: 1,
        ...(step.toolCalls ? { toolCalls: step.toolCalls } : {}),
        metadata: {},
      };
    },
  };
  registry.register(fake as never);
  await registry.initialize();

  return () => {
    (fake as { enabled: boolean }).enabled = false;
    for (const provider of suspended) {
      (provider as { enabled: boolean }).enabled = true;
    }
  };
}

test("a briefing counts what ran across the WHOLE objective, not just its last cycle", async () => {
  briefings.clear();

  // THE BUG. brief() was handed one cycle's results while its own
  // reason line said "in this objective". An objective that really did
  // work in cycle 1 and then concluded in cycle 2 was therefore briefed
  // as "No tool was executed in this objective" — a false account of
  // work that had actually happened.
  const path = `briefings/two-cycles-${Date.now()}.txt`;
  const restore = await withScriptedProvider("TwoCycleProvider", [
    // Cycle 1: really write something, then say something that is NOT
    // a conclusion, so the objective stays active.
    { toolCalls: [{ id: "c1", name: "sandbox_write", arguments: { path, content: "real work" } }] },
    { text: "Wrote the file. Next I will check it back." },
    // Cycle 2: conclude, taking no action this time.
    { text: "DONE: the file is written." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = objectives.create({
    agentId,
    objective: "Write a file over two cycles.",
    source: "cognition",
  });

  const first = await runtime.runCycle(objective.id, "test:cycle-one");
  assert.ok(first, "the first cycle did not run");
  assert.ok(
    first.executed.some((entry) => entry.tool === "sandbox_write" && entry.ok),
    "the first cycle was supposed to really execute something",
  );
  assert.equal(objectives.get(objective.id)?.state, "active", "the objective ended too early to test this");

  // The runtime schedules its own next cycle after CYCLE_COOLDOWN_MS,
  // so the second cycle is waited for rather than forced — which also
  // exercises the continuation path instead of bypassing it.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && objectives.get(objective.id)?.state === "active") {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(
    objectives.get(objective.id)?.state,
    "completed",
    "the objective never reached its concluding cycle",
  );

  const concluding = objectives.cycles(objective.id).find((record) => record.nextState === "completed");
  assert.ok(concluding, "no cycle recorded the completion");
  assert.equal(
    concluding.executed.length,
    0,
    "the concluding cycle was supposed to take no action — this test is about what the EARLIER cycle did",
  );

  const briefing = briefings.list().find((item) => item.relatedObjectiveId === objective.id);
  assert.ok(briefing, "the work ended and nobody was told");
  assert.match(
    briefing.reason ?? "",
    /sandbox_write/,
    "the briefing forgot the work done in an earlier cycle and reported the objective as having executed nothing",
  );
  assert.match(briefing.title, /^Finished:/, "work that really ran should be briefed as finished");

  restore();
  runtime.stop();
});

test("a conclusion reached without executing anything is not headlined as finished work", async () => {
  briefings.clear();

  // The runtime completes an objective when the model replies DONE:,
  // and nothing requires a tool to have run first. That is deliberate —
  // some work is genuinely answerable by reasoning. What must not
  // happen is the record reading like work was done when none was.
  const restore = await withScriptedProvider("NoActionProvider", [
    { text: "DONE: nothing needed doing." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = objectives.create({
    agentId,
    objective: "Decide whether anything needs doing.",
    source: "cognition",
  });

  const outcome = await runtime.runCycle(objective.id, "test:no-action");
  assert.ok(outcome);
  assert.equal(outcome.executed.length, 0, "this case is about a cycle that executed nothing");
  assert.equal(objectives.get(objective.id)?.state, "completed", "a reasoned conclusion should still end the work");

  const briefing = briefings.list().find((item) => item.relatedObjectiveId === objective.id);
  assert.ok(briefing, "the work ended and nobody was told");
  assert.match(
    briefing.title,
    /^Concluded without acting:/,
    "a completion with nothing executed is headlined as finished work",
  );
  assert.match(
    briefing.reason ?? "",
    /No tool was executed/,
    "the briefing does not say that nothing ran",
  );
  // And it does not invent a checklist for an objective whose deliverable
  // was the answer: "nothing needed doing" is a complete answer.
  assert.match(
    briefing.reason ?? "",
    /No outcome contract/,
    "a reasoning-only objective was briefed as if it had a tool checklist",
  );

  restore();
  runtime.stop();
});

/* ------------------------------------------------------------------ *
 * A BRIEFING SAYS WHAT WAS REQUIRED AND WHAT WAS SEEN
 *
 * Phase 8 gave the objective a contract before the work started and
 * taught the runtime to check a completion claim against it. Both
 * facts were only in the log. This is the same run, read the way a
 * person reads it: what had to be true, what was observed, what was
 * not — and that the model's premature "DONE:" was already sent back
 * once before the budget ran out.
 * ------------------------------------------------------------------ */

test("a stopped objective is briefed with its contract and the shortfall", async () => {
  briefings.clear();

  const restore = await withScriptedProvider("PrematureCompletionProvider", [
    // The real failure the live test caught: a model deciding it is
    // finished after looking, without doing the work.
    { text: "DONE: it already exists, so there is nothing more to do." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = objectives.create({
    agentId,
    objective: "Check whether the routine exists, then run it.",
    source: "cognition",
    // One cycle, so the rejected claim ends the objective in this test
    // rather than continuing — the briefing is written on the stop.
    maxCycles: 1,
    expectedOutcomes: [
      { evidence: "tool-succeeded", tool: "workflow_run", what: "workflow_run ran successfully" },
    ],
  });

  const outcome = await runtime.runCycle(objective.id, "test:premature-completion");
  assert.ok(outcome);
  assert.equal(outcome.verification?.verdict, "incomplete", "the claim should have been rejected");
  assert.equal(
    objectives.get(objective.id)?.state,
    "yielded",
    "the objective should have stopped on its budget, not completed",
  );

  const briefing = briefings.list().find((item) => item.relatedObjectiveId === objective.id);
  assert.ok(briefing, "the work stopped and nobody was told");
  assert.equal(briefing.category, "work-stopped");
  assert.match(briefing.title, /^Stopped:/, "work that did not finish is headlined as finished");

  const reason = briefing.reason ?? "";
  assert.match(reason, /declared by whoever set the objective/, "the briefing does not say where the requirement came from");
  assert.match(reason, /workflow_run ran successfully/, "the briefing does not name what was required");
  assert.match(reason, /Not observed: workflow_run ran successfully/, "the briefing does not name the shortfall");
  assert.match(
    reason,
    /rejected 1 premature completion claim/,
    "the briefing hides that the runtime had already turned the claim back",
  );

  restore();
  runtime.stop();
});

/* ------------------------------------------------------------------ *
 * AND A FINISHED OBJECTIVE IS BRIEFED WITH THE EVIDENCE THAT SETTLED IT
 * ------------------------------------------------------------------ */

test("a finished objective is briefed with the outcome that was observed", async () => {
  briefings.clear();

  const path = `briefings/contract-${Date.now()}.txt`;
  const restore = await withScriptedProvider("ContractCompletedProvider", [
    { toolCalls: [{ id: "c1", name: "sandbox_write", arguments: { path, content: "done" } }] },
    { text: "DONE: the note is written." },
  ]);

  const runtime = AgentCognitionRuntime.getInstance();
  runtime.start();
  const objective = objectives.create({
    agentId,
    objective: "Write the note.",
    source: "cognition",
    expectedOutcomes: [
      { evidence: "tool-succeeded", tool: "sandbox_write", what: "sandbox_write ran successfully" },
    ],
  });

  const outcome = await runtime.runCycle(objective.id, "test:contract-complete");
  assert.ok(outcome);
  assert.equal(outcome.verification?.verdict, "complete", outcome.verification?.reason);

  const briefing = briefings.list().find((item) => item.relatedObjectiveId === objective.id);
  assert.ok(briefing, "the work finished and nobody was told");
  assert.equal(briefing.category, "work-completed");
  const reason = briefing.reason ?? "";
  assert.match(reason, /sandbox_write/);
  assert.match(reason, /Observed: sandbox_write ran successfully/);
  assert.ok(
    !/Not observed/.test(reason),
    "a finished objective was briefed with a shortfall, which contradicts its own headline",
  );

  restore();
  runtime.stop();
});
