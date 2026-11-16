/**
 * LÉLU — a press on the BODY of a surface versus its header.
 *
 * The probe showed a header press selects correctly. Mission 3.4's failure
 * was a press on the visual body (an SVG chart/diagram), which left every
 * data-selected false. This records, per card, what the body press reaches:
 * the capture-phase click target, whether selectView was called, and the
 * resulting engine/DOM state.
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = { at: new Date().toISOString(), cards: [], errors: [] };
const save = () => writeFileSync(`${OUT}/body-select.json`, JSON.stringify(result, null, 2));

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
  await page.waitForTimeout(2000);

  await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("genesis");
    await env.composeEnvironment({
      title: "Body press",
      surfaces: [{ kind: "file", title: "Findings", text: "Evidence collected across three sources." }],
    });
    const registry = (globalThis.__probe ??= { clicks: [], selects: [] });
    registry.clicks.length = 0;
    registry.selects.length = 0;
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
  });
  await page.waitForSelector("[data-workspace-view]", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => {
      const rect = node.getBoundingClientRect();
      const body = document.elementFromPoint(Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height / 2));
      const header = document.elementFromPoint(Math.round(rect.x) + 20, Math.round(rect.y) + 22);
      return {
        id: node.getAttribute("data-workspace-view"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        body: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), tag: body?.tagName.toLowerCase() ?? null },
        header: { x: Math.round(rect.x) + 20, y: Math.round(rect.y) + 22, tag: header?.tagName.toLowerCase() ?? null },
      };
    }),
  );

  for (const card of cards) {
    const record = { id: card.id, rect: card.rect };
    // Body press first.
    await page.evaluate(async () => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      ws.selectView(null);
      globalThis.__probe.clicks.length = 0;
      globalThis.__probe.selects.length = 0;
    });
    await page.mouse.move(card.body.x, card.body.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    record.body = await page.evaluate(async (id) => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      return {
        hit: document.elementFromPoint(window.__lastX ?? 0, window.__lastY ?? 0)?.tagName ?? null,
        engineSelected: ws.getState().selectedId,
        domSelected: document.querySelector(`[data-workspace-view="${id}"]`)?.getAttribute("data-selected") ?? null,
        clicks: globalThis.__probe.clicks.slice(-3),
        selects: globalThis.__probe.selects.slice(-3),
      };
    }, card.id);

    // Header press for comparison.
    await page.evaluate(async () => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      ws.selectView(null);
      globalThis.__probe.clicks.length = 0;
      globalThis.__probe.selects.length = 0;
    });
    await page.mouse.move(card.header.x, card.header.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
    record.header = await page.evaluate(async (id) => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      return {
        engineSelected: ws.getState().selectedId,
        domSelected: document.querySelector(`[data-workspace-view="${id}"]`)?.getAttribute("data-selected") ?? null,
        clicks: globalThis.__probe.clicks.slice(-3),
        selects: globalThis.__probe.selects.slice(-3),
      };
    }, card.id);
    result.cards.push(record);
    save();
  }
  await page.screenshot({ path: `${OUT}/shots/body-select.png` });
} catch (error) {
  result.errors.push(String(error).slice(0, 500));
} finally {
  save();
  await browser.close();
}
