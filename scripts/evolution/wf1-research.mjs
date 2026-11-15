/** Workflow 1: research → sources → browser → board → diagram → document (exported, verified). */
import { launch, desktop, iphone, boot, openUniverse, shot, track, newConversation, send, stage, works, goStage, waitTurn } from "./harness.mjs";
const label = process.argv[2] ?? "desktop";
const browser = await launch(); const errors = [];
const ctx = await (label === "iphone" ? iphone(browser) : desktop(browser)); const page = await ctx.newPage(); track(page, errors);
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
await shot(page, `wf1-${label}-2-source-in-browser`);
// Source → board, then save the board as a graph.
if (out.sources) await page.locator(".lev-source .lev-btn", { hasText: "+ Board" }).first().click().catch(() => {});
await page.locator('[data-lelu-module-window^="chat:"]').first().click({ position: { x: 30, y: 10 } }).catch(() => {});
await goStage(page, "board"); await page.waitForSelector(".lbd-card", { timeout: 20000 }).catch(() => {}); await page.waitForTimeout(1500);
await page.locator("[data-lelu-board-save]").click().catch(() => {}); await page.waitForTimeout(800);
out.boardNodes = await page.locator(".lbd").getAttribute("data-nodes").catch(() => null);
await shot(page, `wf1-${label}-3-board`);
// Diagram from the conversation, saved, exported SVG.
await goStage(page, "diagram"); await page.waitForSelector("[data-lelu-diagram-svg] svg", { timeout: 20000 }).catch(() => {});
await page.locator(".lev-btn", { hasText: "Save diagram" }).click().catch(() => {}); await page.waitForTimeout(1200);
await page.locator(".lev-btn", { hasText: "⇣ SVG" }).first().click().catch(() => {}); await page.waitForTimeout(2500);
await shot(page, `wf1-${label}-4-diagram`);
// Final document from the conversation, exported DOCX and PDF.
await goStage(page, "document");
out.stageBeforeDoc = await stage(page); await page.locator(".lev-btn", { hasText: /Create document|New version/ }).first().click({ timeout: 8000 }).catch((e) => (out.docClickError = String(e).slice(0, 120))); await page.waitForTimeout(1800);
const dl = page.waitForEvent("download", { timeout: 30000 }).catch(() => null);
await page.locator(".lev-btn", { hasText: "⇣ DOCX" }).first().click({ timeout: 8000 }).catch(() => {}); const d = await dl;
if (d) { const p = await d.path(); const fs = await import("node:fs"); const b = fs.readFileSync(p); out.docx = { name: d.suggestedFilename(), bytes: b.length, zip: b.subarray(0, 2).toString() === "PK" }; }
await page.locator(".lev-btn", { hasText: "⇣ PDF" }).first().click({ timeout: 8000 }).catch(() => {}); await page.waitForTimeout(3500);
out.notice = await page.locator(".lev-export .lev-notice").first().innerText().catch(() => null);
await shot(page, `wf1-${label}-5-document`);
out.finalWorks = await works(page, id);
console.log(JSON.stringify(out, null, 1));
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 6));
await browser.close();
