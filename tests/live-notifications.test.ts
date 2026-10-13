/**
 * ==========================================================
 * LÉLU — NOTIFICATIONS COME FROM LIVE COGNITION
 *
 * CATEGORY: integration. The real ProactiveCore and KvStore.
 *
 * Why this exists: the Fashion card survived the lifecycle
 * work. It was a record PERSISTED BY AN EARLIER BUILD, with
 * status "pending" and no lifecycle, so every load read it as
 * a live question and surfaced it — about a project cognition
 * was not currently thinking about at all. That is why it
 * read as pre-made rather than live.
 *
 * A durable record is history. The surface is not: nothing is
 * shown unless cognition raised it in THIS process.
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

import KvStore from "../src/core/storage/KvStore";
import ProactiveCore from "../src/core/proactive/ProactiveCore";

/**
 * A question left behind by an earlier build: pending, no lifecycle.
 * Written straight to storage, exactly as a stale record arrives.
 */
const STALE = {
  id: "stale-fashion",
  key: "project-direction:fashion-legacy",
  question: "“Fashion” is active but has no defined next outcome. What should I prioritize there?",
  category: "PROJECT",
  reason: "The project exists in persistent state but has no work items or research direction.",
  priority: "P1",
  relatedProjectId: "fashion-legacy",
  blocksExecution: false,
  rememberAnswer: true,
  askedAt: Date.now() - 86_400_000,
  status: "pending",
  createdAt: Date.now() - 86_400_000,
  updatedAt: Date.now() - 86_400_000,
};
KvStore.getInstance().set("proactive.questions.v1", [STALE]);

const proactive = ProactiveCore.getInstance();
proactive.updateSettings({ enabled: true, notificationLevel: "normal" });

test("a question persisted by an earlier build does not surface on load", () => {
  // The reported bug, exactly: it is pending, so the old code showed it.
  assert.equal(
    proactive.getActiveQuestion(),
    null,
    "a stale record is history, not something cognition is asking now",
  );
});

test("the stale record is kept, not deleted", () => {
  // It carries the user's history; losing it would lose their decisions.
  const found = proactive.getQuestionByKey(STALE.key);
  assert.ok(found, "the record must survive");
  assert.equal(found.status, "pending");
});

test("cognition raising it is what makes it visible", () => {
  proactive.enqueueQuestion({
    key: STALE.key,
    question: STALE.question,
    category: "PROJECT",
    reason: STALE.reason,
    priority: "P1",
    relatedProjectId: STALE.relatedProjectId,
    evidence: "p:fashion-legacy|items:0",
  });
  assert.equal(
    proactive.getActiveQuestion()?.key,
    STALE.key,
    "once live cognition raises it, it is a real question again",
  );
});

test("a dismissal still holds after cognition re-raises it", () => {
  const active = proactive.getActiveQuestion();
  assert.ok(active);
  proactive.dismissQuestion(active.id);
  proactive.enqueueQuestion({
    key: STALE.key,
    question: STALE.question,
    category: "PROJECT",
    reason: STALE.reason,
    priority: "P1",
    relatedProjectId: STALE.relatedProjectId,
    evidence: "p:fashion-legacy|items:0",
  });
  assert.notEqual(proactive.getActiveQuestion()?.key, STALE.key);
});

test("affirmation is per-process, so it cannot be persisted back in", () => {
  // If this leaked into storage, the stale-card bug would return on the next
  // load — the surface would again be decided by a file rather than by
  // cognition.
  const raw = KvStore.getInstance().get<unknown[]>("proactive.questions.v1") ?? [];
  assert.ok(
    !JSON.stringify(raw).includes("affirmed"),
    "the affirmed set must never be written to storage",
  );
});
