/** Workflows 2–5: visual edit/save/reopen/export · 3D build/change/export/reopen · data→chart→slides · film render/play/verify. */
import { launch, desktop, iphone, boot, openUniverse, shot, track, newConversation, send, stage, works, goStage, waitTurn, seed, openSeededChat } from "./harness.mjs";
import fs from "node:fs";
const label = process.argv[2] ?? "desktop";
const only = process.argv[3];
const browser = await launch(); const errors = [];
const ctx = await (label === "iphone" ? iphone(browser) : desktop(browser));
const page = await ctx.newPage(); track(page, errors);
const out = {};
const download = async (fn) => { const p = page.waitForEvent("download", { timeout: 60000 }).catch(() => null); await fn(); const d = await p; if (!d) return null; const b = fs.readFileSync(await d.path()); return { name: d.suggestedFilename(), bytes: b.length, head: b.subarray(0, 4).toString("latin1") }; };
await boot(page); await openUniverse(page);

if (!only || only === "visual") {
  const id = await newConversation(page, "Aurora fabric study");
  await goStage(page, "gallery"); await page.waitForTimeout(1200);
  await page.locator('[data-lelu-env-view="visuals"] .lev-btn', { hasText: "New composition" }).click();
  await page.waitForSelector(".lev-visual svg, .lev-visual img, .lev-visual iframe", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500); await shot(page, `wf2-${label}-1-composed`);
  await page.locator('[data-lelu-env-view="visuals"] select').nth(0).selectOption("ridgelines");
  await page.locator('[data-lelu-env-view="visuals"] select').nth(1).selectOption("ember");
  await page.locator('[data-lelu-env-view="visuals"] .lev-btn', { hasText: "Restyle selected" }).click(); await page.waitForTimeout(3000);
  await page.locator(".lev-versions .lev-btn", { hasText: "Compare" }).first().click().catch(() => {}); await page.waitForTimeout(800);
  out.visualDiff = await page.locator(".lev-diff li").allInnerTexts().catch(() => []);
  await shot(page, `wf2-${label}-2-restyled-compared`);
  // Desktop Chromium answers with the native Save dialog (headless cannot); verify the written file itself.
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  out.png = await download(() => page.locator('[data-lelu-visual-export="png"]').first().click());
  out.pngRecord = await page.locator("[data-lelu-visual-report]").first().innerText().catch(() => null);
  out.visualWorks = await works(page, id);
  // Reopen: a full reload, then the same work comes back from storage with its versions.
  await boot(page); await openUniverse(page);
  await page.evaluate((t) => [...document.querySelectorAll(".lcu-card")].find((c) => (c.textContent || "").includes(t))?.click(), "Aurora fabric study");
  await page.waitForTimeout(1500); await goStage(page, "gallery"); await page.waitForTimeout(2500);
  out.afterReload = await works(page, id);
  await shot(page, `wf2-${label}-3-reopened-after-reload`);
}

if (!only || only === "3d") {
  const id = await newConversation(page, "Desert outpost");
  await goStage(page, "spatial"); await page.waitForTimeout(1500);
  await page.locator('[data-lelu-env-view="scenes"] .lev-btn', { hasText: "+ desert" }).click();
  await page.waitForSelector(".lev-visual canvas", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(4000); await shot(page, `wf3-${label}-1-scene`);
  await page.locator('[data-lelu-env-view="scenes"] .lev-btn', { hasText: "+ crystal" }).click(); await page.waitForTimeout(2500);
  await page.locator(".lev-objects input[type=color]").first().fill("#ff3d8b");
  await page.waitForTimeout(3500); await shot(page, `wf3-${label}-2-changed`);
  out.glb = await download(() => page.locator('[data-lelu-env-view="scenes"] .lev-btn', { hasText: "⇣ GLB" }).click());
  await page.waitForSelector('[data-lelu-reopened="glb"]', { timeout: 30000 }).catch(() => {});
  await page.locator('[data-lelu-reopened]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.locator('[data-lelu-reopened] button', { hasText: /Expand/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500); await page.locator('[data-lelu-reopened]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(3000); await shot(page, `wf3-${label}-3-glb-reopened`);
  out.stl = await download(() => page.locator('[data-lelu-env-view="scenes"] .lev-btn', { hasText: "⇣ STL" }).click());
  await page.waitForSelector('[data-lelu-reopened="stl"]', { timeout: 30000 }).catch(() => {});
  await page.locator('[data-lelu-reopened]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.locator('[data-lelu-reopened] button', { hasText: /Expand/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500); await page.locator('[data-lelu-reopened]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(3000); await shot(page, `wf3-${label}-4-stl-reopened`);
  out.reopened = await page.locator("[data-lelu-reopened]").getAttribute("data-lelu-reopened").catch(() => null);
  out.sceneWorks = await works(page, id);
}

if (!only || only === "data") {
  const id = await newConversation(page, "Earthquakes this week");
  await goStage(page, "data"); await page.waitForTimeout(1200);
  await page.locator('[data-lelu-env-view="data"] .lev-btn', { hasText: "Earthquakes" }).click();
  out.dataMs = await waitTurn(page, id, 90000);
  await page.waitForTimeout(2000); await goStage(page, "data"); await page.waitForTimeout(1500);
  out.dataReply = await page.evaluate(async (cid) => { const { default: S } = await import("/src/core/multichat/MultiChatStore.ts"); const m = S.getInstance().get(cid).messages; return m[m.length - 1]?.text.slice(0, 500); }, id);
  await page.locator('[data-lelu-env-view="data"] .lev-works button').first().click().catch(() => {});
  await page.waitForTimeout(4000);
  await page.locator(".lev-visual").first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(1500); await shot(page, `wf4-${label}-1-chart`);
  out.findings = await page.locator("[data-lelu-data-findings] li").allInnerTexts().catch(() => []);
  await page.locator("[data-lelu-data-findings]").scrollIntoViewIfNeeded().catch(() => {});
  await page.locator('[data-lelu-data-findings] .lev-btn', { hasText: "Explain in the chat" }).click().catch(() => {}); await page.waitForTimeout(800);
  await shot(page, `wf4-${label}-2-findings`);
  await page.locator('[data-lelu-data-findings] .lev-btn', { hasText: "Findings → presentation" }).click().catch(() => {}); await page.waitForTimeout(1500);
  await goStage(page, "present"); await page.waitForTimeout(2000);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(1200);
  out.pptx = await download(() => page.locator(".lev-deckbar .lev-btn", { hasText: "⇣ PPTX" }).first().click());
  await shot(page, `wf4-${label}-3-presentation`);
  out.dataWorks = await works(page, id);
}

if (!only || only === "film") {
  await seed(page); await openUniverse(page); await openSeededChat(page);
  await goStage(page, "film"); await page.waitForTimeout(1200);
  await page.locator('[data-lelu-env-view="film"] .lev-btn', { hasText: "Film from this conversation" }).click(); await page.waitForTimeout(2000);
  const t0 = Date.now();
  await page.locator("[data-lelu-film-render]").first().click().catch(() => {});
  await page.waitForSelector("[data-lelu-film-ready]", { timeout: 1500000 }).catch(() => {});
  out.filmRenderMs = Date.now() - t0;
  out.filmInfo = await page.locator("[data-lelu-film-info]").first().innerText().catch(() => null);
  out.filmPlays = await page.evaluate(async () => { const v = document.querySelector("[data-lelu-film-ready]"); if (!v) return null; v.muted = true; try { await v.play(); } catch (e) { return `play failed: ${e.message}`; } await new Promise((r) => setTimeout(r, 1500)); return { currentTime: v.currentTime, duration: v.duration, w: v.videoWidth, h: v.videoHeight, paused: v.paused }; });
  await shot(page, `wf5-${label}-1-film`);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  out.webm = await download(() => page.locator('[data-lelu-visual-export="webm"]').first().click());
}
console.log(JSON.stringify(out, (k, v) => (k === "exports" && Array.isArray(v) ? v.join(" ") : v), 1).slice(0, 6000));
console.log("pageerrors:", errors.filter((e) => e.startsWith("pageerror")).slice(0, 6));
await browser.close();
