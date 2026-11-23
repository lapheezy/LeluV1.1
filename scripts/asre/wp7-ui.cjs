// Mission 5 WP07 — the same end-to-end flow through the running application,
// photographed at each step. Complements wp7-e2e.mjs (which drives the API):
// this proves the Genesis Spatial Studio drives the same pipeline.
//
//   node scripts/asre/wp7-ui.cjs <outDir> <input.png>
//
// Needs vite dev on 127.0.0.1:5173 and the Blender toolchain for export.
const { chromium } = require("playwright");
const { openSpatial } = require("./m5-ui-nav.cjs");
const fs = require("fs");
const path = require("path");

const OUT = process.argv[2] || "artifacts/mission5/WP07/UI";
const INPUT = process.argv[3] || path.join(process.env.HOME, "chair.png");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  const notes = {};
  p.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION_REFUSED|503/.test(m.text()) && errors.push("console " + m.text().slice(0, 200)));
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 82 });
  const t0 = Date.now();

  await openSpatial(p);
  const max = p.locator("button[title*='xpand'], button[aria-label*='xpand']").first();
  if (await max.count()) await max.click().catch(() => {});

  // 1. image -> reconstruction, in the app
  await p.setInputFiles("[data-spatial-input=front]", INPUT);
  await p.selectOption("[data-spatial-engine]", "silhouette");
  await p.click("[data-spatial-action=reconstruct]");
  await p.waitForSelector("[data-spatial-step=forge][data-state=done]", { timeout: 180000 });
  await p.waitForSelector("[data-spatial-workspace=reconstruct] [data-spatial-viewer][data-loaded=true]", { timeout: 60000 });
  await p.waitForTimeout(1800);
  notes.steps = await p.locator("[data-spatial-step]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-spatial-step")}=${e.getAttribute("data-state")}`).join(" "));
  notes.hypotheses = await p.locator("[data-spatial-hypothesis]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-spatial-hypothesis")}${e.getAttribute("data-selected") === "true" ? "*" : ""}`).join(" "));
  notes.evidence = await p.locator("[data-spatial-evidence-text]").first().innerText().catch(() => null);
  await shot("01-reconstruct-app");

  // 2. numerical record
  await p.click("[data-spatial-tab=numerical]");
  await p.waitForSelector("[data-spatial-slice]", { timeout: 30000 });
  await p.waitForTimeout(900);
  await shot("02-numerical-front-cut");
  await p.selectOption("[data-spatial-axis]", "x");
  await p.waitForTimeout(900);
  await p.selectOption("[data-spatial-mode]", "boundary");
  await p.waitForTimeout(900);
  await shot("03-numerical-side-cut");

  // 3. persistent character: hair change with an impact preview before applying
  await p.click("[data-spatial-tab=create]");
  const create = p.locator("[data-spatial-action=create-character]");
  await p.waitForTimeout(1200);
  if (await create.count()) {
    await create.click();
    await p.waitForSelector("[data-spatial-workspace=creation]", { timeout: 120000 });
  }
  await p.waitForSelector("[data-spatial-workspace=creation] [data-spatial-viewer][data-loaded=true]", { timeout: 120000 });
  await p.waitForTimeout(1500);
  await shot("04-character-initial");
  const current = await p.locator("[data-spatial-hair]").inputValue();
  await p.selectOption("[data-spatial-hair]", current === "afro" ? "bob" : "afro");
  await p.click("[data-spatial-action=impact]");
  await p.waitForSelector("[data-spatial-impact]", { timeout: 60000 });
  notes.impact = (await p.locator("[data-spatial-impact]").innerText()).replace(/\n/g, " | ").slice(0, 400);
  await shot("05-character-impact");
  const before = await p.locator("[data-spatial-version]").count();
  await p.click("[data-spatial-action=apply]");
  await p.waitForFunction((n) => document.querySelectorAll("[data-spatial-version]").length > n, before, { timeout: 120000 });
  await p.waitForSelector("[data-spatial-workspace=creation] [data-spatial-viewer][data-loaded=true]", { timeout: 60000 });
  await p.waitForTimeout(1600);
  notes.head = await p.locator("[data-spatial-section=head] header").innerText().catch(() => null);
  await shot("06-character-new-version");

  await p.selectOption("[data-spatial-other]", "v0001");
  await p.click("[data-spatial-action=compare]");
  await p.waitForSelector("[data-spatial-comparison]", { timeout: 120000 });
  notes.compare = (await p.locator("[data-spatial-comparison]").innerText()).replace(/\n/g, " | ").slice(0, 400);
  await shot("07-character-compare-v1");

  // 4. render from the reconstruction and export through the Forge gate
  await p.click("[data-spatial-tab=reconstruct]");
  await p.click("[data-spatial-action=open-render]");
  await p.waitForSelector("[data-spatial-workspace=render] [data-spatial-viewer][data-loaded=true]", { timeout: 60000 });
  await p.click("[data-spatial-workspace=render] [data-spatial-action=camera-front]");
  await p.waitForTimeout(1200);
  await shot("08-render-front");
  const side = p.locator("[data-spatial-workspace=render] [data-spatial-action=camera-side]");
  if (await side.count()) {
    await side.click();
    await p.waitForTimeout(1200);
    await shot("09-render-side");
  }
  await p.click("[data-spatial-workspace=render] [data-spatial-action=camera-three-quarter]");
  await p.waitForTimeout(1200);
  await shot("10-render-three-quarter");
  await p.click("[data-spatial-action=forge-export]");
  await p.waitForSelector("[data-spatial-exported]", { timeout: 600000 });
  notes.exported = (await p.locator("[data-spatial-exported]").innerText()).replace(/\n/g, " | ").slice(0, 400);
  await p.waitForTimeout(800);
  await shot("11-render-exported");

  notes.errors = errors;
  notes.durationMs = Date.now() - t0;
  fs.writeFileSync(path.join(OUT, "ui-flow.json"), JSON.stringify(notes, null, 1));
  console.log(JSON.stringify({ steps: notes.steps, head: notes.head, exported: notes.exported, errors: errors.slice(0, 5), durationMs: notes.durationMs }, null, 1));
  await b.close();
  process.exit(errors.length ? 1 : 0);
})().catch(async (e) => {
  console.error("UI FLOW FAILED", e.message);
  process.exit(1);
});
