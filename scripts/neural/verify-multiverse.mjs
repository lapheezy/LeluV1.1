/**
 * Neural Map Multiverse — verified in the running app.
 *
 * Opens the Neural Map by deep link, switches V1 → V2 → V3, draws each
 * aspect in all twelve shared layouts (counting what was actually drawn),
 * saves a view, reloads and restores it, and takes desktop and iPhone
 * screenshots. Page errors are recorded, not ignored.
 *
 *   npm run dev &   then   node scripts/neural/verify-multiverse.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { launch, desktop, iphone, track } from "../evolution/harness.mjs";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = process.env.SHOTS ?? "docs/missions/neural-multiverse/shots";
const RESULTS = process.env.RESULTS ?? "docs/missions/neural-multiverse/verify-multiverse.json";
await mkdir(OUT, { recursive: true });

const results = [];
const errors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, status: ok ? "VERIFIED" : "FAILED", detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`);
};

async function enter(page) {
  await page.goto(`${BASE}?interface=neural-map`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    }
    if (await page.locator("[data-mv-aspects]").count()) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
}

const attrs = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-mv-aspect]");
    return el ? { aspect: el.dataset.mvAspect, layout: el.dataset.mvLayout, nodes: Number(el.dataset.mvNodes), edges: Number(el.dataset.mvEdges), drawn: el.querySelectorAll("[data-mv-node]").length } : null;
  });

/**
 * WP11 regression: every control of the map, and the stage, is the topmost
 * element under its own centre (nothing, her companion included, covers it).
 */
async function unobstructed(page, label) {
  await page.waitForTimeout(2500); // her body loads asynchronously; give it time to (wrongly) appear
  const report = await page.evaluate(() => {
    const root = document.querySelector("[data-neural-map-view]");
    const targets = [
      ...document.querySelectorAll("[data-neural-map-view] header button, [data-neural-map-view] select, [data-neural-map-view] input, .mv-stage, .nm-centre"),
    ].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.left < innerWidth && r.bottom > 0; });
    const blocked = [];
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, r.left + r.width / 2), y = Math.min(innerHeight - 1, r.top + Math.min(r.height / 2, 40));
      const top = document.elementFromPoint(x, y);
      if (!top || !root?.contains(top)) blocked.push(`${el.tagName.toLowerCase()}${el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""}${el.textContent?.trim().slice(0, 20) ? ` "${el.textContent.trim().slice(0, 20)}"` : ""} ← ${top?.closest("[data-testid]")?.getAttribute("data-testid") ?? top?.tagName}`);
    }
    return { checked: targets.length, blocked, presence: document.querySelector("[data-testid='lelu-companion']")?.getAttribute("data-presence") ?? "absent" };
  });
  check(`${label}: no control or stage of the map is covered (${report.checked} checked)`, report.checked > 3 && report.blocked.length === 0, report.blocked.join(" | "));
  check(`${label}: her companion has stepped away from the map`, report.presence === "away" || report.presence === "absent", report.presence);
}

const browser = await launch();
const LAYOUT_IDS = ["core-orbit", "galactic-spiral", "nested-universes", "force-directed", "dimensional-layers", "radial-constellation", "infinite-canvas", "temporal-river", "matrix-grid", "topographic-field", "chord-ring", "holographic-spatial"];
const SHOTS = { v1: ["core-orbit", "force-directed"], v2: ["nested-universes", "chord-ring", "holographic-spatial", "dimensional-layers"], v3: ["core-orbit", "radial-constellation"] };
try {
  const ctx = await desktop(browser);
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  check("Neural Map opens with the aspect selector", (await page.locator("[data-mv-aspects] [data-aspect]").count()) === 3);
  check("V1 opens on its canonical neighbourhood view", (await page.locator("[data-neural-graph]").count()) === 1);
  await unobstructed(page, "desktop V1");
  await page.screenshot({ path: `${OUT}/01-v1-neighbourhood.png` });

  let n = 1;
  for (const aspect of ["v1", "v2", "v3"]) {
    await page.click(`[data-aspect="${aspect}"]`);
    if (aspect === "v1") await page.click("[data-mv-mode]");
    await page.waitForTimeout(300);
    for (const id of LAYOUT_IDS) {
      await page.selectOption('select[aria-label="Shared layout"]', id);
      await page.waitForTimeout(120);
      const a = await attrs(page);
      check(`${aspect} · ${id} draws every node it derived`, !!a && a.layout === id && a.aspect === aspect && a.drawn === a.nodes && a.nodes > 0, JSON.stringify(a));
      if (SHOTS[aspect].includes(id)) {
        // Select the most connected node so the inspector and highlight show.
        // Dispatched, not a pointer click: dense layouts overlap nodes by design.
        await page.evaluate(() => {
          if (!document.querySelector('[data-mv-node][data-on="true"]')) document.querySelector("[data-mv-node]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        await page.waitForTimeout(150);
        n += 1;
        await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-${aspect}-${id}.png` });
      }
    }
  }

  // V2: subsystems are real; V3: the gaps it cannot show are stated.
  await page.click('[data-aspect="v2"]');
  await page.selectOption('select[aria-label="Shared layout"]', "nested-universes");
  await unobstructed(page, "desktop V2");
  check("V2 states where live activity comes from", /event bus/i.test((await page.locator("[data-mv-gaps]").textContent()) ?? ""));
  await page.click('[data-aspect="v3"]');
  check("V3 states that agent conversations are not recorded yet", /self-dialogue/i.test((await page.locator("[data-mv-gaps]").textContent()) ?? ""));

  // WP12: the ten V2 architecture views render in WebGL (measured from the GPU and the pixels).
  await page.click('[data-aspect="v2"]');
  const VIEWS3D = ["anatomical-core", "neural-sphere", "exploded-layers", "neural-universe", "connectome-tractography", "glass-brain", "multiscale", "circuit-board", "temporal-activation", "subsystem-constellation"];
  for (const v of VIEWS3D) {
    await page.selectOption('select[aria-label="Architecture render"]', v);
    await page.waitForFunction((id) => { const el = document.querySelector("[data-arch-view]"); return el?.dataset.archView === id && Number(el.dataset.glFrames ?? 0) > 10; }, v, { timeout: 30000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const el = document.querySelector("[data-arch-view]");
      const c = el?.querySelector("canvas");
      let colours = 0;
      if (c) {
        const probe = document.createElement("canvas");
        probe.width = 64; probe.height = 64;
        const ctx = probe.getContext("2d");
        ctx.drawImage(c, 0, 0, 64, 64);
        const d = ctx.getImageData(0, 0, 64, 64).data;
        const seen = new Set();
        for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
        colours = seen.size;
      }
      return { view: el?.dataset.archView, nodes: Number(el?.dataset.archNodes), edges: Number(el?.dataset.archEdges), bars: Number(el?.dataset.archBars), particles: Number(el?.dataset.archParticles), calls: Number(el?.dataset.glCalls), triangles: Number(el?.dataset.glTriangles), colours, live: el?.querySelector("[data-live-summary]")?.textContent };
    });
    check(`V2 3D · ${v} renders in WebGL`, r.view === v && r.nodes > 60 && r.calls > 10 && r.triangles > 1000 && r.colours > 20, JSON.stringify(r));
    if (["anatomical-core", "connectome-tractography", "exploded-layers", "multiscale", "circuit-board", "temporal-activation"].includes(v)) {
      n += 1;
      await page.screenshot({ path: `${OUT}/${String(n).padStart(2, "0")}-v2-3d-${v}.png` });
    }
  }
  const liveText = await page.locator("[data-live-summary]").textContent();
  check("V2 3D states live activity from the event bus as it is", /event bus this session/.test(liveText ?? ""), liveText);
  await page.selectOption('select[aria-label="Architecture render"]', "2d");

  // Saved view: save (on V3), reload, restore.
  await page.click('[data-aspect="v3"]');
  await page.selectOption('select[aria-label="Shared layout"]', "temporal-river");
  await page.fill('input[aria-label="Name this view"]', "Society over time");
  await page.click("[data-mv-save]");
  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page);
  await page.click('[data-aspect="v2"]');
  const saved = page.locator("[data-mv-view] button", { hasText: "Society over time" });
  check("a saved view survives a reload", (await saved.count()) === 1);
  if (await saved.count()) {
    await saved.first().click();
    await page.waitForTimeout(200);
    const a = await attrs(page);
    check("restoring it brings back its aspect and layout", a?.aspect === "v3" && a?.layout === "temporal-river", JSON.stringify(a));
  }
  await ctx.close();

  const phone = await iphone(browser);
  const p2 = await phone.newPage();
  track(p2, errors);
  await enter(p2);
  await p2.click('[data-aspect="v2"]');
  await p2.selectOption('select[aria-label="Shared layout"]', "radial-constellation");
  await p2.waitForTimeout(300);
  await unobstructed(p2, "iPhone V2");
  const a = await attrs(p2);
  check("iPhone: V2 radial constellation draws", !!a && a.drawn === a.nodes && a.nodes > 0, JSON.stringify(a));
  await p2.screenshot({ path: `${OUT}/${String(n + 1).padStart(2, "0")}-iphone-v2-radial.png` });
  // She comes back when the map closes: her normal placement is untouched elsewhere.
  await p2.click("[data-close-neural-map]");
  await p2.waitForTimeout(1500);
  const back = await p2.evaluate(() => document.querySelector("[data-testid='lelu-companion']")?.getAttribute("data-presence") ?? "absent");
  check("iPhone: after the map closes she is back in her normal place", back !== "away", back);
  await phone.close();
} finally {
  await browser.close();
}

const own = errors.filter((e) => /multiverse|Multiverse|mv-|Layouts|Aspects|SavedViews/.test(e));
check("no page errors from the multiverse", own.length === 0, own.join(" | "));
await writeFile(RESULTS, `${JSON.stringify({ at: new Date().toISOString(), results, otherPageErrors: errors.filter((e) => !own.includes(e)).slice(0, 20) }, null, 1)}\n`);
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
