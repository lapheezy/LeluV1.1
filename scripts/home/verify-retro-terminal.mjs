/**
 * Retro Terminal + Terminal Appearance Studio — acceptance through the REAL app UI.
 * Every step is a person's action (click, type, select, reload); every check reads
 * the DOM, the CSS variables the terminal paints with, or what the Home persisted.
 *   node scripts/home/verify-retro-terminal.mjs   (vite dev on :5173)
 */
import { launch, track } from "../evolution/harness.mjs";
import { devices } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
const OUT = "docs/missions/retro-terminal/shots";
await mkdir(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, status: ok ? "VERIFIED" : "FAILED", detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function guest(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("lelu.lelu.auth.skipped.v1", "true");
    } catch {}
  });
}
async function enter(page, selector = "[data-lelu-home]") {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
        (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click();
      });
    }
    if (!(await page.locator("[data-lelu-signin-gate]").count()) && (await page.locator(selector).count())) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const rtVar = (page, name) => page.$eval("[data-retro-terminal]", (el, n) => el.style.getPropertyValue(n).trim(), name);
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(`lelu.${k}`) || "null"), key);
const overflow = (page) =>
  page.evaluate(() => {
    const doc = document.scrollingElement;
    const rt = document.querySelector("[data-retro-terminal]");
    const wide = [...document.querySelectorAll("[data-retro-terminal] *, [data-terminal-studio] *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "fixed" && !el.closest(".rt-panes, .rts-tabs, .rt-log, .rts-body");
    });
    return { page: doc.scrollWidth - window.innerWidth, terminal: rt ? rt.scrollWidth - rt.clientWidth : 0, offenders: wide.slice(0, 5).map((e) => e.className || e.tagName) };
  });
const markCanvas = (page) => page.evaluate(() => document.querySelectorAll("canvas").forEach((c) => (c.__rtMark = true)));
const canvasKept = (page) => page.evaluate(() => [...document.querySelectorAll("canvas")].some((c) => c.__rtMark === true));
const universe = (page) =>
  page.evaluate(() => {
    const nav = JSON.parse(localStorage.getItem("lelu.lelu.cosmos.nav.v1") || "null");
    return { current: nav?.currentId ?? null, trail: nav?.trail ?? [], camera: document.querySelector(".rt-view-read")?.textContent ?? null };
  });
async function newTerminal(page) {
  await page.click("[data-home-customize]");
  await page.waitForSelector("[data-home-editbar]");
  page.__opts = await page.$$eval('select[aria-label="New presentation from a composition or layout"] option', (o) => o.map((x) => x.value));
  await page.selectOption('select[aria-label="New presentation from a composition or layout"]', "retro-terminal");
  await page.waitForSelector("[data-retro-terminal]", { timeout: 15000 });
  await page.click("[data-home-customize]");
  await page.waitForTimeout(600);
}
async function openRole(page, label) {
  const row = page.locator(`.rts-role`, { hasText: label }).first();
  if (!(await row.count())) {
    await page.screenshot({ path: `${OUT}/debug-missing-role.png` });
    console.log("DEBUG studio count", await page.locator("[data-terminal-studio]").count(), "roles", await page.locator(".rts-role").count(), "errors", errors.slice(-3));
  }
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
}
async function setHex(page, roleLabel, hex) {
  await openRole(page, roleLabel);
  const field = page.locator(`input[aria-label="${roleLabel} HEX value"]`);
  await field.fill(hex);
  await field.press("Enter");
  await page.waitForTimeout(150);
}

const browser = await launch();
const errors = [];

/* ---------------- desktop ---------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guest(ctx);
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  const templates = await page.$$eval('select[aria-label="New presentation from a composition or layout"] option', (o) => o.map((x) => x.value)).catch(() => []);
  await markCanvas(page);
  const homeName = await page.$eval("[data-lelu-home] .lch-brand-sub", (e) => e.textContent).catch(() => null);
  await newTerminal(page);
  const opts = page.__opts ?? templates;
  check("desktop: Retro Terminal is selectable as a layout", (await page.locator("[data-retro-terminal]").count()) === 1);
  check("desktop: the Cosmos renderer was not remounted by switching to the terminal", await canvasKept(page));
  check("desktop: directory lists real destinations", (await page.locator(".rt-dir .rt-row").count()) > 0, `${await page.locator(".rt-dir .rt-row").count()} rows`);
  check("desktop: the Home's live modules render as terminal panes", (await page.locator(".rt-panes .hc [data-home-module]").count()) >= 6);
  check("desktop: telemetry shows world lifecycle and stream data", /\w/.test(await page.locator(".rt-tele").innerText()) && (await page.locator(".rt-tele dd").count()) > 10);
  const o1 = await overflow(page);
  check("desktop: no horizontal overflow", o1.page <= 0 && o1.terminal <= 0, JSON.stringify(o1));
  check("desktop: default look is Classic Retro (charcoal + amber)", (await rtVar(page, "--rt-bg")) === "#12100e" && (await rtVar(page, "--rt-text")) === "#ffb000");
  await shot(page, "01-desktop-classic-retro");

  // Commands drive the real systems.
  await page.fill("#rt-cmd", "where");
  await page.press("#rt-cmd", "Enter");
  await page.waitForTimeout(200);
  check("desktop: 'where' prints real coordinates and the world phase", /POS\s+x/.test(await page.locator(".rt-log").innerText()) && /WORLD/.test(await page.locator(".rt-log").innerText()));
  const rows = page.locator(".rt-dir .rt-row");
  const target = (await rows.count()) > 1 ? rows.nth(1) : rows.first();
  const targetLabel = (await target.locator(".rt-row-label").innerText()).trim();
  await target.click();
  await page.waitForTimeout(400);
  const u1 = await universe(page);
  check("desktop: a directory row navigates through CosmosNavigation", (await target.getAttribute("data-current")) === "true" && u1.current !== null, `${targetLabel} → ${u1.current}`);

  // Appearance Studio — live preview of independent roles.
  await page.click("[data-terminal-studio-open]");
  await page.waitForSelector("[data-terminal-studio]");
  await page.click("#rts-tab-colors");
  const panelBefore = await rtVar(page, "--rt-panel");
  await setHex(page, "Main background", "#001a33");
  check("desktop: main background changes live and independently", (await rtVar(page, "--rt-bg")) === "#001a33" && (await rtVar(page, "--rt-panel")) === panelBefore);
  await setHex(page, "Headings", "#ff3399");
  await setHex(page, "Numerical readouts", "#00e5ff");
  check("desktop: typography roles change independently", (await rtVar(page, "--rt-heading")) === "#ff3399" && (await rtVar(page, "--rt-numeric")) === "#00e5ff" && (await rtVar(page, "--rt-text")) === "#ffb000");
  await setHex(page, "Sidebar", "#1a0033");
  await setHex(page, "Secondary accent", "#7cff00");
  await setHex(page, "Tertiary accent", "rgb(155, 92, 255)");
  check("desktop: multiple accents and regions coexist", (await rtVar(page, "--rt-sidebar")) === "#1a0033" && (await rtVar(page, "--rt-accent2")) === "#7cff00" && (await rtVar(page, "--rt-accent3")) === "#9b5cff", "rgb() accepted as #9b5cff");
  const bad = page.locator('input[aria-label="Tertiary accent HEX value"]');
  await bad.fill("#zz");
  await bad.press("Enter");
  check("desktop: an invalid HEX is refused and the colour kept", (await page.locator(".rts-color .rt-err").count()) > 0 && (await rtVar(page, "--rt-accent3")) === "#9b5cff");
  check("desktop: the terminal marks unsaved changes", (await page.getAttribute("[data-retro-terminal]", "data-unsaved")) === "true" && (await page.locator(".rts-unsaved").count()) === 1);
  await shot(page, "02-desktop-studio-multicolour");

  // Palette: one swatch recolours every role that uses it.
  await page.click("#rts-tab-palette");
  await page.locator(".rts-swatch-btn").nth(3).click();
  const sw = page.locator('input[aria-label="Swatch 4 HEX value"]');
  await sw.fill("#ff5f1f");
  await sw.press("Enter");
  await page.waitForTimeout(150);
  check("desktop: editing a palette swatch recolours its roles", (await rtVar(page, "--rt-text")) === "#ff5f1f" && (await rtVar(page, "--rt-accent1")) === "#ff5f1f");

  // Contrast warnings — reported, not overridden.
  await page.click("#rts-tab-colors");
  const panel = await rtVar(page, "--rt-panel");
  await setHex(page, "Primary text", panel);
  await page.waitForTimeout(150);
  const badge = await page.locator("#rts-tab-check .rts-tabbadge").count();
  await page.click("#rts-tab-check");
  check("desktop: poor contrast is warned about and the colour is kept", badge === 1 && (await page.locator(".rts-table tr[data-level='fail']").count()) > 0 && (await rtVar(page, "--rt-text")) === panel);
  await shot(page, "03-desktop-contrast-warning");
  await page.click('button[aria-label="Undo appearance change"]');
  await page.waitForTimeout(150);
  check("desktop: undo restores the previous colour", (await rtVar(page, "--rt-text")) === "#ff5f1f");
  await page.click('button[aria-label="Revert all unsaved changes"]');
  await page.waitForTimeout(150);
  check("desktop: revert drops every unsaved change", (await rtVar(page, "--rt-bg")) === "#12100e" && (await page.getAttribute("[data-retro-terminal]", "data-unsaved")) === "false");

  // Presets load and stay editable; saving makes a theme of hers.
  await page.click("#rts-tab-themes");
  await page.click("[data-preset='cybernetic']");
  await page.waitForTimeout(200);
  check("desktop: a preset loads", (await page.getAttribute("[data-retro-terminal]", "data-theme")) === "cybernetic" && (await rtVar(page, "--rt-bg")) === "#020409");
  await shot(page, "04-desktop-cybernetic");
  await page.click("#rts-tab-colors");
  await setHex(page, "Panels", "#0a1530");
  check("desktop: the preset is editable", (await rtVar(page, "--rt-panel")) === "#0a1530");
  await page.click("[data-terminal-save]");
  await page.waitForTimeout(250);
  const term = await stored(page, "lelu.home.terminal.v1");
  check("desktop: saving an edited preset creates a custom theme", term?.themes?.length === 1 && term.activeId === term.themes[0].id && term.themes[0].name === "Cybernetic (custom)", JSON.stringify({ n: term?.themes?.length, name: term?.themes?.[0]?.name }));
  await page.click("#rts-tab-effects");
  await page.getByRole("button", { name: "Reduce effects" }).click();
  await page.waitForTimeout(150);
  check("desktop: effects can be reduced (scanlines, grid, glow, animation off)", (await page.getAttribute("[data-retro-terminal]", "data-scan")) === "off" && (await page.getAttribute("[data-retro-terminal]", "data-grid")) === "off" && (await page.getAttribute("[data-retro-terminal]", "data-anim")) === "off");
  await page.click("[data-terminal-save]");
  await page.waitForTimeout(200);
  await page.click('button[aria-label="Close the appearance studio"]');

  // Reload: layout and theme come back.
  const before = await universe(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await enter(page, "[data-retro-terminal]");
  check("desktop: after reload the terminal and its saved theme return", (await page.locator("[data-retro-terminal]").count()) === 1 && (await rtVar(page, "--rt-panel")) === "#0a1530" && (await page.getAttribute("[data-retro-terminal]", "data-scan")) === "off");
  const afterReload = await universe(page);
  // Observation, not a requirement of this layout: CosmosNavigation restores the current
  // destination after a reload only for nodes it persists (rooms); live-map destinations
  // are re-synced, so a reload from one returns to the core. Recorded for the report.
  console.log(`NOTE reload: navigation ${before.current} → ${afterReload.current} (CosmosNavigation restore rule, unchanged)`);

  // Layout switching keeps the universe and the theme.
  await markCanvas(page);
  const u2 = await universe(page);
  await page.click("[data-home-customize]");
  const presOptions = await page.$$eval('select[aria-label="Switch presentation"] option', (o) => o.map((x) => ({ v: x.value, t: x.textContent })));
  const original = presOptions.find((o) => o.t === homeName) ?? presOptions[0];
  await page.selectOption('select[aria-label="Switch presentation"]', original.v);
  await page.waitForTimeout(800);
  check("desktop: switching to another layout leaves the terminal; existing layouts intact", (await page.locator("[data-retro-terminal]").count()) === 0 && (await page.locator("[data-lelu-home] .hc[data-template]").count()) === 1);
  await shot(page, "05-desktop-original-layout");
  const back = presOptions.find((o) => o.v !== original.v);
  await page.selectOption('select[aria-label="Switch presentation"]', back.v);
  await page.waitForSelector("[data-retro-terminal]");
  await page.click("[data-home-customize]");
  await page.waitForTimeout(800);
  const u3 = await universe(page);
  check("desktop: returning restores the terminal's selected appearance", (await rtVar(page, "--rt-panel")) === "#0a1530");
  check("desktop: layout switches keep region, trail and camera", u3.current === u2.current && JSON.stringify(u3.trail) === JSON.stringify(u2.trail) && u3.camera === u2.camera, JSON.stringify({ u2, u3 }));
  check("desktop: the Cosmos renderer survived two layout switches", await canvasKept(page));
  check("desktop: other compositions still listed", opts.includes("lelu-central") && opts.includes("living-ecosystem") && opts.includes("retro-terminal"), opts.join(","));
  await shot(page, "06-desktop-custom-theme");
  await ctx.close();
}

/* ---------------- tablet ---------------- */
{
  const ctx = await browser.newContext({ ...devices["iPad Mini"] });
  await guest(ctx);
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  await newTerminal(page);
  const o = await overflow(page);
  check("tablet: terminal renders with no horizontal overflow", (await page.locator("[data-retro-terminal][data-device='tablet']").count()) === 1 && o.page <= 0 && o.terminal <= 0, JSON.stringify(o));
  await shot(page, "07-tablet-terminal");
  await page.click("[data-terminal-studio-open]");
  await page.click("#rts-tab-themes");
  await page.click("[data-preset='cosmic-violet']");
  await page.waitForTimeout(250);
  check("tablet: presets apply live behind the studio", (await rtVar(page, "--rt-bg-fill")).startsWith("linear-gradient"), "Cosmic Violet has a gradient background");
  await shot(page, "08-tablet-studio-cosmic-violet");
  await ctx.close();
}

/* ---------------- phone ---------------- */
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  await guest(ctx);
  const page = await ctx.newPage();
  track(page, errors);
  await enter(page);
  await newTerminal(page);
  const o = await overflow(page);
  check("phone: terminal renders as a phone layout (tabs, not a shrunk desktop), no overflow", (await page.locator("[data-retro-terminal][data-device='phone'] .rt-tabs").count()) === 1 && o.page <= 0 && o.terminal <= 0, JSON.stringify(o));
  await shot(page, "09-phone-terminal-panes");
  await page.tap("#rt-tab-directory");
  check("phone: directory tab works by touch", (await page.locator(".rt-tabpanel .rt-dir .rt-row").count()) > 0);
  await shot(page, "10-phone-directory");
  await page.tap("#rt-tab-telemetry");
  await shot(page, "11-phone-telemetry");
  await page.fill("#rt-cmd", "help");
  await page.press("#rt-cmd", "Enter");
  await page.tap("#rt-tab-log");
  check("phone: command line works and the log shows output", /COMMANDS/.test(await page.locator(".rt-tabpanel .rt-log").innerText()));
  await page.tap("[data-terminal-studio-open]");
  await page.waitForSelector("[data-terminal-studio][data-device='phone']");
  await page.tap("#rts-tab-colors");
  await page.locator(".rts-role", { hasText: "Main background" }).first().tap();
  const field = page.locator('input[aria-label="Main background HEX value"]');
  await field.fill("#2b0a3d");
  await field.press("Enter");
  await page.waitForTimeout(200);
  check("phone: live preview while the studio sheet is open", (await rtVar(page, "--rt-bg")) === "#2b0a3d");
  const small = await page.$$eval("[data-terminal-studio] button:not([disabled]), [data-terminal-studio] input[type=color]", (els) =>
    els.filter((e) => e.getBoundingClientRect().width > 0 && e.offsetParent !== null).filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height < 32 || r.width < 32;
    }).map((e) => e.getAttribute("aria-label") || e.textContent?.trim()).slice(0, 6),
  );
  check("phone: studio controls are touch-sized (≥32px)", small.length === 0, small.join(", "));
  const os = await overflow(page);
  check("phone: studio sheet has no horizontal overflow", os.page <= 0, JSON.stringify(os));
  await shot(page, "12-phone-studio-colours");
  await page.tap('button[aria-label="Peek at the terminal"]');
  await page.waitForTimeout(200);
  await shot(page, "13-phone-studio-peek");
  await page.tap('button[aria-label="Show the studio"]');
  await page.tap("#rts-tab-themes");
  await page.waitForTimeout(150);
  await shot(page, "14-phone-studio-themes");
  await page.tap("#rts-tab-effects");
  await page.waitForTimeout(150);
  await shot(page, "15-phone-studio-effects");
  await ctx.close();
}

await browser.close();
const relevant = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|WebGL|GPU stall|404|Access to fetch at .https?:\/\/(?!127\.0\.0\.1)/.test(String(e)));
check("no page errors during the run", relevant.length === 0, relevant.slice(0, 3).join(" | "));
await writeFile("docs/missions/retro-terminal/browser-run.json", JSON.stringify({ at: new Date().toISOString(), results, errors: relevant }, null, 2));
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.length - failed}/${results.length} verified`);
process.exit(failed ? 1 : 0);
