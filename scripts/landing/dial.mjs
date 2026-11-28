/**
 * From the Cosmos landing, the dial: open it, open the Neural Map breakdown, choose V2, and check that the
 * map opens in the chat workspace inside the Cosmos. Desktop and phone (emulated).
 *   node scripts/landing/dial.mjs
 */
import { chromium } from "playwright";
const OUT = "docs/missions/unify/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const res = {};
for (const [name, ctx] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
  const p = await (await b.newContext(ctx)).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-core-chat]").count()) break; await p.waitForTimeout(500); }
  await p.waitForTimeout(2500);
  const tapOrb = async () => { const c = await p.evaluate(() => { const all = [...document.querySelectorAll("[data-testid=lsn-orb]")].filter((e) => e.getBoundingClientRect().width > 0); const e = all.at(-1); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }); await p.mouse.click(c[0], c[1]); await p.waitForTimeout(1000); };
  const choose = async (label) => { const c = await p.evaluate((label) => { const ring = [...document.querySelectorAll(".lelu-radial-items")].at(-1); const it = [...ring.querySelectorAll("[role=menuitem]")].find((e) => (e.getAttribute("aria-label") || e.textContent).trim().startsWith(label)); if (!it) return null; const r = it.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, label); if (!c) throw new Error(`no ${label}`); await p.mouse.click(c[0], c[1]); await p.waitForTimeout(1200); };
  await tapOrb();
  const ring = await p.evaluate(() => [...[...document.querySelectorAll(".lelu-radial-items")].at(-1).querySelectorAll("[role=menuitem]")].map((e) => (e.getAttribute("aria-label") || e.textContent).trim()));
  await p.screenshot({ path: `${OUT}/dial-${name}-cosmos-ring.png` });
  await choose("Neural Map");
  const nested = await p.evaluate(() => [...[...document.querySelectorAll(".lelu-radial-items")].at(-1).querySelectorAll("[role=menuitem]")].map((e) => (e.getAttribute("aria-label") || e.textContent).trim()));
  await p.screenshot({ path: `${OUT}/dial-${name}-neural.png` });
  await choose("V2");
  await p.waitForTimeout(4000);
  const opened = await p.evaluate(() => ({ universe: !!document.querySelector(".lcu"), thread: !!document.querySelector("[data-thread-stage]"), map: !!document.querySelector('[data-thread-object][data-kind="neural-map"]'), drawn: !!document.querySelector('[data-thread-object][data-kind="neural-map"] svg, [data-thread-object][data-kind="neural-map"] canvas') }));
  opened.all = await p.evaluate(() => [...document.querySelectorAll(".tm-svg")].map((s) => { const l = s.querySelector(".tm-label"); return { w: s.clientWidth, h: s.clientHeight, ls: s.style.getPropertyValue("--ls"), inline: l?.style.fontSize, computed: l ? getComputedStyle(l).fontSize : null, visible: s.getBoundingClientRect().width > 0, obj: s.closest("[data-thread-object]")?.getAttribute("data-thread-object") }; }));
  opened.svg = await p.evaluate(() => { const s = document.querySelector('[data-thread-object][data-kind="neural-map"] svg'); if (!s) return null; const r = s.getBoundingClientRect(); const l = s.querySelector(".tm-label"); const lr = l?.getBoundingClientRect(); return { label: l ? [l.textContent, Math.round(lr.height), getComputedStyle(l).fontSize, l.getAttribute("font-size"), l.getAttribute("transform")] : null, par: s.getAttribute("preserveAspectRatio"), rect: [Math.round(r.width), Math.round(r.height)], client: [s.clientWidth, s.clientHeight], ls: s.style.getPropertyValue("--ls"), viewBox: s.getAttribute("viewBox") }; });
  await p.screenshot({ path: `${OUT}/dial-${name}-v2-open.png` });
  res[name] = { ring, nested, opened, errors: errors.slice(0, 3) };
}
console.log(JSON.stringify(res, null, 1));
await b.close();
