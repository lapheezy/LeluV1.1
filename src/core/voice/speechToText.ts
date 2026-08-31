/**
 * ==========================================================
 * LÉLU
 * SPEECH-TO-TEXT — Groq Whisper Transcription
 * ==========================================================
 *
 * Sends audio blobs to Groq's Whisper endpoint for
 * transcription. This is the real transcription path used
 * by the microphone capability and the voice loop.
 *
 * Requires VITE_GROQ_API_KEY to be set.
 * ==========================================================
 */

import { providerFetchRaw } from "../../providers/aiRelay";

import type { VoiceErrorKind } from "./VoiceEngine";

/**
 * Classify a getUserMedia() rejection into a diagnosis LÉLU can act
 * on. "permission" must mean the user actually denied the mic — never
 * a stand-in for "no mic exists" (NotFoundError), "the mic is
 * busy/broken" (NotReadableError, TrackStartError), or "this
 * iframe/embed isn't allowed mic access at all" (SecurityError), each
 * of which needs a different fix from the user and previously all
 * surfaced as the same "permission denied".
 */
export function mapMediaError(error: { name?: string }): { kind: VoiceErrorKind; message: string } {
  switch (error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return { kind: "permission", message: "Microphone permission denied. Please allow mic access." };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { kind: "no-device", message: "No microphone was found on this device." };
    case "NotReadableError":
    case "TrackStartError":
      return { kind: "audio", message: "Microphone is unavailable — it may be in use by another app." };
    case "SecurityError":
      return { kind: "blocked-embed", message: "Microphone access is blocked in this embedded context." };
    default:
      return { kind: "error", message: `Microphone error: ${error.name ?? "unknown"}` };
  }
}

/**
 * A Groq key held by THIS runtime, if any.
 *
 * `import.meta.env.VITE_GROQ_API_KEY` is deliberately not read: Vite
 * inlines it into the client bundle, which is how transcription keys
 * ended up in the shipped VoiceEngine chunk. When nothing is held here
 * the request is relayed instead and the SERVER attaches the credential
 * (see providers/aiRelay.ts). The injected global remains for runtimes
 * that legitimately supply a key at runtime — verification scripts, and
 * native shells that hold their own credential.
 */
function getGroqApiKey(): string {
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_GROQ_API_KEY__?: string;
  };

  return runtimeEnv.__LELU_GROQ_API_KEY__?.trim() || "";
}

/** A speech-to-text failure classified into an actionable kind. */
export interface SttErrorDiagnosis {
  kind: "permission" | "service" | "error";
  message: string;
}

/**
 * Build the multipart form Groq's Whisper endpoint expects. Pulled out
 * of transcribeAudio() so the request shape (filename extension from
 * MIME type, model, optional language, verbose_json) is independently
 * testable without a network call.
 */
export function buildTranscriptionForm(audioBlob: Blob, model: string, language?: string): FormData {
  const formData = new FormData();

  // Determine filename extension from MIME type
  const mime = audioBlob.type || "audio/webm";
  const ext = mime.includes("wav")
    ? "wav"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("mp4") || mime.includes("m4a")
        ? "m4a"
        : "webm";

  formData.append("file", audioBlob, `recording.${ext}`);
  formData.append("model", model);

  if (language) {
    formData.append("language", language);
  }

  // Request verbose JSON for timestamps and confidence
  formData.append("response_format", "verbose_json");

  return formData;
}

/**
 * Extract the transcript from a parsed Whisper response body. Throws
 * when the shape doesn't carry usable text — an empty/missing
 * transcript is a real failure, never silently returned as "".
 */
export function parseTranscriptionResponse(data: unknown): string {
  const text =
    data && typeof data === "object" && typeof (data as { text?: unknown }).text === "string"
      ? (data as { text: string }).text.trim()
      : "";

  if (!text) {
    throw new Error("Whisper returned empty transcription.");
  }

  return text;
}

/**
 * Classify a Whisper HTTP failure status into an actionable kind —
 * "insufficient credits" and "rate limited" both need to be told
 * apart from "your key is bad", and from an unclassified provider
 * error, so the voice UI (and any future fallback) never lumps a
 * temporary rate limit in with the same message as a bad key.
 */
export function mapSttHttpError(status: number): SttErrorDiagnosis {
  if (status === 401 || status === 403) {
    return { kind: "permission", message: "The Groq credential was rejected — check GROQ_API_KEY on the server." };
  }
  if (status === 402) {
    return { kind: "service", message: "Groq account has insufficient credits for transcription." };
  }
  if (status === 429) {
    return { kind: "service", message: "Groq transcription is rate-limited — try again shortly." };
  }
  return { kind: "error", message: `Whisper transcription failed (${status}).` };
}

/**
 * Transcribe an audio Blob using Groq's Whisper API.
 * Accepts webm, ogg, wav, mp4, and m4a formats.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  language?: string,
): Promise<string> {
  const apiKey = getGroqApiKey();
  const formData = buildTranscriptionForm(audioBlob, "whisper-large-v3-turbo", language);

  // No local key is the normal case: the request is relayed same-origin
  // and the server attaches the credential. A 503 comes back when the
  // server has none either, and the caller reports that honestly.
  const response = await providerFetchRaw(
    "groq",
    "https://api.groq.com/openai/v1/audio/transcriptions",
    { apiKey, body: formData, signal: AbortSignal.timeout(30_000) },
  );

  if (!response.ok) {
    const diagnosis = mapSttHttpError(response.status);
    const errorText = await response.text();
    throw new Error(`${diagnosis.message} (${errorText})`);
  }

  const data = await response.json();
  return parseTranscriptionResponse(data);
}
