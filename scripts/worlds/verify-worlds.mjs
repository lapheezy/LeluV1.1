/**
 * WP21 acceptance: the world engine in the running app (Chromium, SwiftShader).
 *
 * Proves in the real Thread: a world is built from a family through the
 * editor; layer controls change the rendered pixels; 2D and 3D coexist;
 * families combine; edits, duplicates and renames persist across reload;
 * export/import round-trips; Time & Place eras render and compare; Neural
 * Maps stay live inside a world; phones stay usable; frame cost is measured.
 * Writes docs/missions/wp21/verify-worlds.json and docs/missions/wp21/accept/*.png.
 *
 *   node scripts/worlds/verify-worlds.mjs   (dev server on 5173 or LELU_BASE)
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { launch, track } from "../evolution/harness.mjs";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/wp21/accept";
await mkdir(OUT, { recursive: true });
const results = [];
const measures = {};
const errors = [];
const check = (id, name, ok, detail = "", evidence = "browser-rendered") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ id, name, status: ok ? "VERIFIED" : "FAILED", evidence, detail: d });
  console.log(`${ok ? "✓" : "✗"} [${id}] ${name}${d ? ` — ${d.slice(0, 220)}` : ""}`);
};
let shotN = 0;
const shot = async (page, name) => {
  shotN += 1;
  const p = `${OUT}/${String(shotN).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: p });
  return p;
};
/** Share of pixels that differ by more than a small threshold between two screenshots. */
async function diff(a, b) {
  const [x, y] = await Promise.all([a, b].map((buf) => sharp(buf).resize(320, 200, { fit: "fill" }).raw().toBuffer()));
  let n = 0;
  for (let i = 0; i < x.length; i += 3) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 40) n++;
  return +(n / (x.length / 3)).toFixed(4);
}

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

async function seed(page, title) {
  return page.evaluate(async (title) => {
    const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const T = await import("/src/core/thread/ThreadObjects.ts");
    const c = MC.create(title);
    const t0 = Date.now() - 120000;
    [
      ["user", "Build me a world to study in: celestial, with my maps inside it."],
      ["assistant", "Here it is. V1, V2 in 3D and V3 sit inside it, live."],
      ["user", "Now show Tampa across the decades."],
      ["assistant", "Tampa from c.1920 to today, with the sources for each era."],
    ].forEach(([role, text], i) => MC.addMessage(c.id, { id: `${c.id}-m${i}`, role, text, timestamp: t0 + i * 1000, source: "local" }));
    const s = (o) => T.summon({ conversationId: c.id, by: "lelu", ...o });
    s({ kind: "neural-map", title: "V1 · Knowledge", map: { aspect: "v1", view: "force-directed", dim: "2d", highlight: [], selected: null } });
    s({ kind: "neural-map", title: "V2 · Cognitive architecture", map: { aspect: "v2", view: "connectome-tractography", dim: "3d", highlight: [], selected: null } });
    s({ kind: "web", title: "Hillsborough County aerials", web: { url: "https://www.planhillsborough.org/", title: "Plan Hillsborough", snippet: "Historic aerial photographs of Tampa." } });
    return c.id;
  }, title);
}

const click = (page, sel) => page.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), sel);
async function openThread(page, title) {
  if (await page.locator("[data-thread-stage]").count()) return;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector("[aria-label='Chat Universe']");
  await page.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
  await click(page, `button[aria-label="Open ${title}"]`);
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForSelector("[data-thread-stage]");
}
const variant = (page, v) => click(page, `[data-variant-tab="${v}"]`);
const worldReady = async (page) => {
  await page.waitForSelector("[data-world] canvas", { timeout: 60000 });
  await page.waitForTimeout(4500);
};
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
            resolve({ fps: Math.round((t.length / ms) * 1000), medianMs: +d[Math.floor(d.length / 2)].toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1) });
          }
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
const store = (page, fn, arg) => page.evaluate(async ([src, arg]) => { const S = await import("/src/core/worlds/WorldStore.ts"); return new Function("S", "arg", `return (${src})(S, arg)`)(S, arg); }, [fn.toString(), arg]);

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  track(page, errors);
  await boot(page);
  await page.evaluate(() => localStorage.removeItem("lelu.worlds.v1"));
  const title = `World study ${Date.now() % 100000}`;
  await seed(page, title);
  await page.waitForTimeout(600);
  await openThread(page, title);
  await variant(page, "workspace");
  await page.waitForTimeout(1500);
  measures.framesNoWorld = await frames(page, 3000);
  await shot(page, "thread-before-world");

  // Editor → family → world behind the thread.
  await click(page, "[data-world-toggle]");
  await page.waitForSelector("[data-world-editor]");
  await click(page, '[data-family="celestial"]');
  await worldReady(page);
  const on = await page.evaluate(() => ({ host: document.querySelector(".tw-host")?.dataset.worldOn, families: document.querySelector("[data-world]")?.dataset.worldFamilies, two: document.querySelector("[data-world-2d]")?.getAttribute("data-world-2d"), canvas: document.querySelectorAll("[data-world] canvas").length, maps: document.querySelectorAll("[data-thread-map]").length }));
  check("WP06", "a family chosen in the editor builds a world behind the thread (3D canvas + 2D overlay), Neural Maps still live in front", on.host === "true" && on.canvas === 1 && /zodiac-wheel/.test(on.two ?? "") && on.maps >= 2, on);
  await shot(page, "celestial-world-editor-open");

  // Layer controls change the rendered pixels.
  await click(page, "[data-world-toggle]");
  await page.waitForTimeout(600);
  const before = await page.screenshot();
  await shot(page, "celestial-world-thread");
  const wid = await page.evaluate(() => document.querySelector("[data-world]").dataset.world);
  await store(page, (S, w) => S.applyEdit(w, { op: "toggle", id: "celestial-zodiac-wheel-4" }), wid);
  await page.waitForTimeout(900);
  const after2d = await page.screenshot();
  const d2 = await diff(before, after2d);
  await store(page, (S, w) => S.applyEdit(w, { op: "toggle", id: "celestial-planet-2" }), wid);
  await page.waitForTimeout(1500);
  const after3d = await page.screenshot();
  const d3 = await diff(after2d, after3d);
  check("WP09", "turning a 2D layer off and a 3D layer off each changes the rendered scene (pixel difference)", d2 > 0.004 && d3 > 0.001, { zodiacWheelOff: d2, planetOff: d3 });
  await store(page, (S, w) => { S.applyEdit(w, { op: "toggle", id: "celestial-zodiac-wheel-4" }); S.applyEdit(w, { op: "toggle", id: "celestial-planet-2" }); }, wid);

  // Modes: 2D only / 3D only / combined.
  const modes = {};
  for (const m of ["2d", "3d", "combined"]) {
    await store(page, (S, a) => S.applyEdit(a.w, { op: "world", changes: { mode: a.m } }), { w: wid, m });
    await page.waitForTimeout(m === "2d" ? 800 : 3500);
    modes[m] = await page.evaluate(() => ({ canvas: document.querySelectorAll("[data-world] canvas").length, svg: document.querySelectorAll("[data-world] .w2-layer").length }));
    await shot(page, `celestial-mode-${m}`);
  }
  check("WP02", "2D and 3D coexist and can be shown separately (canvas/SVG counts per mode)", modes["2d"].canvas === 0 && modes["2d"].svg > 0 && modes["3d"].canvas === 1 && modes["3d"].svg === 0 && modes.combined.canvas === 1 && modes.combined.svg > 0, modes);

  // Customisation persists across reload: density, motion, a layer colour, rename, duplicate.
  await store(page, (S, w) => { S.applyEdit(w, { op: "world", changes: { density: 1.6, motion: 0.4, name: "My celestial study" } }); S.applyEdit(w, { op: "set", id: "celestial-constellations-5", changes: { opacity: 0.3, params: { color: "#7dd3fc" } } }); S.duplicateWorld(w); }, wid);
  await page.waitForTimeout(400);
  const savedBefore = await store(page, (S) => ({ n: S.savedWorlds().length, active: S.activeWorld().id, name: S.activeWorld().name }));
  await page.reload({ waitUntil: "domcontentloaded" });
  console.log("· reloaded");
  await boot(page);
  console.log("· booted");
  await openThread(page, title);
  console.log("· thread open");
  await worldReady(page);
  const savedAfter = await store(page, (S, w) => { const o = S.savedWorlds().find((x) => x.id === w); return { n: S.savedWorlds().length, active: S.activeWorld().id, name: S.activeWorld().name, density: o.density, motion: o.motion, constellation: o.layers.find((l) => l.id === "celestial-constellations-5") }; }, wid);
  check("WP05", "edits, rename and a duplicate survive a reload, and the duplicate is active", savedAfter.n === 2 && savedAfter.active === savedBefore.active && savedAfter.density === 1.6 && savedAfter.motion === 0.4 && savedAfter.constellation.opacity === 0.3 && savedAfter.constellation.params.color === "#7dd3fc" && /copy/.test(savedAfter.name), { savedBefore, savedAfter: { ...savedAfter, constellation: undefined } });
  await shot(page, "after-reload-duplicate-active");

  // Export → import round trip.
  const rt = await store(page, (S) => { const a = S.activeWorld(); const j = S.exportWorld(a.id); const r = S.importWorld(j); return { ok: !!r.world, sameLayers: JSON.stringify(r.world.layers) === JSON.stringify(a.layers), issues: r.issues, newId: r.world.id !== a.id }; });
  const bad = await store(page, (S) => S.importWorld('{"format":"other"}').issues);
  check("WP05", "export/import round-trips a world exactly; a foreign file is refused", rt.ok && rt.sameLayers && rt.newId && bad.length === 1, { rt, bad });

  // Five cross-theme combinations, through the editor's combine action.
  const combos = [["underwater", "celestial"], ["volcano", "holo-hud"], ["autumn", "doodle"], ["urban-neon", "quantum"], ["kemet", "sacred-geometry"]];
  measures.combos = {};
  for (const [a, b] of combos) {
    await store(page, (S, f) => { const w = S.createWorld([f[0]]); S.combineInto(w.id, f[1]); }, [a, b]);
    await worldReady(page);
    const fams = await page.evaluate(() => document.querySelector("[data-world]")?.dataset.worldFamilies);
    measures.combos[`${a}+${b}`] = { families: fams, frames: await frames(page, 2000) };
    await shot(page, `combo-${a}+${b}`);
  }
  check("WP09", "five cross-theme combinations render in the thread", Object.values(measures.combos).every((c) => c.families.split(" ").length === 2), Object.fromEntries(Object.entries(measures.combos).map(([k, v]) => [k, v.families])));

  // Time & Place: eras through the editor, and three comparisons.
  await click(page, "[data-world-toggle]");
  await page.waitForSelector("[data-world-editor]");
  await click(page, '[data-era="1999"]');
  await worldReady(page);
  const place = await page.evaluate(() => ({ card: document.querySelector("[data-world-place]")?.textContent, sources: document.querySelectorAll("[data-place-sources] li").length }));
  check("WP04", "an era renders with its confidence label and its cited sources", /Tampa/.test(place.card ?? "") && /approximate|documented/.test(place.card ?? "") && place.sources >= 2, place);
  await shot(page, "tampa-1999-editor-sources");
  await click(page, "[data-compare-toggle]");
  const pairs = [["c1920", "present"], ["1958", "1999"], ["present", "2060"]];
  for (const [a, b] of pairs) {
    await page.evaluate(([a, b]) => {
      const [l, r] = document.querySelectorAll("[data-world-editor] .we-place select[aria-label='Left era'], [data-world-editor] .we-place select[aria-label='Right era']");
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("change", { bubbles: true })); };
      set(l, a);
      set(r, b);
    }, [a, b]);
    await page.waitForTimeout(6000);
    await click(page, "[data-world-toggle]");
    await page.waitForTimeout(500);
    await shot(page, `tampa-compare-${a}-vs-${b}`);
    await click(page, "[data-world-toggle]");
  }
  const cmp = await page.evaluate(() => ({ compare: document.querySelector("[data-world-compare]")?.dataset.worldCompare, canvases: document.querySelectorAll("[data-world-compare] canvas").length }));
  check("WP04", "two eras compare side by side with a split slider", cmp.compare === "present|2060" && cmp.canvases === 2, cmp);
  await click(page, "[data-compare-toggle]");
  await click(page, "[data-world-toggle]");

  // Variants keep working inside a world.
  await store(page, () => { /* celestial copy stays active */ });
  await store(page, (S) => S.activate(S.savedWorlds()[1].id));
  measures.variants = {};
  for (const v of ["raindrop", "ribbon", "live", "workspace"]) {
    await variant(page, v);
    await page.waitForTimeout(2500);
    measures.variants[v] = { world: await page.evaluate(() => document.querySelector(".tw-host")?.dataset.worldOn), frames: await frames(page, 2000) };
    await shot(page, `variant-${v}-in-world`);
  }
  check("WP06", "every thread variant renders inside the world", Object.values(measures.variants).every((v) => v.world === "true"), Object.fromEntries(Object.entries(measures.variants).map(([k, v]) => [k, v.world])));

  // Performance: the same world at each quality tier.
  const wid2 = await store(page, (S) => S.activeWorld().id);
  measures.tiers = {};
  for (const q of ["low", "medium", "high", "auto"]) {
    await store(page, (S, a) => S.applyEdit(a.w, { op: "world", changes: { quality: a.q } }), { w: wid2, q });
    await page.waitForTimeout(q === "auto" ? 7000 : 3000);
    measures.tiers[q] = { tier: await page.evaluate(() => document.querySelector("[data-world]").dataset.worldTier), frames: await frames(page, 2500) };
  }
  measures.framesWithWorldAuto = measures.tiers.auto.frames;
  check("WP08", "quality tiers apply and automatic quality chooses a tier from measured frames", measures.tiers.low.tier === "low" && measures.tiers.high.tier === "high" && ["low", "medium", "high"].includes(measures.tiers.auto.tier), Object.fromEntries(Object.entries(measures.tiers).map(([k, v]) => [k, `${v.tier} ${v.frames.fps}fps`])));

  // Turning the world off restores the thread's own look.
  await store(page, (S) => S.activate(null));
  await page.waitForTimeout(800);
  check("WP06", "turning the world off returns the thread to its own backdrop", (await page.evaluate(() => document.querySelector(".tw-host")?.dataset.worldOn)) === "false" && (await page.locator("[data-world] canvas").count()) === 0);
  await store(page, (S) => S.activate(S.savedWorlds()[1].id));
  await ctx.close();

  // Reduced motion: the world renders a still frame.
  const rctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const rp = await rctx.newPage();
  await rp.goto(`${BASE}world-lab.html?f=hurricane&q=low`, { waitUntil: "load" });
  await rp.waitForSelector("[data-world] canvas", { timeout: 60000 });
  await rp.waitForTimeout(2500);
  check("WP08", "reduced motion freezes the world (no animation loop)", (await rp.evaluate(() => document.querySelector("[data-world]").dataset.worldReduced)) === "true");
  await rctx.close();

  // Phones (emulated): the thread inside a world stays inside the screen.
  for (const [w, h] of [[320, 740], [375, 812], [390, 844], [430, 932]]) {
    const pctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pp = await pctx.newPage();
    track(pp, errors);
    await boot(pp);
    const t = `World phone ${w}`;
    const pid = await seed(pp, t);
    await pp.evaluate(async () => { const S = await import("/src/core/worlds/WorldStore.ts"); const x = S.createWorld(["aurora"]); S.combineInto(x.id, "celestial"); });
    await pp.waitForTimeout(400);
    await openThread(pp, t);
    const out = {};
    for (const v of ["raindrop", "workspace"]) {
      await variant(pp, v);
      await pp.waitForSelector("[data-world] canvas", { timeout: 60000 });
      await pp.waitForTimeout(3500);
      out[v] = await pp.evaluate(() => ({ overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth), tier: document.querySelector("[data-world]")?.dataset.worldTier, world: document.querySelector(".tw-host")?.dataset.worldOn }));
      await pp.screenshot({ path: `${OUT}/m-${w}x${h}-${v}.png` });
    }
    void pid;
    check("WP08", `${w}×${h}: the thread inside a world stays inside the screen (raindrop, workspace)`, Object.values(out).every((r) => r.overflowX === 0 && r.world === "true"), out, "emulated-mobile");
    await pctx.close();
  }
} finally {
  await browser.close();
}
const own = errors.filter((e) => /world|World|three|WebGL|shader|Shader/i.test(e) && !/404/.test(e));
check("WP10", "no page errors from the world engine", own.length === 0, own.slice(0, 5).join(" | "));
results.push({ id: "WP08", name: "physical iPhone / real GPU", status: "NOT RUN", evidence: "physical-device", detail: "No physical device or hardware GPU reachable from this container; frames are SwiftShader (software) and phones are Chromium emulation." });
await writeFile("docs/missions/wp21/verify-worlds.json", `${JSON.stringify({ at: new Date().toISOString(), results, measures, otherPageErrors: errors.slice(0, 20) }, null, 1)}\n`);
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.filter((r) => r.status === "VERIFIED").length}/${results.length} verified, ${failed} failed, ${results.filter((r) => r.status === "NOT RUN").length} not run`);
console.log(JSON.stringify(measures, null, 1).slice(0, 2500));
process.exit(failed ? 1 : 0);
