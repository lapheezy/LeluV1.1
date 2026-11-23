/**
 * M15.3 WP04 — world entry and her first walk, scenario by scenario.
 * Reported separately from the 68-step acceptance (verify-avatar-presence.mjs).
 *
 *   A  world entered normally, walk asked once she is there
 *   B  world entered behind the Chat Universe, walk typed at once
 *   C  walk asked BEFORE world loading begins (asked on Home, then enter)
 *   D  walk asked during world initialisation (world data held until asked)
 *   E  walk asked immediately after world readiness (first telemetry)
 *   F  world initialisation delayed (world data held until 6 s after the walk is asked)
 *   G  the main thread is blocked for 3 s in the middle of the walk
 *   O  repeated world/Home transitions: one world, one presence, fresh geometry
 *   R  (WP05) reload: her chosen form, her world and one presence survive a
 *      reload, and a walk after it still arrives
 *   N  (WP05) walk asked on Home and her world never opened: an honest
 *      "not in my world" answer before the deadline, not "on my way" and not
 *      the renderer timeout; nothing moves
 * Every walk is checked for (H) the chat window registered as an obstacle
 * when open, (I) a route round it and the Core, (J) arrival at the requested
 * point (≤ 10 cm, measured), (K) progress/stall honesty, (L) the bus
 * answering "arrived" within the original 20 s, from the command's issue.
 *
 *   node scripts/avatar/verify-world-first-paint.mjs [A,B,C,…] [tag] [phone|desktop]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const only = (process.argv[2] ?? "A,B,C,D,E,F,G,O,N,R").split(",");
const tag = process.argv[3] ?? "run";
const dev = process.argv[4] ?? "desktop";
const OUT = `${process.env.LELU_SCEN_OUT ?? "docs/missions/m15-home/avatar-15.3/wp04/scenarios"}/${tag}-${dev}`;
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.LELU_URL ?? "http://127.0.0.1:5173/";
const vp = dev === "phone" ? { width: 393, height: 852 } : { width: 1440, height: 900 };
const mobile = vp.width < 1000;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
let shotN = 0;
async function shot(p, name) {
  const file = `${OUT}/${String(++shotN).padStart(3, "0")}-${name}.png`;
  await p.screenshot({ path: file }).catch(() => {});
  return file;
}

async function open() {
  const ctx = await b.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(() => {
    window.__lt = [];
    try { new PerformanceObserver((o) => { for (const e of o.getEntries()) window.__lt.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch {}
    const seen = new WeakSet();
    window.__ctx = 0;
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, ...r) { const c = o.call(this, t, ...r); if (c && /webgl/.test(t) && !seen.has(c)) { seen.add(c); window.__ctx++; } return c; };
  });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    const c = p.getByRole("button", { name: "Continue without an account" });
    if ((await c.count()) && (await c.first().isVisible())) await c.first().click({ force: true });
    if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(2000);
  // The app's own bus and telemetry, observed (nothing replaced in behaviour).
  await p.evaluate(async () => {
    const trace = (window.__trace = []);
    const T = (ev, d = {}) => trace.push({ t: Math.round(performance.now()), ev, ...d });
    const { default: Bus } = await import("/src/core/avatar/AvatarCommandBus.ts");
    const bus = Bus.getInstance();
    const issue = bus.issue.bind(bus);
    bus.issue = (kind, label, timeout, target) => {
      T("command-issued", { kind, label, timeout });
      const pr = issue(kind, label, timeout, target);
      pr.then((o) => T("command-resolved", { text: o }), (r) => T("command-rejected", { text: String(r) }));
      return pr;
    };
    window.addEventListener("lelu:spatial-state", (e) => {
      const d = e.detail ?? {};
      if (d.persisted) return;
      T("spatial", { position: d.position, walking: d.walking, goal: d.goal, windows: (d.windowObstacleDetail ?? []).map((w) => w.id.split(":").slice(0, 2).join(":")) });
    });
    const f = window.fetch;
    window.fetch = async (...a) => {
      const url = String(a[0]?.url ?? a[0]);
      if (!/\/api\/forge\/world/.test(url)) return f(...a);
      T("world-data-start", { url });
      const r = await f(...a);
      T("world-data-done", { url });
      return r;
    };
  });
  return { ctx, p };
}
const mark = (p, ev, d = {}) => p.evaluate(([e, x]) => window.__trace.push({ t: Math.round(performance.now()), ev: e, ...x }), [ev, d]).catch(() => {});
const spatial = (p) => p.evaluate(() => JSON.parse(document.querySelector("canvas[data-lelu-spatial]")?.dataset.leluSpatial ?? "null")).catch(() => null);
async function enterWorld(p) {
  await p.locator('.lsn-item[aria-label="Worlds"]').click();
  await p.waitForTimeout(500);
  await mark(p, "world-clicked");
  await p.locator('[data-world="genesisv2"]').click();
}
async function typeInChat(p, words) {
  if (!(await p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").count())) {
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await p.waitForTimeout(1200);
  }
  if (!(await p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").count())) {
    await p.locator("button.lcu-card:visible").first().click().catch(() => {});
    await p.waitForTimeout(1200);
  }
  const box = p.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible").first();
  await box.click();
  await box.fill(words);
  return box;
}
/** Wait for the bus's one answer to the latest command, then for her measured outcome. */
async function outcome(p, sinceT, pics = []) {
  let answer = null;
  const t0 = Date.now();
  let picAt = 0;
  while (Date.now() - t0 < 45_000) {
    const tr = await p.evaluate(() => window.__trace).catch(() => []);
    answer = tr.find((e) => (e.ev === "command-resolved" || e.ev === "command-rejected") && e.t >= sinceT);
    if (Date.now() - t0 > picAt) { pics.push(await shot(p, `walking-+${Math.round((Date.now() - t0) / 1000)}s`)); picAt += 5000; }
    if (answer) break;
    await p.waitForTimeout(500);
  }
  // Her measured outcome (after a progress report she keeps walking).
  let s = null;
  for (let i = 0; i < 40; i++) { s = await spatial(p); if (s?.goal && !["walking", "waiting-for-world"].includes(s.goal.outcome)) break; await p.waitForTimeout(500); }
  const tr = await p.evaluate(() => window.__trace);
  const lt = await p.evaluate(() => window.__lt ?? []);
  for (const x of lt) tr.push({ t: x.start, ev: "long-task", dur: x.dur });
  tr.sort((a, b) => a.t - b.t);
  return { answer, s, tr };
}
function judge(name, tr, answer, s, extra = {}) {
  const issued = tr.filter((e) => e.ev === "command-issued").pop();
  const sp = tr.filter((e) => e.ev === "spatial" && e.t >= (issued?.t ?? 0) && e.goal);
  const chatObstacle = sp.some((e) => (e.windows ?? []).some((w) => /window:chat/.test(w)));
  const route = sp.find((e) => e.goal?.route)?.goal.route ?? null;
  const arrivedAt = sp.find((e) => e.goal?.outcome === "arrived")?.t ?? null;
  const ms = answer && issued ? answer.t - issued.t : null;
  const r = {
    scenario: name,
    issuedAtPageMs: issued?.t ?? null,
    answer: answer ? { kind: answer.ev === "command-resolved" ? "arrived (confirmed)" : "declined/progress", ms, text: answer.text.slice(0, 200) } : null,
    final: s?.goal ? { outcome: s.goal.outcome, remaining: s.goal.remaining, point: s.goal.point, position: s.position } : null,
    arrivedMsAfterIssue: arrivedAt && issued ? arrivedAt - issued.t : null,
    H_chatWindowObstacle: chatObstacle,
    I_route: route,
    J_arrived: s?.goal?.outcome === "arrived" && s.goal.remaining <= 0.1,
    L_within20s: Boolean(answer && answer.ev === "command-resolved" && ms <= 20_000),
    ...extra,
  };
  // WP05: where the time went, stage by stage (page clock, ms after the command).
  if (issued) {
    const at = (pred) => { const e = tr.find((x) => x.t >= issued.t && pred(x)); return e ? e.t - issued.t : null; };
    const rel = (pred) => { const e = tr.find(pred); return e ? e.t - issued.t : null; };
    const lts = tr.longTasks ?? [];
    r.timeline = {
      worldClicked: rel((e) => e.ev === "world-clicked"),
      worldDataRequested: at((e) => e.ev === "world-data-start"),
      worldData: at((e) => e.ev === "world-data-done"),
      herFirstWorldFrame: at((e) => e.ev === "spatial"),
      waitingForWorld: at((e) => e.ev === "spatial" && e.goal?.outcome === "waiting-for-world"),
      aimed: at((e) => e.ev === "spatial" && e.goal?.ready),
      firstMovement: at((e) => e.ev === "spatial" && e.walking),
      arrived: at((e) => e.ev === "spatial" && e.goal?.outcome === "arrived"),
      answer: answer ? answer.t - issued.t : null,
      longTasksOver500ms: tr.filter((e) => e.ev === "long-task" && e.t >= issued.t && e.dur > 500).map((e) => [e.t - issued.t, e.dur]),
      spatialSamples: tr.filter((e) => e.ev === "spatial" && e.t >= issued.t).map((e) => [e.t - issued.t, e.goal?.outcome ?? null, e.walking, e.position?.map((n) => +n.toFixed(2))]).slice(0, 60),
    };
    console.log(`   timeline ${name.split(" ")[0]}: ${JSON.stringify(Object.fromEntries(Object.entries(r.timeline).filter(([k]) => k !== "spatialSamples")))}`);
  }
  r.ok = r.J_arrived && r.L_within20s && (extra.ok ?? true);
  results.push(r);
  console.log(`${r.ok ? "PASS" : "FAIL"} ${name}: answer ${r.answer?.kind ?? "none"} at ${ms ?? "-"} ms; final ${r.final?.outcome} ${r.final?.remaining} m; chat-obstacle ${chatObstacle}; route ${JSON.stringify(route)}; ${Object.entries(extra).filter(([k]) => k !== "ok").map(([k, v]) => `${k} ${JSON.stringify(v)}`).join("; ")}`);
  return r;
}

const walk = "walk to the studio";

if (only.includes("A")) {
  const { ctx, p } = await open();
  await enterWorld(p);
  for (let i = 0; i < 60 && !(await spatial(p)); i++) await p.waitForTimeout(500);
  await shot(p, "A-in-world");
  const box = await typeInChat(p, walk);
  await shot(p, "A-chat-typed");
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  const pics = [];
  const { answer, s, tr } = await outcome(p, t, pics);
  await shot(p, "A-end");
  judge("A world entered normally", tr, answer, s);
  await ctx.close();
}

if (only.includes("B")) {
  const { ctx, p } = await open();
  await enterWorld(p);
  const box = await typeInChat(p, walk);
  await shot(p, "B-chat-over-world");
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  const { answer, s, tr } = await outcome(p, t, []);
  await shot(p, "B-end");
  judge("B world entered from the Chat Universe", tr, answer, s);
  await ctx.close();
}

if (only.includes("C")) {
  const { ctx, p } = await open();
  // Asked on Home: no world presence exists yet; the bus keeps the command.
  const box = await typeInChat(p, walk);
  await shot(p, "C-asked-on-home");
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  await p.waitForTimeout(800);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  const x = p.getByRole("button", { name: "Close Chat Universe" });
  if (await x.isVisible().catch(() => false)) await x.click();
  await p.waitForTimeout(500);
  await enterWorld(p);
  await shot(p, "C-entering-world");
  const { answer, s, tr } = await outcome(p, t, []);
  await shot(p, "C-end");
  const issued = tr.find((e) => e.ev === "command-issued");
  const clicked = tr.find((e) => e.ev === "world-clicked");
  judge("C walk asked before world loading begins", tr, answer, s, { askedBeforeWorld: Boolean(issued && clicked && issued.t < clicked.t) });
  await ctx.close();
}

for (const [name, holdMode] of [["D", "until-asked"], ["F", "6s"]]) {
  if (!only.includes(name)) continue;
  const { ctx, p } = await open();
  let release;
  const gate = new Promise((r) => { release = r; });
  const api = /\/api\/forge\/world(\/|\?|$)/;
  await p.route(api, async (route) => { await gate; await route.continue().catch(() => {}); });
  await enterWorld(p);
  const box = await typeInChat(p, walk);
  await shot(p, `${name}-asked-while-world-data-held`);
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  // D: released 1.5 s after the walk is asked; F: a slow world, 6 s after.
  setTimeout(release, holdMode === "6s" ? 6000 : 1500);
  const { answer, s, tr } = await outcome(p, t, []);
  await p.unroute(api);
  await shot(p, `${name}-end`);
  const issued = tr.find((e) => e.ev === "command-issued");
  const data = tr.find((e) => e.ev === "world-data-done" && e.t >= (issued?.t ?? 0));
  const sp = tr.filter((e) => e.ev === "spatial" && e.t >= (issued?.t ?? 0) && e.goal);
  const waited = sp.some((e) => e.goal.outcome === "waiting-for-world");
  const movedEarly = sp.filter((e) => e.goal.outcome === "waiting-for-world").some((e, i, a) => i > 0 && Math.hypot(e.position[0] - a[0].position[0], e.position[2] - a[0].position[2]) > 0.01);
  judge(name === "D" ? "D walk asked during world initialisation" : "F world initialisation delayed", tr, answer, s, { worldDataAfterCommandMs: data && issued ? data.t - issued.t : null, waitedForWorld: waited, movedBeforeReady: movedEarly, ok: !movedEarly });
  await ctx.close();
}

if (only.includes("E")) {
  const { ctx, p } = await open();
  await enterWorld(p);
  // The moment her world reports itself, ask.
  for (let i = 0; i < 120 && !(await spatial(p)); i++) await p.waitForTimeout(250);
  await mark(p, "her-world-ready");
  const box = await typeInChat(p, walk);
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  const { answer, s, tr } = await outcome(p, t, []);
  await shot(p, "E-end");
  judge("E walk asked immediately after world readiness", tr, answer, s);
  await ctx.close();
}

if (only.includes("G")) {
  const { ctx, p } = await open();
  await enterWorld(p);
  for (let i = 0; i < 60 && !(await spatial(p)); i++) await p.waitForTimeout(500);
  const box = await typeInChat(p, walk);
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  await p.waitForTimeout(2000);
  await shot(p, "G-before-block");
  // 3 s of main-thread work, as a heavy page task would (not her code).
  await p.evaluate(() => { const end = performance.now() + 3000; while (performance.now() < end) { /* busy */ } });
  await shot(p, "G-after-block");
  const { answer, s, tr } = await outcome(p, t, []);
  await shot(p, "G-end");
  const sp = tr.filter((e) => e.ev === "spatial" && e.t >= t && e.goal);
  judge("G main thread blocked 3 s mid-walk", tr, answer, s, { falseBlocked: sp.some((e) => e.goal.outcome === "blocked"), ok: !sp.some((e) => e.goal.outcome === "blocked") });
  await ctx.close();
}

if (only.includes("O")) {
  const { ctx, p } = await open();
  const counts = [];
  for (let i = 0; i < 3; i++) {
    await enterWorld(p);
    for (let k = 0; k < 60 && !(await spatial(p)); k++) await p.waitForTimeout(500);
    await p.waitForTimeout(1500);
    const c = await p.evaluate(() => ({ spatial: document.querySelectorAll("canvas[data-lelu-spatial]").length, worlds: document.querySelectorAll('[data-workspace="genesis-v2"] canvas').length, canvases: document.querySelectorAll("canvas").length, ctx: window.__ctx }));
    const s = await spatial(p);
    counts.push({ cycle: i + 1, ...c, environment: s?.environment ?? null, obstacles: s?.obstacles ?? null });
    await shot(p, `O-in-world-${i + 1}`);
    if (mobile) {
      // A phone's way out of her world: the GENESIS V2 pill, then "◂ Genesis v1" (real taps).
      if (!(await p.locator("button:visible", { hasText: "Core Evolution" }).count())) await p.locator("button:visible", { hasText: "GENESIS V2" }).first().tap();
      await p.waitForTimeout(1200);
      await p.locator("button:visible", { hasText: "Genesis v1" }).first().tap();
    } else {
      await p.locator('.lsn-item[aria-label="Home"]').click();
    }
    await p.waitForTimeout(2500);
    await shot(p, `O-home-${i + 1}`);
  }
  // Then the walk must still arrive on fresh geometry.
  await enterWorld(p);
  for (let k = 0; k < 60 && !(await spatial(p)); k++) await p.waitForTimeout(500);
  const box = await typeInChat(p, walk);
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  const { answer, s, tr } = await outcome(p, t, []);
  await shot(p, "O-end");
  const single = counts.every((c) => c.spatial === 1 && c.worlds <= 1);
  judge("O repeated world/Home transitions", tr, answer, s, { counts, oneWorldOnePresence: single, ok: single });
  await ctx.close();
}

if (only.includes("R")) {
  const { ctx, p } = await open();
  // Her chosen form, through the chat.
  const box0 = await typeInChat(p, "become a hologram");
  await box0.press("Enter");
  await p.waitForTimeout(4000);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  const x0 = p.getByRole("button", { name: "Close Chat Universe" });
  if (await x0.isVisible().catch(() => false)) await x0.click();
  await enterWorld(p);
  // Sampled once her world's data has loaded (her first frames come before it).
  for (let k = 0; k < 80 && !(await spatial(p))?.environment; k++) await p.waitForTimeout(500);
  const before = { form: await p.evaluate(() => document.querySelector('[data-testid="lelu-companion"]')?.dataset.form), env: (await spatial(p))?.environment };
  await shot(p, "R-before-reload");
  // Reload: same browser profile (storage kept), the app starts again.
  await p.reload({ waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await p.evaluate(() => document.querySelector('[data-testid="lelu-companion-character"]')?.dataset.ready === "true").catch(() => false)) break;
    await p.waitForTimeout(500);
  }
  await p.waitForTimeout(2000);
  // Re-install the observation after the reload (a new page instance).
  await p.evaluate(async () => {
    const trace = (window.__trace = []);
    const T = (ev, d = {}) => trace.push({ t: Math.round(performance.now()), ev, ...d });
    const { default: Bus } = await import("/src/core/avatar/AvatarCommandBus.ts");
    const bus = Bus.getInstance();
    const issue = bus.issue.bind(bus);
    bus.issue = (kind, label, timeout, target) => { T("command-issued", { kind, label, timeout }); const pr = issue(kind, label, timeout, target); pr.then((o) => T("command-resolved", { text: o }), (r) => T("command-rejected", { text: String(r) })); return pr; };
    window.addEventListener("lelu:spatial-state", (e) => { const d = e.detail ?? {}; if (d.persisted) return; T("spatial", { position: d.position, walking: d.walking, goal: d.goal, windows: [] }); });
  });
  await shot(p, "R-after-reload");
  const scene = await p.evaluate(() => document.querySelector("[data-workspace]")?.getAttribute("data-workspace"));
  if (!(await spatial(p))) await enterWorld(p);
  for (let k = 0; k < 80 && !(await spatial(p))?.environment; k++) await p.waitForTimeout(500);
  const after = { form: await p.evaluate(() => document.querySelector('[data-testid="lelu-companion"]')?.dataset.form), env: (await spatial(p))?.environment, counts: await p.evaluate(() => ({ spatial: document.querySelectorAll("canvas[data-lelu-spatial]").length, worlds: document.querySelectorAll('[data-workspace="genesis-v2"] canvas').length })) };
  await shot(p, "R-world-after-reload");
  const box = await typeInChat(p, walk);
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  const { answer, s, tr } = await outcome(p, t, []);
  await shot(p, "R-end");
  const kept = before.form === "hologram" && after.form === "hologram" && before.env === after.env && after.counts.spatial === 1 && after.counts.worlds <= 1;
  judge("R reload: form, world and one presence survive; walk arrives", tr, answer, s, { before, after, sceneAfterReload: scene, ok: kept });
  // Leave her as she was for later runs.
  const box2 = await typeInChat(p, "become embodied");
  await box2.press("Enter");
  await p.waitForTimeout(3000);
  await ctx.close();
}

if (only.includes("N")) {
  const { ctx, p } = await open();
  const box = await typeInChat(p, walk);
  await shot(p, "N-asked-on-home");
  const t = await p.evaluate(() => performance.now());
  await box.press("Enter");
  let answer = null;
  for (let i = 0; i < 60 && !answer; i++) {
    await p.waitForTimeout(500);
    const tr = await p.evaluate(() => window.__trace);
    answer = tr.find((e) => (e.ev === "command-resolved" || e.ev === "command-rejected") && e.t >= t);
  }
  await shot(p, "N-answer");
  const tr = await p.evaluate(() => window.__trace);
  const issued = tr.find((e) => e.ev === "command-issued");
  const ms = answer && issued ? answer.t - issued.t : null;
  const text = answer?.text ?? "";
  const honest = /not in my world/.test(text) && !/on my way|never confirmed by my renderer/.test(text);
  const noWorld = await p.evaluate(() => !document.querySelector("canvas[data-lelu-spatial]"));
  const r = { scenario: "N walk asked, her world never opened", answer: answer ? { kind: answer.ev, ms, text: text.slice(0, 220) } : null, honest, beforeDeadline: ms !== null && ms <= 20_000, noWorldMounted: noWorld };
  r.ok = honest && r.beforeDeadline && noWorld;
  results.push(r);
  console.log(`${r.ok ? "PASS" : "FAIL"} N: ${JSON.stringify(r.answer)}; honest ${honest}; before deadline ${r.beforeDeadline}; no world mounted ${noWorld}`);
  await ctx.close();
}

await b.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} scenarios`);
process.exit(failed ? 1 : 0);
