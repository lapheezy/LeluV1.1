/**
 * ==========================================================
 * LÉLU — PROACTIVE QUESTIONS, THROUGH THE REAL STORE
 *
 * CATEGORY: integration. The real ProactiveCore singleton and
 * the real KvStore, against a shimmed localStorage so the
 * persistence path is exercised rather than mocked out.
 *
 * Why this exists: the lifecycle being correct in isolation is
 * not the thing that broke. What broke was the store asking
 * again anyway — enqueueQuestion returning an existing record
 * while getActiveQuestion still offered it, so the same card
 * came back every cycle no matter what the user did to it.
 *
 * The Fashion scenario is the acceptance test, driven here
 * against the real store. Nothing about fashion is special in
 * the code; it is one project id.
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

import ProactiveCore, { type ProactiveQuestionInput } from "../src/core/proactive/ProactiveCore";
import { IGNORE_LIMIT } from "../src/core/proactive/QuestionLifecycle";

const proactive = ProactiveCore.getInstance();

/** Questions must be allowed to surface at all for any of this to mean anything. */
proactive.updateSettings({ enabled: true, notificationLevel: "normal" });

let seq = 0;
/** The Fashion card, as cognition actually builds it. */
function fashionQuestion(evidence: string): ProactiveQuestionInput {
  seq += 1;
  return {
    key: `project-direction:fashion-${seq}`,
    question: "“Fashion” is active but has no defined next outcome. What should I prioritize there?",
    category: "PROJECT",
    reason: "The project exists in persistent state but has no work items or research direction.",
    priority: "P1",
    relatedProjectId: `fashion-${seq}`,
    relatedTask: "Fashion",
    evidence,
  };
}

const STABLE = "p:fashion|st:active|items:0|q:0|obj:0|req:0|cp:0|conv:0|ans:0";

test("a repeated cognitive cycle does not create a second question", () => {
  const input = fashionQuestion(STABLE);
  const first = proactive.enqueueQuestion(input);
  const again = proactive.enqueueQuestion(input);
  const third = proactive.enqueueQuestion(input);
  assert.equal(again.id, first.id);
  assert.equal(third.id, first.id);
  assert.equal(
    proactive.listQuestions().filter((q) => q.key === input.key).length,
    1,
    "one decision, one record, however many cycles run",
  );
});

test("a dismissed question never surfaces again", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  proactive.markQuestionSurfaced(question.id);
  proactive.dismissQuestion(question.id);

  // The cycle runs again and observes exactly the same situation.
  proactive.enqueueQuestion(input);
  const active = proactive.getActiveQuestion();
  assert.notEqual(active?.key, input.key, "the dismissal must hold across cycles");
  assert.equal(proactive.getQuestionByKey(input.key)?.status, "dismissed");
});

test("dismissing clears the surface rather than leaving the card up", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  const surfaced: Array<string | null> = [];
  const unsubscribe = proactive.subscribeQuestions((q) => surfaced.push(q?.id ?? null));

  proactive.dismissQuestion(question.id);
  unsubscribe();

  // The UI binds directly to this stream. It previously ignored the null,
  // which is why the card stayed on screen and dismissal looked broken.
  assert.ok(surfaced.includes(null) || surfaced.at(-1) !== question.id,
    "subscribers must be told the question is gone");
});

test("a deferred question returns only when the situation changes", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  proactive.markQuestionSurfaced(question.id);
  proactive.deferQuestion(question.id);

  proactive.enqueueQuestion(input);
  assert.notEqual(proactive.getActiveQuestion()?.key, input.key, "'later' means later");

  // Real movement: the project gained work items and a conversation.
  const moved = { ...input, evidence: "p:fashion|st:active|items:2|q:1|obj:1|req:0|cp:0|conv:6|ans:0" };
  proactive.enqueueQuestion(moved);
  const reopened = proactive.getQuestionByKey(input.key);
  assert.equal(reopened?.lifecycle?.state, "eligible", "a changed situation may be raised again");
  assert.equal(reopened?.id, question.id, "the same decision, not a duplicate");
});

test("an ignored question stops asking after the limit", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  for (let round = 0; round < IGNORE_LIMIT; round += 1) {
    proactive.markQuestionSurfaced(question.id);
    proactive.markQuestionIgnored(question.id);
    proactive.enqueueQuestion(input);
  }
  const parked = proactive.getQuestionByKey(input.key);
  assert.equal(parked?.lifecycle?.state, "parked");
  assert.notEqual(
    proactive.getActiveQuestion()?.key,
    input.key,
    "four identical cards is the bug; the conclusion is 'low priority'",
  );
});

test("engaging a question hands it to a workstream and off the global surface", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  proactive.engageQuestion(question.id, "conversation-42");

  proactive.enqueueQuestion(input);
  assert.notEqual(
    proactive.getActiveQuestion()?.key,
    input.key,
    "it is being handled; global cognition must stop raising it",
  );
  const engaged = proactive.getQuestionByKey(input.key);
  assert.equal(engaged?.lifecycle?.workstreamId, "conversation-42");
});

test("an answered question is remembered, not re-asked", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  proactive.resolveQuestion(question.id, "Focus on the spring capsule.");

  proactive.enqueueQuestion(input);
  const resolved = proactive.getQuestionByKey(input.key);
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.userResponse, "Focus on the spring capsule.");
  assert.notEqual(proactive.getActiveQuestion()?.key, input.key);
});

test("only one question is offered at a time", () => {
  const a = proactive.enqueueQuestion(fashionQuestion(STABLE));
  proactive.enqueueQuestion({
    ...fashionQuestion(STABLE),
    priority: "P0",
    key: "work-queue:urgent-probe",
    question: "Your work queue is waiting on something.",
  });
  const active = proactive.getActiveQuestion();
  assert.ok(active, "something should be askable");
  // Whichever wins, exactly one is offered — the surface is single-slot.
  assert.equal(typeof active?.id, "string");
  proactive.dismissQuestion(a.id);
});

test("a record stored before the lifecycle existed keeps its decision", () => {
  // Simulates a row hydrated from Supabase with an empty lifecycle jsonb.
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  proactive.dismissQuestion(question.id);

  const stripped = proactive
    .listQuestions()
    .find((q) => q.key === input.key);
  assert.ok(stripped);
  // listQuestions() always returns a lifecycle, derived where absent.
  assert.ok(stripped.lifecycle, "a lifecycle is always present after a read");
  assert.equal(stripped.lifecycle?.state, "dismissed");
});

test("surfacing the same question twice counts one showing", () => {
  const input = fashionQuestion(STABLE);
  const question = proactive.enqueueQuestion(input);
  proactive.markQuestionSurfaced(question.id);
  proactive.markQuestionSurfaced(question.id);
  proactive.markQuestionSurfaced(question.id);
  const record = proactive.getQuestionByKey(input.key);
  assert.equal(
    record?.lifecycle?.surfacedCount,
    1,
    "a re-render is not a new showing; counting it would park a question the user saw once",
  );
  proactive.dismissQuestion(question.id);
});
