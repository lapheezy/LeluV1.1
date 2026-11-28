/**
 * Asks LÉLU in the chat itself ("<message>"), the way the owner would, and captures the Diagnostics surface
 * she opens beside the chat. Usage: node scripts/diagnostics/chat-run.mjs "Validate Freestyle, including chat"
 * (Based on freestyle-chat.mjs.) Runs her in-app diagnostics (src/core/diagnostics) in the live app, on a real conversation in Freestyle,
 * then reloads and re-measures persistence (the one thing an in-page run cannot do to itself).
 *   node scripts/diagnostics/freestyle-chat.mjs [suite]   (default: full)
 * Launched without the proxy so Neko's WebRTC connects.
 */
import { chromium } from "playwright";
const MESSAGE = process.argv[2] ?? "Validate Freestyle, including chat";
const OUT = "docs/missions/unify/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
const PHONE = process.env.PHONE === "1";
// PHONE=1: emulated iPhone viewport with touch (coarse pointer). Emulated, NOT a physical device.
const p = await (await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; emulated) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" } : { viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const click = (s) => p.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), s);
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(1500);
const title = `Diagnostics ${Date.now() % 1e5}`;
const cid = await p.evaluate(async (title) => {
  const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const T = await import("/src/core/thread/ThreadObjects.ts");
  const c = MC.create(title);
  const t0 = Date.now() - 60000;
  [["user", "Show me the map, the bomber patterns and the video."], ["assistant", "Here they are."], ...Array.from({ length: 10 }, (_, k) => [k % 2 ? "assistant" : "user", `Line ${k}: the V2 map shows memory feeding cognition, and the pattern search sits beside it.`])].forEach(([role, text], i) => MC.addMessage(c.id, { id: `${c.id}-m${i}`, role, text, timestamp: t0 + i * 1000, source: "local" }));
  const s = (o) => T.summon({ conversationId: c.id, by: "lelu", ...o });
  s({ kind: "neural-map", title: "V2 · Cognitive architecture", map: { aspect: "v2", view: "force-directed", dim: "2d", highlight: [], selected: null } });
  s({ kind: "web", title: "Google: oversized bomber sewing pattern", web: { url: "https://www.google.com/search?q=oversized+bomber+sewing+pattern", title: "Google: oversized bomber sewing pattern", snippet: "Search results" } });
  s({ kind: "youtube", title: "But what is a neural network?", video: { id: "aircAruvnKk", title: "But what is a neural network? | Deep learning chapter 1", channel: "3Blue1Brown" } });
  return c.id;
}, title);
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
await click(`button[aria-label="Open ${title}"]`);
await p.waitForTimeout(900);
for (let i = 0; i < 20 && !(await p.locator("[data-thread-stage]").count()); i++) {
  await p.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(1500);
}
await p.waitForSelector("[data-thread-stage]");
await click('[data-variant-tab="freestyle"]');
await p.waitForTimeout(4000);
// Type and send through the real composer.
const box = p.locator('[data-lelu-universe-window] textarea[aria-label^="Message"]').first();
await box.click();
await box.fill(MESSAGE);
await p.locator("button.lcu-send").first().click();
const t0 = Date.now();
if (process.env.WAIT) {
  // A turn that is not a diagnostic run: wait for the given element, capture, report, stop.
  await p.waitForFunction((sel) => !!document.querySelector(sel), process.env.WAIT, { timeout: 60000 });
  await p.waitForTimeout(3000);
  const info = await p.evaluate((sel) => { const el = document.querySelector(sel); const o = el.closest("[data-thread-object]") ?? el; o.scrollIntoView({ block: "center", behavior: "instant" }); return { title: o.querySelector(".to-title")?.textContent, highlighted: [...document.querySelectorAll("[data-highlighted='true'], .tm-node[data-hl='true']")].length }; }, process.env.WAIT);
  const T = await p.evaluate(() => import("/src/core/thread/ThreadObjects.ts").then((T) => T.objectsFor(null).length));
  const maps = await p.evaluate(async () => { const T = await import("/src/core/thread/ThreadObjects.ts"); const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); return T.objectsFor(MC.getActiveId()).filter((o) => o.kind === "neural-map").map((o) => ({ title: o.title, highlight: o.map.highlight })); });
  console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), ...info, maps }, null, 1));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${process.env.SHOT ?? "chat-turn"}${PHONE ? "-phone" : ""}.png` });
  await b.close();
  process.exit(0);
}
await p.waitForFunction(() => !!document.querySelector("[data-diagnostics-run]"), null, { timeout: 60000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/chat-diag-01-streaming${PHONE ? "-phone" : ""}.png` });
await p.waitForFunction(() => document.querySelector("[data-diagnostics-run]")?.getAttribute("data-run-status") === "done", null, { timeout: 180000 });
await p.waitForTimeout(2500);
const out = await p.evaluate(() => {
  const d = document.querySelector("[data-diagnostics-run]");
  const o = d.closest("[data-thread-object]");
  o?.scrollIntoView({ block: "center", behavior: "instant" });
  const msgs = [...document.querySelectorAll(".lcu-msg[data-role=assistant]")].map((m) => m.textContent.trim()).slice(-1);
  return { run: d.dataset.diagnosticsRun, counts: [...d.querySelectorAll(".dg-counts .dg-chip")].map((c) => c.textContent.trim()), groups: [...d.querySelectorAll(".dg-group")].map((g) => g.textContent.trim()), reply: msgs[0]?.slice(0, 400) };
});
console.log(JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), ...out }, null, 1));
await p.waitForTimeout(800);
await p.screenshot({ path: `${OUT}/chat-diag-02-done${PHONE ? "-phone" : ""}.png` });
if (process.env.RERUN) {
  await p.evaluate(() => document.querySelector("[data-diagnostics-rerun]").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForFunction(() => document.querySelector("[data-diagnostics-compare]") && document.querySelector("[data-diagnostics-run]")?.getAttribute("data-run-status") === "done", null, { timeout: 180000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector("[data-diagnostics-run]").closest("[data-thread-object]")?.scrollIntoView({ block: "center", behavior: "instant" }));
  console.log("compare:", await p.evaluate(() => document.querySelector("[data-diagnostics-compare]")?.textContent.trim()));
  await p.screenshot({ path: `${OUT}/chat-diag-03-rerun${PHONE ? "-phone" : ""}.png` });
}
console.log("page errors:", errors.slice(0, 3));
await b.close();
