/**
 * ==========================================================
 * LÉLU — KNOWLEDGE SUPERSESSION
 *
 * CATEGORY: unit. Pure selection rule, no store.
 *
 * M22.5 recorded that knowledge was append-only: `Brain.persistLayer`
 * de-duplicated identical text and otherwise added a new item, so a
 * corrected discovery produced two retrievable facts. The fix is a
 * deliberately narrow selector, tested here on its own so the boundary
 * between "correction" and "unrelated fact" is pinned rather than implied.
 *
 * What must hold:
 *   - a correction of the same kind of knowledge replaces it
 *   - an explicit shared key is enough, even when the words differ
 *   - two unrelated discoveries are NOT merged because they share a word
 *   - a SYSTEM memory never supersedes a KNOWLEDGE one
 *   - the identity seed is never replaced
 */

import assert from "node:assert/strict";
import test from "node:test";

import { findKnowledgeToSupersede } from "../src/brain/Brain";
import type ResponsePattern from "../src/brain/ResponsePattern";

function pattern(overrides: Partial<ResponsePattern> = {}): ResponsePattern {
  return {
    id: "p-1",
    category: "general",
    prompt: "What did we learn?",
    response: "The archive migration target is FIELDNOTE.",
    intent: "knowledge",
    keywords: ["archive", "fieldnote"],
    context: { source: "research" },
    memoryType: "knowledge",
    importance: 0.5,
    confidence: 0.9,
    successfulUses: 1,
    failedUses: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ResponsePattern;
}

const incoming = (overrides: Partial<Parameters<typeof findKnowledgeToSupersede>[1]> = {}) => ({
  content: "Correction: the archive migration target is FIELDGLASS, not FIELDNOTE.",
  keywords: ["archive", "fieldnote"],
  memoryType: "knowledge" as const,
  category: "general",
  ...overrides,
});

test("a correction replaces the knowledge item it corrects", () => {
  const target = findKnowledgeToSupersede([pattern()], incoming());
  assert.equal(target?.id, "p-1");
});

test("a correction with only one shared word is not treated as the same fact", () => {
  const target = findKnowledgeToSupersede(
    [pattern()],
    incoming({ keywords: ["archive", "completely", "different"] }),
  );
  assert.equal(target, undefined, "one shared word must not merge unrelated knowledge");
});

test("an explicit shared supersedesKey is enough on its own", () => {
  const target = findKnowledgeToSupersede(
    [pattern({ context: { source: "agent", supersedesKey: "archive-target" } })],
    incoming({
      keywords: ["totally", "different", "words"],
      provenance: { supersedes: true, supersedesKey: "archive-target" },
    }),
  );
  assert.equal(target?.id, "p-1");
});

test("without a correction marker or an explicit flag, nothing is superseded", () => {
  const target = findKnowledgeToSupersede(
    [pattern()],
    incoming({
      content: "The archive migration target is FIELDNOTE and it also needs a checksum.",
    }),
  );
  assert.equal(target, undefined, "an addition is not a correction");
});

test("a system memory never supersedes a knowledge one", () => {
  const target = findKnowledgeToSupersede(
    [pattern({ memoryType: "system" })],
    incoming({ memoryType: "knowledge" }),
  );
  assert.equal(target, undefined);
});

test("the identity seed is never replaced", () => {
  const target = findKnowledgeToSupersede(
    [pattern({ id: "lelu-identity-foundation" })],
    incoming({ provenance: { supersedes: true } }),
  );
  assert.equal(target, undefined);
});

test("identical text is left to the ordinary de-duplication path", () => {
  const target = findKnowledgeToSupersede(
    [pattern({ response: incoming().content })],
    incoming({ provenance: { supersedes: true } }),
  );
  assert.equal(target, undefined);
});
