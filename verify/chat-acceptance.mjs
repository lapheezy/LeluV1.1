/**
 * ACCEPTANCE TEST — conversation, memory, arbitration, orientation.
 *
 * Drives the REAL app in a real browser through the exact scenario in
 * the brief, then rotates the device repeatedly while the conversation
 * is live.
 *
 * TURN 1  user states a fact
 * TURN 2  LÉLU responds
 * TURN 3  user gives an instruction that depends on that fact
 * TURN 4  LÉLU must have retained it and advanced the action
 * TURN 5  user asks for the fact again — she must retrieve, not re-ask
 * plus    a correction that must supersede the stale fact
 * plus    a user message sent while autonomous cognition is running
 * plus    portrait/landscape phone + tablet + desktop rotation
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const LOG = process.env.STUB_LOG || "/tmp/provider-stub-calls.json";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const log = (m) => console.error(`[accept] ${m}`);

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);
log("app booted (portrait phone)");

/* ---------------------------------------------------------------
   PART A — multi-turn conversation through the real chat entry point
   --------------------------------------------------------------- */
const convo = await page.evaluate(async () => {
  const out = { turns: [], errors: [] };
  try {
    const [{ default: AIService }, { default: SelfStudyEngine }] = await Promise.all([
      import("/src/core/AIService.ts"),
      import("/src/core/cognition/SelfStudyEngine.ts"),
    ]);
    const ai = AIService.getInstance();
    await ai.initialize();
    const engine = SelfStudyEngine.getInstance();

    // Start clean so retention is genuinely demonstrated, not inherited.
    const { default: KvStore } = await import("/src/core/storage/KvStore.ts");
    try { KvStore.getInstance().remove("lelu.conversation.v1"); } catch { /* ignore */ }

    const say = async (text, label) => {
      const before = Date.now();
      const reply = await ai.chat(text);
      out.turns.push({ label, sent: text, provider: reply.provider, ms: Date.now() - before, reply: reply.text ?? "" });
      return reply;
    };

    await say("My studio is called Aurelia and I work exclusively in 18k rose gold.", "T1 information");
    await say("What metal do I work in?", "T2 recall check");
    await say("Create a project brief for a pendant collection in that metal.", "T3 instruction");
    await say("Actually, correct that: I work in platinum now, not rose gold.", "T4 correction");
    await say("What metal do I work in?", "T5 retrieval after correction");

    /* INTERRUPTION: autonomous cognition running, user speaks over it. */
    engine.start(1500);
    await new Promise((r) => setTimeout(r, 2500));
    const cycleBeforeInterrupt = engine.getCycle();
    const interruptReply = await ai.chat("Stop what you are doing and tell me my studio name.");
    const cycleAfterInterrupt = engine.getCycle();
    engine.stop();
    out.interrupt = {
      loopWasRunning: true,
      cycleBefore: cycleBeforeInterrupt,
      cycleAfter: cycleAfterInterrupt,
      reply: interruptReply.text ?? "",
      provider: interruptReply.provider,
      userTurnWasPrioritised: cycleAfterInterrupt - cycleBeforeInterrupt <= 1,
    };

    /* What the systems hold afterwards. */
    const brainConv = (await import("/src/core/AIService.ts")).default.getInstance();
    out.memory = (await brainConv.getMemories(200)).map((m) => ({ category: m.category, response: m.response.slice(0, 160) }));
    out.recallMetal = (await brainConv.recall("what metal do I work in")).map((r) => r.response.slice(0, 160));
    out.recallStudio = (await brainConv.recall("studio name Aurelia")).map((r) => r.response.slice(0, 160));

    const stored = KvStore.getInstance().get("lelu.conversation.v1");
    out.conversationStore = {
      turnCount: stored?.turns?.length ?? 0,
      roles: (stored?.turns ?? []).map((t) => t.role),
      persistedKey: "lelu.conversation.v1",
    };
  } catch (error) {
    out.errors.push(String(error && error.stack ? error.stack : error));
  }
  return out;
});
log(`conversation done (${convo.turns.length} turns)`);

/* ---------------------------------------------------------------
   PART B — orientation. Rotate repeatedly with the conversation live.
   --------------------------------------------------------------- */
const VIEWPORTS = [
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 },
  { name: "phone portrait (return)", width: 390, height: 844 },
  { name: "tablet portrait", width: 820, height: 1180 },
  { name: "tablet landscape", width: 1180, height: 820 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone portrait (final)", width: 390, height: 844 },
];

// Open the chat surface first: rotating with it closed would prove
// nothing about whether chat survives orientation.
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent("genesis-show-surface", { detail: { panel: "chat" } }));
});
await page.waitForTimeout(1200);
const chatOpened = await page.evaluate(() => Boolean(document.querySelector("textarea")));
log(`chat surface open before rotation: ${chatOpened}`);

const rotations = [];
for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(900);
  const snapshot = await page.evaluate(async () => {
    const [{ default: AIService }, { default: KvStore }, { default: SelfStudyEngine }] = await Promise.all([
      import("/src/core/AIService.ts"),
      import("/src/core/storage/KvStore.ts"),
      import("/src/core/cognition/SelfStudyEngine.ts"),
    ]);
    const stored = KvStore.getInstance().get("lelu.conversation.v1");
    const study = SelfStudyEngine.getInstance().getCognitiveState();
    return {
      conversationTurns: stored?.turns?.length ?? 0,
      lastUserTurn: [...(stored?.turns ?? [])].reverse().find((t) => t.role === "user")?.text?.slice(0, 60) ?? null,
      memoryRecords: (await AIService.getInstance().getMemories(200)).length,
      cognitionCycle: study.cycle,
      cognitionFocus: study.focus?.question?.slice(0, 60) ?? null,
      // Is the dock/menu still mounted and are chat controls reachable?
      domNodes: document.querySelectorAll("*").length,
      hasTextarea: Boolean(document.querySelector("textarea")),
      hasButtons: document.querySelectorAll("button").length,
    };
  });
  rotations.push({ viewport: vp.name, size: `${vp.width}x${vp.height}`, ...snapshot, errorsSoFar: pageErrors.length });
  log(`${vp.name}: turns=${snapshot.conversationTurns} mem=${snapshot.memoryRecords} buttons=${snapshot.hasButtons} textarea=${snapshot.hasTextarea}`);
}

let calls = [];
try { calls = JSON.parse(readFileSync(LOG, "utf8")); } catch { /* none */ }

console.log(JSON.stringify({
  conversation: convo.turns.map((t) => ({ label: t.label, sent: t.sent, provider: t.provider, reply: t.reply.slice(0, 320) })),
  interrupt: convo.interrupt,
  memory: convo.memory,
  recallMetal: convo.recallMetal,
  recallStudio: convo.recallStudio,
  conversationStore: convo.conversationStore,
  rotations,
  providerSawHistory: calls.slice(-8).map((c) => ({ roles: c.roles, sawCognitiveContext: c.sawCognitiveContext })),
  errors: convo.errors,
  pageErrors,
}, null, 2));

await browser.close();
