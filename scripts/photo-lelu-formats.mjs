/**
 * LÉLU — a photo of her in every format, in the running app.
 * Looks (gothic, earthy) × forms (embodied, hologram) × framings (full,
 * face), photographed on the companion overlay over the live app, plus
 * the Avatar panel's Live LÉLU. Writes docs/evidence/lelu-formats/<stamp>/
 * and a contact sheet (sheet.jpg) labelled with what each photo is.
 * Usage: node scripts/photo-lelu-formats.mjs [baseUrl]
 */
import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = path.join("docs", "evidence", "lelu-formats", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
const dismiss = () => page.evaluate(() => [...document.querySelectorAll("[data-lelu-signin-gate] button")].find((b) => b.textContent.trim() === "Continue")?.click());
for (let i = 0; i < 16; i += 1) { await dismiss(); await page.waitForTimeout(500); }

const set = (look, form, framing, size) => page.evaluate(async ({ look, form, framing, size }) => {
  const { default: C } = await import("/src/core/avatar/CompanionStore.ts");
  const { default: L } = await import("/src/core/avatar/LeluCharacterStore.ts");
  C.getInstance().setEnabled(true);
  C.getInstance().setSize(size);
  C.getInstance().setFraming(framing);
  C.getInstance().placeByUser(0.5, 0.5);
  L.getInstance().setLook(look);
  L.getInstance().setForm(form);
}, { look, form, framing, size });
const state = () => page.locator("[data-testid=lelu-companion-character]").evaluate((c) => ({ ...c.dataset })).catch(() => null);

const photos = [];
for (const look of ["gothic", "earthy"]) {
  for (const form of ["embodied", "hologram"]) {
    for (const framing of ["full", "face"]) {
      await set(look, form, framing, "large");
      const settled = async () => {
        const s = await state();
        return s && s.ready === "true" && s.look === look && s.framing === framing && Math.abs(Number(s.holo) - (form === "hologram" ? 1 : 0)) < 0.05;
      };
      for (let i = 0; i < 40 && !(await settled()); i += 1) await page.waitForTimeout(500);
      await page.waitForTimeout(1200);
      await dismiss();
      const box = await page.locator("[data-testid=lelu-companion-figure]").boundingBox();
      const file = path.join(OUT, `${look}-${form}-${framing}.png`);
      await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 20), width: box.width + 40, height: box.height + 40 }, timeout: 180_000 });
      const s = await state();
      photos.push({ file, label: `${look} · ${form} · ${framing}`, ok: Boolean(await settled()), frames: s?.frames });
      console.log(`${(await settled()) ? "OK " : "BAD"} ${look} ${form} ${framing} frames=${s?.frames}`);
    }
  }
}
// The Avatar panel's Live LÉLU, and the whole screen with her over the app.
await set("gothic", "embodied", "full", "medium");
await page.evaluate(async () => { const { default: C } = await import("/src/core/avatar/CompanionStore.ts"); C.getInstance().placeByUser(0.82, 0.25); });
await page.evaluate(async () => { const { default: B } = await import("/src/core/cognition/UIActionBus.ts"); B.getInstance().dispatch({ type: "open_panel", target: "avatar", reason: "photos", initiatedBy: "user" }); });
await page.waitForTimeout(8000); await dismiss();
const panelFile = path.join(OUT, "avatar-panel-live.png");
await page.screenshot({ path: panelFile, timeout: 180_000 });
photos.push({ file: panelFile, label: "Avatar panel · Live LÉLU + companion", ok: true });

// Contact sheet.
const W = 300, H = 440;
const tiles = await Promise.all(photos.map(async (p) => {
  const img = await sharp(p.file).resize(W, H, { fit: "contain", background: "#111" }).toBuffer();
  const svg = Buffer.from(`<svg width="${W}" height="28"><rect width="100%" height="100%" fill="#000"/><text x="8" y="19" font-family="sans-serif" font-size="15" fill="${p.ok ? "#9f9" : "#f88"}">${p.label}</text></svg>`);
  return sharp({ create: { width: W, height: H + 28, channels: 3, background: "#000" } }).composite([{ input: img, top: 0, left: 0 }, { input: svg, top: H, left: 0 }]).png().toBuffer();
}));
const cols = 5;
const rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: cols * W, height: rows * (H + 28), channels: 3, background: "#222" } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * (H + 28) })))
  .jpeg({ quality: 84 })
  .toFile(path.join(OUT, "sheet.jpg"));
console.log("errors", JSON.stringify(errors), "→", OUT);
await browser.close();
process.exit(photos.every((p) => p.ok) && errors.length === 0 ? 0 : 1);
