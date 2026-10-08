/**
 * ==========================================================
 * LÉLU — FINAL LIVE AUTONOMOUS COGNITION PROOF
 *
 * One browser session, one running app, one continuous cognition
 * process. Covers all eight tests:
 *
 *   1 autonomous start from Bootstrap, no user message
 *   2 real objective generation (no preloaded queue)
 *   3 continuity past the old queue boundary — cycles 12..16+
 *   4 agent/tool routing per knowledge-gap kind
 *   5 REAL_DEVELOPMENT_RUNTIME first, STATIC_SNAPSHOT only as fallback
 *   6 provider failure → same operation continues on the next provider
 *   7 memory: retrieve → reason → consolidate → available next cycle
 *   8 chat observes pre-existing state, never creates it
 *
 * Nothing here calls runCycle() during the autonomy phases. Where the
 * harness does drive a cycle (routing coverage only) it is labelled.
 * ==========================================================
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const TARGET_CYCLES = Number(process.env.VERIFY_CYCLES || 16);

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const log = (m) => console.error(`[proof] ${m}`);

log(`opening ${BASE}`);
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });

// ---------------------------------------------------------------
// TEST 1 — Bootstrap starts cognition on its own. We only watch.
// ---------------------------------------------------------------
await page.waitForTimeout(12000);

const test1 = await page.evaluate(async () => {
  const { default: SelfStudyEngine } = await import("/src/core/cognition/SelfStudyEngine.ts");
  const { default: StudyObjectives } = await import("/src/core/cognition/StudyObjectives.ts");
  const engine = SelfStudyEngine.getInstance();
  return {
    // Nothing in this page has sent a chat message.
    loopRunningAfterBootstrap: engine.isRunning(),
    cycleShortlyAfterBoot: engine.getCycle(),
    missionActive: engine.mission().active,
    missionProjects: engine.mission().projects.map((p) => p.name),
    // The buffer at boot is whatever persisted; recorded for honesty.
    bufferAtBoot: StudyObjectives.getInstance().open().length,
    harnessCalledRunCycle: false,
    harnessSentChatMessage: false,
  };
});
log(`test1: running=${test1.loopRunningAfterBootstrap} cycle=${test1.cycleShortlyAfterBoot}`);

// ---------------------------------------------------------------
// TEST 2 — clear the buffer so nothing is preloaded, then let the
// loop generate its own objectives. Still no runCycle() from here.
// ---------------------------------------------------------------
const test2Setup = await page.evaluate(async () => {
  const { default: SelfStudyEngine } = await import("/src/core/cognition/SelfStudyEngine.ts");
  const { default: StudyObjectives } = await import("/src/core/cognition/StudyObjectives.ts");
  const engine = SelfStudyEngine.getInstance();
  const ledger = StudyObjectives.getInstance();

  // Prove there is no pre-populated queue to draw from.
  ledger.clear();

  // Re-pace the SELF-SCHEDULING loop so a long continuity run is
  // observable. This changes the interval only — the engine still
  // schedules every cycle itself; the harness never calls runCycle().
  engine.stop();
  engine.start(2500);

  return {
    bufferEmptiedTo: ledger.open().length,
    loopRestartedRunning: engine.isRunning(),
    cycleAtStartOfContinuityRun: engine.getCycle(),
    pacingNote: "engine.start(2500) — self-scheduled interval only; runCycle() is never called by the harness",
  };
});
log(`test2: buffer=${test2Setup.bufferEmptiedTo} cycle=${test2Setup.cycleAtStartOfContinuityRun}`);

// ---------------------------------------------------------------
// TEST 3 — watch the self-scheduled loop reach and pass cycle 12.
// ---------------------------------------------------------------
const collected = await page.evaluate(async ({ target, budgetMs }) => {
  const { default: SelfStudyEngine } = await import("/src/core/cognition/SelfStudyEngine.ts");
  const engine = SelfStudyEngine.getInstance();
  const seen = [];
  // Subscribe to the engine's own reports — pure observation.
  const unsubscribe = engine.subscribe((r) => {
    seen.push({
      cycle: r.cycle,
      objectiveSource: r.objectiveSource,
      origin: r.objective?.origin ?? null,
      domain: r.objective?.domain ?? null,
      question: r.objective?.question ?? null,
      createdInCycle: r.objective?.createdInCycle ?? null,
      parentId: r.objective?.parentId ?? null,
      objectiveId: r.objective?.id ?? null,
      agent: r.agent,
      tool: r.tool,
      evidenceOrigin: r.evidenceOrigin,
      evidenceCount: r.evidence.length,
      evidenceSample: r.evidence.slice(0, 2),
      provider: r.provider,
      providerFallback: r.providerFallback,
      learned: r.learned,
      memoryRetrieved: r.memoryRetrieved,
      memoryConsolidated: r.memoryConsolidated,
      derived: r.derived,
      derivedFrom: r.derivedFrom,
      bufferRemaining: r.bufferRemaining,
      generatedThisCycle: r.generated,
      note: r.note ?? null,
    });
  });

  const deadline = Date.now() + budgetMs;
  while (engine.getCycle() < target && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  unsubscribe();
  return { reports: seen, finalCycle: engine.getCycle(), stillRunning: engine.isRunning() };
}, { target: TARGET_CYCLES, budgetMs: Number(process.env.VERIFY_BUDGET_MS || 8 * 60 * 1000) });
log(`test3: reached cycle ${collected.finalCycle}, ${collected.reports.length} reports`);

// ---------------------------------------------------------------
// TESTS 4-7 — routing coverage, runtime provenance, provider
// fallback, and the memory chain.
// ---------------------------------------------------------------
const rest = await page.evaluate(async () => {
  const out = {};
  const [{ default: SelfStudyEngine }, { default: StudyObjectives },
         { default: StudyAgentRouter }, { default: AIService },
         { default: SourceAccess }] = await Promise.all([
    import("/src/core/cognition/SelfStudyEngine.ts"),
    import("/src/core/cognition/StudyObjectives.ts"),
    import("/src/core/cognition/StudyAgentRouter.ts"),
    import("/src/core/AIService.ts"),
    import("/src/core/selfdev/SourceAccess.ts"),
  ]);
  const engine = SelfStudyEngine.getInstance();
  const router = StudyAgentRouter.getInstance();
  const ai = AIService.getInstance();

  /* ---- TEST 4: routing table + a real investigation per domain ---- */
  const domains = ["architecture", "source", "research", "memory", "testing", "runtime", "capability"];
  out.routingTable = domains.map((d) => ({ domain: d, agent: router.agentFor(d)?.name ?? "LÉLU (direct)" }));

  const probes = {
    architecture: { question: "What is the shape of the cognition subsystem?", domain: "architecture", target: "cognition" },
    source: { question: "What is in src/core/cognition/StudyAgentRouter.ts?", domain: "source", target: "src/core/cognition/StudyAgentRouter.ts" },
    research: { question: "What is retrieval-augmented generation?", domain: "research", target: "retrieval augmented generation" },
    memory: { question: "What do I remember about my own self-study?", domain: "memory", target: "self-study" },
    testing: { question: "Do my own self-tests pass?", domain: "testing" },
  };
  out.routingProof = [];
  for (const [kind, probe] of Object.entries(probes)) {
    // The REAL routing layer, invoked directly so every kind is covered
    // rather than only the kinds the loop happened to reach.
    const objective = {
      id: `probe-${kind}`, question: probe.question, detail: "routing coverage probe",
      origin: "architecture", domain: probe.domain, priority: 50, status: "open",
      createdInCycle: engine.getCycle(), attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
      basePriority: 50, target: probe.target,
    };
    const inv = await router.investigate(objective);
    out.routingProof.push({
      gapKind: kind, domain: probe.domain, agent: inv.agentName, tool: inv.tool,
      evidenceOrigin: inv.origin, evidenceCount: inv.evidence.length,
      returnedToCognition: inv.evidence.length > 0 || Boolean(inv.error),
      firstEvidence: inv.evidence[0]?.slice(0, 150) ?? null,
    });
  }

  /* ---- TEST 5: runtime first, snapshot only as fallback ---- */
  const access = SourceAccess.getInstance();
  const liveStatus = await access.status(true);
  const liveRead = await access.read("src/core/cognition/SelfStudyEngine.ts");
  const originalBaseUrl = access.baseUrl;
  access.baseUrl = () => "http://127.0.0.1:59999"; // unreachable
  access.cachedStatus = null;
  const deadStatus = await access.status(true);
  const fallbackRead = await access.read("src/core/cognition/SelfStudyEngine.ts");
  access.baseUrl = originalBaseUrl;
  access.cachedStatus = null;
  await access.status(true);
  out.runtimeProvenance = {
    runtimeReachable: liveStatus.reachable,
    runtimeLabel: liveStatus.runtime,
    describe: access.describe(liveStatus),
    liveRead: { origin: liveRead.origin, bytes: liveRead.content?.length ?? 0 },
    withRuntimeDown: {
      reachable: deadStatus.reachable,
      origin: fallbackRead.origin,
      bytes: fallbackRead.content?.length ?? 0,
    },
    snapshotPathCount: access.snapshotPaths().length,
    sameBytesDifferentLabel:
      liveRead.content?.length === fallbackRead.content?.length &&
      liveRead.origin !== fallbackRead.origin,
  };

  /* ---- TEST 6: provider failure inside the EXISTING registry ---- */
  const registry = ai.getAIProviderRegistry();
  const before = registry.names();
  const attempts = [];
  // Fault injection into the registry the runtime already uses. This is
  // not a new provider abstraction: it implements the existing
  // AIProvider interface and is registered through registry.register().
  registry.register({
    name: "FaultInjected", priority: -1, enabled: true, timeout: 5000,
    requiresApiKey: false, capabilities: ["chat"],
    async initialize() {}, async isAvailable() { return true; },
    async health() { return { available: true, initialized: true, lastChecked: Date.now() }; },
    canHandle() { return true; },
    async generate() { attempts.push("FaultInjected"); throw new Error("simulated provider outage"); },
  });

  // The self-scheduled loop must be paused first: cycles never overlap,
  // so driving one while the loop owns a cycle would hit the no-overlap
  // guard and return the PREVIOUS report instead of running the fault.
  const wasRunning = engine.isRunning();
  engine.stop();
  for (let i = 0; i < 120 && engine.isBusy(); i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  const cycleBeforeFault = engine.getCycle();
  const faultReport = await engine.runCycle(); // harness-driven, labelled
  if (wasRunning) engine.start(2500);
  out.providerFallback = {
    note: "harness-driven cycle, to force the failure through the real chain",
    registryBefore: before,
    registryAfter: registry.names(),
    faultProviderAttempted: attempts.length > 0,
    faultRecorded: Boolean(registry.failure("FaultInjected")),
    faultReason: registry.failure("FaultInjected")?.reason ?? null,
    // The SAME cognitive operation continued and produced a result.
    cycleQuestion: faultReport.objective?.question ?? null,
    providerThatAnswered: faultReport.provider,
    activeProviderAfter: registry.getActiveProvider(),
    evidenceCount: faultReport.evidence.length,
    learned: faultReport.learned,
    cognitionContinued: engine.getCycle() === cycleBeforeFault + 1 && Boolean(faultReport.objective),
    loopStillRunning: engine.isRunning(),
  };

  /* ---- TEST 7: the memory chain ---- */
  const memories = await ai.getMemories(500);
  out.memory = {
    totalAuthoritativeRecords: memories.length,
    sample: memories.slice(0, 3).map((m) => ({ category: m.category, prompt: m.prompt.slice(0, 90), response: m.response.slice(0, 130) })),
  };
  // A durable write from a completed cycle must be retrievable by the
  // same recall path the next cycle uses.
  const lastLearned = engine.getHistory(40).filter((r) => r.memoryConsolidated).slice(-1)[0];
  if (lastLearned?.objective) {
    const recalled = await ai.recall(lastLearned.objective.question);
    out.memory.recallOfConsolidatedCycle = {
      cycle: lastLearned.cycle,
      question: lastLearned.objective.question.slice(0, 110),
      recalledRecords: recalled.length,
      topRecall: recalled[0]?.response?.slice(0, 160) ?? null,
    };
  }

  out.finalState = {
    cycle: engine.getCycle(),
    running: engine.isRunning(),
    carried: StudyObjectives.getInstance().open().length,
  };
  return out;
});
log(`tests 4-7 done (cycle ${rest.finalState.cycle})`);

// ---------------------------------------------------------------
// TEST 8 — chat observes. Snapshot first, then the single message.
// ---------------------------------------------------------------
const test8 = await page.evaluate(async () => {
  const [{ default: SelfStudyEngine }, { default: AIService }] = await Promise.all([
    import("/src/core/cognition/SelfStudyEngine.ts"),
    import("/src/core/AIService.ts"),
  ]);
  const engine = SelfStudyEngine.getInstance();
  const ai = AIService.getInstance();

  // Freeze the loop so the comparison across the request is exact.
  engine.stop();
  const before = {
    cycle: engine.getCycle(),
    running: engine.isRunning(),
    state: engine.getCognitiveState(),
  };

  const reply = await ai.chat("LÉLU, what are you thinking about today?");
  const after = { cycle: engine.getCycle() };

  const s = before.state;
  const has = (n) => Boolean(n) && reply.text.includes(n);
  return {
    cyclesCompletedBeforeAnyChat: before.cycle,
    loopWasStoppedForThisComparison: !before.running,
    cycleBefore: before.cycle,
    cycleAfter: after.cycle,
    answeredBy: reply.provider,
    metadata: reply.metadata ?? null,
    grounding: {
      currentFocus: has(s.focus?.question),
      reasonSelected: has(s.focus?.whySelected),
      activeInvestigationAgent: has(s.investigation?.agent),
      activeInvestigationTool: has(s.investigation?.tool),
      recentDiscoveries: s.discoveries.filter((d) => reply.text.includes(d.split(" [")[0])).length,
      unresolvedQuestions: s.unresolved.filter((u) => reply.text.includes(u.split(" (")[0])).length,
      projectUnderstanding: reply.text.includes(String(s.understanding.knowledgeEntries)),
      nextIntended: has(s.nextIntended?.question),
      noRawChainOfThought:
        !reply.text.includes("CONFIDENCE:") &&
        !reply.text.includes("QUESTION I AM INVESTIGATING:") &&
        !/\bNEXT:\s/.test(reply.text),
    },
    stateSnapshotBeforeRequest: {
      focus: s.focus?.question ?? null,
      agent: s.investigation?.agent ?? null,
      tool: s.investigation?.tool ?? null,
      nextIntended: s.nextIntended?.question ?? null,
      carried: s.carried,
    },
    answer: reply.text,
  };
});
log(`test8: answered by ${test8.answeredBy}, cycle ${test8.cycleBefore}->${test8.cycleAfter}`);

// ---------------------------------------------------------------
// CRITICAL CRITERION — cognition survives chat being gone entirely.
// ---------------------------------------------------------------
const survives = await page.evaluate(async () => {
  const { default: SelfStudyEngine } = await import("/src/core/cognition/SelfStudyEngine.ts");
  const engine = SelfStudyEngine.getInstance();
  const at = engine.getCycle();
  engine.start(2500); // resume self-scheduling; no chat involved
  await new Promise((r) => setTimeout(r, 12000));
  return {
    cycleWhenChatWentAway: at,
    cycleAfterChatWentAway: engine.getCycle(),
    advancedWithNoChat: engine.getCycle() > at,
    running: engine.isRunning(),
  };
});
log(`critical: ${survives.cycleWhenChatWentAway} -> ${survives.cycleAfterChatWentAway}`);

console.log(JSON.stringify({
  test1_autonomousStart: test1,
  test2_setup: test2Setup,
  test3_continuity: collected,
  test4_routing: { table: rest.routingTable, proof: rest.routingProof },
  test5_runtime: rest.runtimeProvenance,
  test6_providerFallback: rest.providerFallback,
  test7_memory: rest.memory,
  test8_chatObserves: test8,
  criticalCriterion_cognitionWithoutChat: survives,
  finalState: rest.finalState,
  pageErrors,
}, null, 2));

await browser.close();
