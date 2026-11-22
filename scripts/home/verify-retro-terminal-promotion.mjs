/**
 * M22.12 — Retro Terminal canonical promotion: browser acceptance.
 *
 * Drives the REAL app at iPhone 13, iPad Mini and 1440×900 and checks what
 * the promotion changed or depends on:
 *
 *   WP03  terminal `goto` / `back` move the camera through the one
 *         navigation authority (CosmosRooms3D following CosmosNavigation),
 *         the camera survives layout switches, the same canvas is kept;
 *   WP04  the companion and the Spatial tab cover none of the terminal
 *         (header, viewport caption, tabs, panes, command line), no
 *         horizontal overflow, the command line and the Appearance Studio
 *         stay inside the viewport;
 *   WP05  a reload from a live-map planet comes back to the planet, with
 *         it selected and the camera framing it; an unknown stored
 *         destination falls back to the core without an error.
 *
 * Painting: as scripts/verify-cosmos-integration.mjs explains, a GPU-less
 * container gets SwiftShader, which the app refuses to paint the world on.
 * The same two harness-only adjustments are used here (a hardware renderer
 * string, and the render manager's fps downgrade switched off) so the real
 * scene path (CosmosLayer, CosmosRooms3D, the camera controller) runs.
 *
 * Run: node scripts/home/verify-retro-terminal-promotion.mjs [--only=phone,tablet,desktop]
 *      (needs `vite` on :5173; writes docs/missions/retro-terminal-promotion/evidence/)
 */
import { chromium, devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7);
const OUT = "docs/missions/retro-terminal-promotion/evidence";
await mkdir(`${OUT}/shots`, { recursive: true });

const ENGINE = "/src/app/scene/genesis/engines/InfiniteCosmos.ts";
const NAV = "/src/core/cosmos/CosmosNavigation.ts";
const FOCUS = "/src/core/cosmos/CosmosFocus.ts";
const SCALES = "/src/app/scene/genesis/cosmos/CosmosScales.ts";

const results = [];
const check = (vp, name, ok, detail = "") => {
  results.push({ viewport: vp, name, status: ok ? "PASS" : "FAIL", detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const until = async (fn, timeout) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};
const fmt = (p) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

const viewports = [
  ["phone", { ...devices["iPhone 13"], deviceScaleFactor: 1 }],
  ["tablet", { ...devices["iPad Mini"], deviceScaleFactor: 1 }],
  ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
].filter(([name]) => !ONLY || ONLY.split(",").includes(name));

async function boot(page) {
  await page.goto(BASE + "?perf-world", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const m = await import("/src/app/scene/genesis/SceneRenderManager.ts");
    m.getSceneRenderManager().reportFrameRate = () => {};
  }).catch(() => {});
  for (let i = 0; i < 120; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    }
    if (!(await page.locator("[data-lelu-signin-gate]").count()) && (await page.locator("[data-lelu-home]").count())) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
}

const cameraPos = (page) => page.evaluate(async (e) => (await import(e)).default.getInstance().getCameraPosition(), ENGINE);
const navState = (page) =>
  page.evaluate(async ([n, f]) => {
    const nav = (await import(n)).default.getInstance();
    const s = nav.getState();
    return { current: s.currentId, trail: s.trail, pending: nav.pendingRestore(), focus: (await import(f)).default.getInstance().get(), nodes: s.nodes.map((x) => ({ id: x.id, level: x.level, label: x.label, position: x.position })) };
  }, [NAV, FOCUS]);
/** Where CosmosRooms3D flies for a destination: 10 units in front of the ring drawn at z−25. */
const framing = (node) => ({ x: node.position[0], y: node.position[1], z: node.position[2] - 25 + 10 });
const tracking = (page) => until(async () => { const p = await cameraPos(page); return p.x !== 0 || p.y !== 0 || p.z !== 0; }, 90000);
async function command(page, text) {
  await page.fill("#rt-cmd", text);
  await page.press("#rt-cmd", "Enter");
}

const rects = (page) =>
  page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
    const q = (s) => r(document.querySelector(s));
    const terminalParts = {
      header: q(".rt-header"), caption: q(".rt-view-cap"), coords: q(".rt-view-read"), fullView: q(".rt-view-look"),
      tabs: q(".rt-tabs"), tabpanel: q(".rt-tabpanel"), directory: q(".rt-body > :first-child"), panes: q(".rt-panes"),
      prompt: q("[data-rt-prompt]"), run: q("[data-rt-prompt] button[type=submit]"), input: q("#rt-cmd"),
      headerButtons: [...document.querySelectorAll(".rt-header button")].map(r).filter(Boolean),
    };
    const c = document.querySelector("[data-testid=lelu-companion]");
    return {
      vw: innerWidth, vh: innerHeight,
      companion: c && getComputedStyle(c).opacity !== "0" ? r(c) : null,
      companionPlace: c?.getAttribute("data-presence") ?? null,
      hero: q(".rt-view-hero"), view: q(".rt-view"),
      spatialTab: q("[data-spatial-nav-tab]"),
      parts: terminalParts,
      overflow: document.scrollingElement.scrollWidth - innerWidth,
    };
  });
const hit = (a, b, m = 0) => Boolean(a && b) && a.l < b.r - m && a.r > b.l + m && a.t < b.b - m && a.b > b.t + m;
const inside = (a, vw, vh) => Boolean(a) && a.l >= -0.5 && a.t >= -0.5 && a.r <= vw + 0.5 && a.b <= vh + 0.5;

for (const [vp, opts] of viewports) {
  console.log(`\n=== ${vp.toUpperCase()} ===`);
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => {
    try { localStorage.setItem("lelu.lelu.auth.skipped.v1", "true"); } catch {}
    const UNMASKED_RENDERER = 0x9246;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const original = proto.getParameter;
      proto.getParameter = function (p) { return p === UNMASKED_RENDERER ? "Harness GPU" : original.call(this, p); };
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  await boot(page);

  // A Retro Terminal presentation, made the way a person makes one.
  await page.click("[data-home-customize]");
  await page.waitForSelector("[data-home-editbar]");
  await page.selectOption('select[aria-label="New presentation from a composition or layout"]', "retro-terminal");
  const terminal = await page.waitForSelector("[data-retro-terminal]", { timeout: 20000 }).then(() => true).catch(() => false);
  await page.click("[data-home-customize]");
  check(vp, "Retro Terminal is selectable and renders", terminal);
  const tracked = await tracking(page);
  check(vp, "the live Cosmos scene runs under the terminal (camera tracker reporting)", tracked);
  await page.waitForTimeout(2500);

  /* ---------------- WP04: overlap ---------------- */
  const g = await rects(page);
  const parts = Object.entries(g.parts).filter(([k, v]) => v && k !== "headerButtons");
  const avatarHits = g.companion ? parts.filter(([k, v]) => !["tabpanel", "panes", "directory"].includes(k) && hit(g.companion, v)).map(([k]) => k) : [];
  const avatarButtons = g.companion ? g.parts.headerButtons.filter((b) => hit(g.companion, b)).length : 0;
  check(vp, "companion avatar covers no terminal control (header, caption, Full view, tabs, command line)", g.companion !== null && avatarHits.length === 0 && avatarButtons === 0, `avatar ${g.companionPlace} ${JSON.stringify(g.companion && Object.values(g.companion).map(Math.round))}${avatarHits.length ? " hits " + avatarHits.join(",") : ""}`);
  check(vp, "companion stands inside the terminal's live Cosmos frame", g.companion && g.view && g.companion.l >= g.view.l && g.companion.r <= g.view.r && g.companion.t >= g.view.t && g.companion.b <= g.view.b);
  const tabHits = g.spatialTab ? parts.filter(([, v]) => hit(g.spatialTab, v)).map(([k]) => k) : [];
  check(vp, "Spatial side tab is shown and covers no terminal row, pane or the command line", Boolean(g.spatialTab) && tabHits.length === 0, tabHits.join(",") || `tab ${JSON.stringify(g.spatialTab && Object.values(g.spatialTab).map(Math.round))}`);
  check(vp, "Spatial tab keeps a usable touch target (≥ 24×44)", g.spatialTab && g.spatialTab.r - g.spatialTab.l >= 24 && g.spatialTab.b - g.spatialTab.t >= 44);
  check(vp, "no horizontal overflow", g.overflow <= 0, `scrollWidth − innerWidth = ${g.overflow}`);
  check(vp, "command line and RUN fully inside the viewport", inside(g.parts.prompt, g.vw, g.vh) && inside(g.parts.run, g.vw, g.vh));
  await page.screenshot({ path: `${OUT}/shots/${vp}-terminal.png` });

  // The Spatial bar, opened from the tab, must not land on the command line.
  await page.click("[data-spatial-nav-tab]");
  // The rail measures obstacles on animation frames; at SwiftShader frame
  // rates that takes seconds, so wait for it to settle rather than sample once.
  let bar = [];
  let prompt2 = null;
  const barClear = await until(async () => {
    bar = await page.evaluate(() => [...document.querySelectorAll("[data-spatial-control]")].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }));
    prompt2 = (await rects(page)).parts.prompt;
    return bar.length > 0 && !bar.some((b) => hit(b, prompt2));
  }, 15000);
  const lift = await page.getAttribute("[data-spatial-nav]", "data-spatial-composer-clearance").catch(() => null);
  check(vp, "opened Spatial bar leaves the command line clear", barClear, `${bar.length} controls, lifted ${lift} px`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Appearance Studio: opens inside the viewport, its close button reachable.
  await page.click("[data-terminal-studio-open]");
  await page.waitForSelector("[data-terminal-studio]", { timeout: 15000 });
  await page.waitForTimeout(600);
  const studio = await page.evaluate(() => {
    const s = document.querySelector("[data-terminal-studio]");
    const b = s.getBoundingClientRect();
    const close = [...s.querySelectorAll("button")].find((x) => /close/i.test(x.getAttribute("aria-label") || x.textContent || ""));
    const cb = close?.getBoundingClientRect();
    const top = cb ? document.elementFromPoint(cb.left + cb.width / 2, cb.top + cb.height / 2) : null;
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, closeReachable: Boolean(close && top && (top === close || close.contains(top))) };
  });
  check(vp, "Appearance Studio fits the viewport and its close control is reachable", inside(studio, g.vw, g.vh) && studio.closeReachable);
  await page.screenshot({ path: `${OUT}/shots/${vp}-studio.png` });
  await page.click('[data-terminal-studio] button[aria-label="Close the appearance studio"]');
  await page.waitForSelector("[data-terminal-studio]", { state: "detached", timeout: 10000 }).catch(() => {});

  /* ---------------- WP03: goto / back follow the one navigation authority ---------------- */
  await until(async () => (await navState(page)).nodes.some((n) => n.id.startsWith("map-agent-")), 20000);
  let s = await navState(page);
  const planet = s.nodes.find((n) => n.id.startsWith("map-agent-") && n.level === "planet");
  const galaxy = s.nodes.find((n) => n.level === "galaxy");
  check(vp, "directory holds live-map destinations (planets from the runtime)", Boolean(planet && galaxy), planet ? `${planet.label} (${planet.id})` : "none");
  if (planet && galaxy) {
    await command(page, `goto ${galaxy.id}`);
    await until(async () => dist(await cameraPos(page), framing(galaxy)) < 0.5, 25000);
    await command(page, `goto ${planet.id}`);
    let cam = await cameraPos(page);
    const reached = await until(async () => { cam = await cameraPos(page); return dist(cam, framing(planet)) < 0.5; }, 25000);
    s = await navState(page);
    check(vp, "terminal goto: navigation, selection and camera all reach the planet", reached && s.current === planet.id && s.focus?.id === planet.id, `camera ${fmt(cam)} want ${fmt(framing(planet))}`);
    const scale0 = await page.evaluate(async (u) => (await import(u)).cosmosScaleStore.get?.() ?? null, SCALES).catch(() => null);

    // Layout switching: the camera, the universe and the canvas stay.
    await page.evaluate(() => document.querySelectorAll("canvas").forEach((c) => (c.__promoMark = true)));
    const camBefore = await cameraPos(page);
    await page.click("[data-home-customize]");
    await page.waitForSelector("[data-home-editbar]");
    const options = await page.$$eval('select[aria-label="Switch presentation"] option', (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
    const current = await page.$eval('select[aria-label="Switch presentation"]', (el) => el.value);
    const other = options.find((o) => o.v !== current);
    await page.selectOption('select[aria-label="Switch presentation"]', other.v);
    await page.waitForTimeout(1500);
    const switchedAway = (await page.locator("[data-retro-terminal]").count()) === 0;
    const camOther = await cameraPos(page);
    await page.selectOption('select[aria-label="Switch presentation"]', current);
    await page.waitForSelector("[data-retro-terminal]", { timeout: 15000 });
    await page.click("[data-home-customize]");
    await page.waitForTimeout(1500);
    const camBack = await cameraPos(page);
    const kept = await page.evaluate(() => [...document.querySelectorAll("canvas")].some((c) => c.__promoMark === true));
    s = await navState(page);
    const scale1 = await page.evaluate(async (u) => (await import(u)).cosmosScaleStore.get?.() ?? null, SCALES).catch(() => null);
    check(vp, "switching layouts keeps the camera where navigation put it", switchedAway && dist(camBefore, camOther) < 0.3 && dist(camBefore, camBack) < 0.3, `${fmt(camBefore)} → ${other.t}: ${fmt(camOther)} → terminal: ${fmt(camBack)}`);
    check(vp, "switching layouts keeps the same WebGL canvas, destination and selection", kept && s.current === planet.id && s.focus?.id === planet.id);
    check(vp, "switching layouts keeps the Cosmos scale", JSON.stringify(scale0) === JSON.stringify(scale1), JSON.stringify(scale1));

    await command(page, "back");
    let camB = await cameraPos(page);
    const backOk = await until(async () => { camB = await cameraPos(page); return dist(camB, framing(galaxy)) < 0.5; }, 25000);
    s = await navState(page);
    check(vp, "terminal back: returns to the previous destination and the camera follows", backOk && s.current === galaxy.id, fmt(camB));
    await command(page, `goto ${planet.id}`);
    await until(async () => dist(await cameraPos(page), framing(planet)) < 0.5, 25000);

    /* ---------------- WP05: reload restores a live-map destination ---------------- */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const m = await import("/src/app/scene/genesis/SceneRenderManager.ts");
      m.getSceneRenderManager().reportFrameRate = () => {};
    }).catch(() => {});
    const back = await page.waitForSelector("[data-retro-terminal]", { timeout: 60000 }).then(() => true).catch(() => false);
    await tracking(page);
    let camR = await cameraPos(page);
    const framed = await until(async () => { camR = await cameraPos(page); return dist(camR, framing(planet)) < 0.5; }, 40000);
    s = await navState(page);
    check(vp, "reload: the terminal layout comes back", back);
    check(vp, "reload: the live-map planet is the current destination again", s.current === planet.id && s.pending === null, `current ${s.current}`);
    check(vp, "reload: the planet is selected again", s.focus?.kind === "node" && s.focus.id === planet.id, JSON.stringify(s.focus));
    check(vp, "reload: the camera frames the restored planet", framed, `camera ${fmt(camR)} want ${fmt(framing(planet))}`);
    const caption = await page.textContent(".rt-view-cap");
    check(vp, "reload: the terminal reads the same universe state", caption.includes(planet.label), caption);
    await page.screenshot({ path: `${OUT}/shots/${vp}-restored.png` });

    // The same restore from one of the original layouts (nothing there syncs
    // the live map on its own; the scene asks while a restore is pending).
    await page.click("[data-home-customize]");
    await page.waitForSelector("[data-home-editbar]");
    const terminalPresentation = await page.$eval('select[aria-label="Switch presentation"]', (el) => el.value);
    const original = (await page.$$eval('select[aria-label="Switch presentation"] option', (o) => o.map((x) => x.value))).find((v) => v !== terminalPresentation);
    await page.selectOption('select[aria-label="Switch presentation"]', original);
    await page.click("[data-home-customize]").catch(() => {});
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      const m = await import("/src/app/scene/genesis/SceneRenderManager.ts");
      m.getSceneRenderManager().reportFrameRate = () => {};
    }).catch(() => {});
    await page.waitForSelector("[data-lelu-home]", { timeout: 60000 }).catch(() => {});
    const onOriginal = (await page.locator("[data-retro-terminal]").count()) === 0;
    await tracking(page);
    let camO = await cameraPos(page);
    const framedO = await until(async () => { camO = await cameraPos(page); return dist(camO, framing(planet)) < 0.5; }, 40000);
    s = await navState(page);
    check(vp, "reload on an original layout restores the same planet, selection and camera", onOriginal && framedO && s.current === planet.id && s.focus?.id === planet.id, `camera ${fmt(camO)}`);
    await page.click("[data-home-customize]");
    await page.waitForSelector("[data-home-editbar]");
    await page.selectOption('select[aria-label="Switch presentation"]', terminalPresentation);
    await page.waitForSelector("[data-retro-terminal]", { timeout: 15000 });
    await page.click("[data-home-customize]");

    // An unknown stored destination: fails safely to the core.
    await page.evaluate(() => {
      const k = "lelu.lelu.cosmos.nav.v1";
      const v = JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify({ ...v, currentId: "map-agent-does-not-exist", trail: ["cosmos-core", "map-agent-does-not-exist"] }));
    });
    const before = errors.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-retro-terminal]", { timeout: 60000 }).catch(() => {});
    const settled = await until(async () => { const x = await navState(page); return x.pending === null && x.nodes.some((n) => n.id.startsWith("map-agent-")); }, 30000);
    s = await navState(page);
    check(vp, "reload with an unavailable destination falls back to the core, no error", settled && s.current === "cosmos-core" && s.trail.every((id) => s.nodes.some((n) => n.id === id)) && errors.length === before, `current ${s.current}`);
  }

  check(vp, "no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();
const pass = results.filter((r) => r.status === "PASS").length;
console.log(`\n${pass}/${results.length} PASS`);
await writeFile(`${OUT}/browser-promotion.json`, JSON.stringify({ at: new Date().toISOString(), base: BASE, pass, total: results.length, results }, null, 2));
process.exit(pass === results.length ? 0 : 1);
