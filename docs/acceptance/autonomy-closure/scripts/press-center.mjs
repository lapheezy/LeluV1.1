/**
 * LÉLU — WHERE A PHONE PRESS ACTUALLY LANDS
 *
 * A tap that does not select is either a card that is not listening or an
 * element on top of the card. This reports the hit-test at the point, the card
 * rect, and the engine's selectedId before and after, so the two are never
 * confused.
 */

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure/press-center.json";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
const result = { at: new Date().toISOString(), steps: [], errors: [] };

const browser = await chromium.launchPersistentContext("/tmp/closure-press-center", {
  headless: true,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  deviceScaleFactor: 1,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

const describeAt = (page, x, y) =>
  page.evaluate(({ x: px, y: py }) => {
    const hit = document.elementFromPoint(px, py);
    const card = hit?.closest("[data-workspace-view]") ?? null;
    return {
      tag: hit?.tagName ?? null,
      inCard: Boolean(card),
      cardId: card?.getAttribute("data-workspace-view") ?? null,
      html: (hit?.outerHTML ?? "").slice(0, 120),
    };
  }, { x, y });

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 240)));
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The gate must not be here at all in a guest session with no identity
  // configured; if it is, that is the finding, not something to click past.
  await page.waitForTimeout(2000);
  result.steps.push({
    step: "boot",
    gateCount: await page.locator("[data-lelu-signin-gate]").count(),
    overlays: await page.evaluate(() =>
      Array.from(document.querySelectorAll("body *"))
        .filter((node) => {
          const style = getComputedStyle(node);
          return (
            style.position === "fixed" &&
            Number(style.zIndex || 0) >= 500 &&
            style.pointerEvents !== "none" &&
            node.getBoundingClientRect().width > window.innerWidth * 0.8
          );
        })
        .map((node) => `${node.tagName.toLowerCase()}[${node.getAttribute("data-lelu-signin-gate") !== null ? "signin-gate" : ""}] z=${getComputedStyle(node).zIndex}`)
        .slice(0, 6),
    ),
  });

  await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("visual");
    await env.composeEnvironment({
      title: "Press probe",
      surfaces: [
        { kind: "file", title: "Alpha", text: "First surface body" },
        { kind: "file", title: "Beta", text: "Second surface body" },
      ],
    });
  });
  await page.waitForSelector("[data-workspace-view]", { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const card = await page.evaluate(() => {
    const node = document.querySelector("[data-workspace-view]");
    const rect = node.getBoundingClientRect();
    return { id: node.getAttribute("data-workspace-view"), rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } };
  });
  const x = Math.round(card.rect.x + card.rect.w / 2);
  const y = Math.round(card.rect.y + Math.min(card.rect.h - 20, 90));
  result.steps.push({ step: "geometry", card, point: { x, y } });
  result.steps.push({ step: "hit-test", at: await describeAt(page, x, y) });

  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(500);
  result.steps.push({
    step: "after-tap",
    engineSelected: await page.evaluate(async () => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      return ws.getState().selectedId;
    }),
    dom: await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => ({
        id: node.getAttribute("data-workspace-view"),
        selected: node.getAttribute("data-selected"),
      })),
    ),
  });
} catch (error) {
  result.errors.push(String(error).slice(0, 400));
} finally {
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  await browser.close();
}
