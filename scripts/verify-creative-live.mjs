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
  // A second composer mounts after the first message; the newest one is the
  // live one. Typing into the older node silently goes nowhere.
  const box = page.locator('textarea[placeholder^="Message LÉLU"]').last();
  await box.waitFor({ state: "attached", timeout: 120_000 });
  await box.click({ force: true });
  await box.fill(text);

  // The composer sometimes refuses input while the previous turn is still
  // being answered, silently dropping the message. Confirm acceptance: the
  // text must be in the composer, then gone after Enter. Retry a bounded
  // number of times rather than assuming the turn was sent.
  const handle = await box.elementHandle();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await box.click({ force: true });
    if (!(await box.inputValue()).trim()) await box.fill(text);
    await page.waitForTimeout(400);
    await page.keyboard.press("Enter");
    const accepted = await page
      .waitForFunction((el) => el.value.trim().length === 0, handle, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (accepted) return;
    await page.waitForTimeout(3000);
  }
  throw new Error(`composer never accepted: ${text}`);
};

/** LÉLU's own activity log — the per-turn proof that a turn was processed. */
const activity = () =>
  page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("lelu.lelu.runtime.activity.v1") || "[]");
      const list = Array.isArray(parsed) ? parsed : (parsed.entries ?? parsed.events ?? []);
      return list.slice(-6).map((entry) => (typeof entry === "string" ? entry : String(entry.text ?? entry.label ?? "")));
    } catch {
      return [];
    }
  });

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

  /** Wait for the effect of a turn, rather than assuming it finished. */
  const waitFor = async (check, ms = 110_000) => {
    const from = Date.now();
    while (Date.now() - from < ms) {
      if (await check()) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };

  await say("select the chair");
  await waitFor(async () => (await selection()) === "obj-product-1");
  const afterSelect = await selection();
  await page.screenshot({ animations: "disabled", timeout: 15_000, path: `${OUT}/live-01-selected.png` });
  report.turns.push({ said: "select the chair", selection: afterSelect, activity: await activity() });

  await say("rotate it 90 degrees");
  await waitFor(async () => Math.round((await transforms())?.[0]?.rotation?.[2] ?? 0) === 90);
  const afterRotate = await transforms();
  await page.screenshot({ animations: "disabled", timeout: 15_000, path: `${OUT}/live-02-rotated.png` });
  report.turns.push({
    said: "rotate it 90 degrees",
    rotation: afterRotate?.[0]?.rotation ?? null,
    objectId: afterRotate?.[0]?.id ?? null,
    activity: await activity(),
  });

  await say("make it twice as large");
  await waitFor(async () => ((await transforms())?.[0]?.scale?.[0] ?? 0) > 1.9);
  const afterScale = await transforms();
  await page.screenshot({ animations: "disabled", timeout: 15_000, path: `${OUT}/live-03-scaled.png` });
  report.turns.push({
    said: "make it twice as large",
    scale: afterScale?.[0]?.scale ?? null,
    objectId: afterScale?.[0]?.id ?? null,
    activity: await activity(),
  });

  // A fourth turn: "it" must still be the same canonical object after three
  // operations, and a direction-only instruction must move it.
  const positionBeforeMove = afterScale?.[0]?.position ?? null;
  await say("move it to the left");
  await waitFor(async () => {
    const now = (await transforms())?.[0]?.position?.[0] ?? 0;
    return (positionBeforeMove?.[0] ?? 0) - now > 100;
  });
  const afterMove = await transforms();
  await page.screenshot({ animations: "disabled", timeout: 15_000, path: `${OUT}/live-04-moved.png` });
  report.turns.push({
    said: "move it to the left",
    position: afterMove?.[0]?.position ?? null,
    movedFrom: positionBeforeMove,
    rotation: afterMove?.[0]?.rotation ?? null,
    scale: afterMove?.[0]?.scale ?? null,
    objectId: afterMove?.[0]?.id ?? null,
    activity: await activity(),
  });

  report.before = before;
  report.after = afterMove;
  // A transform that does not survive a reload happened only in memory.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await openChat();
  await page.waitForTimeout(1500);
  const afterReload = await transforms();
  await page.screenshot({ path: `${OUT}/live-05-reloaded.png` });
  report.afterReload = afterReload;

  // The chat panel covers the scene, so the persisted result gets its own
  // unobstructed frame. Pixels plus numbers: the store says what it is, the
  // mesh says whether it is actually drawn that way.
  await page.keyboard.press("Escape").catch(() => {});
  const look = page.locator('button[aria-label^="Look at the Cosmos"]').first();
  if (await look.count()) {
    await look.click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: `${OUT}/live-06-scene.png` });

  report.errors = errors;
  const movedX = (positionBeforeMove?.[0] ?? 0) - (afterMove?.[0]?.position?.[0] ?? 0);
  report.ok =
    JSON.stringify(afterReload?.[0]?.rotation) === JSON.stringify(afterMove?.[0]?.rotation) &&
    JSON.stringify(afterReload?.[0]?.scale) === JSON.stringify(afterMove?.[0]?.scale) &&
    JSON.stringify(afterReload?.[0]?.position) === JSON.stringify(afterMove?.[0]?.position) &&
    Boolean(afterSelect) &&
    afterSelect === afterMove?.[0]?.id &&
    Math.round(afterRotate?.[0]?.rotation?.[2] ?? 0) === 90 &&
    Math.round(afterMove?.[0]?.rotation?.[2] ?? 0) === 90 &&
    (afterMove?.[0]?.scale?.[0] ?? 0) > 1.9 &&
    movedX > 100;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(`${OUT}/live-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
