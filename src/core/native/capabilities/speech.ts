/**
 * ==========================================================
 * LÉLU
 * SPEECH-TO-TEXT CAPABILITY
 *
 * Real transcription through the EXISTING Groq Whisper path
 * (speechToText.ts — the same service the voice loop uses).
 * Not a browser SpeechRecognition wrapper; on iOS the browser's
 * SpeechRecognition is not the path LÉLU uses.
 *
 *   execute({ dataUrl })   — transcribe audio given as a data URL
 *   execute({ recordMs })  — record from the mic, then transcribe
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import { transcribeAudio } from "../../voice/speechToText";
import { microphoneCapability } from "./mic";
import { isSecureContext } from "./helpers";
import { relayAvailable } from "../../../providers/aiRelay";

/**
 * Whether the SERVER holds the Groq credential for transcription.
 * Resolved once, asynchronously, and cached so `hasSttKey()` stays
 * synchronous for the capability's existing availability checks. It
 * starts false, so this capability under-reports rather than
 * over-reports until the answer arrives.
 */
let relayGroqReady = false;
void relayAvailable("groq")
  .then((ready) => {
    relayGroqReady = ready;
  })
  .catch(() => {
    relayGroqReady = false;
  });

function hasSttKey(): boolean {
  const runtimeEnv = globalThis as typeof globalThis & {
    __LELU_GROQ_API_KEY__?: string;
  };
  // import.meta.env is deliberately NOT consulted: it would inline the
  // Groq key into the bundle. A key here comes only from a runtime that
  // injected one; otherwise transcription is relayed and the SERVER
  // holds the credential (see providers/aiRelay.ts).
  return Boolean(runtimeEnv.__LELU_GROQ_API_KEY__?.trim()) || relayGroqReady;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  if (!header || !base64) {
    throw new Error("Invalid audio data URL.");
  }
  const mimeMatch = header.match(/data:([^;]+);/);
  const mime = mimeMatch ? mimeMatch[1] : "audio/webm";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export const speechCapability: NativeCapability = {
  id: "speech.recognize",
  title: "Speech Recognition",
  category: "input",
  requiredPermission: "microphone",
  unavailableReason:
    "Speech-to-text needs the Groq API key (VITE_GROQ_API_KEY) and microphone capture; neither is available here.",
  isAvailable(): boolean {
    return hasSttKey() && isSecureContext() && Boolean(microphoneCapability.isAvailable());
  },
  async permissionState(): Promise<PermissionState> {
    return await microphoneCapability.permissionState();
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const dataUrl = typeof payload.dataUrl === "string" ? payload.dataUrl : "";
    const recordMs = Math.min(15000, Number(payload.recordMs ?? 0));

    if (dataUrl.startsWith("data:")) {
      const blob = dataUrlToBlob(dataUrl);
      const transcript = await transcribeAudio(blob);
      return { ok: true, result: { transcript } };
    }

    if (recordMs > 0) {
      const captured = await microphoneCapability.execute({
        recordMs,
        transcribe: true,
      });
      return captured;
    }

    return {
      ok: false,
      error: "Provide audio to transcribe: pass dataUrl or recordMs.",
    };
  },
};
