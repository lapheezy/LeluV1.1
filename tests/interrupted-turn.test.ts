/**
 * ==========================================================
 * LÉLU — A QUESTION LEFT WITHOUT A TURN
 *
 * CATEGORY: unit, over the state a reload mid-generation really leaves.
 *
 * Measured on a 390x844 page (Mission 44.6): the question was stored, the page
 * was reloaded while the turn was streaming, and afterwards the conversation
 * ended with that question and nothing else — no reply, no failure, no
 * control. The predicate here is what tells the chat surfaces to say so and
 * offer the same "Try again" a failed turn gets.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { interruptedTurnText, reusableRetryId } from "../src/core/multichat/interruptedTurn";

const PAGE_START = 1_800_000_000_000;
const before = PAGE_START - 120_000;
const after = PAGE_START + 5_000;

test("a question stored before this page loaded, with no reply, is reported", () => {
  const messages = [
    { role: "user", text: "Which branch is checked out?", timestamp: before },
  ];
  assert.equal(
    interruptedTurnText(messages, PAGE_START, false),
    "Which branch is checked out?",
    "the turn died with the previous page and nothing said so",
  );
});

test("a question this page is still working on is not", () => {
  const messages = [{ role: "user", text: "hello", timestamp: after }];
  assert.equal(interruptedTurnText(messages, PAGE_START, false), null);
  const older = [{ role: "user", text: "hello", timestamp: before }];
  assert.equal(interruptedTurnText(older, PAGE_START, true), null, "processing is never 'stopped'");
});

test("an answered conversation is never reported, however old it is", () => {
  const messages = [
    { role: "user", text: "hello", timestamp: before },
    { role: "assistant", text: "hi", timestamp: before + 1_000 },
  ];
  assert.equal(interruptedTurnText(messages, PAGE_START, false), null);
  assert.equal(interruptedTurnText([], PAGE_START, false), null);
});

test("a stored message with no text is not a question to resend", () => {
  assert.equal(interruptedTurnText([{ role: "user", text: "   ", timestamp: before }], PAGE_START, false), null);
  assert.equal(interruptedTurnText([{ role: "user", timestamp: before }], PAGE_START, false), null);
});

/**
 * Mission 44.7, measured in the Chat Universe window: pressing "Try again" on
 * the interrupted-turn notice appended the same question a second time and
 * answered it, so the thread read question, question, answer.
 */
test("a retry reuses the unanswered question instead of stacking a copy of it", () => {
  const messages = [{ id: "m1", role: "user", text: "Which branch is checked out?", timestamp: before }];
  assert.equal(reusableRetryId(messages, "  Which branch is checked out? "), "m1");
  // Nothing to reuse: an empty conversation, a different question, no id.
  assert.equal(reusableRetryId([], "hello"), null);
  assert.equal(reusableRetryId(messages, "something else"), null);
  assert.equal(reusableRetryId([{ role: "user", text: "x" }], "x"), null);
});

test("after a visible failure the retry is a new turn, and the failure stays readable", () => {
  const messages = [
    { id: "m1", role: "user", text: "Build it", timestamp: before },
    { id: "m2", role: "assistant", text: "The provider failed.", timestamp: before + 1_000 },
  ];
  assert.equal(reusableRetryId(messages, "Build it"), null);
});

