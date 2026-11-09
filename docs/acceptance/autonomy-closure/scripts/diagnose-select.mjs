/**
 * LÉLU — why a press does not reach a workspace surface.
 *
 * Boots the production app, composes three surfaces through the engine, then
 * for every mounted surface reports what is ACTUALLY on top of its centre
 * (tag, classes, pointer-events, z-index, and whether that element belongs to
 * the card) plus whether Playwright's own actionability check considers the
 * card clickable. Evidence only — no selection is faked here.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = { at: new Date().toISOString(), cards: [], trial: null, errors: [] };
const save = () => writeFileSync(`${OUT}/diagnose-select.json`, JSON.stringify(result, null, 2));

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

  await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("genesis");
    await env.composeEnvironment({
      title: "Diagnose",
      surfaces: [
        { kind: "file", title: "Findings", text: "Evidence collected." },
        { kind: "file", title: "Source table", text: "A | supports" },
        { kind: "file", title: "Open questions", text: "Which claim matters?" },
      ],
    });
  });
  await page.waitForSelector('[data-workspace="lelu-system"]', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector("[data-workspace-view]", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500);

  result.cards = await page.evaluate(() => {
    const describe = (el) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 120),
        id: el.id || null,
        attrs: {
          view: el.getAttribute("data-workspace-view"),
          panel: el.getAttribute("data-lelu-chat-window") !== null ? "chat-window" : null,
          tab: el.getAttribute("data-lelu-tab"),
        },
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        position: style.position,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        inCard: Boolean(el.closest("[data-workspace-view]")),
        chain: (() => {
          const out = [];
          let node = el;
          for (let i = 0; i < 4 && node; i += 1) {
            out.push(`${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ")[0]}` : ""}`);
            node = node.parentElement;
          }
          return out;
        })(),
      };
    };
    return Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => {
      const rect = node.getBoundingClientRect();
      const cx = Math.round(rect.left + rect.width / 2);
      const cy = Math.round(rect.top + rect.height / 2);
      return {
        id: node.getAttribute("data-workspace-view"),
        revision: node.getAttribute("data-revision"),
        selected: node.getAttribute("data-selected"),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        center: { x: cx, y: cy },
        top: describe(document.elementFromPoint(cx, cy)),
        points: [
          { at: "center", el: describe(document.elementFromPoint(cx, cy)) },
          { at: "topLeft+10", el: describe(document.elementFromPoint(Math.round(rect.x) + 10, Math.round(rect.y) + 10)) },
          { at: "below-header", el: describe(document.elementFromPoint(Math.round(rect.x) + 20, Math.round(rect.y) + 60)) },
        ],
      };
    });
  });
  save();

  const first = result.cards[0];
  if (first) {
    try {
      await page.locator(`[data-workspace-view="${first.id}"]`).click({ timeout: 6000, trial: true });
      result.trial = { ok: true };
    } catch (error) {
      result.trial = { ok: false, message: String(error).slice(0, 800) };
    }
    save();
  }
  await page.screenshot({ path: `${OUT}/shots/diagnose-select.png` });
} catch (error) {
  result.errors.push(String(error).slice(0, 500));
  save();
} finally {
  await browser.close();
  save();
}
