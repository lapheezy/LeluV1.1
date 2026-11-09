/**
 * Mission 5.4B.3 — why won't the world open?
 *
 * Records the exact user-facing path to immersive mode: which node is at the
 * orb's centre, what a real pointer press does to HomeStore.immersive over the
 * following 3 seconds, and whether a second route (the "Look at the Cosmos"
 * control) behaves differently. Also samples the camera rotation to identify
 * the loop that keeps it moving.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--headless=new", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:3013/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((button) => (button.textContent ?? "").toLowerCase().includes("continue without an account"))
    ?.click();
});
await page.waitForTimeout(2000);

const snapshot = () =>
  page.evaluate(() => {
    const orb = [...document.querySelectorAll(".lsn-orb")].find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const rect = orb?.getBoundingClientRect();
    const centre = rect ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) } : null;
    return {
      t: Math.round(performance.now()),
      immersiveFlag: window.__leluImmersive ?? null,
      dataImmersive: orb?.getAttribute("data-immersive") ?? null,
      orbCount: document.querySelectorAll(".lsn-orb").length,
      orbDisabled: orb?.disabled ?? null,
      orbStyle: orb ? { pointerEvents: getComputedStyle(orb).pointerEvents, visibility: getComputedStyle(orb).visibility } : null,
      centre,
      stackTop: centre
        ? document.elementsFromPoint(centre.x, centre.y).slice(0, 4).map((node) => `${node.tagName}.${node.className}`.slice(0, 60))
        : null,
      homeVisible: Boolean(document.querySelector(".lch-round.lch-cosmos")),
      camera: window.__leluCameraSettle ?? null,
    };
  });

const out = { samples: [], presses: [], errors: [] };
page.on("pageerror", (error) => out.errors.push(String(error).slice(0, 200)));

const press = async (label, selector) => {
  const box = await (await page.$(selector))?.boundingBox();
  out.presses.push({ label, selector, box: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null });
  if (!box) return null;
  const before = await snapshot();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const timeline = [];
  for (let index = 0; index < 24; index += 1) {
    await page.waitForTimeout(110);
    const sample = await snapshot();
    if (index % 6 === 0 || sample.immersiveFlag !== before.immersiveFlag) timeline.push(sample);
  }
  return { before, timeline };
};

out.before = await snapshot();
out.pressOrb = await press("orb-pointer", ".lsn-orb");
out.afterOrb = await snapshot();
if (out.afterOrb.immersiveFlag !== true) {
  out.pressCosmos = await press("cosmos-home", ".lch-cosmos");
  out.afterCosmos = await snapshot();
}
if (out.afterCosmos?.immersiveFlag !== true && out.afterOrb.immersiveFlag !== true) {
  // Last user-facing route: the World sheet entry the nav exposes.
  out.pressWorldSheet = await press("nav-world", ".lsn-orb");
  out.afterWorldSheet = await snapshot();
}
out.final = await snapshot();
writeFileSync("docs/acceptance/spatial-phase-2-13/measurements/entry-path.json", `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await browser.close();
