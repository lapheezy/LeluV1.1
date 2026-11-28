/**
 * Reference-to-render acceptance, in the running app (Chromium, SwiftShader).
 *
 * Proves: the dev server serves the local registry and images; the world
 * editor discovers references for the active world and by search; a
 * reference plate draws the owner's original image (decoded, cropped) and
 * changes the rendered pixels; a palette taken from a reference changes
 * the world; an unresolved reference shows as missing, never substituted;
 * LÉLU's reference tools answer from the same registry; and a production
 * build carries no reference image or registry.
 * Writes docs/missions/references/verify-references.json (text only); screenshots,
 * which show the owner's images, go to the Git-ignored reference/_acceptance/.
 *
 *   npx tsx scripts/references/build-registry.ts && node scripts/references/verify-references.mjs
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { launch, track } from "../evolution/harness.mjs";

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5173/";
// Screenshots show the owner's copyrighted references: they stay in the Git-ignored reference/ folder.
const OUT = "reference/_acceptance";
const REPORT = "docs/missions/references";
await mkdir(OUT, { recursive: true });
await mkdir(REPORT, { recursive: true });
const results = [];
const errors = [];
const check = (id, name, ok, detail = "", evidence = "browser-rendered") => {
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  results.push({ id, name, status: ok ? "VERIFIED" : "FAILED", evidence, detail: d });
  console.log(`${ok ? "✓" : "✗"} [${id}] ${name}${d ? ` — ${d.slice(0, 220)}` : ""}`);
};
let n = 0;
const shot = async (page, name) => page.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png` });
async function diff(a, b) {
  const [x, y] = await Promise.all([a, b].map((buf) => sharp(buf).resize(320, 200, { fit: "fill" }).raw().toBuffer()));
  let k = 0;
  for (let i = 0; i < x.length; i += 3) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 40) k++;
  return +(k / (x.length / 3)).toFixed(4);
}
const click = (p, s) => p.evaluate((s) => document.querySelector(s)?.dispatchEvent(new MouseEvent("click", { bubbles: true })), s);
const store = (p, fn, arg) => p.evaluate(async ([src, arg]) => { const S = await import("/src/core/worlds/WorldStore.ts"); return new Function("S", "arg", `return (${src})(S, arg)`)(S, arg); }, [fn.toString(), arg]);

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  track(page, errors);

  // Open a thread with a world.
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) {
    if (await page.locator("[data-lelu-signin-gate]").count()) await page.evaluate(() => { const b = [...document.querySelectorAll("[data-lelu-signin-gate] button")]; (b.find((e) => /continue/i.test(e.textContent || "")) ?? b.at(-1))?.click(); });
    if (await page.locator("[data-lelu-home]").count()) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  // 1. Served locally by the dev server.
  const served = await page.evaluate(async () => {
    const r = await fetch("/reference/registry.json", { cache: "no-store" });
    const reg = await r.json();
    const img = await fetch(reg.entries.find((e) => e.code === "U-04").url);
    return { status: r.status, entries: reg.entries.length, unresolved: reg.unresolved.length, totals: reg.totals, imgType: img.headers.get("content-type"), imgBytes: (await img.arrayBuffer()).byteLength };
  }).catch((e) => ({ error: String(e) }));
  check("R1", "the dev server serves the local registry and the original images", served.status === 200 && served.entries > 0 && /^image\//.test(served.imgType ?? "") && served.imgBytes > 10000, served);

  const title = `References ${Date.now() % 1e5}`;
  await page.evaluate(async (t) => {
    localStorage.removeItem("lelu.worlds.v1");
    const MC = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
    const c = MC.create(t);
    MC.addMessage(c.id, { id: `${c.id}-a`, role: "user", text: "Build the volcanic world from my references.", timestamp: Date.now() - 2000, source: "local" });
    MC.addMessage(c.id, { id: `${c.id}-b`, role: "assistant", text: "Here it is, with your lava-duel reference beside it.", timestamp: Date.now() - 1000, source: "local" });
    const S = await import("/src/core/worlds/WorldStore.ts");
    S.createWorld(["volcano"]);
  }, title);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForSelector(`button[aria-label="Open ${title}"]`, { state: "attached" });
  await click(page, `button[aria-label="Open ${title}"]`);
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('[data-lelu-universe-window] [data-lelu-stage="thread"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForSelector("[data-thread-stage]");
  await click(page, '[data-variant-tab="freestyle"]');
  await page.waitForSelector("[data-world] canvas", { timeout: 60000 });
  await page.waitForTimeout(4500);

  // 2. Discovery in the world builder.
  await click(page, "[data-world-toggle]");
  await page.waitForSelector('[data-ref-library="loaded"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const disc = await page.evaluate(() => ({ usable: document.querySelector("[data-ref-library]").dataset.refUsable, unresolved: document.querySelector("[data-ref-library]").dataset.refUnresolved, results: [...document.querySelectorAll("[data-ref-result]")].map((e) => e.dataset.refResult) }));
  check("R2", "the world editor discovers the references that inform the active world's family (volcano)", disc.results.includes("owner:U-04") && disc.results.includes("atlas:I-35") && +disc.usable > 0, disc);
  await shot(page, "editor-references-for-volcano");

  await page.fill("[data-ref-search]", "boondocks");
  await page.waitForTimeout(900);
  const search = await page.evaluate(() => [...document.querySelectorAll("[data-ref-result]")].map((e) => e.dataset.refResult));
  check("R3", "searching 'boondocks' finds the owner's Boondocks references and nothing else", search.length >= 2 && search.every((r) => /U-07|U-08/.test(r)), search);
  await shot(page, "editor-search-boondocks");
  await page.fill("[data-ref-search]", "");
  await page.waitForTimeout(900);

  // 3. A plate draws the original image and changes pixels.
  await click(page, "[data-world-toggle]");
  await page.waitForTimeout(600);
  const before = await page.screenshot();
  await click(page, "[data-world-toggle]");
  await page.waitForTimeout(500);
  await click(page, '[data-ref-plate-add="owner:U-04"]');
  await page.waitForSelector('[data-ref-plate="owner:U-04"][data-ref-state="loaded"]', { timeout: 60000 }).catch(async () => console.log('DEBUG', JSON.stringify(await page.evaluate(() => ({ plates: [...document.querySelectorAll('[data-ref-plate]')].map((e) => e.outerHTML.slice(0, 300)), layers: [...document.querySelectorAll('[data-layer]')].map((e) => e.dataset.layer), world: document.querySelector('[data-world]')?.dataset.worldMode, editorBtn: !!document.querySelector('[data-ref-plate-add]') })))));
  await click(page, "[data-world-toggle]");
  await page.waitForTimeout(900);
  const plate = await page.evaluate(() => { const im = document.querySelector('[data-ref-plate="owner:U-04"] img'); return { natural: [im.naturalWidth, im.naturalHeight], src: im.getAttribute("src"), shown: im.getBoundingClientRect().width > 50 }; });
  const afterPlate = await page.screenshot();
  const dPlate = await diff(before, afterPlate);
  check("R4", "a reference plate decodes the owner's original image (full resolution, cropped by its record) and changes the rendered scene", plate.natural[0] === 1170 && plate.shown && dPlate > 0.02, { ...plate, pixelsChanged: dPlate });
  await shot(page, "plate-U-04-in-volcano-world");

  // 4. Palette from a reference.
  await click(page, "[data-world-toggle]");
  await page.waitForTimeout(500);
  const palBefore = await store(page, (S) => S.activeWorld().palette);
  await page.fill("[data-ref-search]", "twin suns");
  await page.waitForSelector('[data-ref-palette="owner:U-05"]', { timeout: 15000 });
  await click(page, '[data-ref-palette="owner:U-05"]');
  await page.waitForFunction(() => /Palette taken from U-05|not available/.test(document.querySelector("[data-ref-note]")?.textContent ?? ""), null, { timeout: 60000 }).catch(async () => console.log("DEBUG palette", await page.evaluate(() => ({ note: document.querySelector("[data-ref-note]")?.textContent, editor: !!document.querySelector("[data-world-editor]"), btn: !!document.querySelector('[data-ref-palette="owner:U-05"]'), results: [...document.querySelectorAll("[data-ref-result]")].map((e) => e.dataset.refResult) }))));
  const palAfter = await store(page, (S) => S.activeWorld().palette);
  await click(page, "[data-world-toggle]");
  await page.waitForTimeout(3500);
  const afterPal = await page.screenshot();
  const dPal = await diff(afterPlate, afterPal);
  check("R5", "taking the palette from a reference (U-05, twin suns) recolours the world", JSON.stringify(palBefore) !== JSON.stringify(palAfter) && dPal > 0.02, { before: palBefore.sky, after: palAfter.sky, accent: palAfter.accent, pixelsChanged: dPal });
  await shot(page, "palette-from-U-05");

  // 5. An unresolved reference is shown as missing, not substituted.
  await store(page, (S) => { const w = S.activeWorld(); S.applyEdit(w.id, { op: "add", layer: { id: "ref-missing", slot: "graphics2d", kind: "reference-plate", params: { ref: "atlas:II-01", x: 26, y: 70, w: 22 } } }); });
  await page.waitForSelector('[data-ref-plate="atlas:II-01"]', { timeout: 15000 });
  const miss = await page.evaluate(() => { const el = document.querySelector('[data-ref-plate="atlas:II-01"]'); return { state: el.dataset.refState, text: el.textContent, img: !!el.querySelector("img") }; });
  check("R6", "an unresolved reference (II-01, blocked) renders as 'not available', with no stand-in image", miss.state === "missing" && !miss.img, miss);
  await shot(page, "unresolved-II-01-shown-missing");

  // 6. LÉLU's tools answer from the same registry (browser runtime).
  const tools = await page.evaluate(async () => {
    const T = await import("/src/core/references/ReferenceTools.ts");
    const run = (id, a) => T.REFERENCE_EXECUTORS.find((e) => e.id === id).run(a);
    const a = await run("references.search", { franchise: "Star Wars" });
    const b = await run("references.for", { target: "planned:retro-video-store" });
    const c = await run("references.apply", { ref: "owner:U-01", as: "plate" });
    return { search: a.ok && /U-04/.test(a.content) && /U-05/.test(a.content), forTarget: b.ok && /planned, not built yet/.test(b.content) && /U-01/.test(b.content), apply: c.ok, applyText: c.content };
  });
  await page.waitForSelector('[data-ref-plate="owner:U-01"][data-ref-state="loaded"]', { timeout: 20000 }).catch(() => {});
  const appliedLoaded = await page.locator('[data-ref-plate="owner:U-01"][data-ref-state="loaded"]').count();
  check("R7", "LÉLU's reference tools search, report planned targets, and place a plate in the active world", tools.search && tools.forTarget && tools.apply && appliedLoaded === 1, { ...tools, appliedLoaded });
  await shot(page, "tool-placed-U-01");

  // 7. Persistence: plates and palette survive reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  const persisted = await page.evaluate(async () => { const S = await import("/src/core/worlds/WorldStore.ts"); const w = S.activeWorld(); return w.layers.filter((l) => l.kind === "reference-plate").map((l) => l.params.ref); });
  check("R8", "reference plates are saved with the world (by reference id, not by copying the image)", ["owner:U-04", "atlas:II-01", "owner:U-01"].every((r) => persisted.includes(r)), persisted);
  await ctx.close();
} finally {
  await browser.close();
}

// 8. Production builds carry none of it.
const walk = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? walk(`${d}/${x.name}`) : [`${d}/${x.name}`])) : []);
const dist = walk("dist");
const leaked = dist.filter((f) => /\/reference\//.test(f) || /\/(I|II|III|U)-\d{2}\.(png|jpe?g|webp|gif)$/.test(f) || /registry\.json$/.test(f));
check("R9", "the production build contains no reference image and no registry", dist.length > 0 && leaked.length === 0, { distFiles: dist.length, leaked }, "build-output");

const own = errors.filter((e) => /reference|Reference/i.test(e) && !/404/.test(e));
check("R10", "no page errors from the reference integration", own.length === 0, own.slice(0, 4).join(" | "));
await writeFile(`${REPORT}/verify-references.json`, `${JSON.stringify({ at: new Date().toISOString(), results }, null, 1)}\n`);
const failed = results.filter((r) => r.status === "FAILED").length;
console.log(`\n${results.length - failed}/${results.length} verified, ${failed} failed`);
process.exit(failed ? 1 : 0);
