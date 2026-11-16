import { chromium } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const [W, H, OUT, LABEL] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], process.argv[5] ?? "run"];
mkdirSync(OUT, { recursive: true });
const touch = W < 800;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
await page.addInitScript(() => {
  window.__gl = { contexts: 0, avatarContexts: 0, texMB: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !this.__counted) { this.__counted = true; window.__gl.contexts++; if (this.closest?.("[data-testid=lelu-companion-character]") || this.closest?.("[data-testid=lelu-companion]")) window.__gl.avatarContexts++; }
    return c;
  };
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) for (const fn of ["texImage2D", "texSubImage2D"]) { const o = P[fn]; P[fn] = function (...a) { const s = a.find((x) => x && typeof x === "object" && ("width" in x || "byteLength" in x)); window.__gl.texMB += (s?.byteLength ?? ((s?.width ?? 0) * (s?.height ?? 0) * 4)) / 1048576; return o.apply(this, a); }; }
  window.__canvasId = 0;
});
const sleep = (ms) => page.waitForTimeout(ms);
const rows = [];
async function snap(step) {
  const s = await Promise.race([page.evaluate(() => {
    const avatars = [...document.querySelectorAll("[data-testid=lelu-companion]")];
    const canvases = avatars.flatMap((a) => [...a.querySelectorAll("canvas")]);
    for (const c of canvases) if (!c.__pid) c.__pid = ++window.__canvasId;
    const r = avatars[0]?.getBoundingClientRect();
    return { presences: avatars.map((a) => a.dataset.presence), avatarCanvases: canvases.length, canvasIds: canvases.map((c) => c.__pid), contexts: window.__gl.contexts, avatarContexts: window.__gl.avatarContexts, texMB: Math.round(window.__gl.texMB), heap: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576), rect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null };
  }), new Promise((x) => setTimeout(() => x({ timeout: true }), 15000))]);
  rows.push({ step, ...s }); console.log(step.padEnd(28), JSON.stringify(s));
  await page.screenshot({ path: `${OUT}/${LABEL}-${W}x${H}-${String(rows.length).padStart(2, "0")}-${step.replace(/\W+/g, "-")}.png` });
}
const ready = async () => { for (let i = 0; i < 40; i++) { await sleep(1500); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null).catch(() => false)) return true; } return false; };
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await sleep(1500); if (await page.getByText("Continue without an account").count()) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
await ready(); await sleep(2000); await snap("home");
// Chat
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
await sleep(5000); await snap("chat");
await page.evaluate(() => { for (const b of document.querySelectorAll("button[aria-label^='Close'], button[aria-label='Home']")) { if (b.getBoundingClientRect().width) { b.click(); break; } } });
await sleep(3000);
// Studio library → a graph
await page.evaluate(() => [...document.querySelectorAll("*")].find((e) => e.textContent.trim() === "App Library" && e.children.length === 0)?.closest("button, a, [role=button], section")?.click());
await sleep(1500);
await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Docs, decks and spreadsheets")).at(-1)?.click());
await sleep(3000); await snap("studio-library");
await page.evaluate(() => document.querySelector("[data-lelu-studio-new=hierarchy]")?.click());
await sleep(6000); await snap("graph");
await page.evaluate(() => document.querySelector("[data-lelu-studio-new=drawing]")?.click());
await sleep(9000); await snap("drawing");
// Home again
await page.evaluate(() => { for (let i = 0; i < 6; i++) for (const b of document.querySelectorAll("[data-lelu-module-window] button[aria-label^='Close']")) b.click(); });
await sleep(2500);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Home" || b.textContent.trim() === "Home")?.click());
await ready(); await sleep(2000); await snap("home-again");
writeFileSync(`${OUT}/${LABEL}-${W}x${H}.json`, JSON.stringify({ rows, errors }, null, 1));
console.log("errors", JSON.stringify(errors.slice(0, 3)));
await browser.close();
