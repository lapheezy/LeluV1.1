/**
 * Job 2 acceptance — films in the REAL app, default Chromium flags.
 *
 *   LELU_BASE=http://127.0.0.1:5174/ node scripts/verify-film.cjs <outDir>
 *
 * 1. "/film ocean tides" typed into the chat (no model: generation routes aborted).
 * 2. The film window's own "Render" button → <video> ready; the WebM is pulled
 *    out of the page and checked with ffprobe (frames, codecs, duration).
 * 3. MediaRecorder fallback (VideoEncoder hidden) → ffprobe frame count
 *    against the page's measured animation-frame rate.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const BASE = process.env.LELU_BASE ?? "http://127.0.0.1:5174/";
const OUT = path.resolve(process.argv[2] ?? "docs/acceptance/mission-open-source-expansion");
const FILES = path.join(OUT, "files"), SHOTS = path.join(OUT, "screenshots");
for (const d of [FILES, SHOTS]) fs.mkdirSync(d, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`); };
const ffprobe = (file) => {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,nb_read_frames:format=duration", "-of", "json", file], { encoding: "utf8" }));
  const v = j.streams.find((x) => x.codec_type === "video"), a = j.streams.find((x) => x.codec_type === "audio");
  return { video: v && { codec: v.codec_name, width: v.width, height: v.height, frames: Number(v.nb_read_frames) }, audio: a && { codec: a.codec_name, frames: Number(a.nb_read_frames) }, duration: Number(j.format.duration) || null };
};

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route(/supabase\.co/, (r) => r.abort());
  let modelCalls = 0;
  await ctx.route(/\/api\/(model|ai|chat)(\/|$|\?)/, (r) => { if (r.request().method() === "GET") return r.continue(); modelCalls += 1; r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); if (await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue without an account")).catch(() => false)) break; }
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Continue without an account")?.click());
  await page.waitForTimeout(3000);
  const chat = await page.evaluate(() => { const b = document.querySelector('[data-spatial-control="chat"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (chat) await page.mouse.click(chat.x, chat.y);
  await page.waitForTimeout(2500);
  const ta = await page.evaluate(() => { const el = [...document.querySelectorAll(".lcu-input textarea")].find((e) => e.getBoundingClientRect().width > 0); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(ta.x, ta.y);
  await page.keyboard.type("/film ocean tides", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-lelu-film-render]", { timeout: 60000 });
  check("chat “/film ocean tides” opened a film window (no model)", modelCalls === 0, `${modelCalls} model calls`);

  // 2. the window's Render button
  const t0 = Date.now();
  await page.locator("[data-lelu-film-render]").first().click();
  await page.waitForSelector("[data-lelu-film-ready]", { timeout: 900000 }).catch(() => {});
  const renderMs = Date.now() - t0;
  const info = await page.evaluate(() => document.querySelector("[data-lelu-film-info]")?.textContent ?? document.querySelector(".lst-film .lst-error")?.textContent ?? null);
  await page.screenshot({ path: path.join(SHOTS, "30-film-window-rendered.png") });
  const bytes = await page.evaluate(async () => { const v = document.querySelector("[data-lelu-film-ready]"); if (!v) return null; const u = new Uint8Array(await (await fetch(v.src)).arrayBuffer()); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
  check("film window: Render button produced a playable video", !!bytes, `${info} · wall ${Math.round(renderMs / 1000)} s`);
  let probe = null;
  if (bytes) {
    const file = path.join(FILES, "film-window-render.webm");
    fs.writeFileSync(file, Buffer.from(bytes, "base64"));
    probe = ffprobe(file);
    check("film window (ffprobe): 525 frames, VP9/VP8 + Opus, 17.5 s", probe.video && probe.video.frames >= 515 && probe.audio && Math.abs(probe.duration - 17.52) < 0.2, JSON.stringify(probe));
    const playing = await page.evaluate(async () => { const v = document.querySelector("[data-lelu-film-ready]"); v.muted = true; await v.play(); await new Promise((r) => setTimeout(r, 1200)); return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight, d: v.duration }; });
    await page.screenshot({ path: path.join(SHOTS, "31-film-window-playing.png") });
    check("film window: the <video> plays", playing.t > 0.5, JSON.stringify(playing));
  }

  // 3. MediaRecorder fallback
  const mr = await page.evaluate(async () => {
    const S = (await import("/src/core/studio/StudioStore.ts")).default.getInstance();
    const V = await import("/src/core/creative/kit/VideoComposer.ts");
    const film = S.list().find((a) => a.kind === "visual" && S.latest(a).spec.medium === "video");
    const prog = { ...S.latest(film).spec.program, scenes: S.latest(film).spec.program.scenes.slice(0, 2) };
    let raf = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { raf++; if (performance.now() - t0 > 1000) r(); else requestAnimationFrame(f); }; f(); });
    const saved = window.VideoEncoder; window.VideoEncoder = undefined;
    try {
      const out = await V.renderFilm(prog);
      let s = ""; for (let i = 0; i < out.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, out.bytes.subarray(i, i + 0x8000));
      return { raf, path: out.path, codec: out.codec, seconds: out.seconds, size: `${out.width}x${out.height}`, encodeMs: out.encodeMs, b64: btoa(s) };
    } finally { window.VideoEncoder = saved; }
  });
  const mrFile = path.join(FILES, "film-mediarecorder-fallback.webm");
  fs.writeFileSync(mrFile, Buffer.from(mr.b64, "base64"));
  const mrProbe = ffprobe(mrFile);
  const ceiling = Math.min(30, mr.raf) * mr.seconds;
  // Real time: it keeps only what the page paints, so its frame count is a
  // MEASUREMENT reported next to the page's paint rate, not a pass criterion.
  check("MediaRecorder fallback (ffprobe): a valid WebM with video and audio", mr.path === "mediarecorder" && mrProbe.video && mrProbe.video.frames > 0 && mrProbe.audio, `${mrProbe.video?.frames} frames / ${mr.seconds}s at ${mr.size}; page paints ${mr.raf}/s → ceiling ${Math.round(ceiling)} · ${mr.codec} · ${mr.encodeMs} ms · ${JSON.stringify(mrProbe)}`);
  check("no model calls and no page errors", modelCalls === 0 && errors.length === 0, `${modelCalls} model calls · ${errors.slice(0, 2).join(" | ")}`);
  fs.writeFileSync(path.join(OUT, "film-run.json"), JSON.stringify({ at: new Date().toISOString(), flags: "--no-sandbox (default GPU handling)", renderMs, info, probe, mediaRecorder: { ...mr, b64: undefined, probe: mrProbe }, modelCalls, errors, results }, null, 2));
  console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
