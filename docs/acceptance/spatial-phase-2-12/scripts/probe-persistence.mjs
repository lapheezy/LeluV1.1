/**
 * Mission 5.3 — portal persistence probe.
 *
 * Reproduces (or refutes) the Mission 5.2 observation that the portal key was
 * never written after mount. It drives the REAL DOM channel the agent tool
 * uses (`lelu-portal-create` → `lelu-portal-created`), then reads the actual
 * browser storage, reloads, and reads it again.
 *
 *   node docs/acceptance/spatial-phase-2-12/scripts/probe-persistence.mjs
 *
 * Requires the dev server (BASE) and the Chromium from the 5.2 harness.
 * Prints a JSON report and writes it under measurements/.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const CHROME =
  process.env.CHROME ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
const BASE = process.env.BASE ?? "http://127.0.0.1:3013/";
const OUT =
  process.env.OUT ?? "docs/acceptance/spatial-phase-2-12/measurements/persistence-probe.json";
const KEY = "lelu.lelu.spatial.portals.v1";

const ARGS = [
  "--no-sandbox",
  "--headless=new",
  "--disable-dev-shm-usage",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-features=CalculateNativeWinOcclusion",
  "--enable-unsafe-swiftshader",
];

async function waitForServer(url, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return Date.now() - started;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} never became ready`);
}

function report(label, value) {
  console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

const bootMs = await waitForServer(BASE);
report("server_ready_ms", bootMs);

const VP = process.env.VP ?? "1440x900";
const [vpWidth, vpHeight] = VP.split("x").map((value) => Number(value));
const mobile = Boolean(process.env.MOBILE);

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const context = await browser.newContext({
  viewport: { width: vpWidth, height: vpHeight },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(7000);

const beforeMount = await page.evaluate((key) => {
  const writeProbe = (() => {
    try {
      localStorage.setItem("lelu.__probe", "1");
      const seen = localStorage.getItem("lelu.__probe");
      localStorage.removeItem("lelu.__probe");
      return { writable: true, roundTrip: seen === "1" };
    } catch (error) {
      return { writable: false, error: String(error) };
    }
  })();
  return {
    leluKeys: Object.keys(localStorage).filter((entry) => entry.startsWith("lelu.")),
    portalKeys: Object.keys(localStorage).filter((entry) => entry.includes("portal")),
    portalRaw: localStorage.getItem(key),
    storage: writeProbe,
  };
}, KEY);
report("before_create", beforeMount);

const created = await page.evaluate(
  async ({ key }) => {
    const requestId = `probe-${Math.random().toString(36).slice(2, 8)}`;
    const result = await new Promise((resolve) => {
      const onReply = (event) => {
        if (event.detail?.requestId !== requestId) return;
        window.removeEventListener("lelu-portal-created", onReply);
        resolve(event.detail);
      };
      window.addEventListener("lelu-portal-created", onReply);
      window.dispatchEvent(
        new CustomEvent("lelu-portal-create", {
          detail: { destination: "studio", label: "Probe atelier", requestId },
        }),
      );
      setTimeout(() => resolve({ timeout: true }), 8000);
    });
    return { requestId, result, portalRaw: localStorage.getItem(key) };
  },
  { key: KEY },
);
report("created", {
  requestId: created.requestId,
  ok: created.result?.ok,
  reason: created.result?.reason,
  portal: created.result?.portal,
  rawPresent: typeof created.portalRaw === "string",
  rawLength: created.portalRaw?.length ?? 0,
});

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const afterReload = await page.evaluate((key) => {
  const raw = localStorage.getItem(key);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = "unparsable";
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.portals ?? [];
  return {
    portalRaw: raw,
    count: Array.isArray(list) ? list.length : 0,
    ids: Array.isArray(list) ? list.map((portal) => portal?.id) : [],
    destination: Array.isArray(list)
      ? list.filter((portal) => portal?.label === "Probe atelier").map((portal) => portal.destination)
      : [],
    duplicates: Array.isArray(list)
      ? list.length - new Set(list.map((portal) => portal?.id)).size
      : 0,
  };
}, KEY);
report("after_reload", { ...afterReload, portalRaw: afterReload.portalRaw?.slice(0, 120) });

const payload = {
  at: new Date().toISOString(),
  base: BASE,
  viewport: VP,
  mobile,
  key: KEY,
  bootMs,
  beforeMount,
  created: {
    requestId: created.requestId,
    ok: created.result?.ok,
    reason: created.result?.reason,
    portal: created.result?.portal,
    rawPresent: typeof created.portalRaw === "string",
    rawLength: created.portalRaw?.length ?? 0,
  },
  afterReload: {
    count: afterReload.count,
    ids: afterReload.ids,
    probeDestinations: afterReload.destination,
    duplicates: afterReload.duplicates,
    rawPrefix: afterReload.portalRaw?.slice(0, 200) ?? null,
  },
  errors: errors.slice(0, 20),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`);
report("wrote", OUT);

await browser.close();
