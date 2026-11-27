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
  check("V2 states that live activity is not measured", /telemetry/i.test((await page.locator("[data-mv-gaps]").textContent()) ?? ""));
  await page.click('[data-aspect="v3"]');
  check("V3 states that agent conversations are not recorded yet", /self-dialogue/i.test((await page.locator("[data-mv-gaps]").textContent()) ?? ""));

  // Saved view: save, reload, restore.
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
  const a = await attrs(p2);
  check("iPhone: V2 radial constellation draws", !!a && a.drawn === a.nodes && a.nodes > 0, JSON.stringify(a));
  await p2.screenshot({ path: `${OUT}/${String(n + 1).padStart(2, "0")}-iphone-v2-radial.png` });
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
