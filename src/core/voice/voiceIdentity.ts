/**
 * ==========================================================
 * LÉLU — VOICE IDENTITY
 *
 * WHO she sounds like, kept apart from WHO synthesises it.
 *
 * Her voice used to be a constant inside plugins/voiceApi.ts, mixed
 * in with the request code that also chose a credential. That made
 * "switch account" and "switch voice" the same edit, and it meant a
 * resource-management change (rotation, cooldowns, allowance) could
 * silently alter her identity — the one thing that must never drift
 * when infrastructure changes.
 *
 * So identity lives here, and only here:
 *
 *   · voiceId      — Jessica, "Playful, Bright, Warm", American
 *   · modelId      — eleven_v3, the expressive model she speaks on
 *   · speakingStyle— stability / similarity / style / speaker boost
 *
 * Nothing in this file reads a credential, a key ring, a cooldown or
 * a quota. The synthesis layer (plugins/voiceApi.ts) reads THIS and
 * then decides which account to spend; swapping accounts changes the
 * invoice, never the speaker.
 *
 * The only permitted overrides are ELEVENLABS_VOICE_ID and
 * ELEVENLABS_MODEL_ID — an operator choosing a different voice on
 * purpose, not a side effect of rotation.
 *
 * This module deliberately imports nothing: it is read from both the
 * browser bundle and the server plugin project (tsconfig.node.json,
 * `nodenext`), and a dependency-free file is legal in both.
 * ==========================================================
 */

/** How she shapes a sentence. Values are ElevenLabs voice_settings. */
export interface VoiceSpeakingStyle {
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
}

export interface VoiceIdentity {
  /** Display name — her, not the vendor. */
  name: string;
  /** The synthesis backend that happens to implement this identity today. */
  provider: "elevenlabs";
  voiceId: string;
  modelId: string;
  speakingStyle: VoiceSpeakingStyle;
  /** Why this voice, so a future change is a decision and not a guess. */
  note: string;
}

/**
 * Jessica — "Playful, Bright, Warm", American, conversational. Chosen
 * from the 21 voices the account could actually reach, for a natural
 * feminine speaking register rather than an announcer.
 */
export const DEFAULT_VOICE_IDENTITY: VoiceIdentity = {
  name: "Lélu",
  provider: "elevenlabs",
  voiceId: "cgSgspJ2msm6clMCkdW9",
  modelId: "eleven_v3",
  speakingStyle: { stability: 0.4, similarityBoost: 0.8, style: 0.2, speakerBoost: true },
  note: "Jessica · Playful, Bright, Warm · American · conversational, not an announcer.",
};

/** Anything that resolves an environment name, like vite's envReader. */
export type IdentityEnvReader = (name: string) => string | undefined;

function readName(read: IdentityEnvReader | undefined, name: string): string {
  const raw = read ? read(name) : typeof process === "undefined" ? undefined : process.env[name];
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Her identity for this request.
 *
 * Deliberately independent of which ElevenLabs account (if any) will
 * speak: no credential name appears here, so exhausting, cooling or
 * replenishing an account cannot change her voice, model or style.
 */
export function resolveVoiceIdentity(read?: IdentityEnvReader): VoiceIdentity {
  return {
    ...DEFAULT_VOICE_IDENTITY,
    voiceId: readName(read, "ELEVENLABS_VOICE_ID") || DEFAULT_VOICE_IDENTITY.voiceId,
    modelId: readName(read, "ELEVENLABS_MODEL_ID") || DEFAULT_VOICE_IDENTITY.modelId,
    speakingStyle: { ...DEFAULT_VOICE_IDENTITY.speakingStyle },
  };
}

/** ElevenLabs' `voice_settings` shape, derived — never a second copy. */
export function voiceSettingsPayload(identity: VoiceIdentity): {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
} {
  return {
    stability: identity.speakingStyle.stability,
    similarity_boost: identity.speakingStyle.similarityBoost,
    style: identity.speakingStyle.style,
    use_speaker_boost: identity.speakingStyle.speakerBoost,
  };
}
