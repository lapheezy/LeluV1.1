/**
 * LÉLU — what covers the workspace field on a fresh load.
 *
 * After guest sign-in and a compose, every surface centre hit-tests to a
 * plain div that does not belong to a card, so no press can select. This
 * names the interceptors: the full elementsFromPoint stack at a surface
 * centre, plus every fixed/absolute element covering most of the viewport
 * with pointer-events auto.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = { at: new Date().toISOString(), stack: [], overlays: [], errors: [] };
const save = () => writeFileSync(`${OUT}/overlay.json`, JSON.stringify(result, null, 2));

const browser = await chromium.launchPersistentContext(process.env.PROFILE ?? "/tmp/closure-overlay", {
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
      title: "Overlay probe",
      surfaces: [{ kind: "file", title: "Findings", text: "Evidence collected." }],
    });
    return res.createdViews[0].id;
  });
  await page.waitForSelector(`[data-workspace-view="${id}"]`, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const report = await page.evaluate((viewId) => {
    const card = document.querySelector(`[data-workspace-view="${viewId}"]`);
    if (!card) return { missing: true };
    const rect = card.getBoundingClientRect();
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const describe = (el) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const data = {};
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith("data-") || attr.name === "role" || attr.name === "aria-label") data[attr.name] = attr.value.slice(0, 60);
      }
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 140),
        id: el.id || null,
        data,
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        background: style.backgroundColor,
        opacity: style.opacity,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        inCard: Boolean(el.closest("[data-workspace-view]")),
      };
    };
    const stack = document.elementsFromPoint(x, y).slice(0, 6).map(describe);

    // Anything covering most of the viewport and accepting pointer events.
    const overlays = Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.pointerEvents === "none") return false;
        const r = el.getBoundingClientRect();
        return r.width >= window.innerWidth * 0.85 && r.height >= window.innerHeight * 0.85;
      })
      .slice(0, 12)
      .map(describe);

    return {
      point: { x, y },
      cardRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      stack,
      overlays,
      homePresent: Boolean(document.querySelector("[data-lelu-home]")),
      gatePresent: Boolean(document.querySelector("[data-lelu-signin-gate]")),
      chatWindow: Boolean(document.querySelector("[data-lelu-chat-window]")),
      activeElement: document.activeElement?.tagName?.toLowerCase() ?? null,
    };
  }, id);

  Object.assign(result, report);
  await page.screenshot({ path: `${OUT}/shots/overlay.png` });
} catch (error) {
  result.errors.push(String(error).slice(0, 500));
} finally {
  save();
  await browser.close();
}
