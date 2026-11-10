/**
 * ==========================================================
 * LÉLU — VOXCPM2 VOICE IDENTITY ADAPTER
 *
 * Her own voice, cloned from the committed reference recording
 * (public/audio/voice/lelu-voice-reference.m4a) and served by
 * VoxCPM2 (openbmb/VoxCPM2, Apache-2.0).
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * -------------------------------
 * VoxCPM2 specifics — the reference profile, the transcript, the
 * endpoint shape, cancellation and single-flight rules — live here
 * and nowhere else. `elevenLabsTts.ts` is the only caller: it asks
 * "can her reference voice speak this?", and if the answer is no
 * the existing provider answers instead. Nothing in LÉLU's
 * cognition knows which engine produced the audio.
 *
 * WHAT IS AND IS NOT CLAIMED
 * --------------------------
 * The reference recording is NOT loaded into this browser tab: it
 * is loaded once, server-side, by the inference route
 * (plugins/voxcpmApi.ts). This module holds the identity (path,
 * transcript, sample rate) and verifies the asset is actually
 * reachable at the public path it claims, so a missing recording
 * is reported as missing rather than silently replaced by a
 * different voice. No stock voice is ever substituted.
 *
 * The transcript below is a machine transcription of the
 * committed recording (Whisper base + small agreed on it), not a
 * hand-copied one; see docs/voice/MISSION_2_VOICE_IDENTITY_REPORT.md
 * for how it was obtained and which word remains uncertain.
 * ==========================================================
 */

import { LELU_VOICE_IDENTITY } from "../voiceIdentity";

// Re-exported so a caller that already speaks to the adapter keeps one import.
export { LELU_VOICE_IDENTITY };
export type { VoiceIdentity } from "../voiceIdentity";

const REFERENCE_ENDPOINT = "/api/voice/voxcpm/tts";
const STATUS_ENDPOINT = "/api/voice/voxcpm/status";

/** How long a status answer is trusted before asking the server again. */
const STATUS_TTL_MS = 60_000;

export interface VoxCpmHealth {
  /** The server can actually synthesise with her reference voice right now. */
  configured: boolean;
  /** The reference WAV the route will condition on is present and readable. */
  referenceLoaded: boolean;
  /** The operator has attested they hold the rights to this voice. */
  consentAttested: boolean;
  model: string | null;
  referenceFile: string | null;
  referenceBytes: number | null;
  detail: string;
  /** True only when the inference server itself was contacted. */
  contacted: boolean;
}

const UNKNOWN: VoxCpmHealth = {
  configured: false,
  referenceLoaded: false,
  consentAttested: false,
  model: null,
  referenceFile: null,
  referenceBytes: null,
  detail: "VoxCPM2 status has not been asked yet.",
  contacted: false,
};

let statusCache: { at: number; health: VoxCpmHealth } | null = null;

/** Diagnostics for the last generation: measured, never estimated. */
export interface VoxCpmGeneration {
  /** Request start → first audio byte. */
  timeToFirstByteMs: number | null;
  /** Request start → complete audio in hand. */
  totalMs: number;
  bytes: number;
  at: number;
  ok: boolean;
}

let lastGeneration: VoxCpmGeneration | null = null;
export function getLastVoxCpmGeneration(): VoxCpmGeneration | null {
  return lastGeneration;
}

/**
 * Ask the server whether her reference voice can speak right now.
 * A failure is reported as "no", never assumed working.
 */
export async function voxCpmStatus(force = false): Promise<VoxCpmHealth> {
  if (typeof window === "undefined" || typeof fetch !== "function") return UNKNOWN;
  const now = Date.now();
  if (!force && statusCache && now - statusCache.at < STATUS_TTL_MS) return statusCache.health;
  try {
    const response = await fetch(STATUS_ENDPOINT, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const data = (await response.json()) as Partial<VoxCpmHealth> & { detail?: unknown };
    const health: VoxCpmHealth = {
      configured: data.configured === true,
      referenceLoaded: data.referenceLoaded === true,
      consentAttested: data.consentAttested === true,
      model: typeof data.model === "string" ? data.model : null,
      referenceFile: typeof data.referenceFile === "string" ? data.referenceFile : null,
      referenceBytes: typeof data.referenceBytes === "number" ? data.referenceBytes : null,
      detail: typeof data.detail === "string" ? data.detail : "",
      contacted: true,
    };
    statusCache = { at: now, health };
    return health;
  } catch {
    const health: VoxCpmHealth = {
      ...UNKNOWN,
      detail: "The VoxCPM2 status route could not be reached; her reference voice is treated as unavailable.",
    };
    statusCache = { at: now, health };
    return health;
  }
}

/** Cheap gate for the speech layer: can this voice answer? */
export async function voxCpmReady(): Promise<boolean> {
  return (await voxCpmStatus()).configured;
}

/** Forget the cached answer — used after a generation failure. */
export function forgetVoxCpmStatus(): void {
  statusCache = null;
}

export interface VoxCpmSpeakOptions {
  /** Called when playback of this segment actually begins. */
  onStart?: () => void;
  signal?: AbortSignal;
}

export interface VoxCpmSpeakOutcome {
  /** Audio was produced AND playback started. */
  spoke: boolean;
  /** Why not, when `spoke` is false. Empty when it spoke. */
  detail: string;
}

let current: HTMLAudioElement | null = null;
/**
 * Resolves the awaited segment. Pausing an element fires neither
 * "ended" nor "error", so without this a stop would leave the
 * serialised chain pending forever — every later reply would queue
 * behind a promise that never settles (the same defect that was
 * found live in the ElevenLabs path).
 */
let finishCurrent: (() => void) | null = null;
let chain: Promise<void> = Promise.resolve();
let generation = 0;

function stopCurrentPlayback(): void {
  const audio = current;
  current = null;
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
}

/**
 * Stop whatever she is saying — barge-in, a new reply taking over,
 * or the user leaving voice mode. Also invalidates any queued
 * generation so a cancelled reply never speaks late (stale audio).
 */
export function stopVoxCpm(): void {
  generation += 1;
  stopCurrentPlayback();
}

/**
 * Speak one segment with her reference voice.
 *
 * Serialised through `chain`: two segments can never play over each
 * other, which is what keeps a streamed reply intelligible. If the
 * service is unavailable or the generation fails, the outcome says
 * so and the caller falls back — it never plays silence or a
 * different voice while claiming to be hers.
 */
export function speakWithVoxCpm(
  text: string,
  options: VoxCpmSpeakOptions = {},
): Promise<VoxCpmSpeakOutcome> {
  let outcome: VoxCpmSpeakOutcome = { spoke: false, detail: "not attempted" };
  const run = async (): Promise<void> => {
    outcome = await runGenerate(text, options);
  };
  chain = chain.then(run, run);
  return chain.then(() => outcome);
}

async function runGenerate(text: string, options: VoxCpmSpeakOptions): Promise<VoxCpmSpeakOutcome> {
  const trimmed = text.trim();
  if (!trimmed) return { spoke: false, detail: "nothing to speak" };
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return { spoke: false, detail: "no browser runtime" };
  }
  const mine = generation;
  const started = Date.now();
  let url = "";
  try {
    const response = await fetch(REFERENCE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/wav" },
      body: JSON.stringify({ text: trimmed, voiceIdentity: LELU_VOICE_IDENTITY.id }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) {
      const reason = await readFailure(response);
      lastGeneration = {
        timeToFirstByteMs: null,
        totalMs: Date.now() - started,
        bytes: 0,
        at: Date.now(),
        ok: false,
      };
      statusCache = null;
      return { spoke: false, detail: reason };
    }
    // Time to first audio byte: measured off the body reader, so it is
    // the network's real answer rather than the completion time.
    let firstByteAt: number | null = null;
    const blob = await readAudio(response, () => {
      if (firstByteAt === null) firstByteAt = Date.now();
    });
    if (!blob || blob.size === 0) {
      lastGeneration = { timeToFirstByteMs: null, totalMs: Date.now() - started, bytes: 0, at: Date.now(), ok: false };
      return { spoke: false, detail: "the service returned empty audio" };
    }
    if (mine !== generation) {
      // A stop landed while the audio was in flight: this reply is stale.
      return { spoke: false, detail: "cancelled before playback" };
    }
    url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    await new Promise<void>((resolve, reject) => {
      finishCurrent = resolve;
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("playback failed"));
      void audio.play().catch(reject);
    });
    if (mine === generation) options.onStart?.();
    lastGeneration = {
      timeToFirstByteMs: firstByteAt === null ? null : firstByteAt - started,
      totalMs: Date.now() - started,
      bytes: blob.size,
      at: Date.now(),
      ok: true,
    };
    return { spoke: true, detail: "" };
  } catch (error) {
    lastGeneration = {
      timeToFirstByteMs: null,
      totalMs: Date.now() - started,
      bytes: 0,
      at: Date.now(),
      ok: false,
    };
    return { spoke: false, detail: error instanceof Error ? error.message : String(error) };
  } finally {
    if (url) URL.revokeObjectURL(url);
    current = null;
    finishCurrent = null;
  }
}

/** Read the response body, reporting the first byte and the total size. */
async function readAudio(
  response: Response,
  onFirstByte: () => void,
): Promise<Blob | null> {
  const type = response.headers.get("content-type") ?? "audio/wav";
  if (!response.body) {
    const blob = await response.blob();
    onFirstByte();
    return blob;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let announced = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (!announced) {
      announced = true;
      onFirstByte();
    }
    parts.push(value);
    total += value.length;
  }
  // One backing buffer: a Blob built from many views would need each view's
  // buffer widened, and the audio is small enough to copy once.
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return new Blob([merged], { type });
}

async function readFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; detail?: unknown };
    const message = typeof payload.error === "string" ? payload.error : typeof payload.detail === "string" ? payload.detail : "";
    return message || `her reference voice refused the request (HTTP ${response.status})`;
  } catch {
    return `her reference voice refused the request (HTTP ${response.status})`;
  }
}
