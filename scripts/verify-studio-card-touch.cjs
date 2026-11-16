/**
 * Studio card in conversation — real touch / real click at phone and desktop
 * sizes, and "the right artifact is in front after a covering panel closes".
 *
 *   node scripts/verify-studio-card-touch.cjs <outDir>
 *
 * Seeding follows docs/audit/2026-11-07/evidence/ecosystem-step2/bubble-check.mjs
 * (a real StudioStore artifact and a real conversation message carrying it).
 * Interaction is NOT synthetic: page.touchscreen.tap on touch viewports and
 * page.mouse.click on desktop, at the centre of the control's visible area,
 * after checking that this point really hits the control.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const [outDir] = process.argv.slice(2);
const VIEWPORTS = [
  { name: "375x812", opts: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } },
  { name: "iPhone13-390x844", opts: { ...devices["iPhone 13"], deviceScaleFactor: 1 } },
  { name: "desktop-1440x900", opts: { viewport: { width: 1440, height: 900 } } },
];
const A = "Alpha Field Report";
const B = "Beta Launch Checklist";

async function seed(page, titles) {
  return page.evaluate(async (ts) => {
    const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    const id = M.getActiveId();
    const now = Date.now();
    const ids = [];
    ts.forEach((title, i) => {
      const artifactId = S.create({ kind: "document", title, blocks: [{ type: "paragraph", text: `${title} body` }] }).artifact.id;
      ids.push(artifactId);
      M.addMessage(id, { id: `u${i}-${now}`, role: "user", text: `Make "${title}"`, timestamp: now + i * 2 });
      M.addMessage(id, {
        id: `a${i}-${now}`, role: "assistant", text: `Here is **${title}**.`, timestamp: now + i * 2 + 1,
        activity: { status: "done", startedAt: now, finishedAt: now + 1, steps: [], sources: [], pages: [], artifacts: [{ artifactId, rev: 1, title, kind: "document", action: "created", exports: [] }] },
      });
    });
    return ids;
  }, titles);
}

/** The Open button of an artifact's card: visible area, clipping ancestors, and whether its centre hits it. */
async function measure(page, title) {
  return page.evaluate((t) => {
    const card = [...document.querySelectorAll("[data-lelu-chat-artifact]")].find((c) => c.textContent.includes(t));
    if (!card) return { found: false };
    card.scrollIntoView({ block: "center" });
    const btn = [...card.querySelectorAll("button")].find((b) => /Open/.test(b.textContent));
    if (!btn) return { found: true, button: false };
    const r = btn.getBoundingClientRect();
    let vis = { left: Math.max(r.left, 0), top: Math.max(r.top, 0), right: Math.min(r.right, innerWidth), bottom: Math.min(r.bottom, innerHeight) };
    const clippers = [];
    for (let el = btn.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(hidden|clip|auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
        const a = el.getBoundingClientRect();
        const before = { ...vis };
        vis = { left: Math.max(vis.left, a.left), top: Math.max(vis.top, a.top), right: Math.min(vis.right, a.right), bottom: Math.min(vis.bottom, a.bottom) };
        if (vis.right - vis.left < before.right - before.left - 0.5 || vis.bottom - vis.top < before.bottom - before.top - 0.5) {
          clippers.push((el.className && String(el.className).slice(0, 60)) || el.tagName);
        }
      }
    }
    const w = Math.max(0, vis.right - vis.left);
    const h = Math.max(0, vis.bottom - vis.top);
    const cx = vis.left + w / 2;
    const cy = vis.top + h / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      found: true, button: true,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      visibleFraction: r.width * r.height > 0 ? Math.round(((w * h) / (r.width * r.height)) * 100) / 100 : 0,
      clippedBy: clippers,
      tapPoint: { x: Math.round(cx), y: Math.round(cy) },
      tapHitsButton: Boolean(hit && (hit === btn || btn.contains(hit))),
    };
  }, title);
}

/**
 * Which window is actually in front: the window frame under the centre of
 * the screen, named by its own close control ("Close <title>").
 */
async function frontWindow(page) {
  return page.evaluate(() => {
    for (const [x, y] of [[innerWidth / 2, innerHeight / 2], [innerWidth / 2, innerHeight * 0.4]]) {
      // The close control lives in the window's header, a wrapper above the frame.
      let label = null;
      for (let n = document.elementFromPoint(x, y)?.closest(".genesis-window-frame"); n && !label; n = n.parentElement) {
        label = n.querySelector('button[aria-label^="Close "]')?.getAttribute("aria-label") ?? null;
      }
      if (label) return label.replace(/^Close /, "");
    }
    if (window.__leluVerifyDebug) {
      const out = [];
      for (let n = document.elementFromPoint(innerWidth / 2, innerHeight / 2); n && out.length < 8; n = n.parentElement) out.push(`${n.tagName}.${String(n.className).slice(0, 28)}`);
      return `NONE: ${out.join(" > ")}`;
    }
    return null;
  });
}
const frontArtifact = frontWindow;

/** Close the Settings window with a real tap/click on its own close control. */
async function closeSettingsByHand(page, touch) {
  const point = await page.evaluate(() => {
    const close = [...document.querySelectorAll('button[aria-label="Close Settings"]')].find((b) => b.getBoundingClientRect().width > 0);
    if (!close) return null;
    const r = close.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, reachable: Boolean(hit && close.contains(hit)) };
  });
  if (!point || !point.reachable) return false;
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(1500);
  return true;
}

const openSettings = (page) => page.evaluate(async () => { const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts"); Bus.getInstance().dispatch({ type: "open_panel", target: "settings", reason: "verify", initiatedBy: "lelu" }); });
const openArtifact = (page, id) => page.evaluate(async (x) => { const { openArtifacts } = await import("/src/app/scene/genesis/studio/useStudio.ts"); openArtifacts([x]); }, id);

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
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { await page.waitForTimeout(1000); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
    await page.waitForTimeout(2500);
    // The person's own path: the Chat button, then a new conversation card.
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Chat")?.click());
    await page.waitForTimeout(2500);
    await page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? ""))?.click());
    await page.waitForTimeout(2500);
    if (process.env.LELU_VERIFY_DEBUG) await page.evaluate(() => { window.__leluVerifyDebug = true; });
    const [idA, idB] = await seed(page, [A, B]);
    await page.waitForTimeout(1500);

    // 1. The card's Open action: visible, unclipped, and a real tap opens THAT artifact.
    const card = await measure(page, A);
    await page.screenshot({ path: path.join(outDir, `card-${vp.name}.png`) });
    let tapOpened = null;
    if (card.button) {
      if (touch) await page.touchscreen.tap(card.tapPoint.x, card.tapPoint.y);
      else await page.mouse.click(card.tapPoint.x, card.tapPoint.y);
      await page.waitForTimeout(1500);
      tapOpened = await frontArtifact(page);
      await page.screenshot({ path: path.join(outDir, `after-tap-${vp.name}.png`) });
    }

    // S1: LÉLU opens B while Settings covers the screen; the person closes Settings by hand.
    await openSettings(page);
    await page.waitForTimeout(1200);
    await openArtifact(page, idB);
    await page.waitForTimeout(800);
    const closed1 = await closeSettingsByHand(page, touch);
    const s1 = await frontArtifact(page);
    await page.screenshot({ path: path.join(outDir, `s1-after-cover-${vp.name}.png`) });

    // S2: A then B requested, THEN Settings opened over them; the person closes Settings by hand.
    await openArtifact(page, idA);
    await page.waitForTimeout(600);
    await openArtifact(page, idB);
    await page.waitForTimeout(600);
    await openSettings(page);
    await page.waitForTimeout(1200);
    const closed2 = await closeSettingsByHand(page, touch);
    const s2 = await frontArtifact(page);
    await page.screenshot({ path: path.join(outDir, `s2-after-cover-${vp.name}.png`) });

    const r = {
      viewport: vp.name, card, tapOpened, tapOpenedRight: tapOpened === A,
      afterCover: { s1, s2, closedByHand: [closed1, closed2] },
      afterCoverRight: s1 === B && s2 === B,
      ids: { idA, idB }, errors: errors.slice(0, 3),
    };
    results.push(r);
    console.log(JSON.stringify(r));
    await ctx.close();
  }
  fs.writeFileSync(path.join(outDir, "studio-card-touch.json"), JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results }, null, 1) + "\n");
  await browser.close();
  process.exitCode = results.every((r) => r.card.tapHitsButton && r.card.visibleFraction === 1 && r.tapOpenedRight && r.afterCoverRight) ? 0 : 1;
}
run();
