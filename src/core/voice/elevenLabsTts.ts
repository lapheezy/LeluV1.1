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
let chain: Promise<void> = Promise.resolve();

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
 * Speak one segment and resolve when it finishes playing.
 *
 * Serialised: a second call queues behind the first, so streamed
 * sentences never overlap. An empty/failed segment calls onFail and
 * never silently pretends it spoke.
 */
export function speakText(text: string, callbacks: SpeakCallbacks = {}): Promise<void> {
  const run = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) {
      callbacks.onEnd?.();
      return;
    }
    let url = "";
    try {
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
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({ text: trimmed }),
        });
      } catch (error) {
        await gate.settle(reservation, { operation: "tts", ok: false, latencyMs: Date.now() - started, error: (error as Error).message });
        throw error;
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
      if (!response.ok) throw new Error(`tts ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("empty audio");
      url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      current = audio;
      callbacks.onStart?.();
      await new Promise<void>((resolve, reject) => {
        finishCurrent = resolve;
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("playback failed"));
        void audio.play().catch(reject);
      });
      callbacks.onEnd?.();
    } catch {
      // A request that just failed is not evidence the server lost her voice.
      // Forget the cached answer so the next attempt asks again instead of
      // trusting a stale "configured" for a minute.
      forgetElevenLabsStatus();
      callbacks.onFail?.();
    } finally {
      if (url) URL.revokeObjectURL(url);
      current = null;
      finishCurrent = null;
    }
  };
  chain = chain.then(run, run);
  return chain;
}

/** Stop whatever she is saying — barge-in, or a new reply taking over. */
export function stopSpeaking(): void {
  const audio = current;
  current = null;
  // Release the chain FIRST: a paused element fires no "ended", so the
  // segment being awaited is told it is over here instead of never.
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
