// Mission 5 WP03: drive the Spatial Studio in the real app (vite dev on :5173).
// node scripts/asre/m5-ui-flow.cjs <screenshot dir>   (needs the setup.sh toolchain for Blender export)
const { chromium } = require("playwright");
const { openSpatial } = require("./m5-ui-nav.cjs");
const OUT = process.argv[2] || ".";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
  p.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION_REFUSED|503/.test(m.text()) && errors.push("console " + m.text().slice(0, 200)));
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 82 });
  const t0 = Date.now();
  await openSpatial(p);
  // maximise the studio window so the workspaces have room
  const max = p.locator("button[title*='xpand'], button[aria-label*='xpand']").first();
  if (await max.count()) await max.click().catch(() => {});
  // 1. reconstruct a real image (TripoSR example, transparent background) with the TS engine
  await p.setInputFiles("[data-spatial-input=front]", "/opt/lelu-tools/TripoSR/examples/chair.png");
  await p.selectOption("[data-spatial-engine]", "silhouette");
  await p.click("[data-spatial-action=reconstruct]");
  await p.waitForSelector("[data-spatial-step=forge][data-state=done]", { timeout: 60000 });
  await p.waitForSelector("[data-spatial-workspace=reconstruct] [data-spatial-viewer][data-loaded=true]", { timeout: 30000 });
  await p.waitForTimeout(1500);
  console.log("steps:", await p.locator("[data-spatial-step]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-spatial-step")}=${e.getAttribute("data-state")}`).join(" ")));
  console.log("hypotheses:", await p.locator("[data-spatial-hypothesis]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-spatial-hypothesis")}${e.getAttribute("data-selected") === "true" ? "*" : ""}`).join(" ")));
  await shot("01-reconstruct");
  // 2. numerical record: a front cut and a side cut by evidence class
  await p.click("[data-spatial-tab=numerical]");
  await p.waitForSelector("[data-spatial-slice]", { timeout: 20000 });
  await p.waitForTimeout(800);
  await shot("02-numerical-front-cut");
  await p.selectOption("[data-spatial-axis]", "x");
  await p.waitForTimeout(800);
  await p.selectOption("[data-spatial-mode]", "boundary");
  await p.waitForTimeout(800);
  await shot("03-numerical-side-cut-boundary");
  // 3. creation: create the persistent character, change only the hairstyle
  await p.click("[data-spatial-tab=create]");
  const create = p.locator("[data-spatial-action=create-character]");
  await p.waitForTimeout(1500);
  if (await create.count()) {
    await create.click();
    await p.waitForSelector("[data-spatial-workspace=creation]", { timeout: 60000 });
  }
  await p.waitForSelector("[data-spatial-workspace=creation] [data-spatial-viewer][data-loaded=true]", { timeout: 60000 });
  const current = await p.locator("[data-spatial-hair]").inputValue();
  await p.selectOption("[data-spatial-hair]", current === "bob" ? "afro" : "bob");
  await p.click("[data-spatial-action=impact]");
  await p.waitForSelector("[data-spatial-impact]", { timeout: 20000 });
  console.log("impact:", (await p.locator("[data-spatial-impact]").innerText()).replace(/\n/g, " | "));
  await shot("04-create-impact-preview");
  const before = await p.locator("[data-spatial-version]").count();
  await p.click("[data-spatial-action=apply]");
  await p.waitForFunction((n) => document.querySelectorAll("[data-spatial-version]").length > n, before, { timeout: 60000 });
  await p.waitForSelector("[data-spatial-workspace=creation] [data-spatial-viewer][data-loaded=true]", { timeout: 30000 });
  await p.waitForTimeout(1500);
  console.log("head:", await p.locator("[data-spatial-section=head] header").innerText());
  await shot("05-create-new-version");
  // compare with v0001
  await p.selectOption("[data-spatial-other]", "v0001");
  await p.click("[data-spatial-action=compare]");
  await p.waitForSelector("[data-spatial-comparison]", { timeout: 60000 });
  console.log("compare:", (await p.locator("[data-spatial-comparison]").innerText()).replace(/\n/g, " | ").slice(0, 400));
  await shot("06-create-compare");
  // 4. render: the reconstruction, from the reconstruct tab's button
  await p.click("[data-spatial-tab=reconstruct]");
  await p.click("[data-spatial-action=open-render]");
  await p.waitForSelector("[data-spatial-workspace=render] [data-spatial-viewer][data-loaded=true]", { timeout: 30000 });
  await p.click("[data-spatial-workspace=render] [data-spatial-action=camera-front]");
  await p.waitForTimeout(1200);
  await shot("07-render-front");
  await p.click("[data-spatial-workspace=render] [data-spatial-action=camera-three-quarter]");
  await p.click("[data-spatial-action=forge-export]");
  await p.waitForSelector("[data-spatial-exported]", { timeout: 300000 });
  console.log("exported:", (await p.locator("[data-spatial-exported]").innerText()).replace(/\n/g, " | "));
  await p.waitForTimeout(800);
  await shot("08-render-export");
  console.log("total", Date.now() - t0, "ms");
  console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
  await b.close();
})().catch((e) => { console.error("FLOW FAILED", e.message); process.exit(1); });
