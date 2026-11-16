/**
 * ==========================================================
 * LÉLU — PHASE 2: CHAT OWNS THE PHONE (browser acceptance)
 *
 *   node tests/e2e/mobile-chat.e2e.mjs <base-url> <out-dir>
 *
 * Real Chromium against a real server (CI: `vite preview` of the
 * production build). Every check is measured on the rendered page and
 * every step leaves a screenshot. Keyboard behaviour is EMULATED here
 * (the visual viewport is shrunk as an iOS keyboard does); real iOS
 * Safari keyboard behaviour needs the physical-device checklist in
 * docs/audit/2026-11-06/PHASE_2_CHAT_MOBILE_REPORT.md.
 *
 * Exit code 1 if any check fails. Writes report.json beside the shots.
 * ==========================================================
 */

import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// CI installs the browser that matches the pinned playwright; elsewhere a
// preinstalled Chromium can be named (the same variable selfViewApi reads).
const LAUNCH = process.env.LELU_CHROMIUM_PATH ? { executablePath: process.env.LELU_CHROMIUM_PATH } : {};
const BASE = process.argv[2] ?? "http://127.0.0.1:4173";
const OUT = path.resolve(process.argv[3] ?? "mobile-chat-e2e");
mkdirSync(OUT, { recursive: true });

const PHONES = [
  { name: "iphone-13", device: devices["iPhone 13"] },                 // 390×844
  { name: "iphone-se", device: devices["iPhone SE"] },                 // 375×667
  { name: "iphone-15-pro-max", device: devices["iPhone 15 Pro Max"] ?? { ...devices["iPhone 13"], viewport: { width: 430, height: 932 } } },
  { name: "galaxy-s8", device: devices["Galaxy S8"] },                 // 360×740
  { name: "pixel-7", device: devices["Pixel 7"] },                     // 412×915
];

const checks = [];
const record = (viewport, name, ok, detail = "") => {
  checks.push({ viewport, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${viewport}] ${name}${detail ? ` — ${detail}` : ""}`);
};

/** What is mounted and how the composer sits, measured in the page. */
const probe = () => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
  };
  const textareas = [...document.querySelectorAll("textarea")].filter(vis).map((t) => {
    const r = t.getBoundingClientRect();
    const row = t.closest("form, .lcu-composer, .lcu-input") ?? t.parentElement;
    const rr = row.getBoundingClientRect();
    return { label: t.getAttribute("aria-label") ?? t.placeholder, x: r.x, y: r.y, w: r.width, h: r.height, rowLeft: rr.left, rowRight: rr.right, rowBottom: rr.bottom };
  });
  const sheet = document.querySelector("[data-lelu-module-window][data-lelu-fullscreen]");
  const sr = sheet?.getBoundingClientRect();
  const canvases = [...document.querySelectorAll("canvas")].map((c) => {
    let el = c, owner = "other";
    for (let i = 0; i < 12 && el; i += 1, el = el.parentElement) {
      if (el.getAttribute?.("data-workspace")) { owner = `workspace:${el.getAttribute("data-workspace")}`; break; }
      if (el.getAttribute?.("data-testid")) { owner = `testid:${el.getAttribute("data-testid")}`; break; }
    }
    return { owner, visible: vis(c) };
  });
  const vv = window.visualViewport;
  return {
    vw: innerWidth,
    vh: innerHeight,
    vvh: vv ? vv.height : innerHeight,
    mounted: {
      home: Boolean(document.querySelector(".lch")),
      spatialNav: Boolean(document.querySelector(".lsn")),
      genesisV1: Boolean(document.querySelector('[data-workspace="genesis-v1"]')),
      universe: Boolean(document.querySelector(".lcu-bottom, .lcu-card")),
    },
    sceneCanvases: canvases.filter((c) => c.owner.startsWith("workspace:")).length,
    textareas,
    sheet: sr ? { id: sheet.getAttribute("data-lelu-module-window"), x: sr.x, y: sr.y, w: sr.width, h: sr.height } : null,
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

async function boot(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(1500);
    const ready = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false);
    if (ready) break;
  }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
}

const clickText = (page, re) => page.evaluate((src) => {
  const rx = new RegExp(src);
  const el = [...document.querySelectorAll("button, a, [role=button]")].find((b) => rx.test(b.textContent.trim()) || rx.test(b.getAttribute("aria-label") ?? ""));
  el?.click();
  return Boolean(el);
}, re.source);

async function phone(entry) {
  const v = entry.name;
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ ...entry.device, deviceScaleFactor: 2 });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const shot = (folder, name) => {
    mkdirSync(path.join(OUT, folder), { recursive: true });
    return page.screenshot({ path: path.join(OUT, folder, `${v}-${page.viewportSize().width}x${page.viewportSize().height}-${name}.png`) });
  };
  try {
    await boot(page);
    let p = await page.evaluate(probe);
    await shot("01-initial-state", "home");
    record(v, "Home renders on load", p.mounted.home);
    record(v, "no horizontal overflow on Home", !p.overflowX);

    // Open Chat (the Universe) from Home's Chat tile.
    record(v, "Chat tile found", await clickText(page, /^Chat$/));
    await page.waitForTimeout(2500);
    p = await page.evaluate(probe);
    await shot("02-fullscreen-chat", "chat-universe");
    await shot("09-chat-universe", "universe-grid");
    record(v, "Chat Universe is on screen", p.mounted.universe);
    record(v, "Home is unmounted under Chat", !p.mounted.home, JSON.stringify(p.mounted));
    record(v, "spatial nav is unmounted under Chat", !p.mounted.spatialNav);
    record(v, "Genesis V1 scene is unmounted under Chat", !p.mounted.genesisV1 && p.sceneCanvases === 0, `${p.sceneCanvases} scene canvases`);
    record(v, "one visible composer in the Universe", p.textareas.length === 1, `${p.textareas.length}`);
    record(v, "no horizontal overflow in Chat", !p.overflowX);

    // Open the "New chat" conversation.
    const opened = await page.evaluate(() => { const c = [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? "")); c?.click(); return Boolean(c); });
    record(v, "conversation card found", opened);
    await page.waitForTimeout(2500);
    p = await page.evaluate(probe);
    await shot("02-fullscreen-chat", "conversation-open");
    record(v, "conversation is a full-screen sheet", Boolean(p.sheet) && Math.abs(p.sheet.w - p.vw) < 2 && p.sheet.h >= p.vvh - 2, JSON.stringify(p.sheet));
    record(v, "exactly one visible composer", p.textareas.length === 1, p.textareas.map((t) => t.label).join(" | "));
    const ta = p.textareas[0];
    record(v, "composer row spans the screen", ta && ta.rowLeft <= 24 && ta.rowRight >= p.vw - 24, ta ? `${Math.round(ta.rowLeft)}–${Math.round(ta.rowRight)} of ${p.vw}` : "none");
    record(v, "composer is above the bottom edge", ta && ta.rowBottom <= p.vvh, ta ? `${Math.round(ta.rowBottom)} ≤ ${p.vvh}` : "none");
    record(v, "Home still unmounted with a conversation open", !p.mounted.home && !p.mounted.spatialNav && p.sceneCanvases === 0);

    // Typing grows the composer and keeps it on screen; input fonts never trigger iOS zoom.
    await page.locator("[data-lelu-fullscreen] textarea").focus();
    const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-lelu-fullscreen] textarea")).fontSize));
    record(v, "composer font ≥ 16 px (no iOS focus zoom)", fontSize >= 16, `${fontSize}px`);
    await page.keyboard.type("Line one of a longer message. ".repeat(5), { delay: 0 });
    // Emulated keyboard: the visual viewport loses ~40% of its height, as on iOS.
    const full = page.viewportSize();
    await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.58) });
    await page.waitForTimeout(800);
    p = await page.evaluate(probe);
    await shot("03-keyboard", "keyboard-open-emulated");
    const t2 = p.textareas[0];
    record(v, "with the keyboard open the sheet fits the visible area", Boolean(p.sheet) && p.sheet.h <= p.vvh + 2, JSON.stringify(p.sheet));
    record(v, "with the keyboard open the composer stays visible", t2 && t2.rowBottom <= p.vvh + 1 && t2.y >= 0, t2 ? `${Math.round(t2.y)}–${Math.round(t2.rowBottom)} of ${p.vvh}` : "none");
    const draft = await page.locator("[data-lelu-fullscreen] textarea").inputValue();
    record(v, "the draft survives the viewport change", draft.startsWith("Line one"), `${draft.length} chars`);
    await page.setViewportSize(full);
    await page.waitForTimeout(800);
    await shot("03-keyboard", "keyboard-closed");

    // Send: the message appears in THIS conversation and the composer clears.
    await page.locator("[data-lelu-fullscreen] textarea").fill("Phase 2 check: hello from the phone");
    await page.locator("[data-lelu-fullscreen] textarea").press("Enter");
    await page.waitForTimeout(2500);
    const sent = await page.evaluate(() => {
      const sheet = document.querySelector("[data-lelu-fullscreen]");
      return { text: sheet?.innerText.includes("Phase 2 check: hello from the phone") ?? false, draft: sheet?.querySelector("textarea")?.value ?? "?" };
    });
    await shot("02-fullscreen-chat", "message-sent");
    record(v, "a sent message appears in the conversation", sent.text);
    record(v, "the composer clears after sending", sent.draft === "", JSON.stringify(sent.draft));

    // Multi-chat: switch to "Engineering" and back; histories stay apart.
    await clickText(page, /^Close New chat$|^Close Phase 2/);
    await page.waitForTimeout(1500);
    p = await page.evaluate(probe);
    record(v, "closing the conversation returns to the Universe", p.mounted.universe && !p.sheet && p.textareas.length === 1);
    const eng = await page.evaluate(() => { const c = [...document.querySelectorAll(".lcu-card")].find((x) => /Engineering/.test(x.getAttribute("aria-label") ?? "")); c?.click(); return Boolean(c); });
    await page.waitForTimeout(2500);
    const engText = await page.evaluate(() => document.querySelector("[data-lelu-fullscreen]")?.innerText ?? "");
    await shot("10-multi-chat", "engineering-conversation");
    record(v, "a second conversation opens", eng && engText.length > 0);
    record(v, "the second conversation does not show the first one's message", !engText.includes("Phase 2 check: hello from the phone"));
    await clickText(page, /^Close Engineering$/);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const c = [...document.querySelectorAll(".lcu-card")].find((x) => /Phase 2 check|New chat/.test(x.getAttribute("aria-label") ?? "")); c?.click(); });
    await page.waitForTimeout(2500);
    const backText = await page.evaluate(() => document.querySelector("[data-lelu-fullscreen]")?.innerText ?? "");
    await shot("10-multi-chat", "first-conversation-restored");
    record(v, "switching back restores the first conversation's history", backText.includes("Phase 2 check: hello from the phone"));

    // Orientation: landscape keeps the sheet full-screen and nothing overflows.
    await page.setViewportSize({ width: full.height, height: full.width });
    await page.waitForTimeout(1000);
    p = await page.evaluate(probe);
    await shot("06-responsive", "landscape-conversation");
    record(v, "landscape: still one composer, no overflow", p.textareas.length === 1 && !p.overflowX);
    await page.setViewportSize(full);
    await page.waitForTimeout(800);

    // Back to Home: close the conversation, then the Universe.
    await page.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-fullscreen] button")].find((x) => /^Close /.test(x.getAttribute("aria-label") ?? "")); b?.click(); });
    await page.waitForTimeout(1200);
    await clickText(page, /^Close Chat Universe$/);
    await page.waitForTimeout(2500);
    p = await page.evaluate(probe);
    await shot("04-navigation", "back-home");
    record(v, "closing Chat brings Home back", p.mounted.home && !p.mounted.universe);
    record(v, "the Cosmos scene is rendered again on Home", p.mounted.genesisV1 || p.sceneCanvases > 0, `${p.sceneCanvases} scene canvases`);
    record(v, "no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  } catch (error) {
    record(v, "suite ran to the end", false, String(error).slice(0, 200));
    await shot("07-regression", "failure").catch(() => undefined);
  } finally {
    await browser.close();
  }
}

async function desktop() {
  const v = "desktop";
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const shot = (folder, name) => { mkdirSync(path.join(OUT, folder), { recursive: true }); return page.screenshot({ path: path.join(OUT, folder, `desktop-1440x900-${name}.png`) }); };
  try {
    await boot(page);
    await clickText(page, /^Chat$/);
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const c = [...document.querySelectorAll(".lcu-card")].find((x) => /New chat/.test(x.getAttribute("aria-label") ?? "")); c?.click(); });
    await page.waitForTimeout(2500);
    const p = await page.evaluate(probe);
    await shot("06-responsive", "conversation-window");
    record(v, "desktop conversation stays a free window (not full-screen)", !p.sheet);
    record(v, "desktop keeps the Universe composer and the window composer", p.textareas.length >= 1, `${p.textareas.length}`);
    // Application windows sit above the chat panel.
    await clickText(page, /^Close Chat Universe$/);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const g = [...document.querySelectorAll("button")].find((x) => /settings/i.test(x.getAttribute("aria-label") ?? "") || x.textContent.trim() === "Settings"); g?.click(); });
    await page.waitForTimeout(2500);
    const z = await page.evaluate(() => {
      const win = document.querySelector('[data-lelu-module-window="settings"]');
      const chat = [...document.querySelectorAll("div")].find((d) => d.style.zIndex === "100" && d.querySelector("textarea"));
      return { win: win ? Number(getComputedStyle(win).zIndex) : null, chat: chat ? 100 : null };
    });
    await shot("05-workspace", "settings-above-chat");
    record(v, "an application window stacks above the chat panel", z.win !== null && z.win > 100, JSON.stringify(z));
    record(v, "no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  } catch (error) {
    record(v, "suite ran to the end", false, String(error).slice(0, 200));
  } finally {
    await browser.close();
  }
}

// LELU_E2E_ONLY=desktop|<phone name> runs one target (default: all).
const only = process.env.LELU_E2E_ONLY;
for (const entry of PHONES) if (!only || only === entry.name) await phone(entry);
if (!only || only === "desktop") await desktop();
const failed = checks.filter((c) => !c.ok);
writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ base: BASE, checks: checks.length, failed: failed.length, results: checks }, null, 2));
console.log(JSON.stringify({ checks: checks.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
