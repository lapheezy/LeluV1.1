/**
 * ==========================================================
 * LÉLU — MEMORY SAFETY
 *
 * CATEGORY: unit. The real CognitiveBudget, no substitutes.
 *
 * Why this exists: the OG build could multiply memory and
 * reasoning until it fell over, and the integration brief (§9)
 * makes not inheriting that a hard requirement. A requirement
 * nobody tests is a hope, so each rule below is asserted
 * against the code that enforces it — including the ones v1.1
 * already satisfied, because a later refactor that quietly
 * removed them would otherwise go unnoticed.
 *
 * The load-bearing claim is the last one: when a budget is
 * exhausted, LÉLU degrades. She does not throw.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AgentDepthGuard,
  BUDGET_LIMITS,
  CognitiveBudget,
  compressContext,
  deduplicateContext,
  fitContext,
  reduceContext,
} from "../src/core/memory/CognitiveBudget";

/** Context of a known size, in distinguishable blocks. */
function makeContext(blocks: number, chars: number): string {
  return Array.from({ length: blocks }, (_, i) =>
    `Block ${i}. ${`fact${i} `.repeat(Math.ceil(chars / 7))}`.slice(0, chars),
  ).join("\n\n");
}

test("context already within budget is returned untouched", () => {
  const context = makeContext(3, 200);
  const result = fitContext(context);

  assert.equal(result.context, context, "small context must not be rewritten");
  assert.deepEqual(result.applied, [], "no reduction rung should run");
  assert.equal(result.removed, 0);
});

test("repeated context blocks collapse to one", () => {
  const block = "LÉLU prefers concise answers and dislikes filler openings.";
  const context = [block, "An unrelated fact about the ocean.", block].join("\n\n");

  const { context: deduped, removed } = deduplicateContext(context);

  assert.ok(removed > 0, "the duplicate should have been removed");
  const occurrences = deduped.split("LÉLU prefers concise").length - 1;
  assert.equal(occurrences, 1, "the same fact must appear exactly once");
  assert.ok(deduped.includes("ocean"), "unrelated context must survive");
});

test("compression keeps newer blocks intact and shortens older ones", () => {
  const context = makeContext(4, 1200);
  const { context: compressed, removed } = compressContext(context, 2000);

  assert.ok(removed > 0, "something should have been compressed");
  assert.ok(compressed.includes("[…]"), "older blocks should be elided");
  assert.ok(compressed.includes("Block 3"), "the newest block must survive whole");
});

test("reduction drops the oldest context first", () => {
  const context = makeContext(6, 500);
  const { context: reduced } = reduceContext(context, 1200);

  assert.ok(reduced.length <= 1200, "must fit the target");
  assert.ok(reduced.includes("Block 5"), "newest context is what matters to this turn");
  assert.ok(!reduced.includes("Block 0"), "oldest context is what gets dropped");
});

test("the reduction ladder runs in the order the brief requires", () => {
  // A context that is both duplicated and far too large, so more than one
  // rung has to fire.
  const block = `A remembered fact. ${"detail ".repeat(400)}`;
  const context = [block, block, block, block, block, block].join("\n\n");

  const result = fitContext(context, 4_000);

  assert.ok(result.context.length <= 4_000, "must end within budget");
  assert.equal(result.applied[0], "deduplicate", "deduplication is the cheapest rung and goes first");
  assert.ok(result.applied.length >= 1);
  // Whatever ran, the ordering must never put a lossy rung before a lossless one.
  const order = ["deduplicate", "compress", "reduce"];
  const indices = result.applied.map((rung) => order.indexOf(rung));
  assert.deepEqual(indices, [...indices].sort((a, b) => a - b), "rungs must escalate, never regress");
});

test("an enormous context is bounded rather than refused", () => {
  const context = makeContext(200, 2_000); // ~400k chars
  const result = fitContext(context);

  assert.ok(
    result.context.length <= BUDGET_LIMITS.contextChars,
    `expected <= ${BUDGET_LIMITS.contextChars}, got ${result.context.length}`,
  );
  assert.ok(result.context.length > 0, "bounding must not empty the context");
});

test("budget reports exhaustion instead of throwing", () => {
  const budget = new CognitiveBudget();

  for (let i = 0; i < BUDGET_LIMITS.memoryWrites; i += 1) {
    assert.equal(budget.charge("memoryWrites"), true, `write ${i} should be within budget`);
  }
  // The one that goes over: a boolean, not an exception. Degrading is the
  // required behaviour; throwing here would be the crash in disguise.
  assert.equal(budget.charge("memoryWrites"), false);
  assert.deepEqual(budget.overspent(), ["memoryWrites"]);
  assert.equal(budget.snapshot().memoryWrites, BUDGET_LIMITS.memoryWrites + 1);
});

test("allows() answers without spending budget", () => {
  const budget = new CognitiveBudget();
  assert.equal(budget.allows("memoryWrites"), true);
  assert.equal(budget.snapshot().memoryWrites, 0, "asking must not consume");
});

test("agent recursion is refused past the depth limit", () => {
  AgentDepthGuard.reset();
  const chain = "chain-under-test";

  for (let depth = 1; depth <= BUDGET_LIMITS.agentDepth; depth += 1) {
    assert.equal(AgentDepthGuard.enter(chain), true, `depth ${depth} should be allowed`);
  }
  assert.equal(AgentDepthGuard.enter(chain), false, "one past the limit must be refused");
  assert.equal(AgentDepthGuard.depth(chain), BUDGET_LIMITS.agentDepth);

  AgentDepthGuard.exit(chain);
  assert.equal(
    AgentDepthGuard.enter(chain),
    true,
    "unwinding must free depth again, or one deep chain would poison the chain id",
  );
  AgentDepthGuard.reset();
});

test("depth is per chain, so breadth is not restricted", () => {
  AgentDepthGuard.reset();
  // Many sibling agents at depth 1 is normal fan-out, not recursion.
  for (let i = 0; i < 50; i += 1) {
    assert.equal(AgentDepthGuard.enter(`sibling-${i}`), true);
  }
  AgentDepthGuard.reset();
});
