/**
 * Mission 41 — captures the orbit as it actually renders.
 *
 * Run against the dev server (`npm run dev`, port 5173):
 *   node scripts/capture-mission-41.mjs
 *
 * Writes docs/missions/evidence/mission-41/*.png plus a small
 * measurement file, so the composition is documented by the app
 * rather than described.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:5173";
const OUT = join(process.cwd(), "docs/missions/evidence/mission-41");
mkdirSync(OUT, { recursive: true });

const CACHE = join(homedir(), ".cache/ms-playwright");
const candidates = [
  process.env.CHROME,
  ...(existsSync(CACHE)
    ? [
        "chromium-1255/chrome-linux64/chrome",
        "chromium-1255/chrome-linux/chrome",
        "chromium_headless_shell-1255/chrome-linux64/headless_shell",
      ].map((suffix) => join(CACHE, suffix))
    : []),
].filter(Boolean);
const executablePath = candidates.find((path) => path && existsSync(path));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function enter(page) {
  await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await wait(2500);
  const gate = await page.$("[data-lelu-signin-gate]");
  if (gate) {
    const guest = await page.$("[data-lelu-signin-gate] button");
    if (guest) await guest.click().catch(() => {});
    await wait(1500);
  }
  await page.waitForSelector("[data-spatial-nav]", { timeout: 120000 });
  await wait(4000);
}

async function measure(page) {
  return page.evaluate(() => {
    const nav = document.querySelector("[data-spatial-nav]");
    if (!nav) return null;
    const orbs = [...nav.querySelectorAll("[data-spatial-group-orb]")];
    const core = nav.querySelector('[data-spatial-control="core"]');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const overlap = (a, b) => {
      if (!a || !b) return false;
      return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
    };
    const positions = orbs.map((orb) => ({
      id: orb.getAttribute("data-spatial-group-orb"),
      ...rect(orb),
      touch: (() => {
        const r = orb.getBoundingClientRect();
        return Math.round(Math.min(r.width, r.height));
      })(),
    }));
    let overlaps = 0;
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        if (overlap(positions[i], positions[j])) overlaps += 1;
      }
    }
    const coreRect = rect(core);
    return {
      viewport: [window.innerWidth, window.innerHeight],
      nav: rect(nav),
      core: coreRect,
      orbCount: positions.length,
      positions,
      overlaps,
      coreOverlappedByOrb: positions.some((orb) => overlap(orb, coreRect)),
      navWidthRatio: nav ? Math.round((nav.getBoundingClientRect().width / window.innerWidth) * 100) : null,
      labels: [...nav.querySelectorAll("[data-spatial-group-orb]")].map((orb) => orb.getAttribute("aria-label")),
    };
  });
}

async function capture(name, viewport, mobile) {
  const browser = await chromium.launch({
    executablePath,
    args: ["--no-sandbox", "--headless=new", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
  try {
    await enter(page);
    const resting = await measure(page);
    await page.screenshot({ path: join(OUT, `${name}-01-orbit-resting.png`) });

    /* Open the Environment category: its destinations orbit that orb. */
    const env = await page.$('[data-spatial-group-orb="environment"]');
    if (env) await env.click();
    await wait(900);
    const openState = await measure(page);
    const satellites = await page.evaluate(() => {
      const cluster = document.querySelector("[data-spatial-groups]");
      if (!cluster) return null;
      const rect = (el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        category: cluster.getAttribute("data-category"),
        satellites: [...cluster.querySelectorAll("[data-spatial-scene]")].map((el) => ({
          scene: el.getAttribute("data-spatial-scene"),
          ...rect(el),
          touch: Math.round(Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)),
        })),
      };
    });
    await page.screenshot({ path: join(OUT, `${name}-02-category-orbit.png`) });

    /* Travel to the Cosmos through the orbit. */
    const cosmos = await page.$('[data-spatial-groups] [data-spatial-scene="cosmos"]');
    if (cosmos) await cosmos.click();
    await wait(3600);
    const travelled = await page.evaluate(() => ({
      current: document.querySelector("[data-spatial-nav]")?.getAttribute("data-spatial-current"),
      transition: document.querySelector("[data-spatial-nav]")?.getAttribute("data-spatial-transition"),
    }));
    await page.screenshot({ path: join(OUT, `${name}-03-cosmos-travel.png`) });

    /* Return to the Core from the anchor. */
    const core = await page.$('[data-spatial-control="core"]');
    if (core) await core.click();
    await wait(3200);
    const returned = await page.evaluate(() => ({
      current: document.querySelector("[data-spatial-nav]")?.getAttribute("data-spatial-current"),
    }));
    await page.screenshot({ path: join(OUT, `${name}-04-returned-to-core.png`) });

    writeFileSync(
      join(OUT, `${name}-measurements.json`),
      JSON.stringify({ resting, openState, satellites, travelled, returned, errors }, null, 2),
    );
    console.log(`[${name}]`, JSON.stringify({ resting, openState, satellites, travelled, returned, errors }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

await capture("desktop", { width: 1440, height: 900 }, false);
await capture("phone", { width: 390, height: 844 }, true);
