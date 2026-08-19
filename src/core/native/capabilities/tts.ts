/**
 * ==========================================================
 * LÉLU
 * TEXT-TO-SPEECH CAPABILITY
 *
 * Speaks through the EXISTING VoiceEngine TTS pipeline
 * (chunked speechSynthesis with iOS gesture-warming, barge-in
 * and echo guard). No duplicate TTS system — this is the same
 * voice every LÉLU response already uses.
 * ==========================================================
 */

import type { NativeCapability, PermissionState } from "../NativeCapability";
import VoiceEngine from "../../voice/VoiceEngine";

function ttsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof speechSynthesis !== "undefined" &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export const ttsCapability: NativeCapability = {
  id: "tts.speak",
  title: "Text-to-Speech",
  category: "output",
  requiredPermission: null,
  unavailableReason:
    "speechSynthesis is not available in this browser.",
  isAvailable(): boolean {
    return ttsSupported();
  },
  permissionState(): PermissionState {
    return "authorized";
  },
  async execute(payload: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return { ok: false, error: "No text provided to speak." };
    }
    VoiceEngine.getInstance().unlockAudio();
    VoiceEngine.getInstance().speakResponse(text);
    return { ok: true, result: { spoken: true, length: text.length } };
  },
};
