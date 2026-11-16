/**
 * ==========================================================
 * LÉLU — SELF-STUDY MUST CONCLUDE
 *
 * What these prove:
 *   1. A study is "answered" only when it has a conclusion.
 *   2. Titles of papers/articles never become self-study subjects.
 *   3. A "change" conclusion becomes exactly ONE Proposed proposal in
 *      the existing ImprovementQueue — never Approved, never twice —
 *      and later ones are held until the owner decides.
 *   4. With no provider, conclusions still happen deterministically.
 *   5. A model is consulted only to conclude, labelled "self-study",
 *      and never more than SYNTHESIS_PER_HOUR times an hour.
 *   6. The same evidence twice is not progress.
 *   7. Knowledge converges by subject instead of piling up.
 *   8. Personality changes are staged unless the owner chose otherwise.
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

import SelfStudyEngine, { HELD_FOR_DECISION, SYNTHESIS_PER_HOUR } from "../src/core/cognition/SelfStudyEngine";
import StudyObjectives, { type StudyObjective } from "../src/core/cognition/StudyObjectives";
import StudyAgentRouter, { type Investigation } from "../src/core/cognition/StudyAgentRouter";
import KnowledgeLibrary from "../src/core/cognition/KnowledgeLibrary";
import ImprovementQueue from "../src/core/selfdev/ImprovementQueue";
import AIService from "../src/core/AIService";
import AIProviderRegistry from "../src/core/AIProviderRegistry";
import ExecutionLogger from "../src/core/ExecutionLogger";
import ProviderResolver from "../src/core/router/ProviderResolver";
import UsageLedger from "../src/core/observability/UsageLedger";
import UsageBudgetGate from "../src/core/observability/UsageBudgetGate";

/**
 * Earlier tests in this file run real cycles that spend (and pace) the
 * background allowance. Tests that measure self-study's own rules start
 * from an unspent allowance so the gate is not what they observe.
 */
function freshAllowance(): void {
  (UsageLedger as unknown as { instance: unknown }).instance = new UsageLedger(() => Date.now(), null);
  (UsageBudgetGate as unknown as { instance: unknown }).instance = null;
}
import Brain from "../src/brain/Brain";
import LeluIdentity from "../src/core/identity/LeluIdentity";
import KvStore from "../src/core/storage/KvStore";
import { formatSelfStudyState } from "../src/core/cognition/CognitiveContext";
import {
  deterministicConclusion,
  evidenceFingerprint,
  isGroundedChange,
  isRelevantLead,
  parseConclusion,
} from "../src/core/cognition/StudyConclusion";
import { stopBackgroundCognition } from "./support/isolation";
import type AIProvider from "../src/providers/AIProvider";
import type { AIRequest, AIResponse, AIProviderHealth } from "../src/providers/AIProvider";
import type RouterContext from "../src/core/router/RouterContext";
import type ProviderRegistry from "../src/core/ProviderRegistry";

await stopBackgroundCognition();

/* ------------------------------------------------------------------ */
/* Harness: the REAL engine and stores; only the tool and model are    */
/* controlled, so each case's evidence is known.                       */
/* ------------------------------------------------------------------ */

type Investigate = (objective: StudyObjective) => Promise<Investigation>;
type Reason = (prompt: string, options?: { operation?: string }) => Promise<AIResponse>;

const router = StudyAgentRouter.getInstance() as unknown as { investigate: Investigate };
const ai = AIService.getInstance() as unknown as { reason: Reason };
const realInvestigate = router.investigate.bind(router);
const realReason = ai.reason.bind(ai);

function sourceRead(target: string, extra: string[] = []): Investigation {
  return {
    ok: true,
    agentId: null,
    agentName: "Engineering Agent",
    tool: "source-read",
    origin: "static-snapshot",
    evidence: [
      `Read ${target} from the STATIC SNAPSHOT — build-time content, may be behind the working tree.`,
      `${target}: 120 line(s).`,
      "Exports: class Example.",
      ...extra,
    ],
    leads: [],
    summary: `Read ${target} (4000 bytes) from the static snapshot.`,
  };
}

function reset(): void {
  StudyObjectives.getInstance().clear();
  const queue = ImprovementQueue.getInstance();
  for (const proposal of queue.list().filter((item) => item.origin?.kind === "self-study")) queue.remove(proposal.id);
}

function seed(target: string, origin: StudyObjective["origin"] = "discovery", priority = 99): StudyObjective {
  const created = StudyObjectives.getInstance().add({
    question: `What does ${target} contribute?`,
    detail: "test",
    origin,
    domain: "source",
    priority,
    createdInCycle: 0,
    target,
  });
  assert.ok(created);
  return created;
}

async function withStubs<T>(investigate: Investigate, reason: Reason, run: () => Promise<T>): Promise<T> {
  router.investigate = investigate;
  ai.reason = reason;
  try {
    return await run();
  } finally {
    router.investigate = realInvestigate;
    ai.reason = realReason;
  }
}

const noModel: Reason = async () => ({ text: "", provider: "offline", model: "offline", processingTime: 0, metadata: { success: false } });

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

test("titles of external papers never become self-study subjects", () => {
  const known = (id: string) => id === "memory";
  assert.equal(isRelevantLead("Tabletop Roleplaying Games as Procedural Content Generators", "architecture-map", known), false);
  assert.equal(isRelevantLead("On model-independent pricing/hedging using shortfall risk", "source-list", known), false);
  assert.equal(isRelevantLead("anything", "knowledge-providers", known), false, "research results are not parts of her");
  assert.equal(isRelevantLead("src/core/memory/MemoryStore.ts", "source-read", known), true);
  assert.equal(isRelevantLead("memory", "architecture-map", known), true);
});

test("a deterministic conclusion proposes change only from evidence that says so", () => {
  const marker = sourceRead("src/a.ts", ["Unfinished markers (1): // TODO: persist the cache"]);
  const changed = deterministicConclusion({ subject: "src/a.ts", domain: "source", question: "q" }, marker);
  assert.equal(changed.verdict, "change");
  assert.match(changed.change ?? "", /src\/a\.ts/);
  assert.ok(changed.verification && changed.expectedBenefit && changed.risks);

  // A marker that is only a regex or user-facing text is not unfinished work.
  const regexOnly = deterministicConclusion(
    { subject: "src/r.ts", domain: "source", question: "q" },
    sourceRead("src/r.ts", ['Unfinished markers (1): const todos = lines.filter((line) => /TODO|FIXME/.test(line));']),
  );
  assert.equal(regexOnly.verdict, "no-change");

  const clean = deterministicConclusion({ subject: "src/b.ts", domain: "source", question: "q" }, sourceRead("src/b.ts", ["No unfinished markers found."]));
  assert.equal(clean.verdict, "no-change");

  const failed = deterministicConclusion(
    { subject: "src/c.ts", domain: "source", question: "q" },
    { ok: false, tool: "source-read", evidence: ["Could not read src/c.ts"], summary: "Could not read src/c.ts." },
  );
  assert.equal(failed.verdict, "insufficient");
});

test("a model's proposed change must name something the evidence touched", () => {
  const parsed = parseConclusion("LEARNED: x\nVERDICT: change\nCHANGE: rewrite the whole planner\nNEXT: none");
  assert.equal(parsed.verdict, "change");
  assert.equal(parsed.next, undefined);
  assert.equal(isGroundedChange(parsed.change!, "src/core/memory/MemoryStore.ts", ["MemoryStore.ts: 200 line(s)."]), false);
  assert.equal(isGroundedChange("Persist eviction in MemoryStore before reload", "src/core/memory/MemoryStore.ts", []), true);
  assert.equal(parseConclusion("VERDICT: no change").verdict, "no-change");
  assert.equal(isGroundedChange("Wire a render queue so Video projects can export", "video", ["Capability “Video projects” (video) — status planned."]), true);
});

test("the evidence fingerprint ignores timestamps and durations", () => {
  assert.equal(
    evidenceFingerprint(["last success 2026-11-16T10:00:00.000Z", "ran in 120ms"]),
    evidenceFingerprint(["last success 2026-11-17T11:30:00.000Z", "ran in 340ms"]),
  );
  assert.notEqual(evidenceFingerprint(["a"]), evidenceFingerprint(["b"]));
});

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

test("no objective is answered without a conclusion, and every study states its purpose", { timeout: 120_000 }, async () => {
  reset();
  const engine = SelfStudyEngine.getInstance();
  for (let index = 0; index < 12; index += 1) await engine.runCycle();
  const objectives = StudyObjectives.getInstance().list();
  for (const item of objectives.filter((o) => o.status === "answered")) {
    assert.ok(item.conclusion, `answered without a conclusion: ${item.question}`);
    assert.notEqual(item.conclusion!.verdict, "insufficient");
  }
  for (const item of objectives) {
    assert.ok(item.purpose?.gap && item.purpose.sufficientEvidence, `no purpose: ${item.question}`);
  }
});

test("a 'change' conclusion becomes exactly one Proposed proposal; the next is held for the owner", { timeout: 60_000 }, async () => {
  reset();
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();
  const FIRST = "src/core/demo/First.ts";
  const SECOND = "src/core/demo/Second.ts";
  seed(FIRST);
  seed(SECOND, "discovery", 98);
  const selfStudyProposals = () => ImprovementQueue.getInstance().list().filter((item) => item.origin?.kind === "self-study");

  // Only the two demo files carry unfinished work; everything else the
  // engine generates on its own reads as complete.
  const investigate: Investigate = async (objective) =>
    objective.target === FIRST || objective.target === SECOND
      ? sourceRead(objective.target, [`Unfinished markers (1): // TODO: finish ${objective.target}`])
      : { ...sourceRead(objective.target ?? "x"), tool: "architecture-map" };

  await withStubs(investigate, noModel, async () => {
    for (let index = 0; index < 10 && !(ledger.latestConclusionFor(FIRST) && ledger.latestConclusionFor(SECOND)); index += 1) {
      await engine.runCycle();
    }
    const first = ledger.latestConclusionFor(FIRST);
    const second = ledger.latestConclusionFor(SECOND);
    assert.equal(first?.verdict, "change");
    assert.equal(second?.verdict, "change");

    // Exactly one was proposed; the other is held.
    assert.equal(selfStudyProposals().length, 1, "one self-study proposal at a time");
    const [proposed, held] = first?.proposalId ? [first, second] : [second, first];
    assert.ok(proposed?.proposalId);
    assert.equal(held?.proposalId, undefined);
    assert.equal(held?.held, HELD_FOR_DECISION);

    const proposal = ImprovementQueue.getInstance().get(proposed!.proposalId!);
    assert.equal(proposal?.status, "Proposed", "proposed, never approved by study");
    assert.equal(proposal?.origin?.subject, proposed!.subject);
    assert.ok(proposal!.proposedSolution.includes(proposed!.subject));
    assert.ok(proposal!.testPlan.length > 0 && proposal!.expectedBenefit.length > 0 && proposal!.risk.length > 0);

    // The chat context reports the outcome, not just the question.
    const context = formatSelfStudyState(engine.getCognitiveState());
    assert.match(context, /CONCLUSIONS FROM SELF-STUDY/);
    assert.match(context, /PROPOSAL AWAITING THE OWNER'S DECISION/);

    // The owner decides (rejects) → the held one is promoted next cycle.
    ImprovementQueue.getInstance().setStatus(proposed!.proposalId!, "Rejected");
    await engine.runCycle();
    const promoted = ledger.latestConclusionFor(held!.subject);
    assert.ok(promoted?.proposalId, "the held conclusion was proposed once the first was decided");
    assert.equal(ImprovementQueue.getInstance().get(promoted!.proposalId!)?.status, "Proposed");
    assert.equal(selfStudyProposals().filter((item) => item.status === "Proposed").length, 1);
  });
});

test("with no provider reachable, studies still conclude", { timeout: 60_000 }, async () => {
  reset();
  seed("src/core/demo/Third.ts", "architecture");
  const report = await withStubs(async (o) => sourceRead(o.target ?? "", ["No unfinished markers found."]), noModel, () =>
    SelfStudyEngine.getInstance().runCycle(),
  );
  assert.equal(report.provider, null);
  assert.equal(report.conclusion?.verdict, "no-change");
  assert.equal(StudyObjectives.getInstance().get(report.objective!.id)?.status, "answered");
});

test("a model is called only to conclude, labelled self-study, and within the hourly cap", { timeout: 120_000 }, async () => {
  reset();
  freshAllowance();
  const engine = SelfStudyEngine.getInstance();
  const operations: (string | undefined)[] = [];
  const reason: Reason = async (_prompt, options) => {
    operations.push(options?.operation);
    return {
      text: "LEARNED: the file is complete.\nRELEVANCE: part of memory.\nVERDICT: no-change\nNEXT: none",
      provider: "stub",
      model: "stub",
      processingTime: 1,
      metadata: { success: true },
    };
  };
  const spentBefore = engine.synthesesThisHour();

  await withStubs(async (o) => sourceRead(o.target ?? "", [`distinct ${o.target}`]), reason, async () => {
    // Follow-up reads (discovery) never spend a model call.
    seed("src/core/demo/Follow.ts", "discovery");
    await engine.runCycle();
    assert.equal(operations.length, 0, "a follow-up read is concluded from its evidence");

    // Judgement-worthy studies do, up to the cap and no further.
    for (let index = 0; index < SYNTHESIS_PER_HOUR + 3; index += 1) {
      seed(`src/core/demo/Judge${index}.ts`, "architecture");
      await engine.runCycle();
    }
  });
  assert.ok(operations.length > 0);
  assert.ok(operations.every((operation) => operation === "self-study"));
  assert.ok(engine.synthesesThisHour() <= SYNTHESIS_PER_HOUR);
  assert.ok(operations.length <= SYNTHESIS_PER_HOUR - spentBefore, `spent ${operations.length}`);
});

test("the operation label reaches the usage ledger", async () => {
  freshAllowance();
  const registry = new AIProviderRegistry();
  const health: AIProviderHealth = { available: true, initialized: true, lastChecked: Date.now() };
  const provider: AIProvider = {
    name: "labelled",
    priority: 1,
    enabled: true,
    timeout: 1000,
    requiresApiKey: false,
    capabilities: ["chat"],
    async initialize() {},
    async isAvailable() { return true; },
    async health() { return health; },
    canHandle() { return true; },
    async generate(_request: AIRequest): Promise<AIResponse> {
      return { text: "ok", provider: "labelled", model: "m", processingTime: 1 };
    },
  };
  registry.register(provider);
  const context = {
    request: { messages: [{ role: "user" as const, content: "x" }], prompt: "x", operation: "self-study" },
    started: Date.now(),
    brain: new Brain(),
    knowledgeProviders: { all: () => [] } as unknown as ProviderRegistry,
    aiProviders: registry,
    logger: new ExecutionLogger(),
    intent: "chat" as const,
  } satisfies RouterContext;
  await new ProviderResolver().execute(context);
  const event = UsageLedger.getInstance().recent(5).find((item) => item.source === "labelled");
  assert.equal(event?.operation, "self-study");
});

test("the same evidence twice is not progress: a failing read is not retried a third time", { timeout: 60_000 }, async () => {
  reset();
  const objective = seed("src/core/demo/Missing.ts");
  const failing: Investigate = async () => ({
    ok: false,
    agentId: null,
    agentName: "Engineering Agent",
    tool: "source-read",
    origin: "static-snapshot",
    evidence: ["Could not read src/core/demo/Missing.ts from the snapshot."],
    leads: [],
    summary: "Could not read src/core/demo/Missing.ts.",
    error: "not in snapshot",
  });
  const attempts = () => StudyObjectives.getInstance().get(objective.id)?.attempts ?? 0;
  await withStubs(
    async (o) => (o.id === objective.id ? failing(o) : { ...sourceRead(o.target ?? "x"), tool: "architecture-map" }),
    noModel,
    async () => {
      // Park everything else so the retry is what the next cycle works on
      // (after a failure its priority drops, which is intended).
      const isolate = () => {
        for (const other of StudyObjectives.getInstance().open()) {
          if (other.id !== objective.id) StudyObjectives.getInstance().update(other.id, { status: "unresolved" });
        }
      };
      isolate();
      await SelfStudyEngine.getInstance().runCycle();
      assert.equal(attempts(), 1);
      assert.equal(StudyObjectives.getInstance().get(objective.id)?.status, "open", "one failure leaves it open");
      isolate();
      await SelfStudyEngine.getInstance().runCycle();
    },
  );
  const after = StudyObjectives.getInstance().get(objective.id);
  assert.equal(after?.status, "unresolved", "identical evidence on the retry closes it");
  assert.equal(after?.attempts, 2);
});

test("knowledge converges on one entry per subject", { timeout: 60_000 }, async () => {
  reset();
  const library = KnowledgeLibrary.getInstance();
  const before = library.list().filter((entry) => entry.subject === "src/core/demo/Shared.ts").length;
  await withStubs(async (o) => sourceRead(o.target ?? "", [`variant ${o.question.length}`]), noModel, async () => {
    for (const question of ["What does src/core/demo/Shared.ts contribute?", "How is src/core/demo/Shared.ts used by memory?"]) {
      StudyObjectives.getInstance().add({ question, detail: "t", origin: "discovery", domain: "source", priority: 99, createdInCycle: 0, target: "src/core/demo/Shared.ts" });
      await SelfStudyEngine.getInstance().runCycle();
    }
  });
  const entries = library.list().filter((entry) => entry.subject === "src/core/demo/Shared.ts");
  assert.equal(before, 0);
  assert.equal(entries.length, 1, "two studies of one file, one entry");
  assert.equal(entries[0].category, "architecture");
});

/* ------------------------------------------------------------------ */
/* Personality is staged unless the owner chose otherwise              */
/* ------------------------------------------------------------------ */

test("personality changes are staged by default, and the owner's explicit choice is kept", () => {
  const identity = LeluIdentity.getInstance() as unknown as { cache: unknown };
  // An identity stored under the old default: sandboxMode false, never chosen.
  const stored = { ...LeluIdentity.getInstance().getState(), sandboxMode: false, sandboxModeChosenAt: undefined };
  KvStore.getInstance().set("identity.v1", stored);
  identity.cache = null;
  assert.equal(LeluIdentity.getInstance().getState().sandboxMode, true, "an unchosen default is read as staged");

  LeluIdentity.getInstance().setSandboxMode(false);
  identity.cache = null;
  assert.equal(LeluIdentity.getInstance().getState().sandboxMode, false, "the owner turning it off is respected");
  LeluIdentity.getInstance().setSandboxMode(true);
});
