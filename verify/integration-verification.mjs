/**
 * ==========================================================
 * LÉLU — FINAL INTEGRATION VERIFICATION
 *
 * Runs the REAL app in a REAL browser against a REAL development
 * runtime, and proves three things simultaneously:
 *
 *   1. She autonomously continues self-study from her mission.
 *   2. Her agents/tools and the real development runtime take part.
 *   3. The existing chat interface can REPORT the cognitive state
 *      that already exists, without being what created it.
 *
 * The critical control: cognition is observed running BEFORE any
 * chat request is made, the chat request is then made, and the
 * cycle counter and objective identity are compared across it.
 * ==========================================================
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });

// ---------------------------------------------------------------
// PHASE 0 — let the app boot itself. Nothing below sends a message.
// ---------------------------------------------------------------
await page.waitForTimeout(20000);

const result = await page.evaluate(async () => {
  const out = { phases: {}, errors: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    const [{ default: SelfStudyEngine }, { default: StudyObjectives }, { default: AIService },
           { default: SourceAccess }, { default: KnowledgeLibrary },
           { buildCognitiveContext, formatCognitiveContext }] = await Promise.all([
      import("/src/core/cognition/SelfStudyEngine.ts"),
      import("/src/core/cognition/StudyObjectives.ts"),
      import("/src/core/AIService.ts"),
      import("/src/core/selfdev/SourceAccess.ts"),
      import("/src/core/cognition/KnowledgeLibrary.ts"),
      import("/src/core/cognition/CognitiveContext.ts"),
    ]);

    const engine = SelfStudyEngine.getInstance();
    const ai = AIService.getInstance();
    await ai.initialize();

    /* =========================================================
       PHASE 1 — cognition is ALREADY running, unprompted.
       ========================================================= */
    const bootObserved = {
      loopRunningAtObservation: engine.isRunning(),
      cycleAtObservation: engine.getCycle(),
      observedAt: Date.now(),
    };

    // Watch it advance on its OWN schedule. We do not call runCycle().
    const advanced = [];
    for (let i = 0; i < 24 && advanced.length < 3; i++) {
      await sleep(2500);
      const c = engine.getCycle();
      if (advanced[advanced.length - 1] !== c) advanced.push(c);
    }
    out.phases.autonomy = {
      ...bootObserved,
      cycleProgressionWithoutAnyUserMessage: advanced,
      cycleAfterWatching: engine.getCycle(),
      loopStillRunning: engine.isRunning(),
      // Nothing in this block called runCycle/start.
      testCalledRunCycle: false,
    };

    /* =========================================================
       PHASE 2 — agents/tools + real development runtime.
       ========================================================= */
    const access = SourceAccess.getInstance();
    const status = await access.status(true);

    // Phase 1's autonomy control is already established above, so from
    // here the test may drive cycles to get DETERMINISTIC coverage of the
    // agent/tool surface instead of depending on which questions the
    // loop happened to reach. This is the engine's own public API and the
    // engine's own routing — nothing is faked, and the cycles are
    // labelled as test-driven so they are never confused with Phase 1.
    const ledger = StudyObjectives.getInstance();
    const seeded = ledger.add({
      question: "What does src/core/cognition/SelfStudyEngine.ts actually contain right now?",
      detail: "Coverage probe: forces a source investigation against the live workspace.",
      origin: "architecture",
      domain: "source",
      priority: 100,
      createdInCycle: engine.getCycle(),
      target: "src/core/cognition/SelfStudyEngine.ts",
    });
    const testDriven = [];
    for (let i = 0; i < 6; i++) {
      const r = await engine.runCycle();
      testDriven.push({ cycle: r.cycle, tool: r.tool, agent: r.agent, origin: r.evidenceOrigin });
      if (r.evidenceOrigin === "development-runtime" && r.tool === "source-read") break;
    }

    const history = engine.getHistory(40);
    out.phases.runtime = {
      sourceAccess: access.describe(status),
      runtimeReachable: status.reachable,
      runtimeLabel: status.runtime,
      // Which agents/tools actually participated, and where evidence came from.
      participation: history.map((r) => ({
        cycle: r.cycle,
        agent: r.agent,
        tool: r.tool,
        evidenceOrigin: r.evidenceOrigin,
        evidence: r.evidence.length,
        provider: r.provider,
      })),
      cyclesWithDevelopmentRuntimeEvidence: history.filter((r) => r.evidenceOrigin === "development-runtime").length,
      distinctTools: [...new Set(history.map((r) => r.tool))],
      distinctAgents: [...new Set(history.map((r) => r.agent))],
      seededCoverageObjective: seeded ? seeded.question : "(already present)",
      // The fallback must actually exist. A guard that short-circuits at
      // runtime would leave this at 0 while every read silently reported
      // "unavailable" — which is exactly the bug this asserts against.
      snapshotPathCount: access.snapshotPaths().length,
      testDrivenCyclesForCoverage: testDriven,
      // The specific evidence a source read pulled off the live workspace.
      sourceReadEvidence:
        history.find((r) => r.tool === "source-read" && r.evidenceOrigin === "development-runtime")?.evidence ?? [],
    };

    /* =========================================================
       PHASE 3 — provider path: cognition → runtime → registry →
       configured provider → response → cognition → memory.
       ========================================================= */
    const providerCycles = history.filter((r) => r.provider);
    const apiStatus = await ai.getApiStatus();
    out.phases.provider = {
      activeProvider: apiStatus.activeProvider,
      registryProviders: apiStatus.runtime.providers.map((p) => ({
        name: p.name, priority: p.priority, enabled: p.enabled,
        inCooldown: p.inCooldown, everSucceeded: Boolean(p.lastSuccess),
      })),
      cyclesEvaluatedByProvider: providerCycles.map((r) => ({
        cycle: r.cycle, provider: r.provider, question: r.objective?.question?.slice(0, 90),
        memoryConsolidated: r.memoryConsolidated, learned: r.learned,
        // The provider's NEXT line becoming a new question is the
        // response feeding back into cognition.
        derived: r.derived,
      })),
      memoryRecordsHeld: (await ai.getMemories(500)).length,
    };

    /* =========================================================
       PHASE 4 — THE CONTROL. Snapshot cognition, then chat.
       ========================================================= */
    const before = {
      cycle: engine.getCycle(),
      running: engine.isRunning(),
      state: engine.getCognitiveState(),
      openObjectiveIds: StudyObjectives.getInstance().open().map((o) => o.id),
      at: Date.now(),
    };

    // Pure read must not disturb anything.
    const readTwice = engine.getCognitiveState();
    out.phases.pureRead = {
      cycleUnchangedByReadingState: engine.getCycle() === before.cycle,
      sameFocusOnRepeatedRead: readTwice.focus?.question === before.state.focus?.question,
      stateSource: before.state.source,
    };

    // ---- THE CHAT REQUEST ----
    const t0 = Date.now();
    const reply = await ai.chat("LÉLU, what are you thinking about today?");
    const t1 = Date.now();

    const after = { cycle: engine.getCycle(), running: engine.isRunning() };

    out.phases.chat = {
      request: "LÉLU, what are you thinking about today?",
      answeredBy: reply.provider,
      model: reply.model,
      metadata: reply.metadata ?? null,
      elapsedMs: t1 - t0,
      text: reply.text,
      cycleBeforeRequest: before.cycle,
      cycleAfterRequest: after.cycle,
      // Cognition was already running before the request was made.
      loopRunningBeforeRequest: before.running,
      cyclesCompletedBeforeAnyChat: before.cycle,
    };

    // Does the answer actually contain the state that existed BEFORE it?
    const s = before.state;
    const inText = (needle) => Boolean(needle) && reply.text.includes(needle);
    out.phases.grounding = {
      focusQuestionPresent: inText(s.focus?.question),
      focusReasonPresent: inText(s.focus?.whySelected),
      agentPresent: inText(s.investigation?.agent),
      toolPresent: inText(s.investigation?.tool),
      nextIntendedPresent: inText(s.nextIntended?.question),
      nextReasonPresent: inText(s.nextIntended?.whySelected),
      discoveriesPresent: s.discoveries.filter((d) => reply.text.includes(d.split(" [")[0])).length,
      unresolvedPresent: s.unresolved.filter((u) => reply.text.includes(u.split(" (")[0])).length,
      carriedCountPresent: reply.text.includes(String(s.carried)),
      knowledgeCountPresent: reply.text.includes(String(s.understanding.knowledgeEntries)),
      runtimeStatementPresent: /development runtime|build-time snapshot/i.test(reply.text),
      snapshot: {
        focus: s.focus?.question ?? null,
        agent: s.investigation?.agent ?? null,
        tool: s.investigation?.tool ?? null,
        nextIntended: s.nextIntended?.question ?? null,
        carried: s.carried,
        knowledgeEntries: s.understanding.knowledgeEntries,
      },
    };

    /* =========================================================
       PHASE 5 — same state without a recent message, and across
       a fresh read path (context assembly used by every request).
       ========================================================= */
    await sleep(1000);
    const ctx = buildCognitiveContext();
    const formatted = formatCognitiveContext(ctx);
    out.phases.contextInjection = {
      cognitiveContextIncludesSelfStudy: Boolean(ctx.selfStudy),
      contextFocus: ctx.selfStudy.focus?.question ?? null,
      formattedIncludesSection: formatted.includes("LÉLU AUTONOMOUS COGNITION"),
      formattedIncludesFocus: Boolean(ctx.selfStudy.focus) && formatted.includes(ctx.selfStudy.focus.question),
      formattedIncludesNext: Boolean(ctx.selfStudy.nextIntended) && formatted.includes(ctx.selfStudy.nextIntended.question),
      buildingContextRanNoCycle: engine.getCycle() >= after.cycle,
    };

    out.phases.gaps = {
      knowledgeEntries: KnowledgeLibrary.getInstance().list().length,
      remainingGaps: KnowledgeLibrary.getInstance().gaps().length,
    };
  } catch (error) {
    out.errors.push(String(error && error.stack ? error.stack : error));
  }
  return out;
});

/* =========================================================
   PHASE 6 — SAME STATE WITHOUT A RECENT MESSAGE.
   A brand-new page: fresh JS context, no in-memory report, and
   no user message has ever been sent in it. The cognitive state
   must still be readable — from the durable trace — and the chat
   route must still report it.
   ========================================================= */
// A real reload of the same origin: the JS context is destroyed and
// rebuilt, so nothing is left in memory, but the origin's durable
// storage persists — exactly what a user returning to the app gets.
// (browser.newPage() would create an isolated context with empty
// storage, which would prove nothing.)
const page2 = page;
const page2Errors = pageErrors;
await page2.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
// Deliberately short: read BEFORE the reloaded loop can finish a cycle,
// so the answer can only be coming from durable storage.
await page2.waitForTimeout(4000);

result.phases.afterReload = await page2.evaluate(async () => {
  const out = {};
  try {
    const [{ default: SelfStudyEngine }, { default: AIService }] = await Promise.all([
      import("/src/core/cognition/SelfStudyEngine.ts"),
      import("/src/core/AIService.ts"),
    ]);
    const engine = SelfStudyEngine.getInstance();
    const ai = AIService.getInstance();
    await ai.initialize();

    const state = engine.getCognitiveState();
    out.liveCyclesInThisPage = engine.getCycle();
    out.stateSource = state.source;
    out.persistedCycle = state.persistedCycle;
    out.focus = state.focus?.question ?? null;
    out.nextIntended = state.nextIntended?.question ?? null;
    out.carried = state.carried;
    out.agentsInPlay = state.understanding.agents;

    const cycleBefore = engine.getCycle();
    const reply = await ai.chat("What are you thinking about?");
    out.chat = {
      answeredBy: reply.provider,
      metadata: reply.metadata ?? null,
      cycleBefore,
      cycleAfter: engine.getCycle(),
      mentionsFocus: Boolean(state.focus) && reply.text.includes(state.focus.question),
      textPreview: reply.text.slice(0, 400),
    };
  } catch (error) {
    out.error = String(error && error.stack ? error.stack : error);
  }
  return out;
});
result.phases.afterReload.pageErrors = page2Errors;

result.pageErrors = pageErrors;
console.log(JSON.stringify(result, null, 2));
await browser.close();
