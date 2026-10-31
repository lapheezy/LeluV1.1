/**
 * LÉLU — IDENTITY QUESTIONS vs EVERYDAY QUESTIONS
 *
 * The deterministic identity path answers "who/what are you" with her
 * foundational self-description. It must not swallow everyday questions
 * that merely contain "what are you" — "what are you working on?" is the
 * question the owner asks most, and it has to reach cognition.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { isLeluIdentityQuestion } from "../src/brain/LeluIdentity";

test("real identity questions still take the identity path", () => {
  for (const q of [
    "Who are you?",
    "What are you?",
    "what are you, exactly?",
    "Lélu, what are you?",
    "Hello Lélu, what are you?",
    "What is your name?",
    "Who made you?",
    "What can you do?",
    "Tell me about yourself.",
  ]) {
    assert.equal(isLeluIdentityQuestion(q), true, q);
  }
});

test("everyday questions containing 'what are you' reach cognition", () => {
  for (const q of [
    "What are you working on right now?",
    "Hello Lélu, what are you working on right now?",
    "what are you doing?",
    "What are you thinking about?",
    "what are you researching today?",
    "What are you up to?",
  ]) {
    assert.equal(isLeluIdentityQuestion(q), false, q);
  }
});
