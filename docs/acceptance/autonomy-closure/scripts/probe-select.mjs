/**
 * LÉLU — does a press on a surface reach the selection handler?
 *
 * The interceptor diagnostic showed elementFromPoint landing INSIDE the card
 * (svg/div) and Playwright's trial click reporting the card clickable, yet
 * engine.selectedId stayed null. This probe separates the possibilities:
 *
 *   A. direct engine selectView → does the renderer paint data-selected?
 *   B. Playwright locator click on the card header → handler fires?
 *   C. raw mouse press on the hit-tested child → handler fires?
 *
 * It records the card's own click listener, a wrapper around the engine's
 * selectView, and the resulting DOM state — evidence, not a fix.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = { at: new Date().toISOString(), tests: {}, errors: [] };
const save = () => writeFileSync(`${OUT}/probe-select.json`, JSON.stringify(result, null, 2));

const browser = await chromium.launchPersistentContext("/tmp/closure-desktop", {
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

  const id = await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("genesis");
    const res = await env.composeEnvironment({
      title: "Probe",
      surfaces: [{ kind: "file", title: "Probe findings", text: "Evidence collected." }],
    });
    const target = res.createdViews[0].id;

    // Instrumentation: count renders of the card's own click handler, and
    // every call that reaches selectView (whoever makes it).
    const registry = (globalThis.__probe ??= { clicks: [], selects: [], mouse: [] });
    const original = ws.selectView.bind(ws);
    ws.selectView = (next) => {
      registry.selects.push(next);
      return original(next);
    };
    document.addEventListener("click", (event) => {
      const node = event.target instanceof Element ? event.target : null;
      registry.clicks.push({
        target: node?.tagName?.toLowerCase() ?? null,
        view: node?.closest("[data-workspace-view]")?.getAttribute("data-workspace-view") ?? null,
      });
    }, true);
    document.addEventListener("pointerdown", (event) => {
      const node = event.target instanceof Element ? event.target : null;
      registry.mouse.push({
        target: node?.tagName?.toLowerCase() ?? null,
        view: node?.closest("[data-workspace-view]")?.getAttribute("data-workspace-view") ?? null,
      });
    }, true);
    return target;
  });

  await page.waitForSelector(`[data-workspace-view="${id}"]`, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const state = () => page.evaluate(async (viewId) => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    return {
      engineSelected: ws.getState().selectedId,
      domSelected: document.querySelector(`[data-workspace-view="${viewId}"]`)?.getAttribute("data-selected") ?? null,
      probe: {
        selects: (globalThis.__probe?.selects ?? []).slice(-5),
        clicks: (globalThis.__probe?.clicks ?? []).slice(-5),
        mouse: (globalThis.__probe?.mouse ?? []).slice(-5),
      },
    };
  }, id);

  result.tests.initial = await state();

  // A. direct engine state change — does the renderer follow?
  await page.evaluate(async (viewId) => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    ws.selectView(viewId);
  }, id);
  await page.waitForTimeout(500);
  result.tests.directSelect = await state();

  await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    ws.selectView(null);
  }, id);
  await page.waitForTimeout(300);

  // B. Playwright locator click on the card's header (not the visual body).
  await page.evaluate(() => { globalThis.__probe.selects.length = 0; globalThis.__probe.clicks.length = 0; });
  await page.locator(`[data-workspace-view="${id}"]`).click({ position: { x: 18, y: 16 }, timeout: 8000 }).catch((error) => {
    result.tests.locatorClickError = String(error).slice(0, 300);
  });
  await page.waitForTimeout(600);
  result.tests.locatorClick = await state();

  await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    ws.selectView(null);
  });
  await page.waitForTimeout(300);

  // C. Raw mouse press at the hit-tested header point.
  const point = await page.evaluate((viewId) => {
    const node = document.querySelector(`[data-workspace-view="${viewId}"]`);
    const rect = node.getBoundingClientRect();
    const x = Math.round(rect.x) + 20;
    const y = Math.round(rect.y) + 22;
    const top = document.elementFromPoint(x, y);
    return { x, y, top: top ? { tag: top.tagName.toLowerCase(), inCard: Boolean(top.closest("[data-workspace-view]")) } : null };
  }, id);
  await page.evaluate(() => { globalThis.__probe.selects.length = 0; globalThis.__probe.clicks.length = 0; globalThis.__probe.mouse.length = 0; });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(600);
  result.tests.rawMouse = { point, ...(await state()) };
  await page.screenshot({ path: `${OUT}/shots/probe-select.png` });
} catch (error) {
  result.errors.push(String(error).slice(0, 500));
} finally {
  save();
  await browser.close();
}
