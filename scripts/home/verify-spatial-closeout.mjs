/**
 * Mission 15.2 WP03 — closeout regression for the Spatial bar.
 *
 * Browser viewport emulation only (Chromium). This is NOT a physical iPhone test.
 * Four viewports; repeated open/close; layering measured with elementFromPoint;
 * the App Library sheet must take the pointer; Escape scoped to the open bar;
 * Home/Cosmos state unchanged by toggling; LÉLU through the real chat.
 * A picture at every step: docs/missions/m15-home/shots-15.2-closeout/.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "docs/missions/m15-home/shots-15.2-closeout";
const URL = process.env.LELU_URL ?? "http://127.0.0.1:5173/";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
let n = 0;
async function step(p, name, ok, note = "") {
  n++;
  const file = `${OUT}/step-${String(n).padStart(2, "0")}-${ok ? "ok" : "FAIL"}-${name}.png`;
  await p.screenshot({ path: file });
  results.push({ n, name, ok: Boolean(ok), note, file, viewport: p.viewportSize() });
  console.log(`${ok ? "PASS" : "FAIL"} ${n} ${name} ${note}`);
}
const vis = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }), sel);
const count = (p, sel) => p.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, sel);
/** Is the element the topmost thing at its own centre (nothing on top of it)? */
const onTop = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit && e.contains(hit)); }, sel);
/** Do the visible boxes of two elements intersect? */
const overlaps = (p, a, c) => p.evaluate(([a, c]) => { const x = document.querySelector(a)?.getBoundingClientRect(); const y = document.querySelector(c)?.getBoundingClientRect(); if (!x || !y || !x.width || !y.width) return false; return x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top; }, [a, c]);
/** Home/Cosmos state that toggling the bar must not change. */
const snapshot = (p) => p.evaluate(() => ({
  home: localStorage.getItem("lelu.home.presentations.v1"),
  layouts: localStorage.getItem("lelu.home.layouts.v1"),
  scene: document.body.dataset.spatialScene ?? "",
  homeMounted: Boolean(document.querySelector("[data-lelu-home]")),
  brand: document.querySelector(".lch-brand-sub")?.textContent ?? "",
}));
const BAR = "[data-spatial-nav] > div"; // the pill itself (the container is click-through)
const TAB = "[data-spatial-nav-tab]";

async function enter(vp) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: vp.width < 1000, isMobile: vp.width < 1000 });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(8000);
  for (let i = 0; i < 3; i++) { const c = p.getByRole("button", { name: "Continue without an account" }); if ((await c.count()) && (await c.first().isVisible())) { await c.first().click({ force: true }); await p.waitForTimeout(1500); } }
  await p.waitForTimeout(1200);
  return { ctx, p };
}

const VIEWPORTS = [
  ["desktop", { width: 1440, height: 900 }],
  ["tablet", { width: 820, height: 1180 }],
  ["phone-portrait", { width: 393, height: 852 }],
  ["phone-landscape", { width: 852, height: 393 }],
];

for (const [dev, vp] of VIEWPORTS) {
  const { ctx, p } = await enter(vp);
  const tap = (sel) => (vp.width < 1000 ? p.tap(sel) : p.click(sel));
  const before = await snapshot(p);

  await step(p, `${dev}-closed`, !(await vis(p, "[data-spatial-nav]")) && (await count(p, TAB)) === 1 && (await onTop(p, TAB)), "bar hidden; one tab, nothing on top of it");

  // Repeated open/close through the tab and the ✕.
  let cycles = 0;
  for (let i = 0; i < 3; i++) {
    await tap(TAB);
    await p.waitForTimeout(500);
    const open = (await vis(p, "[data-spatial-nav]")) && (await count(p, "[data-spatial-nav]")) === 1 && !(await vis(p, TAB));
    await tap('[data-spatial-control="hide"]');
    await p.waitForTimeout(500);
    const closed = !(await vis(p, "[data-spatial-nav]")) && (await vis(p, TAB));
    if (open && closed) cycles++;
  }
  await tap(TAB);
  await p.waitForTimeout(600);
  await step(p, `${dev}-open`, cycles === 3 && (await vis(p, "[data-spatial-nav]")), `${cycles}/3 tab→✕ cycles`);

  const navClear = !(await overlaps(p, BAR, "nav.lsn .lsn-bar"));
  const orbClear = !(await overlaps(p, BAR, ".lsn-orb"));
  const navOnTop = await p.evaluate(() => { const o = document.querySelector(".lsn-orb"); if (!o) return true; const r = o.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit && o.contains(hit)); });
  await step(p, `${dev}-open-clear-of-nav-and-orb`, navClear && orbClear && navOnTop, `nav clear ${navClear}, orb clear ${orbClear}, orb tappable ${navOnTop}`);

  // Escape while open closes it; Escape while closed changes nothing.
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  const escClosed = !(await vis(p, "[data-spatial-nav]"));
  const s1 = await snapshot(p);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(500);
  const s2 = await snapshot(p);
  await step(p, `${dev}-escape-scoped`, escClosed && (await vis(p, TAB)) && JSON.stringify(s1) === JSON.stringify(s2) && s2.homeMounted, "Escape closes the open bar; a second Escape changes nothing");

  // App Library: the tile is visible, on top, and the sheet owns the pointer.
  await tap('button[aria-label="Open the app library"]');
  await p.waitForTimeout(900);
  const tileOnTop = await onTop(p, "[data-spatial-menu-entry]");
  const sheetOwns = await p.evaluate(() => { const tiles = [...document.querySelectorAll(".lsh-app, .lsh-search input, .lsh-tabs button, .lsh-close")]; return tiles.length > 0 && tiles.every((t) => { const r = t.getBoundingClientRect(); if (r.bottom > innerHeight || r.top < 0 || r.right > innerWidth || r.left < 0) return true; const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 10)); return Boolean(hit && (t.contains(hit) || hit.closest("[data-testid=lelu-companion]"))); }); });
  const tabAside = !(await vis(p, TAB));
  const avatarOver = await p.evaluate(() => [...document.querySelectorAll(".lsh-app")].filter((t) => { const r = t.getBoundingClientRect(); if (r.bottom > innerHeight || r.top < 0) return false; const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return Boolean(hit?.closest("[data-testid=lelu-companion]")); }).map((t) => t.querySelector(".lsh-app-name")?.textContent));
  await step(p, `${dev}-library-tile`, (await vis(p, "[data-spatial-menu-entry]")) && tileOnTop && sheetOwns && tabAside, `tile on top ${tileOnTop}; sheet owns the pointer (Home cards never receive it) ${sheetOwns}; tab steps aside ${tabAside}; KNOWN pre-existing: avatar over tiles [${avatarOver.join(", ")}]`);
  await tap("[data-spatial-menu-entry]");
  await p.waitForTimeout(800);
  await step(p, `${dev}-library-opens-bar`, (await vis(p, "[data-spatial-nav]")) && !(await vis(p, ".lsh-backdrop")));
  await tap('[data-spatial-control="hide"]');
  await p.waitForTimeout(500);

  // Reload: hidden again.
  await p.reload({ waitUntil: "domcontentloaded" });
  await p.waitForTimeout(8000);
  const after = await snapshot(p);
  const stateKept = after.home === before.home && after.layouts === before.layouts && after.brand === before.brand && after.homeMounted;
  await step(p, `${dev}-reload-hidden-state-kept`, !(await vis(p, "[data-spatial-nav]")) && (await vis(p, TAB)) && stateKept, `Home presentations/layouts unchanged ${stateKept}`);
  await ctx.close();
}

// LÉLU through the real Chat Universe, repeated.
{
  let { ctx, p } = await enter({ width: 1440, height: 900 });
  const ask = async (words) => {
    if (!(await vis(p, ".lcu-input textarea, textarea[placeholder^='Message LÉLU']"))) {
      await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
      await p.waitForTimeout(1500);
    }
    let box = p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").first();
    if (!(await box.count())) {
      await p.screenshot({ path: `${OUT}/debug-no-composer.png` });
      throw new Error("no visible chat composer");
    }
    await box.click();
    await box.fill(words);
    await box.press("Enter");
    await p.waitForTimeout(4000);
  };
  const leave = async () => {
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    const x = p.getByRole("button", { name: "Close Chat Universe" });
    if (await x.isVisible().catch(() => false)) await x.click();
    await p.waitForTimeout(1200);
  };
  const flag = () => p.evaluate(() => document.body.dataset.spatialNavShown ?? "false");
  const stage3d = () => p.evaluate(() => Boolean(document.querySelector('[data-lelu-stage-view="spatial"], .lst-stack[data-spatial-tab]')));

  for (const [i, phrase] of ["open the spatial menu", "show me the spatial bar"].entries()) {
    await ask(phrase);
    const replied = await p.evaluate(() => document.body.innerText.includes("The spatial bar is open"));
    const no3d = !(await stage3d());
    await step(p, `lelu-${i + 1}-asks-open`, replied && no3d && (await flag()) === "true", `"${phrase}": reply ${replied}, no 3D stage ${no3d}`);
    await leave();
    await step(p, `lelu-${i + 1}-bar-open-on-home`, await vis(p, "[data-spatial-nav]"));
    await ask("hide the spatial bar");
    const hid = await p.evaluate(() => document.body.innerText.includes("Put away."));
    await step(p, `lelu-${i + 1}-asks-hide`, hid && (await flag()) === "false", `"hide the spatial bar": reply ${hid}`);
    await leave();
    await step(p, `lelu-${i + 1}-bar-away-on-home`, !(await vis(p, "[data-spatial-nav]")) && (await vis(p, TAB)));
  }
  // Fresh session for the ordinary-talk check: after the loop above the Chat
  // Universe was seen restoring an Earth map window (no composer), which is
  // unrelated to the Spatial bar. A clean session asks the way she would.
  await ctx.close();
  ({ ctx, p } = await enter({ width: 1440, height: 900 }));
  await ask("what is spatial computing?");
  const untouched = (await flag()) === "false" && !(await p.evaluate(() => document.body.innerText.includes("The spatial bar is open") && document.body.innerText.lastIndexOf("The spatial bar is open") > document.body.innerText.lastIndexOf("spatial computing")));
  await step(p, "lelu-ordinary-talk-ignored", untouched, "\"what is spatial computing?\" did not toggle the bar");
  await leave();
  await ctx.close();
}

await b.close();
fs.writeFileSync(`${OUT}/verify.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
