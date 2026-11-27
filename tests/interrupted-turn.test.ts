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
import { interruptedTurnText } from "../src/core/multichat/interruptedTurn";

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
