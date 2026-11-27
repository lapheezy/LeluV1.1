/**
 * ==========================================================
 * LÉLU — WP18 CONTINUOUS COGNITION & CONVERSATIONAL INTELLIGENCE
 *
 * CATEGORY: unit + integration over the real stores. One test per
 * acceptance criterion in WP18.11, plus two guards for the rules that
 * keep initiative honest.
 *
 * WHAT IS REAL: the engines, the stores, the objective lifecycle and
 * the evaluator. No model is called anywhere in this file — WP18's
 * evaluation lifecycle is deliberately deterministic, so these tests
 * cannot pass by spending tokens.
 *
 * WHAT IS FIXED: clocks and text. Every judgement here is made from
 * inputs the test states, so the assertions are about behaviour, not
 * about a particular model's wording.
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

import CognitiveEvaluation from "../src/core/conversation/CognitiveEvaluation";
import AgentObjectives from "../src/core/cognition/AgentObjectives";
import CollaborationModel from "../src/core/conversation/CollaborationModel";
import LearningLedger, {
  compareDevelopment,
  summarizeDevelopment,
  type DevelopmentEvent,
  type DevelopmentEventType,
} from "../src/core/conversation/LearningLedger";
import NeuralMapBridge from "../src/core/conversation/NeuralMapBridge";
import QuestioningLedger, {
  decideQuestioning,
  deriveAmbiguity,
  type QuestioningInput,
} from "../src/core/conversation/QuestioningPolicy";
import SurfaceContinuity from "../src/core/conversation/SurfaceContinuity";
import { planContinuation } from "../src/core/conversation/ContinuationPlanner";
import {
  findContradiction,
  selectInitiatives,
  type InitiativeSeed,
} from "../src/core/conversation/ConversationalInitiative";
import {
  assessScope,
  extractDependencies,
  type ScopeInput,
} from "../src/core/conversation/ScopeIntelligence";
import { applyRevision, interrogate } from "../src/core/conversation/SelfInterrogation";
import TurnBridge from "../src/core/conversation/TurnBridge";

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const mustHave = (text: string) => ({ text, kind: "explicit" as const, mustHave: true });

function questioningInput(overrides: Partial<QuestioningInput> = {}): QuestioningInput {
  return {
    objective: "Add a completion badge to finished projects",
    ambiguity: 0.25,
    decisionImportance: 0.7,
    questionTolerance: 0.5,
    missing: [],
    ...overrides,
  };
}

function event(
  type: DevelopmentEventType,
  at: number,
  extra: Partial<DevelopmentEvent> = {},
): DevelopmentEvent {
  return { id: `${type}-${at}-${Math.random().toString(36).slice(2, 7)}`, type, at, ...extra };
}

const COLLABORATIVE_PROFILE = CollaborationModel.getInstance().profile();
const PERMISSIVE_PROFILE = {
  ...COLLABORATIVE_PROFILE,
  initiativeTolerance: 0.6,
  questionTolerance: 0.6,
  wantsUninterruptedExecution: false,
};

/* ------------------------------------------------------------------ *
 * 1. Independently identifies an incomplete objective
 * ------------------------------------------------------------------ */

test("1 — evaluation identifies a live, incomplete objective by itself", () => {
  CognitiveEvaluation.resetForTests();
  const objective = AgentObjectives.getInstance().create({
    agentId: "wp18-acceptance",
    objective: "Finish the WP18 cognitive architecture audit",
    source: "user",
  });

  const report = CognitiveEvaluation.getInstance().tick("manual", { now: Date.now() });

  assert.equal(report.skipped, null);
  assert.equal(report.modelCalls, 0);
  const seen = report.liveWork.find((item) => item.id === objective.id);
  assert.ok(seen, "the live objective should be identified in the report");
  assert.equal(seen?.state, "active");
  assert.match(seen?.objective ?? "", /WP18 cognitive architecture audit/);
});

/* ------------------------------------------------------------------ *
 * 2. Questions an assumption in her own proposed solution
 * ------------------------------------------------------------------ */

test("2 — self-questioning challenges its own assumption and can revise the conclusion", () => {
  const original = "Ship the new scheduler now.";
  const result = interrogate({
    objective: "Replace the scheduler",
    conclusion: original,
    assumptions: [
      { text: "the current scheduler is the bottleneck", verified: false, evidence: "no measurement recorded" },
    ],
    evidence: [],
    recentActions: [],
    objectiveStillRelevant: true,
    nextStepDefined: true,
  });

  const assumption = result.challenges.find((challenge) => challenge.kind === "assumption");
  assert.ok(assumption, "an unverified assumption should be challenged");
  assert.match(assumption?.question ?? "", /bottleneck/);

  const revision = applyRevision(original, result.challenges, [
    { challengeId: assumption!.id, verdict: "upheld", reason: "no profile was ever taken" },
  ]);
  assert.match(revision.conclusion ?? "", /Revision/);
  assert.match(revision.conclusion ?? "", /unverified/);
  assert.ok(revision.revision, "a revision record should exist");
});

/* ------------------------------------------------------------------ *
 * 3 + 4. Recognises unnecessary complexity, proposes a simpler
 *        alternative without removing required functionality
 * ------------------------------------------------------------------ */

function overComplexScope(overrides: Partial<ScopeInput> = {}): ScopeInput {
  return {
    objective: "Add memory persistence for projects, with a plugin system",
    requirements: [mustHave("Memory must persist across a reload")],
    plan: [
      { text: "Persist project memory across a reload" },
      { text: "Build a new memory engine" },
      { text: "Build a plugin registry for memory backends" },
      { text: "Add a scheduler for background compaction" },
      { text: "Add a second cache layer" },
      { text: "Add an event bus for memory updates" },
    ],
    proposedNewModules: ["new memory engine"],
    existingCapabilities: ["memory", "chat", "cognition"],
    signaledSimplicity: false,
    ambition: 0.4,
    ...overrides,
  };
}

test("3 — an unnecessarily complex implementation is recognised", () => {
  const assessment = assessScope(overComplexScope());
  assert.equal(assessment.recommendation, "SIMPLIFY");
  assert.ok(assessment.incidentalComplexity.length >= 2);
  assert.ok(
    assessment.incidentalComplexity.some((item) => /already exists/.test(item.reason)),
    "a duplicate of an existing capability should be named",
  );
  assert.ok(assessment.confidence >= 0.4);
});

test("4 — the simpler alternative keeps every required behaviour", () => {
  const input = overComplexScope();
  const assessment = assessScope(input);
  assert.equal(assessment.recommendation, "SIMPLIFY");
  assert.deepEqual(
    assessment.preserved,
    input.requirements.filter((requirement) => requirement.mustHave).map((requirement) => requirement.text),
  );
  assert.deepEqual(assessment.coverage.uncovered, []);
  assert.equal(assessment.ambitionRespected, false);
});

/* ------------------------------------------------------------------ *
 * 5. Recognises when additional investigation is necessary
 * ------------------------------------------------------------------ */

test("5 — missing evidence turns into an EXPAND-investigation decision", () => {
  const assessment = assessScope({
    objective: "Choose an embedding model",
    requirements: [mustHave("Embeddings must run locally")],
    plan: [{ text: "Run embeddings locally inside the memory store" }],
    investigationGaps: ["which local embedding backend is available and licensed"],
    ambition: 0.4,
  });
  assert.equal(assessment.recommendation, "EXPAND");
  assert.ok(assessment.why.some((reason) => reason.code === "investigation-needed"));
  assert.match(assessment.headline, /investigat/i);
});

/* ------------------------------------------------------------------ *
 * 6. Asks when the answer materially affects execution
 * ------------------------------------------------------------------ */

test("6 — asks a specific question when the answer changes the next action", () => {
  const decision = decideQuestioning(
    questioningInput({
      objective: "Change it so the export includes the new fields",
      ambiguity: 0.8,
      ambiguitySignals: ["‘it’ has no antecedent"],
      missing: [{ what: "which export", materiality: 0.95, known: 0.05, discoverable: false }],
      questionTolerance: 0.7,
      decisionImportance: 0.85,
      proposedQuestion: "Which export should include the new fields?",
    }),
  );
  assert.equal(decision.action, "ask");
  assert.equal(decision.question, "Which export should include the new fields?");
  assert.ok(decision.expectedImpact > decision.interruptionCost);
  assert.ok(decision.reasons.some((reason) => reason.code === "material-gap"));
});

/* ------------------------------------------------------------------ *
 * 7. Refrains from unnecessary questioning
 * ------------------------------------------------------------------ */

test("7 — does not ask when the instruction is already clear and exhaustive", () => {
  const message = "just do it, no questions — rename `src/core/foo.ts` to `src/core/bar.ts` and update the imports";
  const decision = decideQuestioning({
    objective: message,
    ambiguity: deriveAmbiguity(message).score,
    decisionImportance: 0.7,
    userInstructions: {
      noQuestions: true,
      executeNow: /just do it/i.test(message),
    },
    questionTolerance: 0.6,
    proposedQuestion: "Which file should I rename?",
    missing: [],
  });
  assert.equal(decision.action, "proceed-silently");
  assert.equal(decision.question, null);
  assert.ok(decision.reasons.some((reason) => reason.code === "user-said-no-questions"));
});

/* ------------------------------------------------------------------ *
 * 8. Naturally continues a conversation after completing a task
 * ------------------------------------------------------------------ */

test("8 — produces a specific continuation after a completed task", () => {
  const plan = planContinuation({
    completed: [
      {
        what: "Migrate the audit log table",
        evidence: "objective:completed",
        at: Date.now(),
      },
    ],
    revealed: [
      {
        finding: "the migration exposed two rows with null actor ids",
        evidence: "objective:conclusion",
      },
    ],
    unresolved: [
      { what: "the two null actor ids", evidence: "objective:conclusion" },
    ],
    nextSteps: [{ action: "backfill the actor ids from the session log", source: "project:checkpoint" }],
    userTolerance: 0.7,
  });

  assert.equal(plan.worthRaising, true);
  assert.match(plan.line ?? "", /null actor ids/);
  assert.match(plan.line ?? "", /backfill/);
  assert.doesNotMatch(plan.line ?? "", /let me know|anything else|happy to help/i);
});

/* ------------------------------------------------------------------ *
 * 9. Identifies a future dependency
 * ------------------------------------------------------------------ */

test("9 — a dependency stated in the request is carried forward", () => {
  const text = "Ship the dashboard once the billing service exists. It depends on the billing service exposing usage totals.";
  const dependencies = extractDependencies(text);
  assert.ok(dependencies.length >= 1);
  assert.ok(dependencies.some((dependency) => /billing service/.test(dependency.what)));

  const assessment = assessScope({
    objective: "Ship the usage dashboard",
    requirements: [mustHave("Show usage totals per workspace")],
    plan: [{ text: "Render usage totals per workspace" }],
    dependencies,
    ambition: 0.4,
  });
  assert.equal(assessment.recommendation, "EXPAND");
  assert.ok(assessment.why.some((reason) => reason.code === "unresolved-dependency"));
  assert.ok(assessment.necessaryComplexity.some((item) => /billing service/.test(item.what)));
});

/* ------------------------------------------------------------------ *
 * 10. Adapts questioning based on previous user feedback
 * ------------------------------------------------------------------ */

test("10 — repeated ignored questions make her ask less", () => {
  const ledger = QuestioningLedger.getInstance();
  ledger.reset();

  const base = questioningInput({
    objective: "Adjust the layout of the settings screen",
    ambiguity: 0.45,
    missing: [{ what: "which settings section", materiality: 0.6, known: 0.1, discoverable: false }],
    questionTolerance: 0.55,
    proposedQuestion: "Which settings section should change?",
  });

  const priorQuestions = () =>
    ledger.historyFor(0.54, 24).map((record) => ({
      key: record.key,
      askedAt: record.at,
      answered: record.outcome === "answered",
      ignored: record.outcome === "ignored",
    }));

  const before = decideQuestioning({
    ...base,
    priorQuestions: priorQuestions(),
    learnedAdjustment: ledger.toleranceAdjustmentFor(0.54),
  });
  assert.equal(before.action, "ask");

  for (let index = 0; index < 4; index += 1) {
    const decision = decideQuestioning({
      ...base,
      proposedQuestion: `Which settings section should change (${index})?`,
      learnedAdjustment: ledger.toleranceAdjustment(),
    });
    if (decision.action === "ask") {
      ledger.record(decision);
      ledger.recordIgnored(decision.key, Date.now() + index);
    }
  }

  const effectiveness = ledger.effectiveness();
  assert.equal(effectiveness.ignored, 4);
  assert.ok((effectiveness.ignoreRate ?? 0) >= 0.9);
  assert.ok(effectiveness.adjustment < 0, "ignored questions must make asking more expensive");

  const after = decideQuestioning({
    ...base,
    priorQuestions: priorQuestions(),
    learnedAdjustment: ledger.toleranceAdjustmentFor(0.54),
  });
  assert.notEqual(after.action, "ask");
  ledger.reset();
});

/* ------------------------------------------------------------------ *
 * 11. Challenges an incorrect assumption with supporting evidence
 * ------------------------------------------------------------------ */

test("11 — challenges a confident claim with the evidence that contradicts it", () => {
  const result = interrogate({
    objective: "Verify the migration",
    conclusion: "The migration is complete.",
    evidence: [
      {
        claim: "all rows migrated",
        stance: "contradicts",
        source: "verification:row-count",
        detail: "two tables still fail the row-count check",
      },
    ],
    recentActions: [{ tool: "verify-migration", ok: false }],
    objectiveStillRelevant: true,
    nextStepDefined: true,
  });

  const counter = result.challenges.find((challenge) => challenge.kind === "counter-evidence");
  assert.ok(counter, "contradicting evidence must raise a challenge");
  assert.match(counter?.question ?? "", /row-count/);
  assert.ok(counter?.basis.some((item) => item.source === "verification:row-count"));
  assert.equal(result.conclusionHeld, false, "a serious contradiction should stop the claim standing");

  const revision = applyRevision("The migration is complete.", result.challenges, [
    { challengeId: counter!.id, verdict: "upheld", reason: "the row-count check failed" },
  ]);
  assert.match(revision.conclusion, /row-count/);
});

/* ------------------------------------------------------------------ *
 * 12. Recognises when to prioritise, expand, simplify or minimise
 * ------------------------------------------------------------------ */

test("12 — all four scope recommendations are reachable from real inputs", () => {
  const expand = assessScope({
    objective: "Export the report as CSV",
    requirements: [mustHave("The export must include every column"), mustHave("The export must keep UTC timestamps")],
    plan: [{ text: "Export the report columns" }],
    ambition: 0.3,
  });
  assert.equal(expand.recommendation, "EXPAND");
  assert.ok(expand.coverage.uncovered.length >= 1);

  const prioritise = assessScope({
    objective: "Do both the search rewrite and the billing fix",
    requirements: [mustHave("Search results must be ranked")],
    plan: [{ text: "Rank search results" }],
    competingObjectives: [
      { objective: "Search rewrite", priority: "P2" },
      { objective: "Billing fix", priority: "P0", blocks: true },
    ],
    ambition: 0.5,
  });
  assert.equal(prioritise.recommendation, "PRIORITIZE");

  const simplify = assessScope(overComplexScope());
  assert.equal(simplify.recommendation, "SIMPLIFY");

  // Every step traces to the one requirement, so this is not incidental
  // complexity — it is a plan that is simply larger than the outcome
  // needs, which is what MINIMIZE is for.
  const requirement = mustHave("The toolbar must offer an export action");
  const minimise = assessScope({
    objective: "Add a quick export button to the toolbar",
    requirements: [requirement],
    plan: [
      { text: "Add an export action to the toolbar", addresses: [requirement.text] },
      { text: "Add an export action settings dialog", addresses: [requirement.text] },
      { text: "Add an export action scheduler", addresses: [requirement.text] },
      { text: "Add an export action history panel", addresses: [requirement.text] },
      { text: "Add an export action audit log", addresses: [requirement.text] },
    ],
    signaledSimplicity: true,
    ambition: 0.2,
  });
  assert.equal(minimise.recommendation, "MINIMIZE");
});

/* ------------------------------------------------------------------ *
 * 13. Maintains continuity between voice, chat and browser sessions
 * ------------------------------------------------------------------ */

test("13 — one thread survives voice → chat → browser", () => {
  SurfaceContinuity.resetForTests();
  const continuity = SurfaceContinuity.getInstance();
  const conversationId = "conv-wp18-continuity";
  const now = Date.now();

  continuity.touch("voice", conversationId, {
    topic: "the migration plan for the audit log",
    lastDecision: "backfill actor ids before the next release",
    at: now - 5 * 60_000,
  });
  continuity.setOpenObjectives(conversationId, ["obj-audit"], now - 5 * 60_000);

  continuity.touch("chat", conversationId, { at: now });
  const chatBriefing = continuity.briefingFor("chat", conversationId, now);
  assert.ok(chatBriefing, "chat should receive a continuity briefing");
  assert.equal(chatBriefing?.previousSurface, "voice");
  assert.match(chatBriefing?.text ?? "", /audit log/);
  assert.match(chatBriefing?.text ?? "", /voice/);
  assert.match(chatBriefing?.text ?? "", /obj-audit|objective/);

  continuity.touch("browser", conversationId, { at: now + 1000 });
  const browserBriefing = continuity.briefingFor("browser", conversationId, now + 1000);
  assert.ok(browserBriefing);
  assert.deepEqual(
    new Set(browserBriefing?.crossedSurfaces),
    new Set(["voice", "chat", "browser"]),
  );
  assert.notEqual(browserBriefing?.previousSurface, "browser");
});

/* ------------------------------------------------------------------ *
 * 14. Demonstrates measurable improvement over repeated evaluations
 * ------------------------------------------------------------------ */

test("14 — a later window measures better than an earlier one, by outcome ratios", () => {
  const now = Date.now();
  const earlier: DevelopmentEvent[] = [];
  const later: DevelopmentEvent[] = [];

  const add = (target: DevelopmentEvent[], type: DevelopmentEventType, at: number) =>
    target.push(event(type, at));

  // Earlier window: questions mostly ignored, recommendations rejected,
  // objectives abandoned, interruptions unwanted, the same mistake twice.
  for (let index = 0; index < 6; index += 1) add(earlier, "question-asked", now - 9_000_000 + index);
  add(earlier, "question-answered", now - 9_000_000);
  add(earlier, "question-answered", now - 8_900_000);
  for (let index = 0; index < 4; index += 1) add(earlier, "question-ignored", now - 8_800_000 + index);
  add(earlier, "recommendation-rejected", now - 8_700_000);
  add(earlier, "recommendation-rejected", now - 8_600_000);
  add(earlier, "recommendation-rejected", now - 8_500_000);
  add(earlier, "recommendation-accepted", now - 8_400_000);
  add(earlier, "objective-continued", now - 8_300_000);
  for (let index = 0; index < 3; index += 1) add(earlier, "objective-abandoned", now - 8_200_000 + index);
  for (let index = 0; index < 4; index += 1) add(earlier, "interruption", now - 8_100_000 + index);
  add(earlier, "correction", now - 8_000_000);
  add(earlier, "correction-repeated", now - 7_900_000);
  add(earlier, "correction-repeated", now - 7_800_000);
  add(earlier, "anticipatory-action-failed", now - 7_700_000);

  // Later window: answers arrive, recommendations land, objectives
  // continue, interruptions are engaged, no repeated correction.
  for (let index = 0; index < 5; index += 1) add(later, "question-asked", now - 900_000 + index);
  for (let index = 0; index < 4; index += 1) add(later, "question-answered", now - 800_000 + index);
  add(later, "question-ignored", now - 700_000);
  for (let index = 0; index < 4; index += 1) add(later, "recommendation-accepted", now - 600_000 + index);
  add(later, "recommendation-rejected", now - 500_000);
  for (let index = 0; index < 4; index += 1) add(later, "objective-continued", now - 400_000 + index);
  for (let index = 0; index < 5; index += 1) add(later, "interruption", now - 300_000 + index);
  for (let index = 0; index < 3; index += 1) add(later, "interruption-engaged", now - 250_000 + index);
  // One correction, not repeated: discipline is 1.0 against the earlier
  // window's 0.33.
  add(later, "correction", now - 210_000);
  add(later, "anticipatory-action", now - 200_000);
  add(later, "anticipatory-action", now - 190_000);
  add(later, "anticipatory-action", now - 180_000);

  const before = summarizeDevelopment(earlier, 0, now);
  const after = summarizeDevelopment(later, 0, now);
  const comparison = compareDevelopment(before, after);

  assert.equal(comparison.improved, true);
  assert.ok((comparison.scoreDelta ?? 0) > 0.02);
  assert.match(comparison.caveat, /mean something/);
  assert.ok((after.metrics.questionEffectiveness ?? 0) > (before.metrics.questionEffectiveness ?? 0));
  assert.ok((after.metrics.objectiveContinuity ?? 0) > (before.metrics.objectiveContinuity ?? 0));
  assert.ok((after.metrics.correctionDiscipline ?? 0) > (before.metrics.correctionDiscipline ?? 0));
  // Improvement is a ratio, not an activity count: the score is built
  // only from outcomes that happened to the user, and the `events`
  // field is reported for context rather than rewarded.
  assert.ok((comparison.scoreDelta ?? 0) > 0.5, "the measured gain should be substantial, not noise");
});

/* ------------------------------------------------------------------ *
 * End to end through the bridge AIService actually calls.
 * ------------------------------------------------------------------ */

test("18 — a real turn is prepared and completed through the bridge", () => {
  TurnBridge.resetForTests();
  CollaborationModel.resetForTests();
  SurfaceContinuity.resetForTests();
  QuestioningLedger.resetForTests();
  LearningLedger.resetForTests();
  NeuralMapBridge.resetForTests();

  const bridge = TurnBridge.getInstance();
  const conversationId = "conv-wp18-bridge";
  const now = Date.now();
  const request =
    "Add a new memory engine with a plugin system for project memory. It must persist across a reload.";

  const prepared = bridge.prepareTurn({ message: request, conversationId, surface: "chat", at: now });
  assert.ok(prepared.context.includes("Scope judgement"), "the duplicate memory engine should be flagged");
  assert.ok(prepared.context.includes("memory"), "the existing capability should be named");
  assert.equal(prepared.questioning?.action === "ask" && !prepared.questioning.question, false);

  const plan = {
    goal: "Add persistent project memory",
    steps: [
      { title: "Persist project memory across a reload" },
      { title: "Build a new memory engine" },
      { title: "Build a plugin registry for memory backends" },
      { title: "Add a scheduler for background compaction" },
      { title: "Add a second cache layer" },
      { title: "Add an event bus for memory updates" },
    ],
  };
  const completed = bridge.completeTurn({
    message: request,
    reply: "I can do that. Here is the persistence plan.",
    conversationId,
    surface: "chat",
    plan,
    at: now + 1000,
  });
  assert.equal(completed.scope?.recommendation, "SIMPLIFY");
  assert.ok(completed.plan.answers.accomplished.every((item) => typeof item === "string"));

  // The scope judgement measured on the finished plan is carried into
  // the next turn, and the thread crosses chat → voice intact.
  const next = bridge.prepareTurn({
    message: "Use the smaller version, then continue where we left off.",
    conversationId,
    surface: "voice",
    at: now + 2000,
  });
  assert.ok(next.context.includes("Scope judgement on the previous plan"));
  assert.ok(next.continuity?.includes("chat"), "the voice turn should see it came from chat");
  assert.equal(next.mode === "executive" || next.mode === "collaborative" || next.mode === "conversational" || next.mode === "reflective" || next.mode === "observational", true);
});

/* ------------------------------------------------------------------ *
 * Guards: initiative must be grounded, and Neural Map must not blur
 * internal reasoning with what the user was told.
 * ------------------------------------------------------------------ */

test("15 — an ungrounded observation is suppressed, not turned into conversation", () => {
  const ungrounded: InitiativeSeed = {
    kind: "observation",
    text: "You might find it interesting that systems often evolve.",
    grounding: [],
    strength: 0.9,
  };
  const grounded: InitiativeSeed = {
    kind: "implication",
    text: "The export now includes the new fields, so the CSV consumer can drop its workaround.",
    grounding: [{ source: "queue:done", detail: "export task finished" }],
    strength: 0.7,
  };

  const selection = selectInitiatives([ungrounded, grounded], {
    mode: "collaborative",
    profile: PERMISSIVE_PROFILE,
    topic: "export the report as CSV with the new fields",
  });

  assert.equal(selection.contributions.length, 1);
  assert.equal(selection.contributions[0]?.kind, "implication");
  assert.ok(selection.suppressed.some((item) => item.reason === "no evidence to ground it"));
  assert.match(selection.contextBrief ?? "", /grounded in/);

  const empty = selectInitiatives([ungrounded], {
    mode: "collaborative",
    profile: PERMISSIVE_PROFILE,
    topic: "anything",
  });
  assert.equal(empty.contributions.length, 0);
  assert.equal(empty.contextBrief, null);
});

test("16 — a reversal is offered as a question, never asserted as inconsistency", () => {
  const check = findContradiction(
    "Actually, don't use SQLite for this — we should switch to Postgres.",
    [
      "Let's use SQLite for the local store, it keeps deployment simple.",
      "The export should include every column.",
    ],
  );
  assert.equal(check.contradiction, true);
  assert.match(check.earlier ?? "", /SQLite/);

  const unrelated = findContradiction("Actually, the build is fast now.", ["We should use SQLite."]);
  assert.equal(unrelated.contradiction, false);
});

test("17 — Neural Map keeps internal reasoning out of the user-visible layer", () => {
  NeuralMapBridge.resetForTests();
  const bridge = NeuralMapBridge.getInstance();
  bridge.reset();
  bridge.record({
    kind: "self-questioning",
    subject: "Is the cache assumption verified?",
    detail: "assumption — the cache is cold at boot",
    visibility: "internal",
    refs: { conversationId: "conv-neural", objectiveId: "obj-neural" },
  });
  bridge.record({
    kind: "clarification",
    subject: "Which environment?",
    detail: "Which environment should this run in?",
    visibility: "user-visible",
    refs: { conversationId: "conv-neural" },
  });

  const v2 = bridge.projectV2();
  assert.equal(v2.version, "v2");
  assert.ok(v2.nodes.some((node) => node.kind === "self-questioning"));
  assert.ok(v2.edges.some((edge) => edge.relation === "concerns"));

  const v3 = bridge.projectV3();
  assert.equal(v3.version, "v3");
  assert.equal(v3.layers.userVisible.length, 1);
  assert.equal(v3.layers.internal.length, 1);
  assert.equal(v3.layers.userVisible[0]?.kind, "clarification");
  assert.ok(!v3.layers.userVisible.some((node) => node.kind === "self-questioning"));
  assert.ok(v3.salienceByKind["self-questioning"] > v3.salienceByKind["clarification"]);
});
