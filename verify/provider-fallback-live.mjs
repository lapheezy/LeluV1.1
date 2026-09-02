/**
 * TEST 6 — live provider fallback inside the EXISTING registry.
 *
 * Injects a failing provider at the front of the real priority chain,
 * then drives ONE cognitive cycle and shows that the same cognitive
 * operation continued on the next authorized provider and returned its
 * result to cognition.
 *
 * The self-scheduled loop is paused first: cycles never overlap, so a
 * driven cycle would otherwise hit the no-overlap guard and hand back
 * the previous report.
 */
import { chromium } from "playwright";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);

const out = await page.evaluate(async () => {
  const [{ default: SelfStudyEngine }, { default: AIService }] = await Promise.all([
    import("/src/core/cognition/SelfStudyEngine.ts"),
    import("/src/core/AIService.ts"),
  ]);
  const engine = SelfStudyEngine.getInstance();
  const ai = AIService.getInstance();
  await ai.initialize();
  const registry = ai.getAIProviderRegistry();

  // Let at least one normal cycle happen so cognition has real state.
  for (let i = 0; i < 90 && engine.getCycle() < 1; i++) await new Promise((r) => setTimeout(r, 1000));

  engine.stop();
  for (let i = 0; i < 180 && engine.isBusy(); i++) await new Promise((r) => setTimeout(r, 500));

  const order = registry.all().map((p) => `${p.name}(${p.priority})`);
  const attempts = [];

  // Fault injection through the registry's own register(), implementing
  // the existing AIProvider interface. Priority -1 puts it FIRST in the
  // real chain, so cognition must hit it before anything that works.
  registry.register({
    name: "FaultInjected", priority: -1, enabled: true, timeout: 5000,
    requiresApiKey: false, capabilities: ["chat"],
    async initialize() {}, async isAvailable() { return true; },
    async health() { return { available: true, initialized: true, lastChecked: Date.now() }; },
    canHandle() { return true; },
    async generate(request) {
      attempts.push({ at: Date.now(), promptChars: request.prompt.length });
      throw new Error("simulated provider outage");
    },
  });

  const cycleBefore = engine.getCycle();
  const stateBefore = engine.getCognitiveState();
  const report = await engine.runCycle();

  const failure = registry.failure("FaultInjected");
  const result = {
    chainOrderBeforeInjection: order,
    chainOrderAfterInjection: registry.all().map((p) => `${p.name}(${p.priority})`),
    faultProviderTriedFirst: attempts.length > 0,
    faultPromptChars: attempts[0]?.promptChars ?? 0,
    faultRecordedInRegistry: Boolean(failure),
    faultReason: failure?.reason ?? null,
    faultInCooldown: registry.isInCooldown("FaultInjected"),
    // The SAME cognitive operation — same cycle, same question — finished.
    cycleBefore,
    cycleAfter: engine.getCycle(),
    cycleAdvancedByExactlyOne: engine.getCycle() === cycleBefore + 1,
    question: report.objective?.question ?? null,
    providerThatAnswered: report.provider,
    activeProviderAfter: registry.getActiveProvider(),
    evidenceCount: report.evidence.length,
    evidenceOrigin: report.evidenceOrigin,
    learned: report.learned,
    memoryRetrieved: report.memoryRetrieved,
    memoryConsolidated: report.memoryConsolidated,
    derived: report.derived,
    // Cognitive state was preserved across the failure, not reset.
    stateCarriedAcrossFailure: {
      carriedBefore: stateBefore.carried,
      carriedAfter: engine.getCognitiveState().carried,
      cyclePreserved: engine.getCognitiveState().cycle === cycleBefore + 1,
    },
    cognitionContinued: engine.getCycle() === cycleBefore + 1 && Boolean(report.objective),
  };

  engine.start(2500);
  result.loopResumed = engine.isRunning();
  return result;
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
