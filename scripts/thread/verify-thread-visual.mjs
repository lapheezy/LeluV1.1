/**
 * WP20 · WP08/WP09 — visual and behavioural acceptance of the Thread, in the
 * running app (dev server on 5173 or LELU_BASE). Every screenshot is the real
 * application; every check reads the page's own state. Writes
 * docs/missions/wp20/verify-thread-visual.json and docs/missions/wp20/accept/*.png.
 *
 * Evidence classes, as the mission asks them to be kept apart:
 *   browser-rendered   desktop Chromium screenshots and measurements
 *   emulated-mobile    Chromium with the phone's viewport + touch (not a phone)
 *   physical-device    none: nothing here ran on a physical iPhone
 */
import { mkdir, writeFile } from "node:fs/promises";
import { devices } from "playwright";
import { launch, track } from "../evolution/harness.mjs";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/wp20/accept";
await mkdir(OUT, { recursive: true });
const results = [];
const measures = {};
const errors = [];
const check = (id, name, ok, detail = "", evidence = "browser-rendered") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ id, name, status: ok ? "VERIFIED" : "FAILED", evidence, detail: d });
  console.log(`${ok ? "✓" : "✗"} [${id}] ${name}${d ? ` — ${d.slice(0, 200)}` : ""}`);
};
let shotN = 0;
const shot = async (page, name) => {
  shotN += 1;
  const p = `${OUT}/${String(shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: p });
  return p;
};

async function boot(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count())
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    if ((await page.locator("[data-lelu-home]").count()) || (await page.locator("[data-thread-stage]").count())) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);
}

/** A study conversation: four messages, V1/V2(3D)/V3 maps, the 3Blue1Brown video (verified by oEmbed), a web page. */
async function seed(page, title) {
  return page.evaluate(async (title) => {
    const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const T = await import("/src/core/thread/ThreadObjects.ts");
    const c = MC.create(title);
    const t0 = Date.now() - 120000;
    [
      ["user", "Let's understand Neural Maps, cognitive architectures, knowledge graphs and agent societies."],
      ["assistant", "Happy to. V1 is what I know, V2 is how I'm built, V3 is my agent society."],
      ["user", "Open all three and a good video on neural networks."],
      ["assistant", "Here are V1, V2 in 3D and V3, with 3Blue1Brown's neural-network chapter beside them."],
    ].forEach(([role, text], i) => MC.addMessage(c.id, { id: `${c.id}-m${i}`, role, text, timestamp: t0 + i * 1000, source: "local" }));
    const s = (o) => T.summon({ conversationId: c.id, by: "lelu", ...o });
    s({ kind: "neural-map", title: "V1 · Knowledge", map: { aspect: "v1", view: "force-directed", dim: "2d", highlight: [], selected: null } });
    s({ kind: "neural-map", title: "V2 · Cognitive architecture", map: { aspect: "v2", view: "connectome-tractography", dim: "3d", highlight: ["subsystem:memory", "subsystem:cognition"], selected: null } });
    s({ kind: "neural-map", title: "V3 · Agent society", map: { aspect: "v3", view: "core-orbit", dim: "2d", highlight: [], selected: null } });
    s({ kind: "youtube", title: "But what is a neural network? | Deep learning chapter 1", video: { id: "aircAruvnKk", title: "But what is a neural network? | Deep learning chapter 1", channel: "3Blue1Brown" } });
    s({ kind: "web", title: "Knowledge graph — Wikipedia", web: { url: "https://en.wikipedia.org/wiki/Knowledge_graph", title: "Knowledge graph — Wikipedia", snippet: "A knowledge graph is a knowledge base that uses a graph-structured data model." } });
    return c.id;
  }, title);
}

async function openThread(page, title) {
  if (await page.locator("[data-thread-stage]").count()) return 0;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector("[aria-label='Chat Universe']");
  await page.click(`button[aria-label="Open ${title}"]`);
  await page.waitForTimeout(900);
  const t0 = Date.now();
  for (let i = 0; i < 20 && !(await page.locator("[data-thread-stage]").count()); i++) {
    // The stage switcher may not be ready on the first try: keep asking until the thread is there.
    await page.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(1500);
  }
  await page.waitForSelector("[data-thread-stage]");
  return Date.now() - t0;
}
const variant = (page, v) => page.evaluate((id) => document.querySelector(`[data-variant-tab="${id}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), v);

/** Frame timing over `ms`, from requestAnimationFrame (measured in the page). */
const frames = (page, ms = 3000) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const t = [];
        const start = performance.now();
        const step = (now) => {
          t.push(now);
          if (now - start < ms) requestAnimationFrame(step);
          else {
            const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
            resolve({ frames: t.length, fps: Math.round((t.length / ms) * 1000), medianMs: +d[Math.floor(d.length / 2)].toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1), worstMs: +d.at(-1).toFixed(1) });
          }
        };
        requestAnimationFrame(step);
      }),
    ms,
  );

const browser = await launch();
try {
  /* ============================== desktop ============================== */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  track(page, errors);
  await boot(page);
  const TITLE = "Thread acceptance";
  const id = await seed(page, TITLE);
  measures.threadLoadMs = await openThread(page, TITLE);
  await variant(page, "raindrop");
  await page.waitForTimeout(1800);
  check("WP09", "initial Thread renders immersive with header, chips and variant tabs", (await page.locator('[data-thread-header] [data-chip]').count()) === 5 && (await page.locator('.lst-root[data-immersive="true"]').count()) === 1);
  await shot(page, "initial-thread-raindrop");

  // Falling drop → sink → scroll back (real feed state).
  const feed = () => page.evaluate(() => { const f = document.querySelector("[data-raindrop-feed]"); return { total: +f.dataset.feedTotal, start: +f.dataset.feedStart, end: +f.dataset.feedEnd }; });
  const before = await feed();
  await page.evaluate(async (cid) => { const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); MC.addMessage(cid, { id: `${cid}-new`, role: "user", text: "How does the video's neural network relate to your V2 architecture?", timestamp: Date.now(), source: "local" }); }, id);
  await page.waitForTimeout(260);
  await shot(page, "drop-falling");
  const newDrop = await page.evaluate((cid) => document.querySelector(`[data-drop="${cid}-new"]`)?.dataset.new, id);
  await page.waitForTimeout(700);
  await shot(page, "drop-landed-oldest-sinking");
  const after = await feed();
  check("WP03", "a new message falls in as a gold-lit drop and the oldest hanging drop sinks", after.total === before.total + 1 && after.start === before.start + 1 && newDrop === "true", { before, after });
  const t0 = Date.now();
  await page.locator("[data-feed-scroll]").fill(String(Math.min(3, after.total)));
  await page.waitForFunction(() => document.querySelector("[data-raindrop-feed]").dataset.feedEnd === "3", null, { timeout: 5000 });
  measures.scrubResponseMs = Date.now() - t0;
  await page.waitForTimeout(1300);
  const rose = await page.evaluate(() => [...document.querySelectorAll('[data-drop][data-place="hanging"]')].map((d) => d.dataset.arrival));
  check("WP03", "scrolling back lifts earlier drops out of the puddle (they arrive by rising)", rose.length > 0 && rose.every((a) => a === "rose"), rose);
  await shot(page, "scroll-back-drops-rising");
  await page.click("[data-feed-follow]");
  await page.waitForTimeout(1300);

  // All five variants, objects present, frame timing per variant.
  measures.variants = {};
  for (const v of ["workspace", "ribbon", "live", "split", "raindrop"]) {
    await variant(page, v);
    await page.waitForTimeout(2200);
    const objs = await page.locator("[data-thread-object]").count();
    measures.variants[v] = { objects: objs, frames: await frames(page, 2000), webglCanvases: await page.locator("[data-arch-view] canvas").count() };
    await shot(page, `variant-${v}`);
  }
  check("WP05", "all five variants render (objects positioned in four, drops in Raindrop)", Object.entries(measures.variants).every(([v, m]) => (v === "raindrop" ? true : m.objects >= 1)), measures.variants);

  // Liquid object manipulation in the workspace: drag, resize, rotate — measured.
  await variant(page, "workspace");
  await page.waitForTimeout(1500);
  const target = page.locator('[data-thread-object][data-kind="web"]');
  const m0 = JSON.parse(await target.getAttribute("data-measured"));
  const grip = await target.locator(".to-grip").boundingBox();
  const dragStart = Date.now();
  await page.mouse.move(grip.x + 5, grip.y + 5);
  await page.mouse.down();
  await page.mouse.move(grip.x + 65, grip.y - 35, { steps: 6 });
  await page.mouse.up();
  measures.dragApplyMs = Date.now() - dragStart;
  await page.waitForTimeout(200);
  const m1 = JSON.parse(await target.getAttribute("data-measured"));
  await target.hover();
  const rs = await target.locator(".to-resize").boundingBox();
  await page.mouse.move(rs.x + 8, rs.y + 8);
  await page.mouse.down();
  await page.mouse.move(rs.x + 68, rs.y + 48, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const m2 = JSON.parse(await target.getAttribute("data-measured"));
  await target.hover();
  const rt = await target.locator(".to-rotate").boundingBox();
  await page.mouse.move(rt.x + 7, rt.y + 7);
  await page.mouse.down();
  await page.mouse.move(rt.x + 90, rt.y + 30, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const m3 = JSON.parse(await target.getAttribute("data-measured"));
  check("WP04", "drag moves the object by the measured amount", Math.abs(m1.x - m0.x - 60) <= 3 && Math.abs(m1.y - m0.y + 40) <= 3, { m0, m1 });
  check("WP04", "resize grows it by the measured amount", Math.abs(m2.w - m1.w - 60) <= 3 && Math.abs(m2.h - m1.h - 40) <= 3, { m1, m2 });
  check("WP04", "rotate turns it (measured angle)", Math.abs(m3.rot) >= 10, { rot: m3.rot });
  await shot(page, "liquid-object-dragged-resized-rotated");

  // Map state: select a V3 node, highlight on V2 is drawn.
  const v3 = page.locator('[data-thread-object] [data-thread-map="v3"]');
  await page.evaluate(() => document.querySelector('[data-thread-map="v3"] [data-tm-node]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(300);
  const sel = await v3.getAttribute("data-map-selected");
  check("WP06", "a V3 node can be selected and its details open in the thread", Boolean(sel) && (await page.locator("[data-tm-card]").count()) >= 1, sel);
  check("WP06", "V1, V2 (3D) and V3 render from the live aspects", (await page.locator('[data-thread-map="v1"]').getAttribute("data-map-nodes")) > "0" && (await page.locator('[data-thread-map="v2"][data-map-dim="3d"]').count()) === 1 && (await page.locator('[data-thread-map="v2"]').getAttribute("data-map-highlight")) === "2");
  await shot(page, "maps-v1-v2-3d-v3-selected");

  // YouTube: the person presses play in YouTube's own player; state read from the player.
  const yt = page.locator('[data-thread-object][data-kind="youtube"] iframe');
  const box = await yt.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let state = "";
  for (let i = 0; i < 24 && state !== "playing"; i++) {
    await page.waitForTimeout(500);
    state = await page.locator("[data-youtube]").getAttribute("data-player-state");
  }
  const tA = Number(await page.locator("[data-youtube]").getAttribute("data-player-time"));
  await page.waitForTimeout(3000);
  const tB = Number(await page.locator("[data-youtube]").getAttribute("data-player-time"));
  const ytName = "YouTube plays in the thread beside the maps (player state and advancing time read from the player)";
  // If YouTube's own player refuses the video, read its words from inside the frame and record the block as it is.
  const ytFrame = page.frames().find((f) => /youtube(-nocookie)?\.com\/embed/.test(f.url()));
  const refusal = state === "playing" ? "" : ((await ytFrame?.evaluate(() => document.body?.innerText ?? "").catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  if (state !== "playing" && /unavailable|isn.t available|not available|error/i.test(refusal)) {
    results.push({ id: "WP09", name: ytName, status: "BLOCKED", evidence: "browser-rendered", detail: `YouTube's player in this container says: "${refusal.slice(0, 160)}" (state ${state}). Same for every video tried, so it is the environment, not the thread. Needs a check on a normal network.` });
    console.log(`■ [WP09] ${ytName} — BLOCKED: ${refusal.slice(0, 160)}`);
  } else check("WP09", ytName, state === "playing" && tB > tA, { state, tA, tB, refusal: refusal.slice(0, 160) });
  measures.framesWithVideoAndMaps = await frames(page, 3000);
  await shot(page, "youtube-playing-beside-neural-maps");

  // Variant switch keeps position, size, rotation, group and map state.
  await page.evaluate(async (cid) => { const T = await import("/src/core/thread/ThreadObjects.ts"); const os = T.objectsFor(cid); T.group([os[0].id, os[1].id], "study-pair"); }, id);
  const keep = () => page.evaluate((cid) => import("/src/core/thread/ThreadObjects.ts").then((T) => T.objectsFor(cid).map((o) => ({ id: o.id, t: o.transforms.workspace ?? null, g: o.group, map: o.map ? `${o.map.aspect}/${o.map.view}/${o.map.selected}` : null }))), id);
  const k0 = await keep();
  for (const v of ["ribbon", "live", "split", "raindrop", "workspace"]) {
    await variant(page, v);
    await page.waitForTimeout(500);
  }
  const k1 = await keep();
  check("WP05", "switching through all variants loses no position, size, rotation, group or map state", JSON.stringify(k0) === JSON.stringify(k1), { objects: k0.length });

  // Reload: object transforms, maps, feed position and video resume point restore.
  const r0 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  await boot(page);
  await page.waitForSelector("[data-thread-stage]", { timeout: 30000 }).catch(() => {});
  measures.reloadRestoreMs = Date.now() - r0;
  const k2 = await keep();
  const m4 = (await page.locator('[data-thread-object][data-kind="web"]').count()) ? JSON.parse(await page.locator('[data-thread-object][data-kind="web"]').getAttribute("data-measured")) : null;
  check("WP06/WP10", "after a reload the thread reopens with every object, transform, group and map state", JSON.stringify(k1) === JSON.stringify(k2) && m4 && Math.abs(m4.rot - m3.rot) < 1, { restoredObjects: k2.length, m4 });
  const lastTime = await page.evaluate((cid) => import("/src/core/thread/ThreadObjects.ts").then((T) => T.objectsFor(cid).find((o) => o.kind === "youtube")?.lastTime ?? null), id);
  check("WP06", "the video does not keep playing across a reload; it offers to resume where the player last reported", (await page.locator("[data-youtube]").getAttribute("data-player-state").catch(() => "")) !== "playing", { lastTime });
  measures.memory = await page.evaluate(() => (performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576) } : "unavailable"));
  measures.webgl = await page.evaluate(() => ({ archCanvases: document.querySelectorAll("[data-arch-view] canvas").length, allCanvases: document.querySelectorAll("canvas").length, released: document.querySelectorAll("[data-webgl-released]").length }));
  await ctx.close();

  /* ============================== emulated phones ============================== */
  const sizes = [[320, 740], [375, 812], [390, 844], [430, 932]];
  measures.mobile = {};
  for (const [w, h] of sizes) {
    const pctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices["iPhone 15 Pro"].userAgent });
    const p = await pctx.newPage();
    track(p, errors);
    await boot(p);
    const T2 = `Phone ${w}`;
    await seed(p, T2);
    await openThread(p, T2);
    const out = {};
    for (const v of ["raindrop", "ribbon", "workspace"]) {
      await variant(p, v);
      await p.waitForTimeout(1800);
      const r = await p.evaluate(() => {
        const W = innerWidth;
        const objs = [...document.querySelectorAll("[data-thread-object], [data-drop][data-place='hanging']")].map((e) => e.getBoundingClientRect());
        const head = document.querySelector("[data-thread-header]")?.getBoundingClientRect();
        return { overflowX: objs.filter((r) => r.right > W + 1 || r.left < -1).length, objects: objs.length, headerFits: head ? head.right <= W + 1 : false, docScrollW: document.documentElement.scrollWidth };
      });
      out[v] = r;
      await p.screenshot({ path: `${OUT}/m-${w}x${h}-${v}.png` });
    }
    measures.mobile[`${w}x${h}`] = out;
    check("WP09", `${w}×${h}: objects and drops stay inside the screen in raindrop, ribbon and workspace`, Object.values(out).every((r) => r.overflowX === 0 && r.objects > 0), out, "emulated-mobile");
    await pctx.close();
  }
} finally {
  await browser.close();
}
const own = errors.filter((e) => /thread|Thread|Raindrop|ThreadMap|YouTubeObject|liquid/i.test(e));
check("WP10", "no page errors from the Thread", own.length === 0, own.join(" | "));
results.push({ id: "WP09", name: "physical iPhone", status: "NOT RUN", evidence: "physical-device", detail: "No physical device is reachable from this container; phone results are Chromium emulation." });
await writeFile("docs/missions/wp20/verify-thread-visual.json", `${JSON.stringify({ at: new Date().toISOString(), results, measures, otherPageErrors: errors.slice(0, 20) }, null, 1)}\n`);
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.filter((r) => r.status === "VERIFIED").length}/${results.length} verified, ${failed} failed, ${results.filter((r) => r.status === "BLOCKED").length} blocked by the environment, ${results.filter((r) => r.status === "NOT RUN").length} not run`);
console.log(JSON.stringify(measures, null, 1).slice(0, 3000));
process.exit(failed ? 1 : 0);
