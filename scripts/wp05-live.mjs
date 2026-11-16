/**
 * M16.3 WP05 — LIVE acceptance on the reconciled branch.
 *
 * Drives the real app with the real composer and reads the real object store
 * from storage after every turn. Nothing is typed as an id: the point is that
 * "it" keeps meaning the same object across turns.
 *
 * Evidence: LIVE (browser) + STORE (the persisted object state) + VISUAL
 * (screenshots, classified separately in the report — a screenshot alone does
 * not prove a rotation).
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const ORIGIN = process.env.LELU_ORIGIN ?? "http://127.0.0.1:3003";
const OUT = process.env.LELU_OUT ?? "artifacts/m16-3/wp05";
mkdirSync(OUT, { recursive: true });

const report = { evidence: "LIVE", origin: ORIGIN, turns: [], errors: [] };
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const objects = () =>
  page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.includes("cosmos.objects")) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? "null");
        if (parsed?.objects) return parsed.objects;
      } catch {
        /* not this key */
      }
    }
    return [];
  });

const frameOf = (list) => (Array.isArray(list) && list.length ? { id: list[0].id, name: list[0].name, frame: list[0].frame } : null);

const composer = () => page.locator('textarea[placeholder^="Message LÉLU"]').first();
const transcript = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(-700));

async function openChat() {
  if (await composer().count()) return true;
  const candidates = [
    'button:has-text("Continue without an account")',
    'button[aria-label*="Summon the chat" i]',
    'button[aria-label*="open chat" i]',
    'button:text-is("Chat")',
  ];
  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if (await el.count().catch(() => 0)) {
      await el.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (await composer().count()) return true;
    }
  }
  return Boolean(await composer().count());
}

async function say(text) {
  // The chat is a module window that can sit over its own composer, so the
  // text goes in by focus and keyboard rather than a pointer click.
  const box = composer();
  await box.focus();
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
}

/** Wait for the store to satisfy a condition, rather than assuming a turn finished. */
async function until(check, ms = 60_000) {
  const from = Date.now();
  while (Date.now() - from < ms) {
    if (await check()) return true;
    await page.waitForTimeout(800);
  }
  return false;
}

try {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const opened = await openChat();
  report.composerFound = opened;
  if (!opened) {
    await page.screenshot({ path: `${OUT}/live-00-no-composer.png` });
    throw new Error("composer not reachable");
  }

  /* ---- 1. build a chair (deterministic construction, no id typed) ---- */
  await say("build a chair");
  await page.waitForTimeout(9000);
  report.turns.push({ said: "build a chair", reply: await transcript() });
  await page.screenshot({ path: `${OUT}/live-01-built.png` });

  /* ---- 2. put it in the Cosmos ---- */
  await say("put it in the Cosmos");
  const spawned = await until(async () => (await objects()).length > 0, 90_000);
  const afterSpawn = await objects();
  report.turns.push({ said: "put it in the Cosmos", spawned, object: frameOf(afterSpawn), reply: await transcript() });
  await page.screenshot({ path: `${OUT}/live-02-in-cosmos.png` });
  if (!spawned) throw new Error("no object appeared in the Cosmos");

  /* ---- 3. select it, with no id ---- */
  await say("select it");
  await page.waitForTimeout(4000);
  const afterSelect = await objects();
  report.turns.push({ said: "select it", object: frameOf(afterSelect) });
  await page.screenshot({ path: `${OUT}/live-03-selected.png` });

  /* ---- 4. rotate it ---- */
  await say("rotate it 90 degrees");
  const rotated = await until(async () => Math.abs((await objects())[0]?.frame?.rotation?.[1] ?? 0) >= 89, 60_000);
  report.turns.push({ said: "rotate it 90 degrees", rotated, object: frameOf(await objects()) });
  await page.screenshot({ path: `${OUT}/live-04-rotated.png` });

  /* ---- 5. double it ---- */
  await say("make it twice as large");
  const scaled = await until(async () => ((await objects())[0]?.frame?.scale ?? 0) > 1.8, 60_000);
  report.turns.push({ said: "make it twice as large", scaled, object: frameOf(await objects()) });
  await page.screenshot({ path: `${OUT}/live-05-scaled.png` });

  /* ---- 6. move it left ---- */
  const beforeMove = frameOf(await objects());
  await say("move it to the left");
  const moved = await until(async () => ((await objects())[0]?.frame?.position?.[0] ?? 0) < (beforeMove?.frame?.position?.[0] ?? 0) - 0.5, 60_000);
  const afterMove = await objects();
  report.turns.push({ said: "move it to the left", moved, before: beforeMove, object: frameOf(afterMove) });
  await page.screenshot({ path: `${OUT}/live-06-moved.png` });

  /* ---- 7. open the Cosmos so the scene is not behind the chat ---- */
  await say("open the Cosmos");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/live-07-cosmos.png` });

  /* ---- 8. reload: the identity and the transforms must survive ---- */
  const before = frameOf(afterMove);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const afterReload = await objects();
  report.afterReload = frameOf(afterReload);
  await page.screenshot({ path: `${OUT}/live-08-reloaded.png` });

  const same = (a, b, tol = 0.02) => Array.isArray(a) && Array.isArray(b) && a.every((v, i) => Math.abs(v - b[i]) <= tol);
  report.checks = {
    spawned: spawned === true,
    sameObjectId: Boolean(before?.id) && before?.id === report.afterReload?.id,
    rotationKept: same(before?.frame?.rotation, report.afterReload?.frame?.rotation, 0.5),
    scaleKept: Math.abs((report.afterReload?.frame?.scale ?? 0) - (before?.frame?.scale ?? 0)) < 0.01,
    positionKept: same(before?.frame?.position, report.afterReload?.frame?.position),
    rotated: rotated === true,
    scaled: scaled === true,
    moved: moved === true,
  };
  report.ok = Object.values(report.checks).every(Boolean);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: `${OUT}/live-error.png` }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/live-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
