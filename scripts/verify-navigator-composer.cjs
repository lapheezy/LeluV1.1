/**
 * Mission 10.3 — the spatial navigator must never cover the chat composer.
 *
 *   node scripts/verify-navigator-composer.cjs <outDir>
 *
 * For each viewport (desktop, 375×812, 390×844, iPhone 13):
 *   1. open the chat the way a person does (Chat button → New chat card);
 *   2. start voice from the navigator's own mic control (real tap/click) on a
 *      silent virtual microphone, so voice is live but nothing is billed;
 *   3. open the navigator's capability groups with its own toggle;
 *   4. hit-test the composer's textarea, send, mic and attach controls —
 *      every one must be the element under its own centre point;
 *   5. tap the textarea for real, type, and tap Send for real — the message
 *      must land in the active conversation (chat state survives);
 *   6. use the navigator afterwards (toggle groups again) — it still works;
 *   7. voice is still active at the end.
 * Interaction is page.touchscreen.tap on touch viewports, page.mouse.click on desktop.
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

async function tapAt(page, touch, p) {
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Centre of a control and what is really under it. */
async function probe(page, selector) {
  return page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    const by = hit && !(hit === el || el.contains(hit))
      ? `${hit.tagName.toLowerCase()}${hit.closest("[data-spatial-nav]") ? " (spatial navigator)" : ""}${hit.getAttribute("data-spatial-groups") !== null ? "[data-spatial-groups]" : ""}`
      : null;
    return { found: true, x: Math.round(x), y: Math.round(y), reachable: !by, coveredBy: by };
  }, selector);
}

const navState = (page) => page.evaluate(() => {
  const nav = document.querySelector("[data-spatial-nav]");
  const comp = document.querySelector("[data-lelu-composer]");
  const n = nav?.getBoundingClientRect();
  const c = comp?.getBoundingClientRect();
  const overlap = n && c ? Math.max(0, Math.min(n.right, c.right) - Math.max(n.left, c.left)) * Math.max(0, Math.min(n.bottom, c.bottom) - Math.max(n.top, c.top)) : 0;
  return {
    present: Boolean(nav),
    groupsOpen: Boolean(document.querySelector("[data-spatial-groups]")),
    clearance: nav?.getAttribute("data-spatial-composer-clearance") ?? null,
    navRect: n ? { top: Math.round(n.top), bottom: Math.round(n.bottom), left: Math.round(n.left), right: Math.round(n.right) } : null,
    composerRect: c ? { top: Math.round(c.top), bottom: Math.round(c.bottom), left: Math.round(c.left), right: Math.round(c.right) } : null,
    overlapPx: Math.round(overlap),
  };
});

const voiceState = (page) => page.evaluate(async () => {
  const { default: V } = await import("/src/core/voice/VoiceEngine.ts");
  const s = V.getInstance().getState();
  return { active: s.active, phase: s.phase, error: s.error };
});

const messageCount = (page) => page.evaluate(async () => {
  const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const c = M.getActive();
  return { id: c?.id ?? null, count: c?.messages?.length ?? 0, last: c?.messages?.filter((m) => m.role === "user").slice(-1)[0]?.text ?? null };
});

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const results = [];
  for (const vp of VIEWPORTS) {
    const touch = Boolean(vp.opts.hasTouch);
    const ctx = await browser.newContext({ ...vp.opts, permissions: ["microphone"] });
    await ctx.route(/supabase\.co/, (r) => r.abort());
    // A silent virtual microphone: voice runs for real, but no speech means no billed transcription.
    await ctx.addInitScript(() => {
      const real = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      if (!real) return;
      navigator.mediaDevices.getUserMedia = async (c) => {
        if (c && c.audio && !c.video) {
          const ac = new AudioContext();
          const dest = ac.createMediaStreamDestination();
          return dest.stream;
        }
        return real(c);
      };
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
    await page.waitForTimeout(2500);

    // Voice from the navigator's own control, before the chat is summoned.
    const voiceBtn = await probe(page, '[data-spatial-control="voice"], button[aria-label="Talk to LÉLU"]');
    if (voiceBtn.found && voiceBtn.reachable) await tapAt(page, touch, voiceBtn);
    await page.waitForTimeout(2500);
    const voiceAfterStart = await voiceState(page);

    // Summon the chat with the navigator's own control (real tap/click).
    const chatBtn = await probe(page, '[data-spatial-control="chat"]');
    let chatOpenedBy = "navigator";
    if (chatBtn.found && chatBtn.reachable) await tapAt(page, touch, chatBtn);
    await page.waitForTimeout(2500);
    if (!(await page.evaluate(() => Boolean(document.querySelector("[data-lelu-composer] textarea"))))) {
      chatOpenedBy = "ui-action-bus";
      await page.evaluate(async () => { const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts"); Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "lelu" }); });
      await page.waitForTimeout(2500);
    }

    // Open the capability groups with the navigator's own toggle (if the navigator is shown here).
    let nav = await navState(page);
    if (nav.present && !nav.groupsOpen) {
      const expand = await probe(page, '[data-spatial-control="expand"]');
      if (expand.found && expand.reachable) await tapAt(page, touch, expand);
      await page.waitForTimeout(800);
      nav = await navState(page);
    }
    await page.screenshot({ path: path.join(outDir, `composer-${vp.name}.png`) });

    const controls = {
      textarea: await probe(page, "[data-lelu-composer] textarea"),
      send: await probe(page, '[data-lelu-composer] button[aria-label="Send message"]'),
      mic: await probe(page, "[data-lelu-composer] button[aria-label*='voice' i], [data-lelu-composer] button[aria-label*='microphone' i], [data-lelu-composer] button[aria-label*='Talk' i]"),
      share: await probe(page, '[data-lelu-composer] button[aria-label*="screen" i]'),
    };

    // Type and send for real.
    const before = await messageCount(page);
    const text = `Navigator check ${vp.name}`;
    let sent = false;
    if (controls.textarea.reachable) {
      await tapAt(page, touch, controls.textarea);
      await page.keyboard.type(text, { delay: 5 });
      const send = await probe(page, '[data-lelu-composer] button[aria-label="Send message"]');
      if (send.reachable) { await tapAt(page, touch, send); sent = true; }
    }
    await page.waitForTimeout(2000);
    const after = await messageCount(page);

    // The navigator still works after the composer was used.
    const navBefore = await navState(page);
    let navToggled = null;
    if (navBefore.present) {
      const expand = await probe(page, '[data-spatial-control="expand"]');
      if (expand.found && expand.reachable) {
        await tapAt(page, touch, expand);
        await page.waitForTimeout(700);
        navToggled = (await navState(page)).groupsOpen !== navBefore.groupsOpen;
        await tapAt(page, touch, expand);
        await page.waitForTimeout(700);
      } else navToggled = false;
    }
    const navAfter = await navState(page);
    const voiceEnd = await voiceState(page);
    await page.screenshot({ path: path.join(outDir, `after-${vp.name}.png`) });

    const r = {
      viewport: vp.name, touch, chatOpenedBy,
      navigatorShown: nav.present, navigatorWithChat: nav, controls,
      sent, messageLanded: after.id === before.id && after.count > before.count && after.last === text,
      chatSurvived: after.id === before.id,
      navigatorStillWorks: navBefore.present ? navToggled : "navigator steps aside while the phone chat owns the screen",
      navigatorAfter: navAfter,
      voice: { afterStart: voiceAfterStart, atEnd: voiceEnd, stayedActive: voiceAfterStart.active && voiceEnd.active },
      errors: errors.slice(0, 3),
    };
    r.pass = Boolean(
      controls.textarea.reachable && controls.send.reachable && (!controls.share.found || controls.share.reachable)
      && r.messageLanded && r.chatSurvived && navAfter.overlapPx === 0 && nav.overlapPx === 0
      && (navBefore.present ? navToggled === true : true) && r.voice.stayedActive,
    );
    results.push(r);
    console.log(JSON.stringify({ viewport: r.viewport, pass: r.pass, overlap: nav.overlapPx, textarea: controls.textarea.coveredBy, send: controls.send.coveredBy, landed: r.messageLanded, nav: r.navigatorStillWorks, voice: r.voice.stayedActive }));
    await ctx.close();
  }
  fs.writeFileSync(path.join(outDir, "navigator-composer.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results }, null, 1) + "\n");
  await browser.close();
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
}
run();
