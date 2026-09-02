/**
 * ==========================================================
 * LÉLU — PROJECT INTERPRETATION REGRESSION TESTS
 *
 * Pin the behaviour that regressed:
 *
 *   - project work stated conversationally is recognised at all
 *   - an unresolved reference is NEVER written into project state
 *   - the parser's title derivation is the fallback, not the authority
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

import IntentDetector from "../src/core/router/IntentDetector";
import { containsUnresolvedReference } from "../src/core/projects/ProjectInterpreter";
import ProjectRequestParser from "../src/core/projects/ProjectRequestParser";
import MemoryExtractor from "../src/brain/MemoryExtractor";

// ============================================================
// PROJECT WORK STATED WITHOUT THE WORD "PROJECT"
// ============================================================

test("work handed over conversationally reaches the project path", () => {
  const detector = new IntentDetector();
  for (const phrase of [
    "I have an idea for a pendant collection.",
    "I want a pendant collection.",
    "Make the collection larger and add three designs.",
    "Start working on it.",
    "Continue the pendant collection.",
    "Use platinum.",
  ]) {
    assert.equal(
      detector.detect(phrase),
      "project",
      `"${phrase}" must reach cognition's project interpreter`,
    );
  }
});

test("ordinary conversation is not dragged into the project path", () => {
  const detector = new IntentDetector();
  for (const phrase of ["hello", "who are you?", "what time is it?", "thanks!"]) {
    assert.notEqual(detector.detect(phrase), "project", `"${phrase}" must stay conversational`);
  }
});

// ============================================================
// UNRESOLVED REFERENCES MUST NEVER BE PERSISTED
// ============================================================

test("a deictic phrase is recognised as an unresolved reference", () => {
  for (const text of ["that metal", "that", "it", "this one", "those designs", "the collection"]) {
    assert.ok(
      containsUnresolvedReference(text),
      `"${text}" is a reference, not a value — it must never be stored`,
    );
  }
});

test("a real value is not mistaken for an unresolved reference", () => {
  for (const text of ["platinum", "18k rose gold", "Pendant Collection", "sterling silver"]) {
    assert.ok(
      !containsUnresolvedReference(text),
      `"${text}" is a real value and must be storable`,
    );
  }
});

// ============================================================
// THE PARSER IS A FALLBACK — AND ITS LIMITS ARE REAL
// ============================================================

test("the parser still mangles the sentence that started this — which is why it is not the authority", () => {
  // This documents WHY interpretation moved to cognition. The parser
  // takes everything after the word "project" and keeps six words, so a
  // reference at the end of the sentence is simply cut off. It is kept
  // only for when no provider can be reached, and its output is labelled
  // as parsed rather than understood.
  const parsed = new ProjectRequestParser().parse(
    "Create a project brief for a pendant collection in that metal.",
  );
  assert.ok(
    !/platinum/i.test(parsed.name),
    "a string parser cannot resolve 'that metal' — only cognition can",
  );
  assert.ok(
    parsed.originalRequest.includes("that metal"),
    "the full instruction is still preserved verbatim for cognition to read",
  );
});

// ============================================================
// DECISIONS ARE DURABLE FACTS
// ============================================================

test("a decision about the work is durable, so it can be recalled later", () => {
  const extractor = new MemoryExtractor();
  for (const decision of [
    "Use platinum.",
    "Switch to sterling silver.",
    "Platinum supersedes rose gold.",
  ]) {
    const extracted = extractor.extract(decision, "");
    const best = extracted.reduce((a, b) => (a.importance >= b.importance ? a : b));
    assert.ok(
      best.importance >= 0.5,
      `"${decision}" must clear the durability gate (got ${best.importance})`,
    );
  }
});
