/**
 * M16.3 WP06 — rendered geometry evidence.
 *
 * The transforms are performed through the real composer, then the chat is
 * closed and the Cosmos is framed, so the object is photographed in the world
 * rather than behind the chat. Each frame is paired with the object's stored
 * transform and a pixel diff against the previous frame.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const OUT = "artifacts/m16-3/wp06/geometry";
mkdirSync(OUT, { recursive: true });
const ORIGIN = process.env.LELU_ORIGIN ?? "http://127.0.0.1:3003";
const STORE_KEY = "lelu.lelu.cosmos.objects.v1";

const report = { origin: ORIGIN, steps: [], errors: [] };
const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (error) => report.errors.push(String(error).slice(0, 200)));

const composer = () => page.locator('textarea[placeholder^="Message LÉLU"]').last();

const objects = () =>
  page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return (Array.isArray(parsed) ? parsed : parsed.objects ?? []).map((object) => ({
      id: object.id,
      name: object.name,
      frame: object.frame,
      camera: object.scene?.camera ?? null,
    }));
  }, STORE_KEY);

async function openChat() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await composer().count()) return;
    const openers = ['button[aria-label="Chat"]', 'button:has-text("Continue without an account")', 'button[aria-label*="Summon the chat" i]'];
    for (const selector of openers) {
      const element = page.locator(selector).first();
      if (!(await element.count().catch(() => 0))) continue;
      await element.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(1400);
      if (await composer().count()) return;
    }
    /* The Universe can open on its list; open the newest conversation. */
    const card = page.locator('[data-lelu-window^="chat:"]').last();
    if (await card.count().catch(() => 0)) {
      await card.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (await composer().count()) return;
    }
    const newChat = page.locator('button[aria-label="New chat"]').first();
    if (await newChat.count().catch(() => 0)) {
      await newChat.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  throw new Error("chat never opened");
}

async function say(text) {
  await composer().waitFor({ state: "visible", timeout: 10000 });
  await composer().focus();
  await page.evaluate((value) => {
    const box = [...document.querySelectorAll('textarea[placeholder^="Message LÉLU"]')].at(-1);
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await page.waitForTimeout(120);
  await page.keyboard.press("Enter");
  let settled = false;
  for (let waited = 0; waited < 30000 && !settled; waited += 250) {
    await page.waitForTimeout(250);
    settled = (await page.locator("[data-lelu-stop-button]").count()) === 0;
  }
  await page.waitForTimeout(600);
  return settled;
}

/** Close the chat surface so the Cosmos itself is the subject of the frame. */
async function showWorld() {
  await page.evaluate(() => {
    const universe = document.querySelector('button[aria-label="Close Chat Universe"]');
    if (universe) universe.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    for (const close of document.querySelectorAll('button[aria-label="Close window"]')) close.click();
  });
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape").catch(() => {});
  /* The canvas stops drawing while the Universe covers the screen; give the
     resumed renderer time to draw the world before the frame is taken. */
  await page.waitForTimeout(3500);
}

async function frame(label) {
  const path = `${OUT}/${String(report.steps.length + 1).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path });
  const store = await objects();
  const object = store.at(-1) ?? null;
  const step = { label, path, id: object?.id ?? null, frame: object?.frame ?? null, camera: object?.camera ?? null };
  report.steps.push(step);
  console.log(`── ${label}: ${JSON.stringify(step.frame)} → ${path}`);
  return step;
}

/** Share of pixels that changed between two frames (any channel > 8/255). */
async function pixelDiff(previous, current) {
  const [a, b] = await Promise.all([sharp(previous).raw().toBuffer({ resolveWithObject: true }), sharp(current).raw().toBuffer({ resolveWithObject: true })]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return null;
  let changed = 0;
  const channels = a.info.channels;
  for (let pixel = 0; pixel < a.info.width * a.info.height; pixel += 1) {
    const at = pixel * channels;
    if (Math.abs(a.data[at] - b.data[at]) > 8 || Math.abs(a.data[at + 1] - b.data[at + 1]) > 8 || Math.abs(a.data[at + 2] - b.data[at + 2]) > 8) changed += 1;
  }
  return Number(((changed / (a.info.width * a.info.height)) * 100).toFixed(3));
}

try {
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await openChat();

  await say("build a chair");
  await say("spawn it into the cosmos");
  await say("select the chair");
  await showWorld();
  const initial = await frame("initial");

  await openChat();
  await say("rotate it 90 degrees");
  await showWorld();
  const rotated = await frame("rotated-90");

  await openChat();
  await say("make it twice as large");
  await showWorld();
  const scaled = await frame("doubled");

  await openChat();
  await say("move it to the left");
  await showWorld();
  const moved = await frame("moved-left");

  report.pixelDiff = {
    "initial→rotated-90": await pixelDiff(initial.path, rotated.path),
    "rotated-90→doubled": await pixelDiff(rotated.path, scaled.path),
    "doubled→moved-left": await pixelDiff(scaled.path, moved.path),
  };
  report.transforms = {
    initial: initial.frame,
    rotated: rotated.frame,
    doubled: scaled.frame,
    moved: moved.frame,
  };
  console.log("pixelDiff", JSON.stringify(report.pixelDiff));
} catch (error) {
  report.fatal = error instanceof Error ? (error.stack ?? error.message).slice(0, 700) : String(error);
} finally {
  writeFileSync(`${OUT}/geometry-report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log("FATAL:", report.fatal ?? "none");
