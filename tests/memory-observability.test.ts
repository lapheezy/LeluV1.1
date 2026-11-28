/**
 * ==========================================================
 * LÉLU — MEASURING MEMORY AND EXECUTION HONESTLY
 *
 * Mission 44.8 WP06. The requirement is not "show numbers"; it is
 * "do not invent unavailable metrics, and label estimated, measured
 * and unavailable values separately".
 *
 * So this suite checks the arithmetic against events it wrote
 * itself, and checks that an empty journal reports `unavailable`
 * rather than a confident zero.
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

import MemoryObservability, { summarise, type MemoryEvent } from "../src/core/memory/MemoryObservability";
import KvStore from "../src/core/storage/KvStore";

const KEY = "memory.observability.v1";
const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);

function fresh(): MemoryObservability {
  KvStore.getInstance().remove(KEY);
  MemoryObservability.resetForTests();
  return MemoryObservability.getInstance();
}

function event(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return { at: NOW, kind: "retrieval", ...overrides };
}

/* ------------------------------------------------------------------ */
/* 1. Windows and statistics                                           */
/* ------------------------------------------------------------------ */

test("a window counts only the events inside it", () => {
  const events = [
    event({ at: NOW - 30_000, kind: "retrieval", latencyMs: 10 }),
    event({ at: NOW - 2 * 60 * 60_000, kind: "retrieval", latencyMs: 30 }),
    event({ at: NOW - 3 * 24 * 60 * 60_000, kind: "memory-write" }),
  ];
  const within = (ms: number) => events.filter((entry) => entry.at >= NOW - ms);

  assert.equal(summarise(within(60_000), 60_000).retrievals, 1);
  assert.equal(summarise(within(60 * 60_000), 3_600_000).retrievals, 1, "the two-hour-old retrieval is outside the hour");
  assert.equal(summarise(within(24 * 60 * 60_000), 86_400_000).retrievals, 2);
  assert.equal(summarise(within(24 * 60 * 60_000), 86_400_000).events, 2, "yesterday's write is outside the day");
  assert.equal(summarise(events, null).events, 3);
});

test("latency reports lowest, highest and average from measured samples only", () => {
  const stats = summarise(
    [
      event({ latencyMs: 120 }),
      event({ latencyMs: 480 }),
      event({ latencyMs: 300 }),
      event({ kind: "memory-write" }),
    ],
    null,
  );
  assert.deepEqual(stats.latency, { min: 120, max: 480, average: 300, samples: 3 });
});

test("relevance is measured only from events that reported both numbers", () => {
  const stats = summarise(
    [
      event({ items: 8, relevant: 4 }),
      event({ items: 2, relevant: 2 }),
      event({ items: 5 }),
    ],
    null,
  );
  assert.equal(stats.relevanceRate, 0.6, "6 of 10 reported records were used");
  assert.equal(stats.itemsRetrieved, 15);
  assert.equal(summarise([event({ items: 5 })], null).relevanceRate, null, "no ratio without a numerator");
});

test("every event kind lands in its own counter", () => {
  const stats = summarise(
    [
      event({ kind: "memory-write" }),
      event({ kind: "memory-write-failed" }),
      event({ kind: "retrieval" }),
      event({ kind: "retrieval-failed" }),
      event({ kind: "conflict" }),
      event({ kind: "stale" }),
      event({ kind: "cross-conversation" }),
      event({ kind: "work-resumed" }),
      event({ kind: "duplicate-prevented" }),
      event({ kind: "approval" }),
      event({ kind: "rejection" }),
      event({ kind: "governance-denied" }),
    ],
    null,
  );
  assert.equal(stats.writes, 1);
  assert.equal(stats.writeFailures, 1);
  assert.equal(stats.retrievals, 1);
  assert.equal(stats.retrievalFailures, 1);
  assert.equal(stats.conflicts, 1);
  assert.equal(stats.stale, 1);
  assert.equal(stats.crossConversation, 1);
  assert.equal(stats.workResumed, 1);
  assert.equal(stats.duplicatePrevented, 1);
  assert.equal(stats.approvals, 1);
  assert.equal(stats.rejections, 1);
  assert.equal(stats.governanceDenied, 1);
  assert.equal(stats.events, 12);
});

/* ------------------------------------------------------------------ */
/* 2. Levels: minute, hour, day, project, agent, conversation          */
/* ------------------------------------------------------------------ */

test("a snapshot reports every level the mission asks for", () => {
  const metrics = fresh();
  metrics.record({ kind: "retrieval", latencyMs: 42, items: 4, relevant: 2, conversationId: "chat-a", projectId: "p-1", agentId: "agent-1", at: NOW - 1000 });
  metrics.record({ kind: "memory-write", conversationId: "chat-a", projectId: "p-1", at: NOW - 2000 });
  metrics.record({ kind: "work-resumed", projectId: "p-2", conversationId: "chat-b", at: NOW - 25 * 60 * 60_000 });

  const snapshot = metrics.snapshot(NOW);
  assert.equal(snapshot.minute.events, 2, "the two events from a moment ago");
  assert.equal(snapshot.hour.events, 2);
  assert.equal(snapshot.day.events, 2, "yesterday's event is outside the day window");
  assert.equal(snapshot.total.events, 3);

  assert.equal(snapshot.byProject["p-1"].events, 2);
  assert.equal(snapshot.byProject["p-2"].workResumed, 1);
  assert.equal(snapshot.byConversation["chat-a"].retrievals, 1);
  assert.equal(snapshot.byAgent["agent-1"].retrievals, 1);
  assert.equal(snapshot.retained, 3);
  assert.equal(snapshot.since, NOW - 25 * 60 * 60_000);
});

/* ------------------------------------------------------------------ */
/* 3. Availability: measured, estimated, unavailable                   */
/* ------------------------------------------------------------------ */

test("an empty journal reports unavailable, not zero", () => {
  const snapshot = fresh().snapshot(NOW);
  assert.equal(snapshot.availability.retrievals, "unavailable");
  assert.equal(snapshot.availability.retrievalLatency, "unavailable");
  assert.equal(snapshot.availability.relevance, "unavailable");
  assert.equal(snapshot.retained, 0);
  assert.equal(snapshot.day.events, 0);
});

test("a metric becomes measured once something measured it", () => {
  const metrics = fresh();
  metrics.record({ kind: "retrieval", latencyMs: 12, items: 3, relevant: 3, at: NOW });
  const snapshot = metrics.snapshot(NOW);
  assert.equal(snapshot.availability.retrievals, "measured");
  assert.equal(snapshot.availability.retrievalLatency, "measured");
  assert.equal(snapshot.availability.relevance, "measured");
  assert.equal(snapshot.availability.stale, "unavailable", "no stale record was reported, so nothing is claimed");
});

test("whole-store consumption is declared unavailable, and the journal's own size is measured", () => {
  const metrics = fresh();
  metrics.record({ kind: "retrieval", latencyMs: 5, at: NOW });
  const snapshot = metrics.snapshot(NOW);
  assert.equal(snapshot.availability.totalStoreBytes, "unavailable");
  assert.equal(snapshot.storage.storeBytes, null);
  assert.equal(snapshot.availability.storageBytes, "measured");
  assert.ok(snapshot.storage.journalBytes > 0);
});

/* ------------------------------------------------------------------ */
/* 4. Controls and persistence                                         */
/* ------------------------------------------------------------------ */

test("recording can be paused and resumed", () => {
  const metrics = fresh();
  metrics.configure({ enabled: false });
  metrics.record({ kind: "retrieval", at: NOW });
  assert.equal(metrics.journal().length, 0, "nothing is recorded while paused");

  metrics.configure({ enabled: true });
  metrics.record({ kind: "retrieval", at: NOW });
  assert.equal(metrics.journal().length, 1);
});

test("retention and the event cap are enforced", () => {
  const metrics = fresh();
  metrics.configure({ retentionMs: 60_000, maxEvents: 3, enabled: true });
  metrics.record({ kind: "retrieval", at: NOW - 10 * 60_000 });
  for (let index = 0; index < 5; index += 1) {
    metrics.record({ kind: "retrieval", at: NOW - index });
  }
  const kept = metrics.journal();
  assert.ok(kept.length <= 3, `expected at most 3 retained, got ${kept.length}`);
  assert.ok(kept.every((entry) => entry.at >= NOW - 60_000), "the old event was aged out");
});

test("the journal survives a restart", () => {
  const metrics = fresh();
  metrics.record({ kind: "conflict", projectId: "p-9", at: NOW });

  MemoryObservability.resetForTests();
  const reloaded = MemoryObservability.getInstance();
  assert.equal(reloaded.journal().length, 1);
  assert.equal(reloaded.snapshot(NOW).byProject["p-9"].conflicts, 1);
});

test("clearing empties the journal and the store", () => {
  const metrics = fresh();
  metrics.record({ kind: "retrieval", at: NOW });
  metrics.clear();
  assert.equal(metrics.journal().length, 0);
  const stored = KvStore.getInstance().get<{ events: MemoryEvent[] }>(KEY);
  assert.equal(stored?.events.length ?? 0, 0, "the persisted journal was emptied too");
});
