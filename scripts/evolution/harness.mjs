/**
 * Chat Universe evolution — shared Playwright harness.
 * Drives the REAL app (vite dev or preview). Seeds a conversation through
 * the app's own MultiChatStore (no mocked UI), dismisses the sign-in gate
 * the way a person would, and saves screenshots under public/evolution/
 * so the app's own Build Trail can show them.
 */
import { chromium, devices } from "playwright";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
export const OUT = path.resolve("public/evolution");

export async function launch() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  return chromium.launch({ executablePath: "/opt/pw-browsers/chromium", ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" } } : {}), args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

export async function desktop(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  return ctx;
}
export async function iphone(browser) {
  return browser.newContext({ ...devices["iPhone 15 Pro"] });
}

export function track(page, sink) {
  page.on("pageerror", (e) => sink.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") sink.push(`console: ${m.text().slice(0, 200)}`); });
}

export async function boot(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const gate = page.locator("[data-lelu-signin-gate]");
  for (let i = 0; i < 30; i += 1) {
    if ((await gate.count()) > 0) break;
    if ((await page.locator("[data-lelu-home]").count()) > 0 && i > 8) break;
    await page.waitForTimeout(500);
  }
  if ((await gate.count()) > 0) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")];
      (b.find((el) => /continue/i.test(el.textContent || "")) ?? b[b.length - 1])?.click();
    });
    await page.waitForTimeout(800);
  }
  await page.waitForTimeout(1500);
}

/** A real research conversation, written through the app's own store. */
export async function seed(page) {
  return page.evaluate(async () => {
    const { default: Store } = await import("/src/core/multichat/MultiChatStore.ts");
    const s = Store.getInstance();
    const existing = s.list().find((c) => c.title === "Deep-sea bioluminescence");
    if (existing) { s.switchActive(existing.id); return existing.id; }
    const c = s.create("Deep-sea bioluminescence");
    const now = Date.now();
    const msgs = [
      ["user", "Research how deep-sea creatures make light, and why."],
      ["assistant", "## How the deep sea glows\n\nAbout **76%** of ocean animals make their own light. The chemistry is almost always the same pair:\n\n- **Luciferin** — the fuel molecule\n- **Luciferase** — the enzyme that oxidises it\n\n### Why they do it\n1. **Counter-illumination** — matching faint sunlight from above to erase their silhouette.\n2. **Lures** — the anglerfish's esca hosts symbiotic bacteria.\n3. **Burglar alarms** — dinoflagellates flash to attract a predator's predator.\n\n> Coelenterazine, one luciferin, shows up across at least nine phyla — likely acquired through diet.\n\n![Jellyfish](/universe/jellyfish.webp)"],
      ["user", "Compare jellyfish and anglerfish strategies."],
      ["assistant", "| Trait | Jellyfish (*Atolla*) | Anglerfish |\n|---|---|---|\n| Light source | Own photocytes | Symbiotic bacteria |\n| Purpose | Burglar alarm | Lure prey |\n| Colour | Blue | Blue-green |\n\nBoth exploit the fact that **blue light (~470 nm)** travels furthest in seawater.\n\n![Galaxy of plankton](/universe/galaxy.webp)"],
    ];
    msgs.forEach(([role, text], i) => s.addMessage(c.id, { id: `seed-${c.id}-${i}`, role, text, timestamp: now - (msgs.length - i) * 60000, source: "local" }));
    s.switchActive(c.id);
    return c.id;
  });
}

export async function openUniverse(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector(".lcu", { state: "visible", timeout: 15000 });
  await page.waitForTimeout(700);
}

/** Append one entry to the Build Trail manifest the app reads. */
export async function trail(entry) {
  const file = path.join(OUT, "trail.json");
  let data = { entries: [] };
  try { data = JSON.parse(await readFile(file, "utf8")); } catch {}
  data.entries = data.entries.filter((e) => e.id !== entry.id);
  data.entries.push({ ...entry, at: new Date().toISOString() });
  await writeFile(file, JSON.stringify(data, null, 2));
}

export async function shot(page, name) {
  await mkdir(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

/** Open the seeded conversation's window and wait until it is really there. */
export async function openSeededChat(page) {
  for (let i = 0; i < 4; i += 1) {
    await page.locator(".lcu-card", { hasText: "Deep-sea" }).first().click({ timeout: 4000 }).catch(() =>
      page.evaluate(() => [...document.querySelectorAll(".lcu-card")].find((c) => /Deep-sea/.test(c.textContent || ""))?.click()));
    const ok = await page.waitForSelector('[data-lelu-module-window^="chat:"]', { state: "attached", timeout: 3000 }).then(() => true).catch(() => false);
    if (ok) return true;
  }
  return false;
}
