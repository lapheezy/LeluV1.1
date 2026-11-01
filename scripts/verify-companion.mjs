/**
 * LÉLU — COMPANION, IN THE REAL APP
 *
 * Drives the running app (dev server) in Chromium at a phone and a
 * desktop viewport and checks what the user would see and touch:
 *
 *   - FACE: with the chat open and nothing else in use, her face is
 *     behind the conversation (inside the chat window, under the text)
 *     and takes no touches — the text and the composer still do;
 *   - WINDOW: with a workspace open, all of her is in her own window,
 *     docked in the right corner;
 *   - her window moves (top bar) and resizes (corner grip), keeps that
 *     place across a reload, and the dock button puts it back;
 *   - a request that needs all of her (sit) opens her window and she sits
 *     on her sofa;
 *   - there are no caption cards beside her;
 *   - Hide turns companion mode off.
 *
 * Usage: node scripts/verify-companion.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
let failures = 0;
const check = (name, ok, evidence) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${evidence === undefined ? "" : `\n      ${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}`}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

/** The first-run sign-in notice covers the app until dismissed (it can arrive late). */
async function dismissSignInGate(page) {
  let quiet = 0;
  for (let i = 0; i < 20 && quiet < 3; i += 1) {
    const gate = page.locator("[data-lelu-signin-gate] button", { hasText: "Continue" });
    if (await gate.count()) {
      quiet = 0;
      await gate.first().evaluate((el) => el.click()).catch(() => {});
    } else quiet += 1;
    await page.waitForTimeout(400);
  }
}

const state = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-testid='lelu-companion']");
    const ch = document.querySelector("[data-testid='lelu-companion-character']");
    const r = el?.getBoundingClientRect();
    return el
      ? {
          presence: el.dataset.presence,
          docked: el.dataset.docked,
          insideChat: Boolean(el.closest("[data-lelu-chat-window]")),
          box: [r.left, r.top, r.width, r.height].map(Math.round),
          renderer: ch?.dataset.renderer,
          ready: ch?.dataset.ready,
          playing: ch?.dataset.playing,
          captions: document.querySelectorAll("[data-testid='lelu-companion-caption']").length,
        }
      : null;
  });

const waitFor = async (page, predicate, ms = 60000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await state(page);
    if (s && predicate(s)) return s;
    await page.waitForTimeout(500);
  }
  return state(page);
};

async function openPanel(page, panel) {
  await page.evaluate(async (p) => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ type: "open_panel", target: p, reason: "verify", initiatedBy: "lelu" });
  }, panel);
  await page.waitForTimeout(1500);
}

for (const viewport of [{ name: "phone 390×844", width: 390, height: 844 }, { name: "desktop 1280×800", width: 1280, height: 800 }]) {
  console.log(`\n=== ${viewport.name} ===`);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await dismissSignInGate(page);

  // FACE: chat open, nothing else in use.
  await openPanel(page, "chat");
  const face = await waitFor(page, (s) => s.presence === "face" && s.ready === "true", 120000);
  check("in plain chat she is a face behind the conversation", face?.presence === "face" && face.insideChat, face);
  check("drawn as her 3D model", face?.renderer === "3d", face?.renderer);
  const blocks = await page.evaluate(() => {
    const el = document.querySelector("[data-testid='lelu-companion']");
    const out = [];
    for (const c of document.querySelectorAll("[data-lelu-chat-window] textarea, [data-lelu-chat-window] button, .lelu-cc-empty h2, article.lelu-cc-msg")) {
      const r = c.getBoundingClientRect();
      if (r.width <= 0) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && el && el.contains(hit)) out.push(c.tagName.toLowerCase());
    }
    return out;
  });
  check("her face takes no touches: text, buttons and composer are still what you touch", blocks.length === 0, blocks);
  check("no caption cards", face?.captions === 0, face?.captions);

  // WINDOW: a workspace open.
  await openPanel(page, "memory");
  const win = await waitFor(page, (s) => s.presence === "window" && s.ready === "true", 120000);
  check("with a workspace open she is in her own window", win?.presence === "window" && !win.insideChat, win);
  check("docked in the right corner", win?.docked === "true" && win.box[0] + win.box[2] >= viewport.width - 20, win?.box);

  // Move + resize, persisted, then docked again.
  const bar = await page.$("[data-testid='lelu-companion-bar']");
  if (bar) {
    const bb = await bar.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 - 80, bb.y + bb.height / 2 - 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const grip = await (await page.$("[data-testid='lelu-companion-resize']")).boundingBox();
    await page.mouse.move(grip.x + 5, grip.y + 5);
    await page.mouse.down();
    await page.mouse.move(grip.x - 30, grip.y - 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const moved = await state(page);
    check("dragging the bar moves her window, the grip resizes it", moved.docked === "false" && moved.box[2] > win.box[2], { before: win.box, after: moved.box });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await dismissSignInGate(page);
    await openPanel(page, "memory");
    const after = await waitFor(page, (s) => s.presence === "window", 60000);
    check("her window keeps its place across a reload", after?.docked === "false" && Math.abs(after.box[0] - moved.box[0]) < 4, { moved: moved.box, after: after?.box });
    await page.locator("button[aria-label='Dock her window']").first().evaluate((el) => el.click()).catch(() => {});
    const docked = await waitFor(page, (s) => s.docked === "true", 5000);
    check("the dock button puts it back", docked?.docked === "true", docked);
  } else check("her window has a top bar to move it by", false);

  // A request that needs all of her: from plain chat, sit.
  await openPanel(page, "chat");
  await waitFor(page, (s) => s.presence === "face", 60000);
  const sitting = page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/avatar/AvatarCommandBus.ts");
    return Bus.getInstance().issue("sit", "sit").then((o) => `ok: ${o}`, (e) => `failed: ${e}`);
  });
  const seated = await waitFor(page, (s) => s.presence === "window" && /^sit_/.test(s.playing ?? ""), 30000);
  check("asked to sit, her window opens and she sits on her sofa", seated?.presence === "window" && /^sit_/.test(seated.playing ?? ""), seated);
  const outcome = await sitting;
  check("and the renderer confirmed it", outcome.startsWith("ok"), outcome);

  // Hide.
  await page.locator("button[aria-label='Hide her window']").first().evaluate((el) => el.click()).catch(() => {});
  await page.waitForTimeout(800);
  check("Hide turns companion mode off", (await state(page)) === null);
  check("no page errors", errors.length === 0, errors.slice(0, 3));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall companion checks passed");
process.exit(failures ? 1 : 0);
