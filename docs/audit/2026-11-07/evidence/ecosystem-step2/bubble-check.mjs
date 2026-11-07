import { chromium, devices } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
const OUT = process.argv[2];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 2 });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 60; i++) { await page.waitForTimeout(1500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
await page.waitForTimeout(3000);
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
await page.waitForTimeout(2500);
await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
await page.waitForTimeout(2500);
await page.evaluate(async () => {
  const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const id = M.getActiveId(); const now = Date.now();
  M.addMessage(id, { id: "u1", role: "user", text: "Change the chart in the Lumo brief to a line chart and add a fourth version, Max, at 400 grams. Export the new revision as DOCX.", timestamp: now });
  M.addMessage(id, { id: "a1", role: "assistant", text: "Here is the updated **Lumo Solar Camping Lantern – Product Brief** with a *line chart*:\n\n- Lite 180 g\n- Standard 240 g\n- Pro 320 g\n- **Max 400 g**\n\nVerified file: `Lumo-Solar-Camping-Lantern-Product-Brief-r2.docx` (a_very_long_unbroken_identifier_art_a09a7468384e_revision_2_export_docx_verified)", timestamp: now + 1,
    activity: { status: "done", startedAt: now, finishedAt: now + 1, steps: [], sources: [], pages: [], artifacts: [{ artifactId: (await import("/src/core/studio/StudioStore.ts")).default.getInstance().create({ kind: "document", title: "Lumo Solar Camping Lantern – Product Brief", blocks: [{ type: "paragraph", text: "x" }] }).artifact.id, rev: 2, title: "Lumo Solar Camping Lantern – Product Brief", kind: "document", action: "revised", exports: [{ format: "docx", filename: "Lumo-Solar-Camping-Lantern-Product-Brief-with-a-long-name.docx", ok: true, size: 14200 }] }] } });
});
await page.waitForTimeout(1500);
const m = await page.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-universe-thread] button")].map((x) => [x.textContent.trim(), Math.round(x.getBoundingClientRect().height)]); window.__b = b; const card = document.querySelector("[data-lelu-chat-artifact] header"); const em = card?.querySelector("em")?.getBoundingClientRect(); const btn = card?.querySelector(".lst-btn")?.getBoundingClientRect(); window.__overlap = em && btn ? Math.max(0, Math.round(em.right - btn.left)) : null; const t = document.querySelector("[data-lelu-universe-thread]"); const raw = /\*\*/.test(t.innerText); const over = [...t.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); const tr = t.getBoundingClientRect(); return r.width > 0 && (r.right > tr.right + 1 || r.left < tr.left - 1); }).length; return { scrollW: t.scrollWidth, clientW: t.clientWidth, rawMarkdown: raw, strong: t.querySelectorAll("strong").length, li: t.querySelectorAll("li").length, overflowingElements: over, buttons: window.__b, subtitleUnderButtonPx: window.__overlap }; });
console.log(JSON.stringify(m));
await page.screenshot({ path: OUT });
await browser.close();
