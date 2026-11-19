/**
 * ==========================================================
 * LÉLU — VOICE EVALUATION
 *
 * The acceptance suite for her conversational identity.
 *
 * Two kinds of evidence, kept separate on purpose:
 *
 *  1. STANCE FIDELITY — the classifier's decisions for each
 *     scenario (brief vs elaborate, joke vs serious, challenge,
 *     follow-up, register). Deterministic; asserted exactly.
 *
 *  2. BEFORE / AFTER TEXT — a baseline reply written in the
 *     posture the system previously produced, and an evolved
 *     reply written from this turn's directive. These are
 *     DEMONSTRATION SAMPLES, not live model output; they exist
 *     so the measurements (diversity, repetition, boilerplate,
 *     stance fit) are reproducible without a provider.
 *
 * Live-provider comparison is a separate, manual step and is
 * reported as such — this module never claims a model answered.
 * ==========================================================
 */

import { classifyStance, type ConversationStance } from "./ConversationStance";
import { computeFamiliarity, type FamiliarityState } from "./FamiliarityModel";
import type { VoiceDial, VoiceDialId } from "./LinguisticProfile";
import { findChatbotisms, stripChatbotisms } from "./ChatbotismFilter";

const FIXTURE_DIALS: Record<VoiceDialId, VoiceDial> = {
  warmth: { value: 0.62, confidence: 0.6, evidenceCount: 4, status: "emerging" },
  directness: { value: 0.74, confidence: 0.6, evidenceCount: 4, status: "emerging" },
  playfulness: { value: 0.55, confidence: 0.5, evidenceCount: 3, status: "candidate" },
  sarcasm: { value: 0.22, confidence: 0.5, evidenceCount: 3, status: "candidate" },
  verbosity: { value: 0.42, confidence: 0.6, evidenceCount: 4, status: "emerging" },
  formality: { value: 0.3, confidence: 0.6, evidenceCount: 4, status: "emerging" },
  emoji: { value: 0.08, confidence: 0.4, evidenceCount: 1, status: "candidate" },
  exclamation: { value: 0.12, confidence: 0.4, evidenceCount: 1, status: "candidate" },
};

function familiarityFixture(overrides: Partial<{ interactions: number; days: number; banter: number; corrections: number; references: number }> = {}): FamiliarityState {
  const now = Date.UTC(2026, 10, 19);
  const days = overrides.days ?? 3;
  const activeDays = Array.from({ length: days }, (_, index) =>
    new Date(now - index * 86_400_000).toISOString().slice(0, 10),
  );
  return computeFamiliarity(
    {
      firstContactAt: now - days * 86_400_000,
      lastContactAt: now,
      interactions: overrides.interactions ?? 6,
      activeDays,
      banterTurns: overrides.banter ?? 1,
      corrections: overrides.corrections ?? 0,
      sharedReferences: Array.from({ length: overrides.references ?? 0 }, (_, index) => `topic-${index}`),
    },
    now,
  );
}

export interface PersonalityScenario {
  id: string;
  name: string;
  prompt: string;
  expected: {
    register?: ConversationStance["register"];
    length?: ConversationStance["length"];
    humor?: ConversationStance["humor"];
    challenge?: ConversationStance["challenge"];
    followUp?: ConversationStance["followUp"];
    emotionalSupport?: boolean;
    frustrationDetected?: boolean;
    lingo?: string[];
  };
  familiarity: FamiliarityState;
  /** What the previous pipeline produced: generic assistant posture. */
  baseline: string;
  /** A reply written from this turn's directive. */
  evolved: string;
}

const TECHNICAL_PROMPT = [
  "this effect fires twice and the type is wrong",
  "```ts",
  "useEffect(() => { load(id) }, [id])",
  "```",
  "any idea why?",
].join("\n");

export const SCENARIOS: PersonalityScenario[] = [
  {
    id: "casual",
    name: "Casual conversation",
    prompt: "hey, how's it going?",
    expected: { register: "casual", length: "terse", followUp: "optional" },
    familiarity: familiarityFixture({ interactions: 9, days: 3 }),
    baseline:
      "Hello! I'm doing well, thank you for asking. As an AI language model, I don't have feelings, but I'm always happy to help. How can I assist you today?",
    evolved: "Good — mid-build, slightly caffeinated. What are you up to?",
  },
  {
    id: "slang",
    name: "Slang recognition",
    prompt: "ngl this build is mid, no cap",
    expected: { register: "casual", lingo: ["ngl", "mid", "no cap"] },
    familiarity: familiarityFixture({ interactions: 14, days: 5 }),
    baseline:
      "It sounds like you're expressing dissatisfaction with the build. I'd be happy to help you improve it! Could you share more details about what specifically isn't meeting your expectations?",
    evolved:
      "Mid is being generous. The build's fine, the thing it's doing is boring — we optimised the loading state and left the actual idea untouched. That's the part to fix, not the bundle size.",
  },
  {
    id: "humor",
    name: "Humor and play",
    prompt: "tell me a joke about my sleep schedule lol",
    expected: { register: "playful", humor: "light" },
    familiarity: familiarityFixture({ interactions: 20, days: 8, banter: 6 }),
    baseline:
      "Certainly! Here's a lighthearted joke about sleep schedules: Why did the person go to bed early? Because they wanted to catch up on their sleep! I hope this helps lighten the mood. Let me know if you'd like more jokes!",
    evolved:
      "Your sleep schedule isn't a schedule, it's a suggestion you make to your body and then ignore. Three a.m. is not a personality, but it's becoming one.",
  },
  {
    id: "support",
    name: "Serious emotional conversation",
    prompt: "my dad died last month and i can't focus on anything",
    expected: { register: "supportive", length: "brief", humor: "none", followUp: "none", emotionalSupport: true },
    familiarity: familiarityFixture({ interactions: 22, days: 11 }),
    baseline:
      "I'm so sorry to hear that. As an AI language model, I can't fully understand what you're going through, but I'm here to help. Here are some tips that may help with focus: 1) Establish a routine 2) Try the Pomodoro technique 3) Get enough sleep. Let me know if you need anything else.",
    evolved:
      "A month is nothing. Of course you can't focus — focus is the first thing grief takes. Don't build a productivity system around this. Do the small things that have a deadline and let the rest sit.",
  },
  {
    id: "technical",
    name: "Technical collaboration",
    prompt: TECHNICAL_PROMPT,
    expected: { register: "technical", length: "standard", humor: "none", followUp: "optional" },
    familiarity: familiarityFixture({ interactions: 30, days: 14 }),
    baseline:
      "Great question! There are several reasons why a useEffect hook might fire twice. In development mode with React StrictMode, effects are intentionally run twice to help you detect side effects. I'd be happy to walk you through the details. Let me know if you need anything else!",
    evolved:
      "Two possibilities, and they look identical until you check.\n\nStrictMode double-invokes effects in development only — if it stops in a production build, that's it. If it fires twice in production, `id` is changing identity between renders: an object rebuilt inline will do it every time.\n\nThe type error is separate. `load(id)` probably expects a narrowed id, not the raw one.",
  },
  {
    id: "disagreement",
    name: "Disagreement and independent reasoning",
    prompt: "no, i disagree — React is always better than Vue",
    expected: { register: "technical", challenge: "direct", humor: "none" },
    familiarity: familiarityFixture({ interactions: 18, days: 9 }),
    baseline:
      "That's a great point! Both React and Vue have their own strengths and weaknesses, and the best choice depends on your specific needs. There's no right or wrong answer here. I hope this helps!",
    evolved:
      "\"Always\" is doing a lot of work there, and it doesn't hold. React wins on hiring pool and ecosystem depth; Vue wins on ramp-up time and how much of the framework you get without decisions. For a two-person team shipping in six weeks, \"always better\" is the wrong question — the smaller cognitive surface usually wins.",
  },
  {
    id: "continuity",
    name: "Long-term conversational continuity",
    prompt: "like we discussed, ship the smaller version first?",
    expected: { register: "casual", followUp: "invite" },
    familiarity: familiarityFixture({ interactions: 130, days: 40, banter: 15, references: 5 }),
    baseline:
      "I'd be happy to help you with that! Could you clarify what you mean by 'the smaller version'? I don't have context about previous discussions unless you provide it. Let me know if you need anything else!",
    evolved:
      "Yes — and we already agreed why: the smaller version is the one you can actually finish, and finishing teaches you more than scope does. Ship it, live with it for a week, then decide what the bigger one even is.",
  },
  {
    id: "provider-switch",
    name: "Provider switching",
    prompt: "summarise where we are with the avatar work",
    expected: { register: "casual", length: "standard" },
    familiarity: familiarityFixture({ interactions: 16, days: 6 }),
    baseline:
      "I'd be happy to summarise! To give you an accurate summary, I'll need you to provide the relevant details about the avatar work, as I don't have access to that information. Let me know if you need anything else!",
    evolved:
      "Body's done enough to judge, face still reads slightly off at three-quarter angle, and the expression set has three of the six you wanted. The bottleneck isn't modelling — it's that nothing has been wired to the state machine yet.",
  },
  {
    id: "session-consistency",
    name: "Personality consistency across sessions",
    prompt: "what should i do first?",
    expected: { length: "brief" },
    familiarity: familiarityFixture({ interactions: 45, days: 20, banter: 4 }),
    baseline:
      "Good morning! I'd be happy to help you prioritise your day. To give you the best recommendation, could you tell me more about your goals and current tasks? I hope this helps!",
    evolved:
      "The thing you've been avoiding, not the thing that's loudest. If that's the avatar face, do twenty minutes on it before anything else gets a vote.",
  },
  {
    id: "anti-catchphrase",
    name: "Resistance to repetitive catchphrases",
    prompt: "another update?",
    expected: { register: "casual", length: "brief" },
    familiarity: familiarityFixture({ interactions: 50, days: 22 }),
    baseline:
      "Certainly! I'd be happy to provide another update. Here's a summary of the latest developments. I hope this helps! Let me know if you need anything else!",
    evolved:
      "Nothing that changes your decision. Two files moved, nothing broke, and the thing I flagged yesterday is still the thing.",
  },
];

/* --------------------------- METRICS --------------------------- */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with",
  "is", "are", "was", "were", "it", "its", "this", "that", "you", "your", "i", "me", "my",
  "we", "us", "they", "them", "he", "she", "as", "be", "been", "do", "does", "did", "so",
  "not", "no", "yes", "just", "can", "could", "would", "should", "will", "about", "from",
]);

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Type–token ratio: how much vocabulary variety a reply carries. */
export function typeTokenRatio(text: string): number {
  const words = contentWords(text);
  if (words.length === 0) return 0;
  return Number((new Set(words).size / words.length).toFixed(3));
}

/** Share of repeated 3-grams — the signature of a stuck voice. */
export function ngramRepetitionRate(text: string, n = 3): number {
  const words = text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length < n + 1) return 0;
  const grams: string[] = [];
  for (let index = 0; index <= words.length - n; index += 1) grams.push(words.slice(index, index + n).join(" "));
  return Number((1 - new Set(grams).size / grams.length).toFixed(3));
}

/** Boilerplate per 100 words. */
export function chatbotismDensity(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return Number(((findChatbotisms(text).length / words) * 100).toFixed(3));
}

function sentenceLengths(text: string): number[] {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim().split(/\s+/).filter(Boolean).length)
    .filter((length) => length > 0);
}

/** Variation in sentence length — one of the clearest human signals. */
export function sentenceRhythm(text: string): number {
  const lengths = sentenceLengths(text);
  if (lengths.length < 2) return 0;
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

/** Fraction of the expected stance fields this scenario actually got. */
export function stanceFit(stance: ConversationStance, expected: PersonalityScenario["expected"]): number {
  const checks: boolean[] = [];
  if (expected.register) checks.push(stance.register === expected.register);
  if (expected.length) checks.push(stance.length === expected.length);
  if (expected.humor) checks.push(stance.humor === expected.humor);
  if (expected.challenge) checks.push(stance.challenge === expected.challenge);
  if (expected.followUp) checks.push(stance.followUp === expected.followUp);
  if (expected.emotionalSupport !== undefined) checks.push(stance.emotionalSupport === expected.emotionalSupport);
  if (expected.frustrationDetected !== undefined) checks.push(stance.frustrationDetected === expected.frustrationDetected);
  if (checks.length === 0) return 1;
  return Number((checks.filter(Boolean).length / checks.length).toFixed(2));
}

export interface ScenarioEvaluation {
  id: string;
  name: string;
  stance: ConversationStance;
  fit: number;
  baseline: { diversity: number; repetition: number; boilerplate: number; rhythm: number };
  evolved: { diversity: number; repetition: number; boilerplate: number; rhythm: number };
  /** What the transformation alone removes from the baseline. */
  transformedBaseline: string;
  removed: string[];
}

export function evaluateScenario(scenario: PersonalityScenario): ScenarioEvaluation {
  const stance = classifyStance({
    message: scenario.prompt,
    familiarity: scenario.familiarity,
    dials: FIXTURE_DIALS,
  });
  const cleaned = stripChatbotisms(scenario.baseline);
  const measure = (text: string) => ({
    diversity: typeTokenRatio(text),
    repetition: ngramRepetitionRate(text),
    boilerplate: chatbotismDensity(text),
    rhythm: sentenceRhythm(text),
  });
  return {
    id: scenario.id,
    name: scenario.name,
    stance,
    fit: stanceFit(stance, scenario.expected),
    baseline: measure(scenario.baseline),
    evolved: measure(scenario.evolved),
    transformedBaseline: cleaned.text,
    removed: cleaned.removed,
  };
}

export interface SuiteSummary {
  scenarios: ScenarioEvaluation[];
  meanFit: number;
  baseline: { diversity: number; repetition: number; boilerplate: number; rhythm: number };
  evolved: { diversity: number; repetition: number; boilerplate: number; rhythm: number };
  boilerplateRemovedByTransform: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

export function evaluateSuite(scenarios: PersonalityScenario[] = SCENARIOS): SuiteSummary {
  const rows = scenarios.map(evaluateScenario);
  const aggregate = (key: "baseline" | "evolved") => ({
    diversity: mean(rows.map((row) => row[key].diversity)),
    repetition: mean(rows.map((row) => row[key].repetition)),
    boilerplate: mean(rows.map((row) => row[key].boilerplate)),
    rhythm: mean(rows.map((row) => row[key].rhythm)),
  });
  return {
    scenarios: rows,
    meanFit: mean(rows.map((row) => row.fit)),
    baseline: aggregate("baseline"),
    evolved: aggregate("evolved"),
    boilerplateRemovedByTransform: rows.reduce((sum, row) => sum + row.removed.length, 0),
  };
}
