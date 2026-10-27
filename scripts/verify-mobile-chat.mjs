/**
 * LÉLU — THE PHONE CHAT OWNS THE SCREEN
 *
 * Drives the real UI at phone viewports (iPhone and small Android, portrait
 * and landscape) and checks what is actually on the page — not what the
 * code intends:
 *   - Home renders Cosmos; opening chat removes the Cosmos scene entirely
 *     (no canvas, no v1 workspace, no phase HUD, no overview, no toasts);
 *   - every point of the screen belongs to the chat (or its tab bar);
 *   - the composer is on screen, also with the keyboard open (a shorter
 *     viewport) and after an orientation change;
 *   - typing does not bring Cosmos back and the page keeps animating;
 *   - Home ↔ Chat repeatedly: Cosmos comes back each time, no page errors.
 *
 * Usage: vite running, then
 *        node scripts/verify-mobile-chat.mjs [url]
 */

import { chromium, devices } from "playwright";

const BASE = process.argv[2] ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const VIEWPORTS = [
  ["iPhone portrait", 390, 844],
  ["iPhone landscape", 844, 390],
  ["small Android portrait", 360, 740],
  ["small Android landscape", 740, 360],
];

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

async function openChat(page) {
  if (await page.isVisible("[data-lelu-composer] textarea").catch(() => false)) return;
  await page.evaluate(async () => {
    const { default: Bus } = await import("/src/core/cognition/UIActionBus.ts");
    return Bus.getInstance().dispatch({ type: "open_panel", target: "chat", reason: "verify", initiatedBy: "lelu" });
  });
  await page.waitForSelector("[data-lelu-composer] textarea", { state: "visible", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function closeChat(page) {
  await page.click("button[aria-label='Close chat']", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(900);
}

const snapshot = (page) =>
  page.evaluate(() => {
    const chat = [...document.querySelectorAll("[data-lelu-chat-window]")].find((el) => getComputedStyle(el).display !== "none");
    const rect = chat?.getBoundingClientRect();
    let foreign = 0;
    const foreignSamples = new Set();
    if (chat) {
      for (let x = 4; x < innerWidth; x += 22) {
        for (let y = 4; y < innerHeight; y += 22) {
          const el = document.elementFromPoint(x, y);
          if (!el || chat.contains(el) || el.closest("[data-lelu-multichat]")) continue;
          foreign += 1;
          foreignSamples.add(`${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}`);
        }
      }
    }
    const composer = document.querySelector("[data-lelu-composer]")?.getBoundingClientRect();
    return {
      chatShown: Boolean(chat),
      rect: rect ? [rect.left, rect.top, rect.width, rect.height].map(Math.round) : null,
      viewport: [innerWidth, innerHeight],
      foreign,
      foreignSamples: [...foreignSamples].slice(0, 5),
      composerOnScreen: Boolean(composer && chat && composer.top >= 0 && composer.bottom <= innerHeight + 1 && composer.height > 0),
      canvases: document.querySelectorAll("canvas").length,
      v1Workspace: document.querySelectorAll("[data-workspace='genesis-v1']").length,
      hud: /\bAtmosphere\b/.test(document.body.innerText),
      overview: /Cosmos Overview/.test(document.body.innerText),
      toasts: document.querySelectorAll("[data-lelu-notifications]").length,
      chatError: Boolean(document.querySelector("[data-lelu-chat-error]")),
    };
  });

const fps = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        const frame = () => {
          frames += 1;
          if (performance.now() - start < 1000) requestAnimationFrame(frame);
          else resolve(frames);
        };
        requestAnimationFrame(frame);
      }),
  );

for (const [name, width, height] of VIEWPORTS) {
  console.log(`\n=== ${name} ${width}×${height} ===`);
  const context = await browser.newContext({ ...devices["iPhone 13"], viewport: { width, height } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-lelu-signin-gate]", { timeout: 30000, state: "attached" }).catch(() => {});
  await page.evaluate(() => {
    const gate = document.querySelector("[data-lelu-signin-gate]");
    [...(gate?.querySelectorAll("button") ?? [])].find((b) => /Continue/.test(b.innerText))?.click();
  });
  await page.waitForTimeout(3500);

  const home = await snapshot(page);
  check("Home renders Cosmos", home.canvases > 0 || home.v1Workspace > 0, `canvases ${home.canvases}`);

  await openChat(page);
  const open = await snapshot(page);
  check("chat is shown", open.chatShown);
  check("chat covers the whole viewport", JSON.stringify(open.rect) === JSON.stringify([0, 0, width, height]), `${JSON.stringify(open.rect)}`);
  check("no Cosmos scene is rendered under it", open.canvases === 0 && open.v1Workspace === 0 && !open.hud && !open.overview, JSON.stringify({ canvases: open.canvases, v1: open.v1Workspace, hud: open.hud, overview: open.overview }));
  check("nothing else owns any point of the screen", open.foreign === 0, open.foreignSamples.join(", "));
  check("no toast stack over the chat", open.toasts === 0);
  check("composer on screen", open.composerOnScreen);

  await page.click("[data-lelu-composer] textarea", { timeout: 5000 });
  await page.keyboard.type("Typing must not wake the Cosmos.", { delay: 12 });
  const typed = await snapshot(page);
  check("typing leaves Cosmos unrendered", typed.canvases === 0 && typed.v1Workspace === 0);
  const frames = await fps(page);
  check("the page keeps animating while chat is open", frames >= 20, `${frames} frames/s`);

  // Keyboard open: the visible area shrinks.
  await page.setViewportSize({ width, height: Math.round(height * 0.55) });
  await page.waitForTimeout(600);
  const keyboard = await snapshot(page);
  check("composer on screen with the keyboard open", keyboard.composerOnScreen, JSON.stringify(keyboard.rect));
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);

  // Orientation change.
  await page.setViewportSize({ width: height, height: width });
  await page.waitForTimeout(800);
  const rotated = await snapshot(page);
  check("after rotation the chat still owns the screen", JSON.stringify(rotated.rect) === JSON.stringify([0, 0, height, width]) && rotated.canvases === 0, JSON.stringify(rotated.rect));
  check("after rotation the composer is on screen", rotated.composerOnScreen);
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(600);

  // Home ↔ Chat.
  let cosmosBack = 0;
  for (let i = 0; i < 4; i += 1) {
    await closeChat(page);
    const atHome = await snapshot(page);
    if (!atHome.chatShown && (atHome.canvases > 0 || atHome.v1Workspace > 0)) cosmosBack += 1;
    await openChat(page);
  }
  check("Home brings Cosmos back every time", cosmosBack === 4, `${cosmosBack}/4`);
  const after = await snapshot(page);
  check("and chat owns the screen again", after.chatShown && after.canvases === 0 && after.composerOnScreen);
  const draft = await page.inputValue("[data-lelu-composer] textarea").catch(() => "");
  check("the draft survives Home ↔ Chat", draft.includes("Typing must not wake the Cosmos."));
  check("no error boundary fallback", !after.chatError);
  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await context.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
