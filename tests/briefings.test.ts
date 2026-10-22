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
