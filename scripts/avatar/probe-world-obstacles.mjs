/**
 * M15.3 WP03: what is the chat module window in her world, before, during
 * and after the Chat Universe is open? (Visibility chain, size, hit test.)
 * Usage: node scripts/avatar/probe-world-obstacles.mjs [screenshot.png]
 */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) {
  const c = p.getByRole("button", { name: "Continue without an account" });
  if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
  if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
  await p.waitForTimeout(500);
}
await p.locator('.lsn-item[aria-label="Worlds"]').click();
await p.waitForTimeout(700);
await p.locator('[data-world="genesisv2"]').click();
for (let i = 0; i < 60 && !(await p.evaluate(() => Boolean(document.querySelector("canvas[data-lelu-spatial]")))); i++) await p.waitForTimeout(500);
const probe = (label) => p.evaluate((label) => {
  const out = { label, universe: null, windows: [] };
  for (const n of document.querySelectorAll("[data-lelu-module-window]")) {
    const r = n.getBoundingClientRect();
    const chain = [];
    for (let e = n; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.opacity !== "1" || s.visibility !== "visible" || s.display === "none" || s.pointerEvents === "none" || s.transform !== "none" || s.clipPath !== "none")
        chain.push({ tag: e.tagName, cls: String(e.className).slice(0, 60), opacity: s.opacity, vis: s.visibility, display: s.display, pe: s.pointerEvents, transform: s.transform.slice(0, 40), clip: s.clipPath });
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out.windows.push({ kind: n.dataset.leluModuleWindow, rect: [r.left, r.top, r.width, r.height].map(Math.round), hitInside: Boolean(hit && n.contains(hit)), hitIs: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null, chain });
  }
  return out;
}, label);
console.log(JSON.stringify(await probe("world, before chat"), null, 1));
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForTimeout(1500);
if (!(await p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").count())) { await p.locator("button.lcu-card:visible").first().click().catch(() => {}); await p.waitForTimeout(1500); }
console.log(JSON.stringify(await probe("chat open"), null, 1));
const box = p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").first();
await box.click(); await box.fill("walk to the studio"); await box.press("Enter");
await p.waitForTimeout(2500);
console.log(JSON.stringify(await probe("after command (universe closed by her)"), null, 1));
await p.screenshot({ path: process.argv[2] ?? "/tmp/claude-0/-home-user-LeluV1-1/b9524c01-b6bc-5cc5-9412-0953a769fcd1/scratchpad/after-cmd.png" });
await b.close();
