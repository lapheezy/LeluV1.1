/**
 * The chat opens in the NEW look (Chat Universe: glass, windowed) from the
 * paths people really use — never the old single-panel chat with the
 * browser-style tab strip.
 *
 *   node scripts/verify-chat-new-look.cjs <outDir>
 *
 * Per viewport: open the chat (1) with the spatial navigator's chat control
 * (real tap/click) and (2) the way LÉLU or voice does (UIActionBus
 * open_panel chat). Each time: the Universe is visible, the old composer
 * ([data-lelu-composer]) and the tab strip (MultiChatTabs) are not. Then a
 * message typed into the Universe composer and sent lands in the conversation.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const VIEWPORTS = [
  { name: "desktop-1440x900", opts: { viewport: { width: 1440, height: 900 } } },
  { name: "375x812", opts: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: "390x844", opts: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: "iPhone13", opts: { ...devices["iPhone 13"], deviceScaleFactor: 1 } },
];

const looks = (page) => page.evaluate(() => {
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05; };
  const anyVis = (sel) => [...document.querySelectorAll(sel)].some(vis);
  return {
    universe: anyVis('.lcu[role="dialog"]'),
    oldComposer: anyVis("[data-lelu-composer]"),
    oldTabStrip: anyVis("[class*='lelu-tab-bar'], [class*='lelu-tab-cloud']"),
    universeComposer: anyVis(".lcu-composer textarea"),
  };
});

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const results = [];
  for (const vp of VIEWPORTS) {
    const touch = Boolean(vp.opts.hasTouch);
    const ctx = await browser.newContext(vp.opts);
    await ctx.route(/supabase\.co/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    const tap = async (sel) => {
      const p = await page.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, reachable: Boolean(hit && (hit === e || e.contains(hit))) }; }, sel);
      if (!p || !p.reachable) return false;
      if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      return true;
    };
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
    await page.waitForTimeout(2500);

    // 1. The navigator's chat control.
    const tappedNav = await tap('[data-spatial-control="chat"]');
    await page.waitForTimeout(2000);
    const viaNavigator = await looks(page);
    await page.screenshot({ path: path.join(outDir, `navigator-${vp.name}.png`) }).catch(() => {});

    // Close the Universe, then 2. the way LÉLU / voice opens the chat.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await page.evaluate(async () => { const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts"); Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "lelu" }); });
    await page.waitForTimeout(2000);
    const viaLelu = await looks(page);

    // 3. Send through the Universe composer (pick a chat first if needed).
    if (!(await page.evaluate(() => { const t = document.querySelector(".lcu-composer textarea"); return t && !t.disabled; }))) {
      await tap(".lcu-card");
      await page.waitForTimeout(1200);
    }
    const text = `New look check ${vp.name}`;
    const typed = await tap(".lcu-composer textarea");
    if (typed) { await page.keyboard.type(text, { delay: 3 }); await page.keyboard.press("Enter"); }
    await page.waitForTimeout(2500);
    const landed = await page.evaluate(async (t) => { const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); return M.list().some((c) => c.messages.some((m) => m.role === "user" && m.text === t)); }, text);
    const afterSend = await looks(page);
    await page.screenshot({ path: path.join(outDir, `after-send-${vp.name}.png`) }).catch(() => {});

    const r = { viewport: vp.name, tappedNav, viaNavigator, viaLelu, typed, landed, afterSend, errors: errors.slice(0, 3) };
    const newLook = (l) => l.universe && !l.oldComposer && !l.oldTabStrip;
    r.pass = newLook(viaNavigator) && newLook(viaLelu) && landed && !afterSend.oldTabStrip && !afterSend.oldComposer;
    results.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  fs.writeFileSync(path.join(outDir, "chat-new-look.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results }, null, 1) + "\n");
  await browser.close();
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
}
run();
