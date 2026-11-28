/**
 * The first screen, as a person sees it: open the app, sign in, land in the Cosmos, the chat box rises
 * from the core, open its "+" Controls tab, send a message. Desktop and phone (emulated).
 *   node scripts/landing/landing.mjs ["message"]
 */
import { chromium } from "playwright";
const OUT = "docs/missions/unify/shots";
const MESSAGE = process.argv[2] ?? "Hi LÉLU";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const report = {};
for (const [name, ctx] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["phone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]]) {
  const p = await (await b.newContext(ctx)).newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  // Sign in (the gate), then wait for the Cosmos landing.
  for (let i = 0; i < 80; i++) {
    if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); });
    if (await p.locator("[data-core-chat]").count()) break;
    await p.waitForTimeout(500);
  }
  const landed = await p.locator("[data-core-chat]").count();
  await p.waitForTimeout(2500);
  const first = await p.evaluate(() => ({ dashboard: !!document.querySelector("[data-lelu-home]"), coreChat: !!document.querySelector("[data-core-chat]"), universe: !!document.querySelector(".lcu"), dial: [...document.querySelectorAll("[data-testid=lsn-orb]")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; }), box: (() => { const r = document.querySelector("[data-core-chat]")?.getBoundingClientRect(); return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null; })() }));
  await p.screenshot({ path: `${OUT}/landing-${name}-1-cosmos.png` });
  await p.locator("[data-core-chat] .ccx-plus").click({ trial: false });
  await p.waitForTimeout(700);
  const controls = await p.evaluate(() => [...document.querySelectorAll("[data-core-controls] h4")].map((h) => h.textContent));
  await p.screenshot({ path: `${OUT}/landing-${name}-2-controls.png` });
  await p.locator("[data-core-chat] .ccx-plus").click();
  await p.locator("[data-core-chat] textarea").fill(MESSAGE);
  await p.locator("[data-core-chat] .ccx-send").click();
  await p.waitForTimeout(6000);
  const after = await p.evaluate(() => ({ you: document.querySelector(".ccx-you")?.textContent ?? null, typing: !!document.querySelector(".ccx-typing"), her: document.querySelector(".ccx-her")?.textContent?.slice(0, 160) ?? null }));
  await p.screenshot({ path: `${OUT}/landing-${name}-3-sent.png` });
  // Nothing may sit on the composer: the dial, her figure, any panel.
  const clear = await p.evaluate(() => {
    const bar = document.querySelector("[data-core-chat] .ccx-bar").getBoundingClientRect();
    const bad = [];
    for (let x = bar.left + 8; x < bar.right - 8; x += 24) for (const y of [bar.top + 6, bar.top + bar.height / 2, bar.bottom - 6]) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest("[data-core-chat]")) bad.push(`${Math.round(x)},${Math.round(y)}:${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? "#" + el.getAttribute("data-testid") : ""}`);
    }
    return bad.slice(0, 5);
  });
  report[name] = { composerCovered: clear, landedInCosmos: !!landed, seconds: Math.round((Date.now() - t0) / 1000), first, controls, after, errors: errors.slice(0, 3) };
}
console.log(JSON.stringify(report, null, 1));
await b.close();
