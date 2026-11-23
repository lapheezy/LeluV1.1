/**
 * ==========================================================
 * LÉLU — THE DEVELOPMENT RECORD AND BOTH GATES
 *
 *   1. Every stage of the record comes from persisted state.
 *   2. Gate 2: only an implemented proposal can be accepted or
 *      returned; nothing else advances while one is unaccepted
 *      or returned with feedback.
 *   3. Her self-study runs her own self-tests as a standing check,
 *      and a failing test becomes a proposal without a model call.
 *   4. She can state her record in conversation.
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

import SelfStudyEngine from "../src/core/cognition/SelfStudyEngine";
import StudyObjectives, { type StudyObjective } from "../src/core/cognition/StudyObjectives";
import StudyAgentRouter, { type Investigation } from "../src/core/cognition/StudyAgentRouter";
import ImprovementQueue, { isSettledByOwner } from "../src/core/selfdev/ImprovementQueue";
import AIService from "../src/core/AIService";
import {
  buildDevelopmentRecord,
  formatDevelopmentRecord,
  stageOf,
} from "../src/core/selfdev/DevelopmentRecord";
import { stopBackgroundCognition } from "./support/isolation";
import type { AIResponse } from "../src/providers/AIProvider";

await stopBackgroundCognition();

type Investigate = (objective: StudyObjective) => Promise<Investigation>;
const router = StudyAgentRouter.getInstance() as unknown as { investigate: Investigate };
const ai = AIService.getInstance() as unknown as { reason: (...args: unknown[]) => Promise<AIResponse> };
const realInvestigate = router.investigate.bind(router);
const realReason = ai.reason.bind(ai);
let modelCalls = 0;

function reset(): void {
  StudyObjectives.getInstance().clear();
  const queue = ImprovementQueue.getInstance();
  for (const proposal of queue.list().filter((item) => item.origin?.kind === "self-study")) queue.remove(proposal.id);
}

const selfTests = (failing: string[]): Investigation => ({
  ok: true,
  agentId: null,
  agentName: "Engineering Agent",
  tool: "self-test-runner",
  origin: "development-runtime",
  evidence: [`Self-test suite: ${23 - failing.length}/23 passed, ${failing.length} failed.`, ...failing.map((line) => `FAILING ${line}`)],
  leads: [],
  summary: `Testing: ${23 - failing.length}/23 in-browser tests passed (development runtime reachable).`,
});

const plainRead = (target: string): Investigation => ({
  ok: true,
  agentId: null,
  agentName: "Engineering Agent",
  tool: "architecture-map",
  origin: "none",
  evidence: [`Inspected ${target}.`, "Status working."],
  leads: [],
  summary: `Inspected ${target}.`,
});

async function withStubs<T>(failing: string[], run: () => Promise<T>): Promise<T> {
  router.investigate = async (objective) => (objective.domain === "testing" ? selfTests(failing) : plainRead(objective.target ?? "x"));
  ai.reason = async () => { modelCalls += 1; return { text: "", provider: "offline", model: "offline", processingTime: 0, metadata: { success: false } }; };
  try {
    return await run();
  } finally {
    router.investigate = realInvestigate;
    ai.reason = realReason;
  }
}

async function cyclesUntil(predicate: () => boolean, max = 12): Promise<void> {
  for (let index = 0; index < max && !predicate(); index += 1) await SelfStudyEngine.getInstance().runCycle();
}

const selfStudyProposals = () => ImprovementQueue.getInstance().list().filter((item) => item.origin?.kind === "self-study");

/* ------------------------------------------------------------------ */

test("her self-study runs her own self-tests, and a failing test becomes a proposal without a model call", { timeout: 60_000 }, async () => {
  reset();
  modelCalls = 0;
  await withStubs(["engineering/Sandbox runtime executes a script: returned the wrong exit code"], async () => {
    await cyclesUntil(() => selfStudyProposals().length > 0);
  });
  const testing = StudyObjectives.getInstance().list().find((objective) => objective.question === "Do my own self-tests still pass?");
  assert.ok(testing, "a standing self-test objective was generated");
  assert.equal(testing!.domain, "testing");
  const [proposal] = selfStudyProposals();
  assert.ok(proposal, "the failing test became a proposal");
  assert.equal(proposal.status, "Proposed");
  assert.equal(proposal.kind, "Bug");
  assert.equal(proposal.origin?.subject, "self-tests", "one subject across 6-hour windows");
  assert.match(proposal.proposedSolution, /Sandbox runtime executes a script/);
  // The self-test study is a revalidation, so it never asks for a model:
  // this proposal was reached from the failing test's evidence alone.
  assert.equal(StudyObjectives.getInstance().latestConclusionFor("self-tests")?.synthesizedBy, "deterministic");
});

test("every stage of the record comes from persisted state", () => {
  const conclusion = { verdict: "change" } as never;
  const base = { id: "p", status: "Proposed" } as never;
  assert.equal(stageOf(conclusion, undefined), "held");
  assert.equal(stageOf({ verdict: "no-change" } as never, undefined), "concluded-no-change");
  assert.equal(stageOf(conclusion, base), "awaiting-approval");
  assert.equal(stageOf(conclusion, { ...(base as object), status: "In Development" } as never), "in-development");
  assert.equal(stageOf(conclusion, { ...(base as object), status: "Failed" } as never), "needs-decision");
  assert.equal(stageOf(conclusion, { ...(base as object), status: "Ready" } as never), "awaiting-acceptance");
  assert.equal(stageOf(conclusion, { ...(base as object), status: "Ready", ownerDecision: { decision: "returned", at: 1 } } as never), "returned");
  assert.equal(stageOf(conclusion, { ...(base as object), status: "Integrated", ownerDecision: { decision: "accepted", at: 1 } } as never), "accepted");
  assert.equal(stageOf(conclusion, { ...(base as object), status: "Rejected" } as never), "rejected");
});

test("Gate 2: nothing advances until the owner accepts the implemented change", { timeout: 60_000 }, async () => {
  const queue = ImprovementQueue.getInstance();
  const [first] = selfStudyProposals();
  assert.ok(first, "the proposal from the first test exists");

  // Gate 2 cannot be recorded before there is an implementation.
  assert.equal(queue.recordOwnerDecision(first.id, "accepted"), false);

  // A second failing subject concludes "change" while the first is open.
  const held = StudyObjectives.getInstance().add({
    question: "What does src/core/demo/Held.ts contribute?",
    detail: "t",
    origin: "discovery",
    domain: "source",
    priority: 100,
    createdInCycle: 0,
    target: "src/core/demo/Held.ts",
  });
  router.investigate = async (objective) =>
    objective.id === held!.id
      ? { ...plainRead(objective.target ?? ""), tool: "source-read", evidence: ["Read it.", "Unfinished markers (1): // TODO: finish Held"] }
      : plainRead(objective.target ?? "x");
  ai.reason = async () => ({ text: "", provider: "offline", model: "offline", processingTime: 0, metadata: { success: false } });
  try {
    await cyclesUntil(() => Boolean(StudyObjectives.getInstance().latestConclusionFor("src/core/demo/Held.ts")));

    // Approved and implemented (Ready) — still unaccepted, so still held.
    queue.update(first.id, {
      status: "Ready",
      lastExecution: { executionId: "e1", kind: "develop", started: 1, finished: 2, filesInspected: ["a.ts"], filesChanged: ["a.ts"], checks: [{ name: "tests", ok: true, detail: "12/12" }], diff: "--- a\n+++ b" },
    });
    await SelfStudyEngine.getInstance().runCycle();
    assert.equal(selfStudyProposals().length, 1, "implemented but not accepted: nothing else is proposed");

    // Returned with feedback — still held.
    assert.equal(queue.recordOwnerDecision(first.id, "returned", "The exit code is still wrong on Safari."), true);
    await SelfStudyEngine.getInstance().runCycle();
    assert.equal(selfStudyProposals().length, 1, "returned: address the feedback first");
    assert.equal(isSettledByOwner(queue.get(first.id)!), false);

    // Accepted — the held conclusion advances to Gate 1.
    assert.equal(queue.recordOwnerDecision(first.id, "accepted", "Works."), true);
    await SelfStudyEngine.getInstance().runCycle();
  } finally {
    router.investigate = realInvestigate;
    ai.reason = realReason;
  }
  const proposals = selfStudyProposals();
  assert.equal(proposals.length, 2, "the next improvement advanced only after acceptance");
  assert.ok(proposals.some((item) => item.origin?.subject === "src/core/demo/Held.ts" && item.status === "Proposed"));

  // The record shows both, with the stages the owner acts on.
  const record = buildDevelopmentRecord(StudyObjectives.getInstance().list(), queue.list());
  const accepted = record.find((entry) => entry.proposal?.id === first.id)!;
  assert.equal(accepted.stage, "accepted");
  assert.equal(accepted.proposal?.implementation?.checks[0].ok, true);
  assert.equal(accepted.proposal?.ownerDecision?.note, "Works.");
  assert.ok(record.some((entry) => entry.stage === "awaiting-approval" && entry.conclusion.subject === "src/core/demo/Held.ts"));

  const text = formatDevelopmentRecord(record);
  assert.match(text, /MY DEVELOPMENT RECORD/);
  assert.match(text, /Accepted by you/);
  assert.match(text, /awaiting your approval \(Gate 1\)/);
  assert.match(text, /1\/1 check\(s\) passed/);
  assert.match(text, /your feedback: Works\./);
});
