/**
 * ==========================================================
 * LÉLU — SPEECH DELIVERY (personality → how a sentence sounds)
 * ==========================================================
 *
 * Mission 22.9 / WP05.
 *
 * There is no second personality engine here. This reads the identity
 * LÉLU already develops (src/core/identity/LeluIdentity.ts — traits,
 * confidence, status, communication style) and answers one narrow
 * question: for THIS reply, which of the three deliveries in
 * speechProfile.ts should she use, and why?
 *
 * The two dimensions stay apart:
 *
 *   · COMMUNICATION STYLE is already decided upstream — vocabulary,
 *     structure, humour and directness come from her cognition and are
 *     her words. This file never edits, reorders or shortens them.
 *   · SPEECH DELIVERY is decided here, from her traits plus the
 *     REGISTER of the sentence (technical, playful, supportive…).
 *
 * The register is a reading of what the sentence is doing, not a mood
 * invented for her: it only selects a pace. Nothing is hardcoded into
 * individual sentences, and a reply whose register cannot be told falls
 * back to her default conversational delivery rather than to an emotion.
 *
 * Pure and dependency-free (a structural trait type, not an import) so
 * every rule is testable on the 30 representative replies the mission
 * requires, with no audio device, provider or browser.
 */

import { DEFAULT_SPEECH_PROFILE, speechProfile, type SpeechProfileId } from "./speechProfile";

/** What the reply is doing, based only on its own words. */
export type SpeechRegister =
  | "supportive"
  | "humorous"
  | "correction"
  | "serious"
  | "research"
  | "technical"
  | "excited"
  | "long-form"
  | "question"
  | "casual";

/** The part of a trait this decision may read — no storage, no methods. */
export interface DeliveryTrait {
  id: string;
  strength: number;
  confidence: number;
  /** LeluIdentity's TraitStatus; only developed traits may influence delivery. */
  status: string;
}

export interface DeliveryIdentity {
  traits?: readonly DeliveryTrait[];
  communicationStyle?: string;
}

export interface DeliveryDecision {
  profile: SpeechProfileId;
  register: SpeechRegister;
  /** Piper `--length_scale` for the chosen profile. */
  lengthScale: number;
  /** Pace as a percentage of baseline: 92 means 8% quicker than neutral. */
  pacePercentOfBaseline: number;
  /** One line a reviewer can check against the reply. */
  reason: string;
}

/**
 * A trait influences delivery only once the identity system itself
 * considers it developed (`emerging` or `established`). A candidate trait
 * is an observation, not a characteristic — letting it change her voice
 * would make a single conversation audible as a personality change, which
 * PersonalityGuard exists to prevent.
 */
const DEVELOPED = new Set(["emerging", "established", "evolving"]);

function traitWeight(identity: DeliveryIdentity, id: string): number {
  const trait = identity.traits?.find((item) => item.id === id);
  if (!trait || !DEVELOPED.has(trait.status)) return 0;
  // Strength says how much of it there is; confidence says how sure. Both
  // must be present before it can move her delivery.
  return trait.strength * trait.confidence;
}

const SUPPORTIVE = [
  /\bi'?m sorry\b/i,
  // Not "that sounds like a plan" — only a hard thing being acknowledged.
  /\bthat sounds (?:hard|rough|difficult|tough|exhausting|painful|awful)\b/i,
  /\bi hear you\b/i,
  /\btake your time\b/i,
  /\byou'?re not alone\b/i,
  /\bit'?s (?:okay|alright|fine)\b/i,
  /\btake care of yourself\b/i,
  /\bthat must (?:have been|be)\b/i,
];

const CORRECTION = [
  // Only a correction that opens a clause: "can actually prove" is not one.
  /(?:^|[.!?]\s+)actually\b/i,
  /\bcorrection\b/i,
  /\bi was wrong\b/i,
  /\bto be precise\b/i,
  /\bnot quite\b/i,
  /\bi need to correct\b/i,
  /\bthat'?s not right\b/i,
];

/**
 * A reply that is being careful about what is true. It is not a mood: it is
 * the register of an answer that refuses to overclaim, and it is read the
 * same way her other registers are.
 */
const SERIOUS = [
  // "honestly" alone is conversational filler, not a register.
  /\bthe honest (?:answer|truth)\b/i,
  /\bunverified\b/i,
  /\bblocked\b/i,
  /\blimitation/i,
  /\b(?:i|we) (?:will|can) not claim\b/i,
  /\bmust not claim\b/i,
  /\bbe careful\b/i,
  /\bwhat we can actually prove\b/i,
];

const RESEARCH = [
  /\bstudy\b/i,
  /\bevidence\b/i,
  /\bhypothesis\b/i,
  /\bfindings?\b/i,
  /\bdataset\b/i,
  /\bwe measured\b/i,
  /\bexperiment\b/i,
  /\bpeer[- ]reviewed\b/i,
];

const TECHNICAL = [
  /\b(?:function|class|module|api|endpoint|server|runtime|repository|commit|branch|test|suite|latency|buffer|schema|query)\b/i,
  /```/,
  /\b(?:tsc|npm|bun|git)\b/i,
  /\b\d+\s?(?:ms|milliseconds|seconds)\b/i,
];

const EXCITED = [/!{2,}/, /\b(?:amazing|incredible|finally|yes|wonderful|excellent|let'?s go)\b/i];

const HUMOROUS = [
  /\b(?:haha|heh|lol)\b/i,
  /\b(?:joke|funny|ridiculous|absurd)\b/i,
  /(?:^|\s):\)(?:\s|$)/,
  /😂|😄|😅|🤣/u,
];

function matches(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * What the sentence is doing. The order is a priority order and it is
 * deliberate: a supportive reply about a failed build is support first,
 * technical second, because comfort is the point of the sentence.
 */
export function classifyRegister(text: string): SpeechRegister {
  const trimmed = text.trim();
  if (!trimmed) return "casual";
  if (matches(SUPPORTIVE, trimmed)) return "supportive";
  if (matches(HUMOROUS, trimmed)) return "humorous";
  if (matches(CORRECTION, trimmed)) return "correction";
  if (matches(SERIOUS, trimmed)) return "serious";
  if (matches(RESEARCH, trimmed)) return "research";
  if (matches(TECHNICAL, trimmed)) return "technical";
  if (matches(EXCITED, trimmed)) return "excited";
  if (trimmed.length > 420) return "long-form";
  if (/\?\s*$/.test(trimmed)) return "question";
  return "casual";
}

/**
 * Which delivery this reply gets.
 *
 * The register proposes; her developed traits can overrule one step in
 * either direction, which is how her voice becomes recognisably HERS over
 * time without any sentence being scripted:
 *
 *   · developed playfulness pulls casual/humorous/question toward lively;
 *   · developed patience pulls any register toward measured.
 *
 * Ties resolve to the default conversational delivery — a reply is never
 * spoken in an emotion nobody chose.
 */
export function resolveSpeechDelivery(text: string, identity: DeliveryIdentity = {}): DeliveryDecision {
  const register = classifyRegister(text);
  const playfulness = traitWeight(identity, "playfulness");
  const patience = traitWeight(identity, "patience");

  const byRegister: Record<SpeechRegister, SpeechProfileId> = {
    supportive: "calm",
    humorous: "bright",
    correction: "calm",
    serious: "calm",
    research: "calm",
    technical: "calm",
    excited: "bright",
    "long-form": "calm",
    question: DEFAULT_SPEECH_PROFILE,
    casual: DEFAULT_SPEECH_PROFILE,
  };

  let profile = byRegister[register];
  let reason = `register ${register} → ${profile}`;

  if (profile === DEFAULT_SPEECH_PROFILE && playfulness >= 0.2) {
    profile = "bright";
    reason = `register ${register}; developed playfulness (${playfulness.toFixed(2)}) → bright`;
  } else if (profile === "bright" && patience >= 0.25) {
    profile = "calm";
    reason = `register ${register}; developed patience (${patience.toFixed(2)}) outranks playfulness (${playfulness.toFixed(2)}) → calm`;
  } else if (profile === "calm" && playfulness >= 0.3 && register === "excited") {
    profile = "bright";
    reason = `register ${register}; developed playfulness (${playfulness.toFixed(2)}) → bright`;
  }

  const chosen = speechProfile(profile);
  return {
    profile: chosen.id,
    register,
    lengthScale: chosen.lengthScale,
    pacePercentOfBaseline: Math.round(chosen.lengthScale * 100),
    reason,
  };
}
