/**
 * LÉLU — the workspace on phones (emulated touch, labelled as such).
 *
 * Boots the production app at 390×844 with touch, composes surfaces through
 * the engine, OPENS THE CHAT (the state that used to unmount the field), and
 * checks: field mounted, surfaces present and inside the viewport, chat and
 * workspace not blocking each other, and a real touch tap selecting a
 * surface. Then reflows through 375×812, 360×640 and 430×932 and re-checks
 * mount + geometry, so the same workspace survives responsive reflow.
 *
 * This is browser-emulated touch (Chromium hasTouch), NOT a physical device.
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "docs/acceptance/autonomy-closure";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:4321/";
mkdirSync(`${OUT}/shots`, { recursive: true });
const result = { at: new Date().toISOString(), viewports: [], selection: null, errors: [] };
const save = () => writeFileSync(`${OUT}/mobile.json`, JSON.stringify(result, null, 2));

const browser = await chromium.launchPersistentContext("/tmp/closure-mobile", {
  headless: true,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  deviceScaleFactor: 1,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 300)));
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Guest button = the last button in the dialog; the label differs when
  // identity is unconfigured ("Continue"). Leaving the gate up blocks all
  // touch input behind its backdrop.
  const gate = page.locator("[data-lelu-signin-gate]");
  if (await gate.count()) {
    await gate.locator("button").last().click({ timeout: 15_000 }).catch(() => {});
    await page.waitForSelector("[data-lelu-signin-gate]", { state: "detached", timeout: 25_000 }).catch(() => {});
    result.gateDismissed = (await page.locator("[data-lelu-signin-gate]").count()) === 0;
  }
  await page.waitForTimeout(2500);

  const composed = await page.evaluate(async () => {
    const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
    const env = (await import("/src/core/orchestrator/EnvironmentOrchestrationEngine.ts")).default.getInstance();
    const visual = (await import("/src/core/visual/VisualEngine.ts")).default.getInstance();
    ws.clear();
    visual.setInterfaceFocus("genesis");
    const res = await env.composeEnvironment({
      title: "Mobile workspace",
      surfaces: [
        { kind: "file", title: "Findings", text: "Evidence collected across three sources." },
        { kind: "file", title: "Source table", text: "A | supports" },
        { kind: "file", title: "Open questions", text: "Which claim is load-bearing?" },
      ],
    });
    return { ids: res.createdViews.map((view) => view.id), focus: visual.getState().interfaceFocus };
  });
  await page.waitForSelector('[data-workspace="lelu-system"]', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector("[data-workspace-view]", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const measure = (label) =>
    page.evaluate((tag) => {
      const host = document.querySelector('[data-workspace="lelu-system"]');
      const cards = Array.from(document.querySelectorAll("[data-workspace-view]"));
      const chat = document.querySelector("[data-lelu-chat-window]");
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rects = cards.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: node.getAttribute("data-workspace-view"),
          revision: node.getAttribute("data-revision"),
          selected: node.getAttribute("data-selected"),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          inside: rect.x >= -2 && rect.y >= -2 && rect.right <= vw + 2 && rect.bottom <= vh + 2,
          visible: Boolean(node.offsetParent) && rect.width > 0 && rect.height > 0,
        };
      });
      return {
        label: tag,
        viewport: { w: vw, h: vh },
        host: Boolean(host),
        count: cards.length,
        chatOpen: Boolean(chat),
        chatRect: chat ? (() => { const r = chat.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null,
        allVisible: rects.length > 0 && rects.every((card) => card.visible),
        allInside: rects.length > 0 && rects.every((card) => card.inside),
        cards: rects,
      };
    }, label);

  result.initial = await measure("390x844-before-chat");
  save();

  // Open the chat the way a user does: the field's own "talk to LÉLU".
  const talk = page.locator("button", { hasText: /talk to LÉLU/i }).first();
  const talkCount = await talk.count();
  result.talkButton = talkCount > 0;
  if (talkCount > 0) {
    await talk.click({ timeout: 8000, force: true }).catch((error) => result.errors.push(`talk: ${String(error).slice(0, 200)}`));
    await page.waitForTimeout(1500);
  }
  result.withChat = await measure("390x844-chat-open");
  await page.screenshot({ path: `${OUT}/shots/mobile-390-chat-open.png` });
  save();

  // Wait for settled geometry before tapping what is actually there.
  const settled = async (timeoutMs = 8000) => {
    const started = Date.now();
    let previous = null;
    while (Date.now() - started < timeoutMs) {
      const now = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => {
          const rect = node.getBoundingClientRect();
          return [node.getAttribute("data-workspace-view"), Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)];
        }),
      );
      if (previous && JSON.stringify(previous) === JSON.stringify(now)) return now;
      previous = now;
      await page.waitForTimeout(200);
    }
    return previous;
  };
  result.settled = await settled();
  const freshCards = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-workspace-view]")).map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute("data-workspace-view"), rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } };
    }),
  );
  result.settledCards = freshCards;

  // Real touch tap on a surface header.
  const first = freshCards[0];
  if (first) {
    /*
     * Tap the BODY, not the header chrome.
     *
     * The header holds the close button and the kind badge, and a press on a
     * control inside a surface is the control's business — the card is
     * deliberately not selected from there. Tapping 22px into the header was
     * measuring the button, not the surface, and read as "touch does not
     * select" while the press was landing somewhere that should ignore it.
     */
    const x = Math.round(first.rect.x + first.rect.w / 2);
    const y = Math.round(first.rect.y + Math.min(first.rect.h - 24, 120));
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(700);
    result.selection = await page.evaluate(async (id) => {
      const ws = (await import("/src/core/workspace/WorkspaceEngine.ts")).default.getInstance();
      return {
        tapped: { id, x: null, y: null },
        engineSelected: ws.getState().selectedId,
        domSelected: document.querySelector(`[data-workspace-view="${id}"]`)?.getAttribute("data-selected") ?? null,
        all: Array.from(document.querySelectorAll("[data-workspace-view]")).map((n) => ({
          id: n.getAttribute("data-workspace-view"),
          selected: n.getAttribute("data-selected"),
        })),
      };
    }, first.id);
    result.selection.tapPoint = { x, y };
    // What is actually under the finger, so a press that selects nothing can
    // never be mistaken for a card that is not listening.
    result.selection.hit = await page.evaluate(({ x: px, y: py }) => {
      const node = document.elementFromPoint(px, py);
      const card = node?.closest("[data-workspace-view]");
      return {
        tag: node?.tagName ?? null,
        inCard: Boolean(card),
        cardId: card?.getAttribute("data-workspace-view") ?? null,
        closestDialog: node?.closest("[role='dialog'],[data-lelu-chat-window],[data-lelu-mobile-menu]")?.getAttribute("data-lelu-chat-window") !== null ? "chat" : null,
        html: (node?.outerHTML ?? "").slice(0, 100),
      };
    }, { x, y });
    save();
  }

  // Reflow through the required phone widths.
  for (const [width, height] of [[375, 812], [360, 640], [430, 932], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(900);
    const frame = await measure(`${width}x${height}`);
    /**
     * REACHABLE, not all-on-screen-at-once.
     *
     * A scrolling column legitimately holds cards below the fold; `allInside`
     * reported that fold as an overflow and called 360x640 broken while the
     * 640-tall phone simply showed fewer cards at a time. What must be true is
     * that every surface is horizontally inside the viewport and that scrolling
     * to the last one brings it fully into view.
     */
    frame.reach = await page.evaluate(async () => {
      const cards = Array.from(document.querySelectorAll("[data-workspace-view]"));
      if (cards.length === 0) return { count: 0, horizontallyInside: false, lastInside: false, unreachable: [] };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const check = (node) => {
        const rect = node.getBoundingClientRect();
        return rect.x >= -2 && rect.right <= vw + 2 && rect.y >= -2 && rect.bottom <= vh + 2;
      };
      const horizontallyInside = cards.every((node) => {
        const rect = node.getBoundingClientRect();
        return rect.x >= -2 && rect.right <= vw + 2;
      });
      const last = cards[cards.length - 1];
      last.scrollIntoView({ block: "end" });
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        count: cards.length,
        horizontallyInside,
        lastInside: check(last),
        unreachable: cards.filter((node) => !check(node)).map((node) => node.getAttribute("data-workspace-view")),
      };
    });
    frame.pass = frame.reach.horizontallyInside && frame.reach.lastInside;
    result.viewports.push(frame);
    save();
    if (width === 360) await page.screenshot({ path: `${OUT}/shots/mobile-360.png` });
  }

  result.finishedAt = new Date().toISOString();
} catch (error) {
  result.errors.push(String(error).slice(0, 600));
  result.finishedAt = new Date().toISOString();
} finally {
  save();
  await browser.close();
}
