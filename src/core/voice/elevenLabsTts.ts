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

/** How long a status answer is trusted before asking again. */
const STATUS_TTL_MS = 60_000;

let statusCache: { at: number; configured: boolean } | null = null;
let current: HTMLAudioElement | null = null;
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
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!response.ok) throw new Error(`tts ${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error("empty audio");
      url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      current = audio;
      callbacks.onStart?.();
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("playback failed"));
        void audio.play().catch(reject);
      });
      callbacks.onEnd?.();
    } catch {
      callbacks.onFail?.();
    } finally {
      if (url) URL.revokeObjectURL(url);
      current = null;
    }
  };
  chain = chain.then(run, run);
  return chain;
}

/** Stop whatever she is saying — barge-in, or a new reply taking over. */
export function stopSpeaking(): void {
  const audio = current;
  current = null;
  if (!audio) return;
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {
    // A player that cannot be stopped fails closed: it is already paused.
  }
}
