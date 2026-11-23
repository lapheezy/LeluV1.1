/**
 * M15.3 WP03: what happens when the Avatar panel's close control is tapped?
 *
 * Separates three things the WP02 acceptance step folded into one check:
 *   1. which element the harness's close locator resolves to (label, rect,
 *      what is really under its centre),
 *   2. whether the PANEL closed (DOM: its window and preview spot are gone),
 *   3. when HER presence attribute followed (data-presence leaves "preview").
 * Each is polled with timestamps after a real tap (touch) or click (mouse).
 *
 * Usage: node scripts/avatar/probe-panel-close.mjs <tag> [phone|desktop] [cycles] [tap|click-force]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const [tag = "probe", dev = "phone", cyclesArg = "4", how = "tap"] = process.argv.slice(2);
const OUT = "docs/missions/m15-home/avatar-15.3/wp03/panel";
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.LELU_URL ?? "http://127.0.0.1:5173/";
const vp = dev === "phone" ? { width: 393, height: 852 } : { width: 1440, height: 900 };
const mobile = vp.width < 1000;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
const p = await ctx.newPage();
await p.goto(URL, { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) {
  const c = p.getByRole("button", { name: "Continue without an account" });
  if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
  if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
  await p.waitForTimeout(500);
}
await p.waitForTimeout(2500);
const meta = await p.evaluate(() => ({ dpr: devicePixelRatio, inner: [innerWidth, innerHeight], visual: [visualViewport?.width, visualViewport?.height, visualViewport?.scale] }));
const state = () => p.evaluate(() => {
  const host = document.querySelector("[data-lelu-preview-host]");
  const hr = host?.getBoundingClientRect();
  const c = document.querySelector('[data-testid="lelu-companion"]');
  const k = document.querySelector('[data-testid="lelu-companion-character"]');
  const windows = [...document.querySelectorAll("[data-lelu-module-window]")].map((w) => w.dataset.leluModuleWindow);
  return {
    t: Math.round(performance.now()),
    panelHost: Boolean(host && hr && hr.width > 0 && hr.height > 0),
    windows,
    avatarTitle: [...document.querySelectorAll("button, [role=tab]")].some((e) => /^Avatar$/.test(e.textContent.trim()) && e.getBoundingClientRect().width > 0),
    presence: c?.dataset.presence, lowPower: c?.dataset.lowPower, frames: Number(k?.dataset.frames ?? 0),
  };
});
const openPanel = async () => {
  const btn = p.locator('button[aria-label="Open the app library"]');
  if (mobile) await btn.tap(); else await btn.click();
  await p.waitForTimeout(800);
  await p.locator(".lsh-app", { hasText: /^Avatar/ }).first().click();
  await p.waitForTimeout(3500);
  await p.getByRole("button", { name: "3D", exact: true }).first().click();
  for (let i = 0; i < 20 && (await state()).presence !== "preview"; i++) await p.waitForTimeout(250);
  await p.waitForTimeout(1200);
};
// The WP02 harness's locator, verbatim.
const close = p.locator('.lws-icon[aria-label^="Close "]:visible, [data-lelu-module-window] button[aria-label^="Close "]:not([aria-label^="Close tab"]):visible, button[aria-label="Close window"]:visible').first();
const cycles = [];
for (let cycle = 1; cycle <= Number(cyclesArg); cycle++) {
  await openPanel();
  const before = await state();
  const target = await close.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const all = [...document.querySelectorAll('.lws-icon[aria-label^="Close "], [data-lelu-module-window] button[aria-label^="Close "]:not([aria-label^="Close tab"]), button[aria-label="Close window"]')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => e.getAttribute("aria-label"));
    return { label: el.getAttribute("aria-label"), rect: [r.left, r.top, r.width, r.height].map(Math.round), hitIsTarget: Boolean(hit && (hit === el || el.contains(hit))), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}[${hit.getAttribute("aria-label") ?? ""}]` : null, candidates: all };
  }).catch((e) => ({ error: String(e).slice(0, 200) }));
  // Event routing on the target: what the browser actually delivered.
  await p.evaluate(() => {
    window.__ev = [];
    for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "click"]) document.addEventListener(type, (e) => window.__ev.push({ type, t: Math.round(performance.now()), target: e.target?.getAttribute?.("aria-label") ?? e.target?.tagName, pointerType: e.pointerType ?? null, defaultPrevented: e.defaultPrevented }), { capture: true, once: false });
  });
  const tapAt = await p.evaluate(() => Math.round(performance.now()));
  if (how === "tap" && mobile) await close.tap({ timeout: 5000 }).catch((e) => console.log("tap failed", String(e).slice(0, 120)));
  else await close.click({ force: true });
  const timeline = [];
  for (let i = 0; i < 40; i++) {
    const s = await state();
    timeline.push({ ms: s.t - tapAt, panelHost: s.panelHost, windows: s.windows.length, presence: s.presence, frames: s.frames });
    if (!s.panelHost && s.presence !== "preview" && i > 2) break;
    await p.waitForTimeout(250);
  }
  const events = await p.evaluate(() => window.__ev);
  const panelClosedAt = timeline.find((x) => !x.panelHost)?.ms ?? null;
  const presenceLeftAt = timeline.find((x) => x.presence !== "preview")?.ms ?? null;
  const at2s = timeline.filter((x) => x.ms <= 2000).pop();
  const rec = { cycle, how, before: { presence: before.presence, panelHost: before.panelHost, lowPower: before.lowPower, windows: before.windows }, target, events, panelClosedAt, presenceLeftAt, atTwoSeconds: at2s, timeline };
  cycles.push(rec);
  console.log(`cycle ${cycle}: target ${target.label} hit=${target.hitIsTarget} (${target.hit}); events ${events.map((e) => e.type).join(",")}; panel closed after ${panelClosedAt} ms; her presence left "preview" after ${presenceLeftAt} ms; at 2 s: panel ${at2s?.panelHost ? "OPEN" : "closed"}, presence ${at2s?.presence}; lowPower ${before.lowPower}`);
  await p.screenshot({ path: `${OUT}/${tag}-${dev}-cycle${cycle}-after-close.png` }).catch(() => {});
}
fs.writeFileSync(`${OUT}/${tag}-${dev}-${how}.json`, JSON.stringify({ tag, dev, how, viewport: vp, meta, cycles }, null, 1));
await b.close();
