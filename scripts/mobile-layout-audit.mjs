/**
 * Session 3F — two workspaces on a 390x844 phone viewport.
 * This is browser emulation, not a physical Android device.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "artifacts/session3f";
mkdirSync(OUT, { recursive: true });
const result = { viewport: "390x844", errors: [] };
const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
await context.addInitScript(() => {
  try { localStorage.setItem("lelu.workspace", "genesisv2"); } catch {}
});
const page = await context.newPage();
page.on("pageerror", (error) => result.errors.push(String(error).slice(0, 240)));

const boxes = () =>
  page.locator("[data-lelu-module-window]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute("data-lelu-module-window"),
        presentation: node.getAttribute("data-lelu-module-presentation"),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    }),
  );

const openInline = (id) =>
  page.evaluate((moduleId) => {
    window.dispatchEvent(
      new CustomEvent("genesis-module-presentation", { detail: { id: moduleId, presentation: "inline" } }),
    );
  }, id);

try {
  await page.goto("http://127.0.0.1:3004/", { waitUntil: "domcontentloaded", timeout: 30_000 });
  const gate = page.locator("[data-lelu-signin-gate]");
  await gate.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  if (await gate.count()) {
    const skip = gate.getByRole("button", { name: /^Continue/ });
    if (await skip.count()) {
      const box = await skip.first().boundingBox();
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
    await page.waitForTimeout(700);
  }
  await openInline("studio");
  await page.waitForTimeout(700);
  await openInline("browser");
  await page.waitForTimeout(1000);
  result.windows = await boxes();
  result.overlap = result.windows.some((a, index) =>
    result.windows.some(
      (b, other) =>
        index < other &&
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h,
    ),
  );
  result.chatVisible = await page.locator("[data-lelu-chat-window]").isVisible().catch(() => false);
  result.composerVisible = await page.locator("[data-lelu-chat-window] textarea").isVisible().catch(() => false);
  await page.screenshot({ path: `${OUT}/mobile-two-windows.png` });
} catch (error) {
  result.failure = error instanceof Error ? error.message : String(error);
} finally {
  writeFileSync(`${OUT}/mobile-layout-audit.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}
