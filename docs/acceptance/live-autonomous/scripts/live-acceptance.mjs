/**
 * ==========================================================
 * MISSION 3 — LIVE AUTONOMOUS ACTIVATION DRIVER
 *
 * Everything here goes through the REAL application:
 *   - the page's own composer and send button (no engine calls)
 *   - the page's own /api/model broker (the server attaches the key)
 *   - the real provider, the real tool loop, the real renderer
 *
 * It records, per turn: the offered tool schemas, the provider's
 * response (tool calls included), the chat transcript, and the
 * surfaces the renderer actually mounted.
 *
 * Usage: node live-acceptance.mjs <port> [A,B,C,...]
 * ==========================================================
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const PORT = process.argv[2] ?? "4318";
const STAGES = (process.argv[3] ?? "A,B,C,D,E,F,G").split(",").filter(Boolean);
const OUT = "docs/acceptance/live-autonomous";
const SHOTS = `${OUT}/shots`;
mkdirSync(SHOTS, { recursive: true });

const PROMPTS = {
  A: "Research the development of spatial computing interfaces and organize the most important findings into a visual workspace. Include the major concepts, important technical developments, and open questions.",
  B: "Expand the existing workspace with a comparison of the most important approaches. Keep the original research and preserve the existing surface identities.",
  C: "Create a structured technical design document based on this workspace and present it in the environment.",
  D: "Reorganize this environment so the research, comparison, and technical document are easy to inspect together.",
  E: "Save the current environment so we can return to this exact workspace later.",
  E2: "Close the current environment.",
  E3: "Restore the environment we saved a moment ago.",
  F: "Now extend the technical document with an implementation roadmap, update the comparison, and preserve the original research as the foundation.",
  G: "What is the capital of Iceland?",
  G2: "Return to the research workspace we built earlier.",
};

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const rec = { at: new Date().toISOString(), port: PORT, stages: STAGES, turns: [], requests: [], errors: [] };
const save = () => writeFileSync(`${OUT}/live-acceptance.json`, JSON.stringify(rec, null, 1));
page.on("pageerror", (e) => { rec.errors.push(String(e.message || e).slice(0, 300)); save(); });

/* ---- capture every brokered model request/response, sanitised ---- */
let pending = [];
page.on("request", (request) => {
  if (request.method() !== "POST" || !request.url().includes("/api/model/")) return;
  let body = null;
  try { body = JSON.parse(request.postData() ?? "null"); } catch { body = null; }
  const toolNames = Array.isArray(body?.tools) ? body.tools.map((t) => t?.function?.name).filter(Boolean) : [];
  const entry = {
    at: Date.now(),
    path: request.url().replace(/^https?:\/\/[^/]+/, ""),
    provider: (request.url().match(/\/api\/model\/([^/]+)/) ?? [])[1] ?? null,
    model: body?.model ?? null,
    stream: Boolean(body?.stream),
    toolCount: toolNames.length,
    tools: toolNames,
    environmentTools: toolNames.filter((name) => String(name).startsWith("environment_")),
    messageCount: Array.isArray(body?.messages) ? body.messages.length : null,
    systemChars: Array.isArray(body?.messages)
      ? body.messages.filter((m) => m.role === "system").reduce((n, m) => n + String(m.content ?? "").length, 0)
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
    const calls = [...text.matchAll(/"name"\s*:\s*"([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]);
    entry.toolCallsSeen = [...new Set(calls)].filter((n) => !n.includes("/"));
    entry.bodyHead = text.slice(0, 2500);
  } catch (error) {
    entry.readError = String(error).slice(0, 200);
  }
  save();
});

/* ---- page state ---- */
const state = () =>
  page.evaluate(() => {
    const text = (el) => (el?.innerText || "").replace(/\s+/g, " ").trim();
    const assistant = [...document.querySelectorAll('[aria-label="LÉLU said"], [aria-label="Lélu said"]')].map((e) => text(e).slice(0, 1200));
    const user = [...document.querySelectorAll('[aria-label="You said"], [aria-label="You are saying"]')].map((e) => text(e).slice(0, 300));
    const surfaces = [...document.querySelectorAll("[data-kind]")].map((el) => ({
      kind: el.getAttribute("data-kind"),
      text: text(el).slice(0, 400),
    }));
    const windows = [...document.querySelectorAll("[data-lelu-module-window]")].map((el) => ({
      id: el.getAttribute("data-lelu-module-window"),
      content: [...el.querySelectorAll("[data-lelu-module-content]")].map((c) => c.getAttribute("data-lelu-module-content")),
    }));
    const activity = text(document.querySelector('[aria-label="What LÉLU is doing"], [aria-label="Chat activity timeline"]')).slice(0, 1200);
    const snapshots = (() => {
      try {
        const raw = localStorage.getItem("lelu.environment.snapshots") ?? localStorage.getItem("environment.snapshots");
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed) return { raw: null };
        const list = Array.isArray(parsed) ? parsed : parsed.value ?? [];
        return { count: list.length, ids: list.map((s) => s?.id ?? s?.name).slice(0, 6) };
      } catch { return { error: true }; }
    })();
    return {
      assistant, user, surfaces, windows, activity, snapshots,
      storageKeys: Object.keys(localStorage).sort(),
      sending: document.querySelector("[data-lelu-sending]")?.getAttribute("data-lelu-sending") ?? null,
    };
  });

const dismissGate = () =>
  page.evaluate(() => {
    const g = document.querySelector("[data-lelu-signin-gate]");
    const b = g && [...g.querySelectorAll("button")].find((x) => /^Continue/.test((x.textContent || "").trim()));
    b?.click();
  }).catch(() => {});

/** The chat window itself is the readiness signal, not a guessed input selector. */
const chatReady = () =>
  page
    .evaluate(() => {
      const win = document.querySelector("[data-lelu-chat-window]");
      const input = win?.querySelector("textarea, input[type=text]");
      return { window: Boolean(win), input: Boolean(input), label: input?.getAttribute("aria-label") ?? null };
    })
    .catch(() => ({ window: false, input: false, label: null }));

const openChat = async () => {
  if ((await chatReady()).input) return "already-open";
  const candidates = [
    'button[aria-label="What LÉLU is doing — open chat"]',
    'button[aria-label="Chat"]',
    'button[aria-label="Open chat"]',
    'button[aria-label="Conversation"]',
    '[data-spatial-control="chat"]',
    '[data-spatial-control="conversation"]',
  ];
  for (const selector of candidates) {
    const el = await page.$(selector).catch(() => null);
    if (!el) continue;
    await el.click({ timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 16; i++) {
      if ((await chatReady()).input) return selector;
      await page.waitForTimeout(500);
    }
  }
  return `not-found:${JSON.stringify(await chatReady())}`;
};

const waitIdle = async (budgetMs = 210000) => {
  const started = Date.now();
  let sawSending = false;
  let last = "";
  while (Date.now() - started < budgetMs) {
    const now = await page.evaluate(() => ({
      sending: document.querySelector("[data-lelu-sending]")?.getAttribute("data-lelu-sending") ?? null,
      stop: Boolean(document.querySelector("[data-lelu-stop-button]")),
      assistant: document.querySelectorAll('[aria-label="LÉLU said"], [aria-label="Lélu said"]').length,
      tail: (document.querySelector('[aria-label="LÉLU said"]:last-of-type')?.innerText ?? "").slice(-120),
    })).catch(() => null);
    if (!now) break;
    const busy = now.sending === "true" || now.stop;
    if (busy) sawSending = true;
    const snapshot = `${now.assistant}|${now.tail}`;
    if (!busy && (sawSending || now.assistant > 0) && snapshot === last) return { settled: true, sawSending };
    last = snapshot;
    await page.waitForTimeout(1500);
  }
  return { settled: false, sawSending };
};

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => rec.errors.push("GOTO"));
await page.waitForTimeout(6000);
await dismissGate();
await page.waitForTimeout(2500);
rec.chatOpened = await openChat();
await page.waitForTimeout(1500);
save();

const send = async (stage) => {
  const prompt = PROMPTS[stage];
  const turn = { stage, at: new Date().toISOString(), prompt, requests: [] };
  const composer = (await page.$("[data-lelu-chat-window] textarea")) ?? (await page.$("textarea[aria-label^=\"Message L\"]"));
  if (!composer) {
    turn.result = `BLOCKED: no composer (${JSON.stringify(await chatReady())})`;
    rec.turns.push(turn);
    save();
    return turn;
  }
  const beforeRequests = rec.requests.length;
  const beforeAssistant = (await state()).assistant.length;
  await composer.fill(prompt).catch(() => {});
  await page.waitForTimeout(400);
  const sent = await page
    .evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (el) => (el.getAttribute("aria-label") || "") === "Send message" && !el.disabled,
      );
      b?.click();
      return Boolean(b);
    })
    .catch(() => false);
  turn.sent = sent;
  if (!sent) {
    await composer.press("Enter").catch(() => {});
  }
  const idle = await waitIdle();
  await page.waitForTimeout(3000);
  turn.idle = idle;
  turn.requests = rec.requests.slice(beforeRequests).map((r) => ({
    provider: r.provider, model: r.model, stream: r.stream, status: r.status,
    toolCount: r.toolCount, environmentTools: r.environmentTools, toolCallsSeen: r.toolCallsSeen,
  }));
  const now = await state();
  turn.assistant = now.assistant.slice(beforeAssistant);
  turn.reply = (turn.assistant.at(-1) ?? "").slice(0, 1200);
  turn.surfaces = now.surfaces;
  turn.windows = now.windows;
  turn.activity = now.activity;
  turn.snapshots = now.snapshots;
  turn.sending = now.sending;
  try {
    await page.screenshot({ path: `${SHOTS}/${stage}.png` });
    turn.screenshot = `${SHOTS}/${stage}.png`;
  } catch (error) {
    turn.shotError = String(error).slice(0, 120);
  }
  rec.turns.push(turn);
  save();
  return turn;
};

for (const stage of STAGES) {
  if (!PROMPTS[stage]) continue;
  rec.current = stage;
  save();
  await send(stage);
}
rec.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify(rec.turns.map((t) => ({
  stage: t.stage, sent: t.sent, idle: t.idle, reply: (t.reply ?? "").slice(0, 220),
  envRequests: t.requests?.filter((r) => (r.environmentTools ?? []).length).length ?? 0,
  surfaces: t.surfaces?.length ?? 0, toolCalls: t.requests?.flatMap((r) => r.toolCallsSeen ?? []).slice(0, 8),
})), null, 1));
await ctx.close();
await browser.close();
