/**
 * LÉLU CURIOSITY ENGINE — REAL-WORLD ACCEPTANCE (three cycles)
 *
 * Not a unit test. Every system here is the real one: AIService and its
 * Brain (offline), ToolDispatcher with its permission check, ToolRegistry,
 * AutonomyGate, ProactiveCore's question channel, LeluIdentity with
 * PersonalityGuard, DailyRecord and WorkQueue. Only the browser's storage
 * (localStorage, IndexedDB) is shimmed, exactly as scripts/verify-tool-execute.ts
 * already does, so the engine runs in Node.
 *
 * Personality evidence now flows curiosity → DailyRecord → DailyReflection
 * → PersonalityGuard → LeluIdentity (see scripts/verify-development.ts for
 * the reflection half); here it is checked at the DailyRecord.
 *
 *   A  HOST   ambiguity in Heru's request → memory has nothing → one question
 *             → Heru answers through the real chat path → stored, recallable
 *   B  TOOL   a tool fails in two separate turns → investigated through the
 *             registry → verified → stored → applied as a constraint + proposal
 *   C  SELF   her own investigations keep failing on one tool → self-question
 *             → her own records + registry → self-knowledge → personality
 *             evidence → developmental record
 *
 * Run: npx tsx scripts/verify-curiosity.ts
 */

import "./support/node-browser-shims";

let failures = 0;
function check(condition: boolean, label: string, detail?: string): void {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const { default: AIService } = await import("../src/core/AIService");
  const { default: ProactiveCore } = await import("../src/core/proactive/ProactiveCore");
  const { default: CuriosityEngine } = await import("../src/core/curiosity/CuriosityEngine");
  const { default: LeluIdentity } = await import("../src/core/identity/LeluIdentity");
  const { default: DailyRecord } = await import("../src/core/identity/DailyRecord");
  const { default: WorkQueue } = await import("../src/core/cognition/WorkQueue");
  const { dispatchToolCall } = await import("../src/core/tools/ToolDispatcher");
  const { stopBackgroundCognition } = await import("../tests/support/isolation");

  const ai = AIService.getInstance();
  await ai.initialize();
  await stopBackgroundCognition(5_000);
  ProactiveCore.getInstance().updateSettings({ enabled: true, notificationLevel: "normal" });

  const engine = CuriosityEngine.getInstance();
  // The capability scan is its own (quiet) cycle; kept out of A–C so each is legible.
  engine.configure({ capabilityScanIntervalMs: Number.MAX_SAFE_INTEGER });
  engine.getLedger().markCapabilityScan(Date.now());
  engine.attachObservers();
  const initialPatternEvidence = LeluIdentity.getInstance().getTrait("pattern-recognition")!.evidenceCount;

  const waitForTurnGrace = async () => {
    while (ai.isUserTurnActive()) await sleep(250);
  };
  const show = (id: string) => {
    const e = engine.explain(id);
    if (!e) return;
    console.log(`    question:   ${e.question}`);
    console.log(`    detected:   ${e.detected}`);
    for (const tool of e.tools) console.log(`    tool:       ${tool}`);
    for (const ev of e.evidence) console.log(`    evidence:   ${ev}`);
    console.log(`    confidence: ${e.confidence}`);
    console.log(`    learning:   ${e.learning}`);
    for (const a of e.applied) console.log(`    applied:    ${a}`);
    console.log(`    status:     ${e.status}`);
  };

  /* ============================== CYCLE A ============================== */
  console.log("\n== CYCLE A — HOST: an ambiguity only Heru can resolve ==");
  await ai.chat("I want to make LÉLU more autonomous — something like letting her handle things on her own.");
  const hostCuriosity = engine.getLedger().list().find((item) => item.category === "host");
  check(Boolean(hostCuriosity), "NOTICE: the real chat path raised a host curiosity", JSON.stringify(engine.getLedger().list().map((c) => c.question)));
  if (!hostCuriosity) throw new Error("cycle A cannot continue");
  console.log(`    noticed: ${hostCuriosity.question}`);

  const refused = await engine.tick();
  check(refused.ran === false && /user turn/.test(refused.reason ?? ""), "a tick during Heru's turn stands down", refused.reason);
  await waitForTurnGrace();
  await engine.tick();
  const asked = engine.getLedger().get(hostCuriosity.id)!;
  check(asked.proposedActions.some((i) => i.tool === "memory.recall"), "ASSESS: memory was consulted before asking");
  check(asked.status === "asking", "ASK: memory could not answer, no tool can, so she asked", asked.status);
  const active = ProactiveCore.getInstance().getActiveQuestion();
  check(active?.question === asked.hostQuestion?.text, "the question is on the EXISTING proactive question channel", active?.question);
  console.log(`    asked: ${active?.question}`);

  await ai.chat("I want her to run tests and inspect the project on her own, but she should always ask before changing files.");
  for (let i = 0; i < 40 && engine.getLedger().get(hostCuriosity.id)?.status !== "resolved"; i += 1) await sleep(100);
  const answered = engine.getLedger().get(hostCuriosity.id)!;
  check(answered.status === "resolved", "Heru's answer through the real chat path resolved the curiosity", answered.status);
  check(answered.learning?.type === "constraint", "the answer was classified (constraint: 'ask before changing files')", answered.learning?.type);
  check(answered.learning?.retrievable === true, "REMEMBER: the clarification is stored AND recallable");
  const recallA = await dispatchToolCall({ id: "check-a", name: "memory_recall", arguments: { query: "autonomous" } }, "verify-a");
  check(recallA.ok && /Heru clarified/.test(recallA.content), "a later recall returns it as usable context", recallA.content.slice(0, 200));
  check(
    !LeluIdentity.getInstance().getState().preferences.some((p) => /changing files/.test(p)),
    "the answer was NOT written into LÉLU's identity",
  );
  show(hostCuriosity.id);

  /* ============================== CYCLE B ============================== */
  console.log("\n== CYCLE B — TOOL: a project uncertainty answered by authorized tools ==");
  for (const turn of ["turn-b1", "turn-b2"]) {
    const result = await dispatchToolCall({ id: turn, name: "project_read", arguments: { workspace: "w1", path: "src/main.ts" } }, turn);
    console.log(`    ${turn}: project.read → ${result.content.slice(0, 110)}`);
  }
  await waitForTurnGrace();
  const tickB = await engine.tick();
  check(tickB.noticed.some((q) => /project\.read/.test(q)), "NOTICE: two failures in two turns became a question", JSON.stringify(tickB.noticed));
  const technical = engine.getLedger().list().find((item) => item.category === "technical" && item.subject?.tool === "project.read")!;
  check(Boolean(technical), "the technical curiosity exists");
  const b = engine.getLedger().get(technical.id)!;
  check(b.proposedActions.some((i) => i.tool === "internal:tool-registry" && i.outcome === "ok"), "TOOL: the registry was inspected with an explicit purpose", JSON.stringify(b.proposedActions.map((i) => [i.tool, i.outcome])));
  check(b.proposedActions.every((i) => i.reason.length > 0 && i.expectedEvidence.length > 0), "every intent carries a reason and expected evidence");
  check(b.verification?.verdict === "verified", "VERIFY: observations + registry state agree", b.verification?.note);
  check(b.learning?.retrievable === true, "LEARN/REMEMBER: stored through AIService.consolidate and recalled back", JSON.stringify(b.learning));
  check(engine.getLedger().constraints().some((r) => r.tool === "project.read"), "APPLY: future investigations will not select project.read");
  check(WorkQueue.getInstance().listCategory("REVIEW").some((item) => /project\.read/.test(item.title)), "APPLY: a REVIEW objective was PROPOSED (not executed)");
  show(technical.id);

  /* ============================== CYCLE C ============================== */
  console.log("\n== CYCLE C — SELF: a recurring pattern in her own behaviour ==");
  const before = LeluIdentity.getInstance().getTrait("pattern-recognition")!;
  const beforeEvidence = before.evidenceCount;
  for (const question of [
    "What is the current stable release line of the Vite build tool?",
    "What changed in the most recent TypeScript compiler release?",
  ]) {
    engine.notice({
      question,
      unknown: "A fact about the outside world I do not hold.",
      context: "A knowledge gap noticed while working.",
      category: "world",
      source: "memory",
      importance: 0.5,
      uncertainty: 0.8,
      relevance: 0.6,
      expectedBenefit: 0.6,
      evidenceFingerprint: `gap:${question}`,
    });
  }
  // Higher-tier work (e.g. cycle B's follow-up) is pursued first; keep
  // ticking until both knowledge gaps have actually been attempted.
  for (let i = 0; i < 6; i += 1) {
    const pending = engine.getLedger().list().filter((item) => item.category === "world" && item.attempts === 0);
    if (pending.length === 0) break;
    await engine.tick();
  }
  const worlds = engine.getLedger().list().filter((item) => item.category === "world");
  check(
    worlds.every((w) => w.proposedActions.some((i) => i.tool === "research.web" && i.outcome === "failed")),
    "two separate investigations each tried read-only research and it failed",
    JSON.stringify(worlds.map((w) => w.proposedActions.map((i) => [i.tool, i.outcome, i.cause]))),
  );
  check(worlds.every((w) => w.status === "queued" && (w.nextAttemptAt ?? 0) > Date.now()), "with no evidence, both were DEFERRED with backoff — no fabricated answer");

  const tickC = await engine.tick();
  check(tickC.noticed.some((q) => /my own investigations/.test(q)), "NOTICE: she questioned her own behaviour", JSON.stringify(tickC.noticed));
  const self = engine.getLedger().list().find((item) => item.category === "self")!;
  const c = engine.getLedger().get(self.id)!;
  check(c.proposedActions.some((i) => i.tool === "internal:curiosity-ledger" && i.outcome === "ok"), "she investigated her own records");
  check(c.verification?.verdict === "verified", "VERIFY: her records and the registry agree on the cause", c.verification?.note);
  check(c.learning?.type === "self-knowledge" && c.learning.retrievable, "LEARN: self-knowledge stored and recallable", JSON.stringify(c.learning));
  check(engine.getLedger().constraints().some((r) => r.tool === "research.web" && r.scope === "background"), "APPLY: background investigations no longer pick research.web");
  check(c.personalityEvidence?.traitId === "pattern-recognition", "PERSONALITY: the self-curiosity supplied evidence for pattern-recognition", JSON.stringify(c.personalityEvidence));
  const contributing = engine.getLedger().list().filter((item) => item.personalityEvidence?.mode === "applied" && item.personalityEvidence.traitId === "pattern-recognition");
  const roots = new Set(contributing.map((item) => item.rootId));
  check(roots.size === contributing.length, "at most one evidence item per inquiry chain (follow-ups add none)", `${contributing.length} items over ${roots.size} chains`);
  const pending = (DailyRecord.getInstance().getOrCreateToday().developmentalEvidence ?? []).filter((item) => item.traitId === "pattern-recognition");
  check(pending.length === contributing.length, "every evidence unit is in the daily record, awaiting reflection", `${pending.length} recorded, ${contributing.length} curiosities`);
  check(pending.some((item) => item.observation.includes(c.question)), "the observation names the curiosity it came from");
  const after = LeluIdentity.getInstance().getTrait("pattern-recognition")!;
  check(after.evidenceCount === initialPatternEvidence, "identity is unchanged until the daily reflection runs", `${initialPatternEvidence} → ${after.evidenceCount}`);
  console.log(`    pattern-recognition: ${before.status} (evidence ${beforeEvidence}); ${pending.length} unit(s) awaiting reflection`);
  const today = DailyRecord.getInstance().getOrCreateToday();
  check(today.emergingTraits.some((line) => /pattern-recognition/.test(line)), "DEVELOP: the daily record carries the evidence");
  check(today.lessons.some((line) => /research\.web/.test(line)), "DEVELOP: the daily record carries the lesson");
  show(self.id);

  console.log("\n== Bounded chain: the next question ==");
  const followUps = engine.getLedger().list().filter((item) => item.parentId);
  check(followUps.length >= 1, "a verified diagnosis opened a follow-up question", JSON.stringify(followUps.map((f) => f.question)));
  check(followUps.every((f) => f.depth === 1), "follow-ups are one level deeper");
  await engine.tick();
  const followed = engine.getLedger().list().filter((item) => item.parentId);
  console.log(followed.map((f) => `    ${f.question} → ${f.status}${f.learning ? ` (${f.learning.summary.slice(0, 120)})` : ""}`).join("\n"));

  console.log("\n== Daily record (today) ==");
  for (const field of ["questions", "experiences", "lessons", "emergingTraits", "relationshipObservations"] as const) {
    for (const line of today[field]) console.log(`    ${field}: ${line}`);
  }

  console.log(`\n${failures === 0 ? "ALL CURIOSITY ACCEPTANCE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Curiosity acceptance crashed:", error);
  process.exit(1);
});
