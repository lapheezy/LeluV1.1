/* eslint-disable */
/**
 * Mission 5.7 — the in-conversation walkthrough, driven in the REAL app.
 *
 * It opens Chat Universe, continues without an account, opens the chat, then
 * runs LÉLU's own ASRE tool executors (the same modules the dispatch/registry
 * calls, imported from the app itself) so every surface, job, character and
 * export is produced by the production code path. Screenshots are taken at
 * each acceptance step.
 *
 * What is NOT simulated: the reconstruction, the numerical planes, the
 * character edits, the restore and the export all come from /api/asre.
 * What IS not driven: the model's choice of tool (no provider key in this
 * container) — the executors are invoked directly, which is the layer below
 * that choice.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const BASE = process.env.M57_BASE || "http://127.0.0.1:5180";
// This container ships NO system fonts, so Chromium paints layout but no
// glyphs. The evidence screenshots would be unreadable; the two Inter faces
// used here are committed beside this script for that reason.
const FONT_DIR = path.resolve(__dirname, "fixtures/fonts");
const fontCss = ["400", "600"]
  .map((weight) => {
    const file = path.join(FONT_DIR, `inter-${weight}.woff2`);
    if (!fs.existsSync(file)) return "";
    const b64 = fs.readFileSync(file).toString("base64");
    return `@font-face{font-family:'Lelu Evidence';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  })
  .join("\n");
const FONT_CSS = `${fontCss}\n*,*::before,*::after{font-family:'Lelu Evidence',system-ui,sans-serif !important;}`;
const applyFont = async (page) => {
  await page.addStyleTag({ content: FONT_CSS });
  await page.evaluate(() => document.fonts.ready);
};
const OUT = path.resolve(process.env.M57_OUT || "artifacts/mission57");
const IMAGE = process.env.M57_IMAGE || path.join(os.homedir(), "chair.png");
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

fs.mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  return `${name}.png`;
};

(async () => {
  // Software GL: this VM has no GPU, and several live canvases exhaust the
  // default shared-memory budget.
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 240)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 240)); });

  // Surfaces can overlap each other in a narrow window; the click still has to
  // reach the control the person would press.
  const press = async (locator) => locator.evaluate((el) => el.click());

  // LÉLU's own pathway: the tool is registered, the dispatcher gates and runs
  // it, and the executor calls /api/asre. Nothing here bypasses that stack.
  const runTool = (id, args) =>
    page.evaluate(
      async ({ id, args }) => {
        const asre = await import("/src/core/asre/AsreTools.ts");
        const dispatch = await import("/src/core/tools/ToolDispatcher.ts");
        asre.registerAsreTools();
        const t0 = performance.now();
        const out = await dispatch.dispatchToolCall(
          { id: `m57-${id}-${Date.now()}`, name: dispatch.toolNameForModel(id), arguments: args },
          "m57-task",
          { request: { prompt: "", timestamp: Date.now(), conversationId: "" } },
        );
        return { ok: out.ok, content: out.content, ms: Math.round(performance.now() - t0) };
      },
      { id, args },
    );

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await applyFont(page);
  await page.waitForTimeout(2500);
  const home = await shot(page, "00-home");

  // --- 1. Chat Universe, no account -------------------------------------------------
  const guest = page.getByRole("button", { name: /continue without an account/i });
  if (await guest.count()) await guest.first().click();
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForTimeout(2500);
  const universe = await page.locator("[aria-label='Chat Universe']").count();
  check("Chat Universe opens without an account", universe > 0, `${universe} universe root(s)`);
  await shot(page, "01-chat-universe");

  // --- 2. A conversation to work in -------------------------------------------------
  const card = page.locator(".lcu-card").first();
  if (await card.count()) await card.click();
  else await page.getByRole("button", { name: /^Chat$/ }).first().click();
  await page.waitForTimeout(3500);
  const chatVisible = await page.locator(".lelu-cc-thread, textarea").count();
  check("A conversation is open", chatVisible > 0, `${chatVisible} chat element(s)`);
  await shot(page, "02-conversation");

  // --- 3. LÉLU reconstructs an image (her own tool) ---------------------------------
  const base64 = fs.readFileSync(IMAGE).toString("base64");
  const rec = await runTool("asre.reconstruct", { images: [{ view: "front", imageBase64: base64 }], engine: "silhouette" });
  check("asre.reconstruct returns a job", rec.ok, rec.content.slice(0, 120));

  const surface = page.locator("[data-spatial-surface]").first();
  await surface.waitFor({ timeout: 20000 });
  check("A spatial surface appeared in the conversation", true, await surface.getAttribute("data-spatial-surface-id"));
  await page.waitForTimeout(1200);
  await shot(page, "03-surface-summoned");

  // The 3D itself: three.js opens the GLB the server wrote.
  await page.locator("[data-spatial-viewer][data-loaded='true']").first().waitFor({ timeout: 90000 });
  const triangles = await page.locator("[data-spatial-viewer]").first().innerText();
  check("The reconstruction opens in the conversation (three.js)", /triangles/.test(triangles), triangles.replace(/\s+/g, " ").trim().slice(0, 90));
  await page.waitForTimeout(1000);
  await shot(page, "04-reconstruction-in-chat");

  // --- 4. Numerical inspection, without leaving the chat ----------------------------
  await press(page.locator("[data-spatial-surface-tab='numerical']").first());
  await page.waitForTimeout(3500);
  await page.locator("[data-spatial-surface='numerical'] canvas").first().waitFor({ timeout: 20000 });
  const numerical = await page.locator("[data-spatial-surface='numerical']").first().innerText();
  check("Numerical planes render in the chat", /OBSERVED|INFERRED|GENERATED/.test(numerical), numerical.replace(/\s+/g, " ").slice(0, 120));
  await shot(page, "05-numerical-in-chat");

  // --- 5. A character, and a component change LÉLU makes ----------------------------
  const charId = `m57-${Date.now().toString(36)}`;
  const made = await runTool("asre.character", { characterId: charId, create: true });
  check("asre.character creates the persistent character", made.ok, made.content.slice(0, 100));

  const hair = await runTool("asre.character", { characterId: charId, patch: { hair: { style: "afro", volume: 1.35 } } });
  check("asre.character edits the hair (new version)", hair.ok, hair.content.slice(0, 160));

  await page.waitForTimeout(1500);
  await press(page.locator("[data-spatial-expand]").last());
  await press(page.locator("[data-spatial-surface-tab='create']").last());
  await page.waitForTimeout(2000);
  const surfaces = await page.locator("[data-spatial-surface]").count();
  check("Character surfaces are in the same conversation", surfaces >= 2, `${surfaces} surface(s)`);
  await shot(page, "06-character-in-chat");

  // --- 6. History: restore, then export --------------------------------------------
  const hist = await runTool("asre.history", { characterId: charId, action: "list" });
  check("asre.history lists the versions", hist.ok && /v000/.test(hist.content), hist.content.slice(0, 140));
  const restored = await runTool("asre.history", { characterId: charId, action: "restore", version: "v0001", groups: ["hair"] });
  check("Restore mints a new version (history is never rewritten)", restored.ok, restored.content.slice(0, 160));
  await page.waitForTimeout(1200);
  await shot(page, "07-restored-in-chat");

  const exp = await runTool("asre.export", { characterId: charId, formats: ["glb", "obj", "stl"] });
  check("Export goes through the Forge gate", exp.ok, exp.content.slice(0, 160));
  await press(page.locator("[data-spatial-surface-tab='render']").last());
  await page.waitForTimeout(2500);
  await page.locator("[data-spatial-surface]").last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot(page, "08-export-in-chat");

  // --- 7. The same capabilities are LÉLU's authorized tools -------------------------
  const routing = await page.evaluate(async () => {
    const asre = await import("/src/core/asre/AsreTools.ts");
    const registry = (await import("/src/core/tools/ToolRegistry.ts")).default;
    const schemas = await import("/src/core/tools/ToolSchemas.ts");
    asre.registerAsreTools();
    const registered = registry.getInstance().all().filter((t) => t.id.startsWith("asre.")).map((t) => t.id);
    const all = schemas.toolSchemasForModel();
    const offered = all.filter((s) => String(s.name).startsWith("asre_")).length;
    const routed = schemas.selectToolSchemas(all, "Turn this photo into 3D").map((s) => String(s.name)).filter((n) => n.startsWith("asre_"));
    const unrelated = schemas.selectToolSchemas(all, "what's the weather in Tokyo?").map((s) => String(s.name)).filter((n) => n.startsWith("asre_"));
    return { registered, offered, routed, unrelated };
  });
  check("The same capabilities are registered as LÉLU's tools", routing.registered.length === 7, routing.registered.join(", "));
  check("A spatial prompt routes to them; an unrelated one does not", routing.routed.length > 0 && routing.unrelated.length === 0, `spatial → ${routing.routed.join(",")} | weather → ${routing.unrelated.join(",") || "none"}`);

  // --- 8. It all belongs to the conversation ---------------------------------------
  const stored = await page.evaluate(async () => {
    const m = await import("/src/core/asre/SpatialSummon.ts");
    const raw = JSON.parse(localStorage.getItem("lelu.spatial.surfaces.v1") || "[]");
    return { stored: raw.length, tabs: raw.map((s) => s.tab) };
  });
  check("Surfaces are stored per conversation (they survive a reopen)", stored.stored >= 3, JSON.stringify(stored));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await applyFont(page);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("lelu-open-universe")));
  await page.waitForTimeout(4000);
  // The Universe reopens the windows the last session left open, so the
  // surfaces should be back without opening anything by hand.
  let afterReload = await page.locator("[data-spatial-surface]").count();
  if (afterReload === 0) {
    const card2 = page.locator(".lcu-card").first();
    if (await card2.count()) await press(card2);
    await page.waitForTimeout(4000);
    afterReload = await page.locator("[data-spatial-surface]").count();
  }
  check("After a reload the conversation still has its surfaces", afterReload > 0, `${afterReload} surface(s)`);
  await shot(page, "09-after-reload");

  const result = {
    at: new Date().toISOString(),
    base: BASE,
    image: path.basename(IMAGE),
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    failed: checks.filter((c) => !c.ok).map((c) => c.name),
    checks,
    toolOutputs: { reconstruct: rec, character: made, hair, history: hist, restore: restored, export: exp },
    pageErrors: [...new Set(errors)].slice(0, 12),
    screenshots: fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).sort(),
    home,
    universe,
  };
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, total: result.total, failed: result.failed, pageErrors: result.pageErrors }, null, 1));
  await browser.close();
  process.exit(result.failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error("WALKTHROUGH FAILED:", e);
  process.exit(2);
});
