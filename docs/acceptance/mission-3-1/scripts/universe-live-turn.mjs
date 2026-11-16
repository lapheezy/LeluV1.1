/**
 * GATE D · one genuine turn through the Chat Universe composer.
 * Captures every provider request the app makes, every tool name the model
 * asks for, and what the surface finally shows. No staging: the prompt is
 * typed into the real composer and the answer is whatever the chain returns.
 * argv: <promptFile> <tag>  env: TIMEOUT_MS
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
const OUT = "docs/acceptance/mission-3-1";
const promptText = readFileSync(process.argv[2], "utf8");
const tag = process.argv[3] ?? "turn";
const budget = Number(process.env.TIMEOUT_MS ?? 180000);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleLines = [], pageErrors = [], modelRequests = [], modelResponses = [];
page.on("console", (m) => { const t = m.text(); if (t.length > 2) consoleLines.push(`${m.type()}:${t}`.slice(0, 400)); });
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
page.on("request", (r) => { const u = r.url(); if (u.includes("/api/model/")) modelRequests.push({ at: Date.now(), url: u.replace("http://127.0.0.1:4318", ""), method: r.method(), bytes: (r.postData() ?? "").length }); });
page.on("response", async (r) => { const u = r.url(); if (u.includes("/api/model/")) modelResponses.push({ at: Date.now(), status: r.status(), path: u.replace("http://127.0.0.1:4318", "") }); });
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
for (let i = 0; i < 60; i++) {
  const ok = await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); return g ? [...g.querySelectorAll("button")].some((b) => /without an account/i.test(b.textContent ?? "")) : false; });
  if (ok) break; await page.waitForTimeout(400);
}
await page.evaluate(() => { const g = document.querySelector("[data-lelu-signin-gate]"); [...(g?.querySelectorAll("button") ?? [])].find((b) => /without an account/i.test(b.textContent ?? ""))?.click(); });
await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 20000 }).catch(() => {});
await page.waitForSelector("[data-lelu-home]", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1200);
const nav = await page.evaluate(() => { const el = document.querySelector('[data-spatial-control="chat"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
if (!nav) throw new Error("chat control absent");
await page.mouse.click(nav.x, nav.y);
await page.waitForSelector('[role="dialog"][aria-label="Chat Universe"]', { state: "visible", timeout: 20000 });
await page.waitForTimeout(1200);
const composer = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); return ta ? { disabled: ta.disabled, placeholder: ta.placeholder, target: document.querySelector(".lcu-target")?.textContent ?? null } : null; });
if (!composer || composer.disabled) { writeFileSync(`${OUT}/${tag}.json`, JSON.stringify({ at: new Date().toISOString(), blocked: "composer-disabled", composer }, null, 1)); await browser.close(); process.exit(0); }
const box = await page.evaluate(() => { const ta = document.querySelector(".lcu textarea"); const r = ta.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.click(box.x, box.y);
await page.keyboard.type(promptText, { delay: 2 });
const typedLen = await page.locator(".lcu textarea").first().inputValue();
await page.keyboard.press("Enter");
const sentAt = Date.now();
let last = "", stableFor = 0;
const samples = [];
while (Date.now() - sentAt < budget) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => {
    const win = document.querySelector("[data-lelu-chat-window]");
    const msgs = [...document.querySelectorAll(".lelu-cc-msg")].map((m) => (m.textContent ?? "").trim()).filter(Boolean);
    return { chatWindow: Boolean(win), msgs: msgs.length, last: (msgs.at(-1) ?? "").slice(0, 400), textareas: document.querySelectorAll("textarea").length, sending: win?.getAttribute("data-lelu-sending") ?? null };
  }).catch(() => null);
  if (s) { samples.push({ t: Date.now() - sentAt, ...s }); const sig = JSON.stringify({ m: s.msgs, l: s.last.length, sending: s.sending, w: s.chatWindow }); if (sig === last) stableFor += 1; else { stableFor = 0; last = sig; } if (stableFor >= 6) break; }
}
const finalDom = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll(".lelu-cc-msg")].map((m) => (m.textContent ?? "").trim());
  const surfaces = [...document.querySelectorAll("[data-lelu-surface]")].map((e) => e.getAttribute("data-lelu-surface"));
  const modules = [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => e.getAttribute("data-lelu-module-window") || e.id).slice(0, 12);
  return { messages: msgs.slice(-4).map((m) => m.slice(0, 600)), chatWindow: Boolean(document.querySelector("[data-lelu-chat-window]")), surfaces: [...new Set(surfaces)], modules, sending: document.querySelector("[data-lelu-chat-window]")?.getAttribute("data-lelu-sending") ?? null, bodyTail: (document.body.innerText ?? "").slice(-700) };
}).catch((e) => ({ evalError: String(e).slice(0, 200) }));
await page.screenshot({ path: `${OUT}/shots/live-${tag}.png`, timeout: 10000 }).catch(() => {});
const result = { tag, at: new Date().toISOString(), prompt: promptText, composer, typedChars: typedLen.length, sentAt, elapsedMs: Date.now() - sentAt, modelRequests, modelResponses, toolMentions: consoleLines.filter((l) => /tool|environment|fallback|Trying |provider/i.test(l)).slice(-60), consoleTail: consoleLines.slice(-25), samples: samples.map((s) => ({ t: s.t, chatWindow: s.chatWindow, msgs: s.msgs, sending: s.sending, lastLen: s.last.length })), finalDom, pageErrors: pageErrors.slice(0, 6) };
writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(result, null, 1));
await browser.close().catch(() => {});
console.log(JSON.stringify({ tag, elapsedMs: result.elapsedMs, modelRequests: modelRequests.length, statuses: modelResponses.map((r) => r.status), msgs: samples.at(-1)?.msgs, chatWindow: finalDom.chatWindow, tail: finalDom.messages?.at(-1)?.slice(0, 200) }, null, 1));
