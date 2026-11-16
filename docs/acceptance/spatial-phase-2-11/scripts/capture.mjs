/**
 * Mission 5.2 — per-shot acceptance capture.
 *
 * Software WebGL in this container traps nondeterministically during long
 * sessions, so every capture gets its OWN browser (a short session), with the
 * storage state carried between them. Retries are recorded, never hidden.
 *
 *   LD_LIBRARY_PATH=<ws>/.apt/root/usr/lib/x86_64-linux-gnu \
 *   node .../capture.mjs 1440 900 [set=all|core]
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..");
const MEASURE = join(OUT, "measurements");
const ORIGIN = process.env.ORIGIN || "http://127.0.0.1:3013";
const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;

const [W, H] = [Number(process.argv[2] || 390), Number(process.argv[3] || 844)];
const SET = process.argv[4] || "all";
const DPR = Number(process.env.DPR || 1);
const MOBILE = W < 800;
const TAG = `${W}x${H}`;
const STORE = join(MEASURE, `storage-${TAG}.json`);
const MOTION = process.env.MOTION === "full" ? "no-preference" : "reduce";

mkdirSync(MEASURE, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const report = {
  viewport: `${W}x${H}`,
  deviceScaleFactor: DPR,
  mobile: MOBILE,
  reducedMotion: MOTION === "reduce",
  renderer: "SwiftShader software WebGL, headless Chromium 151",
  shots: [],
  failures: [],
};

function makeDriver(page) {
  const driver = {
    tap: async (selector) => {
      const box = await page.locator(selector).first().boundingBox().catch(() => null);
      if (!box) throw new Error(`no control ${selector}`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (MOBILE) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
    },
    press: async (selector, key) => page.locator(selector).first().press(key),
    fill: (selector, value) => page.locator(selector).first().fill(value),
    select: (selector, value) => page.selectOption(selector, value),
    shot: async (name, extra = {}) => {
      const file = `${TAG}-${name}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const rec = {
        file,
        viewport: `${W}x${H}`,
        deviceScaleFactor: DPR,
        pixels: await page.evaluate(() => `${innerWidth * devicePixelRatio}x${innerHeight * devicePixelRatio}`),
        at: new Date().toISOString(),
        scene: await page.evaluate(() => document.body.dataset.spatialScene || ""),
        ...extra,
      };
      report.shots.push(rec);
      return rec;
    },
    travel: async (scene, settleMs = 45000) => {
      await driver.tap(`[data-spatial-scene="${scene}"]`);
      const started = Date.now();
      while (Date.now() - started < settleMs) {
        const s = await page
          .evaluate(() => {
            const st = window.__leluSpatial?.getState?.();
            return { current: st?.current, transition: st?.transition?.kind ?? null, progress: st?.transition?.progress ?? null };
          })
          .catch(() => null);
        if (s && !s.transition && s.current === scene) return Date.now() - started;
        await wait(300);
      }
      return -1;
    },
    state: () =>
      page.evaluate(() => {
        const st = window.__leluSpatial?.getState?.() ?? null;
        return { current: st?.current ?? null, transition: st?.transition?.kind ?? null };
      }),
    portals: () =>
      page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("lelu.lelu.spatial.portals.v1") || "[]");
        } catch {
          return [];
        }
      }),
    layout: () =>
      page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("lelu.lelu.layout.v2") || "{}").entries ?? [];
        } catch {
          return [];
        }
      }),
    ensureRail: async () => {
      if (await page.locator('[data-spatial-scene="cosmos"]').count()) return;
      await driver.tap('[data-spatial-control="expand"]');
      await page.waitForSelector('[data-spatial-scene="cosmos"]', { timeout: 12000 });
    },
    openPanel: async () => {
      await driver.tap('[data-spatial-control="portals"]');
      await page.waitForSelector("[data-portal-panel]", { timeout: 20000 });
    },
    panelText: () => page.locator("[data-portal-panel]").evaluate((el) => (el.textContent || "").slice(0, 500)),
  };
  return driver;
}

async function runScenario(name, steps, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const browser = await chromium.launch({
      executablePath: existsSync(CHROME) ? CHROME : undefined,
      args: [
        "--no-sandbox",
        "--headless=new",
        "--disable-dev-shm-usage",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=CalculateNativeWinOcclusion",
        "--enable-unsafe-swiftshader",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: DPR,
      isMobile: MOBILE,
      hasTouch: MOBILE,
      reducedMotion: MOTION,
      storageState: existsSync(STORE) ? STORE : undefined,
    });
    const page = await context.newPage();
    const driver = makeDriver(page);
    try {
      await page.goto(`${ORIGIN}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-spatial-nav]", { timeout: 90000 });
      await wait(2500);
      const detail = await steps(driver, page);
      await context.storageState({ path: STORE });
      log(`  ok  ${name}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      return { name, ok: true, attempt, detail };
    } catch (error) {
      const why = String(error).split("\n")[0].slice(0, 160);
      log(`  fail ${name} attempt ${attempt}: ${why}`);
      if (attempt === attempts) {
        await page.screenshot({ path: join(OUT, `${TAG}-failure-${name}.png`) }).catch(() => {});
        return { name, ok: false, attempts: attempt, error: why };
      }
      await wait(1200);
    } finally {
      await browser.close().catch(() => {});
    }
  }
}

/* ------------------------------ scenarios ------------------------------ */

const scenarios = [
  {
    name: "shell",
    steps: async (d) => d.shot("01-genesis-shell", { canvases: await d.state().then(() => 0) }),
  },
  {
    name: "cosmos",
    steps: async (d) => {
      await d.ensureRail();
      const ms = await d.travel("cosmos");
      await wait(1200);
      return d.shot("02-cosmos-home", { travelMs: ms });
    },
  },
  {
    /* The panel is captured over a workspace, where the 3D canvas is not
       composited underneath it — the same panel, a stable frame. */
    name: "panel",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1500);
      await d.openPanel();
      return d.shot("07-portal-creation-panel", { panel: await d.panelText() });
    },
  },
  {
    name: "create-user",
    steps: async (d) => {
      await d.ensureRail();
      if (!(await d.portals()).some((p) => p.label === "Client files")) {
        await d.travel("files");
        await wait(1200);
        await d.openPanel();
        await d.select("[data-portal-destination]", "files");
        await d.fill("[data-portal-name]", "Client files");
        await d.tap("[data-portal-create]");
        await wait(1200);
        await d.select("[data-portal-destination]", "projects");
        await d.fill("[data-portal-name]", "Sprint board");
        await d.tap("[data-portal-create]");
        await wait(1200);
      }
      const all = await d.portals();
      return { created: all.filter((p) => !p.id.startsWith("scene:")).map((p) => `${p.label}->${p.destination}`) };
    },
  },
  {
    name: "ring",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("portal");
      await wait(900);
      return d.shot("03-spatial-portal-ring", { portals: (await d.portals()).length });
    },
  },
  {
    name: "builtin",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("portal");
      await wait(900);
      const builtins = (await d.portals()).filter((p) => p.id.startsWith("scene:"));
      return d.shot("04-built-in-portals", { builtins: builtins.map((p) => p.id) });
    },
  },
  {
    name: "user-portal",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("portal");
      await wait(900);
      const created = (await d.portals()).filter((p) => !p.id.startsWith("scene:") && p.createdBy === "user");
      return d.shot("05-user-portal", { created: created.map((p) => p.label) });
    },
  },
  {
    name: "agent-portal",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1200);
      const replies = await page_evaluate(d, async () => {
        const ask = (detail) =>
          new Promise((resolve) => {
            const requestId = "acc_" + Math.random().toString(36).slice(2, 8);
            const onReply = (event) => {
              if (event.detail?.requestId !== requestId) return;
              window.removeEventListener("lelu-portal-created", onReply);
              resolve(event.detail);
            };
            window.addEventListener("lelu-portal-created", onReply);
            window.dispatchEvent(new CustomEvent("lelu-portal-create", { detail: { ...detail, requestId } }));
            setTimeout(() => resolve({ ok: false, reason: "timeout" }), 3000);
          });
        return {
          first: await ask({ destination: "research", label: "Reading queue" }),
          second: await ask({ destination: "media", label: "Render review" }),
          refused: await ask({ destination: "atlantis", label: "Nowhere" }),
        };
      });
      await wait(1000);
      const agent = (await d.portals()).filter((p) => p.createdBy === "agent");
      await d.travel("portal");
      await wait(1200);
      return d.shot("06-agent-portal", { agent: agent.map((p) => `${p.label}->${p.destination}`), replies });
    },
  },
  {
    name: "removal",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1200);
      await d.openPanel();
      const agent = (await d.portals()).filter((p) => p.createdBy === "agent");
      const victim = agent[0];
      if (victim) {
        await d.tap(`[data-portal-remove="${victim.id}"]`);
        await wait(1200);
      }
      const after = (await d.portals()).filter((p) => !p.id.startsWith("scene:"));
      await d.travel("portal");
      await wait(1000);
      return d.shot("08-portal-removal", { removed: victim?.label ?? null, remaining: after.map((p) => p.label) });
    },
  },
  {
    name: "transition",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1200);
      await d.openPanel();
      const target = (await d.portals()).find((p) => p.label === "Client files") || (await d.portals()).find((p) => !p.id.startsWith("scene:"));
      await d.tap(`[data-portal-travel="${target.id}"]`);
      await wait(900);
      return d.shot("09-portal-travel-transition", { phase: "mid-transition", portal: target.label, at: await d.state() });
    },
  },
  {
    name: "destination",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("core");
      await wait(1200);
      await d.openPanel();
      const target = (await d.portals()).find((p) => p.label === "Client files") || (await d.portals()).find((p) => !p.id.startsWith("scene:"));
      await d.tap(`[data-portal-travel="${target.id}"]`);
      const ms = await d.travel("files");
      await wait(2000);
      const arrival = await page_evaluate(d, () => ({
        scene: document.body.dataset.spatialScene,
        windows: [...document.querySelectorAll("[data-lelu-module-window]")].map((el) => el.getAttribute("data-lelu-module-window")),
      }));
      return d.shot("10-destination-environment", { travelMs: ms, ...arrival });
    },
  },
  {
    name: "arrange",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1500);
      await d.openPanel();
      await d.tap("[data-layout-arrange]");
      await wait(1200);
      return d.shot("11-auto-arrange", { notice: await d.panelText(), entries: (await d.layout()).length });
    },
  },
  {
    name: "regenerate",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1500);
      await d.openPanel();
      await d.tap("[data-layout-regenerate]");
      await wait(1200);
      const entries = await d.layout();
      return d.shot("12-regenerate-layout", {
        notice: await d.panelText(),
        entries: entries.map((e) => `${e.moduleId}@${e.rect.x},${e.rect.y}`),
      });
    },
  },
  {
    name: "pin",
    steps: async (d) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1500);
      const moduleId = (await page_evaluate(d, () =>
        [...document.querySelectorAll("[data-lelu-module-pin]")].map((el) => el.getAttribute("data-lelu-module-pin")),
      ))[0];
      if (moduleId) {
        await d.tap(`[data-lelu-module-pin="${moduleId}"]`);
        await wait(1000);
      }
      const pinned = (await d.layout()).filter((e) => e.pinned);
      return d.shot("13-pinned-module", {
        moduleId,
        pressed: moduleId
          ? await page_evaluate(d, (id) => document.querySelector(`[data-lelu-module-pin="${id}"]`)?.getAttribute("aria-pressed"), moduleId)
          : null,
        pinned: pinned.map((e) => `${e.moduleId}@${e.rect.x},${e.rect.y}`),
      });
    },
  },
  {
    name: "manual",
    steps: async (d, page) => {
      await d.ensureRail();
      await d.travel("files");
      await wait(1500);
      const moduleId = (await page_evaluate(d, () =>
        [...document.querySelectorAll("[data-lelu-module-chrome]")].map((el) => el.getAttribute("data-lelu-module-chrome")),
      ))[0];
      if (moduleId) {
        const box = await page.locator(`[data-lelu-module-chrome="${moduleId}"]`).first().boundingBox();
        if (box) {
          const from = { x: box.x + Math.min(50, Math.max(16, box.width / 2)), y: box.y + box.height / 2 };
          await page.mouse.move(from.x, from.y);
          await page.mouse.down();
          await page.mouse.move(from.x + 28, from.y + 52, { steps: 12 });
          await page.mouse.up();
          await wait(1200);
        }
      }
      const manual = (await d.layout()).filter((e) => e.manual);
      return d.shot("14-manual-module", { moved: moduleId, manual: manual.map((e) => `${e.moduleId}@${e.rect.x},${e.rect.y}`) });
    },
  },
  {
    name: "chat",
    steps: async (d) => {
      await d.ensureRail();
      const railBefore = await page_evaluate(d, () => document.querySelectorAll("[data-spatial-nav]").length);
      await d.tap('[data-spatial-control="chat"]');
      await wait(1500);
      const typed = `Mission 5.2 check ${TAG}`;
      await d.fill("textarea", typed);
      await d.press("textarea", "Enter");
      await wait(2000);
      const withChat = await page_evaluate(d, () => document.querySelectorAll("[data-spatial-nav]").length);
      const text = await page_evaluate(d, () => document.body.textContent || "");
      return d.shot("15-chat-during-navigation", {
        railBefore,
        railWithChat: withChat,
        typedVisible: text.includes(typed),
        chatOpen: await page_evaluate(d, () => document.querySelectorAll("textarea").length),
      });
    },
  },
  {
    name: "studio",
    steps: async (d) => {
      await d.ensureRail();
      const ms = await d.travel("studio", 45000);
      await wait(2000);
      return d.shot("16-creation-studio", { travelMs: ms, scene: await page_evaluate(d, () => document.body.dataset.spatialScene) });
    },
  },
];

function page_evaluate(_driver, fn, arg) {
  // The driver closes over the page; scenarios need page.evaluate too.
  return pageRef.evaluate(fn, arg);
}
let pageRef = null;

const CORE = ["shell", "ring", "destination"];
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const chosen = ONLY.length
  ? scenarios.filter((s) => ONLY.includes(s.name))
  : SET === "core"
    ? scenarios.filter((s) => CORE.includes(s.name))
    : scenarios;

for (const scenario of chosen) {
  const outcome = await runScenario(scenario.name, async (d, page) => {
    pageRef = page;
    return scenario.steps(d, page);
  });
  if (!outcome.ok) report.failures.push(outcome);
}

writeFileSync(join(MEASURE, `capture-${TAG}.json`), JSON.stringify(report, null, 2));
log(
  JSON.stringify(
    {
      viewport: TAG,
      shots: report.shots.map((s) => s.file),
      failures: report.failures,
    },
    null,
    1,
  ),
);
