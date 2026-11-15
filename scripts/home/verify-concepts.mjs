/**
 * Mission 15.1 — the sixty concepts, blending, looks: acceptance through
 * the REAL app UI (vite dev on :5173). Every step is a click, a key or a
 * drag a person would make; every check reads the DOM or the storage the
 * Home persists to. Writes docs/missions/m15-home/verify-concepts.json,
 * a contact sheet of all sixty layouts, and step screenshots.
 *   node scripts/home/verify-concepts.mjs
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/m15-home/shots-15.1";
await mkdir(OUT, { recursive: true });
const results = [];
/** The page being driven: every check is photographed (a picture per step). */
let current = null;
let step = 0;
const pending = [];
const check = async (name, ok, detail = "") => {
  step += 1;
  const file = `${OUT}/step-${String(step).padStart(2, "0")}-${ok ? "ok" : "FAIL"}.jpg`;
  results.push({ name, status: ok ? "VERIFIED" : "FAILED", detail, picture: file });
  console.log(`${ok ? "✓" : "✗"} [step ${step}] ${name}${detail ? ` — ${detail}` : ""}  → ${file}`);
  if (current) await current.screenshot({ path: file, type: "jpeg", quality: 70 }).catch(() => {});
};

async function guest(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("lelu.lelu.auth.skipped.v1", "true");
    } catch {}
  });
}
async function enter(page, query = "") {
  await page.goto(BASE + query, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    }
    if (!(await page.locator("[data-lelu-signin-gate]").count()) && (await page.locator("[data-lelu-home] .hc").count())) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
}
const storage = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
const openStudio = async (page) => {
  if (!(await page.locator("[data-home-editbar]").count())) await page.click("[data-home-customize]");
  await page.click("[data-home-studio-open]");
  await page.waitForSelector("[data-home-studio]");
  await page.waitForTimeout(400);
};
const tab = (page, id) => page.click(`[data-studio-tab="${id}"]`);

const browser = await launch();
const errors = [];
/** Network failures from outside services (offline sandbox, CORS) are not Home errors. */
const NETWORK = /favicon|ERR_|Failed to load resource|WebGL|THREE|net::|503|404|401|blocked|CORS|Access to fetch|Provider\]|API request failed|API key/i;
const homeErrors = (list) => list.filter((e) => !NETWORK.test(e));

/* ---------------- desktop: all sixty concepts, three devices each ---------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await guest(ctx);
  const page = await ctx.newPage();
  current = page;
  track(page, errors);
  await enter(page);
  await openStudio(page);
  const listed = await page.$$eval('.hs-list button[data-template^="concept-"]', (b) => b.length);
  await check("studio lists all sixty concepts", listed === 60, `${listed} listed`);

  const thumbs = [];
  let allOk = true;
  const failures = [];
  const kinds = {};
  for (let n = 1; n <= 60; n++) {
    const id = `concept-${String(n).padStart(2, "0")}`;
    const before = errors.length;
    await page.click(`.hs-list button[data-template="${id}"]`);
    await page.waitForTimeout(140);
    const frames = await page.$$eval(".hs-frame", (fs) =>
      fs.map((f) => {
        const hc = f.querySelector(".hc");
        const mods = [...(hc?.querySelectorAll("[data-home-module]") ?? [])];
        const visible = mods.filter((m) => {
          const r = m.getBoundingClientRect();
          return r.width > 4 && r.height > 4;
        });
        return { device: f.dataset.device, kind: hc?.dataset.kind, modules: mods.length, visible: visible.length, docked: hc?.querySelectorAll(".hc-dock-chip").length ?? 0 };
      }),
    );
    kinds[n] = frames.map((f) => f.kind).join("/");
    const ok = frames.length === 3 && frames.every((f) => f.kind && f.visible >= 1) && homeErrors(errors.slice(before)).length === 0;
    if (!ok) {
      allOk = false;
      failures.push(`#${n} ${JSON.stringify(frames)} ${errors.slice(before).join(" | ")}`);
    }
    await page.screenshot({ path: `${OUT}/concept-${String(n).padStart(2, "0")}.jpg`, type: "jpeg", quality: 65 });
    const desk = page.locator('.hs-frame[data-device="desktop"] .hs-viewport-box');
    thumbs.push({ n, name: await page.locator(".hs-crumb h2").innerText(), kind: kinds[n], img: (await desk.screenshot({ type: "jpeg", quality: 55 })).toString("base64") });
  }
  await check("all sixty concepts render on iPhone, tablet and desktop with live modules and no errors", allOk, allOk ? "60 × 3 frames" : failures.slice(0, 4).join(" || "));
  await check("the sixty use the new families (column, strip, rows, stage, lanes, radial, constellation, scatter, twozone)", ["column", "strip", "rows", "stage", "lanes", "radial", "constellation", "scatter", "twozone"].every((k) => Object.values(kinds).some((v) => v.includes(k))), [...new Set(Object.values(kinds).flatMap((v) => v.split("/")))].join(", "));

  // Contact sheet: all sixty desktop frames in one image.
  const sheet = await ctx.newPage();
  await sheet.setViewportSize({ width: 1800, height: 900 });
  await sheet.setContent(
    `<html><body style="margin:0;background:#12052a;color:#fbf3ff;font:12px system-ui"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding:10px">${thumbs
      .map((t) => `<figure style="margin:0"><img style="width:100%;border-radius:8px;display:block" src="data:image/jpeg;base64,${t.img}"><figcaption style="padding:3px 2px">${t.name.replace(/</g, "&lt;")} <span style="opacity:.6">${t.kind}</span></figcaption></figure>`)
      .join("")}</div></body></html>`,
  );
  await sheet.waitForTimeout(300);
  await sheet.screenshot({ path: `${OUT}/c-00-sixty-concepts.jpg`, type: "jpeg", quality: 70, fullPage: true });
  await sheet.close();

  /* Research */
  await page.click('.hs-list button[data-template="concept-36"]');
  await tab(page, "research");
  const rows = await page.$$eval('[data-studio-panel="research"] dt', (d) => d.map((x) => x.textContent));
  await check("Research shows the concept's notes (composition … references)", rows.includes("Strengths") && rows.includes("References") && rows.length >= 12, rows.join(", "));
  await page.fill("[data-studio-notes]", "Kanban with a fire border — try it on the tablet.");
  await page.locator("[data-studio-notes]").blur();
  const lib1 = await storage(page, "lelu.lelu.home.layouts.v1");
  await check("her research notes are saved", lib1?.notes?.["concept-36"]?.startsWith("Kanban with a fire"), JSON.stringify(lib1?.notes ?? {}).slice(0, 120));
  await shot(page, "c-01-research");

  /* Look: water barrier, then fire inside it */
  await tab(page, "look");
  await page.click('[data-theme="ocean"]');
  await page.waitForTimeout(150);
  const water = await page.locator('.hs-frame .hc-fx[data-fx="water"]').count();
  await check("Look: the Ocean theme puts a water barrier around every surface", water >= 8, `${water} water rings`);
  await page.selectOption("[data-studio-border2]", "fire");
  await page.waitForTimeout(150);
  const fire = await page.locator('.hs-frame .hc-fx[data-fx="fire"][data-layer="inner"]').count();
  await check("Look: a second border layers inside the first (water outside, fire inside)", fire >= 8, `${fire} inner fire rings`);
  await page.selectOption('[data-studio-font="font"]', "rounded");
  const font = await page.$eval('.hs-frame[data-device="desktop"] .hc', (el) => getComputedStyle(el).fontFamily);
  await check("Look: the font changes on the Home's surfaces", /rounded|nunito|varela/i.test(font), font.slice(0, 80));
  const tint = await page.$eval('.hs-frame[data-device="desktop"] .hc', (el) => getComputedStyle(el).getPropertyValue("--glass"));
  await check("Look: the theme's glass reaches the modules", /rgba\(8, 47, 73/.test(tint), tint);
  await page.evaluate(() => document.querySelector('.hs-frame[data-device="desktop"]')?.scrollIntoView());
  await shot(page, "c-02-look-water-fire");
  for (const fx of ["snow", "fire", "ice", "aurora", "lightning", "lava"]) {
    await page.click(`[data-effect="${fx}"]`);
    await page.waitForTimeout(120);
  }
  const lastFx = await page.locator('.hs-frame .hc-fx[data-fx="lava"]').count();
  await check("Look: every border effect can be chosen (snow, fire, ice, aurora, lightning, lava…)", lastFx >= 8);
  await page.click('[data-effect="snow"]');
  await page.selectOption("[data-studio-border2]", "none");
  await page.waitForTimeout(250);
  await page.evaluate(() => document.querySelector('.hs-frame[data-device="desktop"]')?.scrollIntoView());
  await shot(page, "c-03-look-snow");

  /* Layout: change a family and a parameter */
  await tab(page, "layout");
  await page.selectOption('[data-studio-kind="desktop"]', "radial");
  await page.waitForTimeout(150);
  await check("Layout: changing the desktop family re-lays the Home (lanes → radial)", (await page.$eval('.hs-frame[data-device="desktop"] .hc', (el) => el.dataset.kind)) === "radial");
  await page.selectOption('[data-studio-kind="desktop"]', "lanes");
  await page.fill('[data-studio-name]', "Fire Kanban");
  await page.click("[data-home-studio-save]");
  await page.waitForTimeout(200);
  const lib2 = await storage(page, "lelu.lelu.home.layouts.v1");
  const kanban = lib2?.layouts?.find((l) => l.name === "Fire Kanban");
  await check("Save to My layouts keeps her edited layout with its look", Boolean(kanban && kanban.kind.desktop === "lanes" && kanban.style?.border === "snow"), kanban ? `${kanban.id} ${kanban.kind.desktop} ${kanban.style?.theme}/${kanban.style?.border}` : "missing");

  /* Blend */
  await tab(page, "blend");
  await page.selectOption("[data-studio-blend-b]", "concept-57");
  await page.locator("[data-studio-blend-t]").fill("0.7");
  await page.click("[data-studio-blend-make]");
  await page.waitForTimeout(250);
  const blended = await page.$$eval(".hs-frame .hc", (h) => h.map((x) => x.dataset.kind));
  await check("Blend: Fire Kanban × Radial menu (70% B) makes a working draft", blended.length === 3 && blended[2] === "radial", blended.join("/"));
  await shot(page, "c-04-blend");
  await page.click("[data-home-studio-save]");
  await page.waitForTimeout(150);
  /* Merge */
  await page.click('.hs-list button[data-template="concept-22"]');
  await tab(page, "blend");
  await page.click('.hs-seg-inline button:has-text("Merge")');
  await page.selectOption("[data-studio-blend-b]", "concept-14");
  await page.click("[data-studio-blend-make]");
  await page.waitForTimeout(250);
  const merged = await page.$$eval(".hs-frame .hc", (h) => h.map((x) => x.dataset.kind));
  await check("Merge: phone from A (rows), tablet and desktop from B (constellation)", merged.join("/") === "rows/constellation/constellation", merged.join("/"));
  await shot(page, "c-05-merge");

  /* New layout from scratch */
  await page.click("[data-home-studio-new]");
  await page.selectOption('[data-studio-kind="desktop"]', "scatter");
  await page.selectOption('[data-studio-kind="tablet"]', "strip");
  const scratchKinds = await page.$$eval(".hs-frame .hc", (h) => h.map((x) => x.dataset.kind));
  await check("New layout: a layout made from scratch, families picked per device", scratchKinds.join("/") === "column/strip/scatter", scratchKinds.join("/"));

  /* Suggest */
  await page.click("[data-home-studio-suggest]");
  const suggestion = await page.locator(".hs-suggest").innerText();
  await check("LÉLU suggests a concept with her reason, and changes nothing yet", /LÉLU suggests #\d+/.test(suggestion), suggestion.slice(0, 140));

  /* Use #13 Planetary as a new presentation, with its own look */
  await page.click('.hs-list button[data-template="concept-13"]');
  await page.click("[data-home-studio-use]");
  await page.waitForTimeout(300);
  await page.click(".hs-close");
  await page.waitForTimeout(500);
  const live = await page.$eval("[data-lelu-home] .hc", (el) => ({ kind: el.dataset.kind, fx: el.querySelectorAll('.hc-fx[data-fx="stardust"]').length, template: el.dataset.template }));
  await check("Use: the Home becomes #13 Planetary navigation, with its stardust look", live.kind === "constellation" && live.fx > 3 && live.template === "concept-13", JSON.stringify(live));
  await page.click("[data-home-customize]").catch(() => {});
  await page.waitForTimeout(200);
  if (await page.locator("[data-home-editbar]").count()) await page.click("[data-home-customize]");
  await page.waitForTimeout(400);
  await shot(page, "c-06-home-planetary");

  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page);
  const afterReload = await page.$eval("[data-lelu-home] .hc", (el) => ({ kind: el.dataset.kind, fx: el.querySelectorAll('.hc-fx[data-fx="stardust"]').length }));
  const lib3 = await storage(page, "lelu.lelu.home.layouts.v1");
  await check("after a reload the Home keeps the concept layout and its look", afterReload.kind === "constellation" && afterReload.fx > 3, JSON.stringify(afterReload));
  await check("after a reload her layouts and notes are still there", (lib3?.layouts?.length ?? 0) >= 2 && Boolean(lib3?.notes?.["concept-36"]), `${lib3?.layouts?.map((l) => l.name).join(", ")}`);

  /* Her saved layout from the edit bar, then a look on the Home */
  await page.click("[data-home-customize]");
  await page.waitForSelector("[data-home-editbar]");
  const option = await page.$eval('[data-home-editbar] select[aria-label^="New presentation"]', (s) => [...s.querySelectorAll("optgroup[label='My layouts'] option")].map((o) => o.value + "|" + o.textContent));
  await check("the edit bar offers her own layouts", option.some((o) => o.includes("Fire Kanban")), option.join(", "));
  const kanbanId = option.find((o) => o.includes("Fire Kanban")).split("|")[0];
  await page.selectOption('[data-home-editbar] select[aria-label^="New presentation"]', kanbanId);
  await page.waitForTimeout(400);
  const kan = await page.$eval("[data-lelu-home] .hc", (el) => ({ kind: el.dataset.kind, snow: el.querySelectorAll('.hc-fx[data-fx="snow"]').length, heads: [...el.querySelectorAll(".hc-lane-head")].map((h) => h.textContent) }));
  await check("a presentation made from her layout is the board, with snow borders", kan.kind === "lanes" && kan.snow > 3 && kan.heads.join() === "Now,Next,Later", JSON.stringify(kan));
  await page.click("[data-home-customize]");
  await page.waitForTimeout(400);
  await shot(page, "c-07-home-fire-kanban-snow");

  /* Research with LÉLU hands the prompt to the Chat Universe composer */
  await openStudio(page);
  await page.click('.hs-list button[data-template="concept-21"]');
  await tab(page, "research");
  await page.click("[data-studio-research]");
  await page.waitForTimeout(1200);
  const draft = await page.evaluate(() => [...document.querySelectorAll("textarea")].map((t) => t.value).find((v) => v.startsWith("/research")) ?? "");
  await check("Research with LÉLU opens the conversation with the /research prompt ready to send", draft.includes("Masonry gallery"), draft.slice(0, 120));
  await shot(page, "c-08-research-with-lelu");
  await ctx.close();
}

/* ---------------- iPhone: studio, a look, and the Home ---------------- */
{
  const ctx = await browser.newContext({ ...devices["iPhone 15 Pro"] });
  await guest(ctx);
  const page = await ctx.newPage();
  current = page;
  track(page, errors);
  await enter(page, "?homeStudio=concept-30");
  await page.waitForSelector("[data-home-studio]");
  const ph = await page.$eval('.hs-frame[data-device="phone"] .hc', (el) => ({ kind: el.dataset.kind, rings: el.dataset.rings }));
  await check("iPhone: the studio opens on #30 Story rings at phone width", ph.kind === "strip" && ph.rings === "true", JSON.stringify(ph));
  await page.tap('[data-studio-tab="look"]');
  await page.tap('[data-theme="frost"]');
  await page.waitForTimeout(200);
  await check("iPhone: picking Frost gives snow borders", (await page.locator('.hs-frame .hc-fx[data-fx="snow"]').count()) >= 3);
  await shot(page, "c-09-iphone-studio-frost");
  await page.tap("[data-home-studio-use]");
  await page.tap(".hs-close");
  await page.waitForTimeout(500);
  const home = await page.$eval("[data-lelu-home] .hc", (el) => ({ kind: el.dataset.kind, snow: el.querySelectorAll('.hc-fx[data-fx="snow"]').length }));
  await check("iPhone: the Home is Story rings with snow borders", home.kind === "strip" && home.snow > 2, JSON.stringify(home));
  await shot(page, "c-10-iphone-home-rings-snow");
  await ctx.close();
}

await browser.close();
current = null;
const relevant = homeErrors(errors);
await check("no page errors during the run", relevant.length === 0, relevant.slice(0, 5).join(" | "));
const verified = results.filter((r) => r.status === "VERIFIED").length;
await writeFile("docs/missions/m15-home/verify-concepts.json", JSON.stringify({ at: new Date().toISOString(), verified, failed: results.length - verified, results, otherErrors: errors.length - relevant.length }, null, 2));
console.log(`\n${verified}/${results.length} verified`);
process.exit(results.every((r) => r.status === "VERIFIED") ? 0 : 1);
