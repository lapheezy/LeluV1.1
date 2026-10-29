/**
 * LÉLU — DELEGATION IS DURABLE, ATTRIBUTED AND RECOVERABLE
 *
 * Delegation already runs through ONE path: AIService / panels / self-study
 * → AgentRunner.run → AIService.delegate, recorded in AgentStore (KvStore).
 * What was missing, and what these tests pin down:
 *
 *   1. A task that was "running" when the app stopped stayed "running"
 *      forever after a reload — live status that described nothing.
 *      On load it is now "interrupted", with the reason.
 *   2. Interrupted (or failed) work could not be continued. resume()
 *      re-runs it through the same runner and links both records.
 *   3. Nothing recorded WHO assigned a task. delegatedBy now says so.
 *   4. There was no single view of delegated work across agents.
 *      AgentStore.delegations() is that ledger, read from the same records.
 *
 * The model is stubbed at AIService.delegate (the one boundary AgentRunner
 * calls), so these run offline and prove the bookkeeping, not a model.
 */

import assert from "node:assert/strict";
import test from "node:test";

// Same in-memory storage shim the other store tests use (briefings, autonomy-bridge).
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

import AgentStore from "../src/core/agents/AgentStore";
import AgentRunner from "../src/core/agents/AgentRunner";
import AIService from "../src/core/AIService";
import type { AIResponse } from "../src/providers/AIProvider";
import { stopBackgroundCognition } from "./support/isolation";

await stopBackgroundCognition();

type Delegate = AIService["delegate"];
const ai = AIService.getInstance();
const realDelegate: Delegate = ai.delegate.bind(ai);

function stubDelegate(impl: (task: string) => Promise<AIResponse>): () => void {
  (ai as unknown as { delegate: Delegate }).delegate = (async (_agent, task) => impl(task)) as Delegate;
  return () => {
    (ai as unknown as { delegate: Delegate }).delegate = realDelegate;
  };
}

const ok = (text: string): AIResponse => ({ text, provider: "stub", model: "stub", processingTime: 1 });

/** Simulate an app restart: the persisted records survive, the process state does not. */
function restart(): AgentStore {
  AgentStore.resetForTests();
  return AgentStore.getInstance();
}

const someAgent = () => AgentStore.getInstance().runnable()[0];

test("a task left 'running' by a previous session is marked interrupted on load, not running forever", () => {
  const store = AgentStore.getInstance();
  const agent = someAgent();
  const task = store.recordTask(agent.id, { label: "draft the phone layout review", status: "running" });

  const reloaded = restart();
  const after = reloaded.get(agent.id)!.tasks.find((t) => t.id === task.id)!;
  assert.equal(after.status, "interrupted");
  assert.match(after.error ?? "", /stopped before it finished/i);
  assert.ok(after.completedAt, "an interrupted task records when it was found interrupted");
});

test("tasks that finished before the restart are left exactly as they were", () => {
  const store = AgentStore.getInstance();
  const agent = someAgent();
  const done = store.recordTask(agent.id, { label: "finished work", status: "complete", completedAt: 123 });
  const failed = store.recordTask(agent.id, { label: "failed work", status: "failed", error: "boom" });

  const reloaded = restart();
  const tasks = reloaded.get(agent.id)!.tasks;
  assert.deepEqual(
    { s: tasks.find((t) => t.id === done.id)!.status, c: tasks.find((t) => t.id === done.id)!.completedAt },
    { s: "complete", c: 123 },
  );
  assert.equal(tasks.find((t) => t.id === failed.id)!.error, "boom");
});

test("run() records who delegated the task", async () => {
  const restore = stubDelegate(async () => ok("Reviewed. Two overlapping layers found."));
  try {
    const agent = someAgent();
    const result = await AgentRunner.getInstance().run(agent.id, "review overlapping layers", undefined, undefined, {
      delegatedBy: "architect",
    });
    assert.equal(result.ok, true);
    const task = AgentStore.getInstance().get(agent.id)!.tasks.find((t) => t.id === result.taskId)!;
    assert.equal(task.status, "complete");
    assert.equal(task.delegatedBy, "architect");
  } finally {
    restore();
  }
});

test("an interrupted task can be resumed through the same runner, and both records are linked", async () => {
  const store = AgentStore.getInstance();
  const agent = someAgent();
  const original = store.recordTask(agent.id, {
    label: "summarise the voice recovery path",
    status: "running",
    delegatedBy: "lelu",
  });
  restart();

  const seen: string[] = [];
  const restore = stubDelegate(async (task) => {
    seen.push(task);
    return ok("Voice recovery: restart recognition on 'end' unless the user stopped it.");
  });
  try {
    const result = await AgentRunner.getInstance().resume(agent.id, original.id);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(seen, ["summarise the voice recovery path"], "the SAME objective is re-run");

    const tasks = AgentStore.getInstance().get(agent.id)!.tasks;
    const resumed = tasks.find((t) => t.id === result.taskId)!;
    const old = tasks.find((t) => t.id === original.id)!;
    assert.equal(resumed.status, "complete");
    assert.equal(resumed.resumedFrom, original.id);
    assert.equal(resumed.delegatedBy, "lelu", "ownership carries over to the resumed task");
    assert.equal(old.status, "interrupted", "history is kept, not rewritten");
    assert.equal(old.resumedBy, resumed.id);
  } finally {
    restore();
  }
});

test("a failed task can be resumed; a completed or already-resumed one cannot", async () => {
  const store = AgentStore.getInstance();
  const agent = someAgent();
  const runner = AgentRunner.getInstance();
  const failed = store.recordTask(agent.id, { label: "retry me", status: "failed", error: "provider down" });
  const done = store.recordTask(agent.id, { label: "already done", status: "complete" });

  const restore = stubDelegate(async () => ok("Done on the second attempt."));
  try {
    const retried = await runner.resume(agent.id, failed.id);
    assert.equal(retried.ok, true);

    const again = await runner.resume(agent.id, failed.id);
    assert.equal(again.ok, false);
    assert.match(again.error ?? "", /already resumed/i);

    const notResumable = await runner.resume(agent.id, done.id);
    assert.equal(notResumable.ok, false);
    assert.match(notResumable.error ?? "", /complete/i);

    const missing = await runner.resume(agent.id, "no-such-task");
    assert.equal(missing.ok, false);
  } finally {
    restore();
  }
});

test("a delegation that throws is recorded as failed with its error, never left running", async () => {
  const restore = stubDelegate(async () => {
    throw new Error("provider unreachable");
  });
  try {
    const agent = someAgent();
    const result = await AgentRunner.getInstance().run(agent.id, "will fail", undefined, undefined, { delegatedBy: "maat" });
    assert.equal(result.ok, false);
    const task = AgentStore.getInstance().get(agent.id)!.tasks.find((t) => t.id === result.taskId)!;
    assert.equal(task.status, "failed");
    assert.equal(task.error, "provider unreachable");
    assert.equal(task.delegatedBy, "maat");
  } finally {
    restore();
  }
});

test("delegations() is one ledger across agents, newest first, filterable by status and delegator", async () => {
  const store = AgentStore.getInstance();
  const [a, b] = store.runnable();
  assert.ok(a && b, "need two agents");
  const t1 = store.recordTask(a.id, { label: "ledger one", status: "complete", delegatedBy: "forge" });
  await new Promise((r) => setTimeout(r, 2));
  const t2 = store.recordTask(b.id, { label: "ledger two", status: "running", delegatedBy: "forge" });

  const forge = store.delegations({ delegatedBy: "forge" });
  const ids = forge.map((d) => d.task.id);
  assert.ok(ids.indexOf(t2.id) < ids.indexOf(t1.id), "newest first");
  const entry = forge.find((d) => d.task.id === t2.id)!;
  assert.equal(entry.agentId, b.id);
  assert.equal(entry.agentName, b.name);

  const running = store.delegations({ status: "running" }).map((d) => d.task.id);
  assert.ok(running.includes(t2.id));
  assert.ok(!running.includes(t1.id));
});
