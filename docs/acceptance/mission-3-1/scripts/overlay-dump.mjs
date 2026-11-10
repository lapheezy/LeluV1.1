/** GATE A · what is on top of the home? Disk-visible facts, not guesses. */
import { chromium } from "playwright";
const OUT = "docs/acceptance/mission-3-1";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
await page.goto("http://127.0.0.1:4318/", { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector("[data-lelu-home]", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
const out = await page.evaluate(() => {
  const desc = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: String(el.className).slice(0, 60),
      id: el.id || null,
      pe: cs.pointerEvents, pos: cs.position, z: cs.zIndex, vis: cs.visibility, disp: cs.display, op: cs.opacity,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      attrs: [...el.attributes].map((a) => `${a.name}=${String(a.value).slice(0, 40)}`).slice(0, 8),
      html: el.outerHTML.slice(0, 220),
    };
  };
  const points = [
    { id: "home-now-tile", x: 1082, y: 247 },
    { id: "home-chat-app-tile", x: 336, y: 470 },
    { id: "home-header-menu", x: 60, y: 40 },
  ];
  const probes = points.map((p) => {
    const top = document.elementFromPoint(p.x, p.y);
    const chain = [];
    let n = top, i = 0;
    while (n && i < 7) { chain.push(`${n.tagName}.${String(n.className).slice(0, 26)}${n.getAttribute?.("aria-hidden") === "true" ? "[aria-hidden]" : ""}[pe=${getComputedStyle(n).pointerEvents},z=${getComputedStyle(n).zIndex}]`); n = n.parentElement; i++; }
    const stack = document.elementsFromPoint(p.x, p.y).slice(0, 6).map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}[pe=${getComputedStyle(e).pointerEvents}]`);
    return { at: p, top: desc(top), chain, stack };
  });
  // Every full-viewport, class-less, aria-hidden div above the home is suspicious.
  const suspects = [...document.querySelectorAll("body > *, [data-workspace='genesis-unified'] > *")].map(desc).filter(Boolean);
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({ ...desc(c), pe: getComputedStyle(c).pointerEvents }));
  const scrim = document.querySelector(".lch-scrim");
  return { probes, bodyChildren: suspects, canvases, scrim: desc(scrim), scrimStyle: scrim ? { pe: getComputedStyle(scrim).pointerEvents, pos: getComputedStyle(scrim).position, z: getComputedStyle(scrim).zIndex, inset: getComputedStyle(scrim).inset } : null };
});
await page.screenshot({ path: `${OUT}/shots/overlay-home.png`, timeout: 15000 }).catch(() => {});
await browser.close().catch(() => {});
console.log(JSON.stringify({ at: new Date().toISOString(), ...out, pageErrors }, null, 1));
