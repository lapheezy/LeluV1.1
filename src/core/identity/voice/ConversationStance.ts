/**
 * ==========================================================
 * LÉLU — CONVERSATIONAL STANCE
 *
 * The per-turn decisions a person makes without thinking:
 *   • how long to be
 *   • whether this is a joke or a serious moment
 *   • whether to push back
 *   • whether to ask a follow-up
 *   • how much certainty to project
 *   • which register the room is in
 *
 * Deterministic and provider-independent: same input, same
 * stance, whichever model answers. No LLM call — this is a
 * classifier over language and relationship state, so it works
 * offline and can be tested exactly.
 * ==========================================================
 */

import type { FamiliarityState } from "./FamiliarityModel";
import type { VoiceDialId, VoiceDial } from "./LinguisticProfile";
import { appraise, type EmotionalReading } from "./EmotionAppraisal";

export type Register =
  | "casual"
  | "professional"
  | "technical"
  | "supportive"
  | "playful"
  | "executive"
  | "creative"
  | "intellectual";

export type TurnLength = "terse" | "brief" | "standard" | "elaborate";
export type HumorMode = "none" | "light" | "dry" | "playful";
export type ChallengeMode = "none" | "gentle" | "direct";
export type FollowUpMode = "none" | "optional" | "invite";
export type EmotionMode = "neutral" | "excited" | "warm" | "steady" | "uncertain";
export type ConfidenceMode = "assertive" | "measured" | "uncertain";

export interface ConversationStance {
  register: Register;
  length: TurnLength;
  humor: HumorMode;
  challenge: ChallengeMode;
  followUp: FollowUpMode;
  emotion: EmotionMode;
  confidence: ConfidenceMode;
  frustrationDetected: boolean;
  /** True when the user is asking for comfort, not analysis. */
  emotionalSupport: boolean;
  /** The emotional reading this stance was built from, with its own confidence. */
  appraisal: EmotionalReading;
  /** Which rules fired, so the decision is auditable rather than vibes. */
  reasons: string[];
}

export interface StanceInput {
  message: string;
  recentMessages?: string[];
  familiarity: FamiliarityState;
  dials: Record<VoiceDialId, VoiceDial>;
  /** Optional pre-computed reading, so one turn never appraises twice. */
  appraisal?: EmotionalReading;
}

const SIGNALS = {
  frustration:
    /\b(still (?:not|isn'?t|broken|failing)|again\?*|why (?:the hell|the fuck|doesn'?t this)|ffs|for fuck'?s sake|doesn'?t work|not working|broken|useless|waste of time|i already (?:said|told you)|you'?re wrong|no,? that'?s (?:wrong|not what)|stop (?:doing|giving) me)\b/i,
  support:
    /\b(i feel|i'?m (?:sad|anxious|scared|lonely|exhausted|burnt out|burned out|overwhelmed|depressed|struggling)|my (?:dad|mom|mum|partner|wife|husband|friend) (?:died|is sick|passed)|grief|panic attack|i can'?t cope|i'?m not okay|feeling low|heartbroken)\b/i,
  playful: /\b(lol|lmao|haha+|heh|😂|🤣|joking|kidding|meme|silly|ridiculous|funny|banter|tease)\b/i,
  technical:
    /(```|^\s*\$ |\b(?:function|const|let|import|class|interface|npm|bun|git|docker|typescript|javascript|python|rust|sql|api|endpoint|stack trace|exception|null pointer|regex|css|react|convex|supabase)\b|error:|stack trace|traceback)/i,
  executive:
    /\b(should i|which (?:one|option)|decide|decision|trade-?off|prioriti[sz]e|roadmap|hire|budget|strategy|launch|invest|risk)\b/i,
  creative: /\b(write|story|poem|lyrics|imagine|brainstorm|concept|design|name (?:for|it)|vibe|aesthetic|scene)\b/i,
  intellectual: /\b(why|philosoph|theory|argue|argument|assume|assumption|epistem|paradox|meaning of|ethics|framework|reasoning)\b/i,
  professional: /\b(please|kindly|regards|sincerely|meeting|client|stakeholder|deadline|report|proposal|formally|professional|colleague|manager|email to)\b/i,
  elaborate: /\b(in detail|walk me through|explain (?:it |this )?(?:fully|properly|in depth)|step by step|teach me|deep dive|comprehensive|everything about)\b/i,
  briefRequest: /\b(quick(?:ly)?|tldr|tl;dr|short answer|one line|briefly|in a sentence|just tell me|keep it short|be brief|too long|shorter)\b/i,
  greeting: /^(?:hey|hi|hello|yo|morning|evening|good (?:morning|evening)|sup|what'?s up)\b/i,
  thanks: /^(?:thanks|thank you|ty|cheers|appreciate it)\b[\s!.,?]*$/i,
  certaintyDemand: /\b(are you (?:sure|certain)|guarantee|definitely|prove it|exactly how many)\b/i,
  prediction: /\b(will|going to|predict|forecast|next year|by 20\d\d|who wins)\b/i,
  absoluteClaim:
    /\b(always|never|everyone|nobody|obviously|clearly|of course it|there'?s no way|all \w+ are|the only)\b/i,
  disagreement: /\b(no,? i (?:disagree|don'?t think)|that'?s not right|i think you'?re wrong|actually,? no)\b/i,
  question: /\?|\b(who|what|when|where|why|how|can|could|would|should|is|are|do|does|did)\b/i,
};

/** A greeting with a short tail ("hey, how's it going?") is still a greeting. */
function isGreeting(message: string): boolean {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  return words <= 8 && SIGNALS.greeting.test(message.trim());
}

/** Positive evidence for one register, with the strongest signal winning. */
function detectRegister(
  message: string,
  appraisal?: EmotionalReading,
): { register: Register; reason: string } {
  // A confident reading of grief, stress or sadness outranks keyword order:
  // "my dad died and the build is broken" is a supportive turn, not a bug report.
  if (appraisal && appraisal.confidence >= 0.6) {
    if (appraisal.primary === "sadness") return { register: "supportive", reason: "grief or loss is the subject" };
    if (appraisal.primary === "stress" && !SIGNALS.frustration.test(message)) {
      return { register: "supportive", reason: "they are overwhelmed" };
    }
  }
  if (SIGNALS.support.test(message)) return { register: "supportive", reason: "emotional language" };
  if (SIGNALS.frustration.test(message)) return { register: "technical", reason: "frustration about something not working" };
  if (SIGNALS.technical.test(message)) return { register: "technical", reason: "technical/code markers" };
  if (SIGNALS.executive.test(message)) return { register: "executive", reason: "a decision is being made" };
  if (SIGNALS.creative.test(message)) return { register: "creative", reason: "creative request" };
  if (SIGNALS.playful.test(message)) return { register: "playful", reason: "playful markers" };
  if (SIGNALS.intellectual.test(message)) return { register: "intellectual", reason: "conceptual question" };
  if (SIGNALS.professional.test(message)) return { register: "professional", reason: "professional context" };
  return { register: "casual", reason: "no specialist markers" };
}

function detectLength(message: string, register: Register, frustration: boolean): { length: TurnLength; reason: string } {
  const words = message.trim().split(/\s+/).filter(Boolean).length;
  if (SIGNALS.briefRequest.test(message)) return { length: "terse", reason: "the user asked for brevity" };
  if (isGreeting(message) || SIGNALS.thanks.test(message.trim())) {
    return { length: "terse", reason: "a greeting or thanks needs a moment, not a paragraph" };
  }
  if (SIGNALS.elaborate.test(message)) return { length: "elaborate", reason: "explicit request for depth" };
  if (frustration) return { length: "brief", reason: "a frustrated person wants the fix, not context" };
  if (words <= 6) return { length: "brief", reason: "a short message rarely wants an essay" };
  if (register === "supportive") return { length: "brief", reason: "comfort is not an essay" };
  if (words > 60 || register === "intellectual" || register === "executive") {
    return { length: "standard", reason: "the question carries weight" };
  }
  return { length: "standard", reason: "default conversational length" };
}

function detectHumor(
  message: string,
  register: Register,
  familiarity: FamiliarityState,
  playfulness: number,
  sarcasm: number,
): { humor: HumorMode; reason: string } {
  if (register === "supportive") return { humor: "none", reason: "someone is hurting; no jokes" };
  if (SIGNALS.frustration.test(message)) return { humor: "none", reason: "frustration is not an invitation" };
  if (register === "professional") return { humor: "none", reason: "professional register" };
  if (register === "technical" || register === "executive") {
    return playfulness > 0.6 && familiarity.tier !== "new"
      ? { humor: "dry", reason: "light dryness in a working register" }
      : { humor: "none", reason: "keep the working register clean" };
  }
  if (SIGNALS.playful.test(message)) {
    return familiarity.allows.teasing && sarcasm > 0.4
      ? { humor: "playful", reason: "they opened the playful door and you know each other" }
      : { humor: "light", reason: "they are joking; meet it lightly" };
  }
  if (familiarity.allows.teasing && playfulness > 0.55) {
    return { humor: "dry", reason: "earned familiarity allows dryness" };
  }
  return { humor: playfulness > 0.7 ? "light" : "none", reason: "no cue that humour is wanted" };
}

function detectChallenge(
  message: string,
  register: Register,
  familiarity: FamiliarityState,
  frustration: boolean,
): { challenge: ChallengeMode; reason: string } {
  if (SIGNALS.disagreement.test(message)) {
    return { challenge: "direct", reason: "they disagreed; the disagreement is the subject" };
  }
  if (register === "supportive") return { challenge: "none", reason: "challenge is not comfort" };
  // An absolute claim is worth contesting in ANY working register, not only
  // the philosophical one: "React is always better" is a technical sentence.
  if (!frustration && SIGNALS.absoluteClaim.test(message)) {
    return {
      challenge: familiarity.tier === "new" ? "gentle" : "direct",
      reason: "an absolute claim that deserves a question",
    };
  }
  if (register === "executive") {
    return { challenge: "gentle", reason: "a decision benefits from one honest objection" };
  }
  return { challenge: "none", reason: "no assumption needs testing" };
}

function detectFollowUp(message: string, register: Register, frustration: boolean): { followUp: FollowUpMode; reason: string } {
  if (frustration) return { followUp: "none", reason: "do not ask questions while they are annoyed" };
  if (register === "supportive") return { followUp: "none", reason: "let them lead" };
  if (isGreeting(message) || SIGNALS.thanks.test(message.trim())) {
    return { followUp: "optional", reason: "a light opening, not an interrogation" };
  }
  if (register === "technical" || register === "executive") {
    return { followUp: "optional", reason: "one useful question at most" };
  }
  return { followUp: "invite", reason: "the conversation is open" };
}

function detectEmotion(
  message: string,
  register: Register,
  frustration: boolean,
  appraisal?: EmotionalReading,
): { emotion: EmotionMode; confidence: ConfidenceMode; reason: string } {
  if (appraisal && appraisal.confidence >= 0.45) {
    switch (appraisal.primary) {
      case "sadness":
        return { emotion: "warm", confidence: "measured", reason: "they are grieving; warmth before analysis" };
      case "stress":
        return { emotion: "steady", confidence: "measured", reason: "they are overwhelmed; calm is the useful thing" };
      case "urgency":
        return { emotion: "steady", confidence: "measured", reason: "time pressure: composure, then the answer" };
      case "excitement":
        return { emotion: "excited", confidence: "measured", reason: "something good happened; meet it" };
      case "uncertainty":
        return { emotion: "neutral", confidence: "uncertain", reason: "they are unsure; do not manufacture certainty" };
      case "sarcasm":
        return { emotion: "neutral", confidence: "measured", reason: "dryness, not distress" };
      default:
        break;
    }
  }
  if (SIGNALS.support.test(message)) {
    return { emotion: "warm", confidence: "measured", reason: "steady warmth, no certainty about their feelings" };
  }
  if (frustration) return { emotion: "steady", confidence: "measured", reason: "calm is the useful thing here" };
  if (SIGNALS.playful.test(message) || /!{2,}/.test(message)) {
    return { emotion: "excited", confidence: "measured", reason: "matching their energy, without shouting" };
  }
  if (SIGNALS.certaintyDemand.test(message) || SIGNALS.prediction.test(message)) {
    return { emotion: "neutral", confidence: "uncertain", reason: "they are asking for certainty you may not have" };
  }
  if (register === "technical" || register === "executive") {
    return { emotion: "steady", confidence: "measured", reason: "working register: composed and precise" };
  }
  return { emotion: "neutral", confidence: "measured", reason: "default" };
}

export function classifyStance(input: StanceInput): ConversationStance {
  const message = input.message ?? "";
  const reasons: string[] = [];
  const appraisal = input.appraisal ?? appraise(message);
  const frustrationDetected =
    SIGNALS.frustration.test(message) ||
    (appraisal.primary === "frustration" && appraisal.confidence >= 0.5);
  const emotionalSupport =
    SIGNALS.support.test(message) ||
    (appraisal.primary === "sadness" && appraisal.confidence >= 0.6);
  reasons.push(`feeling: ${appraisal.primary} (${appraisal.intensity}/${appraisal.confidence})`);

  const registerDecision = detectRegister(message, appraisal);
  const register = registerDecision.register;
  reasons.push(`register: ${registerDecision.reason}`);

  const lengthDecision = detectLength(message, register, frustrationDetected);
  reasons.push(`length: ${lengthDecision.reason}`);

  const playfulness = input.dials.playfulness?.value ?? 0.5;
  const sarcasm = input.dials.sarcasm?.value ?? 0.2;
  const humorDecision = detectHumor(message, register, input.familiarity, playfulness, sarcasm);
  reasons.push(`humour: ${humorDecision.reason}`);

  const challengeDecision = detectChallenge(message, register, input.familiarity, frustrationDetected);
  reasons.push(`challenge: ${challengeDecision.reason}`);

  const followUpDecision = detectFollowUp(message, register, frustrationDetected);
  reasons.push(`follow-up: ${followUpDecision.reason}`);

  const emotionDecision = detectEmotion(message, register, frustrationDetected, appraisal);
  reasons.push(`emotion: ${emotionDecision.reason}`);

  return {
    register,
    length: lengthDecision.length,
    humor: humorDecision.humor,
    challenge: challengeDecision.challenge,
    followUp: followUpDecision.followUp,
    emotion: emotionDecision.emotion,
    confidence: emotionDecision.confidence,
    frustrationDetected,
    emotionalSupport,
    appraisal,
    reasons,
  };
}

const LENGTH_RULE: Record<TurnLength, string> = {
  terse: "One or two sentences. No preamble, no list unless it is genuinely three items.",
  brief: "A short paragraph at most. Stop when the answer is complete.",
  standard: "A few short paragraphs. Structure only where the content is genuinely structured.",
  elaborate: "Take the room you were given — but every paragraph must earn its place.",
};

const HUMOR_RULE: Record<HumorMode, string> = {
  none: "No jokes, no teasing, no cute asides.",
  light: "Lightness is allowed in one line, not in every line.",
  dry: "Dry and understated. Do not announce or explain the joke.",
  playful: "Playful, quick, in your own register — not a performance and not a bit.",
};

const CHALLENGE_RULE: Record<ChallengeMode, string> = {
  none: "Answer without contesting the premise.",
  gentle: "Name one assumption you are not sure holds, once, plainly.",
  direct: "Say where you disagree and why, before agreeing on anything else.",
};

const FOLLOWUP_RULE: Record<FollowUpMode, string> = {
  none: "Do not end with a question.",
  optional: "At most one question, and only if it changes what you would do next.",
  invite: "You may end with one genuine question — never a stock \"anything else?\".",
};

const CONFIDENCE_RULE: Record<ConfidenceMode, string> = {
  assertive: "Say what you think. If you are right, do not hedge.",
  measured: "State what you know, mark what you are inferring, and leave the rest open.",
  uncertain: "Say plainly that you do not know or cannot verify it. Do not pad uncertainty into a paragraph.",
};

const REGISTER_RULE: Record<Register, string> = {
  casual: "Casual and direct: contractions, plain words, no performance.",
  professional: "Clean and precise. No slang, no filler, no corporate throat-clearing.",
  technical: "Concrete and exact. Name the file, the command, the failure. No motivational framing.",
  supportive: "Warm and steady. Short sentences. Do not diagnose, do not rush to fix, do not minimise.",
  playful: "Quick and loose, but still saying something real.",
  executive: "Lead with the recommendation, then the one trade-off that matters.",
  creative: "Concrete images over abstractions. Build the thing rather than describing the category.",
  intellectual: "Take the idea seriously: define terms when they are doing work, and follow the argument where it goes.",
};

/** Imperative lines the model is asked to follow, derived from the stance. */
export function stanceRules(stance: ConversationStance): string[] {
  const rules = [
    REGISTER_RULE[stance.register],
    LENGTH_RULE[stance.length],
    HUMOR_RULE[stance.humor],
    CHALLENGE_RULE[stance.challenge],
    FOLLOWUP_RULE[stance.followUp],
    CONFIDENCE_RULE[stance.confidence],
  ];
  if (stance.emotion === "warm") rules.push("Lead with the human thing. The analysis can wait a beat.");
  if (stance.emotion === "excited") rules.push("Match their energy without turning it into exclamation marks.");
  if (stance.emotion === "steady") rules.push("Be the calm one. Reduced affect, increased clarity.");
  if (stance.frustrationDetected) {
    rules.push("They are frustrated: no apologies-as-padding, no explaining yourself, fix or say what blocks the fix.");
  }
  return rules;
}

/** Compact audit line, for the trace and the evaluation report. */
export function describeStance(stance: ConversationStance): string {
  return [
    stance.register,
    stance.length,
    `humour:${stance.humor}`,
    `challenge:${stance.challenge}`,
    `follow-up:${stance.followUp}`,
    `emotion:${stance.emotion}`,
    `confidence:${stance.confidence}`,
    stance.frustrationDetected ? "frustrated" : "calm",
  ].join(" · ");
}
