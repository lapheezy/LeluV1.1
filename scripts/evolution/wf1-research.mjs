/** Workflow 1: research → sources → browser → board → diagram → document (exported, verified). */
import { launch, desktop, iphone, boot, openUniverse, shot, track, newConversation, send, stage, works, goStage, waitTurn } from "./harness.mjs";
const label = process.argv[2] ?? "desktop";
const browser = await launch(); const errors = [];
const ctx = await (label === "iphone" ? iphone(browser) : desktop(browser)); const page = await ctx.newPage(); track(page, errors);
page.on("crash", () => console.log("RENDERER CRASHED at", new Date().toISOString()));
page.on("close", () => console.log("PAGE CLOSED"));
browser.on("disconnected", () => console.log("BROWSER DISCONNECTED"));
const step = (n) => console.log("STEP", n, new Date().toISOString().slice(11, 19));
const out = {};
await boot(page); await openUniverse(page);
const id = await newConversation(page, "Coral reef bleaching");
await send(page, "/research coral reef bleaching", 2000);
out.researchMs = await waitTurn(page, id);
await page.waitForTimeout(2500);
// The brief opens as its own window; bring the conversation back to the front.
await page.locator(".lws-tab", { hasText: "Coral reef" }).first().click().catch(() => {});
await page.waitForTimeout(1200);
out.stageAfterResearch = await stage(page);
out.worksAfterResearch = await works(page, id);
out.reply = await page.evaluate(async (cid) => { const { default: S } = await import("/src/core/multichat/MultiChatStore.ts"); const m = S.getInstance().get(cid).messages; return m[m.length - 1]?.text.slice(0, 600); }, id);
await shot(page, `wf1-${label}-1-research`);
out.sources = await page.locator(".lev-source").count();
// Open the first real source in the browser beside the chat.
if (out.sources) { await page.locator(".lev-source .lev-btn", { hasText: "Open" }).first().click(); await page.waitForTimeout(9000); }
out.browserUrl = await page.evaluate(() => document.querySelector('[data-lelu-browser] input[aria-label="Browser address"]')?.value ?? null);
await shot(page, `wf1-${label}-2-source-in-browser`); step("browser done");
// On a phone the browser is now the screen and the chat a tab: tap back to the chat, as a person would.
await page.locator(".lws-tab", { hasText: "Coral reef" }).first().click().catch(() => {}); await page.waitForTimeout(1200);
// Source → board, then save the board as a graph.
if (out.sources) await page.locator(".lev-source .lev-btn", { hasText: "+ Board" }).first().click().catch(() => {});
// Desktop: focus the chat window by its title bar. (On a phone that spot is the bar's "back to Universe".)
if (label !== "iphone") await page.locator('[data-lelu-module-window^="chat:"]').first().click({ position: { x: 30, y: 10 } }).catch(() => {});
{ const el = page.locator('[data-lelu-stage="board"]').first(); out.boardBtn = { visible: await el.isVisible().catch(() => null), box: await el.boundingBox().catch(() => null) }; try { await el.click({ timeout: 4000 }); } catch (e) { out.boardClickErr = String(e).split("\n").slice(0, 6).join(" | ").slice(0, 500); } out.steward = await page.evaluate(async () => { const { default: W } = await import("/src/core/interface/WorkspaceStewardStore.ts"); const s = W.get(); return { mode: s.mode, focusId: s.focusId, focusIds: s.focusIds, log: s.log.slice(-6).map((d) => `${d.by}: ${d.what}`) }; }); out.windows = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-steward]")].filter((e) => getComputedStyle(e).display !== "none").map((e) => `${e.getAttribute("data-lelu-module-window")} ${e.getAttribute("data-lelu-steward-rect")}`)); out.presentations = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].map((e) => `${e.getAttribute("data-lelu-module-window")}:${e.getAttribute("data-presentation")}:${getComputedStyle(e).display}`)); }
await goStage(page, "board"); await page.waitForSelector(".lbd-card", { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500);
await page.locator("[data-lelu-board-save]").click().catch(() => {}); await page.waitForTimeout(800);
out.boardNodes = await page.locator(".lbd").getAttribute("data-nodes").catch(() => null);
await shot(page, `wf1-${label}-3-board`); step("board done");
// Diagram from the conversation, saved, exported SVG.
await goStage(page, "diagram"); await page.waitForSelector("[data-lelu-diagram-svg] svg", { timeout: 20000 }).catch(() => {});
await page.locator(".lev-btn", { hasText: "Save diagram" }).click().catch(() => {}); await page.waitForTimeout(1200);
await page.locator(".lev-btn", { hasText: "⇣ SVG" }).first().click().catch(() => {}); await page.waitForTimeout(2500);
await shot(page, `wf1-${label}-4-diagram`); step("diagram done");
// Final document from the conversation, exported DOCX and PDF.
await goStage(page, "document");
out.stageBeforeDoc = await stage(page); out.docTabs = await page.locator('[data-lelu-env-view="document"] .lev-works button strong').allInnerTexts().catch(() => []); await page.locator(".lev-btn", { hasText: /Create document|New version/ }).first().click({ timeout: 8000 }).catch((e) => (out.docClickError = String(e).slice(0, 120))); await page.waitForTimeout(1800);
const dl = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
await page.locator(".lev-btn", { hasText: "⇣ DOCX" }).first().click({ timeout: 8000 }).catch(() => {}); const d = await dl;
if (d) { const p = await d.path(); const fs = await import("node:fs"); const b = fs.readFileSync(p); out.docx = { name: d.suggestedFilename(), bytes: b.length, zip: b.subarray(0, 2).toString() === "PK" }; }
await page.locator(".lev-btn", { hasText: "⇣ PDF" }).first().click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(3500);
out.lastNotes = await page.evaluate(async (cid) => { const { default: S } = await import("/src/core/multichat/MultiChatStore.ts"); return S.getInstance().get(cid).messages.slice(-4).map((m) => `${m.provider}: ${m.text.slice(0, 90)}`); }, id);
out.notice = await page.locator(".lev-export .lev-notice").first().innerText().catch(() => null);
await shot(page, `wf1-${label}-5-document`);
out.finalWorks = await works(page, id);
out.report = await page.evaluate(async (cid) => { const { default: S } = await import("/src/core/studio/StudioStore.ts"); const s = S.getInstance(); const d = s.list().filter((a) => a.conversationId === cid && a.kind === "document" && !/^Research board/.test(a.title)).sort((a, b) => b.updatedAt - a.updatedAt)[0]; if (!d) return null; const spec = s.latest(d).spec; return { title: spec.title, subtitle: spec.subtitle, blocks: spec.blocks.length, headings: spec.blocks.filter((b) => b.type === "heading").map((b) => b.text).slice(0, 6), tables: spec.blocks.filter((b) => b.type === "table").length, sources: spec.sources?.length }; }, id);
console.log(JSON.stringify(out, null, 1));
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 6));
await browser.close();
