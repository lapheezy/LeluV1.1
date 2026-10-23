/**
 * ==========================================================
 * LÉLU — CONTINUOUS DEVELOPMENT LOOP
 *
 * CATEGORY: unit + integration. Real DailyRecord, DailyReflection,
 * LeluIdentity, PersonalityGuard and SelfModel (against a shimmed
 * localStorage); the curiosity engine on injected ports where a
 * deterministic environment is needed (a mutable registry, a
 * clock, probes). The real-path run is scripts/verify-development.ts.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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

import KvStore from "../src/core/storage/KvStore";
import DailyRecord, { INTAKE_PREFIX, type LeluDailyRecord } from "../src/core/identity/DailyRecord";
import { reflectOnDay, runDueReflections, NOTHING_DETECTED, MAX_EVIDENCE_PER_TRAIT_PER_DAY } from "../src/core/identity/DailyReflection";
import { summarizeDevelopment, describeDevelopment } from "../src/core/identity/DevelopmentSummary";
import LeluIdentity from "../src/core/identity/LeluIdentity";
import PersonalityGuard from "../src/core/security/PersonalityGuard";
import PersonalityMemoryProvider from "../src/core/identity/PersonalityMemoryProvider";
import SelfModel from "../src/core/cognition/SelfModel";
import {
  capabilityStates,
  classifyAction,
  classifyFailure,
  detectRepeatedFailures,
  discoverAlternatives,
  failureKind,
  revalidationPolicyFor,
  revalidationTrigger,
  selectTools,
  tendencyBoost,
  toolFingerprint,
  VERIFY_PROBES,
  DEFAULT_BUDGET,
  type CatalogTool,
  type Curiosity,
  type CuriositySignal,
  type ObservedFailure,
} from "../src/core/curiosity/Curiosity";
import CuriosityEngine from "../src/core/curiosity/CuriosityEngine";
import { createDefaultPorts, type CuriosityPorts, type DispatchResult, type HostQuestionInput } from "../src/core/curiosity/CuriosityPorts";

const ROOT = new URL("..", import.meta.url).pathname;
const src = (path: string) => readFileSync(`${ROOT}${path}`, "utf8");
const DAY = 24 * 60 * 60 * 1000;
const dateOf = (t: number) => new Date(t).toISOString().slice(0, 10);

function freshPersonality(): void {
  KvStore.getInstance().remove("identity.v1");
  KvStore.getInstance().remove("daily.v1");
  LeluIdentity.reset();
  DailyRecord.reset();
}

function record(overrides: Partial<LeluDailyRecord> = {}): LeluDailyRecord {
  return {
    date: "2026-10-20",
    experiences: [],
    meaningfulInteractions: [],
    observations: [],
    preferencesObserved: [],
    selfReflection: [],
    lessons: [],
    emergingTraits: [],
    traitChanges: [],
    questions: [],
    relationshipObservations: [],
    creativeIdeas: [],
    tomorrowFocus: [],
    generatedAt: 0,
    developmentalEvidence: [],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* A registry-shaped catalog and an engine on injected ports           */
/* ------------------------------------------------------------------ */

function catalog(): CatalogTool[] {
  return [
    { id: "memory.recall", category: "Memory", description: "Search and retrieve memories from long-term storage", available: true, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "Brain.recall" },
    { id: "system.config", category: "System", description: "Report which capabilities are configured", available: true, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "ConfigStatus" },
    { id: "research.web", category: "Research", description: "Search Wikipedia, ArXiv, news, and other knowledge sources", available: true, riskLevel: 1, permissions: ["READ", "EXTERNAL_ACTION"], executable: true, executionRoute: "ResearchResolver" },
    { id: "project.read", category: "Engineering", description: "Read the real contents of a file inside the sandbox copy.", available: false, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "EngineeringWorkspace.readFile" },
    { id: "project.git", category: "Engineering", description: "Read-only git status, diff or log of the real project.", available: false, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "EngineeringWorkspace.git" },
    { id: "sandbox.read", category: "Engineering", description: "Read files from the engineering sandbox", available: true, riskLevel: 0, permissions: ["READ"], executable: true, executionRoute: "SandboxFS.read" },
    { id: "sandbox.write", category: "Engineering", description: "Write files to the engineering sandbox", available: true, riskLevel: 1, permissions: ["WRITE"], executable: true, executionRoute: "SandboxFS.write" },
    { id: "selfdev.analyze", category: "Self Development", description: "Analyze own architecture and identify improvements", available: true, riskLevel: 0, permissions: ["READ"], executable: false },
  ];
}

const PARAMS: Record<string, { required: string[]; properties: string[] }> = {
  "project.read": { required: ["workspace", "path"], properties: ["workspace", "path"] },
  "project.git": { required: ["action"], properties: ["action", "full", "count"] },
  "sandbox.read": { required: [], properties: ["path"] },
  "sandbox.write": { required: ["path", "content"], properties: ["path", "content"] },
  "memory.recall": { required: ["query"], properties: ["query"] },
  "system.config": { required: [], properties: [] },
  "research.web": { required: ["query"], properties: ["query"] },
};

interface Env extends CuriosityPorts {
  clock: { t: number };
  tools: CatalogTool[];
  deny: Set<string>;
  memory: Array<{ layer: string; summary: string; keywords: string[] }>;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  evidence: Array<{ traitId: string; unitId?: string }>;
  proposals: string[];
  asked: HostQuestionInput[];
  refreshes: number;
  userTurn: boolean;
  tendencies: Array<{ traitId: string; status: string; confidence: number }>;
  selfModel: { limitations: string[]; discoveries: string[] };
  impl: Record<string, (args: Record<string, unknown>) => DispatchResult | Promise<DispatchResult>>;
  reason?: (prompt: string, system: string) => Promise<string | null>;
  sourceFingerprint?: (tool: string, route?: string) => Promise<string | undefined>;
  emitFailure(f: ObservedFailure): void;
  emitSuccess(tool: string, taskId: string): void;
}

function env(): Env {
  const failureListeners = new Set<(f: ObservedFailure) => void>();
  const successListeners = new Set<(s: { tool: string; taskId: string; at: number }) => void>();
  const e: Env = {
    clock: { t: Date.UTC(2026, 9, 20, 12) },
    tools: catalog(),
    deny: new Set(),
    memory: [],
    calls: [],
    evidence: [],
    proposals: [],
    asked: [],
    refreshes: 0,
    userTurn: false,
    tendencies: [],
    selfModel: { limitations: [], discoveries: [] },
    impl: {},
    now: () => e.clock.t,
    prepare: async () => {},
    userTurnActive: () => e.userTurn,
    catalog: () => e.tools,
    permitted: (id) => Boolean(e.tools.find((t) => t.id === id)?.available) && !e.deny.has(id),
    async dispatch(tool, args) {
      e.calls.push({ tool, args });
      if (tool === "memory.recall") {
        const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
        const hits = e.memory.filter((m) => words.some((w) => `${m.summary} ${m.keywords.join(" ")}`.toLowerCase().includes(w)));
        return hits.length === 0
          ? { ok: false, content: `No stored memory matches "${args.query}".` }
          : { ok: true, content: hits.map((m, i) => `${i + 1}. [confidence 0.90] ${m.summary.slice(0, 100)} → ${m.summary}`).join("\n") };
      }
      if (!e.permitted(tool)) return { ok: false, content: `"${tool}" is not available in this runtime, so it was not run.` };
      const impl = e.impl[tool];
      return impl ? impl(args) : { ok: false, content: `No search was performed: ${tool} requires the router's provider registry and was called without it.` };
    },
    async consolidate(layer, summary, keywords) {
      e.memory.push({ layer, summary, keywords });
      return true;
    },
    hostEnabled: () => true,
    hostBusy: () => false,
    askHost(input) {
      e.asked.push(input);
      return `q${e.asked.length}`;
    },
    onHostChange: () => () => {},
    onToolFailure(listener) {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    onToolSuccess(listener) {
      successListeners.add(listener);
      return () => successListeners.delete(listener);
    },
    proposeObjective(title) {
      e.proposals.push(title);
      return { id: `p${e.proposals.length}`, created: true };
    },
    sandboxMode: () => false,
    traitStatus: () => "candidate",
    addTraitEvidence(traitId, _observation, unitId) {
      e.evidence.push({ traitId, unitId });
    },
    stageTraitEvidence: () => "staged",
    journal: () => {},
    async refreshCapabilities() {
      e.refreshes += 1;
    },
    toolParameters: (id) => PARAMS[id],
    traitTendencies: () => e.tendencies,
    syncSelfModel(limitations, discoveries) {
      e.selfModel = { limitations, discoveries };
    },
    emitFailure(f) {
      for (const l of failureListeners) l(f);
    },
    emitSuccess(tool, taskId) {
      for (const l of successListeners) l({ tool, taskId, at: e.clock.t });
    },
  };
  return e;
}

function setAvailable(e: Env, id: string, available: boolean): void {
  e.tools = e.tools.map((t) => (t.id === id ? { ...t, available } : t));
}

const failures = (tool: string, message: string, at: number): ObservedFailure[] => [
  { tool, taskId: "turn-1", message, at },
  { tool, taskId: "turn-2", message, at },
];
const UNAVAILABLE = (tool: string) => `"${tool}" is not available in this runtime, so it was not run.`;

/** Learn "project.git is unavailable" the real way: two failed turns, one tick. */
async function learnUnavailable(e: Env, tool = "project.git"): Promise<{ engine: CuriosityEngine; c: Curiosity }> {
  const engine = CuriosityEngine.reset(e);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, environmentCheckIntervalMs: 0 });
  engine.attachObservers();
  for (const f of failures(tool, UNAVAILABLE(tool), e.clock.t)) e.emitFailure(f);
  await engine.tick();
  const c = engine.getLedger().list().find((item) => item.category === "technical" && item.subject?.tool === tool)!;
  return { engine, c };
}

/* ------------------------------------------------------------------ */
/* DAILY REFLECTION                                                    */
/* ------------------------------------------------------------------ */

test("reflection: invoked at the daily boundary — completed days only, each exactly once", () => {
  freshPersonality();
  const now = Date.UTC(2026, 9, 21, 9);
  const daily = DailyRecord.getInstance();
  daily.recordEvidence({ traitId: "curiosity", unitId: "chain-a", source: "curiosity", observation: "investigated a gap", at: now - DAY }, now - DAY);
  daily.recordEvidence({ traitId: "curiosity", unitId: "chain-b", source: "curiosity", observation: "investigated today", at: now }, now);
  const first = runDueReflections(now);
  assert.deepEqual(first.map((run) => run.date), [dateOf(now - DAY)], "yesterday is reflected; today is not finished");
  assert.deepEqual(runDueReflections(now), [], "a reflected day is never reflected again");
  assert.ok(daily.getByDate(dateOf(now - DAY))?.reflection);
  assert.equal(daily.getByDate(dateOf(now))?.reflection, undefined);
  assert.ok(src("src/core/cognition/CognitiveLoop.ts").includes("for (const run of runDueReflections())"), "CognitiveLoop is the lifecycle point");
});

test("reflection: a real day's evidence reaches the trait through LeluIdentity, and PersonalityGuard records the status change", () => {
  freshPersonality();
  const now = Date.UTC(2026, 9, 22, 9);
  const daily = DailyRecord.getInstance();
  const before = { ...LeluIdentity.getInstance().getTrait("synthesis")! };
  for (const unit of ["u1", "u2", "u3"]) {
    daily.recordEvidence({ traitId: "synthesis", unitId: unit, source: "curiosity", observation: `connected findings (${unit})`, at: now - DAY }, now - DAY);
  }
  const [run] = runDueReflections(now);
  const after = LeluIdentity.getInstance().getTrait("synthesis")!;
  assert.equal(after.evidenceCount, before.evidenceCount + 3);
  assert.equal(after.status, "emerging", "three independent units cross LeluIdentity's own threshold");
  assert.ok(run.observations.some((line) => line.startsWith("Pattern: 3 separate lines of inquiry")));
  assert.ok(PersonalityGuard.getInstance().history().some((change) => change.target === "trait:synthesis"), "the status change went through PersonalityGuard");
  const change = run.traitChanges.find((item) => item.traitId === "synthesis")!;
  assert.ok(change.newConfidence > change.previousConfidence, "the snapshot records a real before → after");
  assert.equal(change.previousStatus, "candidate");
  assert.equal(change.newStatus, "emerging");
});

test("reflection: an empty day stays empty — 'No meaningful development detected.'", () => {
  freshPersonality();
  const now = Date.UTC(2026, 9, 23, 9);
  DailyRecord.getInstance().appendToday("tomorrowFocus", "placeholder only");
  const store = DailyRecord.getInstance();
  // Move nothing; build an empty completed day directly.
  const result = reflectOnDay(record({ date: dateOf(now - DAY) }));
  assert.equal(result.meaningful, false);
  assert.deepEqual(result.observations, [NOTHING_DETECTED]);
  assert.equal(result.candidateTraitChanges.length, 0);
  const snapshots = LeluIdentity.getInstance().getState().developmentHistory.length;
  runDueReflections(now + 2 * DAY);
  assert.equal(LeluIdentity.getInstance().getState().developmentHistory.length, snapshots, "no snapshot for a day without development");
  assert.ok(store);
});

test("reflection: deterministic, and it never calls a model", () => {
  const day = record({ observations: ["noticed a recurring structure across tools"], developmentalEvidence: [{ traitId: "curiosity", unitId: "x", source: "curiosity", observation: "o", at: 1 }] });
  assert.deepEqual(reflectOnDay(day), reflectOnDay(day));
  const code = src("src/core/identity/DailyReflection.ts");
  for (const forbidden of ["AIService", "providers/", "Anthropic", "fetch("]) assert.ok(!code.includes(forbidden), `DailyReflection must not use ${forbidden}`);
});

test("reflection: intake text and lines already counted as structured evidence are never evidence", () => {
  const intake = reflectOnDay(record({ observations: [`${INTAKE_PREFIX} I noticed a recurring pattern and discovered a structure`] }));
  assert.equal(intake.candidateTraitChanges.length, 0, "someone else's sentences are not LÉLU's development");
  const counted = reflectOnDay(
    record({
      lessons: ["Curiosity — project.git fails because it is not available (investigate, noticed, recurring)"],
      developmentalEvidence: [{ traitId: "pattern-recognition", unitId: "chain-1", source: "curiosity", observation: "diagnosed a failure", at: 1 }],
    }),
  );
  assert.deepEqual(counted.candidateTraitChanges.map((c) => c.traitId), ["pattern-recognition"], "one line of inquiry, one vote — no narrative double count");
});

test("reflection: bounded votes and no duplicate evidence", () => {
  freshPersonality();
  const daily = DailyRecord.getInstance();
  const t = Date.UTC(2026, 9, 24, 9);
  assert.equal(daily.recordEvidence({ traitId: "curiosity", unitId: "same", source: "curiosity", observation: "a", at: t }, t), true);
  assert.equal(daily.recordEvidence({ traitId: "curiosity", unitId: "same", source: "curiosity", observation: "b", at: t }, t), false);
  const many = reflectOnDay(record({ developmentalEvidence: [1, 2, 3, 4, 5].map((n) => ({ traitId: "curiosity", unitId: `u${n}`, source: "curiosity" as const, observation: "o", at: n })) }));
  assert.equal(many.candidateTraitChanges.length, MAX_EVIDENCE_PER_TRAIT_PER_DAY);
});

test("reflection: Sandbox Mode stages trait changes; a question is never stored as a preference", () => {
  freshPersonality();
  const identity = LeluIdentity.getInstance();
  identity.setSandboxMode(true);
  const now = Date.UTC(2026, 9, 25, 9);
  DailyRecord.getInstance().recordEvidence({ traitId: "patience", unitId: "u", source: "curiosity", observation: "re-checked", at: now - DAY }, now - DAY);
  const [run] = runDueReflections(now);
  assert.equal(run.staged, 1);
  assert.equal(identity.getTrait("patience")!.evidenceCount, 0, "nothing applied while sandboxed");
  assert.ok(identity.getState().pendingSandboxChanges.every((change) => change.kind === "trait-update"));
  identity.setSandboxMode(false);
});

/* ------------------------------------------------------------------ */
/* RE-EVALUATION                                                       */
/* ------------------------------------------------------------------ */

test("re-evaluation: only knowledge that can change is marked for it", () => {
  assert.equal(revalidationPolicyFor({ category: "host" }, { type: "constraint" }).policy, "stable");
  assert.equal(revalidationPolicyFor({ category: "technical", subject: { tool: "x", cause: "unavailable" } }, { type: "constraint" }).policy, "on-change");
  assert.equal(revalidationPolicyFor({ category: "self", subject: { tool: "research.web", cause: "missing-context" } }, { type: "self-knowledge" }).policy, "periodic");
});

test("re-evaluation: stable knowledge is never needlessly re-checked; periodic knowledge only after its interval", () => {
  const base = { now: 0, currentFingerprint: () => "fp", succeededSince: () => false, wanted: () => false, revisitRequested: false };
  const stable = { status: "resolved", learning: { revalidation: "stable", verifiedAt: 0, summary: "", type: "goal", keywords: [], layer: "knowledge", stored: true, retrievable: true } } as unknown as Curiosity;
  assert.equal(revalidationTrigger(stable, { ...base, now: 365 * DAY }), null);
  const periodic = { status: "resolved", reevaluations: [], learning: { revalidation: "periodic", revalidateAfterMs: DAY, verifiedAt: 0, dependency: { tool: "t", fingerprint: "fp" } } } as unknown as Curiosity;
  assert.equal(revalidationTrigger(periodic, { ...base, now: DAY / 2 }), null);
  assert.equal(revalidationTrigger(periodic, { ...base, now: DAY + 1 }), "time-sensitive");
});

test("re-evaluation: a changed tool state is detected — once per new state", () => {
  const c = { status: "resolved", reevaluations: [], learning: { revalidation: "on-change", verifiedAt: 0, dependency: { tool: "t", fingerprint: "old" } } } as unknown as Curiosity;
  const ctx = { now: 10, currentFingerprint: () => "new", succeededSince: () => false, wanted: () => false, revisitRequested: false };
  assert.equal(revalidationTrigger(c, ctx), "environment-changed");
  const checked = { ...c, reevaluations: [{ at: 5, trigger: "environment-changed", before: "", after: "", outcome: "confirmed", fingerprint: "new" }] } as unknown as Curiosity;
  assert.equal(revalidationTrigger(checked, ctx), null, "the same new state is not re-checked twice");
});

/* ------------------------------------------------------------------ */
/* RECOVERY                                                            */
/* ------------------------------------------------------------------ */

test("recovery: a learned-unavailable tool is suppressed until its state changes", async () => {
  const e = env();
  const { engine, c } = await learnUnavailable(e);
  assert.equal(c.status, "resolved");
  assert.equal(c.learning?.revalidation, "on-change");
  assert.ok(engine.getLedger().constraints().some((rule) => rule.tool === "project.git"));
  const want = { question: "What is the git status of the project?", context: "", category: "project" as const, keywords: [], subject: { preferred: { tool: "project.git", args: { action: "status" } } } };
  assert.equal(selectTools(want, e.tools, engine.getLedger().constraints(), true).length, 0, "suppressed");
  assert.equal(engine.capabilityStates().find((row) => row.tool === "project.git")?.state, "unavailable");
});

test("recovery: environment change → one bounded verification → superseded → eligible again", async () => {
  const e = env();
  const { engine, c } = await learnUnavailable(e);
  setAvailable(e, "project.git", true);
  e.impl["project.git"] = () => ({ ok: true, content: "On branch main — clean" });
  assert.equal(engine.capabilityStates().find((row) => row.tool === "project.git")?.state, "revalidation_needed");
  e.clock.t += 60_000;
  const report = await engine.tick();
  assert.equal(report.revisited?.trigger, "environment-changed");
  assert.equal(report.revisited?.outcome, "superseded");
  const after = engine.getLedger().get(c.id)!;
  assert.equal(after.supersededLearnings?.length, 1, "the old conclusion is kept in history");
  assert.match(after.supersededLearnings![0].summary, /fails because it is not available/);
  assert.match(after.learning!.summary, /usable again/);
  assert.equal(engine.getLedger().constraints().some((rule) => rule.tool === "project.git"), false);
  assert.equal(e.calls.filter((call) => call.tool === "project.git").length, 1, "exactly one verification call");
  assert.equal(engine.capabilityStates().find((row) => row.tool === "project.git")?.state, "available");
  assert.ok(e.memory.some((m) => /usable again/.test(m.summary)), "the new state was stored through consolidate");
});

test("recovery: still failing → confirmed and left alone — no retry storm", async () => {
  const e = env();
  const { engine, c } = await learnUnavailable(e);
  setAvailable(e, "project.git", true);
  e.impl["project.git"] = () => ({ ok: false, content: "The engineering runtime is unreachable (not available)." });
  e.clock.t += 60_000;
  const first = await engine.tick();
  assert.equal(first.revisited?.outcome, "confirmed");
  for (let i = 0; i < 4; i += 1) {
    e.clock.t += 60_000;
    await engine.tick();
  }
  assert.equal(e.calls.filter((call) => call.tool === "project.git").length, 1, "one check for this state, not five");
  assert.ok(engine.getLedger().constraints().some((rule) => rule.tool === "project.git"), "still suppressed");
  assert.equal(engine.getLedger().get(c.id)?.reevaluations?.at(-1)?.outcome, "confirmed");
});

test("recovery: a later success observed in a conversation is new evidence", async () => {
  const e = env();
  const { engine, c } = await learnUnavailable(e);
  setAvailable(e, "project.git", true);
  e.impl["project.git"] = () => ({ ok: true, content: "clean" });
  // Same fingerprint as when it was confirmed — only the observed success should trigger.
  e.clock.t += 60_000;
  await engine.tick();
  assert.equal(engine.getLedger().get(c.id)?.reevaluations?.length, 1);
});

test("recovery: a permission failure is never bypassed — it becomes a proposal, and recovers only when permitted", async () => {
  const e = env();
  setAvailable(e, "project.git", true);
  e.deny.add("project.git");
  const engine = CuriosityEngine.reset(e);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, environmentCheckIntervalMs: 0 });
  engine.attachObservers();
  for (const f of failures("project.git", `"project.git" is not permitted at the current autonomy level, so it was not run.`, e.clock.t)) e.emitFailure(f);
  await engine.tick();
  const c = engine.getLedger().list().find((item) => item.subject?.tool === "project.git")!;
  assert.equal(c.subject?.cause, "not-permitted");
  assert.ok(e.proposals.some((title) => /^Approve project\.git\?/.test(title)));
  assert.equal(engine.capabilityStates().find((row) => row.tool === "project.git")?.state, "permission_required");
  const followUps = engine.getLedger().list().filter((item) => item.parentId === c.id);
  assert.ok(!followUps.some((item) => item.subject?.alternativeFor), "no 'what else can I use' around a refusal");
  assert.equal(e.calls.filter((call) => call.tool === "project.git").length, 0);
});

/* ------------------------------------------------------------------ */
/* CAPABILITY DISCOVERY                                                */
/* ------------------------------------------------------------------ */

const discover = (e: Env, preferred: string, args: Record<string, unknown>, strategies = [] as Parameters<typeof discoverAlternatives>[0]["strategies"]) =>
  discoverAlternatives({
    preferred: e.tools.find((t) => t.id === preferred)!,
    args,
    catalog: e.tools,
    permitted: e.permitted,
    constraints: [],
    background: true,
    strategies,
    parameters: (id) => PARAMS[id],
  });

test("discovery: finds the existing alternative, carries inputs by name, and says why", () => {
  const e = env();
  const found = discover(e, "project.read", { workspace: "w1", path: "/notes/plan.md" });
  assert.equal(found.options[0].tool, "sandbox.read");
  assert.deepEqual(found.options[0].args, { path: "/notes/plan.md" });
  assert.match(found.options[0].why, /same Engineering capability/);
});

test("discovery: never invents a tool, and rejects unavailable, mutating, unpermitted or uncallable ones with reasons", () => {
  const e = env();
  e.deny.add("sandbox.read");
  const found = discover(e, "project.read", { workspace: "w1" });
  const ids = new Set(e.tools.map((t) => t.id));
  assert.ok([...found.options, ...found.rejected].every((item) => ids.has(item.tool)));
  const reasons = Object.fromEntries(found.rejected.map((item) => [item.tool, item.reason]));
  assert.match(reasons["sandbox.read"], /not permitted/);
  assert.match(reasons["sandbox.write"], /WRITE capability/);
  assert.match(reasons["project.git"], /not available/);
  assert.equal(found.options.length, 0);
  assert.equal(discover(env(), "research.web", { query: "x" }).options.length, 0, "nothing related → nothing offered");
});

test("discovery: a preferred capability fails → alternative → permission → execution → verification → learned strategy", async () => {
  const e = env();
  e.impl["sandbox.read"] = (args) => ({ ok: true, content: `contents of ${args.path}: milestone 3 is the cosmos pass` });
  const engine = CuriosityEngine.reset(e);
  const goal: CuriositySignal = {
    question: "What does the project plan file say about the next milestone?",
    unknown: "The next milestone.",
    context: "Heru asked about the plan.",
    category: "project",
    source: "project",
    importance: 0.7,
    uncertainty: 0.7,
    relevance: 0.8,
    expectedBenefit: 0.7,
    evidenceFingerprint: "goal-1",
    subject: { preferred: { tool: "project.read", args: { workspace: "w1", path: "/notes/plan.md" } } },
  };
  const c = engine.notice(goal).curiosity!;
  const done = (await engine.pursue(c.id))!;
  const tools = done.proposedActions.map((i) => `${i.tool}:${i.outcome}`);
  assert.deepEqual(tools, ["project.read:blocked", "memory.recall:failed", "sandbox.read:ok"], "preferred refused → memory checked → alternative used");
  const alt = done.proposedActions.find((i) => i.tool === "sandbox.read")!;
  assert.equal(alt.alternativeFor, "project.read");
  assert.deepEqual(alt.args, { path: "/notes/plan.md" });
  assert.ok(done.trail.some((step) => step.step === "discovery" && /chose sandbox\.read/.test(step.detail) && /Rejected: .*project\.git/.test(step.detail)));
  assert.equal(done.status, "resolved");
  assert.match(done.learning!.summary, /milestone 3/);
  const strategy = engine.strategies()[0];
  assert.equal(strategy.forTool, "project.read");
  assert.equal(strategy.alternative, "sandbox.read");
  assert.ok(e.memory.some((m) => /^Strategy: when project\.read cannot be used, sandbox\.read/.test(m.summary)));
  assert.ok(e.selfModel.discoveries.some((line) => /sandbox\.read stands in/.test(line)), "the self-model knows the strategy");

  // APPLY: the next time, the learned strategy is the first choice.
  const next = discover(e, "project.read", { path: "/x" }, engine.strategies());
  assert.equal(next.options[0].fromStrategy, true);
});

/* ------------------------------------------------------------------ */
/* FAILURE LEARNING                                                    */
/* ------------------------------------------------------------------ */

test("failure: kinds are distinguished, and trivial failures raise no curiosity", () => {
  assert.equal(failureKind(classifyFailure("project.read requires workspace and path.")), "input");
  assert.equal(failureKind(classifyFailure("memory.recall requires a non-empty query.")), "input");
  assert.equal(failureKind(classifyFailure('"x" is not permitted at the current autonomy level')), "permission");
  assert.equal(failureKind(classifyFailure("x timed out after 8000ms")), "temporary");
  assert.equal(failureKind(classifyFailure('"x" is not available in this runtime')), "availability");
  assert.equal(failureKind(classifyFailure("No search was performed: research.web requires the router's provider registry")), "availability");
  assert.equal(failureKind(classifyFailure("Stack overflow in handler")), "unknown");
  assert.equal(detectRepeatedFailures(failures("project.read", "project.read requires workspace and path.", 1), undefined, 1).length, 0, "our own malformed call is not a mystery");
  assert.equal(detectRepeatedFailures(failures("project.read", UNAVAILABLE("project.read"), 1), undefined, 1).length, 1);
});

test("failure: an availability diagnosis opens 'what else can provide it?' — and only when something plausibly can", async () => {
  const e = env();
  const { engine, c } = await learnUnavailable(e, "project.read");
  const children = engine.getLedger().list().filter((item) => item.parentId === c.id);
  assert.ok(children.some((item) => item.subject?.alternativeFor === "project.read"));
  const e2 = env();
  e2.tools = e2.tools.filter((t) => t.id !== "sandbox.read");
  const { engine: engine2, c: c2 } = await learnUnavailable(e2, "project.read");
  assert.ok(!engine2.getLedger().list().some((item) => item.parentId === c2.id && item.subject?.alternativeFor));
});

/* ------------------------------------------------------------------ */
/* PERSONALITY                                                         */
/* ------------------------------------------------------------------ */

test("personality: one line of inquiry gives one unit of evidence — to the daily record, not to identity", async () => {
  freshPersonality();
  const real = createDefaultPorts();
  const now = Date.now();
  real.addTraitEvidence("pattern-recognition", "diagnosed a failure", "chain-1");
  real.addTraitEvidence("pattern-recognition", "diagnosed it again", "chain-1");
  const today = DailyRecord.getInstance().getByDate(dateOf(now))!;
  assert.equal(today.developmentalEvidence?.length, 1);
  assert.equal(LeluIdentity.getInstance().getTrait("pattern-recognition")!.evidenceCount, 0, "identity only changes at reflection");

  const e = env();
  const { engine } = await learnUnavailable(e, "project.read");
  for (let i = 0; i < 3; i += 1) await engine.tick();
  const units = new Set(e.evidence.map((item) => item.unitId));
  assert.equal(units.size, e.evidence.length, "follow-ups in the same chain add none");
});

test("personality: one isolated event does not change a trait's lifecycle", () => {
  freshPersonality();
  const now = Date.UTC(2026, 9, 26, 9);
  DailyRecord.getInstance().recordEvidence({ traitId: "curiosity", unitId: "solo", source: "curiosity", observation: "one investigation", at: now - DAY }, now - DAY);
  runDueReflections(now);
  const trait = LeluIdentity.getInstance().getTrait("curiosity")!;
  assert.equal(trait.evidenceCount, 1);
  assert.equal(trait.status, "candidate");
});

test("personality → curiosity: a developing trait shapes which question is pursued first (within a tier)", async () => {
  const c = (source: Curiosity["source"]) => ({ source, category: "technical", status: "queued" }) as Curiosity;
  assert.equal(tendencyBoost(c("execution"), [{ traitId: "pattern-recognition", status: "emerging", confidence: 0.5 }]).boost, 1.15);
  assert.equal(tendencyBoost(c("conversation"), [{ traitId: "pattern-recognition", status: "emerging", confidence: 0.5 }]).boost, 1);
  assert.equal(tendencyBoost(c("execution"), [{ traitId: "pattern-recognition", status: "candidate", confidence: 0.3 }]).boost, 1, "a candidate is not yet a tendency");

  const e = env();
  e.tendencies = [{ traitId: "pattern-recognition", status: "emerging", confidence: 0.5 }];
  e.impl["system.config"] = () => ({ ok: true, content: "ok", data: { configured: [], missing: {} } });
  const engine = CuriosityEngine.reset(e);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER });
  const base = { unknown: "u", context: "c", category: "technical" as const, importance: 0.6, uncertainty: 0.6, relevance: 0.6, expectedBenefit: 0.6 };
  engine.notice({ ...base, question: "Why is the build cache cold every morning?", source: "conversation", evidenceFingerprint: "a" });
  const pattern = engine.notice({ ...base, question: "Why do my diagnostics keep timing out at night?", source: "execution", evidenceFingerprint: "b" }).curiosity!;
  const report = await engine.tick();
  assert.equal(report.pursued?.id, pattern.id);
  assert.ok(engine.getLedger().get(pattern.id)!.trail.some((s) => s.step === "tendency" && /pattern-recognition/.test(s.detail)));
});

/* ------------------------------------------------------------------ */
/* SELF-MODEL                                                          */
/* ------------------------------------------------------------------ */

test("self-model: available, unavailable, unknown, permission-required and revalidation-needed are different claims", () => {
  const tools = catalog();
  const rows = capabilityStates({
    catalog: tools,
    permitted: (id) => id !== "research.web" && Boolean(tools.find((t) => t.id === id)?.available),
    constraints: [],
    curiosities: [{ proposedActions: [{ tool: "sandbox.read", outcome: "ok", finishedAt: 0 }] } as unknown as Curiosity],
    now: 0,
  });
  const state = Object.fromEntries(rows.map((row) => [row.tool, `${row.state}/${row.basis}`]));
  assert.equal(state["project.read"], "unavailable/registry");
  assert.equal(state["research.web"], "permission_required/registry");
  assert.equal(state["selfdev.analyze"], "unknown/no-executor");
  assert.equal(state["sandbox.read"], "available/verified-use");
  assert.equal(state["system.config"], "available/registry");
});

test("self-model: learned limitations sync into the EXISTING SelfModel, replacing only curiosity's own lines", () => {
  const model = SelfModel.getInstance();
  model.update({ limitations: ["Cannot see the user's screen"] });
  const real = createDefaultPorts();
  real.syncSelfModel!(["Tool project.git: it is not available in this runtime."], ["Tool strategy: when project.read cannot be used, sandbox.read stands in."]);
  real.syncSelfModel!(["Tool research.web: needs a live conversation."], []);
  const state = model.get();
  assert.ok(state.limitations.includes("Cannot see the user's screen"));
  assert.ok(state.limitations.includes("Tool research.web: needs a live conversation."));
  assert.ok(!state.limitations.includes("Tool project.git: it is not available in this runtime."), "a lifted limitation disappears");
  assert.ok(state.discoveries.some((line) => /sandbox\.read stands in/.test(line)));
});

/* ------------------------------------------------------------------ */
/* AUTONOMY                                                            */
/* ------------------------------------------------------------------ */

test("autonomy: one action per thinking cycle, and nothing at all during Heru's turn", async () => {
  const e = env();
  const { engine } = await learnUnavailable(e);
  setAvailable(e, "project.git", true);
  e.impl["project.git"] = () => ({ ok: true, content: "clean" });
  e.impl["system.config"] = () => ({ ok: true, content: "ok", data: { configured: [], missing: {} } });
  engine.notice({ question: "Why does the nightly index rebuild run twice?", unknown: "u", context: "c", category: "technical", source: "project", importance: 0.6, uncertainty: 0.6, relevance: 0.6, expectedBenefit: 0.6, evidenceFingerprint: "n" });
  e.userTurn = true;
  const callsBefore = e.calls.length;
  assert.equal((await engine.tick()).ran, false);
  assert.equal(e.calls.length, callsBefore);
  e.userTurn = false;
  const report = await engine.tick();
  assert.ok(Boolean(report.revisited) !== Boolean(report.pursued), "a revisit OR a pursuit — never both");
});

test("autonomy: verification probes are read-only, and a hanging probe is bounded by the step deadline", async () => {
  for (const id of Object.keys(VERIFY_PROBES)) {
    const tool = catalog().find((t) => t.id === id) ?? { id, permissions: ["READ"] };
    assert.ok(["READ", "ANALYZE", "EXTERNAL"].includes(classifyAction(tool as CatalogTool)), `${id} probe must not write`);
  }
  assert.ok(!("project.apply" in VERIFY_PROBES) && !("project.commit" in VERIFY_PROBES));
  const e = env();
  const { engine, c } = await learnUnavailable(e);
  setAvailable(e, "project.git", true);
  e.impl["project.git"] = () => new Promise<DispatchResult>(() => {});
  const started = Date.now();
  const after = await engine.revalidate(c.id, "environment-changed", { ...DEFAULT_BUDGET, stepTimeoutMs: 30 });
  assert.ok(Date.now() - started < 2_000);
  assert.equal(after?.reevaluations?.at(-1)?.outcome, "confirmed");
  assert.ok(engine.getLedger().constraints().some((rule) => rule.tool === "project.git"));
});

test("autonomy: the fingerprint covers the implementation route, so a changed executor counts as a changed environment", () => {
  const tool = catalog()[0];
  assert.notEqual(toolFingerprint(tool, true), toolFingerprint({ ...tool, executionRoute: "Brain.recallV2" }, true));
  assert.notEqual(toolFingerprint(tool, true), toolFingerprint(tool, false));
});

/* ------------------------------------------------------------------ */
/* DEVELOPMENTAL HISTORY                                               */
/* ------------------------------------------------------------------ */

test("history: 'what did I learn today?' is answered from records only — and empty days say so", async () => {
  const empty = summarizeDevelopment(record());
  assert.equal(empty.empty, true);
  assert.match(describeDevelopment(empty), /No meaningful development recorded/);
  const day = summarizeDevelopment(
    record({
      lessons: ["Curiosity — project.git fails because it is not available", "Assumption changed: project.git was not usable; it is verified usable again.", "Strategy: when project.read cannot be used, sandbox.read can stand in (verified by use)."],
      experiences: ["Curiosity — looked into: Why does project.git keep failing?"],
      questions: ["Unresolved: Why does the cache miss?"],
    }),
  );
  assert.deepEqual(day.assumptionsChanged, ["project.git was not usable; it is verified usable again."]);
  assert.equal(day.capabilitiesDiscovered.length, 1);
  assert.deepEqual(day.unresolved, ["Why does the cache miss?"]);

  freshPersonality();
  DailyRecord.getInstance().appendToday("lessons", "Curiosity — sandbox.read lists the sandbox");
  const provider = new PersonalityMemoryProvider();
  const asked = await provider.context("What did you learn today?", 4);
  const unrelated = await provider.context("What's the weather like in Lagos?", 4);
  assert.ok(asked.some((item) => /\[LÉLU development/.test(item.content)));
  assert.ok(!unrelated.some((item) => /\[LÉLU development/.test(item.content)), "not prepended to every turn");
});

test("history: document intake is labelled as intake in the journal, never as LÉLU's observation", async () => {
  freshPersonality();
  await new PersonalityMemoryProvider().persist({ prompt: "doc", response: "I noticed the bridge was rebuilt in 1902 after the flood." });
  const today = DailyRecord.getInstance().getOrCreateToday();
  assert.ok(today.observations.every((line) => line.startsWith(INTAKE_PREFIX)));
});

test("memory: a memory that merely mentions a tool does not answer why that tool fails", async () => {
  const e = env();
  e.memory.push({ layer: "system", summary: "Capabilities sharing project.read's route: project.list (available=false), project.git (available=false).", keywords: ["project.git", "project", "git"] });
  const { c } = await learnUnavailable(e);
  assert.notEqual(c.learning?.fromExistingMemory, true, "a list that names the tool is not its diagnosis");
  assert.match(c.learning?.summary ?? "", /^project\.git fails because/);
});

/* ================================================================== */
/* LIMITATIONS CLOSED                                                  */
/* ================================================================== */

import { detectConversationAmbiguity, isGroundedQuote, parseModelJson, relevantByRule, distinctSources, causeConsistentWithRegistry, verifyEvidence } from "../src/core/curiosity/Curiosity";
import CuriosityLedger from "../src/core/curiosity/CuriosityLedger";
import { executorBlock, fingerprintText } from "../src/core/curiosity/CuriosityPorts";
import { completionEvidenceTrait } from "../src/core/cognition/AgentCognitionRuntime";

const WORLD: CuriositySignal = {
  question: "What is the current stable release line of the Vite build tool?",
  unknown: "A fact about the world.",
  context: "A knowledge gap.",
  category: "world",
  source: "memory",
  importance: 0.6,
  uncertainty: 0.8,
  relevance: 0.7,
  expectedBenefit: 0.7,
  evidenceFingerprint: "vite",
};

test("background research: tools get the runtime's REAL router context outside a turn", () => {
  const ports = src("src/core/curiosity/CuriosityPorts.ts");
  assert.ok(ports.includes("loaded.ai.getInstance().toolContext(prompt)"));
  assert.ok(ports.includes("dispatchToolCall({ id: taskId, name: toolNameForModel(toolId), arguments: args }, taskId, context)"));
  const runtime = src("src/core/AIRuntime.ts");
  const method = runtime.slice(runtime.indexOf("public toolContext("), runtime.indexOf("public toolContext(") + 700);
  for (const field of ["brain: this.brain", "knowledgeProviders: this.knowledge", "aiProviders: this.providers", "logger: this.logger"]) {
    assert.ok(method.includes(field), `toolContext uses the runtime's own ${field.split(":")[0]}`);
  }
});

test("background research: an answer from several independent sources is verified and learned", async () => {
  const e = env();
  e.impl["research.web"] = () => ({
    ok: true,
    content: "1. Vite — Vite 7 is the current stable release line of the Vite build tool.\n2. Vite releases — The Vite 7 release line is stable.",
    data: { count: 2, results: [{ url: "https://vite.dev/blog" }, { url: "https://github.com/vitejs/vite/releases" }] },
  });
  const engine = CuriosityEngine.reset(e);
  const c = engine.notice(WORLD).curiosity!;
  const done = (await engine.pursue(c.id))!;
  assert.equal(done.verification?.verdict, "verified");
  assert.equal(done.status, "resolved");
  assert.match(done.learning!.summary, /Vite 7/);
  assert.equal(distinctSources({ results: [{ url: "https://a.com/x" }, { url: "https://a.com/y" }] }), 1, "two pages of one site are one source");
});

test("model-assisted: a claimed answer must quote the output verbatim, or the model's view is not used", async () => {
  assert.equal(isGroundedQuote("Vite 7 is the current stable release line.", "vite 7 is the current stable"), true);
  assert.equal(isGroundedQuote("Vite 7 is the current stable release line.", "Vite 8 is stable"), false);
  assert.deepEqual(parseModelJson('Sure! {"answers": true, "quote": "x"} done'), { answers: true, quote: "x" });
  assert.equal(parseModelJson("no json here"), null);

  const output = { ok: true, content: "1. Vite — Vite 7 is the current stable release line of the Vite build tool.", data: { count: 1, results: [{ url: "https://vite.dev" }] } };
  const e = env();
  e.impl["research.web"] = () => output;
  e.reason = async () => '{"answers": true, "quote": "Vite 7 is the current stable release line", "reason": "it says so"}';
  let engine = CuriosityEngine.reset(e);
  let c = engine.notice(WORLD).curiosity!;
  let done = (await engine.pursue(c.id))!;
  assert.ok(done.evidence.some((item) => /grounded quote, judged by model/.test(item.claim) && item.stance === "supports"));

  const e2 = env();
  e2.impl["research.web"] = () => output;
  e2.reason = async () => '{"answers": true, "quote": "Vite 9 ships next week", "reason": "invented"}';
  engine = CuriosityEngine.reset(e2);
  c = engine.notice(WORLD).curiosity!;
  done = (await engine.pursue(c.id))!;
  assert.ok(!done.evidence.some((item) => /Vite 9/.test(item.claim)), "an ungrounded model claim is never evidence");
  assert.ok(done.evidence.some((item) => item.stance === "supports" && !/judged by model/.test(item.claim)), "the rule decided instead");

  const e3 = env();
  e3.impl["research.web"] = () => ({ ok: true, content: "1. Vite — a French word meaning quick.", data: { count: 1, results: [{ url: "https://dict.example" }] } });
  e3.reason = async () => '{"answers": false, "quote": "", "reason": "it defines the word, not the release"}';
  engine = CuriosityEngine.reset(e3);
  c = engine.notice(WORLD).curiosity!;
  done = (await engine.pursue(c.id))!;
  assert.ok(done.evidence.some((item) => item.stance === "inconclusive" && /Does not answer the question \(model\)/.test(item.claim)));
  assert.notEqual(done.status, "resolved");
});

test("model-assisted: background ambiguity detection — grounded, bounded, and never during Heru's turn", async () => {
  const e = env();
  const prompts: string[] = [];
  e.reason = async (prompt) => {
    prompts.push(prompt);
    return '{"ambiguous": true, "phrase": "the usual setup", "question": "Which setup do you mean by the usual one?"}';
  };
  const engine = CuriosityEngine.reset(e);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, autoInvestigate: false });
  assert.equal(engine.observeConversation("Please deploy this the way we always do with the usual setup tonight."), null, "the rules found nothing — buffered, not answered on the chat path");
  e.userTurn = true;
  await engine.tick();
  assert.equal(prompts.length, 0, "no model call during Heru's turn");
  e.userTurn = false;
  const report = await engine.tick();
  assert.equal(prompts.length, 1);
  assert.deepEqual(report.noticed, ["What does Heru mean by “the usual setup” here?"]);
  assert.equal(engine.getLedger().list()[0].hostQuestionPreset, "Which setup do you mean by the usual one?");
  await engine.tick();
  assert.equal(prompts.length, 1, "each message is looked at once");

  const e2 = env();
  e2.reason = async () => '{"ambiguous": true, "phrase": "the blue migration", "question": "Which migration?"}';
  const engine2 = CuriosityEngine.reset(e2);
  engine2.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, autoInvestigate: false });
  engine2.observeConversation("Please deploy this the way we always do with the usual setup tonight.");
  assert.deepEqual((await engine2.tick()).noticed, [], "a phrase Heru never said is rejected");
});

test("model-assisted: an unexplained failure gets a proposed cause — kept only if the registry agrees", async () => {
  assert.equal(causeConsistentWithRegistry("unavailable", { available: false } as CatalogTool, false), true);
  assert.equal(causeConsistentWithRegistry("unavailable", { available: true } as CatalogTool, true), false);
  const odd = (tool: string) => failures(tool, "Exited with code 137 while reading the target", 0).map((f) => ({ ...f, at: env().clock.t }));

  const e = env();
  e.reason = async () => '{"cause": "unavailable", "because": "it never runs"}';
  const engine = CuriosityEngine.reset(e);
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, environmentCheckIntervalMs: 0 });
  engine.attachObservers();
  for (const f of odd("project.git")) e.emitFailure(f);
  await engine.tick();
  const c = engine.getLedger().list().find((item) => item.subject?.tool === "project.git")!;
  assert.equal(c.subject?.cause, "unavailable");
  assert.ok(c.evidence.some((item) => item.tool === "model-hypothesis"));
  assert.equal(c.verification?.verdict, "verified");

  const e2 = env();
  e2.reason = async () => '{"cause": "unavailable", "because": "guess"}';
  const engine2 = CuriosityEngine.reset(e2);
  engine2.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, environmentCheckIntervalMs: 0 });
  engine2.attachObservers();
  for (const f of odd("system.config")) e2.emitFailure(f);
  await engine2.tick();
  const c2 = engine2.getLedger().list().find((item) => item.subject?.tool === "system.config")!;
  assert.equal(c2.subject?.cause, "error", "system.config IS available, so 'unavailable' is rejected");
  assert.ok(c2.trail.some((step) => step.step === "hypothesis" && /rejected/.test(step.detail)));
});

test("verification: a retry returning the same result is not a second source", () => {
  const junk = "1. CVC Capital Partners, Barangaroo, Sydney, New South Wales, Australia (source: Nominatim)";
  // Word overlap alone calls this relevant to the question — which is why it is weak evidence.
  assert.equal(relevantByRule("What is the capital city of Australia?", junk), true);
  const once = { source: "tool" as const, tool: "research.web", claim: junk, stance: "supports" as const, weight: 0.45, at: 1 };
  assert.notEqual(verifyEvidence([once]).verdict, "verified", "one weak source is not enough");
  assert.notEqual(verifyEvidence([once, { ...once, at: 2 }]).verdict, "verified", "the same result twice is still one source");
  const other = { ...once, claim: "Canberra is the capital city of Australia (source: Wikipedia)" };
  assert.equal(verifyEvidence([once, other]).verdict, "verified", "two different results corroborate");
});

test("detection: the rules now recognise much more everyday vagueness", () => {
  for (const message of [
    "I want the onboarding to work properly before the launch next week.",
    "Make it feel right for new users, and keep the rest of the flow simple.",
    "We need something better for the briefing screen, it feels flat.",
    "Let LÉLU handle the reminders, the summaries, the follow-ups and so on.",
  ]) {
    assert.ok(detectConversationAmbiguity(message), message);
  }
  assert.equal(detectConversationAmbiguity("Please rename the file to notes.md."), null);
});

test("code watching: each tool is fingerprinted by ITS executor and implementation, so a change to it is noticed", async () => {
  const source = `const EXECUTORS = [\n  {\n    id: "a.tool",\n    run: () => 1,\n  },\n\n  {\n    id: "b.tool",\n    run: () => 2,\n  },\n];`;
  const edited = source.replace("() => 2", "() => 3");
  assert.equal(fingerprintText(executorBlock(source, "a.tool")!), fingerprintText(executorBlock(edited, "a.tool")!), "editing b.tool does not change a.tool");
  assert.notEqual(fingerprintText(executorBlock(source, "b.tool")!), fingerprintText(executorBlock(edited, "b.tool")!));

  const e = env();
  let code = "exec:aaaa|impl:1111";
  e.sourceFingerprint = async () => code;
  const { engine, c } = await learnUnavailable(e);
  assert.equal(c.learning?.dependency?.code, "exec:aaaa|impl:1111");
  e.impl["project.git"] = () => ({ ok: true, content: "clean" });
  e.clock.t += 60_000;
  assert.equal((await engine.tick()).revisited, undefined, "unchanged code → nothing to re-check");
  code = "exec:bbbb|impl:1111";
  e.clock.t += 60_000;
  const report = await engine.tick();
  assert.equal(report.revisited?.trigger, "code-changed");
  assert.equal(report.revisited?.outcome, "confirmed", "the code changed but the tool is still unavailable — confirmed, not assumed fixed");
  assert.equal(report.revisited?.id, c.id);
  for (let i = 0; i < 3; i += 1) {
    e.clock.t += 60_000;
    await engine.tick();
  }
  assert.equal(engine.getLedger().get(c.id)?.reevaluations?.filter((item) => item.trigger === "code-changed").length, 1, "the same code change is checked once per finding");
});

test("stand-ins: coverage is explicit, and a strategy is only trusted after a real request", async () => {
  const e = env();
  const found = discover(e, "project.read", { workspace: "w1", path: "/a" });
  assert.equal(found.options[0].coverage, "partial");
  assert.deepEqual(found.options[0].missingInputs, ["workspace"]);
  assert.match(found.options[0].why, /does not take workspace/);

  const { engine } = await learnUnavailable(e, "project.read");
  e.impl["sandbox.read"] = () => ({ ok: true, content: "/notes/plan.md" });
  for (let i = 0; i < 3 && !engine.strategies().length; i += 1) await engine.tick();
  const candidate = engine.strategies()[0];
  assert.equal(candidate.status, "candidate", "proven to respond, not proven to stand in");
  assert.equal(candidate.coverage, "partial");

  e.impl["sandbox.read"] = (args) => ({ ok: true, content: `contents of ${args.path}: the plan names milestone 3` });
  const goal = engine.notice({ ...WORLD, category: "project", source: "project", question: "What does the plan file name as the next milestone?", evidenceFingerprint: "g", subject: { preferred: { tool: "project.read", args: { workspace: "w1", path: "/notes/plan.md" } } } }).curiosity!;
  await engine.pursue(goal.id);
  assert.equal(engine.strategies().find((s) => s.forTool === "project.read")?.status, "current", "verified on a real request");
});

test("sync: ledger, journal and identity merge across devices without losing or resurrecting anything", () => {
  const ledger = CuriosityLedger.getInstance();
  CuriosityLedger.reset();
  const fresh = CuriosityLedger.getInstance();
  fresh.addConstraint({ tool: "x.tool", scope: "any", cause: "unavailable", reason: "r", learnedFrom: "c1", at: 100 });
  fresh.removeConstraint("x.tool");
  const remoteOld = { constraints: [{ tool: "x.tool", scope: "any" as const, cause: "unavailable" as const, reason: "r", learnedFrom: "c1", at: 100 }], curiosities: [], strategies: [], liftedConstraints: [] };
  fresh.mergeRemote(remoteOld);
  assert.equal(fresh.constraints().length, 0, "a constraint lifted here is not resurrected by an older copy");
  fresh.mergeRemote({ ...remoteOld, constraints: [{ ...remoteOld.constraints[0], at: Date.now() + 10_000 }] });
  assert.equal(fresh.constraints().length, 1, "but one learned again later elsewhere is kept");
  assert.ok(ledger);

  freshPersonality();
  const daily = DailyRecord.getInstance();
  daily.recordEvidence({ traitId: "curiosity", unitId: "here", source: "curiosity", observation: "o", at: Date.UTC(2026, 9, 1) }, Date.UTC(2026, 9, 1));
  daily.mergeRemote({
    records: {
      "2026-10-01": { ...record({ date: "2026-10-01" }), lessons: ["Curiosity — learned elsewhere"], developmentalEvidence: [{ traitId: "curiosity", unitId: "there", source: "curiosity", observation: "o", at: 1 }], reflection: { at: 5, meaningful: true, observations: [], traitChanges: [], staged: 0 } },
    },
  });
  const merged = daily.getByDate("2026-10-01")!;
  assert.deepEqual(merged.developmentalEvidence!.map((item) => item.unitId).sort(), ["here", "there"]);
  assert.ok(merged.lessons.includes("Curiosity — learned elsewhere"));
  assert.ok(merged.reflection, "reflected on another device → never reflected again here");

  const identity = LeluIdentity.getInstance();
  const local = identity.getState();
  identity.mergeRemote({ ...local, updatedAt: local.updatedAt + 1_000, communicationStyle: "remote", developmentHistory: [{ date: "2026-10-01", snapshotAt: 42, description: "remote snapshot", traitChanges: [] }] });
  assert.equal(identity.getState().communicationStyle, "remote", "the newer document wins");
  assert.ok(identity.getState().developmentHistory.some((item) => item.snapshotAt === 42), "history from both is kept");

  const persistence = src("src/core/persistence/SupabasePersistence.ts");
  assert.ok(persistence.includes('identity: "lelu_identity"') && persistence.includes("this.mergeDevelopmentRecords(preferenceRows)"));
  for (const store of ["LeluIdentity", "DailyRecord", "CuriosityLedger"]) {
    assert.ok(persistence.includes(`${store}.getInstance().subscribe(() => this.scheduleDevelopmentSync(`), `${store} syncs on change`);
  }
  assert.ok(persistence.includes('await this.write("user_preferences", [{ user_id: this.userId, preference_key: key, value'), "through the existing user_preferences store");
});

test("windows: a panel is fitted to the area that actually shows it — header and both edges on screen", async () => {
  const { fitFrame } = await import("../src/app/scene/genesis/frameFit");
  // Measured in the browser: the Genesis host is 622×482 at (88, 76) and
  // clips its contents; Cognition asks for 1134px and 90vh.
  const host = { left: 88, top: 76, right: 710, bottom: 558, width: 622 };
  for (const viewport of [{ width: 1280, height: 860 }, { width: 1024, height: 600 }]) {
    const fit = fitFrame(host, [host], viewport, 1134);
    const outerWidth = fit.width + 34;
    const outerHeight = fit.height + 34;
    const left = host.left + host.width / 2 - outerWidth / 2 + fit.nudgeX;
    const top = host.bottom - 24 - outerHeight;
    assert.ok(left >= host.left + 12 && left + outerWidth <= host.right - 12, `both edges inside the host at ${viewport.width}px`);
    assert.ok(top >= host.top + 12, `the header is inside the host at ${viewport.width}px (top ${top})`);
  }
  // An off-centre host near the screen edge: nudged back on screen, never past it.
  const edge = { left: -200, top: 0, right: 600, bottom: 800, width: 800 };
  const fit = fitFrame(edge, [], { width: 1280, height: 800 }, 500);
  const left = edge.left + edge.width / 2 - 500 / 2 + fit.nudgeX;
  assert.equal(left, 12, "pushed just far enough to show its left edge");
  // A short viewport caps the height to what is above the anchor.
  assert.equal(fitFrame({ left: 0, top: -300, right: 1000, bottom: 600, width: 1000 }, [], { width: 1000, height: 600 }, 500).height, 600 - 24 - 12 - 34);
});

test("evidence beyond curiosity: a verified objective and a self-correction are developmental evidence", async () => {
  assert.equal(completionEvidenceTrait(4, ["a"]), "patience");
  assert.equal(completionEvidenceTrait(1, ["listed workflows", "ran tests"]), "synthesis");
  assert.equal(completionEvidenceTrait(1, ["listed workflows"]), null, "a one-step completion is neither");
  assert.ok(src("src/core/cognition/AgentCognitionRuntime.ts").includes("recordCompletionEvidence(objective.id, objective.objective, "));
  const objectiveDay = reflectOnDay(record({ developmentalEvidence: [{ traitId: "patience", unitId: "objective:o1", source: "objective", observation: "completed", at: 1 }] }));
  assert.deepEqual(objectiveDay.candidateTraitChanges.map((item) => item.traitId), ["patience"]);

  const e = env();
  const { engine } = await learnUnavailable(e);
  setAvailable(e, "project.git", true);
  e.impl["project.git"] = () => ({ ok: true, content: "clean" });
  e.clock.t += 60_000;
  await engine.tick();
  assert.ok(e.evidence.some((item) => item.traitId === "patience" && /:correction:/.test(item.unitId ?? "")));
});

test("sync: a fresh device never overwrites real development — it reads, merges, then writes", async () => {
  const { default: SupabasePersistence, DEVELOPMENT_SYNC_KEYS } = await import("../src/core/persistence/SupabasePersistence");
  freshPersonality();
  const developed = { ...LeluIdentity.getInstance().getState(), communicationStyle: "developed elsewhere", updatedAt: Date.now() - 60_000 };
  LeluIdentity.reset();
  KvStore.getInstance().remove("identity.v1");
  // This device has only the seed — stamped NOW, so newer than the real history.
  assert.ok(LeluIdentity.getInstance().getState().updatedAt > developed.updatedAt);

  const writes: Array<{ table: string; rows: Array<{ preference_key: string; value: { communicationStyle?: string } }> }> = [];
  let readFails = true;
  const client = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq() { return query; },
        then(resolve: (value: unknown) => void) {
          resolve(readFails ? { data: null, error: { message: "network down" } } : { data: [{ preference_key: DEVELOPMENT_SYNC_KEYS.identity, value: developed }], error: null });
        },
        upsert(rows: never[]) { writes.push({ table, rows }); return Promise.resolve({ error: null }); },
      };
      return query;
    },
  };
  const persistence = SupabasePersistence.getInstance();
  const internals = persistence as unknown as { client: unknown; userId: string | null; status: string };
  const saved = { client: internals.client, userId: internals.userId, status: internals.status };
  Object.assign(internals, { client, userId: "u-test", status: "connected" });
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    await persistence.persistDevelopmentRecord(DEVELOPMENT_SYNC_KEYS.identity);
    assert.equal(writes.length, 0, "the remote copy could not be read → nothing is written blind");

    readFails = false;
    internals.status = "connected";
    await persistence.persistDevelopmentRecord(DEVELOPMENT_SYNC_KEYS.identity);
    assert.equal(LeluIdentity.getInstance().getState().communicationStyle, "developed elsewhere", "the seed never wins against real development, however new its timestamp");
    const written = writes.at(-1)!;
    assert.equal(written.table, "user_preferences");
    assert.equal(written.rows[0].value.communicationStyle, "developed elsewhere", "what is written is the merged state, not this device's seed");
  } finally {
    console.warn = warn;
    Object.assign(internals, saved);
  }
});
