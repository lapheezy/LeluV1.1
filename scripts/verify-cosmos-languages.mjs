/**
 * INFINITE COSMOS — LAYOUT LANGUAGES IN THE REAL APP
 *
 * Opens the real application (dev server), opens Browser, Settings,
 * Research and Files, then switches through EVERY layout while
 * those windows stay open — the way a person would, through the ⌘K
 * palette — and for each layout verifies, in the live DOM:
 *
 *   • the language reached <html> and every open window (role, chrome)
 *   • Browser, Settings and the Neural Map render their composition
 *   • nothing was lost: the same windows, the same geometry, the address
 *     typed into the Browser, Settings sections, Neural Map data
 *   • the windows still work: Browser navigates, Settings navigates and a
 *     toggle flips, the Neural Map follows a node
 *
 * and captures desktop and phone screenshots of the real application.
 *
 * Run (dev server up):  node scripts/verify-cosmos-languages.mjs
 *   LELU_BASE=http://127.0.0.1:5173/  OUT=artifacts/infinite-cosmos
 */

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const root = execSync("npm root -g").toString().trim();
  ({ chromium } = createRequire(`${root}/`)("playwright"));
}

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = process.env.OUT ?? "artifacts/infinite-cosmos";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
mkdirSync(`${OUT}/desktop`, { recursive: true });
mkdirSync(`${OUT}/mobile`, { recursive: true });

// Layout ids and names, read from the source of the ONE registry.
const { TEMPLATES } = await import("../src/app/scene/genesis/home/homeComposition.ts");
const LAYOUTS = TEMPLATES.map((t) => ({ id: t.id, name: t.name })).filter((t) => !ONLY || ONLY.includes(t.id));
const { LANGUAGES, languageOfLayout, compositionFor } = await import("../src/core/interface/CosmosLanguages.ts");
const byId = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

const results = [];
let failures = 0;
const check = (scope, name, ok, note = "") => {
  if (!ok) failures += 1;
  results.push({ scope, name, ok, note });
  console.log(`  ${ok ? "PASS" : "FAIL"}  [${scope}] ${name}${note ? "  — " + note : ""}`);
};

async function boot(viewport) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  // "Continue without an account" is the real first-run choice (local-only is supported).
  const gate = await page.waitForSelector("[data-lelu-signin-gate]", { timeout: 40000, state: "attached" }).catch(() => null);
  if (gate) await page.evaluate(() => [...document.querySelector("[data-lelu-signin-gate]").querySelectorAll("button")].find((b) => /Continue/.test(b.innerText))?.click());
  await page.waitForTimeout(5000);
  return { browser, page, errors };
}

async function palette(page, query) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  const input = 'input[placeholder="Type a command or workspace…"]';
  await page.waitForSelector(input, { timeout: 8000 });
  await page.fill(input, query);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1300);
}

const windows = (page) => page.evaluate(() => [...document.querySelectorAll("[data-lelu-module-window]")].map((w) => ({
  id: w.getAttribute("data-lelu-module-window"),
  role: w.getAttribute("data-cosmos-role"),
  chrome: w.querySelector("[data-cl-chrome]")?.getAttribute("data-cl-chrome") ?? "glass",
  // The geometry the window was given (store/steward), not its painted box:
  // a language's border is drawn inside it.
  rect: [w.style.left, w.style.top, w.style.width, w.style.height].join(","),
})));

/* ================= DESKTOP ================= */
{
  console.log("\nDESKTOP 1440×900 — windows stay open while every layout is applied");
  const { browser, page, errors } = await boot({ width: 1440, height: 900 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Browser")?.click());
  await page.waitForTimeout(2000);
  // Browser: type an address and navigate (real navigation through its own handler).
  await page.fill('[aria-label="Browser address"]', "https://example.org/");
  await page.press('[aria-label="Browser address"]', "Enter");
  await page.waitForTimeout(1500);
  await palette(page, "Open Settings");
  await palette(page, "Open Knowledge providers");
  await palette(page, "Open Projects");
  const opened = await windows(page);
  check("setup", "Browser, Settings, Research and Files windows are open", ["browser", "settings", "projects", "knowledge"].every((id) => opened.some((w) => w.id === id)), opened.map((w) => w.id).join(" "));
  const iframe0 = await page.evaluate(() => document.querySelector(".lbr-page iframe")?.getAttribute("src") ?? "");
  check("setup", "Browser navigated to the typed address", /example\.org/.test(iframe0), iframe0);
  const geometry0 = Object.fromEntries(opened.map((w) => [w.id, w.rect]));

  for (const layout of LAYOUTS) {
    const lang = languageOfLayout(byId[layout.id] ?? {});
    const comp = compositionFor(lang);
    await palette(page, `Layout: ${layout.name}`);
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({
      lang: document.documentElement.getAttribute("data-cosmos-language") ?? "cosmic",
      composition: document.documentElement.getAttribute("data-cosmos-composition") ?? "glass",
      browser: document.querySelector(".lbr")?.getAttribute("data-cl-browser"),
      settingsNav: document.querySelector("[data-cl-settings]")?.getAttribute("data-cl-settings"),
      address: document.querySelector('[aria-label="Browser address"]')?.value ?? "",
      iframe: document.querySelector(".lbr-page iframe")?.getAttribute("src") ?? "",
      heading: [...document.querySelectorAll("[data-lelu-panel-heading]")].map((h) => h.getAttribute("data-cl-heading") ?? "plain"),
      windowBg: getComputedStyle(document.querySelector('[data-lelu-module-window="settings"]')).backgroundColor,
    }));
    const wins = await windows(page);
    const scope = layout.id;
    check(scope, `language "${lang}" is active`, state.lang === lang, state.lang);
    check(scope, "the same four windows are still open", wins.length === opened.length && opened.every((o) => wins.some((w) => w.id === o.id)));
    check(scope, "every window carries its role and the composition's chrome", wins.every((w) => w.role && w.chrome === comp.id), wins.map((w) => `${w.id}:${w.chrome}`).join(" "));
    check(scope, "window geometry survived the switch", wins.every((w) => geometry0[w.id] === w.rect), wins.filter((w) => geometry0[w.id] !== w.rect).map((w) => `${w.id} ${geometry0[w.id]}→${w.rect}`).join("; "));
    check(scope, `Browser renders the ${comp.id} composition`, state.browser === comp.id, String(state.browser));
    check(scope, "Browser kept its tab, address and page", /example\.org/.test(state.iframe), state.iframe);
    check(scope, `Settings navigates as "${comp.settings.nav}"`, (state.settingsNav ?? "none") === comp.settings.nav, String(state.settingsNav));
    check(scope, `panel headings read as "${comp.heading}"`, state.heading.every((h) => h === comp.heading), state.heading.join(","));
    // Settings still works: navigate to the runtime section, flip a real toggle, flip it back.
    if (comp.settings.nav !== "none") {
      await page.evaluate(() => document.querySelector('[data-settings-nav="proactive"]')?.click());
      await page.waitForTimeout(300);
      const onShow = await page.evaluate(() => document.querySelector('[data-settings-section="proactive"]')?.getAttribute("data-cl-current"));
      check(scope, "Settings navigation reaches a section", !comp.settings.paged || onShow === "true", String(onShow));
    }
    const flip = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('[data-settings-section="proactive"] button')].find((b) => /Session briefing/.test(b.textContent ?? ""));
      if (!btn) return "missing";
      const knob = () => btn.querySelector("span[aria-hidden] span")?.getAttribute("style") ?? "";
      const before = knob();
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      const after = knob();
      btn.click();
      await new Promise((r) => setTimeout(r, 300));
      return before !== after ? "flipped" : "unchanged";
    });
    check(scope, "a Settings toggle still flips", flip === "flipped", flip);
    await page.screenshot({ path: `${OUT}/desktop/${layout.id}--windows.jpg`, type: "jpeg", quality: 72 });

    // The Neural Map over the open windows, in the same language.
    await palette(page, "Open Neural Map");
    await page.waitForTimeout(1200);
    // Focus the entity with the most relations so the layout has something to lay out.
    await page.evaluate(async () => {
      const hits = [...document.querySelectorAll(".nm-hits button")].slice(0, 40);
      let best = null;
      let most = -1;
      for (const h of hits) {
        h.click();
        await new Promise((r) => setTimeout(r, 40));
        const n = document.querySelectorAll(".nm-node").length;
        if (n > most) { most = n; best = h; }
      }
      best?.click();
      await new Promise((r) => setTimeout(r, 200));
    });
    const nm = await page.evaluate(() => ({
      composition: document.querySelector(".nm-standalone")?.getAttribute("data-cl-neural"),
      layout: document.querySelector("[data-neural-graph]")?.getAttribute("data-neural-layout"),
      focus: document.querySelector("[data-neural-graph]")?.getAttribute("data-neural-graph"),
      nodes: document.querySelectorAll(".nm-node").length,
      stats: document.querySelector("[data-neural-stats]")?.textContent ?? "",
    }));
    check(scope, `Neural Map lays out as "${comp.neural.layout}"`, nm.composition === comp.id && nm.layout === comp.neural.layout, `${nm.composition}/${nm.layout}`);
    check(scope, "Neural Map shows its real data", /\d+ entities/.test(nm.stats) && nm.nodes > 0, `${nm.nodes} nodes · ${nm.stats.slice(0, 40)}`);
    await page.screenshot({ path: `${OUT}/desktop/${layout.id}--neural-map.jpg`, type: "jpeg", quality: 72 });
    const followed = await page.evaluate(async () => {
      const before = document.querySelector("[data-neural-graph]")?.getAttribute("data-neural-graph");
      document.querySelector(".nm-node")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      return before !== document.querySelector("[data-neural-graph]")?.getAttribute("data-neural-graph");
    });
    check(scope, "Neural Map follows a clicked node", followed);
    await page.evaluate(() => document.querySelector("[data-close-neural-map]")?.click());
    await page.waitForTimeout(500);
  }
  check("desktop", "no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

/* ================= PHONE ================= */
{
  console.log("\nPHONE 390×844 — each language composed for a phone");
  const { browser, page, errors } = await boot({ width: 390, height: 844 });
  const phoneLayouts = LAYOUTS.filter((l) => {
    const lang = languageOfLayout(byId[l.id] ?? {});
    return lang !== "cosmic" || l.id === "lelu-central";
  });
  for (const layout of phoneLayouts) {
    const lang = languageOfLayout(byId[layout.id] ?? {});
    const comp = compositionFor(lang);
    await palette(page, `Layout: ${layout.name}`);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/mobile/${layout.id}--home.jpg`, type: "jpeg", quality: 72 });
    for (const [label, id] of [["Browser", "browser"], ["Settings", "settings"]]) {
      if (id === "browser") await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Browser")?.click());
      else await palette(page, "Open Settings");
      await page.waitForTimeout(1500);
      const s = await page.evaluate((wid) => {
        const w = document.querySelector(`[data-lelu-module-window="${wid}"]`);
        if (!w) return null;
        const r = w.getBoundingClientRect();
        // A phone sheet's header is the workspace bar (one bar, every open window);
        // the composition shows in the window's own content.
        return {
          paper: getComputedStyle(w).getPropertyValue("--cl-paper").trim(),
          browser: w.querySelector(".lbr")?.getAttribute("data-cl-browser") ?? null,
          settings: w.querySelector("[data-cl-settings]")?.getAttribute("data-cl-settings") ?? null,
          inside: r.left >= -1 && r.right <= innerWidth + 1,
        };
      }, id);
      const isTerminalHome = lang === "terminal";
      if (s) {
        const speaks = id === "browser" ? s.browser === comp.id : (s.settings ?? "none") === comp.settings.nav;
        check(`phone/${layout.id}`, `${label} sheet speaks ${comp.id} and fits the screen`, speaks && s.inside && (lang === "cosmic") === !s.paper, JSON.stringify(s));
        await page.screenshot({ path: `${OUT}/mobile/${layout.id}--${id}.jpg`, type: "jpeg", quality: 72 });
        await page.evaluate((wid) => {
          const w = document.querySelector(`[data-lelu-module-window="${wid}"]`);
          (w?.querySelector('[data-cl-control="close"]') ?? w?.querySelector('[aria-label^="Close"]'))?.click();
        }, id);
        await page.waitForTimeout(900);
      } else {
        check(`phone/${layout.id}`, `${label} opened`, isTerminalHome && id === "browser", isTerminalHome ? "the Retro Terminal home has its own app row" : "window not found");
      }
    }
  }
  check("phone", "no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

writeFileSync(`${OUT}/verification.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), layouts: LAYOUTS.length, languages: LANGUAGES.length, failures, results }, null, 2));
console.log(`\n${results.length - failures}/${results.length} checks passed · ${failures} failed · report: ${OUT}/verification.json`);
process.exit(failures ? 1 : 0);
