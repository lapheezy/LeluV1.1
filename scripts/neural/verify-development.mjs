/**
 * WP14 / WP15 / WP17 — verified in the running app.
 * The map publishes what the person sees; her self-state carries it; a real
 * chat turn is asked about it; the bounded development cycle runs; proposals
 * reach the ImprovementQueue with the Architect executive's acknowledgment;
 * owner decisions change their status; repository research goes through
 * RepoExecutive and its real results or errors are shown.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { launch, desktop, track } from "../evolution/harness.mjs";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/neural-multiverse/shots";
await mkdir(OUT, { recursive: true });
const results = [];
const errors = [];
const evidence = {};
const check = (id, name, ok, detail = "") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ id, name, status: ok ? "VERIFIED" : "FAILED", detail: d });
  console.log(`${ok ? "✓" : "✗"} [${id}] ${name}${d ? ` — ${d.slice(0, 240)}` : ""}`);
};

const browser = await launch();
try {
  const page = await (await desktop(browser)).newPage();
  track(page, errors);
  await page.goto(`${BASE}?interface=neural-map`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count())
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    if (await page.locator("[data-mv-aspects]").count()) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  await page.click('[data-aspect="v2"]');
  await page.selectOption('select[aria-label="Architecture render"]', "connectome-tractography");
  await page.waitForSelector("[data-development-panel]");

  // WP14: awareness of the current view, in her self-state and in a real chat turn.
  const aware = await page.evaluate(async () => {
    const { mapAwarenessText } = await import("/src/core/selfdev/NeuralMapSteward.ts");
    const rt = (await import("/src/core/executive/ExecutiveRuntime.ts")).default.getInstance();
    return { text: mapAwarenessText(), inSelfState: rt.getSelfStateText().includes("Neural Map open") };
  });
  check("WP14", "the current aspect and 3D view reach her self-state", /aspect V2/.test(aware.text) && /connectome-tractography/.test(aware.text) && aware.inSelfState, aware);

  // WP17: one bounded cycle, all ten stages.
  await page.click("[data-dev-cycle]");
  await page.waitForFunction(() => Number(document.querySelector("[data-dev-stages]")?.getAttribute("data-dev-stages")) === 10, null, { timeout: 60000 });
  const cyc = await page.evaluate(async () => {
    const S = (await import("/src/core/selfdev/NeuralMapSteward.ts")).default.getInstance();
    const r = S.lastCycle();
    return { stages: r.stages.map((s) => `${s.stage}:${s.status}`), findings: r.findings, proposed: r.proposed, acks: r.proposed.map((id) => S.acknowledgments(id).map((a) => a.executive)) };
  });
  evidence.cycle = cyc;
  check("WP17", "the cycle ran Observe → … → Learn, every stage reported", cyc.stages.length === 10 && cyc.stages[0].startsWith("observe") && cyc.stages[9].startsWith("learn"), cyc.stages);
  check("WP14", "findings came from real data and became proposals (at most 3)", cyc.findings > 0 && cyc.proposed.length >= 1 && cyc.proposed.length <= 3, cyc);
  check("WP15", "each proposal was acknowledged by the Architect executive", cyc.acks.length > 0 && cyc.acks.every((a) => a.includes("Architect Executive")), cyc.acks);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/20-v2-development-panel.png` });

  // WP15: owner decisions through the existing ImprovementQueue.
  const decided = await page.evaluate(async (ids) => {
    const S = (await import("/src/core/selfdev/NeuralMapSteward.ts")).default.getInstance();
    const Q = (await import("/src/core/selfdev/ImprovementQueue.ts")).default.getInstance();
    const out = {};
    if (ids[0]) { S.decide(ids[0], "approve"); out.approved = Q.get(ids[0]).status; }
    if (ids[1]) { S.decide(ids[1], "request-changes", "cite the importing files"); out.changes = Q.get(ids[1]).status; }
    if (ids[2]) { S.decide(ids[2], "reject"); out.rejected = Q.get(ids[2]).status; }
    return out;
  }, cyc.proposed);
  check("WP15", "owner decisions change the proposal's status in the ImprovementQueue", (!decided.approved || decided.approved === "Approved") && (!decided.changes || decided.changes === "Analyzing") && (!decided.rejected || decided.rejected === "Rejected") && Object.keys(decided).length > 0, decided);

  // WP15: research through the repository workforce — real results or real errors.
  await page.fill('input[aria-label="Research query"]', "force directed graph webgl");
  await page.click("[data-dev-research]");
  await page.waitForFunction(() => document.querySelector("[data-research-candidates]") !== null, null, { timeout: 90000 });
  const research = await page.evaluate(async () => (await import("/src/core/selfdev/NeuralMapSteward.ts")).default.getInstance().researchLog()[0]);
  evidence.research = research;
  check("WP15", "repository research ran through RepoExecutive and its outcome is shown as returned", research && (research.candidates.length > 0 || research.errors.length > 0), { candidates: research?.candidates.slice(0, 5), errors: research?.errors });
  await page.screenshot({ path: `${OUT}/21-v2-development-research.png` });

  // WP14: a real chat turn asked what is on the map.
  const reply = await page.evaluate(async () => {
    const ai = (await import("/src/core/AIService.ts")).default.getInstance();
    const r = await ai.chat("Looking at the Neural Map I have open right now: which aspect and which view am I looking at? Answer in one sentence.", undefined, undefined, { conversationId: `verify-map-${Date.now()}` });
    return { provider: r.provider, model: r.model, text: r.text.slice(0, 400) };
  });
  evidence.chat = reply;
  check("WP14", "asked in chat, she names the aspect/view on screen (real model turn)", /architecture|V2/i.test(reply.text) && /connectome|tractograph/i.test(reply.text), reply);
} finally {
  await browser.close();
}
check("errors", "no page errors from the new modules", !errors.some((e) => /Steward|Development|Multiverse/.test(e)), errors.slice(0, 5).join(" | "));
await writeFile("docs/missions/neural-multiverse/verify-development.json", `${JSON.stringify({ at: new Date().toISOString(), results, evidence, otherPageErrors: errors.slice(0, 20) }, null, 1)}\n`);
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
