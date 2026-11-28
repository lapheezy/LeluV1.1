/**
 * Runs her in-app diagnostics (src/core/diagnostics) in the live app, on a real conversation in Freestyle,
 * then reloads and re-measures persistence (the one thing an in-page run cannot do to itself).
 *   node scripts/diagnostics/freestyle-chat.mjs [suite]   (default: full)
 * Launched without the proxy so Neko's WebRTC connects.
 */
import { chromium } from "playwright";
const SUITE = process.argv[2] ?? "full";
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
const run = await p.evaluate(async ({ suite, cid }) => {
  const S = await import("/src/core/diagnostics/suites.ts");
  const D = await import("/src/core/diagnostics/Diagnostics.ts");
  S.registerDiagnosticSuites();
  const r = await D.runDiagnostics(suite, cid);
  return { id: r.id, env: r.environment, checks: r.checks.map((c) => ({ id: c.id, cat: c.category, status: c.status, evidence: c.evidence, reason: c.reason ?? "" })), summary: D.chatSummary(r) };
}, { suite: SUITE, cid });
await p.screenshot({ path: `${OUT}/diag-01-after-run${PHONE ? "-phone" : ""}.png` });
if (process.env.DUMP) console.log("geometry", JSON.stringify(await p.evaluate(() => {
  const r = (e) => e ? (({ top, bottom, height }) => ({ top: Math.round(top), bottom: Math.round(bottom), h: Math.round(height) }))(e.getBoundingClientRect()) : null;
  const sc = document.querySelector("[data-freestyle-scroll]");
  if (sc) sc.scrollTop = sc.scrollHeight;
  return { stage: r(document.querySelector("[data-thread-stage]")), fsStage: r(document.querySelector(".fs-stage")), scroller: { ...r(sc), scrollH: sc?.scrollHeight, clientH: sc?.clientHeight, top: sc?.scrollTop, overflowY: sc && getComputedStyle(sc).overflowY }, canvas: r(document.querySelector(".ts-canvas")), composer: r(document.querySelector("form.lcu-win-composer")), winBody: r(document.querySelector(".lcu-win-body")), web: (() => { const w = document.querySelector('[data-thread-object][data-kind="web"]'); if (!w) return null; w.scrollIntoView({ block: "center", behavior: "instant" }); return { obj: r(w), head: r(w.querySelector(".to-head")), actions: r(w.querySelector(".to-actions")), body: r(w.querySelector(".to-body")), bodyPad: getComputedStyle(w.querySelector(".to-body")).paddingTop, link: r(w.querySelector(".to-body a")), linkRects: [...(w.querySelector(".to-body a")?.getClientRects() ?? [])].map((x) => [Math.round(x.top), Math.round(x.bottom)]) }; })(), v1: [...document.querySelectorAll("[data-thread-stage] button")].filter((b) => /^\W*V1$/.test(b.textContent.trim()) || b.textContent.trim() === "V1").map((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return { cls: b.className, parent: b.parentElement.className, dock: b.dataset.dock ?? null, size: `${Math.round(r.width)}x${Math.round(r.height)}`, minH: cs.minHeight, font: cs.fontSize, transform: getComputedStyle(b.parentElement).transform, parentH: Math.round(b.parentElement.getBoundingClientRect().height) }; }), heads: [...document.querySelectorAll("[data-thread-object]")].map((o) => ({ k: o.dataset.kind, w: Math.round(o.getBoundingClientRect().width), btns: [...o.querySelectorAll(".to-head .to-grip, .to-head button")].map((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return `${b.getAttribute("aria-label")}:${Math.round(r.width)}x${Math.round(r.height)} minH=${cs.minHeight} disp=${cs.display}`; }) })), objectsAtBottom: [...document.querySelectorAll("[data-thread-object]")].map((e) => ({ k: e.dataset.kind, ...r(e) })) };
})));
// Persistence across a real reload: the transforms she stored must come back.
const before = await p.evaluate((cid) => import("/src/core/thread/ThreadObjects.ts").then((T) => { const o = T.objectsFor(cid)[0]; T.setTransform(o.id, "freestyle", { dx: 33, dy: 17, manual: true }); return { id: o.id, variant: T.variantFor(cid) }; }), cid);
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
const after = await p.evaluate(({ cid, id }) => import("/src/core/thread/ThreadObjects.ts").then((T) => ({ t: T.getObject(id)?.transforms.freestyle ?? null, variant: T.variantFor(cid), ids: T.objectsFor(cid).length })), { cid, id: before.id });
console.log(run.summary);
console.log("\nreload:", JSON.stringify({ before, after }));
console.log("\nchecks:");
for (const c of run.checks) console.log(`${c.status.padEnd(8)} ${c.cat.padEnd(14)} ${c.id.padEnd(16)} ${c.evidence}${c.reason ? ` | ${c.reason}` : ""}`);
console.log("page errors:", errors.slice(0, 3));
await b.close();
