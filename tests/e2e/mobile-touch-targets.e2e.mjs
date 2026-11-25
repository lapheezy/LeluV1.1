/**
 * ==========================================================
 * LÉLU — EVERY HOME CONTROL TAKES ITS OWN TAP (browser regression)
 *
 *   node tests/e2e/mobile-touch-targets.e2e.mjs <base-url> <out-dir>
 *
 * MEASURED (Mission 3.5, production build, iPhone-sized Chromium): taps on
 * Home went to the wrong thing. "Infinite Library", "Development" and
 * "Business" on an iPhone 15 Pro Max, and "Jewelry"/"Fashion" on an iPhone
 * SE, were under LÉLU's floating body, so a tap opened her instead.
 * Cause: the phone Home's hero spot measured 0 px wide (a desktop
 * `grid-column: 2` rule applied inside a one-column grid). With no hero
 * spot she rested in the bottom-right corner, on top of the cards.
 *
 * Checks, at iPhone SE, iPhone 15 and iPhone 15 Pro Max:
 *   1. on Home she stands in the hero spot, which covers no control;
 *   2. every visible Home control is hit-tested as ITSELF at its centre,
 *      or, when it starts under the fixed bottom bar, after being scrolled
 *      into view (the bar is chrome over scrolling content, not a collision);
 *   3. Playwright's own actionability check (trial tap: "would this element
 *      receive the tap?") passes for the controls that were blocked.
 *
 * Exit code 1 if any check fails. Writes report.json and a screenshot per phone.
 * ==========================================================
 */

import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const LAUNCH = process.env.LELU_CHROMIUM_PATH ? { executablePath: process.env.LELU_CHROMIUM_PATH } : {};
const BASE = process.argv[2] ?? "http://127.0.0.1:4173";
const OUT = path.resolve(process.argv[3] ?? "mobile-touch-targets-e2e");
mkdirSync(OUT, { recursive: true });

const PHONES = [
  { name: "iphone-se", device: devices["iPhone SE"] },
  { name: "iphone-15", device: devices["iPhone 15"] ?? { ...devices["iPhone 13"], viewport: { width: 393, height: 659 } } },
  { name: "iphone-15-pro-max", device: devices["iPhone 15 Pro Max"] ?? { ...devices["iPhone 13"], viewport: { width: 430, height: 739 } } },
];
// The controls Mission 3.5 measured as taken by something else.
const ONCE_BLOCKED = [/^Infinite Library$/, /^Development/, /^Business/, /^Fashion/, /^Place in world: Jewelry$/];

const checks = [];
const record = (viewport, name, ok, detail = "") => {
  checks.push({ viewport, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${viewport}] ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Runs in the page: every visible control, and what a tap at its centre reaches. */
const hitTest = () => {
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const rows = [];
  const controls = [...document.querySelectorAll("button, [role=button], a[href]")];
  controls.forEach((el, index) => {
    if (el.closest("[data-testid=lelu-companion]")) return;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && r.bottom > 0 && r.top < innerHeight)) return;
    const x = r.left + r.width / 2;
    const y = Math.min(r.top + r.height / 2, innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    const own = Boolean(top && (top === el || el.contains(top)));
    const owner = own ? null : top?.closest("button, [role=button], a[href], [data-testid]") ?? top;
    const underBar = Boolean(owner?.closest?.("[data-lelu-dock], [data-lelu-mobile-menu], .lsn-item, nav")) || top === null;
    rows.push({ index, label: label(el), own, underBar, by: owner ? label(owner) || owner.tagName : null, byCompanion: Boolean(owner?.closest?.("[data-testid=lelu-companion]")) });
  });
  const c = document.querySelector("[data-testid=lelu-companion]");
  const cr = c?.getBoundingClientRect();
  const covered = cr
    ? controls
        .filter((el) => !el.closest("[data-testid=lelu-companion]"))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top;
        })
        .map(label)
    : [];
  return { rows, companion: c ? { placement: c.dataset.placement, presence: c.dataset.presence, covered } : null };
};

const browser = await chromium.launch(LAUNCH);
try {
  for (const phone of PHONES) {
    const ctx = await browser.newContext({ ...phone.device });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "load", timeout: 60_000 });
    await page.waitForSelector("[data-lelu-home]", { timeout: 30_000 });
    await page.waitForTimeout(6_000); // her placement settles after the first layout passes
    const vp = phone.name;

    const first = await page.evaluate(hitTest);
    record(vp, "LÉLU is on screen", first.companion !== null);
    record(vp, "on Home she stands in the hero spot", first.companion?.presence === "hero", `placement: ${first.companion?.placement}`);
    record(vp, "her body covers no control", (first.companion?.covered ?? ["?"]).length === 0, (first.companion?.covered ?? []).join(", "));
    const byHer = first.rows.filter((r) => r.byCompanion);
    record(vp, "no control's tap goes to LÉLU", byHer.length === 0, byHer.map((r) => r.label).join(", "));
    const collisions = first.rows.filter((r) => !r.own && !r.underBar);
    record(vp, "no control is covered by another control", collisions.length === 0, collisions.map((r) => `${r.label} → ${r.by}`).join(" | "));

    // Controls that start under the fixed bottom bar must take their tap once scrolled into view.
    const underBar = first.rows.filter((r) => !r.own && r.underBar);
    const stillBlocked = [];
    for (const row of underBar) {
      const own = await page.evaluate((index) => {
        const el = document.querySelectorAll("button, [role=button], a[href]")[index];
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(top && (top === el || el.contains(top)));
      }, row.index);
      await page.waitForTimeout(150);
      if (!own) stillBlocked.push(row.label);
    }
    record(vp, `controls under the bottom bar take their tap once scrolled (${underBar.length})`, stillBlocked.length === 0, stillBlocked.join(", "));

    // Playwright's own "would this element receive the tap" check, for the ones that were blocked.
    await page.evaluate(() => document.querySelector(".lch.lch-m15, [data-lelu-home]")?.scrollTo?.(0, 0));
    for (const name of ONCE_BLOCKED) {
      const target = page.getByRole("button", { name }).or(page.getByRole("link", { name })).first();
      if ((await target.count()) === 0) continue;
      let ok = true;
      let detail = "";
      try {
        // Centre it: "in view" for Playwright includes a card half under the fixed bottom bar.
        await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(150);
        await target.tap({ trial: true, timeout: 5_000 });
      } catch (error) {
        ok = false;
        detail = String(error.message).split("\n").find((l) => /intercepts|not visible|outside/.test(l)) ?? String(error.message).slice(0, 160);
      }
      record(vp, `trial tap reaches ${name.source}`, ok, detail);
    }

    await page.evaluate(() => document.querySelector(".lch.lch-m15, [data-lelu-home]")?.scrollTo?.(0, 0));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${vp}-home.png`) });
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, checks, failed: failed.length }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
