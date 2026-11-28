/**
 * Neko inside the chat formats (not only the Browser window): a Thread with Google, ChatGPT and YouTube
 * objects, opened in several thread variants; each object's Neko button is pressed and the view captured.
 *   node scripts/capabilities/neko-in-chat.mjs
 * Launched WITHOUT the proxy and with mDNS hiding off: the app and Neko are on this machine, and WebRTC
 * to Neko only connects that way.
 */
import { chromium } from "playwright";
const OUT = "docs/missions/capabilities/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const click = (s) => p.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), s);
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(1500);
const title = `Neko in chat ${Date.now() % 1e5}`;
await p.evaluate(async (title) => {
  const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const T = await import("/src/core/thread/ThreadObjects.ts");
  const c = MC.create(title);
  const t0 = Date.now() - 60000;
  [["user", "Find oversized bomber sewing patterns on Google, open ChatGPT, and put the neural network video here."], ["assistant", "Here they are, live in the thread."]].forEach(([role, text], i) => MC.addMessage(c.id, { id: `${c.id}-m${i}`, role, text, timestamp: t0 + i * 1000, source: "local" }));
  const s = (o) => T.summon({ conversationId: c.id, by: "lelu", ...o });
  s({ kind: "web", title: "Google: oversized bomber sewing pattern", web: { url: "https://www.google.com/search?q=oversized+bomber+sewing+pattern", title: "Google: oversized bomber sewing pattern", snippet: "Search results" } });
  s({ kind: "web", title: "ChatGPT", web: { url: "https://chatgpt.com/", title: "ChatGPT", snippet: "ChatGPT start page" } });
  s({ kind: "youtube", title: "But what is a neural network?", video: { id: "aircAruvnKk", title: "But what is a neural network? | Deep learning chapter 1", channel: "3Blue1Brown" } });
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
const results = [];
// [variant, which object (0 Google, 1 ChatGPT, 2 YouTube)]
for (const [variant, idx] of (process.env.ONLY ? [[process.env.ONLY, Number(process.env.IDX ?? 0)]] : [["freestyle", 0], ["workspace", 1], ["split", 2], ["raindrop", 0], ["ribbon", 1], ["live", 0]])) {
  await click(`[data-variant-tab="${variant}"]`);
  await p.waitForTimeout(2500);
  // Close any live view left open, then open this one.
  await p.evaluate(() => document.querySelectorAll("[data-neko-toggle]").forEach((b) => /Close live|Back to embed/.test(b.textContent) && b.dispatchEvent(new MouseEvent("click", { bubbles: true }))));
  await p.waitForTimeout(500);
  const pressed = await p.evaluate((idx) => {
    const objs = [...document.querySelectorAll("[data-thread-object], [data-kind]")].filter((o) => o.querySelector("[data-neko-toggle]"));
    const o = objs.find((e) => e.textContent.includes(["Google", "ChatGPT", "neural network"][idx]));
    const btn = o?.querySelector("[data-neko-toggle]");
    o?.scrollIntoView({ block: "center" });
    btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return !!btn;
  }, idx);
  await p.waitForTimeout(15000);
  const r = await p.evaluate(() => { const n = document.querySelector(".neko-live"); if (n && !n.classList.contains("neko-live-large")) n.scrollIntoView({ block: "center" }); return n ? { surface: n.dataset.nekoSurface, nav: n.dataset.nekoNav, live: n.dataset.nekoLive, size: n.dataset.nekoSize, box: (({ width, height }) => [Math.round(width), Math.round(height)])(n.getBoundingClientRect()) } : null; });
  await p.waitForTimeout(800);
  results.push({ variant, pressed, ...r });
  await p.screenshot({ path: `${OUT}/neko-in-chat-${variant}.png` });
}
console.log(JSON.stringify({ results, errors: errors.slice(0, 5) }, null, 1));
await b.close();
