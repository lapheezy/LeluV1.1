/**
 * LÉLU — the first press after a fresh sign-in.
 *
 * A fresh profile presses a surface once and nothing is selected; the next
 * script (warm profile) presses and it works. This records the whole timeline
 * for that first press: capture-phase pointerdown/click targets, every call
 * into WorkspaceEngine.selectView with the CALLER'S STACK, and the state one
 * second later. The stack names whoever clears the selection.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = { at: new Date().toISOString(), timeline: [], errors: [] };
const save = () => writeFileSync(`${OUT}/first-press.json`, JSON.stringify(result, null, 2));

const browser = await chromium.launchPersistentContext("/tmp/closure-first-press", {
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 300)));
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const gate = page.locator("[data-lelu-signin-gate] button", { hasText: /without an account/i });
  if (await gate.count()) {
    await gate.first().click({ timeout: 15_000 }).catch(() => {});
    await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 30_000 }).catch(() => {});
  }
  await page.waitForTimeout(2500);

  const target = await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("genesis");
    const res = await env.composeEnvironment({
      title: "First press",
      surfaces: [{ kind: "file", title: "Findings", text: "Evidence collected across three sources." }],
    });

    const log = (globalThis.__pressLog ??= { events: [], selects: [] });
    log.events.length = 0;
    log.selects.length = 0;
    for (const type of ["pointerdown", "pointerup", "click"]) {
      document.addEventListener(type, (event) => {
        const node = event.target instanceof Element ? event.target : null;
        log.events.push({
          type,
          at: Date.now(),
          target: node?.tagName?.toLowerCase() ?? null,
          inCard: Boolean(node?.closest("[data-workspace-view]")),
          view: node?.closest("[data-workspace-view]")?.getAttribute("data-workspace-view") ?? null,
        });
      }, true);
    }
    const original = ws.selectView.bind(ws);
    ws.selectView = (next) => {
      const stack = new Error().stack?.split("\n").slice(1, 6).map((line) => line.trim().slice(0, 160)) ?? [];
      log.selects.push({ at: Date.now(), next, stack });
      return original(next);
    };
    return res.createdViews[0].id;
  });

  await page.waitForSelector(`[data-workspace-view="${target}"]`, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const point = await page.evaluate((id) => {
    const node = document.querySelector(`[data-workspace-view="${id}"]`);
    const rect = node.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const top = document.elementFromPoint(x, y);
    return { x, y, hit: top?.tagName.toLowerCase() ?? null, inCard: Boolean(top?.closest("[data-workspace-view]")) };
  }, target);
  result.point = point;

  const snapshot = () => page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const log = globalThis.__pressLog;
    return {
      engineSelected: ws.getState().selectedId,
      events: log.events.slice(-8),
      selects: log.selects.slice(-6),
    };
  });

  // FIRST press only.
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  result.timeline.push({ when: "immediately", ...(await snapshot()) });
  await page.waitForTimeout(400);
  result.timeline.push({ when: "after-400ms", ...(await snapshot()) });
  await page.waitForTimeout(1200);
  result.timeline.push({ when: "after-1600ms", ...(await snapshot()) });
  save();

  // SECOND press, for contrast.
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  result.timeline.push({ when: "second-press", ...(await snapshot()) });
  await page.screenshot({ path: `${OUT}/shots/first-press.png` });
} catch (error) {
  result.errors.push(String(error).slice(0, 500));
} finally {
  save();
  await browser.close();
}
