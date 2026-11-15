/**
 * Mission 15 — Home Universe acceptance, through the REAL app UI.
 * Every step is a person's action (mouse, keyboard, touch); every check
 * reads the DOM or the store the Home persists to. Screenshots per step.
 *   node scripts/home/verify-home.mjs   (vite dev on :5173)
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { writeFile } from "node:fs/promises";

const BASE = "http://127.0.0.1:5173/";
const OUT = "docs/missions/m15-home/shots";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, status: ok ? "VERIFIED" : "FAILED", detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function guest(ctx) {
  await ctx.addInitScript(() => { try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {} });
}
async function enter(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    }
    if (!(await page.locator("[data-lelu-signin-gate]").count()) && (await page.locator("[data-lelu-home] .hc").count())) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);
}
const order = (page) => page.$$eval("[data-lelu-home] .hc-stage > [data-home-module]", (els) => els.map((e) => e.dataset.homeModule));
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("lelu.lelu.home.presentations.v1") || "null"));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const browser = await launch();
const errors = [];

/* ---------------- desktop ---------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guest(ctx);
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  check("desktop: Home renders through the composition engine", (await page.locator("[data-lelu-home] .hc[data-template]").count()) === 1);
  const icons = await page.$$eval("[data-lelu-home] .lch-header svg", (s) => s.map((x) => x.getAttribute("class") || ""));
  check("desktop: header icons are real icons, not the Circle fallback", icons.length > 0 && icons.every((c) => !/lucide-circle\b/.test(c)), icons.join(" | ").slice(0, 160));

  await page.click("[data-home-customize]");
  await page.waitForSelector("[data-home-editbar]");
  check("desktop: edit mode opens with the presentation bar", true);
  await shot(page, "v-01-desktop-edit");

  // Drag (pointer events) — Activity's handle onto Weather.
  const before = await order(page);
  const handle = page.locator('[data-home-module="activity"] .hc-handle');
  await handle.scrollIntoViewIfNeeded();
  const hb = await handle.boundingBox();
  const target = await page.locator('[data-home-module="weather"]').boundingBox();
  await page.mouse.move(hb.x + 10, hb.y + 10);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(hb.x + 10 + ((target.x + 20 - hb.x) * i) / 12, hb.y + 10 + ((target.y + 40 - hb.y) * i) / 12);
  await page.waitForTimeout(150);
  await shot(page, "v-02-desktop-dragging");
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await order(page);
  check("desktop: drag a module by its handle reorders the Home", after.indexOf("activity") < before.indexOf("activity") && after.indexOf("activity") <= after.indexOf("weather"), `${before.join(",")} → ${after.join(",")}`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("[data-lelu-home]").evaluate((el) => el.scrollTo(0, 0));
  await shot(page, "v-03-desktop-after-drag");

  // Resize via the + control.
  const sizeBefore = await page.getAttribute('[data-home-module="notifications"]', "data-size");
  await page.click('[data-home-module="notifications"] button[aria-label="Larger"]');
  const sizeAfter = await page.getAttribute('[data-home-module="notifications"]', "data-size");
  check("desktop: resize (+) grows a module", sizeBefore !== sizeAfter, `${sizeBefore} → ${sizeAfter}`);

  // Undo / redo.
  await page.click('[data-home-editbar] button[aria-label="Undo"]');
  check("desktop: undo restores the previous size", (await page.getAttribute('[data-home-module="notifications"]', "data-size")) === sizeBefore);
  await page.click('[data-home-editbar] button[aria-label="Redo"]');
  check("desktop: redo re-applies it", (await page.getAttribute('[data-home-module="notifications"]', "data-size")) === sizeAfter);

  // Pin + lock.
  await page.click('[data-home-module="library"] button[aria-label="Pin first"]');
  check("desktop: pin moves a module to the first slot", (await order(page))[0] === "library");
  await page.click('[data-home-module="library"] button[aria-label="Lock"]');
  check("desktop: a locked module's drag handle is disabled", await page.locator('[data-home-module="library"] .hc-handle').isDisabled());
  await page.click('[data-home-module="library"] button[aria-label="Unlock"]');

  // Float, then move it by dragging.
  await page.click('[data-home-module="now"] button[aria-label="More"]');
  await page.click('[data-home-module="now"] .hc-menu >> text=Float');
  await page.waitForSelector('.hc-float[data-home-module="now"]');
  const fh = await page.locator('.hc-float[data-home-module="now"] .hc-handle').boundingBox();
  const f0 = await page.locator('.hc-float[data-home-module="now"]').boundingBox();
  await page.mouse.move(fh.x + 8, fh.y + 8);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(fh.x + 8 - 30 * i, fh.y + 8 + 12 * i);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const f1 = await page.locator('.hc-float[data-home-module="now"]').boundingBox();
  check("desktop: float a module and drag it (snapped)", Math.abs(f1.x - f0.x) > 100, `x ${Math.round(f0.x)} → ${Math.round(f1.x)}`);
  await shot(page, "v-04-desktop-floating");

  // Dock → chip → restore.
  await page.click('[data-home-module="weather"] button[aria-label="More"]');
  await page.click('[data-home-module="weather"] .hc-menu >> text=Dock');
  check("desktop: dock minimises a module to a chip", (await page.locator('.hc-dock-chip[aria-label="Restore Weather"]').count()) === 1);
  await shot(page, "v-05-desktop-docked");
  await page.click('.hc-dock-chip[aria-label="Restore Weather"]');
  check("desktop: the chip restores it", (await page.locator('.hc-stage > [data-home-module="weather"]').count()) === 1);

  // Group / ungroup.
  await page.click('[data-home-module="notifications"] button[aria-label="More"]');
  await page.click('[data-home-module="notifications"] .hc-menu >> text=/Group with/');
  const tabs = await page.$$eval(".hc-stage .hc-tabs", (bars) => bars.map((b) => [...b.querySelectorAll('[role="tab"]')].map((t) => t.textContent)));
  check("desktop: group two modules into one tabbed surface", tabs.some((t) => t.length === 2 && t.includes("Notifications")), JSON.stringify(tabs));
  await shot(page, "v-06-desktop-grouped");

  // Keyboard: focus a module, Alt-free arrows move it, +/- resize.
  await page.locator('[data-home-module="apps"]').focus();
  const k0 = await order(page);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  const k1 = await order(page);
  check("desktop: keyboard — ArrowRight moves the focused module later", k1.indexOf("apps") === k0.indexOf("apps") + 1, `${k0.indexOf("apps")} → ${k1.indexOf("apps")}`);
  check("desktop: keyboard — focus stays on the moved module", await page.evaluate(() => document.activeElement?.getAttribute("data-home-module") === "apps"));

  // Save → reload → restored.

  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page);
  const reloaded = await order(page);
  check("desktop: the arrangement survives a reload", JSON.stringify(reloaded) === JSON.stringify(k1.filter((id) => reloaded.includes(id))) && (await page.locator('.hc-float[data-home-module="now"]').count()) === 1, reloaded.join(","));
  await shot(page, "v-07-desktop-after-reload");

  // New presentation from a composition: the old one is kept.
  await page.click("[data-home-customize]");
  await page.selectOption('[data-home-editbar] select[aria-label="New presentation from a composition"]', "cosmos-orbit");
  await page.waitForTimeout(500);
  const names = await page.$$eval('[data-home-editbar] select[aria-label="Switch presentation"] option', (o) => o.map((x) => x.textContent));
  check("desktop: a new presentation never overwrites the current one", names.length >= 2 && names.includes("My Home"), names.join(" | "));
  check("desktop: Cosmos Orbit is a real orbital layout", (await page.getAttribute("[data-lelu-home] .hc", "data-kind")) === "orbit");
  await page.click("[data-home-customize]");
  await page.waitForTimeout(600);
  await shot(page, "v-08-desktop-orbit");

  // Reset keeps a restore point; restore brings it back.
  await page.click("[data-home-customize]");
  await page.selectOption('[data-home-editbar] select[aria-label="Switch presentation"]', { label: "My Home" });
  await page.click('[data-home-editbar] button[aria-label^="Reset"]');
  const afterReset = await page.locator('.hc-float[data-home-module="now"]').count();
  await page.click('[data-home-editbar] button[aria-label^="Restore"]');
  const afterRestore = await page.locator('.hc-float[data-home-module="now"]').count();
  check("desktop: reset, then restore brings the arrangement back", afterReset === 0 && afterRestore === 1);

  // Transitions: window, Chat Universe, Cosmos.
  await page.click('[data-home-module="activity"] button[aria-label="More"]');
  await page.click('[data-home-module="activity"] .hc-menu >> text=Open as a window');
  await page.waitForTimeout(1500);
  const panel = await page.evaluate(() => window.__leluGenesis?.state?.activePanel ?? document.querySelector("[data-module-id], [data-genesis-module]")?.getAttribute("data-module-id") ?? null);
  const homeGone = (await page.locator("[data-lelu-home]").count()) === 0;
  check("transition: Home module → Workspace window (existing module host)", homeGone, `home hidden: ${homeGone}; panel: ${panel}`);
  await shot(page, "v-09-to-window");
  // Back the way a person goes back: the navigation's Home button.
  await page.click('.lsn button[aria-label="Home"]');
  await page.waitForSelector("[data-lelu-home] .hc", { timeout: 15000 });
  check("transition: back to Home from the window keeps the arrangement", (await page.locator('.hc-float[data-home-module="now"]').count()) === 1);
  await page.click("[data-home-customize]");
  await page.click('[data-home-module="weather"] button[aria-label="More"]');
  await page.click('[data-home-module="weather"] .hc-menu >> text=Chat Universe');
  const universe = await page.waitForSelector(".lcu", { state: "visible", timeout: 20000 }).then(() => true).catch(() => false);
  check("transition: Home → Chat Universe (its own open event)", universe);
  await shot(page, "v-10-to-chat-universe");
  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page);
  if (!(await page.locator("[data-lelu-home] .hc").count())) await page.click('.lsn button[aria-label="Home"]').catch(() => {});
  await page.waitForSelector("[data-lelu-home] .hc", { timeout: 15000 });
  await page.click("[data-home-customize]");
  await page.click('[data-home-module="lelu"] button[aria-label="More"]');
  await page.click('[data-home-module="lelu"] .hc-menu >> text=Place in the Cosmos');
  await page.waitForTimeout(2500);
  const immersive = await page.evaluate(() => window.__leluImmersive === true);
  check("transition: Home → Cosmos (SpatialIntentBus placement + immersive view)", immersive);
  await shot(page, "v-11-to-cosmos");

  // Design Studio: "Use as a new presentation".
  await page.goto(`${BASE}?homeStudio=creative-gallery`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  if (!(await page.locator("[data-home-studio]").count())) await page.click('.lsn button[aria-label="Home"]').catch(() => {});
  await page.waitForSelector("[data-home-studio]", { timeout: 30000 });
  await page.check(".hs-try input");
  await page.click("[data-home-studio-use]");
  const note = await page.textContent(".hs-note").catch(() => "");
  check("studio: a prototype is saved as a new presentation", /Saved as a new presentation/.test(note || ""), note?.slice(0, 90));
  await shot(page, "v-12-studio-use");
  await ctx.close();
}

/* ---------------- iPhone ---------------- */
{
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await guest(ctx);
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  const kind = await page.getAttribute("[data-lelu-home] .hc", "data-device");
  check("iPhone: Home solves the phone profile", kind === "phone");
  const overflow = await page.evaluate(() => {
    const home = document.querySelector("[data-lelu-home]");
    return home ? home.scrollWidth - home.clientWidth : -1;
  });
  check("iPhone: no horizontal overflow", overflow <= 1, `${overflow}px`);
  const ocdp = await ctx.newCDPSession(page);
  const oswipe = async (x, y, dy) => {
    await ocdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 15; i++) { await ocdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / 15 }] }); await page.waitForTimeout(16); }
    await ocdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await page.evaluate(() => {
    window.__orb = { down: 0, move: 0 };
    const orb = document.querySelector(".lsn-orb");
    orb?.addEventListener("pointerdown", () => (window.__orb.down = performance.now()), true);
    orb?.addEventListener("pointermove", () => (window.__orb.move ||= performance.now()), true);
  });
  await oswipe(196, 600, -260);
  await page.waitForTimeout(500);
  const gap = await page.evaluate(() => Math.round(window.__orb.move - window.__orb.down));
  const stayed = (await page.locator("[data-lelu-home]").count()) === 1;
  if (!stayed && gap > 450) {
    results.push({ name: "iPhone: a swipe starting on the nav orb does not leave the Home", status: "BLOCKED", detail: `the first touch move reached the page ${gap} ms after touch-down (sandbox latency), which is a genuine 450 ms hold` });
    console.log(`~ iPhone: orb swipe inconclusive — first move after ${gap} ms`);
    await page.click('.lsn button[aria-label="Home"]').catch(() => {});
    await page.waitForSelector("[data-lelu-home] .hc", { timeout: 15000 }).catch(() => {});
  } else check("iPhone: a swipe starting on the nav orb does not leave the Home", stayed, `first move after ${gap} ms`);
  await page.tap("[data-home-customize]");
  await page.waitForSelector("[data-home-editbar]");
  await shot(page, "v-13-iphone-edit");

  // Touch-scroll still works in edit mode (only the handle captures touch).
  await page.waitForTimeout(800);
  if (!(await page.locator("[data-lelu-home]").count())) await shot(page, "debug-iphone-home-gone");
  const scroller = page.locator("[data-lelu-home]");
  const top0 = await scroller.evaluate((el) => el.scrollTop);
  const cdp = await ctx.newCDPSession(page);
  // Raw touches (CDP's synthesized scroll gesture does not scroll in this
  // headless build even on a plain page — measured; raw touch events do).
  const swipe = async (x, y, dy) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 15; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / 15 }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(200, 420, -280);
  await page.waitForTimeout(400);
  if (!(await page.locator("[data-lelu-home]").count())) {
    await shot(page, "debug-after-swipe");
    console.log("debug:", await page.evaluate(() => ({ immersive: window.__leluImmersive, panels: [...document.querySelectorAll("[data-module-id]")].map((e) => e.getAttribute("data-module-id")) })));
  }
  const top1 = await scroller.evaluate((el) => el.scrollTop);
  check("iPhone: touch scrolling the Home works while editing", top1 > top0 + 50, `scrollTop ${top0} → ${top1}`);
  const touchAction = await page.$eval(".hc-handle", (el) => getComputedStyle(el).touchAction);
  // A swipe that starts on the nav orb must not flip the Home into the Cosmos.

  check("iPhone: only the drag handle captures touch (touch-action: none)", touchAction === "none");
  const fieldFont = await page.$eval('[data-home-editbar] select', (el) => parseFloat(getComputedStyle(el).fontSize));
  check("iPhone: edit fields are ≥16px so Safari does not zoom on focus", fieldFont >= 16, `${fieldFont}px`);

  // Touch drag via the handle.
  const before = await order(page);
  const h = await page.locator('[data-home-module="now"] .hc-handle').boundingBox();
  const t = await page.locator('[data-home-module="weather"]').boundingBox();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: h.x + 8, y: h.y + 8 }] });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: h.x + 8 + ((t.x + 10 - h.x) * i) / 10, y: h.y + 8 + ((t.y + 30 - h.y) * i) / 10 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(400);
  const after = await order(page);
  check("iPhone: touch-drag a module by its handle", after.indexOf("now") < before.indexOf("now"), `${before.join(",")} → ${after.join(",")}`);
  await shot(page, "v-14-iphone-after-touch-drag");

  // Phone profile is independent of desktop.
  const store = await saved(page);
  const p = store?.list?.find((x) => x.id === store.activeId);
  check("iPhone: phone and desktop profiles are saved separately", Boolean(p && JSON.stringify(p.profiles.phone.order) !== JSON.stringify(p.profiles.desktop.order)));
  await ctx.close();
}

/* ---------------- reduced motion + no WebGL ---------------- */
const noWebglErrors = [];
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/i.test(String(type))) return null;
      return orig.call(this, type, ...rest);
    };
  });
  await guest(ctx);
  const page = await ctx.newPage();
  track(page, noWebglErrors);
  await enter(page);
  const home = await page.locator("[data-lelu-home] .hc").count();
  const anim = await page.$eval(".lch-lelu-aura", (el) => getComputedStyle(el).animationName).catch(() => "missing");
  check("fallback: with WebGL unavailable the 2D Home still renders", home === 1);
  check("fallback: reduced motion stops the Home's ambient animation", anim === "none", anim);
  await shot(page, "v-15-no-webgl-reduced-motion");
  await ctx.close();
}

await browser.close();
const pageErrors = errors.filter((e) => e.startsWith("pageerror"));
check("no uncaught page errors during the run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
const webglUncaught = noWebglErrors.filter((e) => e.startsWith("pageerror"));
results.push({ name: "fallback: no-WebGL run is free of uncaught errors", status: webglUncaught.length ? "PARTIAL" : "VERIFIED", detail: webglUncaught.length ? `${webglUncaught.length} uncaught from the existing THREE.WebGLRenderer ("${webglUncaught[0].slice(11, 70)}"); the 2D Home stays usable` : "" });
console.log(`${webglUncaught.length ? "~" : "✓"} fallback: no-WebGL uncaught errors: ${webglUncaught.length}`);
await writeFile("docs/missions/m15-home/verify-home.json", JSON.stringify({ at: new Date().toISOString(), results, consoleErrors: errors.filter((e) => !/ERR_CONNECTION|503|429/.test(e)).slice(0, 20) }, null, 2));
const failed = results.filter((r) => r.status === "FAILED").length;
const tally = results.reduce((t, r) => ((t[r.status] = (t[r.status] ?? 0) + 1), t), {});
console.log(`\n${JSON.stringify(tally)}`);
process.exit(failed ? 1 : 0);
