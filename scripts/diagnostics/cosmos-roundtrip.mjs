/**
 * WP05/§8 round trip: Chat Universe (Freestyle) → return to the primary Cosmos → reopen. Measures that the
 * mode, the objects and a moved object's position survive, and captures each step.
 *   node scripts/diagnostics/cosmos-roundtrip.mjs
 * (Setup shared with chat-run.mjs.) Asks LÉLU in the chat itself ("<message>"), the way the owner would, and captures the Diagnostics surface
 * she opens beside the chat. Usage: node scripts/diagnostics/chat-run.mjs "Validate Freestyle, including chat"
 * (Based on freestyle-chat.mjs.) Runs her in-app diagnostics (src/core/diagnostics) in the live app, on a real conversation in Freestyle,
 * then reloads and re-measures persistence (the one thing an in-page run cannot do to itself).
 *   node scripts/diagnostics/freestyle-chat.mjs [suite]   (default: full)
 * Launched without the proxy so Neko's WebRTC connects.
 */
import { chromium } from "playwright";
const MESSAGE = process.argv[2] ?? "Validate Freestyle, including chat";
const OUT = "docs/missions/unify/shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
const PHONE = process.env.PHONE === "1";
// PHONE=1: emulated iPhone viewport with touch (coarse pointer). Emulated, NOT a physical device.
const p = await (await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; emulated) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" } : { viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
const click = (s) => p.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), s);
await p.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 80; i++) { if (await p.locator("[data-lelu-signin-gate]").count()) await p.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); }); if (await p.locator("[data-lelu-home]").count()) break; await p.waitForTimeout(500); }
await p.waitForTimeout(1500);
const title = `Diagnostics ${Date.now() % 1e5}`;
const cid = await p.evaluate(async (title) => {
  const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
  const T = await import("/src/core/thread/ThreadObjects.ts");
  const c = MC.create(title);
  const t0 = Date.now() - 60000;
  [["user", "Show me the map, the bomber patterns and the video."], ["assistant", "Here they are."], ...Array.from({ length: 10 }, (_, k) => [k % 2 ? "assistant" : "user", `Line ${k}: the V2 map shows memory feeding cognition, and the pattern search sits beside it.`])].forEach(([role, text], i) => MC.addMessage(c.id, { id: `${c.id}-m${i}`, role, text, timestamp: t0 + i * 1000, source: "local" }));
  const s = (o) => T.summon({ conversationId: c.id, by: "lelu", ...o });
  s({ kind: "neural-map", title: "V2 · Cognitive architecture", map: { aspect: "v2", view: "force-directed", dim: "2d", highlight: [], selected: null } });
  s({ kind: "web", title: "Google: oversized bomber sewing pattern", web: { url: "https://www.google.com/search?q=oversized+bomber+sewing+pattern", title: "Google: oversized bomber sewing pattern", snippet: "Search results" } });
  s({ kind: "youtube", title: "But what is a neural network?", video: { id: "aircAruvnKk", title: "But what is a neural network? | Deep learning chapter 1", channel: "3Blue1Brown" } });
  return c.id;
}, title);
await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
await p.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
await click(`button[aria-label="Open ${title}"]`);
await p.waitForTimeout(900);
for (let i = 0; i < 20 && !(await p.locator("[data-thread-stage]").count()); i++) {
  await p.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(1500);
}
await p.waitForSelector("[data-thread-stage]");
await click('[data-variant-tab="freestyle"]');
await p.waitForTimeout(4000);
const T = (fn, arg) => p.evaluate(fn, arg);
const before = await T(async (cid) => { const M = await import("/src/core/thread/ThreadObjects.ts"); const o = M.objectsFor(cid)[0]; M.setTransform(o.id, "freestyle", { dx: 60, dy: 30, manual: true }); return { variant: M.variantFor(cid), ids: M.objectsFor(cid).map((x) => x.id), moved: o.id }; }, cid);
await p.waitForTimeout(1200);
const cosmosVisible = () => p.evaluate(() => ({ chatWindowOnScreen: !![...document.querySelectorAll("[data-lelu-universe-window]")].find((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden"), universe: !!document.querySelector(".lcu"), mode: document.querySelector(".lcu")?.getAttribute("data-cosmos") ?? null, home: !!document.querySelector("[data-lelu-home]"), canvas: document.querySelectorAll("canvas").length }));
const s1 = await cosmosVisible();
await p.screenshot({ path: `${OUT}/roundtrip-1-chat-in-cosmos${PHONE ? "-phone" : ""}.png` });
// Return to the primary Cosmos through the real control: the dial → "Cosmos".
const dial = async (...path) => {
  const orb = await p.evaluate(() => { const all = [...document.querySelectorAll("[data-testid=lsn-orb]")].filter((e) => e.getBoundingClientRect().width > 0); const e = all[all.length - 1]; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  if (orb) await p.mouse.click(orb[0], orb[1]);
  await p.waitForTimeout(900);
  for (const label of path) {
    const hit = await p.evaluate((label) => { const rings = [...document.querySelectorAll(".lelu-radial-items")]; const ring = rings[rings.length - 1]; const item = ring && [...ring.querySelectorAll("[role=menuitem]")].find((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().startsWith(label)); if (!item) return null; const r = item.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, label);
    if (!hit) throw new Error(`no "${label}" in the open ring`);
    await p.mouse.click(hit[0], hit[1]);
    await p.waitForTimeout(900);
  }
};
console.log("dial probe", JSON.stringify(await p.evaluate(() => ({ slots: [...document.querySelectorAll("[data-lelu-nav-slot]")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), e.children.length]; }), dialSlot: !!document.querySelector("[data-dial-slot]"), orb: [...document.querySelectorAll("[data-testid=lsn-orb]")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; }), lsn: [...document.querySelectorAll(".lsn")].map((e) => e.getAttribute("data-dial-only")) }))));
await p.screenshot({ path: `${OUT}/roundtrip-0-dial-probe.png` });
await dial("Cosmos");
await p.waitForTimeout(2500);
const s2 = await cosmosVisible();
await p.screenshot({ path: `${OUT}/roundtrip-2-primary-cosmos${PHONE ? "-phone" : ""}.png` });
// Come back through the dial: Chat Universe (it keeps its open conversation windows).
await dial("Chat Universe");
await p.waitForTimeout(2500);
const railBefore = await p.evaluate(() => document.querySelector(".lcu-rail")?.textContent?.includes("None open") ? "none open" : "windows kept");
console.log("rail after return:", railBefore);
await p.screenshot({ path: `${OUT}/roundtrip-2b-universe-back.png` });
await p.evaluate((t) => document.querySelector(`button[aria-label="Open ${t}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), title);
await p.waitForTimeout(1500);
for (let i = 0; i < 20 && !(await p.locator("[data-thread-stage]").count()); i++) {
  await p.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await p.waitForTimeout(1500);
}
await p.waitForTimeout(3000);
const after = await T(async ({ cid, id }) => { const M = await import("/src/core/thread/ThreadObjects.ts"); const el = document.querySelector(`[data-thread-object="${id}"]`); return { variant: M.variantFor(cid), ids: M.objectsFor(cid).map((x) => x.id), t: M.getObject(id)?.transforms.freestyle ?? null, stageVariant: document.querySelector("[data-thread-stage]")?.getAttribute("data-variant"), drawn: !!el }; }, { cid, id: before.moved });
const s3 = await cosmosVisible();
await p.screenshot({ path: `${OUT}/roundtrip-3-reopened${PHONE ? "-phone" : ""}.png` });
const same = before.variant === after.variant && before.ids.join() === after.ids.join() && after.t?.dx === 60 && after.t?.dy === 30 && after.drawn;
console.log(JSON.stringify({ step1_chatInCosmos: s1, step2_primaryCosmos: s2, step3_reopened: s3, before, after, survived: same }, null, 1));
console.log("page errors:", errors.slice(0, 3));
await b.close();
