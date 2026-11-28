/**
 * ==========================================================
 * LÉLU — WHAT A REMEMBERED FACT IS WORTH
 *
 * Mission 44.8 WP02. Every claim that comes from memory has to be
 * able to say: which record, when it was recorded, when it was read,
 * whether it was verified, whether it is an inference, whether
 * something else disagrees with it, and whether something newer
 * replaced it.
 *
 * The test that matters most is the last group: a historical memory
 * must never be presented as a current fact. Every assertion here is
 * about the words a reader would see, not about an internal flag.
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

import {
  describeReading,
  memoryProvenanceNote,
  memoryToolLines,
  readMemory,
  HISTORICAL_AFTER_MS,
  STALE_AFTER_MS,
  type MemoryLike,
} from "../src/core/memory/MemoryProvenance";

const NOW = Date.UTC(2026, 10, 28, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

/** A record shaped like what Brain.recall() actually returns. */
function memory(overrides: Partial<MemoryLike> = {}): MemoryLike {
  return {
    id: "m-1",
    prompt: "what metal do I work in",
    response: "I work exclusively in platinum.",
    category: "preference",
    keywords: ["platinum", "metal"],
    importance: 0.75,
    confidence: 1,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    context: { conversationId: "c-1", conversationTitle: "Jewellery direction" },
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* 1. The six states                                                   */
/* ------------------------------------------------------------------ */

test("a recent, sourced record is current", () => {
  const result = readMemory([memory()], { now: NOW });
  assert.equal(result.records[0].status, "current");
  assert.equal(result.records[0].evidence, "memory");
  assert.equal(result.counts.current, 1);
  assert.equal(result.retrievedAt, NOW, "the reading carries when it was read");
});

test("a record older than a week is historical, not current", () => {
  const at = NOW - (HISTORICAL_AFTER_MS + DAY);
  const result = readMemory([memory({ createdAt: at, updatedAt: at })], { now: NOW });
  assert.equal(result.records[0].status, "historical");
});

test("a record older than a month is stale", () => {
  const at = NOW - (STALE_AFTER_MS + DAY);
  const result = readMemory([memory({ createdAt: at, updatedAt: at })], { now: NOW });
  assert.equal(result.records[0].status, "stale");
});

test("a record stored at low confidence is stale even when it is recent", () => {
  const result = readMemory([memory({ confidence: 0.2 })], { now: NOW });
  assert.equal(result.records[0].status, "stale");
  assert.ok(result.records[0].reasons.join(" ").includes("low confidence"));
});

test("an undated record is incomplete, and says it cannot be dated", () => {
  const result = readMemory([memory({ createdAt: undefined, updatedAt: undefined, context: {} })], { now: NOW });
  const reading = result.records[0];
  assert.equal(reading.status, "incomplete");
  assert.equal(reading.recordedAt, null);
  assert.equal(reading.evidence, "unverified", "nothing about it can be confirmed");
  assert.ok(reading.reasons.some((reason) => /cannot be dated/.test(reason)));
});

test("a record with no source is marked as unsourced", () => {
  const result = readMemory([memory({ context: {} })], { now: NOW });
  assert.ok(result.records[0].reasons.some((reason) => /does not say where it came from/.test(reason)));
});

/* ------------------------------------------------------------------ */
/* 2. Conflicting and superseded records                               */
/* ------------------------------------------------------------------ */

test("two records that disagree are both flagged, and the newer one is named", () => {
  const older = memory({
    id: "m-rose",
    response: "I work exclusively in 18k rose gold.",
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 10 * DAY,
  });
  const newer = memory({
    id: "m-platinum",
    response: "I no longer work in rose gold; it is platinum now.",
    createdAt: NOW - 2 * DAY,
    updatedAt: NOW - 2 * DAY,
  });

  const result = readMemory([older, newer], { now: NOW });

  assert.equal(result.conflicts.length, 1, "the disagreement is detected");
  assert.equal(result.conflicts[0].resolution, "newer-wins");
  const byId = new Map(result.records.map((reading) => [reading.id, reading]));
  assert.equal(byId.get("m-platinum")?.status, "conflicting", "the current value is contested");
  assert.equal(byId.get("m-rose")?.status, "superseded", "the older value is superseded");
  assert.deepEqual(byId.get("m-platinum")?.conflictedWith, ["m-rose"]);
  assert.deepEqual(byId.get("m-rose")?.conflictedWith, ["m-platinum"]);
});

test("two records with the same timestamp are left unresolved rather than guessed", () => {
  const a = memory({ id: "a", response: "I work in rose gold.", createdAt: NOW - DAY, updatedAt: NOW - DAY });
  const b = memory({
    id: "b",
    response: "I do not work in rose gold any more.",
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
  });
  const result = readMemory([a, b], { now: NOW });
  assert.equal(result.conflicts[0].resolution, "unresolved");
  assert.ok(/no honest way to choose/.test(result.conflicts[0].note));
});

test("a record that superseded an earlier statement keeps that statement visible", () => {
  const corrected = memory({
    response: "platinum, not rose gold\n(Superseded earlier statement, kept for the details it still carries: 18k rose gold at Aurelia)",
    context: {
      conversationId: "c-1",
      conversationTitle: "Jewellery direction",
      history: ["I work exclusively in 18k rose gold."],
    },
  });
  const result = readMemory([corrected], { now: NOW });

  assert.deepEqual(result.records[0].supersedes, ["I work exclusively in 18k rose gold."]);
  const note = memoryProvenanceNote(result);
  assert.ok(/superseded by/.test(note), "the correction is stated as a correction");
  assert.ok(/kept only for the details/.test(note));
});

/* ------------------------------------------------------------------ */
/* 3. Evidence classes — the five 44.7 classifications, preserved       */
/* ------------------------------------------------------------------ */

test("a tool-backed record is current-turn evidence; an inference is inference", () => {
  const backed = readMemory([memory({ context: { conversationId: "c-1", executionVerified: true } })], { now: NOW });
  assert.equal(backed.records[0].evidence, "current-turn");
  assert.equal(backed.records[0].verified, true);

  const inferred = readMemory([memory({ context: { conversationId: "c-1", inferred: true } })], { now: NOW });
  assert.equal(inferred.records[0].evidence, "inference");
  assert.equal(inferred.records[0].inference, true);
});

/* ------------------------------------------------------------------ */
/* 4. The notes: historical memory is never presented as current        */
/* ------------------------------------------------------------------ */

test("a historical memory's note leads with the limitation and names the date", () => {
  const at = NOW - 10 * DAY;
  const result = readMemory([memory({ createdAt: at, updatedAt: at })], { now: NOW });
  const note = memoryProvenanceNote(result);

  assert.ok(note.startsWith("⚠️ From memory, not a fresh check"), `got: ${note}`);
  assert.ok(note.includes("2026-11-18"), "the recording date is stated");
  assert.ok(note.includes("10 days ago"), "the age is stated");
  assert.ok(note.includes("Jewellery direction"), "the source conversation is stated");
  assert.ok(!/^From memory, recorded/.test(note), "it must not read as a current fact");
});

test("a conflicting memory's note says neither value was verified", () => {
  const result = readMemory(
    [
      memory({ id: "a", response: "The launch is in March.", createdAt: NOW - 9 * DAY, updatedAt: NOW - 9 * DAY }),
      memory({
        id: "b",
        response: "The launch is not in March; it moved to May.",
        createdAt: NOW - DAY,
        updatedAt: NOW - DAY,
      }),
    ],
    { now: NOW },
  );
  const note = memoryProvenanceNote(result);
  assert.ok(/Memory conflict/.test(note));
  assert.ok(/neither was verified in this turn/.test(note));
});

test("a current record with a source produces no warning note", () => {
  const result = readMemory([memory()], { now: NOW });
  assert.equal(memoryProvenanceNote(result), "");
});

test("the tool view dates every record and reports conflicts", () => {
  const result = readMemory(
    [
      memory({ id: "a", response: "The launch is in March.", createdAt: NOW - 2 * DAY, updatedAt: NOW - 2 * DAY }),
      memory({
        id: "b",
        response: "The launch is not in March any more.",
        createdAt: NOW - DAY,
        updatedAt: NOW - DAY,
      }),
    ],
    { now: NOW },
  );
  const lines = memoryToolLines(result);
  assert.ok(lines[0].includes("superseded"), "the older half of the contradiction is labelled");
  assert.ok(lines[1].includes("conflicting"), "the contested half is labelled");
  assert.ok(lines[0].includes("2026-11-26"), "the date is on the line, not only in the note");
  assert.ok(lines.some((line) => line.startsWith("! Conflict:")));
  assert.ok(lines.some((line) => /no recorded time or source/.test(line)) === false);
});

test("every reading explains itself in words a person can check", () => {
  const reading = readMemory([memory()], { now: NOW }).records[0];
  const described = describeReading(reading);
  assert.ok(described.startsWith("current"));
  assert.ok(/recorded 2026-11-27 \(1 day ago\)/.test(described));
  assert.ok(/from the chat “Jewellery direction”/.test(described));
});
