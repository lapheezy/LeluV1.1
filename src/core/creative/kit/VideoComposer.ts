/**
 * ==========================================================
 * LÉLU — CREATIVE KIT: SHORT FILMS (Canvas + Web Audio + WebCodecs)
 *
 * A film is a timeline program: scenes (each with a visual — a
 * generative artwork, a chart, a diagram, an image or a
 * gradient — a camera move and title text), transitions and an
 * optional soundtrack synthesised with Web Audio. It renders
 * entirely on the device:
 *
 *   frames      Canvas 2D (OffscreenCanvas where available)
 *   soundtrack  OfflineAudioContext (rendered faster than real time)
 *   encoding    WebCodecs through Mediabunny (MPL-2.0) → WebM (VP9/VP8 + Opus)
 *   fallback    MediaRecorder on canvas.captureStream (real time)
 *
 * No video API, no upload, no model. ffmpeg.wasm was evaluated
 * and not bundled: its core is ~31 MB, its common builds include
 * GPL components (x264), and WebCodecs already covers encode for
 * this pipeline. It remains an option for container/codec work
 * WebCodecs cannot do.
 * ==========================================================
 */

import { normalizeGenerative, renderGenerative, type GenerativeProgram } from "./GenerativeArt";
import { normalizeViz, vizSvg, type VizProgram } from "./InteractiveViz";
import { normalizeDiagram, renderDiagramSvg, type DiagramProgram } from "./Diagram";
import { clamp, rng } from "./Rng";

export type SceneVisual =
  | { type: "gradient"; colors: string[] }
  | { type: "generative"; program: GenerativeProgram }
  | { type: "chart"; program: VizProgram }
  | { type: "diagram"; program: DiagramProgram }
  | { type: "image"; dataUrl: string };

export interface FilmScene {
  duration: number;
  title?: string;
  subtitle?: string;
  visual: SceneVisual;
  motion: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "drift" | "still";
  textColor: string;
}

export interface VideoProgram {
  width: number;
  height: number;
  fps: number;
  scenes: FilmScene[];
  transition: "fade" | "cut";
  transitionSec: number;
  soundtrack: { mood: "calm" | "bright" | "tense" | "none"; bpm: number; volume: number };
  seed: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;
export const VIDEO_LIMITS = { scenes: 24, seconds: 90, pixels: 1920 * 1080 };

export function normalizeVideo(input: unknown): VideoProgram | string {
  const v = isObj(input) ? input : {};
  const raw = Array.isArray(v.scenes) ? v.scenes.slice(0, VIDEO_LIMITS.scenes) : [];
  if (raw.length === 0) return "a film needs at least one scene";
  let width = clamp(Math.round(Number(v.width) || 1280), 160, 1920);
  let height = clamp(Math.round(Number(v.height) || 720), 90, 1080);
  if (width * height > VIDEO_LIMITS.pixels) { width = 1920; height = 1080; }
  width -= width % 2; height -= height % 2; // encoders need even sizes
  const seed = typeof v.seed === "number" ? Math.abs(Math.floor(v.seed)) : 1;
  const scenes: FilmScene[] = [];
  for (const [i, s] of raw.entries()) {
    if (!isObj(s)) return `scene ${i + 1} is not an object`;
    const vis = isObj(s.visual) ? s.visual : { type: "gradient" };
    let visual: SceneVisual;
    const type = String(vis.type ?? "gradient");
    if (type === "generative") {
      const p = normalizeGenerative({ width, height, seed: seed + i, ...(isObj(vis.program) ? vis.program : vis) });
      if (typeof p === "string") return `scene ${i + 1}: ${p}`;
      visual = { type, program: { ...p, width, height } };
    } else if (type === "chart") {
      const p = normalizeViz(isObj(vis.program) ? vis.program : vis);
      if (typeof p === "string") return `scene ${i + 1}: ${p}`;
      visual = { type, program: p };
    } else if (type === "diagram") {
      const p = normalizeDiagram(isObj(vis.program) ? vis.program : vis);
      if (typeof p === "string") return `scene ${i + 1}: ${p}`;
      visual = { type, program: p };
    } else if (type === "image") {
      const url = typeof vis.dataUrl === "string" ? vis.dataUrl : "";
      if (!/^data:image\//.test(url)) return `scene ${i + 1}: an image visual needs a data:image URL`;
      visual = { type, dataUrl: url };
    } else {
      const colors = Array.isArray(vis.colors) ? vis.colors.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, 4) : [];
      visual = { type: "gradient", colors: colors.length >= 2 ? colors : ["#120e24", "#3b2a66"] };
    }
    const motion = ["zoom-in", "zoom-out", "pan-left", "pan-right", "drift", "still"].includes(String(s.motion)) ? (s.motion as FilmScene["motion"]) : (["zoom-in", "drift", "pan-left", "zoom-out", "pan-right"] as const)[i % 5];
    scenes.push({
      duration: clamp(Number(s.duration) || 3, 0.5, 30),
      title: typeof s.title === "string" ? s.title.slice(0, 120) : undefined,
      subtitle: typeof s.subtitle === "string" ? s.subtitle.slice(0, 200) : undefined,
      visual, motion,
      textColor: typeof s.textColor === "string" && HEX.test(s.textColor) ? s.textColor : "#f4f0ff",
    });
  }
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  if (total > VIDEO_LIMITS.seconds) return `the film is ${total.toFixed(1)} s; the limit is ${VIDEO_LIMITS.seconds} s`;
  const st = isObj(v.soundtrack) ? v.soundtrack : typeof v.soundtrack === "string" ? { mood: v.soundtrack } : {};
  return {
    width, height, fps: clamp(Math.round(Number(v.fps) || 30), 12, 60), scenes,
    transition: v.transition === "cut" ? "cut" : "fade", transitionSec: clamp(Number(v.transitionSec) || 0.6, 0, 3),
    soundtrack: { mood: (["calm", "bright", "tense", "none"].includes(String(st.mood)) ? st.mood : "calm") as VideoProgram["soundtrack"]["mood"], bpm: clamp(Number(st.bpm) || 84, 50, 180), volume: clamp(Number(st.volume) || 0.5, 0, 1) },
    seed,
  };
}

export function filmDuration(p: VideoProgram): number { return p.scenes.reduce((a, s) => a + s.duration, 0); }

/** Which scene(s) a time falls in, and how far through: pure, so it is tested without a browser. */
export function sceneAt(p: VideoProgram, t: number): { index: number; local: number; progress: number; blend: { index: number; alpha: number } | null } {
  let start = 0;
  for (let i = 0; i < p.scenes.length; i += 1) {
    const d = p.scenes[i].duration;
    if (t < start + d || i === p.scenes.length - 1) {
      const local = Math.max(0, t - start);
      const tr = p.transition === "fade" ? Math.min(p.transitionSec, d / 2) : 0;
      const intoNext = i < p.scenes.length - 1 && tr > 0 && local > d - tr ? (local - (d - tr)) / tr : 0;
      return { index: i, local, progress: Math.min(1, local / d), blend: intoNext > 0 ? { index: i + 1, alpha: intoNext } : null };
    }
    start += d;
  }
  return { index: 0, local: 0, progress: 0, blend: null };
}

/* ------------------------------------------------------------------ *
 * Browser rendering
 * ------------------------------------------------------------------ */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Drawable = CanvasImageSource | null;

/**
 * Decode an SVG once and rasterise it ONCE, at the largest size a camera move
 * needs (×1.12). Measured: drawing the vector image every frame made Chromium
 * re-rasterise a 340 KB flow-field SVG 30 times a second, and a 17 s film did
 * not finish in 14 minutes on a 4-vCPU machine; a bitmap is a texture copy.
 */
async function svgToImage(svg: string, w: number, h: number): Promise<Drawable> {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const bw = Math.round(w * 1.12), bh = Math.round(h * 1.12);
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bw, bh) : Object.assign(document.createElement("canvas"), { width: bw, height: bh });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return img;
    ctx.drawImage(img, 0, 0, bw, bh);
    return typeof createImageBitmap === "function" ? await createImageBitmap(canvas) : (canvas as CanvasImageSource);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareVisual(v: SceneVisual, w: number, h: number): Promise<Drawable> {
  if (v.type === "generative") return svgToImage(renderGenerative(v.program).svg, w, h);
  if (v.type === "chart") return svgToImage(vizSvg(v.program, { width: Math.round(w * 0.8), height: Math.round(h * 0.7), background: "#ffffff" }), w * 0.8, h * 0.7);
  if (v.type === "diagram") {
    const r = await renderDiagramSvg(v.program);
    return r.ok ? svgToImage(r.svg.replace(/<svg /, `<svg width="${Math.round(w * 0.8)}" height="${Math.round(h * 0.7)}" `), w * 0.8, h * 0.7) : null;
  }
  if (v.type === "image") { const img = new Image(); img.src = v.dataUrl; await img.decode(); return img; }
  return null;
}

function drawScene(ctx: Ctx, p: VideoProgram, i: number, progress: number, local: number, img: Drawable, alpha: number): void {
  const s = p.scenes[i];
  const { width: W, height: H } = p;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (s.visual.type === "gradient" || !img) {
    const colors = s.visual.type === "gradient" ? s.visual.colors : ["#120e24", "#3b2a66"];
    const angle = progress * Math.PI * 0.5;
    const g = ctx.createLinearGradient(W / 2 - Math.cos(angle) * W, H / 2 - Math.sin(angle) * H, W / 2 + Math.cos(angle) * W, H / 2 + Math.sin(angle) * H);
    colors.forEach((c, k) => g.addColorStop(k / (colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // soft drifting light particles so plain scenes still move
    const r = rng(p.seed + i * 17);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let k = 0; k < 40; k += 1) {
      const x = (r() * W + local * 20 * (r() - 0.3)) % W, y = (r() * H - local * 12 * r() + H) % H;
      ctx.beginPath(); ctx.arc(x, y, 2 + r() * 10, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    const isPanel = s.visual.type === "chart" || s.visual.type === "diagram";
    if (isPanel) { ctx.fillStyle = "#120e24"; ctx.fillRect(0, 0, W, H); }
    const e = progress * progress * (3 - 2 * progress);
    let scale = 1, dx = 0, dy = 0;
    if (s.motion === "zoom-in") scale = 1 + 0.12 * e;
    else if (s.motion === "zoom-out") scale = 1.12 - 0.12 * e;
    else if (s.motion === "pan-left") { scale = 1.1; dx = (0.5 - e) * W * 0.08; }
    else if (s.motion === "pan-right") { scale = 1.1; dx = (e - 0.5) * W * 0.08; }
    else if (s.motion === "drift") { scale = 1.06; dx = Math.sin(local * 0.6) * W * 0.02; dy = Math.cos(local * 0.5) * H * 0.02; }
    const iw = isPanel ? W * 0.8 : W, ih = isPanel ? H * 0.7 : H;
    ctx.translate(W / 2 + dx, H / 2 + dy + (isPanel ? H * 0.06 : 0));
    ctx.scale(scale, scale);
    ctx.drawImage(img as CanvasImageSource, -iw / 2, -ih / 2, iw, ih);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (s.title || s.subtitle) {
    const fadeIn = Math.min(1, local / 0.6);
    const shade = ctx.createLinearGradient(0, H * 0.55, 0, H);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    ctx.globalAlpha = alpha * fadeIn;
    ctx.fillStyle = s.textColor;
    ctx.textBaseline = "alphabetic";
    if (s.title) { ctx.font = `600 ${Math.round(H * 0.07)}px Inter, Helvetica, Arial, sans-serif`; ctx.fillText(s.title, W * 0.06, H * (s.subtitle ? 0.82 : 0.88) - (1 - fadeIn) * 12); }
    if (s.subtitle) { ctx.font = `400 ${Math.round(H * 0.036)}px Inter, Helvetica, Arial, sans-serif`; ctx.globalAlpha = alpha * fadeIn * 0.85; ctx.fillText(s.subtitle, W * 0.06, H * 0.9); }
  }
  ctx.restore();
}

/** Render frame t into ctx. */
export function drawFrame(ctx: Ctx, p: VideoProgram, t: number, images: Drawable[]): void {
  const at = sceneAt(p, t);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, p.width, p.height);
  drawScene(ctx, p, at.index, at.progress, at.local, images[at.index], 1);
  if (at.blend) drawScene(ctx, p, at.blend.index, 0, 0, images[at.blend.index], at.blend.alpha);
}

const MOODS: Record<string, { chords: number[][]; wave: OscillatorType }> = {
  calm: { chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]], wave: "sine" },
  bright: { chords: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [62, 65, 69]], wave: "triangle" },
  tense: { chords: [[57, 60, 63], [56, 59, 62], [57, 60, 64], [55, 58, 62]], wave: "sawtooth" },
};
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** Synthesise a soundtrack (pads + soft pulse) offline, faster than real time. Browser only. */
export async function renderSoundtrack(p: VideoProgram, seconds: number): Promise<AudioBuffer | null> {
  if (p.soundtrack.mood === "none" || typeof OfflineAudioContext === "undefined") return null;
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const mood = MOODS[p.soundtrack.mood];
  const master = ctx.createGain();
  master.gain.value = p.soundtrack.volume * 0.35;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = p.soundtrack.mood === "tense" ? 900 : 1800;
  filter.connect(master);
  master.connect(ctx.destination);
  const beat = 60 / p.soundtrack.bpm, bar = beat * 4;
  for (let t = 0, k = 0; t < seconds; t += bar, k += 1) {
    const chord = mood.chords[k % mood.chords.length];
    for (const note of chord) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = mood.wave;
      o.frequency.value = midi(note);
      o.detune.value = (k % 2 ? 4 : -4);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + bar * 0.25);
      g.gain.linearRampToValueAtTime(0.0001, Math.min(seconds, t + bar * 1.05));
      o.connect(g).connect(filter);
      o.start(t);
      o.stop(Math.min(seconds, t + bar * 1.1));
    }
    for (let b = 0; b < 4 && t + b * beat < seconds; b += 1) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t + b * beat;
      o.frequency.setValueAtTime(midi(chord[0] - 12), at);
      g.gain.setValueAtTime(0.18, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + beat * 0.6);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + beat * 0.7);
    }
  }
  // gentle fade at the end
  master.gain.setValueAtTime(p.soundtrack.volume * 0.35, Math.max(0, seconds - 1));
  master.gain.linearRampToValueAtTime(0.0001, seconds);
  return ctx.startRendering();
}

export interface RenderedFilm {
  bytes: Uint8Array;
  mime: string;
  seconds: number;
  frames: number;
  path: "webcodecs" | "mediarecorder";
  codec: string;
  audio: boolean;
  encodeMs: number;
  /** The size actually encoded (may be below the program's on a slow encoder). */
  width: number;
  height: number;
  /** Why the size was chosen. */
  sizing: string;
}

const MIRROR_WEBCODECS = { vp9: "vp09.00.10.08", vp8: "vp8", av1: "av01.0.04M.08" } as Record<string, string>;

/** Milliseconds per frame this device's encoder needs at a size (3 frames after a warm-up). */
async function encoderCost(codec: string, width: number, height: number): Promise<number> {
  const c = new OffscreenCanvas(width, height);
  const g = c.getContext("2d")!;
  const enc = new VideoEncoder({ output: () => undefined, error: () => undefined });
  enc.configure({ codec: MIRROR_WEBCODECS[codec] ?? codec, width, height, bitrate: 4_000_000, framerate: 30 });
  const frame = (i: number) => { g.fillStyle = `hsl(${i * 40},60%,50%)`; g.fillRect(0, 0, width, height); g.fillStyle = "#fff"; g.fillRect(i * 20, height / 4, width / 4, height / 4); return new VideoFrame(c, { timestamp: i * 33_333 }); };
  const f0 = frame(0); enc.encode(f0, { keyFrame: true }); f0.close(); await enc.flush();
  const t = performance.now();
  for (let i = 1; i <= 3; i += 1) { const f = frame(i); enc.encode(f); f.close(); }
  await enc.flush();
  enc.close();
  return (performance.now() - t) / 3;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The largest size (100 %, 75 %, 50 % of the program's) whose measured encode
 * time fits the budget. Measured on a 4-vCPU cloud VM with software VP9:
 * 274 ms/frame at 1280×720, 28 at 960×540, 16 at 640×360 — the full-size
 * 17.5 s film took 18 minutes; at 540p it takes well under one.
 */
async function chooseSize(p: VideoProgram, codec: string, frames: number, budgetMs: number): Promise<{ width: number; height: number; sizing: string }> {
  for (const scale of [1, 0.75, 0.5]) {
    const w = even(p.width * scale), h = even(p.height * scale);
    const cost = await encoderCost(codec, w, h).catch(() => Number.POSITIVE_INFINITY);
    const estimate = cost * frames;
    if (estimate <= budgetMs || scale === 0.5) {
      return { width: w, height: h, sizing: `${w}×${h}${scale < 1 ? ` (encoder measured ${Math.round(cost)} ms/frame here; full ${p.width}×${p.height} would exceed the ${Math.round(budgetMs / 1000)} s budget)` : ` (encoder ${Math.round(cost)} ms/frame)`}` };
    }
  }
  return { width: p.width, height: p.height, sizing: "program size" };
}

export interface RenderOptions { onProgress?: (fraction: number) => void; /** Encode-time budget before the size steps down (default max(60 s, 4× film length)). */ budgetMs?: number; /** Never step the size down. */ fullSize?: boolean }

/**
 * Render a film to WebM on this device. WebCodecs (faster than real time)
 * when the browser can encode an open codec; MediaRecorder in real time
 * otherwise. Throws with the exact reason when neither exists.
 */
export async function renderFilm(program: VideoProgram, options: RenderOptions | ((fraction: number) => void) = {}): Promise<RenderedFilm> {
  if (typeof document === "undefined") throw new Error("film rendering needs a browser (Canvas + WebCodecs or MediaRecorder)");
  const opts: RenderOptions = typeof options === "function" ? { onProgress: options } : options;
  const onProgress = opts.onProgress;
  const started = performance.now();
  const seconds = filmDuration(program);
  const frames = Math.round(seconds * program.fps);
  const audio = await renderSoundtrack(program, seconds).catch(() => null);
  const mb = await import("mediabunny");
  const codec = typeof VideoEncoder !== "undefined" ? await mb.getFirstEncodableVideoCodec(["vp9", "vp8", "av1"], { width: program.width, height: program.height }) : null;
  // Size: measured against this device's encoder (WebCodecs), or capped at
  // 640×360 for real-time MediaRecorder, which drops frames it cannot encode
  // in time (measured: 4 of 180 frames kept at 720p on a 4-vCPU VM).
  const size = codec
    ? (opts.fullSize ? { width: program.width, height: program.height, sizing: "program size (requested)" } : await chooseSize(program, codec, frames, opts.budgetMs ?? Math.max(60_000, seconds * 4000)))
    : program.height > 360 ? { width: even((program.width * 360) / program.height), height: 360, sizing: "640×360 cap for real-time MediaRecorder" } : { width: program.width, height: program.height, sizing: "program size" };
  const p: VideoProgram = { ...program, width: size.width, height: size.height };
  const images = await Promise.all(p.scenes.map((s) => prepareVisual(s.visual, p.width, p.height).catch(() => null)));
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("this browser refused a 2D canvas");
  if (codec) {
    const output = new mb.Output({ format: new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec, quality: mb.QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: p.fps });
    let audioSource: InstanceType<typeof mb.AudioBufferSource> | null = null;
    if (audio && (await mb.canEncodeAudio("opus"))) {
      audioSource = new mb.AudioBufferSource({ codec: "opus", quality: mb.QUALITY_MEDIUM });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    for (let f = 0; f < frames; f += 1) {
      drawFrame(ctx, p, f / p.fps, images);
      await video.add(f / p.fps, 1 / p.fps);
      if (onProgress && f % 10 === 0) onProgress(f / frames);
    }
    if (audioSource && audio) await audioSource.add(audio);
    await output.finalize();
    const buf = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
    if (!buf) throw new Error("the encoder finished without producing a file");
    return { bytes: new Uint8Array(buf), mime: "video/webm", seconds, frames, path: "webcodecs", codec, audio: !!audioSource, encodeMs: Math.round(performance.now() - started), width: p.width, height: p.height, sizing: size.sizing };
  }

  // MediaRecorder fallback: real time, but available far more widely.
  const MR = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MR?.isTypeSupported(t));
  if (!MR || !type || typeof canvas.captureStream !== "function") throw new Error("this browser can neither encode video with WebCodecs nor record a canvas with MediaRecorder");
  const stream = canvas.captureStream(p.fps);
  let audioCtx: AudioContext | null = null;
  if (audio) {
    audioCtx = new AudioContext({ sampleRate: audio.sampleRate });
    const src = audioCtx.createBufferSource();
    src.buffer = audio;
    const dest = audioCtx.createMediaStreamDestination();
    src.connect(dest);
    dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    src.start();
  }
  const recorder = new MR(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start(250);
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      drawFrame(ctx, p, Math.min(t, seconds - 1e-3), images);
      onProgress?.(t / seconds);
      if (t >= seconds) resolve(); else requestAnimationFrame(tick);
    };
    tick();
  });
  recorder.stop();
  await done;
  await audioCtx?.close();
  const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer());
  return { bytes, mime: "video/webm", seconds, frames, path: "mediarecorder", codec: type, audio: !!audio, encodeMs: Math.round(performance.now() - started), width: p.width, height: p.height, sizing: size.sizing };
}

/** Read back a WebM: EBML magic, DocType "webm", and whether Video/Audio track entries exist. */
export function inspectWebm(bytes: Uint8Array): { ok: boolean; docType?: string; video?: boolean; audio?: boolean; reason?: string } {
  if (bytes.length < 64) return { ok: false, reason: "file too small" };
  if (!(bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)) return { ok: false, reason: "no EBML header" };
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const docType = head.includes("webm") ? "webm" : head.includes("matroska") ? "matroska" : undefined;
  const all = bytes.subarray(0, Math.min(bytes.length, 65536));
  const find = (a: number, b: number) => { for (let i = 0; i < all.length - 1; i += 1) if (all[i] === a && all[i + 1] === b) return true; return false; };
  // TrackType element (0x83) followed by a 1-byte size and 1 = video / 2 = audio
  let video = false, audio = false;
  for (let i = 0; i < all.length - 2; i += 1) if (all[i] === 0x83 && all[i + 1] === 0x81) { if (all[i + 2] === 1) video = true; if (all[i + 2] === 2) audio = true; }
  return { ok: !!docType && find(0x16, 0x54), docType, video, audio };
}
