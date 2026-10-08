/**
 * FORENSIC PROBE — what the chat path actually does across turns.
 *
 * Runs the REAL app in a real browser and sends a real multi-turn
 * conversation through the real chat entry point, then reports:
 *   - what reached the provider each turn (roles, history, context)
 *   - what the conversation store holds
 *   - what long-term memory holds
 *   - whether the assistant's own turns are recorded at all
 *
 * Read-only diagnosis: it changes no application state beyond having a
 * conversation, which is the thing under test.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.VERIFY_BASE || "http://127.0.0.1:5173";
const LOG = process.env.STUB_LOG || "/tmp/provider-stub-calls.json";

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);

const TURNS = [
  "My studio is called Aurelia and I work in 18k rose gold.",
  "What metal do I work in?",
  "Create a project brief for a pendant collection in that metal.",
  "Actually, correct that: I work in platinum now, not rose gold.",
  "What metal do I work in?",
];

const result = await page.evaluate(async (turns) => {
  const out = { turns: [], errors: [] };
  try {
    const [{ default: AIService }, { default: SelfStudyEngine }] = await Promise.all([
      import("/src/core/AIService.ts"),
      import("/src/core/cognition/SelfStudyEngine.ts"),
    ]);
    const ai = AIService.getInstance();
    await ai.initialize();
    // Quiet autonomous cognition so this probe measures the chat path only.
    SelfStudyEngine.getInstance().stop();

    for (const text of turns) {
      const before = Date.now();
      const reply = await ai.chat(text);
      out.turns.push({
        sent: text,
        provider: reply.provider,
        ms: Date.now() - before,
        reply: (reply.text ?? "").slice(0, 300),
      });
    }

    // What the short-term conversation store holds after 5 turns.
    const brain = ai.__probeBrain ?? null;
    out.memoryRecords = (await ai.getMemories(200)).map((m) => ({
      category: m.category,
      prompt: m.prompt.slice(0, 90),
      response: m.response.slice(0, 120),
    }));
    out.recallRoseGold = (await ai.recall("what metal do I work in")).map((r) => r.response.slice(0, 140));
    out.brainExposed = Boolean(brain);
  } catch (error) {
    out.errors.push(String(error && error.stack ? error.stack : error));
  }
  return out;
}, TURNS);

let calls = [];
try { calls = JSON.parse(readFileSync(LOG, "utf8")); } catch { /* none */ }
const chatCalls = calls.slice(-TURNS.length);

console.log(JSON.stringify({
  turns: result.turns,
  memoryRecordCount: result.memoryRecords?.length ?? 0,
  memorySample: (result.memoryRecords ?? []).slice(0, 6),
  recallForMetalQuestion: result.recallRoseGold,
  providerViewPerTurn: chatCalls.map((c, i) => ({
    turn: i + 1,
    roles: c.roles,
    messageCount: c.messageCount,
    promptChars: c.promptChars,
    sawCognitiveContext: c.sawCognitiveContext,
    sawConversationHistory: c.sawConversationHistory,
    messages: c.messages,
  })),
  errors: result.errors,
  pageErrors,
}, null, 2));

await browser.close();
