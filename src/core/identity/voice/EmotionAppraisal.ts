/**
 * ==========================================================
 * LÉLU — EMOTIONAL APPRAISAL
 *
 * Emotional intelligence is not a list of feelings with a
 * scripted reply attached. It is a READ of this message
 * (what is being expressed, how strongly, how sure we are)
 * followed by a DECISION about what kind of response helps.
 *
 * Two things this deliberately does that a template does not:
 *
 *   • it guards its own reading. A quoted complaint, a
 *     hypothetical, a joke, a negation ("not frustrated") or a
 *     past-tense feeling is not the same as the person being
 *     in that state now. Those cases lower CONFIDENCE rather
 *     than firing a response anyway.
 *   • it separates intensity from certainty, so "I'm furious
 *     lol" can be high intensity and low-confidence at once,
 *     and she can meet the joke without missing the annoyance.
 *
 * Deterministic and provider-independent: same message, same
 * reading, whichever model answers.
 * ==========================================================
 */

export type EmotionId =
  | "frustration"
  | "excitement"
  | "humor"
  | "sarcasm"
  | "disappointment"
  | "confusion"
  | "curiosity"
  | "seriousness"
  | "sadness"
  | "stress"
  | "uncertainty"
  | "playfulness"
  | "urgency"
  | "neutral";

export type ResponseMode =
  | "resolve"
  | "match"
  | "engage"
  | "meet-dry"
  | "steady"
  | "clarify"
  | "comfort"
  | "measured"
  | "terse";

export interface EmotionalReading {
  primary: EmotionId;
  /** Other emotions with real evidence in the same message. */
  secondary: EmotionId[];
  /** 0..1 — how strongly the feeling is expressed. */
  intensity: number;
  /** −1..+1 — negative to positive. */
  valence: number;
  /** 0..1 — how much the reading can be trusted. */
  confidence: number;
  /** The words that produced the reading, for auditability. */
  cues: string[];
  /** True when humour, quoting, negation or hypotheticals make the surface unreliable. */
  guarded: boolean;
  mode: ResponseMode;
  rules: string[];
}

interface Signal {
  id: EmotionId;
  pattern: RegExp;
  /** Base intensity when matched. */
  weight: number;
  mode: ResponseMode;
}

/**
 * Ordered by specificity: a bereavement phrase also contains
 * "sad", and the more specific reading must win.
 */
const SIGNALS: readonly Signal[] = [
  {
    id: "sadness",
    pattern:
      /\b(?:my (?:dad|mom|mum|father|mother|partner|wife|husband|brother|sister|friend|dog|cat) (?:died|passed (?:away)?|is dying|has cancer)|grief|funeral|miscarri(?:age|ed)|heartbroken|i'?m (?:devastated|broken)|lost (?:my|him|her))\b/i,
    weight: 0.95,
    mode: "comfort",
  },
  {
    id: "stress",
    pattern:
      /\b(?:overwhelmed|burnt out|burned out|can'?t cope|can'?t keep up|too much (?:on|right now)|panicking|panic attack|spirall?ing|exhausted|no time|deadline (?:is|was) (?:today|tomorrow)|everything at once)\b/i,
    weight: 0.8,
    mode: "steady",
  },
  {
    id: "frustration",
    pattern:
      /\b(?:still (?:not|isn'?t|doesn'?t)|again\?*|why (?:the hell|the fuck|doesn'?t this)|ffs|for fuck'?s sake|not working|doesn'?t work|broken|useless|waste of time|i already (?:said|told you)|third time|nothing works|gave up)\b/i,
    weight: 0.85,
    mode: "resolve",
  },
  {
    id: "disappointment",
    pattern:
      /\b(?:disappoint(?:ed|ing)|let ?down|shame|unfortunately|i expected|thought (?:it|you) would|not what i (?:hoped|wanted)|sadly)\b/i,
    weight: 0.6,
    mode: "steady",
  },
  {
    id: "urgency",
    pattern:
      /\b(?:asap|right now|immediately|urgent|emergency|in (?:five|5|ten|10) minutes|before (?:the )?(?:call|meeting|demo)|ship(?:ping)? today|due today)\b/i,
    weight: 0.75,
    mode: "terse",
  },
  {
    id: "confusion",
    pattern:
      /\b(?:i don'?t (?:get|understand)|confus(?:ed|ing)|what\?{2,}|how does (?:that|this) work|wait,? what|lost me|makes no sense|which one is it)\b|\?{2,}/i,
    weight: 0.65,
    mode: "clarify",
  },
  {
    id: "sarcasm",
    pattern:
      /\b(?:yeah,? right|sure,? because|oh,? (?:great|wonderful|fantastic)|thanks a lot|brilliant idea|what could possibly|because that always works|\/s\b|🙃)\b/i,
    weight: 0.7,
    mode: "meet-dry",
  },
  {
    id: "excitement",
    pattern:
      /\b(?:finally|it works|it worked|we did it|shipped|launched|yes+!|let'?s go|can'?t wait|so good|amazing|incredible)\b|!{2,}/i,
    weight: 0.7,
    mode: "match",
  },
  {
    id: "playfulness",
    pattern: /\b(?:lol|lmao|haha+|heh|😂|🤣|joking|kidding|meme|silly|ridiculous|banter|tease|bit of fun)\b/i,
    weight: 0.55,
    mode: "engage",
  },
  {
    id: "curiosity",
    pattern:
      /\b(?:i wonder|what if|how come|why (?:is|does|do)|what happens if|is it possible|curious|tell me more about|what'?s the difference)\b/i,
    weight: 0.5,
    mode: "engage",
  },
  {
    id: "uncertainty",
    pattern:
      /\b(?:i'?m not sure|maybe|i think so|possibly|no idea|not certain|might be|i guess|probably|can'?t remember)\b/i,
    weight: 0.45,
    mode: "measured",
  },
  {
    id: "seriousness",
    pattern:
      /\b(?:this is serious|not a joke|be straight with me|i need you to be honest|real talk|no bullshit|important decision|i'?m worried)\b/i,
    weight: 0.7,
    mode: "steady",
  },
  {
    id: "humor",
    pattern: /\b(?:joke|funny|hilarious|pun|comedy|make me laugh)\b/i,
    weight: 0.5,
    mode: "engage",
  },
] as const;

/** Surface cues that make a negative reading unreliable rather than certain. */
const HEDGE_PATTERNS: ReadonlyArray<{ pattern: RegExp; note: string }> = [
  { pattern: /\b(?:lol|lmao|haha+|😂|🤣)\b/i, note: "laughter alongside the complaint" },
  { pattern: /\b(?:just kidding|kidding|joking|not really|sort of|kinda)\b/i, note: "explicitly softened" },
  { pattern: /["“][^"”]{8,}["”]/, note: "the feeling is quoted, possibly someone else's" },
  { pattern: /\b(?:if|suppose|imagine|would|hypothetically)\b.*\b(?:sad|angry|frustrated|upset)\b/i, note: "hypothetical, not current" },
  { pattern: /\b(?:not|isn'?t|aren'?t|never)\s+(?:really\s+)?(?:angry|upset|frustrated|annoyed|sad|mad)\b/i, note: "explicitly disclaimed" },
  { pattern: /\b(?:yesterday|last (?:week|month|year)|used to|back then)\b/i, note: "past state, not necessarily now" },
  { pattern: /\b(?:my (?:friend|coworker|colleague|boss|kid|son|daughter))\b.*\b(?:angry|upset|sad|frustrated)\b/i, note: "describes someone else" },
];

/**
 * How each mode changes the response. Imperative, short, and
 * about what NOT to do as much as what to do — most failures
 * are the wrong reflex, not a missing technique.
 */
const MODE_RULES: Record<ResponseMode, string[]> = {
  resolve: [
    "They are frustrated: give the cause or the fix first.",
    "No apology loop, no explaining yourself, no questions they cannot answer yet.",
    "If they already told you the error, use it. Do not answer with a list of generic possible causes.",
  ],
  match: ["Match the energy without inflating it — one genuine note, not a celebration."],
  engage: ["Take the opening. Be interested in the thing itself, not in being interesting."],
  "meet-dry": ["They are being wry. Meet it dryly; do not answer the literal sentence earnestly."],
  steady: ["Be the calm one: lower affect, higher clarity.", "No cheerleading, no minimising."],
  clarify: ["They are lost. Re-order the explanation, shortest true version first.", "No new vocabulary until the old vocabulary is settled."],
  comfort: [
    "Presence before technique. Acknowledge what happened in one plain sentence.",
    "No lists, no diagnosis, no advice unless they ask for it.",
    'Do not use therapy stock phrases: no "I\'m really sorry you\'re going through this", no "I\'m here whenever you need to talk", no "that sounds really hard". Say the specific true thing instead.',
  ],
  measured: ["They are unsure. Separate what is known from what is being guessed."],
  terse: ["They are under time pressure: the answer first, the caveats after, nothing else."],
};

const NEGATIVE: ReadonlySet<EmotionId> = new Set([
  "frustration",
  "disappointment",
  "sadness",
  "stress",
  "confusion",
  "uncertainty",
  "sarcasm",
]);

const POSITIVE: ReadonlySet<EmotionId> = new Set(["excitement", "playfulness", "humor", "curiosity"]);

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number(value.toFixed(2))));
}

/**
 * Read one message. Never throws, never calls a model, and
 * returns a usable reading even for an empty string.
 */
export function appraise(message: string): EmotionalReading {
  const text = (message ?? "").trim();
  if (!text) {
    return {
      primary: "neutral",
      secondary: [],
      intensity: 0,
      valence: 0,
      confidence: 0.3,
      cues: [],
      guarded: false,
      mode: "steady",
      rules: MODE_RULES.steady,
    };
  }

  const found: Array<{ id: EmotionId; weight: number; mode: ResponseMode; cue: string }> = [];
  for (const signal of SIGNALS) {
    const match = signal.pattern.exec(text);
    if (!match) continue;
    found.push({ id: signal.id, weight: signal.weight, mode: signal.mode, cue: match[0] });
  }

  // Intensity modifiers: shouting and repetition raise it; a single
  // quiet sentence lowers it. Applied to the whole reading.
  const shouting = /\b[A-Z]{4,}\b/.test(text) && text === text.toUpperCase();
  const marks = (text.match(/[!?]/g) ?? []).length;
  const modifier = 1 + Math.min(0.3, marks * 0.05) + (shouting ? 0.1 : 0);

  const hedges = HEDGE_PATTERNS.filter((hedge) => hedge.pattern.test(text)).map((hedge) => hedge.note);
  const guarded = hedges.length > 0;

  const sorted = found.sort((a, b) => b.weight - a.weight);
  const primarySignal = sorted[0];
  const primary: EmotionId = primarySignal?.id ?? "neutral";
  const secondary = sorted.slice(1, 4).map((signal) => signal.id);

  const intensity = clamp((primarySignal?.weight ?? 0.2) * modifier * (guarded ? 0.75 : 1));
  const confidence = clamp(
    (primarySignal ? 0.55 + 0.1 * found.length : 0.35) - hedges.length * 0.12 + (primarySignal ? 0.1 : 0),
  );
  // A very short message has less evidence, whatever it says.
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const adjustedConfidence = clamp(confidence * (wordCount < 4 ? 0.8 : 1));

  const mode: ResponseMode = primarySignal?.mode ?? "steady";
  const valence =
    primary === "neutral" ? 0 : NEGATIVE.has(primary) ? -intensity : POSITIVE.has(primary) ? intensity : 0;

  const rules = [...MODE_RULES[mode]];
  if (guarded && NEGATIVE.has(primary)) {
    rules.push("The feeling may be softened or quoted: acknowledge it without treating it as an emergency.");
  }
  if (secondary.includes("sarcasm") && primary !== "sarcasm") {
    rules.push("There is dryness in the message — do not answer it with earnest reassurance.");
  }
  if (intensity > 0.8 && primary === "sadness") {
    rules.push("This is heavy. Do not try to resolve it in one reply.");
  }

  return {
    primary,
    secondary,
    intensity,
    valence,
    confidence: adjustedConfidence,
    cues: found.map((signal) => `${signal.id}: "${signal.cue}"`),
    guarded,
    mode,
    rules,
  };
}

/** One audit line, for the trace and the report. */
export function describeEmotion(reading: EmotionalReading): string {
  const parts = [
    reading.primary,
    reading.secondary.length ? `+${reading.secondary.join("/")}` : "",
    `intensity ${reading.intensity}`,
    `confidence ${reading.confidence}`,
    `mode:${reading.mode}`,
    reading.guarded ? "guarded" : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Whether this reading should change the shape of the reply at all. */
export function isActionable(reading: EmotionalReading): boolean {
  return reading.primary !== "neutral" && reading.confidence >= 0.45;
}
