/**
 * ==========================================================
 * LÉLU
 * SPEECH-TO-TEXT — REAL AUDIO TRANSCRIPTION
 *
 * Replaces the browser SpeechRecognition dependency with a real
 * transcription service. Groq already exposes an OpenAI-compatible
 * API and is LÉLU's primary chat provider — its Whisper endpoint
 * (`whisper-large-v3`) accepts audio files with the SAME API key,
 * so no new credentials or provider architecture are needed.
 *
 *   audio Blob → POST api.groq.com/openai/v1/audio/transcriptions
 *             → { text: "..." } → transcript → existing chat route
 *
 * All key loading reuses the exact chain GroqProvider already
 * uses (Vite env → runtime/window injection → process env), so
 * the key is managed exactly like every other provider key in
 * this codebase. Never logged, never returned.
 * ==========================================================
 */

import type { VoiceErrorKind } from "./VoiceEngine";

export const GROQ_STT_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
export const STT_MODEL = "whisper-large-v3";
export const STT_TIMEOUT_MS = 30000;

/**
 * The ONE key-loading chain, identical to GroqProvider: Vite env,
 * runtime-injected global, window global, then process env. Never
 * logs or exposes the key itself.
 */
export function getGroqApiKey(): string {
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_GROQ_API_KEY__?: string;
  };
  const windowEnv =
    typeof window !== "undefined"
      ? (window as Window & { __LELU_GROQ_API_KEY__?: string })
      : undefined;
  const processEnv =
    typeof process !== "undefined" ? process.env : undefined;

  return (
    (import.meta.env.VITE_GROQ_API_KEY as string | undefined)?.trim() ||
    runtimeEnv.__LELU_GROQ_API_KEY__?.trim() ||
    windowEnv?.__LELU_GROQ_API_KEY__?.trim() ||
    processEnv?.GROQ_API_KEY?.trim() ||
    ""
  );
}

/** Build the multipart body for the Whisper endpoint (pure). */
export function buildTranscriptionForm(
  file: Blob,
  model: string = STT_MODEL,
  filename = "voice-recording.webm",
): FormData {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", model);
  return form;
}

/** Extract the transcript from the Whisper JSON response (pure). */
export function parseTranscriptionResponse(json: unknown): string {
  if (json && typeof json === "object") {
    const text = (json as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }
  throw new Error("Transcription returned no transcript.");
}

/** Map a fetch/HTTP failure to a precise, safe diagnosis (pure). */
export function mapSttHttpError(status: number): {
  kind: VoiceErrorKind;
  message: string;
} {
  switch (status) {
    case 401:
    case 403:
      return {
        kind: "permission",
        message:
          "Speech-to-text authentication failed (the Groq API key is invalid or missing). Text chat still works.",
      };
    case 402:
      return {
        kind: "service",
        message: "Speech-to-text is out of credits on the Groq account. Text chat still works.",
      };
    case 429:
      return {
        kind: "service",
        message: "Speech-to-text is rate limited right now. Try again in a moment.",
      };
    case 413:
      return {
        kind: "error",
        message: "The voice recording was too long to transcribe. Keep sentences shorter and try again.",
      };
    default:
      return {
        kind: "error",
        message: `Speech-to-text failed (HTTP ${status}). Text chat still works.`,
      };
  }
}

/** Map a getUserMedia failure to a precise diagnosis (pure). */
export function mapMediaError(error: unknown): {
  kind: VoiceErrorKind;
  message: string;
} {
  const name =
    (error as { name?: string } | null)?.name ?? "UnknownError";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        kind: "permission",
        message:
          "Microphone access is denied. If iOS shows Microphone = Allowed, open LÉLU in its own tab and tap the mic directly.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return {
        kind: "no-device",
        message: "No microphone was found on this device.",
      };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return {
        kind: "audio",
        message:
          "The microphone could not be opened — it may be in use by another app. Close other apps using the mic and try again.",
      };
    case "OverconstrainedError":
      return {
        kind: "audio",
        message: "No microphone matching the audio requirements was found.",
      };
    case "SecurityError":
      return {
        kind: "blocked-embed",
        message:
          "The browser blocked microphone access. Open LÉLU in its own tab (over HTTPS) and tap the mic directly.",
      };
    default:
      return {
        kind: "error",
        message: `Microphone access failed (${name}). Text chat still works.`,
      };
  }
}

/** Minimal fetch that the transcription path can use (kept injectable for tests). */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error(
      "Speech-to-text needs the Groq API key (VITE_GROQ_API_KEY). The microphone is working — text chat is unaffected.",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_STT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: buildTranscriptionForm(blob),
      signal: controller.signal,
    });

    if (!response.ok) {
      const mapped = mapSttHttpError(response.status);
      throw new Error(mapped.message);
    }

    const json: unknown = await response.json().catch(() => null);
    return parseTranscriptionResponse(json);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Speech-to-text timed out. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
