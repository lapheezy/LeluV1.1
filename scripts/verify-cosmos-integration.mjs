/**
 * LÉLU COSMOS × INFINITE COSMOS — BROWSER VERIFICATION
 *
 * Measures the live app, not the build. At phone, tablet and desktop:
 *
 *   - Home loads with one governed scene canvas and no fatal error;
 *   - the Infinite Cosmos sky is populated at first paint WITHOUT the
 *     camera moving (it used to stay empty until a chunk boundary);
 *   - navigation through the same WorkspaceAPI path LÉLU's
 *     cosmos.workspace tool uses (actor "lelu") moves the camera to
 *     the destination — not only the highlight;
 *   - travelling far streams in new regions, coordinates regenerate
 *     identically, and the loaded set stays under its cap;
 *   - on a phone, the Chat Universe owns the screen with no scene
 *     canvas under it, and going Home brings the Cosmos back.
 *
 * Modules are read through the dev server's own module graph (the same
 * URL the app imports, so the same singleton instance).
 *
 * PAINTING IN A CONTAINER. With no GPU, Chromium renders through
 * SwiftShader, and the app (rightly) refuses to paint the world on a
 * software rasteriser: GenesisScene's guard and the render manager's
 * "light" profile both read the GL renderer string. `?perf-world` lifts
 * only the first. So this harness reports a hardware renderer string to
 * the page, which makes the REAL scene path run (CosmosLayer, the camera
 * tracker, flights) — on the same CPU rasteriser. At ~3 fps the render
 * manager then (rightly) steps down to "light" after 3 slow seconds, so
 * the harness also switches off that one adaptation input on the
 * manager singleton right after load. Frame rates printed
 * here are SwiftShader numbers: useful before/after on one machine,
 * never a statement about a phone's GPU.
 *
 * Run: node scripts/verify-cosmos-integration.mjs [base] [--perf]
 *      (needs the dev server; --perf adds a 10 s idle fps sample on Home)
 */

import { chromium } from "playwright";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const PERF = args.includes("--perf");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

let failures = 0;
let passes = 0;
const check = (name, ok, note = "") => {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};

const ENGINE = "/src/app/scene/genesis/engines/InfiniteCosmos.ts";
const NAV = "/src/core/cosmos/CosmosNavigation.ts";
const API = "/src/core/workspace/WorkspaceAPI.ts";

const viewports = [
  ["phone", { width: 390, height: 844 }, true],
  ["tablet", { width: 820, height: 1180 }, true],
  ["desktop", { width: 1440, height: 900 }, false],
].filter(([name]) => !ONLY || ONLY.split(",").includes(name));

async function cameraPos(page) {
  return page.evaluate(async (engine) => {
    const { default: C } = await import(engine);
    return C.getInstance().getCameraPosition();
  }, ENGINE);
}

for (const [vp, size, touch] of viewports) {
  console.log(`\n=== ${vp.toUpperCase()} ${size.width}x${size.height} ===`);
  const ctx = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    const UNMASKED_RENDERER = 0x9246;
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const original = proto.getParameter;
      proto.getParameter = function (p) {
        if (p === UNMASKED_RENDERER) return "Harness GPU"; // must not match SOFTWARE_GL_RENDERER
        return original.call(this, p);
      };
    }
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  await page.goto(BASE + (BASE.includes("?") ? "&" : "?") + "perf-world", { waitUntil: "domcontentloaded" });

  // Keep painting on a software rasteriser (see the header).
  await page.evaluate(async () => {
    const m = await import("/src/app/scene/genesis/SceneRenderManager.ts");
    m.getSceneRenderManager().reportFrameRate = () => {};
  }).catch(() => {});

  // Home: the scene canvas.
  const canvasUp = await page.waitForSelector("canvas", { timeout: 60000 }).then(() => true).catch(() => false);
  check(`scene canvas on Home @ ${vp}`, canvasUp);
  await page.waitForFunction(() => (window.__leluRenderStats?.frames ?? 0) > 5, null, { timeout: 60000 }).catch(() => {});
  // CosmosLayer is lazy: wait until its camera tracker has reported.
  // (An async predicate in waitForFunction resolves at once: a Promise is truthy.)
  const tracked = await until(async () => {
    const p = await cameraPos(page);
    return p.x !== 0 || p.y !== 0 || p.z !== 0;
  }, 60000);
  check(`camera tracker feeds the Infinite Cosmos engine @ ${vp}`, tracked);

  // 1. Sky populated at first paint, camera not moved by us.
  const sky = await page.evaluate(async (engine) => {
    const { default: C } = await import(engine);
    const c = C.getInstance();
    const d = c.getRenderableData();
    return { stars: d.stars.length, loaded: c.getLoadedCount(), cam: c.getCameraChunk() };
  }, ENGINE);
  check(`Infinite Cosmos sky populated at first paint @ ${vp}`, sky.stars > 0 && sky.loaded > 0, `${sky.stars} stars in ${sky.loaded} chunks; camera chunk ${JSON.stringify(sky.cam)}`);

  // 2. Cognition-path navigation moves the camera.
  const before = await cameraPos(page);
  const nav = await page.evaluate(async ([navUrl, apiUrl]) => {
    const { default: Nav } = await import(navUrl);
    const { default: Api } = await import(apiUrl);
    const n = Nav.getInstance();
    // A fresh profile has only the core: open a room the way a user does
    // (creating is a user act; LÉLU then travels there).
    if (!n.getState().nodes.some((node) => node.level !== "core" && !node.archived)) {
      n.createRoom({ label: "Harness Room", origin: "user" });
    }
    const target = n.getState().nodes.find((node) => node.level !== "core" && !node.archived && node.id !== n.current().id);
    if (!target) return { ok: false, reason: "no destination to go to" };
    const result = Api.getInstance().execute({ action: "navigate", actor: "lelu", roomId: target.id });
    return { ok: Boolean(result?.ok ?? true), id: target.id, label: target.label, position: target.position, current: n.current().id };
  }, [NAV, API]);
  check(`LÉLU navigate is accepted @ ${vp}`, nav.ok && nav.current === nav.id, nav.reason ?? `${nav.label}`);
  let reached = false;
  let note = "";
  if (nav.position) {
    // flyTo puts the camera 10 units in front of the ring (ring drawn at z-25).
    const want = { x: nav.position[0], y: nav.position[1], z: nav.position[2] - 25 + 10 };
    let after = before;
    reached = await until(async () => {
      after = await cameraPos(page);
      return Math.hypot(after.x - want.x, after.y - want.y, after.z - want.z) < 0.5;
    }, 20000);
    const dist = Math.hypot(after.x - want.x, after.y - want.y, after.z - want.z);
    note = `camera ${fmt(before)} → ${fmt(after)}; destination ${fmt(want)}; off by ${dist.toFixed(3)}`;
  }
  check(`camera reaches the destination LÉLU navigated to @ ${vp}`, reached, note);

  // Back to the core restores the Genesis view.
  await page.evaluate(async ([navUrl, apiUrl]) => {
    const { default: Nav } = await import(navUrl);
    const { default: Api } = await import(apiUrl);
    Api.getInstance().execute({ action: "navigate", actor: "lelu", roomId: Nav.getInstance().getState().nodes.find((n) => n.level === "core").id });
  }, [NAV, API]);
  let home = await cameraPos(page);
  const atHome = await until(async () => {
    home = await cameraPos(page);
    return Math.hypot(home.x, home.y, home.z - 6.8) < 0.5;
  }, 20000);
  check(`navigating to the core returns to the Genesis view @ ${vp}`, atHome, fmt(home));

  // 3. Infinite exploration: stream, determinism, cap. Uses the engine
  //    directly (moving the real camera 20 000 units is not a UI path).
  if (vp === "desktop") {
    const inf = await page.evaluate(async (engine) => {
      const { default: C } = await import(engine);
      const c = C.getInstance();
      const S = C.getChunkSize();
      const original = c.getCameraPosition();
      const generated0 = c.getTotalGenerated();
      const far = { x: 503 * S + 5, y: -211 * S + 5, z: 77 * S + 5 };
      const wasLoaded = c.isPositionLoaded(far.x, far.y, far.z);
      // The live tracker sets the real camera every frame; probe between frames.
      c.updateCameraPosition(far.x, far.y, far.z);
      const chunk = c.getChunkAt(far.x, far.y, far.z);
      const snap = JSON.stringify({ ...chunk, lastAccessed: 0 });
      const generated1 = c.getTotalGenerated();
      c.updateCameraPosition(0, 0, 0);
      const droppedAfterLeaving = !c.isPositionLoaded(far.x, far.y, far.z);
      c.updateCameraPosition(far.x, far.y, far.z);
      const again = JSON.stringify({ ...c.getChunkAt(far.x, far.y, far.z), lastAccessed: 0 });
      let maxLoaded = 0;
      for (let i = 0; i < 40; i++) {
        c.updateCameraPosition(i * S * 3, i * S, -i * S * 2);
        c.preloadAround(-i * S * 11, i * S * 7, i * S * 5);
        maxLoaded = Math.max(maxLoaded, c.getLoadedCount());
      }
      c.updateCameraPosition(original.x, original.y, original.z);
      return { wasLoaded, newRegion: generated1 > generated0, deterministic: snap === again, droppedAfterLeaving, maxLoaded, cap: C.getMaxLoadedChunks() };
    }, ENGINE);
    check("travelling far generates a region that did not exist", !inf.wasLoaded && inf.newRegion);
    check("left regions are released", inf.droppedAfterLeaving);
    check("a revisited region regenerates identically", inf.deterministic);
    check("loaded chunks stay under the cap on a long walk with preloads", inf.maxLoaded <= inf.cap, `max ${inf.maxLoaded} / cap ${inf.cap}`);
  }

  // 4. Phone: Chat Universe owns the screen; Home restores the Cosmos.
  if (vp === "phone") {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
    await page.waitForTimeout(1500);
    const composer = page.locator("textarea[placeholder^='Message LÉLU']:visible, .lcu-input textarea:visible");
    if (!(await composer.count())) {
      await page.locator("button.lcu-card:visible").first().click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    const chatUp = (await composer.count()) > 0;
    check("Chat Universe composer on screen @ phone", chatUp);
    // The scene is the world inside [data-workspace="genesis-v1"]. LÉLU's
    // companion figure has its own small canvas over every surface by
    // design (GenesisScene: "her figure over every surface").
    const under = await page.evaluate(() => ({
      sceneCanvases: document.querySelectorAll('[data-workspace="genesis-v1"] canvas').length,
      otherCanvases: [...document.querySelectorAll("canvas")].filter((c) => !c.closest('[data-workspace="genesis-v1"]')).map((c) => Math.round(c.getBoundingClientRect().width)),
      universe: document.querySelector(".lcu")?.getAttribute("data-cosmos") ?? null,
    }));
    check("no Cosmos scene canvas mounted under the phone chat", under.sceneCanvases === 0, JSON.stringify(under));
    if (chatUp) {
      const box = composer.first();
      await box.click();
      await box.fill("hello");
      check("composer accepts typing @ phone", (await box.inputValue()) === "hello");
      await box.fill("");
    }
    const close = page.getByRole("button", { name: "Close Chat Universe" });
    if (await close.count()) await close.first().click().catch(() => {});
    await page.waitForTimeout(2000);
    const back = await page.waitForSelector("canvas", { timeout: 20000 }).then(() => true).catch(() => false);
    const frames0 = await page.evaluate(() => window.__leluRenderStats?.frames ?? 0);
    await page.waitForTimeout(6000);
    const frames1 = await page.evaluate(() => window.__leluRenderStats?.frames ?? 0);
    check("going Home brings the Cosmos scene back and it draws", back && frames1 > frames0, `frames ${frames0} → ${frames1}`);
    const skyBack = await page.evaluate(async (engine) => {
      const { default: C } = await import(engine);
      return C.getInstance().getRenderableData().stars.length;
    }, ENGINE);
    check("the sky is still populated after returning Home", skyBack > 0, `${skyBack} stars`);
  }

  if (PERF) {
    await page.waitForTimeout(2000);
    const f0 = await page.evaluate(() => ({ frames: window.__leluRenderStats?.frames ?? 0, t: performance.now(), heap: performance.memory?.usedJSHeapSize ?? 0 }));
    const longTasks = await page.evaluate(() => new Promise((resolve) => {
      let total = 0;
      let count = 0;
      const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) { total += e.duration; count += 1; } });
      po.observe({ type: "longtask", buffered: false });
      setTimeout(() => { po.disconnect(); resolve({ total: Math.round(total), count }); }, 10000);
    }));
    const f1 = await page.evaluate(() => ({ frames: window.__leluRenderStats?.frames ?? 0, t: performance.now(), heap: performance.memory?.usedJSHeapSize ?? 0 }));
    const fps = ((f1.frames - f0.frames) / ((f1.t - f0.t) / 1000)).toFixed(1);
    console.log(`  PERF  ${vp}: ${fps} fps over 10 s on Home; long tasks ${longTasks.count} (${longTasks.total} ms); heap ${(f0.heap / 1e6).toFixed(1)} → ${(f1.heap / 1e6).toFixed(1)} MB`);
  }

  check(`no fatal page error @ ${vp}`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

async function until(fn, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function fmt(p) {
  return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
}

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
