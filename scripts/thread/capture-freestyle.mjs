/** Renders the Freestyle thread variant (desktop, inside a world, phone): node scripts/thread/capture-freestyle.mjs */
import { mkdir } from "node:fs/promises";
import { launch } from "../evolution/harness.mjs";
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/freestyle";
await mkdir(OUT, { recursive: true });
const click = (p, s) => p.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), s);
async function boot(p) {
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); });
    if (await p.locator("[data-lelu-home]").count()) break;
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(1500);
}
async function open(p, title) {
  await p.evaluate(async (title) => {
    const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const T = await import("/src/core/thread/ThreadObjects.ts");
    const c = MC.create(title);
    const t0 = Date.now() - 60000;
    [["user", "Show me how my mind is built, and find the best explanations of neural networks."], ["assistant", "Here is V1 and V2 in 3D, V3 beside them, the research I found and the chapter that explains it best."], ["user", "Let it all flow, no windows."], ["assistant", "Done. Everything is free in the space now."], ...Array.from({ length: 8 }, (_, k) => [k % 2 ? "assistant" : "user", k % 2 ? `Point ${k}: the V2 map shows memory feeding cognition; the video explains weights and biases in the same terms.` : `And what about part ${k + 1}?`])].forEach(([role, text], i) => MC.addMessage(c.id, { id: `${c.id}-m${i}`, role, text, timestamp: t0 + i * 1000, source: "local" }));
    const s = (o) => T.summon({ conversationId: c.id, by: "lelu", ...o });
    s({ kind: "neural-map", title: "V2 · Cognitive architecture", map: { aspect: "v2", view: "connectome-tractography", dim: "3d", highlight: ["subsystem:memory"], selected: null } });
    s({ kind: "neural-map", title: "V1 · Knowledge", map: { aspect: "v1", view: "force-directed", dim: "2d", highlight: [], selected: null } });
    s({ kind: "youtube", title: "But what is a neural network?", video: { id: "aircAruvnKk", title: "But what is a neural network? | Deep learning chapter 1", channel: "3Blue1Brown" } });
    s({ kind: "neural-map", title: "V3 · Agent society", map: { aspect: "v3", view: "core-orbit", dim: "2d", highlight: [], selected: null } });
    s({ kind: "web", title: "Knowledge graph", web: { url: "https://en.wikipedia.org/wiki/Knowledge_graph", title: "Knowledge graph — Wikipedia", snippet: "A knowledge graph is a knowledge base that uses a graph-structured data model or topology to represent and operate on data." } });
  }, title);
  await p.waitForTimeout(500);
  await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await p.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
  await click(p, `button[aria-label="Open ${title}"]`);
  await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForSelector("[data-thread-stage]");
  await click(p, '[data-variant-tab="freestyle"]');
  await p.waitForTimeout(5000);
}
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await boot(p);
await p.evaluate(() => localStorage.removeItem("lelu.worlds.v1"));
await open(p, `Freestyle ${Date.now() % 1e5}`);
const info = await p.evaluate(() => { const s = document.querySelector("[data-thread-stage]"); const o = [...document.querySelectorAll("[data-thread-object]")]; const cs = (el) => getComputedStyle(el); return { base: s.dataset.base, objects: o.length, borders: o.map((e) => cs(e).boxShadow + "|" + cs(e).backgroundImage).filter((x) => x !== "none|none").length, overflowX: document.documentElement.scrollWidth - innerWidth }; });
console.log(JSON.stringify(info));
await p.screenshot({ path: `${OUT}/01-freestyle-desktop.png` });
const scroll = await p.evaluate(async () => {
  const sp = document.querySelector("[data-freestyle-scroll]"), chat = document.querySelector(".fs-chat"), web = document.querySelector('[data-thread-object][data-kind="web"] .to-web');
  const st = () => ({ space: sp.scrollTop, chat: chat.scrollTop, web: web?.scrollTop ?? null, stage: document.querySelector("[data-thread-stage]").scrollTop });
  const out = { sizes: { space: [sp.scrollHeight, sp.clientHeight], chat: [chat.scrollHeight, chat.clientHeight] } };
  sp.scrollTop = 400; await new Promise((r) => setTimeout(r, 700)); out.afterSpace = st();
  chat.scrollTop = 120; await new Promise((r) => setTimeout(r, 300)); out.afterChat = st();
  if (web) { web.scrollTop = 60; await new Promise((r) => setTimeout(r, 300)); out.afterWeb = st(); }
  return out;
});
console.log("scroll", JSON.stringify(scroll));
await p.screenshot({ path: `${OUT}/01b-freestyle-space-scrolled.png` });
await p.evaluate(() => { document.querySelector("[data-freestyle-scroll]").scrollTop = 0; });
await p.evaluate(async () => { const S = await import("/src/core/worlds/WorldStore.ts"); S.createWorld(["celestial"]); });
await p.waitForSelector("[data-world] canvas", { timeout: 60000 });
await p.waitForTimeout(5000);
await p.screenshot({ path: `${OUT}/02-freestyle-in-celestial-world.png` });
await p.evaluate(async () => { const S = await import("/src/core/worlds/WorldStore.ts"); S.createWorld(["aurora"]); });
await p.waitForTimeout(6000);
await p.screenshot({ path: `${OUT}/03-freestyle-in-aurora-world.png` });
await ctx.close();
const pc = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pp = await pc.newPage();
await boot(pp);
await pp.evaluate(() => localStorage.removeItem("lelu.worlds.v1"));
await open(pp, `Freestyle phone ${Date.now() % 1e5}`);
console.log(JSON.stringify(await pp.evaluate(() => ({ base: document.querySelector("[data-thread-stage]").dataset.base, overflowX: document.documentElement.scrollWidth - innerWidth }))));
await pp.screenshot({ path: `${OUT}/04-freestyle-phone-390.png` });
await b.close();
