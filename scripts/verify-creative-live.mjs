/**
 * M16.3 WP03 — LIVE evidence: a sentence becomes a real change in the Cosmos.
 *
 * Types an instruction into LÉLU's own chat composer, in the running app, and
 * checks what happened to the canonical object. With no model provider
 * reachable, this travels LÉLU's model-free route: compile the sentence →
 * dispatchToolCall → couture.objects → the store the scene draws from. That is
 * the cognition-to-geometry path, exercised end to end in the browser.
 *
 * Evidence class: LIVE + VISUAL (screenshots) and BROWSER (geometry read from
 * the running scene). It is NOT a model-driven comprehension result: see the
 * WP03 report's autonomy levels.
 *
 *   node scripts/verify-creative-live.mjs
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const URL = process.env.LÉLU_URL ?? "http://localhost:3003/?perf-world";
const OUT = "artifacts/m16-3/wp03";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));

const report = { evidence: "LIVE", turns: [], ok: false };
const selection = () =>
  page.evaluate(() =>
    document.querySelector("[data-lelu-creative-selection]")?.getAttribute("data-lelu-creative-selection") ?? null,
  );
const transforms = () => page.evaluate(() => window.__leluCreativeDebug?.transforms ?? null);

const openChat = async () => {
  const composer = page.locator('textarea[placeholder^="Message LÉLU"]').first();
  if (await composer.count()) return;
  // A first run lands on the account prompt; continue as a guest.
  const guest = page.locator('button:has-text("Continue without an account")');
  if (await guest.count()) {
    await guest.first().click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  // The composer lives behind the Chat sheet; open it the way a person does.
  await page.locator('button:has-text("Chat")').first().click({ timeout: 30_000 }).catch(async () => {
    await page.locator('[aria-label="What LÉLU is doing — open chat"]').first().click({ timeout: 30_000 }).catch(() => {});
  });
  await page.waitForTimeout(2500);
};

const say = async (text) => {
  await openChat();
  const box = page.locator('textarea[placeholder^="Message LÉLU"]').first();
  await box.waitFor({ state: "attached", timeout: 120_000 });
  await box.click({ force: true });
  await box.fill(text);
  await page.keyboard.press("Enter");
  // The reply arrives through the activity timeline; wait for it to settle.
  await page.waitForTimeout(9000);
};

try {
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForTimeout(2500);
  // The chat sheet and its composer live on the home surface; open that first,
  // then build the chair from the dock (the dock is in the interface tree, so
  // it is present on both surfaces).
  await openChat();

  const build = page.locator('[data-lelu-action="build-chair"]');
  await build.waitFor({ state: "visible", timeout: 120_000 });
  await build.click();
  await page.waitForTimeout(2500);
  const before = await transforms();

  await say("select the chair");
  const afterSelect = await selection();
  await page.screenshot({ path: `${OUT}/live-01-selected.png` });
  report.turns.push({ said: "select the chair", selection: afterSelect });

  await say("rotate it 90 degrees");
  const afterRotate = await transforms();
  await page.screenshot({ path: `${OUT}/live-02-rotated.png` });
  report.turns.push({
    said: "rotate it 90 degrees",
    rotation: afterRotate?.[0]?.rotation ?? null,
  });

  await say("make it twice as large");
  const afterScale = await transforms();
  await page.screenshot({ path: `${OUT}/live-03-scaled.png` });
  report.turns.push({ said: "make it twice as large", scale: afterScale?.[0]?.scale ?? null });

  report.before = before;
  report.after = afterScale;
  report.errors = errors;
  report.ok =
    Boolean(afterSelect) &&
    Math.round(afterRotate?.[0]?.rotation?.[2] ?? 0) === 90 &&
    (afterScale?.[0]?.scale?.[0] ?? 0) > 1.9;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(`${OUT}/live-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
