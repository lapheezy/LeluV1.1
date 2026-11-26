/**
 * ==========================================================
 * LÉLU — WHAT THE VOICE IS ACTUALLY DOING, IN WORDS
 *
 * The engine's `phase` says whose turn it is: "speaking" begins when her
 * reply starts arriving, because the orb and the avatar move with her turn.
 * But with a speech worker slower than real time (VoxCPM2 on a CPU) her turn
 * holds 20 s or more of synthesis before a sound is heard, and a label that
 * said "Speaking" through all of it was a state that did not correspond to
 * the runtime. This maps the engine's real facts — phase, the TTS stage and
 * whether audio is playing — to the label shown beside the microphone.
 *
 * Pure, so the rule is testable without audio.
 * ==========================================================
 */

import type { VoicePhase, VoiceTtsStage } from "./VoiceEngine";

export type VoiceStatusKey =
  | "off"
  | "listening"
  | "paused"
  | "transcribing"
  | "thinking"
  | "generating"
  | "speaking"
  | "voice-failed";

export interface VoiceStatus {
  key: VoiceStatusKey;
  label: string;
  /** Her voice is being generated or played: a "stop speaking" control applies. */
  canStopSpeech: boolean;
}

export function voiceStatus(input: {
  active: boolean;
  phase: VoicePhase;
  captureSuspended?: boolean;
  ttsStage: VoiceTtsStage;
  audioPlaying: boolean;
}): VoiceStatus {
  const { active, phase, ttsStage, audioPlaying } = input;
  if (audioPlaying || ttsStage === "playing") return { key: "speaking", label: "Speaking", canStopSpeech: true };
  if (phase === "speaking") {
    if (ttsStage === "requested" || ttsStage === "generated") {
      return { key: "generating", label: "Generating her voice…", canStopSpeech: true };
    }
    if (ttsStage === "failed") return { key: "voice-failed", label: "Voice failed — the reply is in the chat", canStopSpeech: false };
    // Her reply text is still arriving and no sentence has gone to the voice yet.
    return { key: "thinking", label: "Thinking", canStopSpeech: false };
  }
  if (!active) return { key: "off", label: "", canStopSpeech: false };
  if (input.captureSuspended) return { key: "paused", label: "Microphone paused", canStopSpeech: false };
  if (phase === "processing") return { key: "transcribing", label: "Transcribing", canStopSpeech: false };
  if (phase === "responding") return { key: "thinking", label: "Thinking", canStopSpeech: false };
  if (ttsStage === "failed") return { key: "voice-failed", label: "Listening — her voice failed last turn", canStopSpeech: false };
  return { key: "listening", label: "Listening", canStopSpeech: false };
}
