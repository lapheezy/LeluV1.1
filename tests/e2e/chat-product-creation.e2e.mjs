/**
 * ==========================================================
 * LÉLU — PRODUCT CREATION THROUGH CHAT, ON A PHONE (live)
 *
 *   LELU_CHROMIUM_PATH=… node tests/e2e/chat-product-creation.e2e.mjs <base-url> <out-dir>
 *
 * Needs a server with a working model provider (Fireworks), so it is a
 * LIVE run, not part of CI. iPhone 13 viewport. Steps:
 *   1. request a product in a conversation (Universe → New chat);
 *   2. wait for LÉLU to create it with the Creation Studio tools;
 *   3. the artifact card appears INSIDE that conversation; open it;
 *   4. ask for a change; the artifact gets a new revision with the change;
 *   5. reload: the artifact, its revisions and the conversation survive;
 *   6. the other conversation (Engineering) shows no trace of it.
 * Every check is measured in the page; every step leaves a screenshot.
 * ==========================================================
 */

import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const LAUNCH = process.env.LELU_CHROMIUM_PATH ? { executablePath: process.env.LELU_CHROMIUM_PATH } : {};
const BASE = process.argv[2] ?? "http://127.0.0.1:5178";
const OUT = path.resolve(process.argv[3] ?? "product-creation-e2e");
mkdirSync(OUT, { recursive: true });
const checks = [];
const log = [];
const record = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const REQUEST = "Create a product brief document for a new solar camping lantern called Lumo. Include a title, a short product description, three key features as bullet points, and a column chart of weight in grams for three versions: Lite 180, Standard 240, Pro 320. Export it as DOCX.";
const REFINE = "Change the chart in the Lumo brief to a line chart and add a fourth version, Max, at 400 grams. Export the new revision as DOCX.";

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
page.on("pageerror", (e) => log.push(`pageerror ${e.message.slice(0, 200)}`));
page.on("response", (r) => { if (r.url().includes("/api/model/") && !r.url().includes("status")) log.push(`model ${r.status()}`); });
const shot = (folder, name) => { mkdirSync(path.join(OUT, folder), { recursive: true }); return page.screenshot({ path: path.join(OUT, folder, `iphone-13-390x844-${name}.png`) }); };
const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r("timeout"), ms))]);
const studio = () => within(page.evaluate(async () => {
  const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
  return S.list().filter((a) => /lumo/i.test(a.title)).map((a) => {
    const last = a.revisions[a.revisions.length - 1].spec;
    const charts = last.kind === "document" ? last.blocks.filter((b) => b.type === "chart").map((b) => ({ kind: b.chart.kind, labels: b.chart.labels })) : [];
    const texts = (spec) => spec.kind === "document" ? spec.blocks.filter((b) => b.type !== "chart" && b.type !== "image").map((b) => b.text ?? (b.items ?? b.columns ?? []).join(" | ")) : [];
    const first = texts(a.revisions[0].spec), lastTexts = texts(last);
    const lost = first.filter((t) => !lastTexts.includes(t)).map((t) => t.slice(0, 60));
    return { id: a.id, title: a.title, revs: a.revisions.length, conversationId: a.conversationId ?? null, charts, lost, exports: a.exports.map((e) => ({ rev: e.rev, f: e.filename, ok: e.ok })) };
  });
}), 20000);
const sendIn = async (text) => {
  const ta = page.locator("[data-lelu-fullscreen] textarea");
  await ta.fill(text);
  await ta.press("Enter");
};
const waitFor = async (pred, seconds, label) => {
  for (let i = 0; i < seconds / 5; i += 1) {
    await page.waitForTimeout(5000);
    const s = await studio();
    if (typeof s === "object" && pred(s)) return s;
    if (i % 6 === 0) console.log(`… ${label} t+${(i + 1) * 5}s ${JSON.stringify(s).slice(0, 160)}`);
  }
  return studio();
};

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i += 1) { await page.waitForTimeout(1500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
  await page.waitForTimeout(2500);
  const conversationId = await page.evaluate(() => document.querySelector("[data-lelu-fullscreen]")?.getAttribute("data-lelu-module-window")?.replace(/^chat:/, "") ?? null);
  record("the product conversation is open full-screen", Boolean(conversationId), conversationId ?? "");

  // 1–2. The request, and LÉLU creating the product.
  await sendIn(REQUEST);
  await page.waitForTimeout(4000);
  await shot("12-product-creation", "01-request-sent");
  await page.waitForTimeout(8000);
  await shot("12-product-creation", "02-creation-in-progress");
  const created = await waitFor((s) => s.some((a) => a.exports.some((e) => e.ok)), 300, "creation");
  const art = Array.isArray(created) ? created[0] : null;
  record("LÉLU created a real artifact with the Studio", Boolean(art), JSON.stringify(art)?.slice(0, 300));
  record("the artifact belongs to the requesting conversation", art && art.conversationId === conversationId, `${art?.conversationId} vs ${conversationId}`);
  record("its DOCX was written and verified from its bytes", art && art.exports.some((e) => e.f.endsWith(".docx") && e.ok));
  record("the chart is the requested column chart with three versions", art && art.charts[0]?.kind === "column" && art.charts[0]?.labels.length === 3, JSON.stringify(art?.charts));
  for (let i = 0; i < 24; i += 1) { if (!(await page.evaluate(() => document.querySelector("[data-lelu-universe-typing]") !== null))) break; await page.waitForTimeout(5000); }
  await page.waitForTimeout(2000);

  // 3. The card in the conversation, then the artifact itself.
  const card = await page.evaluate(() => { const c = document.querySelector("[data-lelu-fullscreen] [data-lelu-chat-artifact]"); c?.scrollIntoView(); return c ? c.innerText.replace(/\s+/g, " ").slice(0, 200) : null; });
  await page.waitForTimeout(600);
  await shot("13-artifact-rendering", "01-card-in-conversation");
  record("the artifact card is shown inside the conversation", Boolean(card), card ?? "");
  await page.evaluate(() => [...document.querySelectorAll("[data-lelu-fullscreen] [data-lelu-chat-artifact] button")].find((b) => /Open/.test(b.textContent))?.click());
  await page.waitForTimeout(3000);
  const win = await page.evaluate(() => { const w = document.querySelector("[data-lelu-studio-artifact]"); return w ? { fullscreen: Boolean(w.closest("[data-lelu-fullscreen]")), text: w.innerText.slice(0, 200) } : null; });
  await shot("13-artifact-rendering", "02-artifact-window");
  record("opening the card shows the rendered artifact", Boolean(win), JSON.stringify(win));
  record("on the phone the artifact fills the screen", win?.fullscreen);
  // Back to the conversation.
  await page.evaluate(() => { const w = document.querySelector("[data-lelu-studio-artifact]")?.closest("[data-lelu-module-window]"); [...(w?.querySelectorAll("button") ?? [])].find((b) => /^Close /.test(b.getAttribute("aria-label") ?? ""))?.click(); });
  await page.waitForTimeout(1500);

  // 4. Refinement.
  await sendIn(REFINE);
  await page.waitForTimeout(10000);
  await shot("14-product-refinement", "01-refinement-requested");
  const refined = await waitFor((s) => s.some((a) => a.revs >= 2 && a.exports.some((e) => e.rev >= 2 && e.ok)), 300, "refinement");
  const r2 = Array.isArray(refined) ? refined.find((a) => a.id === art?.id) ?? refined[0] : null;
  record("the same artifact gained a new revision (not a new artifact)", r2 && r2.id === art?.id && r2.revs >= 2, JSON.stringify(r2)?.slice(0, 300));
  record("the revision has a line chart with four versions", r2 && r2.charts[0]?.kind === "line" && r2.charts[0]?.labels.length === 4, JSON.stringify(r2?.charts));
  record("the new revision's DOCX was verified", r2 && r2.exports.some((e) => e.rev >= 2 && e.ok));
  record("the revision kept every text block it was not asked to change", r2 && r2.lost.length === 0, JSON.stringify(r2?.lost));
  for (let i = 0; i < 24; i += 1) { if (!(await page.evaluate(() => document.querySelector("[data-lelu-universe-typing]") !== null))) break; await page.waitForTimeout(5000); }
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const cards = document.querySelectorAll("[data-lelu-fullscreen] [data-lelu-chat-artifact]"); cards[cards.length - 1]?.scrollIntoView(); });
  await page.waitForTimeout(600);
  await shot("14-product-refinement", "02-revised-card");
  await page.evaluate(() => { const cards = [...document.querySelectorAll("[data-lelu-fullscreen] [data-lelu-chat-artifact]")]; [...(cards.at(-1)?.querySelectorAll("button") ?? [])].find((b) => /Open/.test(b.textContent))?.click(); });
  await page.waitForTimeout(3000);
  await shot("14-product-refinement", "03-revised-artifact");

  // 5. Persistence: reload, artifact and conversation come back.
  await page.reload({ waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i += 1) { await page.waitForTimeout(1500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account" || b.textContent.trim() === "Chat")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const after = await studio();
  const kept = Array.isArray(after) ? after.find((a) => a.id === art?.id) : null;
  record("after a reload the artifact and its revisions are still there", kept && kept.revs >= 2, JSON.stringify(kept)?.slice(0, 200));
  const convo = await page.evaluate(async (id) => {
    const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const c = M.list().find((x) => x.id === id);
    return c ? { msgs: c.messages.length, cards: c.messages.filter((m) => m.activity?.artifacts?.length).length } : null;
  }, conversationId);
  record("after a reload the conversation keeps its messages and artifact cards", convo && convo.msgs >= 4 && convo.cards >= 1, JSON.stringify(convo));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
  await page.waitForTimeout(2500);
  await page.evaluate((id) => [...document.querySelectorAll(".lcu-card")].find((x) => (x.getAttribute("aria-label") ?? "").includes("Lumo") || x.closest(`[data-conversation="${id}"]`))?.click(), conversationId);
  await page.evaluate(() => { if (!document.querySelector("[data-lelu-fullscreen]")) [...document.querySelectorAll(".lcu-card")][0]?.click(); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const c = document.querySelector("[data-lelu-fullscreen] [data-lelu-chat-artifact]"); c?.scrollIntoView(); });
  await shot("15-persistence-recovery", "01-conversation-after-reload");

  // 6. Independence: the other conversation has no trace of the product.
  await page.evaluate(() => { const w = document.querySelector("[data-lelu-fullscreen]"); [...(w?.querySelectorAll("button") ?? [])].find((b) => /^Close /.test(b.getAttribute("aria-label") ?? ""))?.click(); });
  await page.waitForTimeout(1200);
  // Closing the sheet returns to Home: reopen the Universe, then another
  // conversation — Engineering where it exists, otherwise a new chat.
  if (!(await page.evaluate(() => document.querySelector(".lcu-card") !== null))) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
    await page.waitForTimeout(2500);
  }
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".lcu-card")];
    (cards.find((x) => /Engineering/.test(x.getAttribute("aria-label") ?? "")) ?? cards.find((x) => /New chat/.test(x.getAttribute("aria-label") ?? "")))?.click();
  });
  await page.waitForTimeout(2500);
  const other = await page.evaluate(() => { const w = document.querySelector("[data-lelu-fullscreen]"); return w ? { id: w.getAttribute("data-lelu-module-window")?.replace(/^chat:/, ""), lumo: /Lumo/i.test(w.innerText), cards: w.querySelectorAll("[data-lelu-chat-artifact]").length } : null; });
  await shot("10-multi-chat", "02-other-conversation-independent");
  record("the other conversation shows no trace of the product", other && other.id !== conversationId && !other.lumo && other.cards === 0, JSON.stringify(other));
  record("no uncaught page errors", !log.some((l) => l.startsWith("pageerror")), log.filter((l) => l.startsWith("pageerror")).slice(0, 2).join(" | "));
} catch (error) {
  record("run completed", false, String(error).slice(0, 300));
  await shot("07-regression", "product-creation-failure").catch(() => undefined);
} finally {
  writeFileSync(path.join(OUT, "product-creation-report.json"), JSON.stringify({ base: BASE, checks, log: log.slice(-40) }, null, 2));
  await browser.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ checks: checks.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
