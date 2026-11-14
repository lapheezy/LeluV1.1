/**
 * Job 2 acceptance — the creative kit in the REAL app, in Chromium.
 *
 *   LELU_BASE=http://127.0.0.1:5174/ node scripts/verify-creative-kit.cjs <outDir>
 *
 * Part A: messages typed into the chat composer and sent with the mouse,
 *         with every model route aborted and counted (no model may answer).
 * Part B: every export produced inside the running app (its own modules,
 *         its own Canvas/WebCodecs/WebGL), written to <outDir>/files and
 *         re-checked on disk by the caller (ffprobe for WebM).
 * Part C: chart interactivity, 3D live rendering, film playback,
 *         MediaRecorder fallback, persistence after navigation and reload.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/mission-open-source-expansion");
const FILES = path.join(OUT, "files");
const SHOTS = path.join(OUT, "screenshots");
for (const d of [OUT, FILES, SHOTS]) fs.mkdirSync(d, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); };
const MODEL_ROUTE = /\/api\/(model|ai|chat)(\/|$|\?)|api\.(groq|openai|anthropic|cerebras|mistral|fireworks)|openrouter\.ai|generativelanguage/;

async function send(page, text) {
  const ta = await page.evaluate(() => { const el = [...document.querySelectorAll(".lcu-input textarea, [data-lelu-composer] textarea")].find((e) => e.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (!ta) return false;
  await page.mouse.click(ta.x, ta.y);
  await page.keyboard.type(text, { delay: 1 });
  const btn = await page.evaluate(() => { const b = [...document.querySelectorAll('.lcu-input button.lcu-send, [data-lelu-composer] button[aria-label="Send message"]')].find((e) => e.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (!btn) return false;
  await page.mouse.click(btn.x, btn.y);
  return true;
}

async function waitForReply(page, sentText, timeout = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await page.waitForTimeout(700);
    const s = await page.evaluate(async (sentText) => {
      const M = (await import("/src/core/multichat/MultiChatStore.ts")).default.getInstance();
      const conv = M.list().find((c) => (c.messages ?? []).some((m) => m.role === "user" && String(m.text ?? "").trim() === sentText.trim()));
      if (!conv) return { found: false };
      const msgs = conv.messages;
      const at = msgs.map((m) => m.role === "user" && String(m.text ?? "").trim() === sentText.trim()).lastIndexOf(true);
      const reply = msgs.slice(at + 1).find((m) => m.role === "assistant");
      return { found: true, conv: conv.id, role: reply?.role, status: reply?.activity?.status ?? null, text: String(reply?.text ?? ""), provider: reply?.provider ?? reply?.meta?.provider ?? null };
    }, sentText);
    if (s.found && s.role === "assistant" && s.text.trim() && s.status !== "running" && s.status !== "thinking") return { ms: Date.now() - t0, ...s };
  }
  return { ms: Date.now() - t0, timedOut: true, text: "" };
}

async function save(page, artifactId, format, rev = 1) {
  // Export inside the app, then pull the bytes out to disk.
  const r = await page.evaluate(async ({ artifactId, format, rev }) => {
    const K = await import("/src/core/creative/kit/CreativeKitTools.ts");
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    const a = S.get(artifactId);
    if (!a) return { ok: false, line: "no artifact" };
    const t0 = performance.now();
    const e = await K.exportArtifactFile(a, format, rev);
    const f = K.visualFile(artifactId, S.latest(a).rev, format);
    let b64 = null;
    if (f) { let s = ""; const u = f.bytes; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); b64 = btoa(s); }
    return { ok: e.ok, line: e.line, filename: f?.filename, b64, ms: Math.round(performance.now() - t0), facts: f?.facts ?? {} };
  }, { artifactId, format, rev });
  if (r.b64) fs.writeFileSync(path.join(FILES, r.filename), Buffer.from(r.b64, "base64"));
  return r;
}

async function run() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=swiftshader", "--enable-gpu-rasterization"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  const blockedModel = [];
  const network = [];
  // Generation requests (POST) on model routes are aborted and counted;
  // read-only status GETs pass through (they report every provider unconfigured).
  await ctx.route(MODEL_ROUTE, (r) => { if (r.request().method() === "GET") return r.continue(); blockedModel.push(`${r.request().method()} ${r.request().url()}`); r.abort(); });
  const page = await ctx.newPage();
  const errors = [], consoleErrors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 240)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 240)); });
  page.on("request", (r) => { const u = r.url(); if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) network.push(u); });
  const loaded = new Set();
  page.on("response", (r) => loaded.add(r.url()));

  /* ---------------- boot ---------------- */
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  const dcl = Date.now() - t0;
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  const bootMs = Date.now() - t0;
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const bootHeap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const kitAtBoot = [...loaded].filter((u) => /creative\/kit|mediabunny|three\/webgpu|VisualViewer|mermaid/.test(u));
  check("boot: entry screen interactive", bootMs < 60000, `DOMContentLoaded ${dcl} ms, entry button ${bootMs} ms, heap ${bootHeap} MB`);
  check("boot: no creative-kit renderer chunks loaded (lazy)", !kitAtBoot.some((u) => /mediabunny|three\/webgpu|VisualViewer|\/mermaid/.test(u)), kitAtBoot.map((u) => u.replace(BASE, "")).join(", ") || "none");
  await page.screenshot({ path: path.join(SHOTS, "00-home.png"), timeout: 90000 }).catch(() => {});
  const chatBtn = await page.evaluate(() => { const b = document.querySelector('[data-spatial-control="chat"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (chatBtn) await page.mouse.click(chatBtn.x, chatBtn.y);
  await page.waitForTimeout(2500);

  /* ---------------- A: chat, no model ---------------- */
  const STEPS = [
    ["01-art-command", "/art flowfield ocean"],
    ["02-art-natural", "Make me a generative artwork of a coral tree in forest colours"],
    ["03-diagram-arrows", "/diagram chat -> router -> tools, router -> public data, tools -> files"],
    ["04-diagram-natural", "Make an architecture diagram of LÉLU"],
    ["05-chart-earthquakes", "/chart earthquakes"],
    ["06-scene-command", "/scene forest"],
    ["07-scene-natural", "Build a 3D desert environment"],
    ["08-film", "Make a short film about ocean tides"],
    ["09-sketch", "/sketch evening gown"],
    ["10-collection", "Make me a concept fashion collection called Nocturne"],
    ["11-research", "Research coral reef bleaching and show me what you find"],
    ["12-capabilities", "/capabilities"],
  ];
  const chat = [];
  let users = 0;
  for (const [id, text] of STEPS) {
    const beforeModel = blockedModel.length;
    const sent = await send(page, text);
    users += sent ? 1 : 0;
    const reply = sent ? await waitForReply(page, text) : { ms: 0, timedOut: true, text: "(not sent: composer not found)" };
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOTS, `${id}.png`), timeout: 90000 }).catch((e) => console.log(`(screenshot ${id} skipped: ${String(e).slice(0, 80)})`));
    const ticks = (reply.text.match(/✓/g) ?? []).length, crosses = (reply.text.match(/✗/g) ?? []).length;
    chat.push({ id, text, ms: reply.ms, provider: reply.provider, modelAttempts: blockedModel.length - beforeModel, ticks, crosses, reply: reply.text.slice(0, 1500) });
    check(`chat ${id}: “${text}” executed without a model`, !reply.timedOut && /directly with my own tools/.test(reply.text) && ticks > 0, `${reply.ms} ms · ✓${ticks} ✗${crosses} · model attempts ${blockedModel.length - beforeModel} · ${reply.text.split("\n")[0].slice(0, 140)}`);
  }

  // Studio artifacts produced by the chat, newest first
  const studio = await page.evaluate(async () => {
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    return S.list().map((a) => { const sp = S.latest(a).spec; return { id: a.id, title: a.title, kind: a.kind, medium: sp.medium ?? null, conversationId: a.conversationId ?? null }; });
  });
  const cards = await page.evaluate(() => document.querySelectorAll("[data-lelu-chat-artifact]").length);
  check("chat cards rendered for the artifacts", cards >= 12, `${cards} cards, ${studio.length} artifacts`);

  // Fresh page for the measurements below: the chat opened a dozen windows
  // (several live 3D views). Artifacts persist in localStorage.
  await page.reload({ waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);

  /* ---------------- B: exports inside the app ---------------- */
  const exports = [];
  const byTitle = (re) => studio.find((a) => re.test(a.title));
  const ex = async (a, format) => { if (!a) { check(`export ${format}: artifact missing`, false); return; } const r = await save(page, a.id, format); exports.push({ title: a.title, format, ok: r.ok, file: r.filename, ms: r.ms, facts: r.facts, line: r.line.split("\n")[0] }); check(`export ${a.title} → ${format}`, r.ok, r.line.split("\n").slice(0, 3).join(" | ")); return r; };

  // 1. generative: all 8 styles, SVG + PNG
  const styles = await page.evaluate(async () => {
    const G = await import("/src/core/creative/kit/GenerativeArt.ts");
    return G.GENERATIVE_STYLES;
  });
  for (const [i, style] of styles.entries()) {
    const id = await page.evaluate(async ({ style, i }) => {
      const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
      const pals = ["lelu", "aurora", "ember", "ocean", "forest", "noir", "pastel", "neon"];
      const r = await dispatchToolCall({ id: `g-${style}`, name: toolNameForModel("creative.art"), arguments: { title: `Style ${style}`, style, palette: pals[i], seed: 100 + i, open: false } }, "demo-art");
      return r.data?.artifactId;
    }, { style, i });
    await ex({ id, title: `Style ${style}` }, "svg");
    await ex({ id, title: `Style ${style}` }, "png");
  }
  // 2. diagrams (text + structure) → mmd/svg/png
  for (const a of [byTitle(/^Diagram/), byTitle(/LÉLU architecture/)]) { await ex(a, "mmd"); await ex(a, "svg"); await ex(a, "png"); }
  // 3. charts → html/svg/png/csv/json
  const quakeChart = studio.find((a) => a.medium === "chart" && /per day/.test(a.title)) ?? studio.find((a) => a.medium === "chart");
  const quakeScatter = studio.find((a) => a.medium === "chart" && /depth/.test(a.title));
  for (const f of ["html", "svg", "png", "csv", "json"]) await ex(quakeChart, f);
  await ex(quakeScatter, "html");
  // 4. 3D: all presets → glb + gltf; custom objects
  const presets = await page.evaluate(async () => Object.keys((await import("/src/core/creative/kit/Scene3D.ts")).PRESETS));
  for (const preset of presets) {
    const id = await page.evaluate(async (preset) => {
      const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
      return (await dispatchToolCall({ id: `p-${preset}`, name: toolNameForModel("creative.scene3d"), arguments: { title: `Preset ${preset}`, preset, open: false } }, "demo-3d")).data?.artifactId;
    }, preset);
    await ex({ id, title: `Preset ${preset}` }, "glb");
    await ex({ id, title: `Preset ${preset}` }, "gltf");
  }
  const customId = await page.evaluate(async () => {
    const { dispatchToolCall, toolNameForModel } = await import("/src/core/tools/ToolDispatcher.ts");
    return (await dispatchToolCall({ id: "custom", name: toolNameForModel("creative.scene3d"), arguments: { title: "Custom pavilion", background: "#101826", objects: [
      { shape: "terrain", size: { width: 40, depth: 40, height: 2 }, color: "#52b788" },
      { shape: "torusKnot", position: [0, 4, 0], color: "gold", metalness: 0.9, roughness: 0.2, animate: { type: "spin", speed: 0.5 } },
      { shape: "building", position: [10, 0, -8], size: { width: 3, depth: 3, floors: 10 }, emissive: "#ffcf7a", color: "#2a3350" },
      { shape: "crystal", repeat: { count: 16, pattern: "ring", radius: 8 }, color: "#b98cff", emissive: "#7c5cff", size: { radius: 0.4, height: 2 } },
      { shape: "sphere", position: [0, 1, 6], size: { radius: 0.6 }, color: "#e4572e", animate: { type: "bob", speed: 1, amount: 0.6 } },
    ], open: false } }, "demo-3d")).data?.artifactId;
  });
  await ex({ id: customId, title: "Custom pavilion" }, "glb");
  // 6. drawing
  const sketch = studio.find((a) => a.kind === "drawing");
  for (const f of ["excalidraw", "svg", "png"]) await ex(sketch, f);

  /* ---------------- C1: chart interactivity ---------------- */
  {
    const html = fs.readFileSync(path.join(FILES, exports.find((e) => e.format === "html" && e.ok).file), "utf8");
    const p2 = await ctx.newPage();
    await p2.setContent(html);
    const mark = p2.locator(".mark").first();
    await mark.hover();
    await p2.waitForTimeout(200);
    const tip = await p2.evaluate(() => ({ text: document.getElementById("tip").textContent, opacity: getComputedStyle(document.getElementById("tip")).opacity }));
    check("chart: hover shows a tooltip with the value", tip.text.length > 0 && Number(tip.opacity) > 0, tip.text);
    await p2.evaluate(() => document.querySelector("details").open = true);
    const firstBefore = await p2.evaluate(() => document.querySelector("tbody tr td:nth-child(2)")?.textContent);
    await p2.locator("th").nth(1).click();
    const col = await p2.evaluate(() => [...document.querySelectorAll("tbody tr td:nth-child(2)")].map((t) => parseFloat(t.textContent)));
    const sorted = col.every((v, i) => i === 0 || col[i - 1] <= v);
    check("chart: clicking a header sorts the table", sorted && col.length > 1, `${firstBefore} → ${col.slice(0, 5).join(", ")}`);
    const cites = await p2.evaluate(() => [...document.querySelectorAll("footer a")].map((a) => a.href));
    check("chart: sources cited with links", cites.some((u) => /usgs\.gov/.test(u)), cites.join(" "));
    await p2.screenshot({ path: path.join(SHOTS, "20-chart-interactive.png") });
    await p2.close();
  }

  /* ---------------- C2: 3D live view in the app window (WebGL2 / WebGPU) ---------------- */
  const gpu = await page.evaluate(async () => { const c = await (await import("/src/core/creative/kit/BrowserCapabilities.ts")).probeCapabilities(); return { paths: c.paths, webgpu: c.gpu.webgpu, webgl2: c.gpu.webgl2, renderer: c.gpu.renderer, codecs: c.media.webcodecsVideo, audio: c.media.webcodecsAudio, mr: c.media.mediaRecorder }; });
  fs.writeFileSync(path.join(OUT, "capabilities.json"), JSON.stringify(gpu, null, 2));
  check("capabilities probed in Chromium", gpu.webgl2.available, JSON.stringify(gpu.paths));
  const forestScene = studio.find((a) => a.medium === "scene3d" && /forest/i.test(a.title));
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("lelu-studio-open", { detail: { ids: [id], layout: "single" } })), forestScene.id);
  const tScene = Date.now();
  await page.waitForFunction(() => /meshes/.test(document.querySelector("[data-lelu-scene-info]")?.textContent ?? ""), null, { timeout: 60000 }).catch(() => {});
  const sceneReadyMs = Date.now() - tScene;
  await page.waitForTimeout(1500);
  const sceneInfo = await page.evaluate(() => {
    const c = document.querySelector("[data-lelu-scene-renderer] canvas");
    if (!c) return { info: document.querySelector("[data-lelu-scene-info]")?.textContent ?? "no view" };
    const probe = document.createElement("canvas"); probe.width = 64; probe.height = 36;
    const g = probe.getContext("2d"); g.drawImage(c, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data; const colours = new Set();
    for (let i = 0; i < d.length; i += 4) colours.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
    return { info: document.querySelector("[data-lelu-scene-info]").textContent, colours: colours.size, w: c.width, h: c.height };
  });
  await page.screenshot({ path: path.join(SHOTS, "21-scene-webgl2.png"), timeout: 90000 }).catch(() => {});
  check("3D: forest renders live with WebGL2 (non-blank)", (sceneInfo.colours ?? 0) > 8, `${sceneInfo.info} · ${sceneInfo.colours} colour bins · ready ${sceneReadyMs} ms`);
  if (gpu.webgpu.available) {
    const btn = page.locator("[data-lelu-scene-info] button");
    if (await btn.count()) {
      await btn.click();
      await page.waitForFunction(() => /WebGPU/.test(document.querySelector("[data-lelu-scene-info]")?.textContent ?? ""), null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => document.querySelector("[data-lelu-scene-info]")?.textContent);
      await page.screenshot({ path: path.join(SHOTS, "22-scene-webgpu.png"), timeout: 90000 }).catch(() => {});
      check("3D: optional WebGPU view", /WebGPU/.test(info) && !/could not start/.test(info), info);
    }
  } else {
    check("3D: WebGPU not available in this Chromium (fallback WebGL2 used)", true, gpu.webgpu.detail);
  }

  /* ---------------- C3: film — WebCodecs encode, playback, MediaRecorder fallback ---------------- */
  const filmArt = studio.find((a) => a.medium === "video");
  const memBefore = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const webm = await save(page, filmArt.id, "webm");
  const memAfter = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  check("film: WebM encoded in Chromium with WebCodecs + mediabunny", webm.ok && webm.facts.path === "webcodecs", `${webm.line.split("\n")[0]} · heap ${memBefore}→${memAfter} MB`);
  const play = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
    const v = document.createElement("video"); v.muted = true; v.src = url; document.body.appendChild(v);
    await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error(v.error?.message ?? "error")); });
    if (!isFinite(v.duration)) { v.currentTime = 1e9; await new Promise((r) => (v.ontimeupdate = r)); }
    const duration = v.duration;
    v.currentTime = 0; await v.play(); await new Promise((r) => setTimeout(r, 1500));
    const played = v.currentTime;
    const c = document.createElement("canvas"); c.width = 64; c.height = 36; c.getContext("2d").drawImage(v, 0, 0, 64, 36);
    const d = c.getContext("2d").getImageData(0, 0, 64, 36).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    v.pause(); v.remove();
    const ac = new AudioContext(); let audio = null;
    try { const buf = await ac.decodeAudioData(bytes.buffer.slice(0)); let peak = 0; const ch = buf.getChannelData(0); for (let i = 0; i < ch.length; i += 97) peak = Math.max(peak, Math.abs(ch[i])); audio = { seconds: buf.duration, channels: buf.numberOfChannels, peak }; } catch (e) { audio = { error: String(e) }; }
    return { duration, played, width: v.videoWidth, height: v.videoHeight, brightness: sum / (d.length / 4), audio };
  }, fs.readFileSync(path.join(FILES, webm.filename)).toString("base64"));
  check("film: plays in a <video> element, frames are not blank", play.played > 0.5 && play.brightness > 5, JSON.stringify(play));
  check("film: soundtrack decodes with audible signal", play.audio && play.audio.peak > 0.01, JSON.stringify(play.audio));
  fs.copyFileSync(path.join(FILES, webm.filename), path.join(FILES, "film-webcodecs.webm"));
  // MediaRecorder fallback: the same film with VideoEncoder hidden from the page
  const mr = await page.evaluate(async (id) => {
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    const V = await import("/src/core/creative/kit/VideoComposer.ts");
    const saved = window.VideoEncoder;
    window.VideoEncoder = undefined;
    try {
      const prog = { ...S.latest(S.get(id)).spec.program };
      prog.scenes = prog.scenes.slice(0, 2);
      const film = await V.renderFilm(prog);
      let s = ""; for (let i = 0; i < film.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, film.bytes.subarray(i, i + 0x8000));
      return { path: film.path, codec: film.codec, seconds: film.seconds, encodeMs: film.encodeMs, size: film.bytes.length, inspect: V.inspectWebm(film.bytes), b64: btoa(s) };
    } finally { window.VideoEncoder = saved; }
  }, filmArt.id);
  fs.writeFileSync(path.join(FILES, "film-mediarecorder-fallback.webm"), Buffer.from(mr.b64, "base64"));
  check("film: MediaRecorder fallback records a WebM when WebCodecs is absent", mr.path === "mediarecorder" && mr.inspect.ok && mr.inspect.video, `${mr.codec} · ${mr.seconds}s in ${mr.encodeMs} ms · ${mr.size} bytes`);
  // in-window render button (the UI path)
  await page.evaluate((id) => window.dispatchEvent(new CustomEvent("lelu-studio-open", { detail: { ids: [id], layout: "single" } })), filmArt.id);
  await page.waitForTimeout(1500);
  const rb = page.locator("[data-lelu-film-render]").first();
  if (await rb.count()) {
    await rb.click();
    await page.waitForSelector("[data-lelu-film-ready]", { timeout: 120000 }).catch(() => {});
    const info = await page.evaluate(() => document.querySelector("[data-lelu-film-info]")?.textContent ?? null);
    await page.screenshot({ path: path.join(SHOTS, "23-film-window.png"), timeout: 90000 }).catch(() => {});
    check("film: rendered and playable from the window's button", !!info, info);
  }

  /* ---------------- C4: windows + persistence ---------------- */
  const openBtn = page.locator("[data-lelu-chat-artifact] button", { hasText: "Open" }).first();
  if (await openBtn.count()) { await openBtn.click(); await page.waitForTimeout(1500); }
  const winOpen = await page.evaluate(() => document.querySelectorAll("[data-lelu-studio-artifact]").length);
  await page.screenshot({ path: path.join(SHOTS, "24-card-open-window.png"), timeout: 90000 }).catch(() => {});
  check("a chat card's Open button shows the artifact window", winOpen > 0, `${winOpen} windows`);
  const before = studio.length;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click()).catch(() => {});
  await page.waitForTimeout(3000);
  const after = await page.evaluate(async () => { const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance(); return S.list().filter((a) => a.kind === "visual" || a.kind === "drawing").length; });
  check("artifacts survive navigation and reload", after >= before, `${after} visuals/drawings after reload (${before} made in chat)`);
  const pre = await page.evaluate((id) => { window.dispatchEvent(new CustomEvent("lelu-studio-open", { detail: { ids: [id], layout: "single" } })); return true; }, studio.find((a) => a.medium === "diagram").id);
  await page.waitForSelector("[data-lelu-diagram-rendered]", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, "25-diagram-after-reload.png"), timeout: 90000 }).catch(() => {});
  check("a diagram re-opens and renders after reload", pre && (await page.locator("[data-lelu-diagram-rendered]").count()) > 0);

  const memEnd = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  check("no model route was contacted during the run", blockedModel.length === 0, `${blockedModel.length} attempts: ${blockedModel.slice(0, 3).join(", ")}`);
  const external = [...new Set(network.map((u) => new URL(u).hostname))];
  fs.writeFileSync(path.join(OUT, "run.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), boot: { dclMs: dcl, entryMs: bootMs, heapMB: bootHeap, kitAtBoot }, memoryMB: { boot: bootHeap, beforeFilm: memBefore, afterFilm: memAfter, end: memEnd }, chat, exports, sceneInfo, sceneReadyMs, play, mediaRecorder: { ...mr, b64: undefined }, gpu, modelAttempts: blockedModel, externalHosts: external, pageErrors: errors, consoleErrors: consoleErrors.slice(0, 40), results }, null, 2));
  check("page errors during the run", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(`\nexternal hosts contacted: ${external.join(", ") || "none"}`);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
}

run().catch((e) => { console.error(e); process.exit(1); });
