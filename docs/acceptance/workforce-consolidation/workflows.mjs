/**
 * Live workflows through the real chat UI on the production server.
 * Each prompt is typed into the composer; the newest assistant message and any
 * localStorage keys that changed are recorded. Verdicts are written by hand
 * in FULL_SYSTEM_TEST_REPORT.md from this raw record — not inferred here.
 *   node docs/acceptance/workforce-consolidation/workflows.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const OUT = "docs/acceptance/workforce-consolidation";
const browser = await chromium.launch({ ...(process.env.LELU_CHROMIUM ? { executablePath: process.env.LELU_CHROMIUM } : {}), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://127.0.0.1:4173/", { waitUntil: "load" });
await page.waitForTimeout(4000);
const chat = page.getByRole("button", { name: /^Chat$/ });
if (await chat.count()) { await chat.first().click(); await page.waitForTimeout(1500); }
const snapshot = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, (localStorage.getItem(k) || "").length])));
// The reply that follows `prompt` in the conversation that holds it (other
// conversations — e.g. her proactive self-study chat — are ignored).
const replyTo = (prompt) => page.evaluate((p) => {
  const ws = JSON.parse(localStorage.getItem("lelu.multichat.workspace.v1") || "{}");
  const convs = [];
  const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (Array.isArray(o.messages)) convs.push(o.messages); else Object.values(o).forEach(walk); } };
  walk(ws);
  for (const msgs of convs) {
    const i = msgs.map((m) => m.role === "user" && (m.text ?? m.content)).lastIndexOf(p);
    if (i >= 0) { const r = msgs.slice(i + 1).find((m) => m.role === "assistant"); return r ? (r.text ?? r.content ?? "") : ""; }
  }
  return null;
}, prompt);
const cosmosObjects = () => page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem("lelu.lelu.cosmos.objects.v1") || "{}"); const objs = s.objects ? Object.values(s.objects) : []; return objs.map((o) => ({ name: o.name, position: o.frame?.position, rotation: o.frame?.rotation, place: o.place })); } catch (e) { return String(e); } });
const ONLY = process.env.LELU_ONLY ? process.env.LELU_ONLY.split(",") : null;
const PROMPTS = [
  ["A-memory-write", "My favourite material is anodised titanium. Please remember that."],
  ["A-memory-recall", "What is my favourite material?"],
  ["D-build", "Build a gear train with 12 and 24 teeth."],
  ["D-cosmos", "Put it in the Cosmos."],
  ["D-move", "Rotate it 90 degrees."],
  ["F-workspace", "Tile my windows."],
  ["B-delegate", "Ask your research agent to list three facts about the Moon, then tell me what it found."],
  ["C-research", "Research the history of the Rosetta Stone and cite your sources."],
];
const results = [];
for (const [id, prompt] of PROMPTS.filter(([id]) => !ONLY || ONLY.includes(id))) {
  const before = await snapshot();
  const back = page.getByRole("button", { name: "Back to chat" });
  if (await back.count()) await back.first().click().catch(() => {});
  const box = page.locator("textarea:visible").first();
  const t0 = Date.now();
  await box.fill(prompt);
  await box.press("Enter");
  let reply = null;
  for (let i = 0; i < 150 && !reply; i += 1) {
    await page.waitForTimeout(1000);
    const r = await replyTo(prompt);
    if (r) {
      let last = r, stable = 0;
      for (let j = 0; j < 90 && stable < 4; j += 1) { await page.waitForTimeout(1000); const t = (await replyTo(prompt)) ?? ""; stable = t === last ? stable + 1 : 0; last = t; }
      reply = last;
    }
  }
  const after = await snapshot();
  const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
  const r = { id, prompt, seconds: Math.round((Date.now() - t0) / 100) / 10, reply: reply?.slice(0, 700) ?? null, storageKeysChanged: changed, cosmosObjects: await cosmosObjects() };
  results.push(r);
  console.log(JSON.stringify(r).slice(0, 600));
  await page.screenshot({ path: `${OUT}/screenshots/workflow-${id}.png` });
}
writeFileSync(`${OUT}/workflows.json`, JSON.stringify({ at: new Date().toISOString(), results, pageErrors: errors }, null, 2));
await browser.close();
