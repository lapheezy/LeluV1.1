/**
 * Mission 10.3 — Share Screen is offered by CAPABILITY, not user agent.
 *
 *   node scripts/verify-share-capability.cjs <outDir>
 *
 * Chromium's "iPhone 13" emulation still exposes getDisplayMedia (it is
 * Chromium underneath), so the iOS-Safari case is reproduced the only honest
 * way available here: navigator.mediaDevices.getDisplayMedia is removed
 * before the app loads, exactly as WebKit on iOS ships it. No real iPhone
 * was used; see the report's platform limitations.
 *
 * Cases:
 *   ios-like      no getDisplayMedia → no Share Screen control; mic, voice, typing and sending still work
 *   desktop       getDisplayMedia present → control shown
 *   android-like  Pixel 7 emulation, getDisplayMedia present → control shown
 *   refusal       getDisplayMedia rejects NotAllowedError → a visible, plain explanation
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const CASES = [
  { name: "ios-like", opts: { ...devices["iPhone 13"], deviceScaleFactor: 1 }, remove: true },
  { name: "desktop", opts: { viewport: { width: 1440, height: 900 } } },
  { name: "android-like", opts: { ...devices["Pixel 7"], deviceScaleFactor: 1 } },
  { name: "refusal", opts: { viewport: { width: 1440, height: 900 } }, refuse: true },
];

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const results = [];
  for (const c of CASES) {
    const ctx = await browser.newContext({ ...c.opts, permissions: ["microphone"] });
    await ctx.route(/supabase\.co/, (r) => r.abort());
    await ctx.addInitScript(({ remove, refuse }) => {
      const md = navigator.mediaDevices;
      if (!md) return;
      // Silent mic: voice runs for real without billed transcription.
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = async (k) => (k && k.audio && !k.video ? new AudioContext().createMediaStreamDestination().stream : real(k));
      if (remove) {
        try { delete Object.getPrototypeOf(md).getDisplayMedia; } catch {}
        try { Object.defineProperty(md, "getDisplayMedia", { value: undefined, configurable: true }); } catch {}
      }
      if (refuse) md.getDisplayMedia = async () => { throw new DOMException("Permission denied", "NotAllowedError"); };
    }, { remove: Boolean(c.remove), refuse: Boolean(c.refuse) });
    const page = await ctx.newPage();
    const touch = Boolean(c.opts.hasTouch);
    const tap = async (sel) => {
      const p = await page.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
      if (!p) return false;
      if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      return true;
    };
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
    await page.waitForTimeout(2500);
    await tap('[data-spatial-control="voice"]');
    await page.waitForTimeout(2000);
    await tap('[data-spatial-control="chat"]');
    await page.waitForTimeout(2500);

    const hasGDM = await page.evaluate(() => typeof navigator.mediaDevices?.getDisplayMedia === "function");
    const shareShown = await page.evaluate(() => [...document.querySelectorAll("[data-lelu-share-screen]")].some((b) => b.getBoundingClientRect().width > 0));
    let notice = null;
    if (c.refuse && shareShown) {
      await tap("[data-lelu-share-screen]");
      await page.waitForTimeout(1200);
      notice = await page.evaluate(() => { const n = document.querySelector("[data-lelu-screen-share-notice]"); return n && n.getBoundingClientRect().height > 0 ? n.textContent.trim() : null; });
    }
    // Mic, voice, typing and sending are unaffected.
    const voice = await page.evaluate(async () => { const { default: V } = await import("/src/core/voice/VoiceEngine.ts"); const s = V.getInstance().getState(); return { active: s.active, phase: s.phase }; });
    const text = `Share capability ${c.name}`;
    await tap("[data-lelu-composer] textarea");
    await page.keyboard.type(text, { delay: 3 });
    await tap('[data-lelu-composer] button[aria-label="Send message"]');
    await page.waitForTimeout(1500);
    const landed = await page.evaluate(async (t) => { const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); return (M.getActive()?.messages ?? []).some((m) => m.role === "user" && m.text === t); }, text);
    await page.screenshot({ path: path.join(outDir, `share-${c.name}.png`) });
    const r = { case: c.name, getDisplayMedia: hasGDM, shareShown, notice, voice, chatSendLanded: landed };
    r.pass = (c.remove ? !shareShown : shareShown) && (!c.refuse || /declined/i.test(notice ?? "")) && voice.active && landed;
    results.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  fs.writeFileSync(path.join(outDir, "share-capability.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results }, null, 1) + "\n");
  await browser.close();
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
}
run();
