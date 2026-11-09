import { chromium } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const touch = W < 800;
mkdirSync(OUT, { recursive: true });
const checks = []; const rec = (n, ok, d = "") => { checks.push({ n, ok: !!ok, d }); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? " — " + d : ""}`); };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
const cdp = await ctx.newCDPSession(page);
const shot = (n) => page.screenshot({ path: `${OUT}/${W}x${H}-${n}.png` });
const sleep = (ms) => page.waitForTimeout(ms);
/** A real drag: mouse on desktop, CDP touch events on phones. */
async function drag(x1, y1, x2, y2, steps = 12) {
  if (!touch) { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.mouse.up(); return; }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] }); await sleep(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tap(loc, yFrac = 0.5) { const b = await loc.boundingBox(); if (!b) throw new Error("no box"); const x = b.x + b.width / 2, y = b.y + Math.max(3, b.height * yFrac); if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
const studio = () => page.evaluate(async () => { const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance(); return S.list().filter((a) => a.kind === "graph" || a.kind === "drawing").map((a) => { const s = a.revisions.at(-1).spec; return { id: a.id, kind: a.kind, revs: a.revisions.length, nodes: s.nodes?.length, edges: s.edges?.length, elements: s.scene?.elements?.length, first: s.nodes?.[0] && [s.nodes[0].id, s.nodes[0].x, s.nodes[0].y] }; }); });
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const gate = async () => {
  const b = await page.getByText("Continue without an account").first().boundingBox();
  const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName.toLowerCase()}${e.getAttribute("data-spatial-groups") !== null ? "[data-spatial-groups]" : ""}.${String(e.className).slice(0, 40)} “${(e.textContent ?? "").trim().slice(0, 30)}”` : null; }, [b.x + b.width / 2, b.y + b.height / 2]);
  console.log("FINDING element under the centre of 'Continue without an account':", hit);
  // The gate is not under test: dismiss it directly (the overlap above is recorded as a finding).
  await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
};
async function openCard(id) {
  const card = page.locator(`[data-lelu-studio-card='${id}']`);
  // A small library tile can clip its cards: a person expands the window first.
  const inView = await card.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.height > 0 && (el === top || el.contains(top)); }).catch(() => false);
  if (!inView) { await tap(page.locator("[data-lelu-studio-library]").locator("xpath=ancestor::*[@data-lelu-module-window][1]").locator("button[aria-label=Expand]").first()); await sleep(1200); }
  await card.scrollIntoViewIfNeeded();
  await tap(card);
}
async function openLibrary() {
  // Home → App Library → Documents. The App Library sheet is drawn but does
  // not receive pointer input in this build (hit-testing reaches the Home
  // section beneath it — recorded as a finding), so these two NAVIGATION
  // clicks run the tiles' own handlers. All canvas interaction is real input.
  await page.evaluate(() => [...document.querySelectorAll("*")].find((e) => e.textContent.trim() === "App Library" && e.children.length === 0)?.closest("button, a, [role=button], section")?.click());
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Docs, decks and spreadsheets")).at(-1)?.click());
  await sleep(2500);
}
try {
  await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await sleep(1500); if (await page.getByText("Continue without an account").count()) break; }
  await gate(); await sleep(5000);
  await openLibrary();
  await tap(page.locator("[data-lelu-studio-new=hierarchy]"));
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, null, { timeout: 30000 }); await sleep(2000);
  await page.evaluate(() => { window.__ev = []; for (const t of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchmove", "touchend", "mousedown"]) document.addEventListener(t, (e) => { const last = window.__ev.at(-1); if (last !== t) window.__ev.push(t); }, { capture: true, passive: true }); });
  const vp = () => page.evaluate(() => document.querySelector(".react-flow__viewport")?.style.transform);
  const pos = () => page.evaluate(async () => { const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance(); const a = S.list().find((x) => x.kind === "graph"); return a.revisions.at(-1).spec.nodes.find((n) => n.id === "shaman"); });
  for (const zoomClicks of [0, 3]) {
    for (let z = 0; z < zoomClicks; z++) { await tap(page.locator(".react-flow__controls-zoomin").first()); await sleep(400); }
    const node = page.locator(".react-flow__node").filter({ hasText: "SHAMAN" }).first();
    const nb = await node.boundingBox();
    const hit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e?.className}`.slice(0, 60); }, [nb.x + nb.width / 2, nb.y + nb.height / 2]);
    const v0 = await vp();
    await drag(nb.x + nb.width / 2, nb.y + nb.height / 2, nb.x + nb.width / 2 + 60, nb.y + nb.height / 2 + 40, 20);
    await sleep(1500);
    const nb2 = await node.boundingBox();
    const evs = await page.evaluate(() => window.__ev ?? []);
    console.log(`on screen moved ${Math.round(nb2.x - nb.x)},${Math.round(nb2.y - nb.y)} px; events seen: ${JSON.stringify(evs.slice(0, 12))}`);
    console.log(`zoomClicks=${zoomClicks} node ${Math.round(nb.width)}x${Math.round(nb.height)} hit="${hit}" viewport ${v0 === (await vp()) ? "unchanged" : "MOVED (pan)"} saved=${JSON.stringify(await pos())}`);
  }
} catch (e) { console.log("ERR", String(e).slice(0, 200)); }
await browser.close();
