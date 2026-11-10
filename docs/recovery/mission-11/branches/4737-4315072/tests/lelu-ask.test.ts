/**
 * ==========================================================
 * LÉLU ASKS — the question on screen, and the answer that
 * actually resolves it
 *
 * CATEGORY: unit + integration-by-source. The question surface is
 * the real ProactiveCore card in GenesisChat; what is tested here
 * is that it only shows the question this conversation owns, that
 * a draft never follows a different question, and that submitting
 * calls the existing resolver with the user's own words.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { answerToSubmit, nextAnswerDraft, questionOnScreen } from "../src/app/scene/genesis/chat/askQuestion";
import type { ProactiveQuestion } from "../src/core/proactive/ProactiveCore";

const question = (overrides: Partial<ProactiveQuestion> & { id: string }): ProactiveQuestion => ({
  question: "Which direction should the capsule take?",
  reason: "Three options were found and only you can choose.",
  category: "CURIOSITY",
  priority: "P2",
  status: "pending",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
} as ProactiveQuestion);

test("a question is shown in the conversation that asked it", () => {
  const asked = question({ id: "q1", conversationId: "chat-a" } as Partial<ProactiveQuestion>);
  assert.equal(questionOnScreen(asked, { activeConversationId: "chat-a" })?.id, "q1");
  assert.equal(
    questionOnScreen(asked, { activeConversationId: "chat-b" }),
    null,
    "another chat's question must not appear under this one",
  );
});

test("a global question waits for the user to open it", () => {
  const global = question({ id: "q2" });
  assert.equal(questionOnScreen(global, { activeConversationId: "chat-a" }), null);
  assert.equal(
    questionOnScreen(global, { activeConversationId: "chat-a", openedQuestionId: "q2" })?.id,
    "q2",
    "opening it from notifications shows it",
  );
});

test("resolved and dismissed questions are never painted again", () => {
  for (const status of ["resolved", "dismissed"] as const) {
    const stale = question({ id: "q3", conversationId: "chat-a", status } as Partial<ProactiveQuestion>);
    assert.equal(questionOnScreen(stale, { activeConversationId: "chat-a" }), null);
  }
  assert.equal(questionOnScreen(null, { activeConversationId: "chat-a" }), null);
});

test("a draft belongs to the question it was typed for", () => {
  const first = question({ id: "q1" });
  const second = question({ id: "q2" });
  assert.equal(nextAnswerDraft("q1", first, "half typed"), "half typed");
  assert.equal(nextAnswerDraft("q1", second, "half typed"), "", "a new question starts empty");
  assert.equal(nextAnswerDraft(null, first, "stale"), "");
  assert.equal(nextAnswerDraft("q1", null, "half typed"), "", "no question, no draft");
});

test("an empty or blank answer is not submitted", () => {
  assert.equal(answerToSubmit(""), null);
  assert.equal(answerToSubmit("   \n "), null);
  assert.equal(answerToSubmit("  Lead with colour  "), "Lead with colour", "the user's own words, trimmed");
});

test("the surface reflects the real state and submits to the real resolver", () => {
  const chat = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");

  assert.match(chat, /questionOnScreen\(activeQuestion, \{/, "which question shows comes from ProactiveCore's state");
  assert.match(chat, /nextAnswerDraft\(activeQuestionIdRef\.current, question, current\)/);

  // The answer goes to the existing resolver, verbatim — one path only.
  assert.match(chat, /const answer = answerDraft\.trim\(\);/);
  assert.match(chat, /if \(!answer\) return;/);
  assert.match(chat, /proactive\.resolveQuestion\(question\.id, answer\)/);
  assert.equal(
    (chat.match(/proactive\.resolveQuestion\(/g) ?? []).length,
    2,
    "the question card answers through the resolver, and 'Explore' resolves in place — no third path",
  );

  // A real, tappable field: labelled, addressable, and not eaten by an overlay.
  assert.match(chat, /data-lelu-question-answer/);
  assert.match(chat, /data-lelu-question-submit/);
  assert.match(chat, /aria-label="Answer LÉLU's question"/);
  assert.match(chat, /pointerEvents: "auto"/);
  assert.match(chat, /touchAction: "manipulation"/);
  assert.match(chat, /answerInputRef/, "the field can be focused deliberately");
});

test("the answer field is a text input that submits on Enter and stays tappable", () => {
  const chat = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");
  const input = chat.slice(chat.indexOf("data-lelu-question-answer") - 400, chat.indexOf("data-lelu-question-answer") + 1200);
  assert.match(input, /<input/, "a single-line answer field, so the phone keyboard is a text keyboard");
  assert.match(chat, /onSubmit=\{\(event\) => \{\s*event\.preventDefault\(\);\s*answerQuestion\(shownQuestion\);/, "Enter submits through the form");
  assert.match(chat, /fontSize: 16/, "16px stops iOS zooming the page when the field is focused");
});
