/**
 * ==========================================================
 * LÉLU — BROWSER / DEVICE CAPABILITY PROBE
 *
 * What THIS device can actually execute, measured — never
 * assumed. Each creative tool picks its path from here:
 *
 *   3D rendering   WebGPU → WebGL2 → (no live view; GLB export still works)
 *   video encode   WebCodecs (VideoEncoder) → MediaRecorder → frames-only
 *   audio          OfflineAudioContext → silent track
 *   raster export  OffscreenCanvas → <canvas> → SVG only
 *   storage        IndexedDB → localStorage
 *   save file      File System Access → download link
 *   speech         speechSynthesis / SpeechRecognition (where present)
 *
 * The probe is synchronous where the platform allows and async
 * only for the answers that need it (WebGPU adapter, codec
 * support, storage estimate). Outside a browser every answer is
 * "unavailable", which is the truth there.
 * ==========================================================
 */

export interface CapabilityAnswer { available: boolean; detail?: string }

export interface BrowserCapabilities {
  runtime: "browser" | "worker" | "server";
  probedAt: string;
  gpu: { webgpu: CapabilityAnswer; webgl2: CapabilityAnswer; webgl: CapabilityAnswer; renderer?: string };
  canvas: { canvas2d: CapabilityAnswer; offscreen: CapabilityAnswer; svg: CapabilityAnswer };
  compute: { workers: CapabilityAnswer; sharedArrayBuffer: CapabilityAnswer; wasm: CapabilityAnswer; cores: number | null; memoryGB: number | null };
  media: { webcodecsVideo: CapabilityAnswer; webcodecsAudio: CapabilityAnswer; mediaRecorder: CapabilityAnswer; webAudio: CapabilityAnswer; offlineAudio: CapabilityAnswer; webAnimations: CapabilityAnswer; webrtc: CapabilityAnswer };
  storage: { indexedDB: CapabilityAnswer; fileSystemAccess: CapabilityAnswer; opfs: CapabilityAnswer; compressionStreams: CapabilityAnswer; quotaMB: number | null };
  interaction: { speechSynthesis: CapabilityAnswer; speechRecognition: CapabilityAnswer; clipboard: CapabilityAnswer; share: CapabilityAnswer; dragDrop: CapabilityAnswer };
  /** The path each creative capability will take on this device. */
  paths: { render3d: "webgpu" | "webgl2" | "export-only"; video: "webcodecs" | "mediarecorder" | "unavailable"; videoCodec: string | null; audio: "offline-audio" | "none"; raster: "offscreen" | "canvas" | "svg-only"; save: "file-system-access" | "download" | "none" };
}

const yes = (detail?: string): CapabilityAnswer => ({ available: true, detail });
const no = (detail?: string): CapabilityAnswer => ({ available: false, detail });
const g = globalThis as unknown as Record<string, unknown> & { navigator?: Navigator & Record<string, unknown>; document?: Document };

/** WebM-compatible codecs in preference order (open, royalty-free). */
export const VIDEO_CODECS: Array<{ id: "vp9" | "vp8" | "av1"; webcodecs: string; mediaRecorder: string }> = [
  { id: "vp9", webcodecs: "vp09.00.10.08", mediaRecorder: "video/webm;codecs=vp9" },
  { id: "vp8", webcodecs: "vp8", mediaRecorder: "video/webm;codecs=vp8" },
  { id: "av1", webcodecs: "av01.0.04M.08", mediaRecorder: "video/webm;codecs=av1" },
];

function webglProbe(kind: "webgl2" | "webgl"): { answer: CapabilityAnswer; renderer?: string } {
  try {
    const doc = g.document;
    const canvas: HTMLCanvasElement | OffscreenCanvas | null = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : doc ? doc.createElement("canvas") : null;
    if (!canvas) return { answer: no("no canvas") };
    const gl = canvas.getContext(kind) as WebGLRenderingContext | null;
    if (!gl) return { answer: no(`${kind} context refused`) };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { answer: yes(renderer), renderer };
  } catch (error) {
    return { answer: no(error instanceof Error ? error.message : "probe failed") };
  }
}

export async function probeCapabilities(): Promise<BrowserCapabilities> {
  const nav = g.navigator;
  const hasDoc = typeof g.document !== "undefined";
  const runtime: BrowserCapabilities["runtime"] = hasDoc ? "browser" : typeof (g as Record<string, unknown>).WorkerGlobalScope !== "undefined" ? "worker" : "server";
  const has = (name: string) => typeof g[name] !== "undefined";

  let webgpu = no("navigator.gpu absent");
  const gpu = nav?.gpu as { requestAdapter?: () => Promise<{ info?: { vendor?: string; architecture?: string } } | null> } | undefined;
  if (gpu?.requestAdapter) {
    try {
      const adapter = await Promise.race([gpu.requestAdapter(), new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
      webgpu = adapter ? yes([adapter.info?.vendor, adapter.info?.architecture].filter(Boolean).join(" ") || "adapter available") : no("no adapter (blocklisted GPU or headless)");
    } catch (error) {
      webgpu = no(error instanceof Error ? error.message : "adapter request failed");
    }
  }
  const gl2 = runtime === "server" ? { answer: no("no browser") } : webglProbe("webgl2");
  const gl1 = runtime === "server" ? { answer: no("no browser") } : webglProbe("webgl");

  // Codec support is asked, not assumed (Chromium builds differ).
  let videoCodec: string | null = null;
  let webcodecsVideo = no("VideoEncoder absent");
  const VE = g.VideoEncoder as { isConfigSupported?: (c: unknown) => Promise<{ supported?: boolean }> } | undefined;
  if (VE?.isConfigSupported) {
    for (const c of VIDEO_CODECS) {
      try {
        const r = await VE.isConfigSupported({ codec: c.webcodecs, width: 640, height: 360, bitrate: 2_000_000, framerate: 30 });
        if (r.supported) { videoCodec = c.id; break; }
      } catch { /* try the next */ }
    }
    webcodecsVideo = videoCodec ? yes(`encodes ${videoCodec}`) : no("no WebM codec supported by VideoEncoder");
  }
  let webcodecsAudio = no("AudioEncoder absent");
  const AE = g.AudioEncoder as { isConfigSupported?: (c: unknown) => Promise<{ supported?: boolean }> } | undefined;
  if (AE?.isConfigSupported) {
    try { webcodecsAudio = (await AE.isConfigSupported({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported ? yes("opus") : no("opus unsupported"); } catch { webcodecsAudio = no("opus probe failed"); }
  }
  const MR = g.MediaRecorder as { isTypeSupported?: (t: string) => boolean } | undefined;
  const mrType = MR?.isTypeSupported ? VIDEO_CODECS.find((c) => MR.isTypeSupported!(c.mediaRecorder)) : undefined;
  if (!videoCodec && mrType) videoCodec = mrType.id;

  let quotaMB: number | null = null;
  try {
    const est = await (nav?.storage as StorageManager | undefined)?.estimate?.();
    if (est?.quota) quotaMB = Math.round(est.quota / 1048576);
  } catch { /* unknown */ }

  const offscreen = has("OffscreenCanvas");
  const canvas2d = hasDoc || offscreen;
  const caps: BrowserCapabilities = {
    runtime,
    probedAt: new Date().toISOString(),
    gpu: { webgpu, webgl2: gl2.answer, webgl: gl1.answer, renderer: gl2.renderer ?? gl1.renderer },
    canvas: { canvas2d: canvas2d ? yes() : no(), offscreen: offscreen ? yes() : no(), svg: hasDoc ? yes() : yes("as text (no DOM to display)") },
    compute: {
      workers: has("Worker") ? yes() : no(), sharedArrayBuffer: has("SharedArrayBuffer") && (g as Record<string, unknown>).crossOriginIsolated === true ? yes() : no("needs cross-origin isolation"),
      wasm: has("WebAssembly") ? yes() : no(), cores: typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
      memoryGB: typeof nav?.deviceMemory === "number" ? (nav.deviceMemory as number) : null,
    },
    media: {
      webcodecsVideo, webcodecsAudio,
      mediaRecorder: mrType ? yes(mrType.mediaRecorder) : MR ? no("no WebM type supported") : no("MediaRecorder absent"),
      webAudio: has("AudioContext") || has("webkitAudioContext") ? yes() : no(), offlineAudio: has("OfflineAudioContext") ? yes() : no(),
      webAnimations: hasDoc && typeof (g.document as Document).body?.animate === "function" ? yes() : no(),
      webrtc: has("RTCPeerConnection") ? yes() : no(),
    },
    storage: {
      indexedDB: has("indexedDB") ? yes() : no(), fileSystemAccess: has("showSaveFilePicker") ? yes() : no("download fallback"),
      opfs: typeof (nav?.storage as StorageManager | undefined)?.getDirectory === "function" ? yes() : no(),
      compressionStreams: has("CompressionStream") ? yes() : no(), quotaMB,
    },
    interaction: {
      speechSynthesis: has("speechSynthesis") ? yes() : no(), speechRecognition: has("SpeechRecognition") || has("webkitSpeechRecognition") ? yes() : no(),
      clipboard: nav?.clipboard ? yes() : no(), share: typeof nav?.share === "function" ? yes() : no(), dragDrop: hasDoc ? yes() : no(),
    },
    paths: {
      render3d: webgpu.available ? "webgpu" : gl2.answer.available ? "webgl2" : "export-only",
      video: webcodecsVideo.available ? "webcodecs" : mrType ? "mediarecorder" : "unavailable",
      videoCodec,
      audio: has("OfflineAudioContext") ? "offline-audio" : "none",
      raster: offscreen ? "offscreen" : hasDoc ? "canvas" : "svg-only",
      save: has("showSaveFilePicker") ? "file-system-access" : hasDoc ? "download" : "none",
    },
  };
  return caps;
}

/** A compact, human/model-readable report. */
export function describeCapabilities(c: BrowserCapabilities): string {
  const mark = (a: CapabilityAnswer) => (a.available ? "✓" : "✗");
  return [
    `Runtime: ${c.runtime}${c.compute.cores ? ` · ${c.compute.cores} cores` : ""}${c.compute.memoryGB ? ` · ~${c.compute.memoryGB} GB` : ""}${c.gpu.renderer ? ` · GPU ${c.gpu.renderer}` : ""}`,
    `GPU: WebGPU ${mark(c.gpu.webgpu)}${c.gpu.webgpu.detail ? ` (${c.gpu.webgpu.detail})` : ""} · WebGL2 ${mark(c.gpu.webgl2)} · WebGL ${mark(c.gpu.webgl)}`,
    `Canvas: 2D ${mark(c.canvas.canvas2d)} · OffscreenCanvas ${mark(c.canvas.offscreen)} · Workers ${mark(c.compute.workers)} · WASM ${mark(c.compute.wasm)}`,
    `Media: WebCodecs video ${mark(c.media.webcodecsVideo)}${c.media.webcodecsVideo.detail ? ` (${c.media.webcodecsVideo.detail})` : ""} · audio ${mark(c.media.webcodecsAudio)} · MediaRecorder ${mark(c.media.mediaRecorder)} · Web Audio ${mark(c.media.webAudio)} · Web Animations ${mark(c.media.webAnimations)} · WebRTC ${mark(c.media.webrtc)}`,
    `Storage: IndexedDB ${mark(c.storage.indexedDB)} · File System Access ${mark(c.storage.fileSystemAccess)} · OPFS ${mark(c.storage.opfs)} · Compression ${mark(c.storage.compressionStreams)}${c.storage.quotaMB ? ` · quota ${c.storage.quotaMB} MB` : ""}`,
    `Speech: synthesis ${mark(c.interaction.speechSynthesis)} · recognition ${mark(c.interaction.speechRecognition)} · Clipboard ${mark(c.interaction.clipboard)} · Share ${mark(c.interaction.share)}`,
    `Paths here: 3D ${c.paths.render3d} · video ${c.paths.video}${c.paths.videoCodec ? ` (${c.paths.videoCodec})` : ""} · audio ${c.paths.audio} · raster ${c.paths.raster} · save ${c.paths.save}`,
  ].join("\n");
}

let cached: Promise<BrowserCapabilities> | null = null;
/** Probe once per page; later calls reuse the answer. */
export function capabilities(): Promise<BrowserCapabilities> {
  if (!cached) cached = probeCapabilities();
  return cached;
}
