/**
 * ==========================================================
 * LÉLU — CURIOSITY ENGINE
 *
 * CATEGORY: unit + integration. The engine runs on injected
 * ports (a fake catalog, dispatcher, memory and clock) so every
 * decision is deterministic; the integration tests then put
 * the REAL ToolDispatcher, AutonomyGate, ProactiveCore and
 * LeluIdentity behind those same ports. The end-to-end run
 * against the real AIService/Brain is scripts/verify-curiosity.ts.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

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
  classifyAction,
  classifyAnswer,
  classifyFailure,
  compareCuriosities,
  curiosityPermission,
  DEFAULT_BUDGET,
  detectConversationAmbiguity,
  detectOwnFailurePatterns,
  detectRepeatedFailures,
  detectUnconnectedCapabilities,
  hostQuestionCheck,
  nextStep,
  recallQuery,
  scorePriority,
  selectTools,
  verifyEvidence,
  type CatalogTool,
  type CuriosityEvidence,
  type CuriositySignal,
  type ObservedFailure,
} from "../src/core/curiosity/Curiosity";
import CuriosityEngine from "../src/core/curiosity/CuriosityEngine";
import { createDefaultPorts, type CuriosityPorts, type DispatchResult, type HostQuestionChange, type HostQuestionInput } from "../src/core/curiosity/CuriosityPorts";
import LeluIdentity from "../src/core/identity/LeluIdentity";
import KvStore from "../src/core/storage/KvStore";
import ProactiveCore from "../src/core/proactive/ProactiveCore";
import AutonomyGate from "../src/core/cognition/AutonomyGate";

const ROOT = new URL("..", import.meta.url).pathname;
const src = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");

/* ------------------------------------------------------------------ */
/* Fake ports                                                          */
/* ------------------------------------------------------------------ */

const CATALOG: CatalogTool[] = [
  { id: "memory.recall", available: true, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "Brain.recall" },
  { id: "system.config", available: true, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "ConfigStatus" },
  { id: "research.web", available: true, riskLevel: 1, permissions: ["READ", "EXTERNAL_ACTION"], executable: true, executionRoute: "ResearchResolver" },
  { id: "workflow.list", available: true, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "AgentWorkflowBridge.discover" },
  { id: "project.read", available: false, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "EngineeringWorkspace.readFile" },
  { id: "project.list", available: false, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "EngineeringWorkspace.list" },
  { id: "sandbox.write", available: true, riskLevel: 1, permissions: ["WRITE"], executable: true },
  { id: "project.apply", available: true, riskLevel: 4, permissions: ["WRITE", "EXTERNAL_ACTION"], executable: true },
  { id: "chat", available: true, riskLevel: 0, permissions: ["READ", "WRITE"], executable: false, executionRoute: "AIService.chat" },
];

interface Fake extends CuriosityPorts {
  clock: { t: number };
  memory: Array<{ layer: string; summary: string; keywords: string[] }>;
  calls: Array<{ tool: string; args: Record<string, unknown>; taskId: string }>;
  asked: HostQuestionInput[];
  proposals: Array<{ title: string; detail: string }>;
  traitEvidence: Array<{ traitId: string; observation: string }>;
  staged: Array<{ traitId: string; observation: string }>;
  journalLines: Array<{ field: string; text: string }>;
  emitFailure(failure: ObservedFailure): void;
  answer(key: string, response: string): void;
}

function fakePorts(options: {
  tools?: Record<string, (args: Record<string, unknown>) => Promise<DispatchResult> | DispatchResult>;
  permitted?: (id: string) => boolean;
  hostBusy?: boolean;
  hostEnabled?: boolean;
  userTurn?: boolean;
  consolidateOk?: boolean;
  recallFinds?: boolean;
  sandbox?: boolean;
  traitStatus?: string;
  realPersonality?: boolean;
} = {}): Fake {
  const failureListeners = new Set<(f: ObservedFailure) => void>();
  const hostListeners = new Set<(c: HostQuestionChange) => void>();
  const fake: Fake = {
    clock: { t: 1_000_000 },
    memory: [],
    calls: [],
    asked: [],
    proposals: [],
    traitEvidence: [],
    staged: [],
    journalLines: [],
    now: () => fake.clock.t,
    prepare: async () => {},
    userTurnActive: () => Boolean(options.userTurn),
    catalog: () => CATALOG,
    permitted: (id) => (options.permitted ? options.permitted(id) : CATALOG.some((t) => t.id === id && t.available)),
    async dispatch(tool, args, taskId) {
      fake.calls.push({ tool, args, taskId });
      if (tool === "memory.recall") {
        const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
        const hits = options.recallFinds === false ? [] : fake.memory.filter((m) => words.some((w) => `${m.summary} ${m.keywords.join(" ")}`.toLowerCase().includes(w)));
        return hits.length === 0
          ? { ok: false, content: `No stored memory matches "${args.query}".` }
          : { ok: true, content: hits.map((m, i) => `${i + 1}. [confidence 0.90] ${m.summary.slice(0, 120)} → ${m.summary}`).join("\n") };
      }
      const impl = options.tools?.[tool];
      return impl ? impl(args) : { ok: false, content: `No search was performed: ${tool} requires the router's provider registry and was called without it.` };
    },
    async consolidate(layer, summary, keywords) {
      if (options.consolidateOk === false) return false;
      fake.memory.push({ layer, summary, keywords });
      return true;
    },
    hostEnabled: () => options.hostEnabled ?? true,
    hostBusy: () => Boolean(options.hostBusy),
    askHost(input) {
      fake.asked.push(input);
      return `pq-${fake.asked.length}`;
    },
    onHostChange(listener) {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
    onToolFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    proposeObjective(title, detail) {
      fake.proposals.push({ title, detail });
      return { id: `wq-${fake.proposals.length}`, created: true };
    },
    sandboxMode: () => (options.realPersonality ? LeluIdentity.getInstance().getState().sandboxMode : Boolean(options.sandbox)),
    traitStatus: (id) => (options.realPersonality ? LeluIdentity.getInstance().getTrait(id)?.status : options.traitStatus ?? "candidate"),
    addTraitEvidence(traitId, observation) {
      fake.traitEvidence.push({ traitId, observation });
      if (options.realPersonality) LeluIdentity.getInstance().addTraitObservation(traitId, observation, false);
    },
    stageTraitEvidence(traitId, observation) {
      fake.staged.push({ traitId, observation });
      return `stage-${fake.staged.length}`;
    },
    journal(field, text) {
      fake.journalLines.push({ field, text });
    },
    emitFailure(failure) {
      for (const listener of failureListeners) listener(failure);
    },
    answer(key, response) {
      for (const listener of hostListeners) listener({ key, proactiveId: "pq", status: "resolved", response });
    },
  };
  return fake;
}

function signal(overrides: Partial<CuriositySignal> = {}): CuriositySignal {
  return {
    question: "Which workflows can I actually run right now?",
    unknown: "Which workflows are runnable.",
    context: "Planning the next workflow step.",
    category: "project",
    source: "project",
    importance: 0.7,
    uncertainty: 0.7,
    relevance: 0.8,
    expectedBenefit: 0.7,
    evidenceFingerprint: "fp-1",
    ...overrides,
  };
}

const failureSignal = (tool = "project.read", cause: "unavailable" | "missing-context" = "unavailable"): CuriositySignal =>
  detectRepeatedFailures(
    [
      { tool, taskId: "t1", message: cause === "unavailable" ? `"${tool}" is not available in this runtime, so it was not run.` : `${tool} requires the router's provider registry and was called without it.`, at: 1_000_000 },
      { tool, taskId: "t2", message: cause === "unavailable" ? `"${tool}" is not available in this runtime, so it was not run.` : `${tool} requires the router's provider registry and was called without it.`, at: 1_000_000 },
    ],
    undefined,
    1_000_000,
  )[0];

function freshIdentity(): void {
  KvStore.getInstance().remove("identity.v1");
  LeluIdentity.reset();
}

/* ------------------------------------------------------------------ */
/* DETECTION                                                           */
/* ------------------------------------------------------------------ */

test("detection: a meaningful ambiguity in Heru's request becomes a host curiosity with a concrete question", () => {
  const found = detectConversationAmbiguity("I want to make LÉLU more autonomous — something like letting her handle things on her own.");
  assert.ok(found);
  assert.equal(found.category, "host");
  assert.equal(found.subject?.phrase, "more autonomous");
  assert.match(found.hostQuestion ?? "", /which actions should she eventually be able to initiate without asking you\?/);
});

test("detection: ordinary or trivial messages raise nothing", () => {
  assert.equal(detectConversationAmbiguity("ok thanks, sounds good to me"), null);
  assert.equal(detectConversationAmbiguity("Can you make LÉLU more autonomous somehow?"), null, "a question to her is not an ambiguity in a request");
  assert.equal(detectConversationAmbiguity("The weather was sort of grey and cold this morning outside."), null, "vagueness without a directive is not curiosity");
  const engine = CuriosityEngine.reset(fakePorts());
  const result = engine.notice(signal({ importance: 0.1 }));
  assert.equal(result.curiosity, null);
  assert.match(result.reason ?? "", /importance/);
  assert.equal(engine.getLedger().list().length, 0, "a trivial signal leaves no record");
});

test("detection: duplicates and near-duplicates are consolidated, and an unchanged situation is a no-op", () => {
  const engine = CuriosityEngine.reset(fakePorts());
  const first = engine.notice(signal());
  const again = engine.notice(signal());
  assert.equal(again.merged, true);
  assert.equal(again.reason, "already carried");
  const near = engine.notice(signal({ question: "Which workflows can I actually run right now, today?", evidenceFingerprint: "fp-2" }));
  assert.equal(near.merged, true);
  assert.equal(engine.getLedger().list().length, 1);
  assert.equal(engine.getLedger().get(first.curiosity!.id)!.occurrences, 2, "only the genuinely new observation counted");
});

test("detection: a tool failing in two different turns is a curiosity; one turn, or empty results, are not", () => {
  const twoTurns = failureSignal();
  assert.ok(twoTurns);
  assert.equal(twoTurns.category, "technical");
  assert.equal(twoTurns.subject?.cause, "unavailable");
  assert.equal(detectRepeatedFailures([
    { tool: "x.y", taskId: "same", message: "not available", at: 1 },
    { tool: "x.y", taskId: "same", message: "not available", at: 1 },
  ], undefined, 1).length, 0);
  assert.equal(detectRepeatedFailures([
    { tool: "memory.recall", taskId: "a", message: "No stored memory matches \"q\".", at: 1 },
    { tool: "memory.recall", taskId: "b", message: "No stored memory matches \"q\".", at: 1 },
  ], undefined, 1).length, 0);
});

test("detection: failures observed on the real event path are picked up by a tick — her own are not", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  engine.configure({ autoInvestigate: false, capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER });
  engine.attachObservers();
  ports.emitFailure({ tool: "project.read", taskId: "curiosity-abc-1", message: "not available in this runtime", at: ports.clock.t });
  ports.emitFailure({ tool: "project.read", taskId: "curiosity-abc-2", message: "not available in this runtime", at: ports.clock.t });
  assert.deepEqual((await engine.tick()).noticed, [], "her own investigations are not fed back as observations");
  ports.emitFailure({ tool: "project.read", taskId: "turn-1", message: "not available in this runtime", at: ports.clock.t });
  ports.emitFailure({ tool: "project.read", taskId: "turn-2", message: "not available in this runtime", at: ports.clock.t });
  assert.deepEqual((await engine.tick()).noticed, ["Why does project.read keep failing?"]);
});

test("detection: knowledge gaps, capability gaps and her own failure patterns produce curiosities", () => {
  const gap = detectUnconnectedCapabilities(CATALOG);
  assert.ok(gap);
  assert.deepEqual(gap.subject?.tools, ["chat"], "only available-but-not-dispatchable capabilities");
  const engine = CuriosityEngine.reset(fakePorts());
  const knowledge = engine.notice(signal({ category: "world", source: "memory", question: "What is the current stable release line of the Vite build tool?", importance: 0.5 }));
  assert.equal(knowledge.curiosity?.status, "queued");
  const curiosity = engine.getLedger().get(knowledge.curiosity!.id)!;
  const failed = { ...curiosity, proposedActions: [{ tool: "research.web", outcome: "failed" as const, cause: "missing-context" as const, finishedAt: 1_000_000, resultSummary: "requires the router" }] };
  const other = { ...failed, id: "other" };
  const own = detectOwnFailurePatterns([failed as never, other as never], 1_000_000);
  assert.equal(own.length, 1);
  assert.equal(own[0].category, "self");
});

/* ------------------------------------------------------------------ */
/* PRIORITISATION                                                      */
/* ------------------------------------------------------------------ */

test("prioritisation: priority is bounded and multiplicative — weak on any axis stays low", () => {
  const strong = scorePriority({ importance: 0.9, uncertainty: 0.9, relevance: 0.9, expectedBenefit: 0.9 });
  const irrelevant = scorePriority({ importance: 0.9, uncertainty: 0.9, relevance: 0.05, expectedBenefit: 0.9 });
  assert.ok(strong > 0.6 && strong <= 1);
  assert.ok(irrelevant < 0.05);
  assert.ok(scorePriority({ importance: 5, uncertainty: 5, relevance: 5, expectedBenefit: 5, urgency: 9 }) <= 1);
});

test("prioritisation: objective blockers first, then technical uncertainty; exploration last", () => {
  const engine = CuriosityEngine.reset(fakePorts());
  engine.notice(signal({ category: "world", question: "What is the history of the printing press in Europe?", importance: 0.9, evidenceFingerprint: "w" }));
  engine.notice(signal({ category: "technical", question: "Why does the stream subscriber miss events?", importance: 0.6, evidenceFingerprint: "t" }));
  engine.notice(signal({ category: "host", question: "What does Heru want the briefing to contain?", blocksObjective: true, importance: 0.5, evidenceFingerprint: "b" }));
  const order = engine.getLedger().pursuable(1_000_000).map((c) => c.tier);
  assert.deepEqual(order, [1, 2, 7]);
  assert.ok([...engine.getLedger().active()].sort(compareCuriosities)[0].tier === 1);
});

test("prioritisation: a low-value curiosity is kept dormant and never pursued", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const low = engine.notice(signal({ importance: 0.3, uncertainty: 0.6, relevance: 0.6, expectedBenefit: 0.6 }));
  assert.equal(low.curiosity?.status, "identified");
  assert.equal(engine.getLedger().pursuable(ports.clock.t).length, 0);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER });
  const report = await engine.tick();
  assert.equal(report.pursued, undefined);
  assert.equal(ports.calls.length, 0);
});

test("prioritisation: expired curiosities leave the active queue but stay in history", () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(signal({ category: "world", question: "What is the oldest surviving map of the world?", importance: 0.6, evidenceFingerprint: "x" })).curiosity!;
  ports.clock.t += 4 * 24 * 60 * 60 * 1000;
  const expired = engine.getLedger().expire(ports.clock.t);
  assert.equal(expired.length, 1);
  assert.equal(engine.getLedger().active().length, 0);
  assert.equal(engine.getLedger().get(c.id)?.status, "expired");
});

/* ------------------------------------------------------------------ */
/* MEMORY                                                              */
/* ------------------------------------------------------------------ */

test("memory: memory is consulted before any tool and before asking Heru", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const host = detectConversationAmbiguity("I want to make LÉLU more autonomous — something like letting her handle things on her own.")!;
  const c = engine.notice(host).curiosity!;
  const after = await engine.pursue(c.id);
  assert.equal(ports.calls[0].tool, "memory.recall");
  assert.equal(after?.status, "asking");
  assert.equal(after?.proposedActions[0].tool, "memory.recall");
});

test("memory: a relevant memory answers it — no tool runs and Heru is not asked", async () => {
  const ports = fakePorts();
  ports.memory.push({ layer: "system", summary: "project.read fails because it is not available in this runtime (verified).", keywords: ["project.read", "project", "read"] });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal()).curiosity!;
  const after = await engine.pursue(c.id);
  assert.equal(after?.status, "resolved");
  assert.equal(after?.learning?.fromExistingMemory, true);
  assert.deepEqual(ports.calls.map((call) => call.tool), ["memory.recall"]);
  assert.equal(ports.asked.length, 0);
  assert.equal(ports.memory.length, 1, "nothing new was written for something already known");
});

test("memory: the statement that raised a host question, or a restatement of it, is not its answer", async () => {
  const ports = fakePorts();
  ports.memory.push({ layer: "knowledge", summary: "I want to make LÉLU more autonomous — something like letting her handle things on her own.", keywords: ["autonomous"] });
  ports.memory.push({ layer: "knowledge", summary: "User wants Lélu to become more autonomous, handling tasks on her own.", keywords: ["autonomous"] });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(detectConversationAmbiguity("I want to make LÉLU more autonomous — something like letting her handle things on her own.")!).curiosity!;
  assert.equal((await engine.pursue(c.id))?.status, "asking");
});

test("memory: new learning goes through consolidate and is only claimed once a recall returns it", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal()).curiosity!;
  const after = await engine.pursue(c.id);
  assert.equal(after?.status, "resolved");
  assert.equal(ports.memory.length, 1);
  assert.equal(ports.memory[0].layer, "system");
  assert.ok(ports.memory[0].keywords.includes("read"), "plain-word keywords so the Brain's search can match a dotted id");
  assert.equal(after?.learning?.stored, true);
  assert.equal(after?.learning?.retrievable, true);

  const rejecting = fakePorts({ consolidateOk: false });
  const e2 = CuriosityEngine.reset(rejecting);
  const c2 = e2.notice(failureSignal()).curiosity!;
  const blocked = await e2.pursue(c2.id);
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.learning?.stored, false);

  const forgetting = fakePorts({ recallFinds: false });
  const e3 = CuriosityEngine.reset(forgetting);
  const c3 = e3.notice(failureSignal()).curiosity!;
  const unrecalled = await e3.pursue(c3.id);
  assert.equal(unrecalled?.status, "blocked", "stored but not retrievable is NOT learned");
  assert.equal(unrecalled?.learning?.retrievable, false);
});

test("memory: recall queries are plain words the Brain can match", () => {
  assert.equal(recallQuery(["project.read", "autonomy"]), "project read autonomy");
});

test("memory: no second memory system — curiosity writes knowledge only through consolidate", () => {
  const files = readdirSync(`${ROOT}src/core/curiosity`).map((name) => src(`src/core/curiosity/${name}`)).join("\n");
  const imports = files.split("\n").filter((line) => /^\s*import\b|import\(/.test(line)).join("\n");
  for (const forbidden of ["IndexedDBStore", "PatternMemory", "MemoryStore", "brain/Brain", "MemoryBridge", "memory/providers"]) {
    assert.ok(!imports.includes(forbidden), `curiosity must not import ${forbidden}`);
  }
  for (const forbidden of ["new Brain", "registerProvider", "indexedDB.open"]) {
    assert.ok(!files.includes(forbidden), `curiosity must not use ${forbidden}`);
  }
  assert.ok(src("src/core/curiosity/CuriosityPorts.ts").includes(".consolidate(layer, summary, keywords)"));
  assert.ok(!src("src/core/MemoryBridge.ts").includes("Curiosity"), "no curiosity memory provider was added to the bridge");
});

/* ------------------------------------------------------------------ */
/* HOST                                                                */
/* ------------------------------------------------------------------ */

test("host: one concise question goes to the existing question channel, keyed to the curiosity", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(detectConversationAmbiguity("I want to make LÉLU more autonomous — something like letting her handle things on her own.")!).curiosity!;
  await engine.pursue(c.id);
  assert.equal(ports.asked.length, 1);
  assert.ok(ports.asked[0].key.startsWith("curiosity:"));
  assert.match(ports.asked[0].question, /without asking you\?$/);
  assert.equal(engine.getLedger().get(c.id)?.hostQuestion?.proactiveId, "pq-1");
});

test("host: the same question is not asked twice, and not while another one is waiting", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const host = detectConversationAmbiguity("I want to make LÉLU more autonomous — something like letting her handle things on her own.")!;
  const c = engine.notice(host).curiosity!;
  await engine.pursue(c.id);
  await engine.pursue(c.id);
  engine.notice(host);
  assert.equal(ports.asked.length, 1);

  const busy = fakePorts({ hostBusy: true });
  const e2 = CuriosityEngine.reset(busy);
  const c2 = e2.notice(host).curiosity!;
  const deferred = await e2.pursue(c2.id);
  assert.equal(busy.asked.length, 0);
  assert.equal(deferred?.status, "queued");
  assert.match(deferred?.trail.at(-1)?.detail ?? "", /interrupt/);
  assert.deepEqual(hostQuestionCheck({ untriedPermittedTools: 1, memoryAnswered: false, alreadyAsked: false, hostChannelOpen: true, hostBusy: false, importance: 0.9, tier: 1 }).ask, false, "she does not ask what she can still investigate");
});

test("host: Heru's answer is associated with the curiosity, classified, remembered — not written into identity", async () => {
  freshIdentity();
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  engine.attachObservers();
  const c = engine.notice(detectConversationAmbiguity("I want to make LÉLU more autonomous — something like letting her handle things on her own.")!).curiosity!;
  await engine.pursue(c.id);
  ports.answer(ports.asked[0].key, "I want her to run tests on her own, but she should always ask before changing files.");
  for (let i = 0; i < 20 && engine.getLedger().get(c.id)?.status !== "resolved"; i += 1) await new Promise((r) => setTimeout(r, 5));
  const done = engine.getLedger().get(c.id)!;
  assert.equal(done.status, "resolved");
  assert.equal(done.hostQuestion?.answer?.startsWith("I want her"), true);
  assert.equal(done.learning?.type, "constraint");
  assert.match(ports.memory[0].summary, /^Heru clarified “more autonomous”/);
  assert.equal(ports.traitEvidence.length, 0);
  assert.equal(LeluIdentity.getInstance().getState().preferences.length, 0);
});

test("host: answers are classified by what they are", () => {
  assert.equal(classifyAnswer("Never push to main without asking me."), "constraint");
  assert.equal(classifyAnswer("Let's go with the smaller panel."), "decision");
  assert.equal(classifyAnswer("Eventually I want her running the whole build."), "goal");
  assert.equal(classifyAnswer("I prefer short briefings."), "preference");
  assert.equal(classifyAnswer("The server is in Lagos."), "fact");
});

test("host (integration): the real ProactiveCore carries the question, and resolving it reaches the engine", async () => {
  const real = createDefaultPorts();
  ProactiveCore.getInstance().updateSettings({ enabled: true, notificationLevel: "normal" });
  const ports = fakePorts();
  const hybrid: CuriosityPorts = {
    ...ports,
    hostEnabled: real.hostEnabled,
    hostBusy: real.hostBusy,
    askHost: real.askHost,
    onHostChange: real.onHostChange,
  };
  const engine = CuriosityEngine.reset(hybrid);
  engine.attachObservers();
  const c = engine.notice(detectConversationAmbiguity("I want LÉLU to be more creative — you decide what that means at first.")!).curiosity!;
  const asked = await engine.pursue(c.id);
  assert.equal(asked?.status, "asking");
  const active = ProactiveCore.getInstance().getActiveQuestion();
  assert.equal(active?.key, asked?.hostQuestion?.key);
  assert.equal(active?.rememberAnswer, false, "the engine stores the answer itself, once");
  ProactiveCore.getInstance().resolveQuestion(active!.id, "I prefer she proposes small visual experiments first.");
  for (let i = 0; i < 20 && engine.getLedger().get(c.id)?.status !== "resolved"; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(engine.getLedger().get(c.id)?.status, "resolved");
  assert.equal(engine.getLedger().get(c.id)?.learning?.type, "preference");
  engine.detach();
});

/* ------------------------------------------------------------------ */
/* TOOL USE                                                            */
/* ------------------------------------------------------------------ */

test("tools: action classes and curiosity's own (narrower) permission policy", () => {
  const byId = (id: string) => CATALOG.find((tool) => tool.id === id)!;
  assert.equal(classifyAction(byId("system.config")), "READ");
  assert.equal(classifyAction(byId("research.web")), "EXTERNAL");
  assert.equal(classifyAction(byId("sandbox.write")), "WRITE");
  assert.equal(classifyAction({ id: "workspace.test", permissions: ["EXECUTE"] }), "ANALYZE");
  assert.equal(classifyAction({ id: "workflow.run", permissions: ["EXECUTE"] }), "EXECUTE");
  assert.equal(curiosityPermission(byId("system.config")), "auto");
  assert.equal(curiosityPermission(byId("research.web")), "auto", "read-only research");
  assert.equal(curiosityPermission(byId("sandbox.write")), "proposal");
  assert.equal(curiosityPermission({ id: "workflow.run", permissions: ["EXECUTE"], riskLevel: 1 }), "proposal");
  assert.equal(curiosityPermission(byId("project.apply")), "never");
});

test("tools (integration): an authorized tool executes through the REAL dispatcher; at autonomy 0 it is refused", async () => {
  const real = createDefaultPorts();
  await real.prepare();
  const gate = AutonomyGate.getInstance();
  const level = gate.getLevel();
  try {
    gate.setLevel(3);
    assert.equal(real.permitted("system.config"), true);
    const ran = await real.dispatch("system.config", {}, "curiosity-test-1");
    assert.equal(ran.ok, true);
    assert.equal(real.catalog().find((tool) => tool.id === "system.config")?.executable, true);
    gate.setLevel(0);
    assert.equal(real.permitted("system.config"), false);
    const refused = await real.dispatch("system.config", {}, "curiosity-test-2");
    assert.equal(refused.ok, false);
    assert.match(refused.content, /not permitted/);
  } finally {
    gate.setLevel(level);
  }
});

test("tools: an unauthorized tool is recorded as blocked and never dispatched", async () => {
  const ports = fakePorts({ permitted: (id) => id === "memory.recall" });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(signal({ category: "world", question: "What changed in the most recent TypeScript compiler release?", importance: 0.6 })).curiosity!;
  const after = await engine.pursue(c.id);
  assert.ok(!ports.calls.some((call) => call.tool === "research.web"));
  const intent = after!.proposedActions.find((i) => i.tool === "research.web")!;
  assert.equal(intent.outcome, "blocked");
  assert.match(intent.blockedReason ?? "", /not permitted by the dispatcher/);
  assert.equal(after?.status, "blocked", "every tool that could answer needs a permission it lacks");
});

test("tools: every intent records purpose and expected evidence, and its result is tied to the curiosity", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal()).curiosity!;
  const after = (await engine.pursue(c.id))!;
  const probe = after.proposedActions.find((i) => i.tool === "internal:tool-registry")!;
  assert.equal(probe.curiosityId, c.id);
  assert.equal(probe.actionClass, "ANALYZE");
  assert.match(probe.reason, /^I'm investigating “Why does project.read keep failing\?” because/);
  assert.ok(probe.expectedEvidence.length > 10);
  assert.match(probe.resultSummary ?? "", /available=false/);
  assert.ok(after.evidence.some((e) => e.intentId === probe.id && e.stance === "supports"));
  assert.ok(ports.calls.every((call) => call.taskId.startsWith("curiosity-")));
});

test("tools: verification — verified, unverified, conflict and 'not enough evidence yet'", () => {
  const ev = (stance: CuriosityEvidence["stance"], weight: number, tool = "t"): CuriosityEvidence => ({ id: tool + weight, source: "tool", tool, claim: "c", stance, weight, at: 0 });
  assert.equal(verifyEvidence([ev("supports", 0.5, "a"), ev("supports", 0.4, "b")]).verdict, "verified");
  assert.equal(verifyEvidence([ev("supports", 0.4)]).verdict, "unverified");
  assert.equal(verifyEvidence([ev("supports", 0.9), ev("contradicts", 0.5, "x")]).verdict, "conflict");
  const none = verifyEvidence([ev("inconclusive", 0)]);
  assert.equal(none.verdict, "insufficient");
  assert.equal(none.note, "I don't have enough evidence yet.");
});

test("tools: a failed tool is handled — recorded with its cause, never treated as evidence, curiosity deferred", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(signal({ category: "world", question: "What changed in the most recent TypeScript compiler release?", importance: 0.6 })).curiosity!;
  const after = (await engine.pursue(c.id))!;
  const research = after.proposedActions.find((i) => i.tool === "research.web")!;
  assert.equal(research.outcome, "failed");
  assert.equal(research.cause, "missing-context");
  assert.ok(!after.evidence.some((e) => e.stance === "supports"));
  assert.equal(after.status, "queued");
  assert.ok((after.nextAttemptAt ?? 0) > ports.clock.t, "deferred with backoff");
  assert.equal(after.verification?.verdict, "insufficient");
});

test("tools: a tool that never answers times out within its step budget", async () => {
  const ports = fakePorts({ tools: { "workflow.list": () => new Promise<DispatchResult>(() => {}) } });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(signal()).curiosity!;
  const started = Date.now();
  const after = (await engine.pursue(c.id, { ...DEFAULT_BUDGET, stepTimeoutMs: 30 }))!;
  assert.ok(Date.now() - started < 2_000);
  assert.equal(after.proposedActions.find((i) => i.tool === "workflow.list")?.outcome, "timeout");
});

/* ------------------------------------------------------------------ */
/* LEARNING                                                            */
/* ------------------------------------------------------------------ */

test("learning: a direct tool answer is verified, stored and resolved", async () => {
  const ports = fakePorts({ tools: { "workflow.list": () => ({ ok: true, content: "- Nightly build (id wf1) — 3 step(s), runnable" }) } });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(signal()).curiosity!;
  const after = (await engine.pursue(c.id))!;
  assert.equal(after.verification?.verdict, "verified");
  assert.equal(after.learning?.type, "technical-knowledge");
  assert.match(ports.memory[0].summary, /Nightly build/);
  assert.equal(after.status, "resolved");
  assert.ok(after.appliedResult.length === 0 && after.trail.some((s) => /No behaviour change/.test(s.detail)), "no invented application");
});

test("learning: conflicting evidence is a conflict, not an average — and goes to Heru", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  // Observations say "unavailable"; the registry says it is available.
  const s = failureSignal("system.config");
  const c = engine.notice(s).curiosity!;
  const after = (await engine.pursue(c.id))!;
  assert.equal(after.verification?.verdict, "conflict");
  assert.ok(after.evidence.some((e) => e.stance === "contradicts" && e.tool === "internal:tool-registry"));
  assert.equal(after.status, "asking");
  assert.equal(ports.memory.length, 0, "nothing uncertain is stored as knowledge");
});

test("learning: application — a verified diagnosis changes later tool choice and proposes (not performs) a fix", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal()).curiosity!;
  const after = (await engine.pursue(c.id))!;
  assert.equal(engine.getLedger().constraints()[0].tool, "project.read");
  assert.equal(ports.proposals.length, 1);
  assert.match(ports.proposals[0].title, /^Restore project\.read/);
  assert.ok(after.appliedResult.some((line) => /will not select project\.read/.test(line)));
  const rules = [{ tool: "research.web", scope: "background" as const, cause: "missing-context" as const, reason: "", learnedFrom: "x", at: 0 }];
  const world = { question: "What happened at the 1851 Great Exhibition?", context: "", category: "world" as const, keywords: [] };
  assert.equal(selectTools(world, CATALOG, rules, true).length, 0, "background: avoided");
  assert.equal(selectTools(world, CATALOG, rules, false)[0].tool, "research.web", "in a turn it is still allowed");
});

/* ------------------------------------------------------------------ */
/* PERSONALITY                                                         */
/* ------------------------------------------------------------------ */

test("personality: a resolved curiosity supplies exactly one evidence item — through LeluIdentity, not around it", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal()).curiosity!;
  const after = (await engine.pursue(c.id))!;
  assert.equal(ports.traitEvidence.length, 1);
  assert.equal(ports.traitEvidence[0].traitId, "pattern-recognition");
  assert.equal(after.personalityEvidence?.mode, "applied");
  const code = readdirSync(`${ROOT}src/core/curiosity`).map((name) => src(`src/core/curiosity/${name}`)).join("\n");
  assert.ok(!/\.status\s*=\s*["']/.test(code.replace(/intent\.outcome|status: "/g, "")), "curiosity never assigns a trait status");
  assert.ok(!code.includes("PersonalityGuard.getInstance"), "PersonalityGuard is reached only through LeluIdentity");
});

test("personality: established traits and Sandbox Mode receive a staged proposal, not a direct change", async () => {
  for (const options of [{ traitStatus: "established" }, { sandbox: true }]) {
    const ports = fakePorts(options);
    const engine = CuriosityEngine.reset(ports);
    const c = engine.notice(failureSignal()).curiosity!;
    const after = (await engine.pursue(c.id))!;
    assert.equal(ports.traitEvidence.length, 0);
    assert.equal(ports.staged.length, 1);
    assert.equal(after.personalityEvidence?.mode, "staged");
  }
});

test("personality (real LeluIdentity): one curiosity cannot change a trait's status; repeated independent evidence can", async () => {
  freshIdentity();
  const ports = fakePorts({ realPersonality: true });
  let engine = CuriosityEngine.reset(ports);
  const first = engine.notice(failureSignal("project.read")).curiosity!;
  await engine.pursue(first.id);
  const once = LeluIdentity.getInstance().getTrait("pattern-recognition")!;
  assert.equal(once.evidenceCount, 1);
  assert.equal(once.status, "candidate");

  for (const tool of ["project.list", "project.read"]) {
    engine = CuriosityEngine.reset(ports);
    const c = engine.notice(failureSignal(tool)).curiosity!;
    await engine.pursue(c.id);
  }
  const thrice = LeluIdentity.getInstance().getTrait("pattern-recognition")!;
  assert.equal(thrice.evidenceCount, 3);
  assert.equal(thrice.status, "emerging", "three independent pieces of evidence cross LeluIdentity's own threshold");
});

test("personality: a follow-up in the same chain adds no second evidence item", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER });
  const root = engine.notice(failureSignal()).curiosity!;
  await engine.pursue(root.id);
  const child = engine.getLedger().list().find((c) => c.parentId === root.id)!;
  assert.equal(child.rootId, root.id);
  const done = (await engine.pursue(child.id))!;
  assert.equal(done.status, "resolved");
  assert.match(done.learning?.summary ?? "", /project\.list/);
  assert.equal(ports.traitEvidence.length, 1);
});

/* ------------------------------------------------------------------ */
/* AUTONOMY                                                            */
/* ------------------------------------------------------------------ */

test("autonomy: a bounded multi-step investigation stops as soon as the evidence is verified", async () => {
  const ports = fakePorts({ tools: { "system.config": () => ({ ok: true, content: "configured", data: { configured: ["x"], missing: {} } }) } });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal()).curiosity!;
  const after = (await engine.pursue(c.id))!;
  assert.deepEqual(after.proposedActions.map((i) => i.tool), ["memory.recall", "internal:tool-registry"], "system.config was not needed once verified");
});

test("autonomy: the tool-step limit holds even when more tools could be tried", async () => {
  const ports = fakePorts({ tools: { "system.config": () => ({ ok: true, content: "x", data: { configured: [], missing: {} } }) } });
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(failureSignal("system.config")).curiosity!;
  const after = (await engine.pursue(c.id, { ...DEFAULT_BUDGET, maxToolSteps: 1 }))!;
  assert.equal(after.proposedActions.filter((i) => i.tool !== "memory.recall").length, 1);
});

test("autonomy: an exhausted time budget stops investigation", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const c = engine.notice(signal({ category: "world", question: "What changed in the most recent TypeScript compiler release?", importance: 0.6 })).curiosity!;
  const after = (await engine.pursue(c.id, { ...DEFAULT_BUDGET, timeoutMs: 0 }))!;
  assert.ok(!after.proposedActions.some((i) => i.tool === "research.web"));
});

test("autonomy: chains are bounded — past the depth limit a curiosity pauses, awaiting continuation", async () => {
  const ports = fakePorts();
  const engine = CuriosityEngine.reset(ports);
  const deep = engine.notice(signal({ depth: 2 })).curiosity!;
  const paused = (await engine.pursue(deep.id))!;
  assert.equal(paused.status, "blocked");
  assert.equal(paused.blockedReason, "depth-limit: awaiting continuation");
  assert.equal(ports.calls.length, 0);
  assert.equal(engine.resume(deep.id)?.status, "queued");
  assert.notEqual((await engine.pursue(deep.id))?.blockedReason, "depth-limit: awaiting continuation");
});

test("autonomy: a tick pursues at most one curiosity and stands down for Heru's turn", async () => {
  const busy = fakePorts({ userTurn: true });
  const e1 = CuriosityEngine.reset(busy);
  e1.notice(signal());
  const refused = await e1.tick();
  assert.equal(refused.ran, false);
  assert.match(refused.reason ?? "", /user turn/);
  assert.equal(busy.calls.length, 0);

  const ports = fakePorts({ tools: { "workflow.list": () => ({ ok: true, content: "- Nightly build — runnable" }) } });
  const engine = CuriosityEngine.reset(ports);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER });
  engine.notice(signal());
  engine.notice(signal({ category: "technical", question: "Why does the build cache miss on every run?", evidenceFingerprint: "t2" }));
  const report = await engine.tick();
  assert.ok(report.pursued);
  assert.equal(engine.getLedger().list().filter((c) => c.attempts > 0).length, 1);
});

test("autonomy: the decision tree — memory, then tools, then Heru, then defer", () => {
  const base = { alreadyKnown: false, memoryTried: true, verdict: "insufficient" as const, untriedTools: 0, toolStepsLeft: 3, timedOut: false, needsHost: false, hostAsk: false, attempts: 1, importance: 0.6 };
  assert.equal(nextStep({ ...base, alreadyKnown: true }), "stop-known");
  assert.equal(nextStep({ ...base, memoryTried: false, untriedTools: 2 }), "retrieve");
  assert.equal(nextStep({ ...base, untriedTools: 2 }), "investigate");
  assert.equal(nextStep({ ...base, needsHost: true, hostAsk: true }), "ask");
  assert.equal(nextStep({ ...base, verdict: "verified" }), "learn");
  assert.equal(nextStep(base), "defer");
  assert.equal(nextStep({ ...base, attempts: 3, importance: 0.3 }), "dismiss");
  assert.equal(classifyFailure("\"x\" is not permitted at the current autonomy level, so it was not run."), "not-permitted");
});

/* ------------------------------------------------------------------ */
/* ARCHITECTURE / REGRESSION                                           */
/* ------------------------------------------------------------------ */

test("architecture: curiosity is a layer of LÉLU — no second brain, runtime, provider or tool path", () => {
  const files = readdirSync(`${ROOT}src/core/curiosity`);
  const code = files.map((name) => src(`src/core/curiosity/${name}`)).join("\n");
  for (const forbidden of ["providers/", "AIRuntime", "Orchestrator", "AgentCognitionRuntime", "ToolRegistry.getInstance().execute", ".execute("]) {
    assert.ok(!code.includes(forbidden), `curiosity must not use ${forbidden}`);
  }
  assert.ok(!/^import [^;]*from "\.\.\/AIService"/m.test(code), "AIService is only loaded lazily (no load-order cycle)");
  assert.ok(src("src/core/curiosity/CuriosityPorts.ts").includes("dispatchToolCall("), "tools run through the permission-gated dispatcher");
});

test("integration: AIService observes conversation (never an answer to a pending question) and CognitiveLoop ticks, bounded", () => {
  const ai = src("src/core/AIService.ts");
  const observe = ai.indexOf("observeConversation(message");
  assert.ok(observe > 0);
  assert.ok(ai.lastIndexOf("if (!answersPendingQuestion)", observe) > 0);
  const loop = src("src/core/cognition/CognitiveLoop.ts");
  assert.ok(loop.includes("await withDeadline(CuriosityEngine.getInstance().tick(), null)"));
  const panel = src("src/app/scene/genesis/GenesisIdentityPanel.tsx");
  for (const label of ["Curious about", "Waiting for Heru", "Investigating", "Recently learned", "Unresolved"]) {
    assert.ok(panel.includes(`"${label}"`), `Questions view shows "${label}"`);
  }
  assert.ok(!panel.includes("window.location.reload"), "applying a staged change no longer reloads the app");
});
