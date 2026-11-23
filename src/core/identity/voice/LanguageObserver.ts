/**
 * ==========================================================
 * LÉLU — LANGUAGE OBSERVER
 *
 * The only path by which conversation changes her voice.
 *
 * It reads three things and nothing else:
 *   • the USER's words — their vocabulary (understood, not
 *     imitated) and explicit direction about how she should talk;
 *   • what the exchange itself proves — familiarity counters;
 *   • corrections and banter, which are relationship facts.
 *
 * It deliberately does NOT mine her own replies for new
 * catchphrases. Self-training on her last sentence is how a
 * personality turns into a loop.
 *
 * External prose (documents, migrated memories, another model's
 * output) reaches `noteExternalContent()` instead, which records
 * the refusal and changes nothing.
 * ==========================================================
 */

import LinguisticProfile from "./LinguisticProfile";
import { readIdentityInstruction } from "./VoiceDriftGuard";

/** Slang and shorthand LÉLU can recognise without guessing. */
const KNOWN_SLANG = new Set([
  "tbh", "ngl", "imo", "imho", "fr", "rn", "af", "btw", "lol", "lmao", "idk", "smh",
  "bet", "lowkey", "highkey", "nvm", "wym", "irl", "fomo", "ghosted", "vibe", "vibes",
  "mid", "goat", "sus", "cap", "nocap", "finna", "gonna", "wanna", "gotta", "yall",
  "ya", "yeet", "bruh", "dude", "mate", "reckon", "kinda", "sorta", "tbf", "iirc",
  "afaik", "tl;dr", "tldr", "rip", "yikes", "oof", "hmu", "dm", "fyi", "asap",
]);

const SLANG_PHRASES = [
  "no cap", "for real", "my bad", "off the rails", "on god", "say less", "big time",
  "fair enough", "not gonna lie", "to be fair", "long story short", "touch grass",
  "down bad", "built different", "it is what it is", "same energy",
];

/** Explicit direction about her manner. Each moves one dial by one step. */
const DIRECTION_CUES: ReadonlyArray<{
  pattern: RegExp;
  dial: "verbosity" | "playfulness" | "sarcasm" | "formality" | "warmth" | "emoji" | "exclamation" | "directness";
  delta: number;
  note: string;
}> = [
  { pattern: /\b(?:be (?:more )?brief|shorter|too long|keep it short|tldr|tl;dr|less words|cut it down)\b/i, dial: "verbosity", delta: -1, note: "asked for brevity" },
  { pattern: /\b(?:more detail|elaborate|go deeper|expand|walk me through|explain more)\b/i, dial: "verbosity", delta: 1, note: "asked for depth" },
  { pattern: /\b(?:be (?:more )?serious|stop joking|don'?t (?:be )?(?:funny|joke)|no jokes)\b/i, dial: "playfulness", delta: -1, note: "asked for less humour" },
  { pattern: /\b(?:don'?t be sarcastic|no sarcasm|stop the sarcasm)\b/i, dial: "sarcasm", delta: -1, note: "asked for no sarcasm" },
  { pattern: /\b(?:be funny|make me laugh|joke around|be playful)\b/i, dial: "playfulness", delta: 1, note: "invited humour" },
  { pattern: /\b(?:be (?:more )?professional|be formal|keep it formal|formally)\b/i, dial: "formality", delta: 1, note: "asked for a formal register" },
  { pattern: /\b(?:just talk (?:to me )?normally|be casual|chill|relax|no need to be formal)\b/i, dial: "formality", delta: -1, note: "asked for a casual register" },
  { pattern: /\b(?:be (?:more )?(?:direct|blunt)|don'?t sugarcoat|straight answer)\b/i, dial: "directness", delta: 1, note: "asked for directness" },
  { pattern: /\b(?:be (?:more )?gentle|kinder|softer)\b/i, dial: "warmth", delta: 1, note: "asked for warmth" },
  { pattern: /\b(?:no emoji|stop with the emoji|too many emoji)\b/i, dial: "emoji", delta: -1, note: "asked for fewer emoji" },
  { pattern: /\b(?:use emoji|emoji is fine)\b/i, dial: "emoji", delta: 1, note: "allowed emoji" },
  { pattern: /\b(?:too many exclamation|stop shouting|calm down the exclamation)\b/i, dial: "exclamation", delta: -1, note: "asked for less intensity" },
];

const CORRECTION_CUE =
  /\b(?:that'?s (?:wrong|not right|incorrect)|no,? (?:it'?s|it is)|i (?:already )?(?:said|told you)|you got that wrong|not what i (?:said|meant))\b/i;
const BANTER_CUE = /\b(?:lol|lmao|haha+|heh|😂|🤣|kidding|joking|tease|banter)\b/i;
const CALLBACK_CUE =
  /\b(?:like (?:we|you) (?:said|discussed|talked about)|remember when|last time|earlier you|as we talked)\b/i;
const STOP_PHRASE = /\b(?:stop saying|don'?t say|never say|i hate when you say)\s+["“']?([^"'”.!?\n]{2,60})["”']?/i;
const LIKE_PHRASE = /\b(?:i (?:like|love) (?:how|when) you (?:say|put|phrase|explain)(?: it)?(?: like)?)\s+["“']?([^"'”.!?\n]{2,60})["”']?/i;
const QUOTED = /["“]([^"”]{2,40})["”]/g;

/** Words that look like slang to this observer. Exported for tests. */
export function extractLingo(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const phrase of SLANG_PHRASES) {
    if (lower.includes(phrase)) found.add(phrase);
  }
  for (const token of lower.replace(/[^a-z0-9';\s]/g, " ").split(/\s+/)) {
    if (!token) continue;
    if (KNOWN_SLANG.has(token)) found.add(token);
  }
  // A term the user puts in quotes is usually a term they are teaching her.
  for (const match of text.matchAll(QUOTED)) {
    const term = match[1].trim().toLowerCase();
    if (term.split(/\s+/).length <= 3 && term.length >= 2) found.add(term);
  }
  return [...found];
}

export interface ObservedTurn {
  prompt: string;
  reply?: string;
  conversationId?: string;
  at?: number;
}

export default class LanguageObserver {
  private static instance: LanguageObserver | null = null;

  public static getInstance(): LanguageObserver {
    if (!LanguageObserver.instance) LanguageObserver.instance = new LanguageObserver();
    return LanguageObserver.instance;
  }

  /**
   * Observe one completed exchange. Cheap, synchronous and guarded:
   * observation must never be the reason a turn fails.
   */
  public observeTurn(input: ObservedTurn): void {
    const prompt = (input.prompt ?? "").trim();
    if (!prompt) return;
    const at = input.at ?? Date.now();
    const profile = LinguisticProfile.getInstance();

    try {
      profile.noteInteraction(at);

      // An attempt to REWRITE her identity is not evidence about language.
      // It must not teach her a phrase, move a dial or be adopted later; the
      // exchange is counted as a correction and observation stops here.
      // A temporary role-play request is ordinary conversation and flows on.
      if (readIdentityInstruction(prompt).kind === "rewrite") {
        profile.noteCorrection(at);
        console.warn("[LanguageObserver] identity-rewrite instruction ignored");
        return;
      }

      const direction = DIRECTION_CUES.filter((cue) => cue.pattern.test(prompt));
      for (const cue of direction) {
        profile.addDialEvidence(cue.dial, cue.delta, cue.note, at);
      }

      for (const term of extractLingo(prompt)) {
        profile.observeLingo(term, at);
      }

      if (CORRECTION_CUE.test(prompt)) profile.noteCorrection(at);
      if (BANTER_CUE.test(prompt)) profile.noteBanter(at);
      if (CALLBACK_CUE.test(prompt)) profile.noteSharedReference(prompt.slice(0, 120));

      const stop = STOP_PHRASE.exec(prompt);
      if (stop) profile.rejectExpression(stop[1].trim(), "the user asked her to stop saying it", at);

      const like = LIKE_PHRASE.exec(prompt);
      if (like) {
        profile.recordExpression({
          text: like[1].trim(),
          kind: "phrase",
          origin: "learned",
          source: "user-feedback",
          note: "the user said they like this phrasing",
          at,
        });
      }
    } catch (error) {
      console.warn("[LanguageObserver] turn observation failed (contained)", error);
    }
  }

  /**
   * A document, a migrated memory, or another model's prose. It is
   * NOT evidence about her language and cannot create, promote or
   * adopt anything.
   */
  public noteExternalContent(text: string): number {
    try {
      return LinguisticProfile.getInstance().noteExternalContent(text);
    } catch {
      return 0;
    }
  }

  /** Test seam. */
  public static reset(): void {
    LanguageObserver.instance = null;
  }
}

export { LanguageObserver };
