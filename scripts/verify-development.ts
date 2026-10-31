/**
 * LÉLU DEVELOPMENT PASS — REAL-PATH ACCEPTANCE
 *
 * Every system is the real one: AIService + Brain, ToolDispatcher with its
 * permission check, ToolRegistry (availability computed from a LIVE probe
 * of the engineering runtime), AutonomyGate, ProactiveCore, the curiosity
 * engine, DailyRecord, DailyReflection, LeluIdentity, PersonalityGuard,
 * SelfModel, WorkQueue. Only browser storage is shimmed.
 *
 * The environment change in scenario B is genuine: the engineering
 * runtime (/api/engineer, served by the Vite dev server) is down at the
 * start and is started part-way through.
 *
 *   DEMO  recurring failure → curiosity → memory → registry → verified →
 *         learned → alternative discovered → alternative tested → strategy
 *   C     goal → preferred capability refused → discovery → alternative →
 *         permission → execution → verification → learning (strategy applied)
 *   D     host ambiguity → question card → answer in chat → memory → recall
 *   E     her own repeated failures → self-question → own records → learning
 *   B     unavailable tool → suppressed → runtime started → revalidation →
 *         verified by use → superseded → eligible again
 *   A     the day ends → DailyRecord → DailyReflection → PersonalityGuard →
 *         LeluIdentity → the new tendency changes which question comes next
 *
 * Run: npx tsx scripts/verify-development.ts
 */

import "./support/node-browser-shims";
import { spawn, type ChildProcess } from "node:child_process";

const RUNTIME_PORT = 5199;
process.env.VITE_LELU_ENGINEER_URL = `http://127.0.0.1:${RUNTIME_PORT}`;

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let runtime: ChildProcess | null = null;

async function startRuntime(): Promise<boolean> {
  runtime = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(RUNTIME_PORT), "--strictPort"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 90; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${RUNTIME_PORT}/api/engineer/status`);
      if (response.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}
function stopRuntime(): void {
  if (runtime?.pid) {
    try {
      process.kill(-runtime.pid);
    } catch {
      /* already gone */
    }
  }
}

async function main(): Promise<void> {
  const { default: AIService } = await import("../src/core/AIService");
  const { default: ProactiveCore } = await import("../src/core/proactive/ProactiveCore");
  const { default: CuriosityEngine } = await import("../src/core/curiosity/CuriosityEngine");
  const { selectTools } = await import("../src/core/curiosity/Curiosity");
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity");
  const { default: DailyRecord } = await import("../src/core/identity/DailyRecord");
  const { runDueReflections } = await import("../src/core/identity/DailyReflection");
  const { summarizeDevelopment } = await import("../src/core/identity/DevelopmentSummary");
  const { default: PersonalityGuard } = await import("../src/core/security/PersonalityGuard");
  const { default: SelfModel } = await import("../src/core/cognition/SelfModel");
  const { default: ToolRegistry } = await import("../src/core/tools/ToolRegistry");
  const { dispatchToolCall } = await import("../src/core/tools/ToolDispatcher");
  const { stopBackgroundCognition } = await import("../tests/support/isolation");

  const ai = AIService.getInstance();
  await ai.initialize();
  await stopBackgroundCognition(5_000);
  ProactiveCore.getInstance().updateSettings({ enabled: true, notificationLevel: "normal" });
  await ToolRegistry.getInstance().refreshAvailability();

  const engine = CuriosityEngine.getInstance();
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER, environmentCheckIntervalMs: 0 });
  engine.getLedger().markCapabilityScan(Date.now());
  engine.attachObservers();
  const ledger = engine.getLedger();
  const idle = async () => {
    while (ai.isUserTurnActive()) await sleep(250);
  };
  const turn = (tool: string, args: Record<string, unknown>, id: string) => dispatchToolCall({ id, name: tool.replace(/\./g, "_"), arguments: args }, id);
  const trail = (id: string) => ledger.get(id)?.trail.map((s) => `      ${s.step.padEnd(12)} ${s.detail.slice(0, 150)}`).join("\n");

  check(!ToolRegistry.getInstance().get("project.read")?.available, "setup: the engineering runtime is down — project tools are unavailable (live probe)");

  /* ============================ DEMONSTRATION ============================ */
  console.log("\n== DEMONSTRATION — a recurring failure, end to end ==");
  for (const id of ["turn-d1", "turn-d2"]) {
    const result = await turn("project.read", { workspace: "w1", path: "/notes/plan.md" }, id);
    console.log(`    ${id}: project.read → ${result.content.slice(0, 90)}`);
  }
  await idle();
  const d1 = await engine.tick();
  const diagnosis = ledger.list().find((c) => c.subject?.tool === "project.read" && c.category === "technical")!;
  check(Boolean(diagnosis) && d1.pursued?.id === diagnosis.id, "NOTICE → QUESTION: the recurring failure became “Why does project.read keep failing?”");
  check(diagnosis.proposedActions[0]?.tool === "memory.recall", "MEMORY was checked first");
  check(diagnosis.proposedActions.some((i) => i.tool === "internal:tool-registry" && i.outcome === "ok"), "INVESTIGATE: the capability registry was inspected");
  check(ledger.get(diagnosis.id)?.verification?.verdict === "verified", "VERIFY: observations and registry agree", ledger.get(diagnosis.id)?.verification?.note);
  check(ledger.get(diagnosis.id)?.learning?.retrievable === true, "LEARN: stored through AIService.consolidate and recalled back");
  const alternativeQ = ledger.list().find((c) => c.parentId === diagnosis.id && c.subject?.alternativeFor === "project.read");
  check(Boolean(alternativeQ), "the finding opened “What else can provide what project.read provides?”");
  const d2 = await engine.tick();
  check(d2.pursued?.id === alternativeQ?.id, "the alternative question was pursued next (one per cycle)");
  const alt = ledger.get(alternativeQ!.id)!;
  check(alt.proposedActions.some((i) => i.tool === "sandbox.read" && i.alternativeFor === "project.read" && i.outcome === "ok"), "DISCOVER ALTERNATIVE: sandbox.read was found in the registry and tested");
  check(alt.trail.some((s) => s.step === "discovery" && /Rejected:.*project\.git/.test(s.detail)), "alternatives were compared, with reasons for every rejection");
  const learnedStrategy = engine.strategies().find((s) => s.forTool === "project.read" && s.alternative === "sandbox.read");
  check(Boolean(learnedStrategy), "APPLY: a strategy was learned");
  check(learnedStrategy?.status === "candidate" && learnedStrategy.coverage === "partial", "…as a CANDIDATE with explicit coverage: it responds, but has not yet stood in for a real request (and does not take 'workspace')", JSON.stringify(learnedStrategy));
  check(SelfModel.getInstance().get().discoveries.some((line) => /sandbox\.read stands in/.test(line)), "the self-model records the strategy");
  console.log(`    trail of the alternative question:\n${trail(alt.id)}`);

  /* ================================== C ================================== */
  console.log("\n== C — preferred capability unavailable → existing alternative ==");
  await turn("sandbox.write", { path: "/notes/plan.md", content: "Milestone 3: the cosmos pass. Owner: LÉLU + Heru." }, "turn-c0");
  const goal = engine.notice({
    question: "What does the project plan say about the next milestone?",
    unknown: "The next milestone in the plan.",
    context: "Heru asked what comes next.",
    category: "project",
    source: "project",
    importance: 0.7,
    uncertainty: 0.7,
    relevance: 0.8,
    expectedBenefit: 0.7,
    evidenceFingerprint: "plan-milestone",
    subject: { preferred: { tool: "project.read", args: { workspace: "w1", path: "/notes/plan.md" } } },
  }).curiosity!;
  await engine.tick();
  const g = ledger.get(goal.id)!;
  const route = g.proposedActions.map((i) => `${i.tool}:${i.outcome}`);
  check(
    route.includes("project.read:blocked") || g.trail.some((s) => s.step === "discovery" && /^project\.read cannot be used \(known not to work here/.test(s.detail)),
    "the preferred capability was not usable — refused, or already known not to work and skipped",
    route.join(", "),
  );
  const used = g.proposedActions.find((i) => i.tool === "sandbox.read")!;
  check(used?.alternativeFor === "project.read" && used.permitted && used.permission === "auto", "permission: curiosity policy AND dispatcher both allowed the alternative");
  check(/Milestone 3/.test(used?.resultSummary ?? ""), "execution: the alternative returned the real file", used?.resultSummary);
  check(g.status === "resolved" && /Milestone 3/.test(g.learning?.summary ?? ""), "verification + learning: the answer was verified and remembered");
  check(g.trail.some((s) => s.step === "discovery" && /learned strategy/.test(s.detail)), "the earlier strategy was the reason for the choice (learning changed behaviour)");
  check(engine.strategies().find((s) => s.forTool === "project.read")?.status === "current", "having answered a real request, the strategy is now verified (current)");

  /* ================================== D ================================== */
  console.log("\n== D — host question through the normal chat question card ==");
  await ai.chat("I want LÉLU to become more independent — figure it out as you go.");
  const host = ledger.list().find((c) => c.category === "host")!;
  check(Boolean(host), "NOTICE: the real chat path raised a host curiosity");
  await idle();
  for (let i = 0; i < 4 && ledger.get(host.id)?.status !== "asking"; i += 1) await engine.tick();
  const card = ProactiveCore.getInstance().getActiveQuestion();
  check(ledger.get(host.id)?.status === "asking" && card?.key === ledger.get(host.id)?.hostQuestion?.key, "the question is on the existing proactive question card", card?.question);
  await ai.chat("I want her to inspect and test on her own, but always ask before changing files.");
  for (let i = 0; i < 40 && ledger.get(host.id)?.status !== "resolved"; i += 1) await sleep(100);
  check(ledger.get(host.id)?.status === "resolved" && ledger.get(host.id)?.learning?.retrievable === true, "the answer was classified, stored and is retrievable");
  const later = await turn("memory.recall", { query: "independent" }, "turn-d-later");
  check(/Heru clarified/.test(later.content), "a later recall returns the clarification as context");

  /* ================================== E ================================== */
  console.log("\n== E — self-development from her own behaviour ==");
  for (const [question, action] of [["What is the current git status of the project?", "status"], ["What changed in the project since the last commit?", "diff"]]) {
    engine.notice({
      question,
      unknown: "The repository's current state.",
      context: "Heru asked about the repository.",
      category: "project",
      source: "project",
      importance: 0.6,
      uncertainty: 0.7,
      relevance: 0.8,
      expectedBenefit: 0.7,
      evidenceFingerprint: `git:${action}`,
      subject: { preferred: { tool: "project.git", args: { action } } },
    });
  }
  const refusedDuringTurn = await engine.tick();
  check(refusedDuringTurn.ran === false && /user turn/.test(refusedDuringTurn.reason ?? ""), "host-turn protection: nothing runs while Heru's turn is active");
  await idle();
  for (let i = 0; i < 8 && !ledger.list().some((c) => c.category === "self"); i += 1) await engine.tick();
  const self = ledger.list().find((c) => c.category === "self");
  check(Boolean(self), "her own investigations repeatedly needing an unavailable tool raised a self-question", self?.question);
  for (let i = 0; i < 3 && ledger.get(self!.id)?.status !== "resolved"; i += 1) await engine.tick();
  check(ledger.get(self!.id)?.learning?.type === "self-knowledge", "she learned something about herself from her own records", ledger.get(self!.id)?.learning?.summary);

  /* ================================== F ================================== */
  console.log("\n== F — background web research and model-assisted judgement ==");
  const world = engine.notice({
    question: "What is the capital city of Australia?",
    unknown: "A fact about the world.",
    context: "A knowledge gap noticed while working.",
    category: "world",
    source: "memory",
    importance: 0.6,
    uncertainty: 0.8,
    relevance: 0.7,
    expectedBenefit: 0.7,
    evidenceFingerprint: "capital-au",
  }).curiosity!;
  for (let i = 0; i < 6 && !ledger.get(world.id)!.proposedActions.some((x) => x.tool === "research.web"); i += 1) await engine.tick();
  const research = ledger.get(world.id)!.proposedActions.find((x) => x.tool === "research.web");
  check(Boolean(research) && research!.cause !== "missing-context", "research ran outside a conversation with the runtime's real context", research?.resultSummary?.slice(0, 160));
  console.log(`    research.web → ${research?.outcome}: ${research?.resultSummary?.slice(0, 160)}`);
  const w = ledger.get(world.id)!;
  if (research?.outcome === "ok") {
    console.log(`    evidence: ${w.evidence.map((x) => `[${x.stance} ${x.weight}] ${x.claim.slice(0, 120)}`).join(" | ")}`);
    // Real providers decide what comes back. Either it answers the question and
    // is learned, or it does not and is refused — never learned regardless.
    const answered = w.evidence.some((x) => x.tool === "research.web" && x.stance === "supports");
    if (answered) {
      check(w.status === "resolved" && /canberra/i.test(w.learning?.summary ?? ""), "the answer was verified from real sources and remembered", w.learning?.summary?.slice(0, 160));
    } else {
      check(!/canberra|sydney/i.test(w.learning?.summary ?? "") && w.evidence.some((x) => /does not answer/i.test(x.claim)), "the providers' result did not answer the question, was judged irrelevant, and was NOT learned", w.evidence.find((x) => /does not answer/i.test(x.claim))?.claim.slice(0, 160));
    }
  } else {
    check(research?.cause !== undefined && research.cause !== "missing-context", "the knowledge providers were genuinely tried and their failure classified honestly", research?.cause);
  }
  const usage = engine.modelStats();
  console.log(`    model assistance so far: ${JSON.stringify(usage)}`);
  check(usage.calls > 0, "the model was consulted — through the existing AIService provider chain");
  check(usage.calls === usage.accepted + usage.rejected + usage.unavailable, "every model reply was validated: accepted, rejected or unavailable — none used unchecked");

  await ai.chat("Please get the demo ready the way we discussed last week, nothing fancy.");
  await idle();
  const modelCallsBefore = engine.modelStats().calls;
  const analysed = await engine.tick();
  check(engine.modelStats().calls > modelCallsBefore, "a request the rules missed was given ONE background model look (not on the chat path)");
  const modelHost = ledger.list().find((c) => c.category === "host" && /discussed|demo|fancy|usual/i.test(c.subject?.phrase ?? ""));
  console.log(`    model look: ${analysed.noticed.length ? `noticed ${analysed.noticed.join(" | ")}` : "judged clear or rejected — nothing raised"}`);
  if (modelHost) check("Please get the demo ready the way we discussed last week, nothing fancy.".toLowerCase().includes(modelHost.subject!.phrase!.toLowerCase()), "the ambiguity it raised quotes Heru's exact words");

  /* ================================== B ================================== */
  console.log("\n== B — tool recovery from a genuine environment change ==");
  for (const id of ["turn-b1", "turn-b2"]) await turn("project.git", { action: "status" }, id);
  await idle();
  for (let i = 0; i < 4 && !ledger.list().some((c) => c.subject?.tool === "project.git" && c.category === "technical" && c.status === "resolved"); i += 1) await engine.tick();
  const gitFinding = ledger.list().find((c) => c.subject?.tool === "project.git" && c.category === "technical")!;
  check(gitFinding?.status === "resolved" && ledger.constraints().some((r) => r.tool === "project.git"), "project.git learned unavailable and suppressed");
  const want = { question: "What is the git status?", context: "", category: "project" as const, keywords: [], subject: { preferred: { tool: "project.git", args: { action: "status" } } } };
  check(selectTools(want, engine.capabilityStates().length ? (await import("../src/core/curiosity/CuriosityPorts")).createDefaultPorts().catalog() : [], ledger.constraints(), true).every((c) => c.tool !== "project.git"), "while suppressed, it is not selected");
  const callsBefore = gitFinding.proposedActions.length;
  await engine.tick();
  check((ledger.get(gitFinding.id)?.reevaluations ?? []).length === 0, "no re-check while nothing has changed (no retry storm)");
  check(ledger.get(gitFinding.id)?.proposedActions.length === callsBefore, "…and no extra tool call");

  console.log("    starting the real engineering runtime …");
  const up = await startRuntime();
  check(up, "the engineering runtime is now reachable");
  let report = await engine.tick();
  for (let i = 0; i < 3 && report.revisited?.id !== gitFinding.id; i += 1) report = await engine.tick();
  const recovered = ledger.get(gitFinding.id)!;
  check(report.revisited?.trigger === "environment-changed", "RE-EVALUATION triggered by the environment change", JSON.stringify(report.revisited));
  const probe = recovered.proposedActions.filter((i) => i.tool === "project.git").at(-1);
  check(probe?.outcome === "ok" && /branch:/.test(probe.resultSummary ?? ""), "one bounded verification: a real read-only git status succeeded", probe?.resultSummary);
  check(recovered.reevaluations?.at(-1)?.outcome === "superseded", "SELF-CORRECTION: the old finding is superseded");
  check((recovered.supersededLearnings ?? []).some((l) => /not available/.test(l.summary)), "…and kept in history", JSON.stringify((recovered.supersededLearnings ?? []).map((l) => l.summary)));
  check(!ledger.constraints().some((r) => r.tool === "project.git"), "the tool is eligible again");
  check(engine.capabilityStates().find((r) => r.tool === "project.git")?.state === "available", "self-model: project.git available");
  const recall = await turn("memory.recall", { query: "project git usable again" }, "turn-b-later");
  check(/usable again/.test(recall.content), "the recovered state is in memory");
  check(Boolean(recovered.learning?.dependency?.code), "CODE WATCHING: the new finding is fingerprinted from the live source of project.git's executor and implementation", recovered.learning?.dependency?.code);
  const probesAfter = recovered.proposedActions.filter((i) => i.tool === "project.git").length;
  await engine.tick();
  check(ledger.get(gitFinding.id)!.proposedActions.filter((i) => i.tool === "project.git").length === probesAfter, "no further re-checks after recovery");
  check(!(ledger.get(gitFinding.id)!.reevaluations ?? []).some((x) => x.trigger === "code-changed"), "unchanged source raises no code-change re-check");

  /* ================================== A ================================== */
  console.log("\n== A — the day ends: reflection → evidence → guard → identity ==");
  const today = DailyRecord.getInstance().getOrCreateToday();
  const units = today.developmentalEvidence ?? [];
  console.log(`    evidence units recorded today: ${units.map((u) => u.traitId).join(", ")}`);
  const before = { ...LeluIdentity.getInstance().getTrait("pattern-recognition")! };
  const guardBefore = PersonalityGuard.getInstance().history().length;
  const summary = summarizeDevelopment(today);
  check(summary.assumptionsChanged.some((line) => /project\.git/.test(line)), "the day records the changed assumption");
  check(summary.capabilitiesDiscovered.some((line) => /sandbox\.read/.test(line)), "the day records the discovered capability");
  const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
  const runs = runDueReflections(tomorrow);
  check(runs.length === 1 && runs[0].date === today.date && runs[0].meaningful, "DailyReflection ran once, at the day boundary, on the real record");
  const after = LeluIdentity.getInstance().getTrait("pattern-recognition")!;
  const patternUnits = units.filter((u) => u.traitId === "pattern-recognition").length;
  check(after.evidenceCount === before.evidenceCount + Math.min(3, patternUnits), "every pattern-recognition unit became exactly one evidence item", `${before.evidenceCount} → ${after.evidenceCount} (${patternUnits} units)`);
  console.log(`    pattern-recognition: ${before.status} ${before.confidence.toFixed(2)} → ${after.status} ${after.confidence.toFixed(2)}`);
  if (after.status !== before.status) {
    check(PersonalityGuard.getInstance().history().length > guardBefore, "PersonalityGuard recorded the status change");
  }
  check(runDueReflections(tomorrow).length === 0, "the same day is never reflected twice");
  check(Boolean(DailyRecord.getInstance().getByDate(today.date)?.reflection), "the reflection is stored with the day");

  console.log("\n== The new identity state feeds the next curiosity ==");
  const tendencies = LeluIdentity.getInstance().getState().traits.filter((t) => t.status === "emerging" || t.status === "established").map((t) => `${t.id} (${t.status})`);
  console.log(`    developing tendencies: ${tendencies.join(", ") || "none yet"}`);
  if (after.status === "emerging" || after.status === "established") {
    const base = { unknown: "u", context: "c", category: "technical" as const, importance: 0.6, uncertainty: 0.6, relevance: 0.6, expectedBenefit: 0.6 };
    engine.notice({ ...base, question: "Why does the startup splash flicker on slow devices?", source: "conversation", evidenceFingerprint: "t-a" });
    const recurring = engine.notice({ ...base, question: "Why does my nightly self-check keep timing out?", source: "execution", evidenceFingerprint: "t-b" }).curiosity!;
    // Other work (e.g. re-checks the runtime change made urgent) may come
    // first; what matters is which of THESE two equal questions she picks.
    let first: string | undefined;
    for (let i = 0; i < 8 && !first; i += 1) {
      const next = await engine.tick();
      if (next.pursued && [recurring.id].includes(next.pursued.id)) first = next.pursued.id;
      else if (next.pursued?.question.startsWith("Why does the startup splash")) first = next.pursued.id;
    }
    check(first === recurring.id, "with pattern-recognition now emerging, the recurring-pattern question is pursued before an equal one");
    check(ledger.get(recurring.id)!.trail.some((s) => s.step === "tendency"), "the trail says why");
  }

  /* ============================ SECOND DEVICE ============================ */
  console.log("\n== Another device hydrates LÉLU's development records ==");
  const { default: SupabasePersistence, DEVELOPMENT_SYNC_KEYS } = await import("../src/core/persistence/SupabasePersistence");
  const { default: CuriosityLedger } = await import("../src/core/curiosity/CuriosityLedger");
  // Exactly the documents persistDevelopmentRecord writes to user_preferences.
  const rows = [
    { preference_key: DEVELOPMENT_SYNC_KEYS.identity, value: JSON.parse(JSON.stringify(LeluIdentity.getInstance().getState())) },
    { preference_key: DEVELOPMENT_SYNC_KEYS.daily, value: DailyRecord.getInstance().snapshot() },
    { preference_key: DEVELOPMENT_SYNC_KEYS.curiosity, value: CuriosityLedger.getInstance().snapshot() },
  ];
  const expected = {
    trait: LeluIdentity.getInstance().getTrait("pattern-recognition")!.status,
    curiosities: CuriosityLedger.getInstance().list().length,
    strategies: CuriosityLedger.getInstance().strategies().length,
    reflected: Boolean(DailyRecord.getInstance().getByDate(today.date)?.reflection),
  };
  LeluIdentity.reset();
  DailyRecord.reset();
  CuriosityLedger.reset();
  (await import("../src/core/storage/KvStore")).default.getInstance().remove("identity.v1");
  (await import("../src/core/storage/KvStore")).default.getInstance().remove("daily.v1");
  check(CuriosityLedger.getInstance().list().length === 0, "the 'other device' starts empty");
  SupabasePersistence.getInstance().mergeDevelopmentRecords(rows);
  check(LeluIdentity.getInstance().getTrait("pattern-recognition")!.status === expected.trait, "identity hydrated (trait lifecycle intact)");
  check(CuriosityLedger.getInstance().list().length === expected.curiosities && CuriosityLedger.getInstance().strategies().length === expected.strategies, "curiosity ledger and strategies hydrated");
  check(Boolean(DailyRecord.getInstance().getByDate(today.date)?.reflection) === expected.reflected, "the journal hydrated — a day reflected on one device is not reflected again on another");

  console.log(`\n${failures === 0 ? "ALL DEVELOPMENT ACCEPTANCE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  stopRuntime();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Development acceptance crashed:", error);
  stopRuntime();
  process.exit(1);
});
