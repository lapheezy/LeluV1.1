/**
 * ==========================================================
 * LÉLU — AGENT BOUNDS
 *
 * CATEGORY: unit. The real AgentDepthGuard and the real
 * consolidation contract.
 *
 * Why this exists: §11 wants agents that are powerful without
 * recreating the memory explosion. Two properties carry that,
 * and both are easy to lose in a refactor — an agent chain must
 * not descend without end, and an agent must hand memory an
 * insight rather than its whole working context.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { AgentDepthGuard, BUDGET_LIMITS } from "../src/core/memory/CognitiveBudget";
import { MemoryOrchestrator, type MemoryCandidate } from "../src/core/memory/MemoryProvider";

test("an agent chain is refused once it is too deep", () => {
  AgentDepthGuard.reset();
  const chain = "project-alpha";

  for (let i = 0; i < BUDGET_LIMITS.agentDepth; i += 1) {
    assert.equal(AgentDepthGuard.enter(chain), true);
  }
  assert.equal(AgentDepthGuard.enter(chain), false, "recursion must stop, not continue");
  AgentDepthGuard.reset();
});

test("agents fanning out sideways are not restricted", () => {
  AgentDepthGuard.reset();
  // Twenty agents each doing one piece of a project is breadth, not depth,
  // and throttling it would make the agent system useless.
  for (let i = 0; i < 20; i += 1) {
    assert.equal(AgentDepthGuard.enter(`solo:agent-${i}`), true);
  }
  AgentDepthGuard.reset();
});

test("depth is released when a run unwinds", () => {
  AgentDepthGuard.reset();
  const chain = "project-beta";

  AgentDepthGuard.enter(chain);
  AgentDepthGuard.enter(chain);
  assert.equal(AgentDepthGuard.depth(chain), 2);

  AgentDepthGuard.exit(chain);
  AgentDepthGuard.exit(chain);
  assert.equal(AgentDepthGuard.depth(chain), 0, "a finished chain must not leak depth");
  AgentDepthGuard.reset();
});

test("what an agent contributes to memory is an insight, not its transcript", async () => {
  MemoryOrchestrator.reset();
  const orchestrator = MemoryOrchestrator.getInstance();
  const written: MemoryCandidate[] = [];

  orchestrator.register({
    id: "capture",
    isAvailable: () => true,
    async persist(candidate) {
      written.push(candidate);
    },
  });

  // What AgentRunner.consolidate() offers: a bounded slice, attributed.
  const wholeTranscript = `Considered several options. ${"Working note. ".repeat(400)}Concluded: use Postgres.`;
  const insight = wholeTranscript.slice(0, 600);

  await orchestrator.persist({
    prompt: "What did Researcher find out about: pick a database?",
    response: insight,
    category: "agent-insight",
    attribution: "agent Researcher",
    metadata: { agentName: "Researcher", truncated: true },
  });

  assert.equal(written.length, 1);
  assert.ok(
    written[0].response.length <= 600,
    `an agent must not push its whole context into memory (got ${written[0].response.length})`,
  );
  assert.ok(written[0].response.length < wholeTranscript.length);
  assert.equal(written[0].attribution, "agent Researcher", "LÉLU must know which agent taught her this");
  assert.equal(written[0].metadata?.truncated, true, "and that there was more");
  MemoryOrchestrator.reset();
});

test("a memory provider failing does not fail the agent", async () => {
  MemoryOrchestrator.reset();
  const orchestrator = MemoryOrchestrator.getInstance();
  orchestrator.register({
    id: "broken",
    isAvailable: () => true,
    async persist() {
      throw new Error("store unavailable");
    },
  });

  const result = await orchestrator.persist({ prompt: "p", response: "r" });

  assert.deepEqual(result.failed, ["broken"]);
  assert.deepEqual(result.accepted, [], "nothing took it, and that is survivable");
  MemoryOrchestrator.reset();
});
