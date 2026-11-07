/**
 * Mission 10.3 — chat-driven creation through REAL user messages.
 *
 *   node scripts/verify-chat-creation.cjs <outDir>
 *
 * Every step is a message typed into the composer and sent with the Send
 * button (real mouse), answered by whatever provider is enabled. Nothing is
 * seeded and no tool is called directly. After each reply the script reads
 * what really exists:
 *   - the reply's activity (tools that ran, artifacts it names),
 *   - Creation Studio (StudioStore): kind, revisions, conversationId, chart blocks,
 *   - the workspace (WorkspaceEngine): diagram views ("drawings") and revisions.
 * Then the page is reloaded and the same artifacts are looked up again, to
 * see what survives (revision history, conversation link).
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const REPLY_TIMEOUT_MS = Number(process.env.LELU_REPLY_TIMEOUT_MS ?? 180_000);

const STEPS = [
  { id: "graph-create", text: "Make a bar chart titled \"Rainfall Q1\" in a short document: January 80 mm, February 65 mm, March 50 mm." },
  { id: "drawing-create", text: "Draw a diagram titled \"Water cycle\" with the nodes Evaporation, Condensation, Precipitation and Collection, connected in that order and back to Evaporation." },
  { id: "graph-revise", text: "Revise the Rainfall Q1 chart: make it a line chart and add April 40 mm." },
  { id: "drawing-revise", text: "Revise the Water cycle diagram: add a Runoff node between Precipitation and Collection." },
  { id: "retrieve", text: "What were the values in the Rainfall Q1 chart before you revised it? Look at its first revision." },
];

async function snapshot(page) {
  return page.evaluate(async () => {
    const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    const W = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const conv = M.getActive();
    const studio = S.list().map((a) => ({
      id: a.id, title: a.title, kind: a.kind, conversationId: a.conversationId ?? null,
      revisions: a.revisions.map((r) => {
        const spec = r.spec ?? {};
        const blocks = spec.blocks ?? [];
        const charts = blocks.filter((b) => b.type === "chart").map((b) => ({ kind: b.chart?.kind, labels: b.chart?.labels, series: b.chart?.series }));
        return { rev: r.rev, by: r.by, note: r.note, charts };
      }),
    }));
    const views = W.getState().views.filter((v) => v.kind === "diagram" || v.spec?.type === "diagram" || /diagram|flow/i.test(String(v.kind))).map((v) => ({
      id: v.id, title: v.title, kind: v.kind, revision: v.revision, source: v.source ?? null,
      nodes: (v.spec?.nodes ?? []).map((n) => n.label ?? n.id),
      edges: (v.spec?.edges ?? v.spec?.connections ?? []).length,
    }));
    return {
      conversationId: conv?.id ?? null,
      messages: (conv?.messages ?? []).map((m) => ({
        role: m.role, text: String(m.text ?? "").slice(0, 600),
        provider: m.provider ?? m.meta?.provider ?? null,
        artifacts: m.activity?.artifacts ?? [],
        tools: (m.activity?.steps ?? []).map((s) => s.tool ?? s.label ?? s.kind).filter(Boolean).slice(0, 12),
      })),
      studio, views,
    };
  });
}

async function send(page, text) {
  const ta = await page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-lelu-composer] textarea")].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, reachable: Boolean(hit && (hit === el || el.contains(hit))) };
  });
  if (!ta || !ta.reachable) return { sent: false, reason: ta ? "composer covered" : "no composer" };
  await page.mouse.click(ta.x, ta.y);
  await page.keyboard.type(text, { delay: 2 });
  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-lelu-composer] button[aria-label="Send message"]')].find((e) => e.getBoundingClientRect().width > 0);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!btn) return { sent: false, reason: "no send button" };
  await page.mouse.click(btn.x, btn.y);
  return { sent: true };
}

async function waitForReply(page, userCount) {
  const t0 = Date.now();
  while (Date.now() - t0 < REPLY_TIMEOUT_MS) {
    await page.waitForTimeout(2000);
    const state = await page.evaluate(async () => {
      const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      const msgs = M.getActive()?.messages ?? [];
      const last = msgs[msgs.length - 1];
      return { n: msgs.filter((m) => m.role === "user").length, lastRole: last?.role, status: last?.activity?.status ?? null, text: String(last?.text ?? "") };
    });
    if (state.n >= userCount && state.lastRole === "assistant" && state.text.trim() && state.status !== "running" && state.status !== "thinking") {
      return { ms: Date.now() - t0, ...state };
    }
  }
  return { ms: Date.now() - t0, timedOut: true };
}

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
  await page.waitForTimeout(2500);

  const steps = [];
  let users = 0;
  for (const step of STEPS) {
    const s = await send(page, step.text);
    users += s.sent ? 1 : 0;
    const reply = s.sent ? await waitForReply(page, users) : null;
    const snap = await snapshot(page);
    await page.screenshot({ path: path.join(outDir, `${step.id}.png`) });
    const last = snap.messages[snap.messages.length - 1];
    steps.push({ ...step, ...s, reply, replyText: last?.role === "assistant" ? last.text : null, replyArtifacts: last?.artifacts ?? [], studio: snap.studio, views: snap.views });
    console.log(JSON.stringify({ step: step.id, sent: s.sent, ms: reply?.ms, timedOut: reply?.timedOut ?? false, reply: (last?.text ?? "").slice(0, 160), artifacts: (last?.artifacts ?? []).map((a) => `${a.title} r${a.rev} ${a.action}`), studio: snap.studio.map((a) => `${a.title}:${a.revisions.length}rev`), views: snap.views.map((v) => `${v.title}:r${v.revision}`) }));
  }
  const before = await snapshot(page);

  // What survives a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click()).catch(() => {});
  await page.waitForTimeout(3000);
  const afterReload = await page.evaluate(async (convId) => {
    const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    const W = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const conv = M.list().find((c) => c.id === convId);
    return {
      conversationFound: Boolean(conv),
      messages: conv?.messages?.length ?? 0,
      cardsInConversation: (conv?.messages ?? []).flatMap((m) => m.activity?.artifacts ?? []).map((a) => ({ id: a.artifactId, rev: a.rev, title: a.title, action: a.action })),
      studio: S.list().map((a) => ({ id: a.id, title: a.title, revisions: a.revisions.length, conversationId: a.conversationId ?? null })),
      diagramViews: W.getState().views.filter((v) => v.kind === "diagram").map((v) => ({ id: v.id, title: v.title, revision: v.revision })),
    };
  }, before.conversationId);
  console.log(JSON.stringify({ afterReload }));
  await page.screenshot({ path: path.join(outDir, "after-reload.png") });

  fs.writeFileSync(path.join(outDir, "chat-creation.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, conversationId: before.conversationId, steps, final: before, afterReload, errors: errors.slice(0, 5) }, null, 1) + "\n");
  await browser.close();
}
run();
