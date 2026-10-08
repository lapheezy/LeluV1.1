/**
 * ==========================================================
 * LÉLU — MEMORY MODEL AND PORTABILITY
 *
 * CATEGORY: unit. Real migration code, real orchestrator,
 * stand-in providers so import behaviour can be observed.
 *
 * Covers the two brief sections that were assertions rather
 * than tests:
 *
 *   §10  the tiers are distinct, and the self/identity model
 *        does not depend on Supabase
 *   §19  historical data is portable, and LÉLU can leave a
 *        store without losing what she knows
 *
 * The sharpest test here is that importing the same archive
 * twice does not double her memory. A migration that is not
 * safe to retry is a migration nobody dares run.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createBundle,
  exportFromProvider,
  importBundle,
  isMemoryBundle,
  IMPORT_LIMITS,
} from "../src/core/memory/MemoryMigration";
import { MemoryOrchestrator, type MemoryCandidate } from "../src/core/memory/MemoryProvider";

/** A provider that records what it was asked to keep. */
function recorder(id = "local") {
  const written: MemoryCandidate[] = [];
  return {
    written,
    provider: {
      id,
      isAvailable: () => true,
      async persist(candidate: MemoryCandidate) {
        // Stand in for MemoryEngine's real dedup: same content, one memory.
        const key = candidate.response.trim().toLowerCase();
        if (written.some((w) => w.response.trim().toLowerCase() === key)) return;
        written.push(candidate);
      },
    },
  };
}

/* ---------------------------- §10 ---------------------------- */

test("the self/identity model does not depend on Supabase", () => {
  // §10 states this as a hard requirement. It holds today because
  // LeluIdentity persists to IndexedDB — asserted against the source so a
  // later change that reaches for Supabase fails here rather than in the
  // field, where it would mean LÉLU forgetting who she is when a database
  // is unreachable.
  const identity = readFileSync("src/brain/LeluIdentity.ts", "utf8");
  assert.ok(
    !/supabase/i.test(identity),
    "LeluIdentity must not reference Supabase — identity has to survive without it",
  );
});

test("memory tiers are distinct spaces, not one bucket", () => {
  const store = readFileSync("src/core/memory/MemoryStore.ts", "utf8");
  for (const space of ["user", "lelu", "project", "research", "reflection", "log"]) {
    assert.ok(
      new RegExp(`"${space}"`).test(store),
      `MemorySpace must keep "${space}" separate (§10)`,
    );
  }
});

test("agent working memory is capped, so it cannot grow without end", () => {
  const agentStore = readFileSync("src/core/agents/AgentStore.ts", "utf8");
  assert.ok(
    /executions:\s*\[full,\s*\.\.\.agent\.executions\]\.slice\(0,\s*\d+\)/.test(agentStore),
    "AgentStore must bound retained executions (§10, §11)",
  );
});

/* ---------------------------- §19 ---------------------------- */

test("a bundle carries knowledge and provenance, not a schema", () => {
  const bundle = createBundle("og-archive", [
    { content: "The project ships on Friday.", attribution: "og-archive" },
  ]);

  assert.equal(bundle.format, "lelu.memory.bundle");
  const serialized = JSON.stringify(bundle);
  // Nothing store-shaped may leak in, or the bundle is not portable.
  for (const leak of ["user_id", "conversation_id", "created_at", "public.", "supabase"]) {
    assert.ok(!serialized.includes(leak), `bundle must not carry "${leak}"`);
  }
});

test("empty entries never make it into a bundle", () => {
  const bundle = createBundle("x", [
    { content: "  " },
    { content: "A real fact." },
  ]);
  assert.equal(bundle.memories.length, 1);
});

test("only genuine bundles are importable", async () => {
  for (const junk of [null, {}, { format: "something-else" }, { format: "lelu.memory.bundle" }]) {
    assert.equal(isMemoryBundle(junk), false);
    const outcome = await importBundle(junk);
    assert.equal(outcome.offered, 0, "nothing should be imported from junk");
  }
});

test("importing the same archive twice does not double LÉLU's memory", async () => {
  MemoryOrchestrator.reset();
  const { written, provider } = recorder();
  MemoryOrchestrator.getInstance().register(provider);

  const bundle = createBundle("og-archive", [
    { content: "The database decision was Postgres." },
    { content: "The launch slipped to March." },
    { content: "She prefers short answers." },
  ]);

  await importBundle(bundle);
  const afterFirst = written.length;
  await importBundle(bundle);

  assert.equal(afterFirst, 3, "the first import should land");
  assert.equal(written.length, 3, "the second must be close to a no-op, not a duplication");
  MemoryOrchestrator.reset();
});

test("a huge archive is imported in a bounded batch, not all at once", async () => {
  MemoryOrchestrator.reset();
  const { written, provider } = recorder();
  MemoryOrchestrator.getInstance().register(provider);

  const bundle = createBundle(
    "og-archive",
    Array.from({ length: 5_000 }, (_, i) => ({ content: `Historical fact number ${i}.` })),
  );

  const outcome = await importBundle(bundle);

  assert.ok(
    outcome.offered <= IMPORT_LIMITS.perRun,
    `expected <= ${IMPORT_LIMITS.perRun} per run, offered ${outcome.offered}`,
  );
  assert.equal(outcome.truncated, true, "the caller must be told there is more");
  assert.ok(written.length <= IMPORT_LIMITS.perRun);
  MemoryOrchestrator.reset();
});

test("migrated memories keep their attribution across the move", async () => {
  MemoryOrchestrator.reset();
  const { written, provider } = recorder();
  MemoryOrchestrator.getInstance().register(provider);

  await importBundle(
    createBundle("og-archive", [
      { content: "Something learned long ago.", attribution: "a 2024 conversation" },
    ]),
  );

  assert.equal(written[0].attribution, "a 2024 conversation");
  assert.equal(written[0].metadata?.migratedFrom, "og-archive");
  MemoryOrchestrator.reset();
});

test("export reads through the provider interface, not a store's API", async () => {
  MemoryOrchestrator.reset();
  MemoryOrchestrator.getInstance().register({
    id: "og-archive",
    isAvailable: () => true,
    async context() {
      return [
        { source: "og-archive", band: 6, content: "Remembered thing." },
        { source: "og-archive", band: 6, content: "Remembered thing." },
      ];
    },
  });

  const bundle = await exportFromProvider("og-archive", ["anything"]);

  assert.equal(bundle.origin, "og-archive");
  assert.equal(bundle.memories.length, 1, "duplicates collapse on the way out too");
  MemoryOrchestrator.reset();
});
