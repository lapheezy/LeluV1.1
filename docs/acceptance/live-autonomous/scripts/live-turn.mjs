/**
 * MISSION 3 — ONE REAL TURN
 *
 * Summons the chat through the app's own control, types a real request, and
 * records what the live chain did: the brokered provider requests, the tool
 * calls, the transcript, and whatever the renderer mounted.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = process.argv[2] ?? "4318";
const PROMPT =
  process.argv[3] ??
  "Research the development of spatial computing interfaces and organize the most important findings into a visual workspace. Include the major concepts, important technical developments, and open questions.";
const OUT = "docs/acceptance/live-autonomous";
mkdirSync(`${OUT}/shots`, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const rec = { at: new Date().toISOString(), port: PORT, prompt: PROMPT, requests: [], errors: [], steps: [] };
const save = () => writeFileSync(`${OUT}/live-turn.json`, JSON.stringify(rec, null, 1));
page.on("pageerror", (e) => { rec.errors.push(String(e.message || e).slice(0, 240)); save(); });

const pending = [];
page.on("request", (request) => {
  if (request.method() !== "POST" || !request.url().includes("/api/model/")) return;
  let body = null;
  try { body = JSON.parse(request.postData() ?? "null"); } catch { body = null; }
  const tools = Array.isArray(body?.tools) ? body.tools.map((t) => t?.function?.name).filter(Boolean) : [];
  const entry = {
    at: Date.now(),
    provider: (request.url().match(/\/api\/model\/([^/]+)/) ?? [])[1] ?? null,
    model: body?.model ?? null,
    stream: Boolean(body?.stream),
    toolCount: tools.length,
    environmentTools: tools.filter((n) => String(n).startsWith("environment")),
    messages: Array.isArray(body?.messages) ? body.messages.length : null,
    promptChars: Array.isArray(body?.messages)
      ? body.messages.reduce((n, m) => n + String(m.content ?? "").length, 0)
      : null,
  };
  rec.requests.push(entry);
  pending.push(entry);
  save();
});
page.on("response", async (response) => {
  if (!response.url().includes("/api/model/")) return;
  const entry = pending.shift();
  if (!entry) return;
  entry.status = response.status();
  try {
    const text = await response.text();
    entry.bodyChars = text.length;
    entry.toolCalls = [...new Set([...text.matchAll(/"name"\s*:\s*"([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]))].slice(0, 14);
    entry.bodyHead = text.slice(0, 1500);
  } catch (error) {
    entry.readError = String(error).slice(0, 160);
  }
  save();
});

const dom = () =>
  page.evaluate(() => {
    const t = (el) => (el?.innerText || "").replace(/\s+/g, " ").trim();
    return {
      chatWindow: Boolean(document.querySelector("[data-lelu-chat-window]")),
      assistant: [...document.querySelectorAll('[aria-label="LÉLU said"], [aria-label="Lélu said"]')].map((e) => t(e).slice(0, 1500)),
      surfaces: [...document.querySelectorAll("[data-kind]")].map((el) => ({ kind: el.getAttribute("data-kind"), text: t(el).slice(0, 300) })),
      windows: [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => e.getAttribute("data-lelu-module-window")),
      activity: t(document.querySelector('[aria-label="What LÉLU is doing"], [aria-label="Chat activity timeline"]')).slice(0, 800),
      sending: document.querySelector("[data-lelu-sending]")?.getAttribute("data-lelu-sending") ?? null,
      body: t(document.body).slice(0, 600),
    };
  });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000);
await page.evaluate(() => {
  const g = document.querySelector("[data-lelu-signin-gate]");
  const b = g && [...g.querySelectorAll("button")].find((x) => /^Continue/.test((x.textContent || "").trim()));
  b?.click();
});
await page.waitForTimeout(2500);

/* Summon the chat with the app's own controls, longest wait last. */
for (const selector of [
  'button[aria-label="Summon the chat"]',
  'button[aria-label="What LÉLU is doing — open chat"]',
  'button[aria-label="Travel to Conversation"]',
]) {
  const el = await page.$(selector).catch(() => null);
  if (!el) { rec.steps.push({ selector, found: false }); continue; }
  await el.click({ timeout: 5000 }).catch(() => {});
  let opened = false;
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => Boolean(document.querySelector("[data-lelu-chat-window] textarea, [data-lelu-chat-window] input"))).catch(() => false);
    if (ready) { opened = true; break; }
    await page.waitForTimeout(500);
  }
  rec.steps.push({ selector, found: true, opened });
  if (opened) break;
}
rec.afterSummon = await dom();
save();

const composer = (await page.$("[data-lelu-chat-window] textarea")) ?? (await page.$("[data-lelu-chat-window] input[type=text]"));
if (!composer) {
  rec.result = "BLOCKED: chat never mounted a composer";
  try { await page.screenshot({ path: `${OUT}/shots/blocked.png` }); rec.screenshot = "shots/blocked.png"; } catch {}
  save();
  console.log(JSON.stringify({ result: rec.result, steps: rec.steps, errors: rec.errors }, null, 1));
  await ctx.close(); await browser.close(); process.exit(0);
}

const beforeRequests = rec.requests.length;
await composer.fill(PROMPT).catch(() => {});
await page.waitForTimeout(500);
const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((el) => (el.getAttribute("aria-label") || "") === "Send message" && !el.disabled);
  b?.click();
  return Boolean(b);
}).catch(() => false);
rec.sentVia = clicked ? "send button" : "enter key";
if (!clicked) await composer.press("Enter").catch(() => {});

const started = Date.now();
let sawBusy = false;
let last = "";
while (Date.now() - started < 210000) {
  const now = await page.evaluate(() => ({
    sending: document.querySelector("[data-lelu-sending]")?.getAttribute("data-lelu-sending") ?? null,
    stop: Boolean(document.querySelector("[data-lelu-stop-button]")),
    assistant: document.querySelectorAll('[aria-label="LÉLU said"], [aria-label="Lélu said"]').length,
    tail: (document.querySelector('[aria-label="LÉLU said"]')?.innerText ?? "").slice(-140),
  })).catch(() => null);
  if (!now) break;
  const busy = now.sending === "true" || now.stop;
  if (busy) sawBusy = true;
  const snap = `${now.assistant}|${now.tail}`;
  if (!busy && (sawBusy || now.assistant > 0) && snap === last) break;
  last = snap;
  await page.waitForTimeout(1500);
}
rec.turnMs = Date.now() - started;
await page.waitForTimeout(2500);
rec.afterTurn = await dom();
rec.turnRequests = rec.requests.slice(beforeRequests);
rec.reply = rec.afterTurn.assistant.at(-1) ?? "";
try { await page.screenshot({ path: `${OUT}/shots/turn.png` }); rec.screenshot = "shots/turn.png"; } catch {}
rec.result = rec.reply ? "REPLIED" : "NO REPLY TEXT";
save();
console.log(JSON.stringify({
  result: rec.result, turnMs: rec.turnMs, steps: rec.steps,
  requests: rec.turnRequests.map((r) => ({ provider: r.provider, model: r.model, status: r.status, tools: r.toolCount, env: r.environmentTools.length })),
  reply: rec.reply.slice(0, 400), surfaces: rec.afterTurn.surfaces.length, windows: rec.afterTurn.windows,
  errors: rec.errors.slice(0, 3),
}, null, 1));
await ctx.close();
await browser.close();
