import { chromium } from "/home/user/LeluV1.1/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const [W, H, OUT] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
const touch = Math.min(W, H) < 600;
mkdirSync(OUT, { recursive: true });
const tag = `${W}x${H}`;
const checks = []; const rec = (n, s, d = "") => { checks.push({ n, s, d }); console.log(`${s} ${n}${d ? " — " + d : ""}`); };
const ok = (n, c, d) => rec(n, c ? "PASS" : "FAIL", d);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 3 : 1, hasTouch: touch, isMobile: touch });
await ctx.route(/supabase\.co/, (r) => r.abort());
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
await page.addInitScript(() => {
  window.__gl = { avatarContexts: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) { const c = orig.call(this, type, ...rest); if (c && /webgl/.test(type) && !this.__counted) { this.__counted = true; queueMicrotask(() => { if (this.closest?.("[data-testid=lelu-companion]")) window.__gl.avatarContexts++; }); } return c; };
});
const cdp = await ctx.newCDPSession(page);
const sleep = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${n}.png` });
async function drag(x1, y1, x2, y2, steps = 14) {
  if (!touch) { await page.mouse.move(x1, y1); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps); await page.mouse.up(); return; }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] }); await sleep(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tapAt(x, y) { if (touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); }
const her = () => page.evaluate(() => {
  const el = document.querySelector("[data-testid=lelu-companion]");
  if (!el) return null;
  const c = el.querySelector("canvas"); if (c && !c.__pid) c.__pid = (window.__pidN = (window.__pidN ?? 0) + 1);
  // Her visible body (a posture transform moves it inside the layout box).
  const r = el.querySelector("[data-testid=lelu-companion-body]").getBoundingClientRect();
  const frames = Number(el.querySelector("[data-frames]")?.dataset.frames ?? 0);
  return { place: el.dataset.presence, framing: el.dataset.framing, placed: el.dataset.placed, vis: getComputedStyle(el).visibility, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], canvas: c?.__pid ?? null, count: document.querySelectorAll("[data-testid=lelu-companion]").length, ctx: window.__gl.avatarContexts, frames };
});
const settle = async () => { await sleep(1200); let prev = ""; for (let i = 0; i < 10; i++) { const s = JSON.stringify((await her())?.rect); if (s === prev) return; prev = s; await sleep(400); } };
const covers = (sel) => page.evaluate((sel) => {
  const me = document.querySelector("[data-testid=lelu-companion-body]")?.getBoundingClientRect(); if (!me) return [];
  return [...document.querySelectorAll(sel)].filter((e) => !e.closest("[data-testid=lelu-companion]")).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.left < me.right && r.right > me.left && r.top < me.bottom && r.bottom > me.top).length;
}, sel);
const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const gate = () => page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Continue without an account")?.click());
const ready = async () => { for (let i = 0; i < 40; i++) { await sleep(1500); if (await page.evaluate(() => document.querySelector("[data-testid=lelu-companion] [data-ready=true]") !== null).catch(() => false)) return; } };
const canvasIds = new Set();
const track = async (label) => { const h = await her(); if (h?.canvas) canvasIds.add(h.canvas); console.log(`  [${label}]`, JSON.stringify(h)); return h; };
try {
  await page.goto("http://127.0.0.1:5178", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await sleep(1500); if (await page.getByText("Continue without an account").count()) break; }
  await gate(); await ready(); await settle();
  let h = await track("home");
  ok("she is present on Home, as one presence", h && h.count === 1, JSON.stringify(h));
  await shot("01-home");

  // Real drag of HER (no title bar).
  const [x, y, w, hh] = h.rect;
  const dx = touch ? -Math.round(W * 0.25) : -260, dy = touch ? Math.round(H * 0.18) : 140;
  await drag(x + w / 2, y + hh * 0.6, x + w / 2 + dx, y + hh * 0.6 + dy);
  await settle();
  const moved = await track("dragged");
  ok("dragging her with real input moves and places her", moved.place === "placed" && Math.abs(moved.rect[0] - x) > 40, `${JSON.stringify(h.rect)} → ${JSON.stringify(moved.rect)}`);
  ok("she is not a window: no title bar, no resize grip", (await page.locator("[data-testid=lelu-companion-bar], [data-testid=lelu-companion-resize]").count()) === 0);
  await shot("02-dragged");

  // Reload: your spot is kept.
  await page.reload({ waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await sleep(1500); if (await page.getByText("Continue without an account").count()) break; }
  await gate(); await ready(); await settle();
  const after = await track("reloaded");
  ok("after reload she is where you put her", after.place === "placed" && Math.abs(after.rect[0] - moved.rect[0]) < 8 && Math.abs(after.rect[1] - moved.rect[1]) < 8, `${JSON.stringify(moved.rect)} vs ${JSON.stringify(after.rect)}`);
  canvasIds.clear(); canvasIds.add(after.canvas);

  // Return: her own place again.
  const ret = page.locator("[data-testid=lelu-companion-return]");
  const rb = await ret.boundingBox();
  if (rb) await tapAt(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await settle();
  const back = await track("returned");
  ok("“return” gives her back her own place", back.placed === "false" && back.place !== "placed", JSON.stringify(back));
  await shot("03-returned");

  // Tap (no drag): talk to her.
  await tapAt(back.rect[0] + back.rect[2] / 2, back.rect[1] + back.rect[3] * 0.55);
  await sleep(3500);
  const chat = await page.evaluate(() => Boolean(document.querySelector("[data-lelu-window=chat], [data-lelu-chat-window], [data-lelu-fullscreen], .lcu-card, textarea")));
  ok("tapping her opens the conversation", chat);
  await settle();
  const inChat = await track("chat");
  ok("in chat she covers no composer or message input", (await covers("textarea, [data-lelu-composer], input[type=text]")) === 0, `place=${inChat.place}`);
  await shot("04-chat");
  // Leave chat.
  await page.evaluate(() => { for (const b of document.querySelectorAll("button[aria-label^='Close'], button[aria-label='Home']")) { if (b.getBoundingClientRect().width) { b.click(); break; } } });
  await sleep(2500);

  // Studio → graph → drawing.
  await page.evaluate(() => [...document.querySelectorAll("*")].find((e) => e.textContent.trim() === "App Library" && e.children.length === 0)?.closest("button, a, [role=button], section")?.click());
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Docs, decks and spreadsheets")).at(-1)?.click());
  await sleep(2500);
  await page.evaluate(() => document.querySelector("[data-lelu-studio-new=hierarchy]")?.click());
  await page.waitForFunction(() => document.querySelectorAll(".react-flow__node").length > 0, null, { timeout: 30000 }).catch(() => {});
  await settle();
  const g = await track("graph");
  ok("with a graph open she covers no node and no graph control", (await covers(".react-flow__node, .react-flow__controls, [data-lelu-graph-editor] .lst-toolbar button")) === 0, `place=${g.place} rect=${JSON.stringify(g.rect)}`);
  const through = await page.evaluate(() => {
    const box = document.querySelector("[data-testid=lelu-companion]").getBoundingClientRect();
    const body = document.querySelector("[data-testid=lelu-companion-body]").getBoundingClientRect();
    const pts = []; for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) pts.push([box.left + (box.width * i) / 6, box.top + (box.height * j) / 6]);
    const outsideBody = pts.filter(([x, y]) => !(x >= body.left && x <= body.right && y >= body.top && y <= body.bottom));
    const blocked = outsideBody.filter(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-testid=lelu-companion]"));
    return { sampled: outsideBody.length, blocked: blocked.length };
  });
  ok("her layout box blocks nothing outside her visible body", through.blocked === 0, JSON.stringify(through));
  await shot("05-graph");
  await page.evaluate(() => document.querySelector("[data-lelu-studio-new=drawing]")?.click());
  await page.waitForFunction(() => document.querySelectorAll(".excalidraw canvas").length > 0, null, { timeout: 60000 }).catch(() => {});
  await settle();
  const d = await track("drawing");
  ok("with a drawing open she stays off the drawing tools", (await covers(".excalidraw .App-toolbar, .excalidraw .App-menu_top button")) === 0, `place=${d.place} rect=${JSON.stringify(d.rect)}`);
  await shot("06-drawing");
  ok("no horizontal overflow", (await overflow()) <= 0, `${await overflow()}px`);

  // Back Home: same her.
  await page.evaluate(() => { for (let i = 0; i < 6; i++) for (const b of document.querySelectorAll("[data-lelu-module-window] button[aria-label^='Close']")) b.click(); });
  await sleep(1500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Home" || b.textContent.trim() === "Home")?.click());
  await settle(); await sleep(1500); await settle();
  const home2 = await track("home-again");
  await shot("07-home-again");
  ok("one canvas for her through every screen (never rebuilt)", canvasIds.size === 1, `canvas ids seen: ${[...canvasIds].join(",")}`);
  ok("one avatar WebGL context since the reload", home2.ctx <= 1, `avatar contexts: ${home2.ctx}`);

  if (!touch) {
    // A saved world: she stands in it, so this presence hides and stops drawing.
    const chip = page.locator("[data-saved-world]").first();
    if (await chip.count()) {
      await page.evaluate(() => document.querySelector("[data-saved-world]")?.click());
      await sleep(8000);
      const w1 = await her(); await sleep(3000); const w2 = await her();
      ok("in a world view she is hidden and not drawing (canvas kept)", w2.vis === "hidden" && w2.frames === w1.frames && w2.canvas === home2.canvas, `vis=${w2.vis} frames ${w1.frames}→${w2.frames} canvas ${w2.canvas}`);
      await shot("08-world");
    } else rec("world view check", "UNVERIFIED", "no saved world chip on this viewport");
  }
  ok("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) { rec("run completed", "FAIL", String(e).slice(0, 220)); await shot("99-failure").catch(() => {}); }
writeFileSync(`${OUT}/${tag}-report.json`, JSON.stringify({ viewport: [W, H], touch, checks }, null, 1));
console.log(JSON.stringify({ tag, checks: checks.length, failed: checks.filter((c) => c.s === "FAIL").length }));
await browser.close();
