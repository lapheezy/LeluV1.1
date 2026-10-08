/**
 * ==========================================================
 * LÉLU — SUPABASE SCHEMA CONTRACT
 *
 * CATEGORY: unit. Reads the real source tree; no network.
 *
 * Why this exists: every defect this file guards was found by
 * running the statements against the live project, not by
 * reading the code — because wrong Supabase wiring does not
 * fail at compile time. It fails at runtime, inside a
 * try/catch that downgrades status to "degraded" and keeps
 * going, so the feature is simply never persisted and nobody
 * is told.
 *
 * Verified against project nrehsldbfxthspikaxvr:
 *   - upsert conflict targets must name a real unique index,
 *     or Postgres rejects the statement (42P10 / 42703).
 *     user_preferences is (user_id, preference_key) and has no
 *     id column at all; cognitive_events is unique on (id)
 *     only and is append-only.
 *   - the OG surface queried `memories` and `memory_events`.
 *     Neither exists: the first was renamed legacy_memories by
 *     the migration, the second never existed here.
 *   - persisted message text must not be capped below the
 *     longest stored message, or hydrate → persist shortens
 *     real history on every round trip.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  fromOgImportance,
  matchesSearch,
  toMemoryItemPatch,
  toOgImportance,
  toOgMemory,
} from "../src/og/lib/memory-mapping";

const persistence = readFileSync("src/core/persistence/SupabasePersistence.ts", "utf8");

/** Unique indexes that actually exist on the live project. */
const REAL_UNIQUE_INDEX: Record<string, string> = {
  memory_items: "id,user_id",
  conversations: "id,user_id",
  messages: "id,user_id",
  projects: "id,user_id",
  agents: "id,user_id",
  improvement_items: "id,user_id",
  knowledge_items: "id,user_id",
  ui_state: "user_id",
  news_preferences: "user_id",
  api_health: "user_id,provider",
  user_preferences: "user_id,preference_key",
  proactive_questions: "user_id,question_key",
};

test("conflictKey names a real unique index for every upserted table", () => {
  const body = persistence.slice(
    persistence.indexOf("private conflictKey("),
    persistence.indexOf("private toMemory("),
  );
  assert.ok(body.length > 0, "conflictKey not found");

  // Tables with a non-default conflict target must be named explicitly.
  for (const [table, index] of Object.entries(REAL_UNIQUE_INDEX)) {
    if (index === "id,user_id") continue;
    assert.ok(
      body.includes(`"${table}"`),
      `${table} upserts on ${index}, not the default (id,user_id), so conflictKey must special-case it`,
    );
    assert.ok(body.includes(`"${index}"`), `conflictKey must return "${index}" for ${table}`);
  }
});

test("user_preferences does not upsert on a column it does not have", () => {
  // The live table is (user_id, preference_key, value, updated_at) — no id.
  const body = persistence.slice(persistence.indexOf("private conflictKey("));
  const upToReturn = body.slice(0, body.indexOf("return \"id,user_id\""));
  assert.match(
    upToReturn,
    /user_preferences"\)\s*return\s*"user_id,preference_key"/,
    "user_preferences must resolve before the (id,user_id) default",
  );
});

test("cognitive_events is appended, never upserted", () => {
  // Unique on (id) only, so an (id,user_id) conflict target fails with 42P10.
  assert.ok(
    persistence.includes('this.append("cognitive_events"'),
    "cognitive_events must go through the append path",
  );
  assert.ok(
    !persistence.includes('this.write("cognitive_events"'),
    "cognitive_events must not be upserted",
  );
  assert.ok(
    !/from\("cognitive_events"\)\.insert/.test(persistence),
    "cognitive_events writes should share the one append path",
  );
});

test("persisted message text is not capped below real stored history", () => {
  const match = persistence.match(/MESSAGE_TEXT_LIMIT\s*=\s*([\d_]+)/);
  assert.ok(match, "MESSAGE_TEXT_LIMIT must be declared");
  const limit = Number(match[1].replace(/_/g, ""));
  // Longest message in the live store is 14_135 characters.
  assert.ok(limit > 14_135, `limit ${limit} would truncate existing messages`);
  assert.ok(
    persistence.includes("originalLength"),
    "truncation must be recorded, never silent",
  );
});

test("the OG surface queries no table that does not exist", () => {
  const gone = ["memories", "memory_events"];
  const files = [
    "src/og/lib/memories.functions.ts",
    "src/og/lib/memory-events.functions.ts",
    "src/og/lib/universes.functions.ts",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const table of gone) {
      assert.ok(
        !source.includes(`from("${table}")`),
        `${file} queries "${table}", which does not exist in this project`,
      );
    }
  }
});

test("OG memory panels read the canonical memory store", () => {
  const source = readFileSync("src/og/lib/memories.functions.ts", "utf8");
  assert.ok(source.includes('from("memory_items")'), "must read memory_items");
  // legacy_memories is a frozen snapshot; reading it would show stale memories
  // while the brain writes elsewhere.
  assert.ok(!source.includes('from("legacy_memories")'), "must not read the frozen snapshot");
});

test("importance survives the 1-5 ↔ 0-1 round trip", () => {
  for (const shown of [1, 2, 3, 4, 5]) {
    assert.equal(toOgImportance(fromOgImportance(shown)), shown);
  }
  assert.equal(toOgImportance(0.5), 3);
  assert.equal(toOgImportance(0), 1, "clamps to the floor the UI can render");
  assert.equal(toOgImportance(1), 5);
  // Legacy ints that were never normalised must not scale again.
  assert.equal(toOgImportance(4), 4);
  assert.equal(toOgImportance(undefined), 3, "missing importance is neutral, not zero");
});

test("a UI pin does not discard the brain's own context keys", () => {
  const patch = toMemoryItemPatch({ pinned: true }, { reasoning: "kept", depth: 2 });
  const context = patch.context as Record<string, unknown>;
  assert.equal(context.pinned, true);
  assert.equal(context.reasoning, "kept", "brain context must survive a UI edit");
  assert.equal(context.depth, 2);
});

test("an untouched presentation field is not written back as undefined", () => {
  const patch = toMemoryItemPatch({ value: "new" }, { pinned: true });
  assert.equal(patch.response, "new");
  assert.ok(!("context" in patch), "context must not be rewritten when nothing in it changed");
  assert.ok(!("prompt" in patch), "an unsent field must not be cleared");
});

test("memory rows map onto the shape the OG panel renders", () => {
  const row = toOgMemory({
    id: "m1",
    category: "identity",
    prompt: "who am i",
    response: "Myles",
    keywords: ["name"],
    importance: 0.8,
    context: { title: "Name", summary: "short", pinned: true },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
  });
  assert.equal(row.key, "who am i");
  assert.equal(row.value, "Myles");
  assert.equal(row.title, "Name");
  assert.equal(row.importance, 4);
  assert.equal(row.pinned, true);
  assert.equal(row.archived, false, "absent flag reads false, never undefined");
  assert.deepEqual(row.tags, ["name"]);
  assert.equal(row.last_referenced_at, "2026-02-01T00:00:00Z");
});

test("memory row mapping tolerates null and malformed context", () => {
  for (const context of [null, undefined, "nope", 7, []]) {
    const row = toOgMemory({ id: "x", response: "r", context });
    assert.equal(row.pinned, false);
    assert.equal(row.title, null);
    assert.equal(row.category, "general");
  }
});

test("memory search covers the fields the search box offers", () => {
  const row = toOgMemory({ id: "x", prompt: "k", response: "v", context: { summary: "needle" } });
  assert.equal(matchesSearch(row, "needle"), true, "summary is searchable");
  assert.equal(matchesSearch(row, "NEEDLE"), true, "search is case-insensitive");
  assert.equal(matchesSearch(row, "absent"), false);
  assert.equal(matchesSearch(row, "   "), true, "blank search matches everything");
});

test("memory events are namespaced into the real event log", () => {
  const source = readFileSync("src/og/lib/memory-events.functions.ts", "utf8");
  assert.ok(source.includes('from("system_events")'), "must use the real event table");
  assert.ok(source.includes('"memory."'), "must namespace kinds to avoid colliding with other events");
  assert.ok(source.includes('.like("kind"'), "must read back only memory events");
});
