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
import type { SpeechProfileId } from "./speechProfile";

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

/**
 * Last synthesis: time to audio, ElevenLabs' reported characters, and what
 * the SERVER said it did (M22.9). The server headers are the only place the
 * page can learn whether a warm worker answered, how long its synthesis took
 * and how many times a voice was loaded — read them, never infer them.
 */
let lastSynthesis: {
  ms: number;
  characters: number | null;
  at: number;
  streaming: string | null;
  modelLoads: number | null;
  synthesisMs: number | null;
  profile: string | null;
  coldStart: boolean;
} | null = null;
export function getLastSynthesis(): typeof lastSynthesis {
  return lastSynthesis;
}

/** A synthesis request with no response headers by then has failed. */
const TTS_HEADER_TIMEOUT_MS = 15_000;
/** Seconds of speech per character of text (measured on her voice, ~0.07). */
const SPEECH_SECONDS_PER_CHAR = 0.08;
/** Never wait longer than this for one sentence, however slow the worker. */
const TTS_HEADER_TIMEOUT_CAP_MS = 300_000;

/**
 * How long to wait for a sentence's response headers.
 *
 * A worker slower than real time is answered as one whole WAV per sentence
 * (plugins/voxApi.ts), so its headers come only when the sentence is done:
 * VoxCPM2 on a 4-core CPU took 19.5 s for 3.2 s of speech. The fixed 15 s
 * limit aborted every such sentence, and she never spoke. The wait now
 * scales with the sentence and with the pace the server reported for the
 * worker (`workerRtf` in /api/voice/status), with a 2× margin; a fast or
 * unknown engine keeps the 15 s limit, so a hung one still fails fast.
 */
export function ttsHeaderTimeoutMs(characters: number, workerRtf: number | null): number {
  if (workerRtf === null || !Number.isFinite(workerRtf) || workerRtf <= 1) return TTS_HEADER_TIMEOUT_MS;
  const expected = characters * SPEECH_SECONDS_PER_CHAR * workerRtf * 1000;
  return Math.min(TTS_HEADER_TIMEOUT_CAP_MS, Math.max(TTS_HEADER_TIMEOUT_MS, TTS_HEADER_TIMEOUT_MS + 2 * expected));
}

/** How long a status answer is trusted before asking again. */
const STATUS_TTL_MS = 60_000;

let statusCache: { at: number; configured: boolean; workerRtf: number | null } | null = null;
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
 * Order is preserved by one pump; a stop marks every segment cancelled, which drops both the
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
  | { kind: "pcm"; feed: PcmFeed; sampleRate: number; plan: BufferedStartPlan | null };

/**
 * A stream from a worker slower than real time, played from a buffer: the
 * page starts once the rest of the sentence can no longer overtake playback.
 */
interface BufferedStartPlan {
  /** Estimated length of the sentence's audio, from its text. */
  expectedSeconds: number;
  /** Worker real-time factor as the server measured it (seconds of work per second of audio). */
  rtf: number | null;
}

/**
 * Seconds of speech a sentence will take, from its spoken text. Measured on
 * VoxCPM2 with her reference: 0.041-0.070 s per character; the upper part of
 * that range is used so the estimate errs towards starting a little late
 * (which costs a fraction of a second) rather than early (which would leave a
 * gap in her voice).
 */
export function estimateSpeechSeconds(text: string): number {
  return Math.max(0.6, text.trim().length * 0.068);
}

/**
 * May a buffered stream start playing now? Playback must never overtake
 * generation: with `pace` seconds of audio produced per second, a sentence of
 * `expected` seconds can start once `expected * (1 - pace)` is buffered (plus
 * a margin). Pure, so the rule is testable.
 */
export function pcmStartReady(input: {
  producedSeconds: number;
  expectedSeconds: number;
  /** Audio seconds produced per wall second (1/RTF); null when unknown. */
  pace: number | null;
  complete: boolean;
  marginSeconds?: number;
}): boolean {
  if (input.complete) return input.producedSeconds > 0;
  if (input.pace === null || !Number.isFinite(input.pace) || input.pace >= 1) return input.producedSeconds > 0;
  const expected = Math.max(input.expectedSeconds, input.producedSeconds);
  return input.producedSeconds >= expected * (1 - Math.max(0, input.pace)) + (input.marginSeconds ?? 0.3);
}

/**
 * A response body drained into memory from the moment its headers arrive.
 *
 * A sentence synthesised ahead used to be read only when its turn to play
 * came; against a streaming worker the unread socket filled (one step is
 * ~15 KB) and the worker stalled mid-generation until the page caught up.
 */
class PcmFeed {
  private readonly parts: Uint8Array[] = [];
  private waiters: Array<() => void> = [];
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  bytes = 0;
  done = false;
  failed = false;
  firstAt: number | null = null;
  readonly openedAt = Date.now();

  constructor(body: ReadableStream<Uint8Array>) {
    this.reader = body.getReader();
    void this.pull();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  private async pull(): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) {
          if (this.firstAt === null) this.firstAt = Date.now();
          this.parts.push(value);
          this.bytes += value.length;
          this.wake();
        }
      }
    } catch {
      this.failed = true;
    } finally {
      this.done = true;
      this.wake();
    }
  }

  /** Every chunk in order, waiting for the next while the stream is open. */
  async *chunks(): AsyncGenerator<Uint8Array> {
    let index = 0;
    for (;;) {
      while (index < this.parts.length) yield this.parts[index++]!;
      if (this.done) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  /** Resolves when more data arrives or the stream ends. */
  changed(): Promise<void> {
    if (this.done) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  cancel(): void {
    void this.reader.cancel().catch(() => {});
  }
}

interface QueuedSegment {
  text: string;
  delivery?: SpeechProfileId;
  /** Started lazily (see SYNTHESIS_AHEAD); null until then. */
  audio: Promise<PreparedAudio | null> | null;
  /** Aborts this segment's request — a stop must end synthesis server-side too. */
  controller: AbortController | null;
  callbacks: SpeakCallbacks;
  /** Resolves when this segment is over, played or not: callers await it. */
  settled: Promise<void>;
  settle: () => void;
  /**
   * This segment was stopped. Per segment, not global: `halted` is cleared
   * by the next reply's first sentence, and a pump still awaiting an
   * interrupted sentence then saw "not halted", got the aborted request's
   * null and called its onFail — the engine counted a sentence nobody wanted
   * as a voice failure and handed it to a different voice.
   */
  cancelled?: boolean;
}

const queue: QueuedSegment[] = [];
let pumping = false;
/**
 * How many segments behind the one playing may be synthesising at once.
 *
 * Every sentence of a long reply used to be requested the moment it arrived.
 * Against a speech worker slower than real time (VoxCPM2 on a CPU, RTF 5–10)
 * the sixth request met the worker's full queue (HTTP 503), the engine
 * demoted the rest of the reply to the browser's voice, and after a STOP the
 * worker went on generating every queued sentence nobody would hear. Two
 * ahead still hides synthesis behind playback for a worker that keeps up.
 */
export const SYNTHESIS_AHEAD = 2;
/** The segment the pump is awaiting or playing, so a stop can abort it. */
let pumpSegment: QueuedSegment | null = null;

/** Segments whose synthesis has started and that have not settled yet. */
const inFlight = new Set<QueuedSegment>();

function startSynthesis(segment: QueuedSegment): Promise<PreparedAudio | null> {
  if (!segment.audio) {
    segment.controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    // The worker generates one sentence at a time, in arrival order: this one
    // also waits for every sentence already sent ahead of it.
    let aheadChars = 0;
    for (const other of inFlight) aheadChars += other.text.length;
    inFlight.add(segment);
    void segment.settled.then(() => inFlight.delete(segment));
    synthesising += 1;
    segment.audio = synthesize(segment.text, segment.delivery, segment.controller, aheadChars);
    void segment.audio.finally(() => {
      synthesising = Math.max(0, synthesising - 1);
      // The next sentence may go now (see fillAhead).
      fillAhead();
    });
  }
  return segment.audio;
}

/** Segments whose synthesis request has been sent and not yet answered. */
let synthesising = 0;

/**
 * Start synthesis for the next SYNTHESIS_AHEAD queued segments, no more.
 *
 * A worker slower than real time generates one sentence at a time anyway, and
 * two requests sent in the same millisecond can reach it in either order:
 * measured in the live run, the reply's second sentence was generated first
 * and the first waited 38 s behind it. Against such a worker the next request
 * is sent when the previous one has been answered, so it arrives in order.
 */
function fillAhead(): void {
  const serial = (statusCache?.workerRtf ?? 0) > 1;
  for (const segment of queue.slice(0, SYNTHESIS_AHEAD)) {
    if (segment.audio) continue;
    if (serial && synthesising > 0) break;
    void startSynthesis(segment);
  }
}
/** Segments played since the last stop (diagnostics, evidence). */
let playedSegments = 0;

/** How many segments are synthesising or playing behind the current one. */
/**
 * The speech worker's measured real-time factor, as /api/voice/status last
 * reported it (null: unknown or not a local worker). Above 1 the worker is
 * slower than real time — VoxCPM2 on a CPU.
 */
export function speechWorkerRtf(): number | null {
  return statusCache?.workerRtf ?? null;
}

export function ttsQueueDepth(): number {
  return queue.length + (current ? 1 : 0);
}

export function ttsPlayedSegments(): number {
  return playedSegments;
}

/** Resolve to playable audio, or null when the provider refused/failed. */
async function synthesize(
  text: string,
  delivery?: SpeechProfileId,
  segmentController: AbortController | null = null,
  aheadChars = 0,
): Promise<PreparedAudio | null> {
  // Metered and budget-gated like every billed call (kind "api",
  // source "elevenlabs-tts"). A spent budget lands in onFail, whose
  // fallback is the browser's own (free) voice — never another paid one.
  const gate = UsageBudgetGate.getInstance();
  const reservation = await gate.reserve("api", "elevenlabs-tts");
  const started = Date.now();
  let response: Response;
  // A speech server that never answers must not hold the reply's queue (and
  // the "speaking" state) forever: no headers within the limit is a failed
  // segment, which the caller reports and falls back from. The timer is
  // cleared once headers arrive, so a long streamed body is never cut.
  const controller = segmentController ?? (typeof AbortController !== "undefined" ? new AbortController() : null);
  const headerTimer = controller
    ? setTimeout(() => controller.abort(), ttsHeaderTimeoutMs(text.length + aheadChars, statusCache?.workerRtf ?? null))
    : null;
  try {
    response = await fetch("/api/voice/tts", {
      ...(controller ? { signal: controller.signal } : {}),
      method: "POST",
      // `stream` asks the local engine for PCM as it is generated. A provider
      // that speaks MP3 (ElevenLabs) ignores the flag and answers with a file,
      // which is handled below — one request shape, two providers.
      headers: { "Content-Type": "application/json", Accept: "audio/*" },
      // `delivery` names one of the closed profiles in speechProfile.ts. The
      // server validates it against that set; a profile is a delivery choice,
      // never a change to her words.
      // `buffered`: this page starts a stream from a slower-than-real-time
      // worker only once it cannot run dry (pcmStartReady), so the server may
      // stream from it instead of sending one whole WAV.
      body: JSON.stringify({ text, stream: true, buffered: true, ...(delivery ? { delivery } : {}) }),
    });
  } catch (error) {
    if (headerTimer) clearTimeout(headerTimer);
    await gate.settle(reservation, { operation: "tts", ok: false, latencyMs: Date.now() - started, error: (error as Error).message });
    return null;
  }
  if (headerTimer) clearTimeout(headerTimer);
  const usage = parseUsageHeader(response.headers.get("X-Lelu-Usage"));
  const headerNumber = (name: string): number | null => {
    const raw = response.headers.get(name);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  lastSynthesis = {
    ms: Date.now() - started,
    characters: usage.characterCost,
    at: Date.now(),
    streaming: response.headers.get("X-Lelu-Streaming"),
    modelLoads: headerNumber("X-Lelu-Model-Loads"),
    synthesisMs: headerNumber("X-Lelu-Synthesis-Ms"),
    profile: response.headers.get("X-Lelu-Worker-Profile"),
    coldStart: response.headers.get("X-Lelu-Cold-Start") === "1",
  };
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
    const buffered = response.headers.get("X-Lelu-Streaming") === "buffered";
    const rtf = headerNumber("X-Lelu-Worker-Rtf") ?? statusCache?.workerRtf ?? null;
    return {
      kind: "pcm",
      feed: new PcmFeed(response.body),
      // The header is the authority; 16 kHz is only a last resort.
      sampleRate: Number.isFinite(declared) && declared > 0 ? declared : 16_000,
      plan: buffered ? { expectedSeconds: estimateSpeechSeconds(text), rtf } : null,
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
  // iOS reports "interrupted" (a call, Siri, the screen locked) as well as "suspended".
  const state = sharedContext.state as string;
  if ((state === "suspended" || state === "interrupted") && !held) void sharedContext.resume().catch(() => {});
  return sharedContext;
}

/**
 * Unlock her streamed voice on iOS. Call synchronously inside the person's tap.
 *
 * Safari only lets an AudioContext play if it was created or resumed during a
 * user gesture. Streamed replies play through this shared context, which used
 * to be created lazily at her first reply — outside any gesture — so on an
 * iPhone it would have stayed suspended and she would have been silent. The
 * tap now creates/resumes it and plays one silent sample, which is what
 * WebKit requires. Cheap, so it runs on every tap.
 */
/** Try to bring her output back after the page returns (may need a tap on iOS). */
export function resumeOutputAudio(): void {
  const ctx = sharedContext;
  if (!ctx || held) return;
  const state = ctx.state as string;
  if (state === "suspended" || state === "interrupted") void ctx.resume().catch(() => {});
}

export function unlockOutputAudio(): void {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // an unlock that cannot play is retried on the next tap
  }
}

/**
 * The output context's state, as a fact for the diagnostic (M22.9/WP08).
 *
 * `unknown` before any context exists — the honest answer, because a browser
 * that has never opened an output context has not proven it can play.
 */
export function audioContextState(): "suspended" | "running" | "closed" | "unknown" {
  const ctx = sharedContext;
  if (!ctx) return "unknown";
  return ctx.state === "suspended" || ctx.state === "running" || ctx.state === "closed" ? ctx.state : "unknown";
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
    // "playing" is the browser's own report that samples reached the output
    // device, which is a later and more honest moment than handing over a URL.
    // Once: a held element fires "playing" again when it is resumed.
    let audible = false;
    audio.onplaying = () => {
      if (audible) return;
      audible = true;
      callbacks.onAudible?.();
    };
    callbacks.onStart?.();
    // A hold that lands before the audio has started rejects this play()
    // with AbortError ("interrupted by a call to pause()"). That is a pause,
    // not a failure: resumeSpeaking() plays the element again. Treating it as
    // a failure (found in the live run) marked her voice failed and handed
    // the reply to a different voice.
    void audio.play().catch((error: unknown) => {
      if (held && (error as { name?: string } | null)?.name === "AbortError") return;
      done(false);
    });
  });
}

/**
 * Play 16-bit mono PCM as it arrives.
 *
 * Each network chunk becomes one AudioBuffer scheduled after the previous
 * one, so playback is continuous and in order. From a worker that keeps up,
 * playback starts with the first chunk. From one slower than real time
 * (`plan`), chunks are held until the rest of the sentence can no longer
 * overtake playback (pcmStartReady): she starts about one sentence-length
 * sooner than with a whole WAV, and never in fragments. A stop halts every
 * scheduled source and cancels the stream, which ends the generation.
 */
async function playPcm(
  feed: PcmFeed,
  sampleRate: number,
  callbacks: SpeakCallbacks,
  plan: BufferedStartPlan | null = null,
): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) {
    feed.cancel();
    return false;
  }
  const sources: AudioBufferSourceNode[] = [];
  const pending: AudioBuffer[] = [];
  let stopped = false;
  let started = false;
  let endAt = ctx.currentTime;
  let tail = new Uint8Array(0);
  let producedSeconds = 0;
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
      feed.cancel();
    },
  };
  activePcm = handle;

  const schedule = (buffer: AudioBuffer) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    // Immediately after the previous chunk: continuous, never over it.
    const startAt = Math.max(ctx.currentTime + 0.02, endAt);
    source.start(startAt);
    endAt = startAt + buffer.duration;
    sources.push(source);
    if (!started) {
      started = true;
      callbacks.onStart?.();
      // Report the moment the first buffer is due to be heard, not queued.
      const delayMs = Math.max(0, Math.round((startAt - ctx.currentTime) * 1000));
      setTimeout(() => {
        if (!stopped) callbacks.onAudible?.();
      }, delayMs);
    }
  };

  const ready = (complete: boolean) => {
    if (!plan) return producedSeconds > 0;
    // Measured pace once there is enough of it; the server's RTF before that.
    const since = feed.firstAt === null ? 0 : (Date.now() - feed.firstAt) / 1000;
    const measured = since >= 1 && producedSeconds > 0 ? producedSeconds / since : null;
    const pace = measured ?? (plan.rtf && plan.rtf > 0 ? 1 / plan.rtf : null);
    return pcmStartReady({ producedSeconds, expectedSeconds: plan.expectedSeconds, pace, complete });
  };

  try {
    for await (const value of feed.chunks()) {
      if (stopped) break;
      const merged = new Uint8Array(tail.length + value.length);
      merged.set(tail);
      merged.set(value, tail.length);
      const usable = merged.length - (merged.length % 2);
      const samples = usable / 2;
      tail = merged.slice(usable);
      if (samples === 0) continue;
      const view = new DataView(merged.buffer, merged.byteOffset, usable);
      const buffer = ctx.createBuffer(1, samples, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples; index += 1) {
        channel[index] = view.getInt16(index * 2, true) / 32768;
      }
      producedSeconds += buffer.duration;
      if (started) {
        schedule(buffer);
        continue;
      }
      pending.push(buffer);
      if (ready(false)) for (const buffered of pending.splice(0)) schedule(buffered);
    }
    if (stopped || feed.failed) {
      if (!stopped) handle.stop();
      return false;
    }
    // The stream ended before the start rule fired: play what there is.
    if (!started && pending.length > 0 && ready(true)) for (const buffered of pending.splice(0)) schedule(buffered);
    if (!started) return false;
    // An output the browser will not run (iOS after an interruption, resumed
    // outside a tap) plays nothing: say so instead of reporting she spoke.
    const blockedSince = Date.now();
    while (!stopped && !held && (ctx.state as string) !== "running") {
      if (Date.now() - blockedSince > 1500) {
        handle.stop();
        return false;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    // Audio time, not wall time: a hold suspends the context, and the
    // segment must not be reported finished while it is paused.
    while (!stopped && ctx.currentTime < endAt) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(20, Math.ceil((endAt - ctx.currentTime) * 1000) + 20))),
      );
    }
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
  if (prepared.kind === "pcm") return playPcm(prepared.feed, prepared.sampleRate, callbacks, prepared.plan);
  return playBlob(prepared.blob, callbacks);
}

/** One pump plays the queue in order; synthesis already ran in parallel. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length > 0) {
      const segment = queue.shift() as QueuedSegment;
      if (segment.cancelled) {
        segment.settle();
        continue;
      }
      pumpSegment = segment;
      const audio = startSynthesis(segment);
      fillAhead();
      const prepared = await audio;
      if (segment.cancelled) {
        segment.settle();
        continue;
      }
      // Held (the person started talking over her): the next sentence waits
      // until the hold is released or the reply is stopped.
      await whileHeld();
      if (segment.cancelled) {
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
      else if (!segment.cancelled) segment.callbacks.onFail?.();
      else segment.callbacks.onEnd?.();
      segment.settle();
    }
  } finally {
    pumpSegment = null;
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
    const data = (await response.json()) as { configured?: unknown; workerRtf?: unknown };
    const configured = data.configured === true;
    const workerRtf = typeof data.workerRtf === "number" && Number.isFinite(data.workerRtf) ? data.workerRtf : null;
    statusCache = { at: now, configured, workerRtf };
    return configured;
  } catch {
    // Unreachable server is reported as unavailable, never assumed working.
    statusCache = { at: now, configured: false, workerRtf: null };
    return false;
  }
}

/** Reset the cached answer; used when a request fails mid-session. */
export function forgetElevenLabsStatus(): void {
  statusCache = null;
}

export interface SpeakCallbacks {
  onStart?: () => void;
  /**
   * Playback actually began on the output device (M22.9). Later than
   * `onStart`, which only means audio was handed to a player: the difference
   * is what a latency report must not hide.
   */
  onAudible?: () => void;
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
export function speakText(
  text: string,
  callbacks: SpeakCallbacks = {},
  delivery?: SpeechProfileId,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) {
    callbacks.onEnd?.();
    return Promise.resolve();
  }
  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  queue.push({ text: trimmed, delivery, audio: null, controller: null, callbacks, settled, settle });
  fillAhead();
  void pump();
  return settled;
}

/* -------------------------------- hold -------------------------------- *
 * Barge-in used to wait for the interrupting sentence to END and be
 * TRANSCRIBED before her audio stopped: she talked over the person for the
 * whole of their sentence plus a second or two. Now the microphone's voice
 * detector holds her the moment speech begins (holdSpeaking), and the
 * transcript decides: a real interruption stops her (stopSpeaking), and her
 * own voice coming back, a cough or nothing at all resumes her exactly where
 * she paused (resumeSpeaking). Nothing is discarded by a hold.
 * ----------------------------------------------------------------------- */

let held = false;
let holdWaiters: Array<() => void> = [];

function whileHeld(): Promise<void> {
  if (!held) return Promise.resolve();
  return new Promise<void>((resolve) => holdWaiters.push(resolve));
}

function releaseHold(resumeAudio: boolean): void {
  if (!held) return;
  held = false;
  if (resumeAudio) {
    // Held at its very end (found live): play() on an ended element starts it
    // over, and she said the sentence twice. Finish it instead.
    if (current && (current.ended || (Number.isFinite(current.duration) && current.currentTime >= current.duration - 0.05))) {
      const audio = current;
      queueMicrotask(() => audio.onended?.(new Event("ended")));
    } else if (current) void current.play().catch(() => finishCurrent?.());
    if (sharedContext && sharedContext.state === "suspended") void sharedContext.resume().catch(() => {});
  }
  const waiters = holdWaiters;
  holdWaiters = [];
  for (const resolve of waiters) resolve();
}

/** Is playback held for a possible interruption? */
export function isSpeechHeld(): boolean {
  return held;
}

/**
 * Pause her where she is, without discarding anything. Returns true when
 * there was audio to hold (something playing, or a sentence about to play).
 */
export function holdSpeaking(): boolean {
  if (held) return true;
  const audible = Boolean(current || activePcm);
  if (!audible && !pumpSegment && queue.length === 0) return false;
  held = true;
  if (current) {
    try {
      current.pause();
    } catch {
      // a player that cannot pause keeps playing; the transcript still decides
    }
  }
  // PCM chunks are scheduled on the shared output context: suspending it
  // pauses them in place.
  if (activePcm && sharedContext && sharedContext.state === "running") void sharedContext.suspend().catch(() => {});
  return true;
}

/** It was not an interruption: carry on from where she paused. */
export function resumeSpeaking(): void {
  releaseHold(true);
}

/** Stop whatever she is saying — barge-in, or a new reply taking over. */
export function stopSpeaking(): void {
  if (pumpSegment) pumpSegment.cancelled = true;
  for (const segment of queue) segment.cancelled = true;
  releaseHold(false);
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
  // Anything already synthesising behind it must not start afterwards, and
  // its request is aborted so the speech worker stops generating it.
  pumpSegment?.controller?.abort();
  for (const segment of queue.splice(0)) {
    segment.controller?.abort();
    segment.settle();
  }
  // A stop during a hold leaves nothing scheduled: the output context the
  // hold suspended is resumed so the next reply starts in a clean state.
  if (sharedContext && sharedContext.state === "suspended") void sharedContext.resume().catch(() => {});
}
