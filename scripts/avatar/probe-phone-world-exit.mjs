/** M15.3 WP04: on a phone, in her world, what can be tapped, and does any of it lead Home? (real taps, a picture after each) */
import { chromium } from "playwright";
const OUT = "docs/missions/m15-home/avatar-15.3/wp04/phone-exit";
import fs from "node:fs"; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) {
  const c = p.getByRole("button", { name: "Continue without an account" });
  if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
  if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
  await p.waitForTimeout(500);
}
await p.locator('.lsn-item[aria-label="Worlds"]').tap();
await p.waitForTimeout(800);
await p.locator('[data-world="genesisv2"]').tap();
await p.waitForTimeout(12000);
await p.screenshot({ path: `${OUT}/01-in-world.png` });
const buttons = await p.evaluate(() => [...document.querySelectorAll("button, [role=button], a")].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && r.bottom > 0 && r.top < innerHeight; }).map((e) => ({ label: e.getAttribute("aria-label") || e.textContent.trim().slice(0, 30), rect: [e.getBoundingClientRect().x, e.getBoundingClientRect().y].map(Math.round) })));
console.log("visible controls in her world:", JSON.stringify(buttons));
const homeVisible = await p.locator('.lsn-item[aria-label="Home"]').isVisible().catch(() => false);
console.log("Home nav item visible:", homeVisible);
let n = 1;
for (const label of ["GENESIS V2", "◉"]) {
  const el = p.locator("button:visible", { hasText: label }).first();
  if (!(await el.count())) { console.log(`no "${label}" control`); continue; }
  await el.tap({ timeout: 5000 }).catch((e) => console.log("tap failed", String(e).slice(0, 80)));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/0${++n}-after-tapping-${label === "◉" ? "dot" : "genesis-pill"}.png` });
  const opts = await p.evaluate(() => [...document.querySelectorAll("button, [role=menuitem], [data-world]")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getAttribute("aria-label") || e.getAttribute("data-world") || e.textContent.trim().slice(0, 25)).slice(0, 30));
  console.log(`after tapping ${label}:`, JSON.stringify(opts), "Home nav visible:", await p.locator('.lsn-item[aria-label="Home"]').isVisible().catch(() => false));
  await p.keyboard.press("Escape").catch(() => {});
  await p.waitForTimeout(800);
}
// The visible way out: the pill's "◂ Genesis v1", by a real tap (actionability-checked: it must not be covered).
if (!(await p.locator("button:visible", { hasText: "Core Evolution" }).count())) {
  await p.locator("button:visible", { hasText: "GENESIS V2" }).first().tap().catch(() => {});
  await p.waitForTimeout(1500);
}
await p.screenshot({ path: `${OUT}/03-bar-open.png` });
const back = p.locator("button:visible", { hasText: "Genesis v1" }).first();
console.log("bar open:", await p.locator("button:visible", { hasText: "Core Evolution" }).count(), "| back-to-v1 buttons:", await back.count(), JSON.stringify(await back.evaluate((e) => ({ label: e.getAttribute("aria-label"), text: e.textContent.trim() })).catch(() => null)));
const hit = await back.evaluate((el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { rect: [r.x, r.y, r.width, r.height].map(Math.round), centreHitsIt: Boolean(h && el.contains(h)), coveredBy: h && !el.contains(h) ? (h.getAttribute("aria-label") || h.textContent.trim().slice(0, 30)) : null }; }).catch((e) => ({ error: String(e).slice(0, 80) }));
console.log("◂ Genesis v1:", JSON.stringify(hit));
const tapped = await back.tap({ timeout: 8000 }).then(() => "tapped").catch((e) => "tap refused: " + String(e).split("\n").slice(0, 3).join(" ").slice(0, 300));
console.log(tapped);
await p.waitForTimeout(4000);
await p.screenshot({ path: `${OUT}/04-after-genesis-v1.png` });
console.log("Home nav visible after:", await p.locator('.lsn-item[aria-label="Home"]').isVisible().catch(() => false));
await b.close();
