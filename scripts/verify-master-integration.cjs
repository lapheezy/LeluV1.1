/**
 * MASTER INTEGRATION — the merged system working together, in Chromium.
 *
 *   LELU_BASE=http://127.0.0.1:5174/ node scripts/verify-master-integration.cjs <outDir> [desktop|phone]
 *
 * Every request is typed into Chat Universe (mouse + keyboard). Generation
 * routes are aborted and counted (no model may answer). Checks what the
 * merged branches must do TOGETHER:
 *   · research → cited board + mind map rendered INLINE in the reply (Job 2 + Freebuff 520a5d4)
 *   · chart, 3D scene, diagram, editable drawing, film — all inline cards
 *   · a film encoded from its inline card, read back with ffprobe
 *   · a GLB attached in the thread opens in three.js (Freebuff 1ba90af)
 *   · /read a public page as a guest (Freebuff 1ba90af)
 *   · "Large view" windows organised by the Workspace Steward with no
 *     overlap and nothing off screen (chat-universe-evolution)
 *   · Cosmos behind the Universe still there; everything survives reload
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium, devices } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/master-integration");
const MODE = process.argv[3] ?? "desktop";
const SHOTS = path.join(OUT, "screenshots"), FILES = path.join(OUT, "files");
for (const d of [SHOTS, FILES]) fs.mkdirSync(d, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 600) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 260)}` : ""}`); };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${MODE}-${name}.png`), timeout: 90000 }).catch((e) => console.log(`(screenshot ${name} skipped: ${String(e).slice(0, 60)})`));
const ffprobe = (file) => { try { const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,nb_read_frames:format=duration", "-of", "json", file], { encoding: "utf8" })); const v = j.streams.find((x) => x.codec_type === "video"), a = j.streams.find((x) => x.codec_type === "audio"); return { video: v && { codec: v.codec_name, w: v.width, h: v.height, frames: Number(v.nb_read_frames) }, audio: a && { codec: a.codec_name }, duration: Number(j.format.duration) || null }; } catch (e) { return { error: String(e).slice(0, 120) }; } };

async function boot(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 80; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const chat = await page.evaluate(() => { const b = document.querySelector('[data-spatial-control="chat"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (chat) await page.mouse.click(chat.x, chat.y);
  await page.waitForTimeout(2500);
}

/** Type into the conversation window's own composer when one is open, otherwise the Universe composer. */
async function send(page, text) {
  const target = await page.evaluate(() => {
    const visible = (e) => { const r = e.getBoundingClientRect(); if (r.width < 40) return false; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === e || e.contains(hit); };
    const el = [...document.querySelectorAll(".lcu-win-composer textarea")].find(visible) ?? [...document.querySelectorAll(".lcu-input textarea")].find(visible);
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!target) return false;
  await page.mouse.click(target.x, target.y);
  await page.keyboard.type(text, { delay: 1 });
  await page.keyboard.press("Enter");
  return true;
}

async function reply(page, text, timeout = 150_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(800);
    const r = await page.evaluate(async (text) => {
      const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      const c = M.listAll().find((x) => x.messages.some((m) => m.role === "user" && String(m.text).trim() === text));
      if (!c) return null;
      const at = c.messages.map((m) => m.role === "user" && String(m.text).trim() === text).lastIndexOf(true);
      const a = c.messages.slice(at + 1).find((m) => m.role === "assistant" && String(m.text).trim());
      return a && a.activity?.status !== "running" ? { conv: c.id, text: String(a.text), artifacts: (a.activity?.artifacts ?? []).map((x) => x.kind) } : null;
    }, text);
    if (r) return { ms: Date.now() - t0, ...r };
  }
  return { ms: Date.now() - t0, timedOut: true, text: "" };
}

/** What the conversation thread shows right now: inline embeds by medium, rendered state. */
async function threadState(page) {
  return page.evaluate(() => {
    const embeds = [...document.querySelectorAll("[data-lelu-chat-embed]")].map((e) => {
      const canvas = e.querySelector("[data-lelu-scene-renderer] canvas");
      let colours = 0;
      if (canvas) { try { const p = document.createElement("canvas"); p.width = 48; p.height = 27; const g = p.getContext("2d"); g.drawImage(canvas, 0, 0, 48, 27); const d = g.getImageData(0, 0, 48, 27).data; const s = new Set(); for (let i = 0; i < d.length; i += 4) s.add(`${d[i] >> 4}${d[i + 1] >> 4}${d[i + 2] >> 4}`); colours = s.size; } catch {} }
      const r = e.getBoundingClientRect();
      return { medium: e.getAttribute("data-lelu-chat-embed"), diagram: !!e.querySelector("[data-lelu-diagram-rendered] svg"), chart: !!e.querySelector("iframe"), excalidraw: !!e.querySelector(".excalidraw"), film: !!e.querySelector("[data-lelu-film-render],[data-lelu-film-ready]"), sceneColours: colours, width: Math.round(r.width) };
    });
    return { embeds, cards: document.querySelectorAll("[data-lelu-chat-artifact]").length, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const ctx = await browser.newContext(MODE === "phone" ? { ...devices["iPhone 13"] } : { viewport: { width: 1440, height: 900 } });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const model = [];
  await ctx.route(/\/api\/(model|ai|chat)(\/|$|\?)/, (r) => { if (r.request().method() === "GET") return r.continue(); model.push(r.request().url()); r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await boot(page);
  await shot(page, "01-universe");

  const STEPS = MODE === "phone"
    ? [["02-scene", "/scene ocean", "scene3d"], ["03-diagram", "Make an architecture diagram of LÉLU", "diagram"], ["04-chart", "/chart earthquakes", "chart"]]
    : [
      ["02-research", "/research coral reef bleaching", "diagram"],
      ["03-chart", "/chart earthquakes", "chart"],
      ["04-scene", "/scene forest", "scene3d"],
      ["05-diagram", "Make an architecture diagram of LÉLU", "diagram"],
      ["06-sketch", "/sketch evening gown", "drawing"],
      ["07-film", "Make a movie about ocean tides", "video"],
      ["08-read", "/read https://en.wikipedia.org/wiki/Coral_bleaching", null],
    ];
  for (const [id, text, medium] of STEPS) {
    const before = model.length;
    if (!(await send(page, text))) { check(`${id}: composer reachable`, false); continue; }
    const r = await reply(page, text);
    await page.waitForTimeout(medium === "scene3d" ? 6000 : 2500);
    const st = await threadState(page);
    await shot(page, id);
    const hasEmbed = !medium || st.embeds.some((e) => e.medium === medium);
    check(`${id}: “${text}” → executed inline, no model`, !r.timedOut && model.length === before && hasEmbed && (medium !== null || /characters read|read/i.test(r.text)), `${r.ms} ms · embeds [${st.embeds.map((e) => e.medium).join(",")}] · overflow ${st.overflow}px · ${r.text.split("\n")[0].slice(0, 150)}`);
  }
  const st = await threadState(page);
  const by = (m) => st.embeds.filter((e) => e.medium === m);
  if (MODE === "desktop") {
    check("inline diagram rendered by Mermaid (research mind map + architecture)", by("diagram").filter((e) => e.diagram).length >= 2, JSON.stringify(by("diagram")));
    check("inline interactive chart (iframe)", by("chart").some((e) => e.chart));
    check("inline 3D scene renders (non-blank canvas)", by("scene3d").some((e) => e.sceneColours > 8), JSON.stringify(by("scene3d")));
    check("inline Excalidraw editor in the reply", by("drawing").some((e) => e.excalidraw));
  } else {
    check("phone: inline cards fit the screen, no horizontal overflow", st.embeds.every((e) => e.width <= 392) && st.overflow <= 0, JSON.stringify(st.embeds.map((e) => [e.medium, e.width])) + ` overflow ${st.overflow}`);
    check("phone: inline 3D scene renders", by("scene3d").some((e) => e.sceneColours > 8), JSON.stringify(by("scene3d")));
  }

  if (MODE === "desktop") {
    // Film from its inline card
    const render = page.locator("[data-lelu-chat-embed=video] [data-lelu-film-render]").last();
    if (await render.count()) {
      await render.scrollIntoViewIfNeeded().catch(() => {});
      await render.click();
      await page.waitForSelector("[data-lelu-chat-embed=video] [data-lelu-film-ready]", { timeout: 900000 }).catch(() => {});
      const b64 = await page.evaluate(async () => { const v = document.querySelector("[data-lelu-chat-embed=video] [data-lelu-film-ready]"); if (!v) return null; const u = new Uint8Array(await (await fetch(v.src)).arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
      await shot(page, "09-film-inline");
      if (b64) { const f = path.join(FILES, "film-inline.webm"); fs.writeFileSync(f, Buffer.from(b64, "base64")); const p = ffprobe(f); check("film encoded from its inline card (ffprobe)", p.video && p.video.frames >= 515 && p.audio, JSON.stringify(p)); }
      else check("film encoded from its inline card", false, "no video element");
    } else check("film card present inline", false);

    // A GLB attached in the conversation opens in three.js
    const glb = path.resolve("docs/acceptance/mission-open-source-expansion/files/Preset-runway.glb");
    const input = page.locator('.lcu-win-composer input[type=file]').first();
    if ((await input.count()) && fs.existsSync(glb)) {
      await input.setInputFiles(glb);
      await page.waitForTimeout(800);
      await send(page, "Here is the runway model");
      await page.waitForSelector("[data-lelu-model=glb] canvas", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await shot(page, "10-glb-attached");
      check("GLB attached in the thread opens in three.js", (await page.locator("[data-lelu-model=glb] canvas").count()) > 0);
    } else check("GLB attach control in the conversation window", false);

    // Large views + Workspace Steward organisation
    const large = page.locator("[data-lelu-chat-artifact] button", { hasText: "Large view" });
    const n = Math.min(3, await large.count());
    for (let i = 0; i < n; i++) { await large.nth(i).click().catch(() => {}); await page.waitForTimeout(1200); }
    await send(page, "tile my windows");
    await page.waitForTimeout(3500);
    const layout = await page.evaluate(() => {
      const wins = [...document.querySelectorAll("[data-lelu-module-window]")].map((w) => { const r = w.getBoundingClientRect(); return { id: w.getAttribute("data-lelu-module-window"), x: r.left, y: r.top, w: r.width, h: r.height }; }).filter((r) => r.w > 40 && r.h > 40);
      let overlap = 0;
      for (let i = 0; i < wins.length; i++) for (let j = i + 1; j < wins.length; j++) { const a = wins[i], b = wins[j]; const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); overlap = Math.max(overlap, (ix * iy) / Math.min(a.w * a.h, b.w * b.h)); }
      const off = wins.filter((r) => r.x < -1 || r.y < -1 || r.x + r.w > innerWidth + 1 || r.y + r.h > innerHeight + 1).map((r) => r.id);
      return { wins: wins.map((r) => `${r.id} ${Math.round(r.w)}×${Math.round(r.h)}@${Math.round(r.x)},${Math.round(r.y)}`), overlap: Number(overlap.toFixed(3)), off, why: document.querySelector("[data-lelu-steward-why]")?.textContent?.slice(0, 200) ?? null };
    });
    await shot(page, "11-steward-tiled");
    check("Workspace Steward tiles the windows: no overlap, nothing off screen", layout.wins.length >= 2 && layout.overlap <= 0.02 && layout.off.length === 0, JSON.stringify(layout));

    // Cosmos behind the Universe
    await page.locator('button[aria-label="Close Chat Universe"]').first().click().catch(() => {});
    await page.waitForTimeout(2500);
    const cosmos = await page.evaluate(() => ({ canvases: document.querySelectorAll("canvas").length, windows: document.querySelectorAll("[data-lelu-module-window]").length }));
    await shot(page, "12-cosmos");
    check("Cosmos and the open windows are there with the Universe closed", cosmos.canvases > 0, JSON.stringify(cosmos));
  }

  // Survives a reload
  const before = await page.evaluate(async () => { const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance(); const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); return { artifacts: S.list().length, messages: M.listAll().reduce((a, c) => a + c.messages.length, 0) }; });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click()).catch(() => {});
  await page.waitForTimeout(3000);
  const after = await page.evaluate(async () => { const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance(); const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance(); return { artifacts: S.list().length, messages: M.listAll().reduce((a, c) => a + c.messages.length, 0) }; });
  check("conversations and artifacts survive a reload", after.artifacts >= before.artifacts && after.messages >= before.messages, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  check("no model calls during the run", model.length === 0, model.slice(0, 3).join(" "));
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  fs.writeFileSync(path.join(OUT, `${MODE}-run.json`), JSON.stringify({ base: BASE, mode: MODE, at: new Date().toISOString(), modelCalls: model, errors, results }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
