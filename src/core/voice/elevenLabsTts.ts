/**
 * ==========================================================
 * LÉLU
 * ELEVENLABS SPEECH — server-brokered, one voice everywhere
 * ==========================================================
 *
 * Browser `speechSynthesis` speaks in whatever voice the visitor's
 * machine happens to have installed: different on every OS, never
 * hers, and absent entirely on some. This module asks HER server to
 * synthesise, so every reply is the same speaker.
 *
 * The key is not here and cannot be: the request goes to
 * /api/voice/tts and the server attaches `xi-api-key`
 * (plugins/voiceApi.ts). What comes back is audio bytes.
 *
 * Calls are serialised through `chain`, so two segments can never
 * play over each other, and `stopSpeaking()` cuts playback for
 * barge-in — the same interrupt path the browser engine has.
 * ==========================================================
 */

import UsageBudgetGate from "../observability/UsageBudgetGate";

interface ReportedUsage { characterCost: number | null; fiatCostUsd: number | null }

function parseUsageHeader(raw: string | null): ReportedUsage {
  try {
    const value = raw ? (JSON.parse(raw) as Partial<ReportedUsage>) : {};
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
    return { characterCost: num(value.characterCost), fiatCostUsd: num(value.fiatCostUsd) };
  } catch {
    return { characterCost: null, fiatCostUsd: null };
  }
}

/** Last synthesis: time to audio and ElevenLabs' reported characters (evidence). */
let lastSynthesis: { ms: number; characters: number | null; at: number } | null = null;
export function getLastSynthesis(): { ms: number; characters: number | null; at: number } | null {
  return lastSynthesis;
}

/** How long a status answer is trusted before asking again. */
const STATUS_TTL_MS = 60_000;

let statusCache: { at: number; configured: boolean } | null = null;
let current: HTMLAudioElement | null = null;
/**
 * Resolves the segment currently being awaited. Pausing an element fires
 * neither "ended" nor "error", so without this the serialised chain stayed
 * pending forever: every reply after a barge-in (or any stop) was queued
 * behind a promise that would never settle and was never spoken.
 */
let finishCurrent: (() => void) | null = null;

/**
 * SYNTHESIS-AHEAD QUEUE.
 *
 * One sentence at a time meant synthesis and playback took turns: the
 * listener heard the first sentence, then waited out the next synthesis
 * before the second one began (the audible gap between streamed chunks).
 * Here a segment's audio is requested the moment its text arrives, while
 * the previous segment is still playing, so the next blob is normally
 * ready before the current one ends.
 *
 * Order is preserved by one pump; `halted` makes a stop drop both the
 * playing segment and everything already synthesising behind it.
 */
/**
 * What a synthesis call produced.
 *
 *  - `blob` — one complete audio file (an MP3 from ElevenLabs, or the WAV the
 *    local engine writes when streaming is unavailable);
 *  - `pcm` — 16-bit mono PCM arriving as it is generated, played as soon as
 *    the first chunk exists. This is what makes the first syllable audible
 *    before the sentence has finished synthesising.
 */
type PreparedAudio =
  | { kind: "blob"; blob: Blob }
  | { kind: "pcm"; body: ReadableStream<Uint8Array>; sampleRate: number };

interface QueuedSegment {
  text: string;
  audio: Promise<PreparedAudio | null>;
  callbacks: SpeakCallbacks;
  /** Resolves when this segment is over, played or not: callers await it. */
  settled: Promise<void>;
  settle: () => void;
}

const queue: QueuedSegment[] = [];
let pumping = false;
/** A stop happened: never play what was synthesising when it arrived. */
let halted = false;
/** Segments played since the last stop (diagnostics, evidence). */
let playedSegments = 0;

/** How many segments are synthesising or playing behind the current one. */
export function ttsQueueDepth(): number {
  return queue.length + (current ? 1 : 0);
}

export function ttsPlayedSegments(): number {
  return playedSegments;
}

/** Resolve to playable audio, or null when the provider refused/failed. */
async function synthesize(text: string): Promise<PreparedAudio | null> {
  // Metered and budget-gated like every billed call (kind "api",
  // source "elevenlabs-tts"). A spent budget lands in onFail, whose
  // fallback is the browser's own (free) voice — never another paid one.
  const gate = UsageBudgetGate.getInstance();
  const reservation = await gate.reserve("api", "elevenlabs-tts");
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch("/api/voice/tts", {
      method: "POST",
      // `stream` asks the local engine for PCM as it is generated. A provider
      // that speaks MP3 (ElevenLabs) ignores the flag and answers with a file,
      // which is handled below — one request shape, two providers.
      headers: { "Content-Type": "application/json", Accept: "audio/*" },
      body: JSON.stringify({ text, stream: true }),
    });
  } catch (error) {
    await gate.settle(reservation, { operation: "tts", ok: false, latencyMs: Date.now() - started, error: (error as Error).message });
    return null;
  }
  const usage = parseUsageHeader(response.headers.get("X-Lelu-Usage"));
  lastSynthesis = { ms: Date.now() - started, characters: usage.characterCost, at: Date.now() };
  await gate.settle(reservation, {
    operation: "tts",
    ok: response.ok,
    latencyMs: Date.now() - started,
    rateLimited: response.status === 429,
    // `results` carries ElevenLabs' reported character cost for this call.
    results: usage.characterCost ?? undefined,
    usage: usage.fiatCostUsd !== null ? { cost: usage.fiatCostUsd } : undefined,
    error: response.ok ? undefined : `HTTP ${response.status}`,
  });
  if (!response.ok) {
    // A request that just failed is not evidence the server lost her voice.
    // Forget the cached answer so the next attempt asks again instead of
    // trusting a stale "configured" for a minute.
    forgetElevenLabsStatus();
    return null;
  }
  const type = (response.headers.get("Content-Type") ?? "").toLowerCase();
  if (type.startsWith("audio/l16") && response.body) {
    const declared = Number(response.headers.get("X-Lelu-Sample-Rate"));
    return {
      kind: "pcm",
      body: response.body,
      // The header is the authority; 16 kHz is only a last resort.
      sampleRate: Number.isFinite(declared) && declared > 0 ? declared : 16_000,
    };
  }
  const blob = await response.blob();
  return blob.size ? { kind: "blob", blob } : null;
}

/* ------------------------------ playback ------------------------------ */

let sharedContext: AudioContext | null = null;

/** The unlocked output context; the same one the mic unlock uses. */
function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedContext) sharedContext = new Ctor();
  if (sharedContext.state === "suspended") void sharedContext.resume().catch(() => {});
  return sharedContext;
}

/** The PCM playback in progress, so a barge-in can stop it and its reader. */
let activePcm: { stop: () => void } | null = null;

/** Play one complete audio file to its end (or to a stop), then resolve. */
function playBlob(blob: Blob, callbacks: SpeakCallbacks): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    const done = (ok: boolean) => {
      if (current === audio) current = null;
      finishCurrent = null;
      window.setTimeout?.(() => URL.revokeObjectURL(url), 1000);
      resolve(ok);
    };
    finishCurrent = () => done(false);
    audio.onended = () => {
      playedSegments += 1;
      done(true);
    };
    audio.onerror = () => done(false);
    callbacks.onStart?.();
    void audio.play().catch(() => done(false));
  });
}

/**
 * Play 16-bit mono PCM as it arrives.
 *
 * Each network chunk becomes one AudioBuffer scheduled after the previous
 * one, so playback is continuous, in order, and starts with the first chunk —
 * not with the last. A stop halts every scheduled source and cancels the
 * reader, which aborts the request and kills the synthesiser server-side.
 */
async function playPcm(
  body: ReadableStream<Uint8Array>,
  sampleRate: number,
  callbacks: SpeakCallbacks,
): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  const reader = body.getReader();
  const sources: AudioBufferSourceNode[] = [];
  let stopped = false;
  let started = false;
  let endAt = ctx.currentTime;
  let tail = new Uint8Array(0);
  const handle = {
    stop: () => {
      stopped = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // already finished
        }
      }
      void reader.cancel().catch(() => {});
    },
  };
  activePcm = handle;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (stopped || !value || value.length === 0) break;
      const merged = new Uint8Array(tail.length + value.length);
      merged.set(tail);
      merged.set(value, tail.length);
      const usable = merged.length - (merged.length % 2);
      const samples = usable / 2;
      if (samples === 0) {
        tail = merged;
        continue;
      }
      const view = new DataView(merged.buffer, merged.byteOffset, usable);
      const buffer = ctx.createBuffer(1, samples, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples; index += 1) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
      }
      tail = merged.slice(usable);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      // Schedule immediately after the previous chunk: continuous, never over it.
      const startAt = Math.max(ctx.currentTime + 0.02, endAt);
      source.start(startAt);
      endAt = startAt + buffer.duration;
      sources.push(source);
      if (!started) {
        started = true;
        callbacks.onStart?.();
      }
    }
    if (!started) return false;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, Math.ceil((endAt - ctx.currentTime) * 1000)) + 20),
    );
    if (stopped) return false;
    playedSegments += 1;
    return true;
  } catch {
    return false;
  } finally {
    if (activePcm === handle) activePcm = null;
    for (const source of sources) {
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}

function play(prepared: PreparedAudio, callbacks: SpeakCallbacks): Promise<boolean> {
  if (prepared.kind === "pcm") return playPcm(prepared.body, prepared.sampleRate, callbacks);
  return playBlob(prepared.blob, callbacks);
}

/** One pump plays the queue in order; synthesis already ran in parallel. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0) {
      const segment = queue.shift() as QueuedSegment;
      if (halted) {
        segment.settle();
        continue;
      }
      const prepared = await segment.audio;
      if (halted) {
        segment.settle();
        continue;
      }
      if (!prepared) {
        segment.callbacks.onFail?.();
        segment.settle();
        continue;
      }
      const played = await play(prepared, segment.callbacks);
      if (played) segment.callbacks.onEnd?.();
      else if (!halted) segment.callbacks.onFail?.();
      else segment.callbacks.onEnd?.();
      segment.settle();
    }
  } finally {
    pumping = false;
  }
}

/** True once the server has confirmed it holds an ElevenLabs key. */
export async function elevenLabsReady(): Promise<boolean> {
  if (typeof window === "undefined" || typeof fetch !== "function") return false;
  const now = Date.now();
  if (statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.configured;
  try {
    const response = await fetch("/api/voice/status", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = (await response.json()) as { configured?: unknown };
    const configured = data.configured === true;
    statusCache = { at: now, configured };
    return configured;
  } catch {
    // Unreachable server is reported as unavailable, never assumed working.
    statusCache = { at: now, configured: false };
    return false;
  }
}

/** Reset the cached answer; used when a request fails mid-session. */
export function forgetElevenLabsStatus(): void {
  statusCache = null;
}

export interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
  /** Synthesis or playback failed — the caller decides how to fall back. */
  onFail?: () => void;
}

/**
 * Speak one segment and resolve when it is over.
 *
 * An empty segment calls onEnd immediately; a refused one calls onFail and
 * never silently pretends it spoke. Synthesis for a segment starts the
 * moment it is enqueued, so the next sentence is ready while the current
 * one plays — but playback stays in order through one pump, so streamed
 * sentences never overlap.
 */
export function speakText(text: string, callbacks: SpeakCallbacks = {}): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    callbacks.onEnd?.();
    return Promise.resolve();
  }
  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  halted = false;
  queue.push({ text: trimmed, audio: synthesize(trimmed), callbacks, settled, settle });
  void pump();
  return settled;
}

/** Stop whatever she is saying — barge-in, or a new reply taking over. */
export function stopSpeaking(): void {
  halted = true;
  // Incremental PCM: stop the scheduled buffers and abort the stream, which
  // also ends synthesis on the server.
  activePcm?.stop();
  activePcm = null;
  const audio = current;
  current = null;
  // Release the current segment FIRST: a paused element fires no "ended",
  // so the segment being awaited is told it is over here instead of never.
  const finish = finishCurrent;
  finishCurrent = null;
  if (audio) {
    try {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    } catch {
      // A player that cannot be stopped fails closed: it is already paused.
    }
  }
  finish?.();
  // Anything already synthesising behind it must not start afterwards.
  for (const segment of queue.splice(0)) segment.settle();
}
