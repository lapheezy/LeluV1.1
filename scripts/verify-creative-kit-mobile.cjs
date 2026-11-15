/**
 * Job 2 acceptance — creative kit on a phone-sized viewport (iPhone 13
 * descriptor in Chromium; WebKit is not installed in this environment, so
 * this is NOT a Safari test). Chat commands with no model, a card, a window,
 * horizontal overflow and memory.
 *   LELU_BASE=http://127.0.0.1:5174/ node scripts/verify-creative-kit-mobile.cjs <outDir>
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/mission-open-source-expansion");
const SHOTS = path.join(OUT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  let modelCalls = 0;
  await ctx.route(/\/api\/(model|ai|chat)(\/|$|\?)/, (r) => { if (r.request().method() === "GET") return r.continue(); modelCalls += 1; r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const chat = await page.evaluate(() => { const b = document.querySelector('[data-spatial-control="chat"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (chat) await page.mouse.click(chat.x, chat.y);
  await page.waitForTimeout(2500);
  for (const [id, text] of [["m1-art", "/art orbits neon"], ["m2-scene", "/scene ocean"], ["m3-diagram", "/diagram phone -> chat -> tools -> files"]]) {
    // On a phone an artifact window covers the chat: close it first, as a person would.
    for (let k = 0; k < 4; k++) {
      const x = await page.evaluate(() => {
        const win = document.querySelector("[data-lelu-studio-artifact]");
        if (!win) return null;
        const top = win.getBoundingClientRect().top;
        const header = [...document.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().bottom <= top + 2 && b.getBoundingClientRect().bottom > top - 120);
        // The window's own "Chat" control returns to the conversation; otherwise its close (✕) control.
        const btn = header.find((b) => b.textContent.trim() === "Chat") ?? header.find((b) => /^[✕×xX]$/.test(b.textContent.trim()) || b.querySelector("svg.lucide-x"));
        if (!btn) return null; const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!x) break;
      await page.mouse.click(x.x, x.y);
      await page.waitForTimeout(700);
    }
    const ta = await page.evaluate(() => { const el = [...document.querySelectorAll("textarea")].find((e) => e.getBoundingClientRect().width > 0 && !e.disabled); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (!ta) { check(`${id}: composer reachable`, false); continue; }
    await page.mouse.click(ta.x, ta.y);
    await page.keyboard.type(text, { delay: 2 });
    await page.keyboard.press("Enter");
    const t0 = Date.now();
    let reply = null;
    for (let i = 0; i < 90 && !reply; i++) {
      await page.waitForTimeout(700);
      reply = await page.evaluate(async (text) => { const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); const c = M.list().find((x) => x.messages.some((m) => m.role === "user" && m.text.trim() === text)); if (!c) return null; const at = c.messages.findIndex((m) => m.role === "user" && m.text.trim() === text); const r = c.messages.slice(at + 1).find((m) => m.role === "assistant" && m.text.trim()); return r ? r.text.slice(0, 200) : null; }, text);
    }
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, `${id}-iphone13.png`), timeout: 60000 }).catch(() => {});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${id}: “${text}” executed on a phone viewport without a model`, reply && /directly with my own tools/.test(reply), `${Date.now() - t0} ms · horizontal overflow ${overflow}px · ${(reply ?? "no reply").split("\n")[0].slice(0, 120)}`);
  }
  const windows = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-studio-artifact]")].map((w) => { const r = w.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), fits: r.width <= window.innerWidth + 1 }; }));
  check("artifact windows fit the phone width", windows.length > 0 && windows.every((w) => w.fits), JSON.stringify(windows));
  const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  check("no model calls, no page errors", modelCalls === 0 && errors.length === 0, `${modelCalls} model calls · heap ${heap} MB · ${errors.slice(0, 2).join(" | ")}`);
  fs.writeFileSync(path.join(OUT, "mobile-run.json"), JSON.stringify({ device: "iPhone 13 (Chromium emulation)", at: new Date().toISOString(), heapMB: heap, windows, modelCalls, errors, results }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
