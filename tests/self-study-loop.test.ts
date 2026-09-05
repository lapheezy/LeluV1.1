/**
 * ==========================================================
 * LÉLU — SELF-STUDY LOOP: LIVE END-TO-END PROOF
 *
 * These tests run the REAL SelfStudyEngine against the REAL
 * stores (KnowledgeLibrary, SelfModel, StudyObjectives,
 * ArchitectureMap, CapabilityRegistry, AgentStore, Brain). No
 * mocked cognition.
 *
 * What they have to prove:
 *
 *   1. She starts from her mission with no user message, finds
 *      something she does not understand, generates an
 *      investigation, picks an existing agent/tool, runs it,
 *      evaluates the result and writes memory.
 *   2. The next question comes from what she just learned.
 *   3. Cognition does NOT stop when the pre-populated buffer is
 *      exhausted — cycles past the seeded set exist and are
 *      generated from newly acquired state.
 *   4. Emptying the buffer outright is a refill trigger, not an
 *      end state.
 *   5. A provider failure does not terminate cognition.
 *   6. Source reads report REAL DEVELOPMENT RUNTIME vs STATIC
 *      SNAPSHOT honestly rather than silently degrading.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

// SelfStudyEngine.runCycle() performs REAL knowledge retrieval over the
// network. node:test applies a 5-SECOND default timeout regardless of
// the runner's own --timeout, so these were failing on the clock rather
// than on behaviour. The assertions are unchanged; only the budget is
// appropriate to work that does real I/O.

// Shim window/localStorage for KvStore in the Node test env, same as
// the existing behavioral suite does.
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

import SelfStudyEngine from "../src/core/cognition/SelfStudyEngine";
import StudyObjectives from "../src/core/cognition/StudyObjectives";
import StudyAgentRouter from "../src/core/cognition/StudyAgentRouter";
import KnowledgeLibrary from "../src/core/cognition/KnowledgeLibrary";
import SelfModel from "../src/core/cognition/SelfModel";
import AutonomyGate from "../src/core/cognition/AutonomyGate";
import SourceAccess from "../src/core/selfdev/SourceAccess";
import AIProviderRegistry from "../src/core/AIProviderRegistry";
import ExecutionLogger from "../src/core/ExecutionLogger";
import ProviderResolver from "../src/core/router/ProviderResolver";
import Brain from "../src/brain/Brain";
import type AIProvider from "../src/providers/AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "../src/providers/AIProvider";
import type RouterContext from "../src/core/router/RouterContext";
import type ProviderRegistry from "../src/core/ProviderRegistry";

// ============================================================
// 1 — SHE STARTS FROM HER MISSION, WITH NO USER MESSAGE
// ============================================================

test("mission is a persistent source that does not depend on chat", () => {
  const engine = SelfStudyEngine.getInstance();
  const mission = engine.mission();

  assert.ok(mission.active, "The mission is always active — cognition has a standing source.");
  assert.equal(typeof mission.identity, "string");
  assert.ok(Array.isArray(mission.longTerm));
  assert.ok(Array.isArray(mission.projects));
});

test("cycle 1 runs with no user message and produces a real investigation", async () => {
  const engine = SelfStudyEngine.getInstance();
  StudyObjectives.getInstance().clear();

  const report = await engine.runCycle();

  assert.ok(report.objective, "She identified something she does not understand.");
  assert.equal(
    report.objectiveSource,
    "generated",
    "With an empty buffer the objective was GENERATED, not dequeued.",
  );
  assert.ok(report.agent.length > 0, "An agent/tool owner was selected.");
  assert.ok(report.tool.length > 0, "A concrete tool ran.");
  assert.ok(
    ["development-runtime", "static-snapshot", "none"].includes(report.evidenceOrigin),
    `Evidence origin is explicit: ${report.evidenceOrigin}`,
  );
  assert.ok(report.evaluation.length > 0, "The result was evaluated.");
  assert.equal(report.cycle, engine.getCycle());
});

// ============================================================
// 2 + 3 — CONTINUITY: CYCLES PAST THE SEEDED SET
// ============================================================

test("cognition continues past the seeded objectives and generates later cycles from new knowledge", { timeout: 120_000 }, async () => {
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();
  ledger.clear();

  const startCycle = engine.getCycle();
  const reports = [];
  // 14 cycles: comfortably past the 11 originally queued.
  for (let index = 0; index < 14; index += 1) {
    reports.push(await engine.runCycle());
  }

  assert.equal(reports.length, 14, "Fourteen cycles ran without the loop terminating.");
  for (const [index, report] of reports.entries()) {
    assert.equal(report.cycle, startCycle + index + 1, "Cycle numbers advance monotonically.");
    assert.ok(report.objective, `Cycle ${report.cycle} had a question to work on.`);
  }

  // Cycles 12+ are the point: they must exist AND be fed by questions
  // that did not exist when the run started.
  const late = reports.slice(11);
  assert.ok(late.length >= 3, "Cycles 12, 13 and 14 exist.");

  const derivedOrigins = new Set(["discovery", "contradiction", "unresolved", "revalidation"]);
  const carriedForward = ledger
    .list()
    .filter((objective) => derivedOrigins.has(objective.origin));
  assert.ok(
    carriedForward.length > 0,
    "Questions were created BY investigation results, not pre-populated.",
  );

  // At least one late cycle worked on a question that a previous cycle
  // created — knowledge acquired in cycle N feeding cycle N+k.
  const workedOnDerived = late.some(
    (report) => report.objective && report.objective.createdInCycle > startCycle,
  );
  assert.ok(
    workedOnDerived,
    "A later cycle investigated a question generated by an earlier cycle of this same run.",
  );

  // And the process is still going, not "complete".
  assert.ok(
    ledger.open().length > 0 || engine.mission().active,
    "There is always a next step: either carried questions or the standing mission.",
  );
});

test("a continuous loop is not an echo chamber: questions do not quote themselves", async () => {
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();
  ledger.clear();

  for (let index = 0; index < 12; index += 1) {
    await engine.runCycle();
  }

  for (const objective of ledger.list()) {
    // A question that nests another question is self-reference, not a
    // discovery: it is how a "continuous" loop degenerates into talking
    // to itself instead of investigating anything new.
    const questionMarks = (objective.question.match(/\?/g) ?? []).length;
    assert.ok(
      questionMarks <= 1,
      `Objective must not nest a quoted question: ${objective.question.slice(0, 160)}`,
    );
    assert.ok(
      objective.question.length < 260,
      `Objective must not grow by accretion: ${objective.question.slice(0, 160)}`,
    );
  }
});

test("malformed model follow-ups are never adopted as objectives", async () => {
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();
  ledger.clear();

  for (let index = 0; index < 10; index += 1) {
    await engine.runCycle();
  }

  for (const objective of ledger.list()) {
    const q = objective.question;
    // Internal scaffolding must never leak into a carried question.
    assert.ok(
      !/(ANSWER|CONFIDENCE|NEXT|QUESTION I AM INVESTIGATING)\s*:/i.test(q),
      `evaluation scaffolding leaked into an objective: ${q.slice(0, 140)}`,
    );
    assert.ok(
      !/self-study cycle|recall \(|recent \[/i.test(q),
      `a recalled memory was spliced into an objective: ${q.slice(0, 140)}`,
    );
    // A whole sentence spliced mid-question ("What role does Your name
    // is Lélu. play here?") is noise, not a discovery.
    assert.ok(
      !/[.!]\s+\S/.test(q.slice(0, -1)),
      `a sentence was spliced into an objective: ${q.slice(0, 140)}`,
    );
  }
});

test("attention rotates across domains instead of grinding one forever", { timeout: 120_000 }, async () => {
  const engine = SelfStudyEngine.getInstance();
  StudyObjectives.getInstance().clear();

  const domains: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const report = await engine.runCycle();
    if (report.objective) domains.push(report.objective.domain);
  }

  assert.ok(domains.length >= 8, "Cycles produced objectives.");
  assert.ok(
    new Set(domains).size >= 3,
    `Investigation moved across kinds of question, not one repeatedly: ${domains.join(", ")}`,
  );
});

test("priority is recomputed from a stable base, so a question cannot sink forever", async () => {
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();
  ledger.clear();

  await engine.runCycle();
  const tracked = ledger.open()[ledger.open().length - 1];
  assert.ok(tracked, "There is a lowest-priority carried objective.");
  const base = tracked.basePriority;

  for (let index = 0; index < 6; index += 1) {
    await engine.runCycle();
  }

  const after = ledger.get(tracked.id);
  if (after && after.status === "open") {
    assert.equal(after.basePriority, base, "The intrinsic base priority is stable.");
    assert.ok(
      after.priority >= base - 60,
      `Adjustments must not compound cycle after cycle (base ${base}, now ${after.priority}).`,
    );
    assert.ok(after.priority >= 1, "Priority never collapses to zero.");
  }
});

// ============================================================
// 4 — AN EMPTY BUFFER IS A REFILL TRIGGER, NOT AN END STATE
// ============================================================

test("emptying the work buffer does not end cognition", async () => {
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();

  // Hard-exhaust the buffer, exactly like the old queue running dry.
  ledger.clear();
  assert.equal(ledger.open().length, 0, "The buffer is empty.");

  const report = await engine.runCycle();
  assert.ok(report.objective, "An empty buffer produced a new objective instead of stopping.");
  assert.equal(report.objectiveSource, "generated");

  // Do it again — it must be repeatable, not a one-shot recovery.
  ledger.clear();
  const second = await engine.runCycle();
  assert.ok(second.objective, "Regeneration is repeatable.");
  assert.ok(second.cycle > report.cycle, "The cycle counter kept advancing.");
});

test("objective generation is renewable even when nothing is marked as a gap", async () => {
  const engine = SelfStudyEngine.getInstance();
  const knowledge = KnowledgeLibrary.getInstance();
  const ledger = StudyObjectives.getInstance();

  // Remove every gap: mark all untrusted knowledge as verified. This is
  // the state the old loop treated as "nothing left to do".
  for (const gap of knowledge.gaps()) {
    knowledge.setStatus(gap.id, "verified");
  }
  assert.equal(knowledge.gaps().length, 0, "No knowledge gaps remain.");
  ledger.clear();

  const state = await engine.observeState();
  const generated = engine.generate(engine.mission(), state);
  assert.ok(
    generated.length > 0,
    "With zero gaps she still generates objectives — from the mission, architecture, capabilities or revalidation.",
  );
});

// ============================================================
// 5 — PROVIDER FAILURE MUST NOT TERMINATE COGNITION
// ============================================================

function fakeProvider(
  name: string,
  priority: number,
  generate: AIProvider["generate"],
): AIProvider {
  const health: AIProviderHealth = { available: true, initialized: true, lastChecked: Date.now() };
  return {
    name,
    priority,
    enabled: true,
    timeout: 1000,
    requiresApiKey: false,
    capabilities: ["chat"],
    async initialize() {},
    async isAvailable() { return true; },
    async health() { return health; },
    canHandle() { return true; },
    generate,
  };
}

test("a failing provider hands the same cognitive operation to the next one", async () => {
  const registry = new AIProviderRegistry();
  const attempted: string[] = [];

  registry.register(
    fakeProvider("first", 1, async () => {
      attempted.push("first");
      throw new Error("provider A is down");
    }),
  );
  registry.register(
    fakeProvider("second", 2, async (request: AIRequest): Promise<AIResponse> => {
      attempted.push("second");
      return {
        // The SAME cognitive operation continues — the prompt is intact.
        text: `ANSWER: evaluated ${request.prompt.length} chars of evidence\nCONFIDENCE: learned\nNEXT: what depends on this?`,
        provider: "second",
        model: "test",
        processingTime: 1,
      };
    }),
  );

  const context = {
    request: {
      messages: [{ role: "user" as const, content: "evaluate this evidence" }],
      prompt: "evaluate this evidence",
    },
    started: Date.now(),
    brain: new Brain(),
    knowledgeProviders: { all: () => [] } as unknown as ProviderRegistry,
    aiProviders: registry,
    logger: new ExecutionLogger(),
    intent: "chat" as const,
  } satisfies RouterContext;

  const result = await new ProviderResolver().execute(context);

  assert.deepEqual(attempted, ["first", "second"], "Provider A failed, provider B continued the operation.");
  assert.ok(result.handled && result.response, "The operation produced a result.");
  assert.equal(result.response?.provider, "second");
  assert.ok(
    result.response!.text.includes("ANSWER:"),
    "The cognitive operation — not a new one — completed on the fallback provider.",
  );
  assert.equal(registry.getActiveProvider(), "second", "The registry records who actually answered.");
  assert.ok(registry.failure("first"), "Provider A's failure was recorded, not swallowed.");
});

test("a cycle with no reachable provider still learns and still schedules the next question", async () => {
  const engine = SelfStudyEngine.getInstance();
  StudyObjectives.getInstance().clear();

  // In this environment no AI provider is configured, so every provider
  // call falls through the whole chain and returns the offline result.
  const report = await engine.runCycle();

  assert.equal(report.provider, null, "No provider answered — the chain was exhausted.");
  assert.ok(report.objective, "Cognition still had an objective.");
  assert.ok(report.evaluation.length > 0, "The evidence was still evaluated.");
  assert.ok(
    report.evidence.length > 0 || report.note,
    "The investigation still produced evidence or an honest note.",
  );

  const next = await engine.runCycle();
  assert.equal(next.cycle, report.cycle + 1, "The loop continued to the next cycle regardless.");
});

// ============================================================
// 6 — MEMORY PATH AND AGENT SELECTION
// ============================================================

test("each domain of question routes to the agent/tool that can answer it", () => {
  const router = StudyAgentRouter.getInstance();

  // Agents come from the one AgentStore; the mapping is by domain.
  const architecture = router.agentFor("architecture");
  const research = router.agentFor("research");
  const memory = router.agentFor("memory");

  assert.ok(
    architecture === null || /Engineering Agent|Builder/.test(architecture.name),
    "Architecture questions go to the engineering/builder agent.",
  );
  assert.ok(
    research === null || research.name === "Researcher",
    "External research goes to the Researcher agent.",
  );
  assert.equal(memory, null, "Memory questions are answered by LÉLU directly, not delegated.");
});

test("a completed cycle updates knowledge and the self-model", async () => {
  const engine = SelfStudyEngine.getInstance();
  const knowledge = KnowledgeLibrary.getInstance();
  const self = SelfModel.getInstance();
  StudyObjectives.getInstance().clear();

  const knowledgeBefore = knowledge.list().length;
  const learningBefore = self.get().learning.length;

  const report = await engine.runCycle();

  if (report.learned) {
    assert.ok(
      knowledge.list().length >= knowledgeBefore,
      "Learning was incorporated into the knowledge library.",
    );
    assert.ok(
      self.get().learning.length > learningBefore,
      "The self-model recorded what she learned.",
    );
  } else {
    assert.ok(
      self.get().unfinished.length > 0,
      "An investigation that produced nothing was recorded as unfinished, not silently dropped.",
    );
  }
});

test("an investigated gap stops being a gap", async () => {
  const engine = SelfStudyEngine.getInstance();
  const knowledge = KnowledgeLibrary.getInstance();
  const ledger = StudyObjectives.getInstance();
  ledger.clear();

  const gap = knowledge.add({
    domain: "selfdev",
    title: `Probe gap ${Date.now()}`,
    detail: "A deliberately untrusted entry used to prove gaps are settled rather than re-researched forever.",
    status: "unverified",
  });

  // Run enough cycles for this gap to reach the front of the queue and
  // be investigated. Attention rotates across domains, so a given gap
  // is not necessarily first — that is the intended behaviour.
  for (let index = 0; index < 16; index += 1) {
    await engine.runCycle();
    const current = knowledge.get(gap.id);
    if (current && current.status !== "unverified") break;
  }

  const settled = knowledge.get(gap.id);
  assert.ok(settled, "The entry still exists.");
  assert.notEqual(
    settled!.status,
    "unverified",
    "The gap was settled by investigation instead of being re-researched every cycle.",
  );
});

// ============================================================
// 7 — ENVIRONMENTAL ACCESS IS REPORTED HONESTLY
// ============================================================

test("source access distinguishes the development runtime from the static snapshot", async () => {
  const access = SourceAccess.getInstance();
  const status = await access.status(true);

  assert.equal(typeof status.reachable, "boolean");
  assert.equal(typeof status.snapshotFiles, "number");

  const description = access.describe(status);
  if (status.reachable) {
    assert.ok(
      description.startsWith("REAL DEVELOPMENT RUNTIME"),
      "A reachable runtime is named as the development runtime.",
    );
    assert.ok(status.runtime, "The runtime label is reported.");
  } else {
    assert.ok(
      description.startsWith("STATIC SNAPSHOT"),
      "An unreachable runtime is reported as a static snapshot — never as live source.",
    );
    assert.ok(status.error, "The reason the runtime is unreachable is recorded.");
  }
});

test("a read reports which source answered it", async () => {
  const read = await SourceAccess.getInstance().read("src/core/cognition/SelfStudyEngine.ts");
  assert.ok(
    ["development-runtime", "static-snapshot", "unavailable"].includes(read.origin),
    `Origin is always explicit: ${read.origin}`,
  );
  if (read.content !== null) {
    assert.notEqual(read.origin, "unavailable", "Content implies a real origin.");
  } else {
    assert.ok(read.error, "An unreadable file explains why.");
  }
});

// ============================================================
// 8 — AUTHORIZATION CONSTRAINS ACTION, NOT THINKING
// ============================================================

test("studying continues at autonomy level 0", async () => {
  const gate = AutonomyGate.getInstance();
  const original = gate.getLevel();
  const engine = SelfStudyEngine.getInstance();
  StudyObjectives.getInstance().clear();

  try {
    gate.setLevel(0); // Observe only — no actions permitted at all.
    const report = await engine.runCycle();
    assert.ok(
      report.objective,
      "Thinking, studying and analysis are not gated by the autonomy level.",
    );
    assert.ok(report.evaluation.length > 0, "She still evaluated what she found.");
  } finally {
    gate.setLevel(original);
  }
});
