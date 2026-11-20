/**
 * ==========================================================
 * LÉLU — SPEECH PROFILES (how a sentence is delivered)
 * ==========================================================
 *
 * Mission 22.9 / WP05. Her words are chosen by her cognition; this file
 * decides only HOW they sound: pace, variation, and how much air follows
 * a sentence. It is deliberately a small, closed, named set so that a
 * delivery choice is a decision with a name, not a number sprinkled
 * through the code, and so the identity layer can pick one without
 * knowing anything about a synthesiser's flags.
 *
 * WHY A TABLE AND NOT PER-REQUEST FLAGS
 *
 * Measured on the installed Piper (M22.9, piper-delivery-probe.sh):
 * `--length_scale` on the command line changes duration by ±8–15%, but
 * the SAME field sent on a `--json-input` request line is IGNORED — the
 * output duration only moves with generation noise (5.368 s / 5.224 s /
 * 5.224 s for 0.9 / 1.0 / 1.15, against 5.000 / 5.400 / 5.816 s from the
 * command line). Delivery therefore cannot be a per-request parameter of
 * a warm worker; each profile is its own warm worker, and switching
 * profile costs exactly one model load the first time it is used.
 *
 * Dependency-free on purpose: read from the browser bundle and from the
 * server plugin project (tsconfig.node.json, `nodenext`), like
 * voiceIdentity.ts. No credential, no device, no state.
 */

export type SpeechProfileId = "warm" | "calm" | "bright";

export interface SpeechProfile {
  id: SpeechProfileId;
  /** What this delivery is for, in her terms — not a vendor's. */
  label: string;
  /** Piper `--length_scale`: > 1 is slower, < 1 is faster. */
  lengthScale: number;
  /** Piper `--noise_scale`: variation in the generated prosody. */
  noiseScale: number;
  /** Piper `--noise_w`: variation in phoneme durations (liveliness). */
  noiseW: number;
  /** Piper `--sentence_silence`: air after each sentence, in seconds. */
  sentenceSilence: number;
  note: string;
}

/**
 * The three deliveries. Values are Piper's own flags, not invented
 * abstractions: every number here is one the synthesiser actually reads,
 * and each profile is validated by a measured duration in
 * MISSION-22.9/voice-candidate-comparison.md.
 */
export const SPEECH_PROFILES: Record<SpeechProfileId, SpeechProfile> = {
  warm: {
    id: "warm",
    label: "conversational",
    lengthScale: 1.0,
    noiseScale: 0.667,
    noiseW: 0.8,
    sentenceSilence: 0.2,
    note: "Her default speaking register: Piper's own neutral defaults, neither rushed nor ponderous.",
  },
  calm: {
    id: "calm",
    label: "measured",
    lengthScale: 1.12,
    noiseScale: 0.55,
    noiseW: 0.7,
    sentenceSilence: 0.3,
    note: "Technical, research and serious answers: slower, steadier, a little more air between sentences so a listener can follow.",
  },
  bright: {
    id: "bright",
    label: "lively",
    lengthScale: 0.92,
    noiseScale: 0.78,
    noiseW: 0.9,
    sentenceSilence: 0.14,
    note: "Playful, humorous and excited exchanges: quicker and more varied, so delight is audible rather than described.",
  },
};

export const SPEECH_PROFILE_IDS = Object.keys(SPEECH_PROFILES) as SpeechProfileId[];

export const DEFAULT_SPEECH_PROFILE: SpeechProfileId = "warm";

/** An untrusted value (a request body) narrowed to a profile id. */
export function isSpeechProfileId(value: unknown): value is SpeechProfileId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SPEECH_PROFILES, value);
}

/** The profile for an id, or the default — never undefined, never a guess. */
export function speechProfile(id: unknown): SpeechProfile {
  return SPEECH_PROFILES[isSpeechProfileId(id) ? id : DEFAULT_SPEECH_PROFILE];
}

/** Piper's argument list for one profile. Order is stable for tests. */
export function speechProfileArgs(profile: SpeechProfile): string[] {
  return [
    "--length_scale",
    profile.lengthScale.toFixed(2),
    "--noise_scale",
    profile.noiseScale.toFixed(3),
    "--noise_w",
    profile.noiseW.toFixed(2),
    "--sentence_silence",
    profile.sentenceSilence.toFixed(2),
  ];
}
