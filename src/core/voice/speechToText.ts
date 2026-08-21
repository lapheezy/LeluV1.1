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

function getGroqApiKey(): string {
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_GROQ_API_KEY__?: string;
  };

  return (
    (
      (import.meta as unknown as { env?: Record<string, string | undefined> })
        .env ?? {}
    )["VITE_GROQ_API_KEY"]?.trim() ||
    runtimeEnv.__LELU_GROQ_API_KEY__?.trim() ||
    ""
  );
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

  if (!apiKey) {
    throw new Error(
      "No Groq API key configured. Set VITE_GROQ_API_KEY to enable speech-to-text.",
    );
  }

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
  formData.append("model", "whisper-large-v3-turbo");

  if (language) {
    formData.append("language", language);
  }

  // Request verbose JSON for timestamps and confidence
  formData.append("response_format", "verbose_json");

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Whisper transcription failed (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();

  // The API returns { text: "..." } or verbose_json format
  const text = typeof data?.text === "string" ? data.text.trim() : "";

  if (!text) {
    throw new Error("Whisper returned empty transcription.");
  }

  return text;
}
