/**
 * ==========================================================
 * LÉLU — THE ACTION QUEUE
 *
 * CATEGORY: unit + source wiring. The queue is a projection of real
 * AgentEventBus events: what ran, what is running, what is waiting
 * for the user. Nothing here is timered or invented, and every chat
 * gets its own queue keyed by the conversation that owns the task.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  ACTION_GLYPH,
  MAX_QUEUE_ACTIONS,
  activeAction,
  emptyQueue,
  elapsedLabel,
  isQueueLive,
  queueView,
  reduceQueue,
  type ActionQueue,
} from "../src/core/multichat/ActionQueue";
import ActionQueueStore from "../src/core/multichat/ActionQueueStore";
import AgentEventBus, { type AgentEvent } from "../src/core/agent/AgentEvents";
import { bindTask, resetTurnOwnership } from "../src/core/multichat/TurnOwnership";

const NOW = 1_800_000_000_000;
const CHAT = "chat-a";
const TASK = "task-1";

/** Fold a run of events into one queue, the way the store does. */
function run(events: AgentEvent[], conversationId = CHAT): ActionQueue {
  let queue: ActionQueue | null = null;
  for (const [index, event] of events.entries()) {
    queue = reduceQueue(queue, event, conversationId, NOW + index * 1000);
  }
  assert.ok(queue, "the run produced a queue");
  return queue as ActionQueue;
}

test("a turn becomes a story: think, tool running, tool done, turn done", () => {
  const queue = run([
    { type: "task_started", taskId: TASK, label: "Working on it" },
    { type: "tool_selected", taskId: TASK, tool: "research.web", label: "Searching the web" },
    { type: "tool_started", taskId: TASK, tool: "research.web", label: "Searching the web" },
    { type: "tool_result", taskId: TASK, tool: "research.web", status: "complete", results: [{ title: "a" }, { title: "b" }] },
    { type: "task_completed", taskId: TASK, label: "Done" },
  ]);

  assert.deepEqual(
    queue.actions.map((action) => [action.kind, action.status]),
    [
      ["think", "completed"],
      ["search", "completed"],
    ],
    "every step settles when the turn ends",
  );
  assert.equal(queue.actions[1].count, 2, "the real number of results");
  assert.equal(queue.status, "done");
  assert.ok(queue.finishedAt, "the turn records when it finished");
  assert.equal(isQueueLive(queue), false);
});

test("real work consumes the thought, so only one node is running", () => {
  const queue = run([
    { type: "task_started", taskId: TASK, label: "Working on it" },
    { type: "tool_started", taskId: TASK, tool: "research.web", label: "Searching the web" },
  ]);
  const running = queue.actions.filter((action) => action.status === "running");
  assert.equal(running.length, 1, "one orb, one place: LÉLU cannot be in two nodes at once");
  assert.equal(running[0].kind, "search");
  assert.equal(
    queue.actions.find((action) => action.kind === "think")?.status,
    "completed",
    "the thought is consumed by the step it produced",
  );
});

test("the active node moves as real work starts and finishes", () => {
  let queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "tool_started", taskId: TASK, tool: "browser.read", label: "Reading the page" },
    { type: "tool_started", taskId: TASK, tool: "github.edit", label: "Editing a file" },
  ]);
  assert.equal(activeAction(queue)?.label, "Editing a file", "the orb is on the newest running step");

  queue = reduceQueue(queue, { type: "tool_result", taskId: TASK, tool: "github.edit", status: "complete" }, CHAT, NOW + 9000) as ActionQueue;
  assert.equal(
    queue.actions.find((action) => action.tool === "github.edit")?.status,
    "completed",
    "the step that finished settles",
  );
  assert.equal(
    activeAction(queue)?.label,
    "Reading the page",
    "the orb falls back to the step that is still running, not to the newest one",
  );
  assert.equal(activeAction(queue)?.status, "running");
  assert.equal(isQueueLive(queue), true, "the turn is still going");
});

test("a tool the runtime announced but did not start is queued, never running", () => {
  const queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "tool_selected", taskId: TASK, tool: "sandbox.run", label: "Running the tests" },
  ]);
  const step = queue.actions.at(-1);
  assert.equal(step?.kind, "sandbox");
  assert.equal(step?.status, "queued", "announced is not started");
  assert.equal(ACTION_GLYPH.queued, "○");
  assert.equal(ACTION_GLYPH.running, "●");
});

test("a failure stays visible, and a retry is shown as a retry", () => {
  let queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "tool_started", taskId: TASK, tool: "browser.read", label: "Reading" },
    { type: "tool_failed", taskId: TASK, tool: "browser.read", error: "403 from the site" },
  ]);
  assert.equal(queue.actions.at(-1)?.status, "failed");
  assert.equal(queue.actions.at(-1)?.detail, "403 from the site", "the real error, verbatim");

  queue = reduceQueue(
    queue,
    { type: "execution_phase", taskId: TASK, phase: "retry", label: "Retrying" },
    CHAT,
    NOW + 9000,
  ) as ActionQueue;
  assert.equal(queue.actions.at(-1)?.status, "retrying", "a retry is not a completion");
  assert.equal(ACTION_GLYPH.retrying, "↻");
});

test("the ASK stops the queue on Needs you, and the answer resumes it", () => {
  let queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "tool_started", taskId: TASK, tool: "research.web", label: "Searching" },
    { type: "tool_result", taskId: TASK, tool: "research.web", status: "complete" },
    {
      type: "cognition",
      taskId: TASK,
      stage: "question-asked",
      detail: "Which direction should the capsule take?",
    },
  ]);
  assert.equal(queue.status, "asking");
  assert.equal(queueView(queue).headline, "Waiting for you");
  assert.equal(activeAction(queue)?.kind, "ask");
  assert.equal(activeAction(queue)?.status, "asking");

  queue = reduceQueue(
    queue,
    { type: "cognition", taskId: TASK, stage: "question-answered", detail: "Lead with colour" },
    CHAT,
    NOW + 12_000,
  ) as ActionQueue;
  assert.equal(queue.status, "running", "she carries on with the same objective");
  assert.equal(
    queue.actions.find((action) => action.kind === "ask")?.status,
    "completed",
    "ASK YOU completes when it is really answered",
  );
});

test("an approval waits without pretending to be an ask for the user's answer", () => {
  const queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "approval_requested", taskId: TASK, approvalId: "a1", title: "Push to main?", detail: "3 files" },
  ]);
  assert.equal(queue.status, "waiting");
  assert.equal(activeAction(queue)?.status, "waiting");
});

test("the browser is one step that opens, navigates and reads", () => {
  const queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "browser_opened", taskId: TASK, url: "https://example.com/pricing" },
    { type: "browser_navigation", taskId: TASK, url: "https://example.com/plans" },
    { type: "browser_result", taskId: TASK, url: "https://example.com/plans", title: "Plans", excerpt: "Three tiers", status: "read" },
  ]);
  const steps = queue.actions.filter((action) => action.kind === "browse");
  assert.equal(steps.length, 1, "a navigation is the same browser step, not a second one");
  assert.equal(steps[0].status, "completed");
  assert.equal(steps[0].label, "Read Plans");
  assert.equal(steps[0].url, "https://example.com/plans");
  assert.equal(steps[0].detail, "Three tiers");
});

test("a percentage appears only when an event carried one", () => {
  const noProgress = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "tool_started", taskId: TASK, tool: "sandbox.run", label: "Running" },
  ]);
  assert.equal(noProgress.actions.at(-1)?.progress, undefined, "no invented progress");

  const withProgress = reduceQueue(
    noProgress,
    { type: "tool_progress", taskId: TASK, tool: "sandbox.run", progress: 40, note: "3 of 8 files" },
    CHAT,
    NOW + 5000,
  ) as ActionQueue;
  assert.equal(withProgress.actions.at(-1)?.progress, 40, "the real number the event carried");
  assert.equal(withProgress.actions.at(-1)?.detail, "3 of 8 files");
});

test("narration, memory reads and unowned work add no steps", () => {
  const queue = run([
    { type: "task_started", taskId: TASK, label: "Working" },
    { type: "tool_narration", taskId: TASK, text: "I'm checking the sources" },
    { type: "memory_retrieval", taskId: TASK, query: "capsule", count: 3 },
    { type: "user_steering", taskId: TASK, text: "make it blue" },
    { type: "visual_state_changed", taskId: TASK, state: "research", reason: "test" },
  ]);
  assert.equal(queue.actions.length, 1, "only the real step is in the queue");
});

test("two conversations keep two queues", () => {
  const a = run([
    { type: "task_started", taskId: "task-a", label: "Working" },
    { type: "tool_started", taskId: "task-a", tool: "research.web", label: "Searching for A" },
  ], "chat-a");
  const b = run([
    { type: "task_started", taskId: "task-b", label: "Working" },
    { type: "tool_started", taskId: "task-b", tool: "browser.read", label: "Reading for B" },
  ], "chat-b");
  assert.deepEqual(a.actions.map((action) => action.label), ["Working", "Searching for A"]);
  assert.deepEqual(b.actions.map((action) => action.label), ["Working", "Reading for B"]);
});

test("the queue is bounded, and never drops a running step", () => {
  const events: AgentEvent[] = [{ type: "task_started", taskId: TASK, label: "Working" }];
  for (let index = 0; index < MAX_QUEUE_ACTIONS + 6; index += 1) {
    events.push({ type: "file_opened", taskId: TASK, path: `src/file-${index}.ts` });
  }
  const queue = run(events);
  assert.ok(queue.actions.length <= MAX_QUEUE_ACTIONS, `bounded to ${MAX_QUEUE_ACTIONS}`);
  assert.ok(queue.consumed > 0, "the queue counts what it has dropped");
  assert.equal(queueView(queue).trail.length <= 6, true, "the compact row shows a short trail");
});

test("every status the design names has a glyph", () => {
  for (const status of ["queued", "running", "waiting", "asking", "paused", "completed", "failed", "cancelled", "retrying"] as const) {
    assert.equal(typeof ACTION_GLYPH[status], "string");
    assert.ok(ACTION_GLYPH[status].length > 0);
  }
});

test("an idle clock is not invented: elapsed starts when the step did", () => {
  const step = { id: "s", kind: "search" as const, label: "Searching", status: "running" as const, startedAt: NOW };
  assert.equal(elapsedLabel(step, NOW + 12_000), "12s");
  assert.equal(elapsedLabel(step, NOW + 64_000), "1m 4s");
  assert.equal(elapsedLabel({ ...step, startedAt: undefined }, NOW), "", "nothing to measure, nothing claimed");
});

test("the store routes events by conversation ownership", () => {
  resetTurnOwnership();
  const store = ActionQueueStore.getInstance();
  store.reset();
  const seen: number[] = [];
  const unsubscribe = store.subscribe(() => seen.push(store.getVersion()));
  const bus = AgentEventBus.getInstance();

  bindTask("owned-a", "chat-a");
  bindTask("owned-b", "chat-b");

  bus.emit({ type: "task_started", taskId: "owned-a", label: "Working on A" });
  bus.emit({ type: "tool_started", taskId: "owned-b", tool: "browser.read", label: "Reading for B" });
  bus.emit({ type: "task_started", taskId: "nobody", label: "Cognition's own cycle" });

  assert.deepEqual(store.queueFor("chat-a")?.actions.map((action) => action.label), ["Working on A"]);
  assert.deepEqual(store.queueFor("chat-b")?.actions.map((action) => action.label), ["Reading for B"]);
  assert.equal(store.queueFor("chat-c"), null, "nothing is shown for a chat that did not ask");
  assert.ok(seen.length >= 2, "subscribers hear about changes");
  assert.deepEqual(seen, [...seen].sort((left, right) => left - right), "the version only goes up");

  store.clear("chat-a");
  assert.equal(store.queueFor("chat-a"), null, "a dismissed trail is gone");
  assert.ok(store.queueFor("chat-b"), "and only that one");

  unsubscribe();
  store.reset();
  resetTurnOwnership();
});

test("the queue is wired to the chat and the gallery, and to nothing else", () => {
  const chat = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");
  assert.match(chat, /<ChatActionQueue conversationId=\{state\.activeConversationId\}/, "the chat shows its own conversation's queue");

  const component = readFileSync("src/app/scene/genesis/chat/ChatActionQueue.tsx", "utf8");
  assert.match(component, /store\.queueFor\(conversationId\)/, "the view reads the store by conversation");
  assert.match(component, /data-lelu-action-queue/, "the queue is addressable for verification");
  assert.match(component, /data-lelu-action-status/, "each node carries its real status");
  assert.match(component, /prefers-reduced-motion|reduced-motion/, "motion is reduced-motion aware somewhere in the pair");
  assert.match(readFileSync("src/app/scene/genesis/chat/actionQueue.css", "utf8"), /prefers-reduced-motion/);

  const gallery = readFileSync("src/app/scene/genesis/chat/ChatGallery.tsx", "utf8");
  assert.match(gallery, /ActionQueueStore/, "the gallery reads the same queues, not its own");
  assert.match(gallery, /data-lelu-gallery-queue/, "a card can show where a working chat is");

  // Projection, not an engine: no timers, no polling, no fabricated progress.
  for (const file of ["src/core/multichat/ActionQueue.ts", "src/core/multichat/ActionQueueStore.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.ok(!/setInterval|requestAnimationFrame/.test(source), `${file} must not poll or animate`);
    assert.ok(!/setTimeout/.test(source), `${file} schedules nothing`);
  }
  assert.equal(emptyQueue(CHAT, TASK, NOW).status, "running");
});
