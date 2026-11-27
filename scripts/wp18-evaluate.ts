/**
 * ==========================================================
 * LÉLU — WP18 EVALUATION HARNESS
 *
 * Produces two things that a unit test cannot:
 *
 *   1. REAL INTERACTION RECORD. A short multi-surface conversation is
 *      driven through TurnBridge — the same object AIService calls —
 *      against the real stores. The captured preparation contexts and
 *      replies are what LÉLU actually assembled, not a mock.
 *
 *   2. MEASURED PERFORMANCE COMPARISON. A deterministic simulated user
 *      runs the same six requests for twelve rounds. The first three
 *      rounds are the baseline; three unnecessary questions are ignored
 *      each round. The last three rounds are measured after that
 *      feedback. The comparison reports how many questions were asked,
 *      how many were unnecessary, and whether the necessary ones were
 *      still asked — a drop in asks with a drop in recall would be a
 *      regression, not an improvement, and the harness fails on that.
 *
 * No model is called. Every number below is computed from the engine's
 * own decisions.
 *
 * Usage: npx tsx scripts/wp18-evaluate.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";

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

import AgentObjectives from "../src/core/cognition/AgentObjectives";
import CollaborationModel from "../src/core/conversation/CollaborationModel";
import LearningLedger from "../src/core/conversation/LearningLedger";
import NeuralMapBridge from "../src/core/conversation/NeuralMapBridge";
import QuestioningLedger, {
  decideQuestioning,
  type QuestioningInput,
} from "../src/core/conversation/QuestioningPolicy";
import SurfaceContinuity from "../src/core/conversation/SurfaceContinuity";
import TurnBridge from "../src/core/conversation/TurnBridge";
import { assessScope, extractDependencies, type ScopeInput } from "../src/core/conversation/ScopeIntelligence";
import { interrogate } from "../src/core/conversation/SelfInterrogation";
import { planContinuation } from "../src/core/conversation/ContinuationPlanner";
import { findContradiction } from "../src/core/conversation/ConversationalInitiative";

/* ------------------------------------------------------------------ *
 * 1. MEASURED QUESTIONING BEHAVIOUR
 * ------------------------------------------------------------------ */

interface Scenario {
  id: string;
  request: string;
  /** The user would answer this one; it changes the work. */
  necessary: boolean;
  materiality: number;
  known: number;
  ambiguity: number;
  importance: number;
  question: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "referential-gap",
    request: "Update it so the report exports correctly",
    necessary: true,
    materiality: 1,
    known: 0,
    ambiguity: 0.7,
    importance: 0.9,
    question: "Which item does “it” refer to?",
  },
  {
    id: "undefined-done",
    request: "Improve the cache layer",
    necessary: true,
    materiality: 1,
    known: 0.05,
    ambiguity: 0.6,
    importance: 0.85,
    question: "What would count as done for the cache layer?",
  },
  {
    id: "vague-settings",
    request: "Improve the settings screen",
    necessary: false,
    materiality: 0.62,
    known: 0.15,
    ambiguity: 0.55,
    importance: 0.7,
    question: "Which part of the settings screen should change?",
  },
  {
    id: "vague-dashboard",
    request: "Optimise the dashboard",
    necessary: false,
    materiality: 0.62,
    known: 0.15,
    ambiguity: 0.55,
    importance: 0.7,
    question: "Which dashboard metric matters most?",
  },
  {
    id: "vague-export",
    request: "Fix the export",
    necessary: false,
    materiality: 0.62,
    known: 0.15,
    ambiguity: 0.6,
    importance: 0.7,
    question: "What is wrong with the export?",
  },
  {
    id: "clear-instruction",
    request: "Rename `src/core/foo.ts` to `src/core/bar.ts` and update the imports",
    necessary: false,
    materiality: 0,
    known: 1,
    ambiguity: 0.1,
    importance: 0.7,
    question: "",
  },
];

interface RoundResult {
  round: number;
  asked: number;
  unnecessaryAsks: number;
  necessaryAsks: number;
  missedNecessary: number;
}

function runAdaptation(): {
  rounds: RoundResult[];
  baseline: RoundResult;
  adapted: RoundResult;
  improvement: Record<string, number>;
  effectiveness: ReturnType<QuestioningLedger["effectiveness"]>;
} {
  const ledger = QuestioningLedger.getInstance();
  ledger.reset();
  const rounds: RoundResult[] = [];

  for (let round = 1; round <= 12; round += 1) {
    const result: RoundResult = {
      round,
      asked: 0,
      unnecessaryAsks: 0,
      necessaryAsks: 0,
      missedNecessary: 0,
    };
    for (const scenario of SCENARIOS) {
      const input: QuestioningInput = {
        objective: scenario.request,
        ambiguity: scenario.ambiguity,
        missing: scenario.question
          ? [
              {
                what: "the missing detail",
                materiality: scenario.materiality,
                known: scenario.known,
                discoverable: false,
              },
            ]
          : [],
        decisionImportance: scenario.importance,
        priorQuestions: ledger.historyFor(
          scenario.question ? scenario.materiality * (1 - scenario.known) : 0,
          60,
        ).map((record) => ({
          key: record.key,
          askedAt: record.at,
          answered: record.outcome === "answered",
          ignored: record.outcome === "ignored",
        })),
        corrections: 0,
        questionTolerance: 0.55,
        proposedQuestion: scenario.question,
        expectedAction: "the most direct reading of the request",
        learnedAdjustment: ledger.toleranceAdjustmentFor(
          scenario.question ? scenario.materiality * (1 - scenario.known) : 0,
        ),
        now: 1_700_000_000_000 + round * 60_000,
      };
      const decision = decideQuestioning(input);
      if (decision.action !== "ask") {
        if (scenario.necessary) result.missedNecessary += 1;
        continue;
      }
      result.asked += 1;
      ledger.record(decision, { at: 1_700_000_000_000 + round * 60_000 });
      if (scenario.necessary) {
        result.necessaryAsks += 1;
        ledger.recordAnswered(decision.key, 1_700_000_000_000 + round * 60_000 + 1);
      } else {
        result.unnecessaryAsks += 1;
        ledger.recordIgnored(decision.key, 1_700_000_000_000 + round * 60_000 + 1);
      }
    }
    rounds.push(result);
  }

  const sum = (window: RoundResult[]) => ({
    round: 0,
    asked: window.reduce((total, item) => total + item.asked, 0),
    unnecessaryAsks: window.reduce((total, item) => total + item.unnecessaryAsks, 0),
    necessaryAsks: window.reduce((total, item) => total + item.necessaryAsks, 0),
    missedNecessary: window.reduce((total, item) => total + item.missedNecessary, 0),
  });
  const baseline = sum(rounds.slice(0, 3));
  const adapted = sum(rounds.slice(-3));

  const improvement = {
    unnecessaryAsks: baseline.unnecessaryAsks - adapted.unnecessaryAsks,
    necessaryAsksRetained: adapted.necessaryAsks - baseline.necessaryAsks,
    missedNecessary: baseline.missedNecessary - adapted.missedNecessary,
    totalAsks: baseline.asked - adapted.asked,
  };

  return { rounds, baseline, adapted, improvement, effectiveness: ledger.effectiveness() };
}

function measureDecisionLatency(iterations = 2000): { meanMs: number; p95Ms: number; totalMs: number } {
  const input: QuestioningInput = {
    objective: "Add a completion badge to finished projects",
    ambiguity: 0.35,
    missing: [{ what: "which project surface", materiality: 0.6, known: 0.2, discoverable: false }],
    decisionImportance: 0.7,
    priorQuestions: [],
    corrections: 0,
    questionTolerance: 0.5,
    proposedQuestion: "Which project surface should show the badge?",
    expectedAction: "add it to the project card",
    learnedAdjustment: 0,
  };
  const timings: number[] = [];
  const overallStart = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    decideQuestioning(input);
    timings.push(performance.now() - started);
  }
  const totalMs = performance.now() - overallStart;
  timings.sort((a, b) => a - b);
  return {
    meanMs: Number((totalMs / iterations).toFixed(4)),
    p95Ms: Number((timings[Math.floor(iterations * 0.95)] ?? 0).toFixed(4)),
    totalMs: Number(totalMs.toFixed(2)),
  };
}

/* ------------------------------------------------------------------ *
 * 2. REAL INTERACTION RECORD
 * ------------------------------------------------------------------ */

function runInteraction(): Record<string, unknown> {
  TurnBridge.resetForTests();
  CollaborationModel.resetForTests();
  SurfaceContinuity.resetForTests();
  QuestioningLedger.resetForTests();
  LearningLedger.resetForTests();
  NeuralMapBridge.resetForTests();

  const bridge = TurnBridge.getInstance();
  const conversationId = "wp18-demo-thread";
  const t0 = Date.now();

  // A real completed objective, so the continuation below has evidence
  // to draw on instead of being written to look like it does.
  const objectives = AgentObjectives.getInstance();
  const finished = objectives.create({
    agentId: "wp18-demo",
    objective: "Migrate the audit log table to the new schema",
    source: "agent",
  });
  objectives.complete(finished.id, "the migration exposed two rows with null actor ids");

  const request =
    "Add a new memory engine with a plugin system for project memory. It must persist across a reload.";
  const prepared = bridge.prepareTurn({ message: request, conversationId, surface: "chat", at: t0 });
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
    reply:
      "I can do that. Project memory currently lives in the browser store, so persistence is a real change.",
    conversationId,
    surface: "chat",
    plan,
    at: t0 + 1000,
  });

  const voice = bridge.prepareTurn({
    message: "Use the smaller version, then keep going from where we were.",
    conversationId,
    surface: "voice",
    at: t0 + 2000,
  });

  const correction = bridge.prepareTurn({
    message: "No — that's not what I meant. Keep the plugin registry, drop the second cache layer.",
    conversationId,
    surface: "chat",
    at: t0 + 3000,
  });

  const questionRequest = bridge.prepareTurn({
    message: "Rotate it ninety degrees so the label faces the camera.",
    conversationId: "wp18-demo-referent",
    surface: "voice",
    at: t0 + 4000,
  });

  const neural = NeuralMapBridge.getInstance();
  const v2 = neural.projectV2();
  const v3 = neural.projectV3();

  return {
    thread: conversationId,
    turns: [
      {
        surface: "chat",
        request,
        mode: prepared.mode,
        scopeBeforePlan: prepared.scope?.recommendation ?? null,
        scopeNotePresent: prepared.context.includes("Scope judgement"),
        observation: prepared.initiatives.map((initiative) => initiative.text),
        injectedContext: prepared.context,
      },
      {
        surface: "chat",
        reply: completed.continuation
          ? `${"I can do that. Project memory currently lives in the browser store, so persistence is a real change."}\n\n${completed.continuation}`
          : "I can do that. Project memory currently lives in the browser store, so persistence is a real change.",
        scopeAfterPlan: completed.scope?.recommendation ?? null,
        preserved: completed.scope?.preserved ?? [],
        appendedContinuation: completed.continuation,
      },
      {
        surface: "voice",
        request: "Use the smaller version, then keep going from where we were.",
        mode: voice.mode,
        continuityCarried: voice.continuity,
        scopeNoteCarried: voice.context.includes("Scope judgement on the previous plan"),
      },
      {
        surface: "chat",
        request: "No — that's not what I meant. Keep the plugin registry, drop the second cache layer.",
        mode: correction.mode,
        collaborationEvidence: correction.profile.evidence.map((item) => item.detail),
        contradictionOffered: correction.initiatives.some((initiative) => initiative.kind === "contradiction"),
      },
      {
        surface: "voice",
        request: "Rotate it ninety degrees so the label faces the camera.",
        questioning: questionRequest.questioning?.action ?? null,
        question: questionRequest.questioning?.question ?? null,
        whyAsked: questionRequest.questioning?.reasons
          .filter((reason) => reason.delta > 0)
          .map((reason) => reason.detail),
      },
    ],
    neuralMap: {
      v2Nodes: v2.nodes.length,
      v2Edges: v2.edges.length,
      v2Kinds: v2.byKind,
      v3Internal: v3.layers.internal.length,
      v3UserVisible: v3.layers.userVisible.length,
      distinctionMaintained: v3.layers.userVisible.every((node) =>
        ["post-action-continuation", "clarification", "conversational-initiative"].includes(node.kind),
      ),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 3. DIRECT DEMONSTRATIONS
 * ------------------------------------------------------------------ */

function runDemonstrations(): Record<string, unknown> {
  const challenge = interrogate({
    objective: "Replace the scheduler",
    conclusion: "The scheduler bottleneck is confirmed and the replacement is ready.",
    assumptions: [
      { text: "the current scheduler is the bottleneck", verified: false, evidence: "no profile was taken" },
    ],
    evidence: [
      {
        claim: "profiling points at the scheduler",
        stance: "contradicts",
        source: "profile:sample",
        detail: "94% of the time is spent in the renderer, not the scheduler",
      },
    ],
    recentActions: [{ tool: "profile-run", ok: false }],
    objectiveStillRelevant: true,
    nextStepDefined: true,
  });

  const scope = assessScope({
    objective: "Add memory persistence for projects, with a plugin system",
    requirements: [{ text: "Memory must persist across a reload", kind: "explicit", mustHave: true }],
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
  });

  const dependencyScope: ScopeInput = {
    objective: "Ship the usage dashboard",
    requirements: [{ text: "Show usage totals per workspace", kind: "explicit", mustHave: true }],
    plan: [{ text: "Render usage totals per workspace" }],
    dependencies: extractDependencies(
      "Ship the dashboard once the billing service exposes usage totals. It depends on the billing service.",
    ),
  };

  const continuation = planContinuation({
    completed: [{ what: "Migrate the audit log table", evidence: "objective:completed", at: 1_700_000_000_000 }],
    revealed: [{ finding: "two rows have null actor ids", evidence: "objective:conclusion" }],
    unresolved: [{ what: "the two null actor ids", evidence: "objective:conclusion" }],
    nextSteps: [{ action: "backfill the actor ids from the session log", source: "project:checkpoint" }],
    userTolerance: 0.7,
  });

  const contradiction = findContradiction(
    "Actually, don't use SQLite for the store — switch to Postgres.",
    ["Let's use SQLite for the store, it keeps deployment simple."],
  );

  return {
    selfChallenge: {
      considered: challenge.considered,
      conclusionHeld: challenge.conclusionHeld,
      challenges: challenge.challenges.map((item) => ({
        kind: item.kind,
        question: item.question,
        severity: item.severity,
      })),
    },
    scope: {
      recommendation: scope.recommendation,
      headline: scope.headline,
      incidental: scope.incidentalComplexity,
      preserved: scope.preserved,
    },
    dependency: {
      detected: extractDependencies(
        "Ship the dashboard once the billing service exposes usage totals. It depends on the billing service.",
      ),
      recommendation: assessScope(dependencyScope).recommendation,
      reasons: assessScope(dependencyScope).why,
    },
    continuation: {
      worthRaising: continuation.worthRaising,
      line: continuation.line,
      evidence: continuation.evidence,
    },
    contradiction,
  };
}

/* ------------------------------------------------------------------ *
 * MAIN
 * ------------------------------------------------------------------ */

const adaptation = runAdaptation();
const latency = measureDecisionLatency();
const interaction = runInteraction();
const demonstrations = runDemonstrations();

const performanceReport = {
  generatedAt: new Date().toISOString(),
  kind: "measured-deterministic",
  modelCalls: 0,
  adaptation: {
    rounds: adaptation.rounds,
    baselineWindow: adaptation.baseline,
    adaptedWindow: adaptation.adapted,
    improvement: adaptation.improvement,
    ledgerEffectiveness: adaptation.effectiveness,
  },
  decisionLatency: latency,
  verdict: {
    unnecessaryQuestionsReduced:
      adaptation.improvement.unnecessaryAsks > 0 &&
      adaptation.adapted.unnecessaryAsks < adaptation.baseline.unnecessaryAsks,
    necessaryQuestionsRetained:
      adaptation.adapted.necessaryAsks >= adaptation.baseline.necessaryAsks &&
      adaptation.adapted.missedNecessary <= adaptation.baseline.missedNecessary,
  },
};

const interactionReport = {
  generatedAt: new Date().toISOString(),
  interaction,
  demonstrations,
};

mkdirSync("artifacts/wp18", { recursive: true });
writeFileSync("artifacts/wp18/evaluation.json", `${JSON.stringify(performanceReport, null, 2)}\n`);
writeFileSync("artifacts/wp18/interactions.json", `${JSON.stringify(interactionReport, null, 2)}\n`);

console.log(
  [
    "WP18 evaluation complete (no model calls).",
    `Baseline unnecessary questions: ${adaptation.baseline.unnecessaryAsks}`,
    `Adapted unnecessary questions:  ${adaptation.adapted.unnecessaryAsks}`,
    `Necessary questions kept:       ${adaptation.baseline.necessaryAsks} → ${adaptation.adapted.necessaryAsks}`,
    `Missed necessary questions:     ${adaptation.baseline.missedNecessary} → ${adaptation.adapted.missedNecessary}`,
    `Decision latency mean/p95:      ${latency.meanMs} ms / ${latency.p95Ms} ms over 2000 decisions`,
    `Scope on a real plan:           ${String((interaction.turns[1] as Record<string, unknown>).scopeAfterPlan)}`,
    `Continuation appended:          ${String((interaction.turns[1] as Record<string, unknown>).appendedContinuation)}`,
    `Neural Map internal/visible:    ${(interaction.neuralMap as Record<string, unknown>).v3Internal} / ${(interaction.neuralMap as Record<string, unknown>).v3UserVisible}`,
    "Artifacts: artifacts/wp18/evaluation.json, artifacts/wp18/interactions.json",
  ].join("\n"),
);

if (
  !performanceReport.verdict.unnecessaryQuestionsReduced ||
  !performanceReport.verdict.necessaryQuestionsRetained
) {
  console.error("FAIL: the adaptation did not improve questioning without losing necessary asks.");
  process.exit(1);
}
