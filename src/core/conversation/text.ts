/**
 * ==========================================================
 * LÉLU — SMALL TEXT PRIMITIVES FOR CONVERSATIONAL COGNITION
 *
 * Deterministic, dependency-free helpers shared by the WP18 engines.
 * They exist so lexical judgements (relevance, contradiction,
 * fingerprinting) have ONE implementation instead of a slightly
 * different regex in every module.
 *
 * Nothing here calls a model, reads a store or writes anything.
 * ==========================================================
 */

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "being", "both",
  "could", "does", "doing", "down", "each", "from", "have", "here", "into",
  "just", "like", "made", "make", "many", "more", "most", "much", "must",
  "need", "only", "other", "over", "same", "should", "some", "such",
  "than", "that", "their", "them", "then", "there", "these", "they",
  "thing", "this", "those", "through", "under", "very", "want", "were",
  "what", "when", "where", "which", "while", "will", "with", "would",
  "your", "youre", "im", "ive", "dont", "cant", "wont", "isnt", "arent",
]);

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Lowercase, collapse whitespace, strip the punctuation that carries no meaning. */
export function normalize(text: string): string {
  return (text ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant words. Used for relevance and contradiction, never for grammar. */
export function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

/**
 * Words that carry no subject matter, for cases where short words do.
 *
 * `tokens()` deliberately drops anything under four characters, which
 * is right for relevance scoring and wrong for reversal detection:
 * “don't use SQLite” turns on “use”.
 */
const FUNCTION_WORDS = new Set([
  "the", "and", "but", "for", "nor", "not", "yet", "you", "your", "our",
  "its", "it", "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "has", "had", "have", "will", "would", "should",
  "could", "can", "may", "might", "must", "shall", "this", "that",
  "these", "those", "there", "their", "them", "they", "then", "than",
  "with", "from", "into", "about", "over", "under", "after", "before",
  "just", "also", "only", "very", "much", "some", "such", "each",
  "other", "what", "when", "where", "which", "while", "who", "how",
  "we", "us", "me", "my", "he", "she", "his", "her", "him",
  "dont", "doesnt", "didnt", "cant", "wont", "isnt", "arent", "lets",
]);

/** Subject-matter words, including short ones like "use" and "api". */
export function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 1 && !FUNCTION_WORDS.has(word));
}

/** How many significant words two strings share. */
export function overlap(a: string, b: string): number {
  const left = new Set(tokens(a));
  const right = new Set(tokens(b));
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared;
}

/** Shared words relative to the shorter text, 0..1. */
export function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.length === 0 || right.length === 0) return 0;
  return clamp01(overlap(a, b) / Math.min(left.length, right.length));
}

/**
 * A stable short id for a piece of text, so a repeated observation can
 * be recognised as the same observation. Not a security hash.
 */
export function fingerprint(...parts: string[]): string {
  const text = normalize(parts.join(" | "));
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(16)}:${text.slice(0, 60)}`;
}

export function shorten(text: string, max = 140): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** The first sentence, which is where a request usually states itself. */
export function firstSentence(text: string): string {
  const clean = (text ?? "").trim();
  const match = /^[^.!?\n]+[.!?]?/.exec(clean);
  return (match?.[0] ?? clean).trim();
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Does `current` appear to reverse something in `earlier`?
 *
 * Deliberately conservative. It requires shared subject matter and an
 * explicit reversal marker — "actually", "instead", "not X" or
 * "changed my mind" — because a false contradiction is worse than a
 * missed one: contradicting the user's position they never changed is
 * both wrong and irritating.
 */
export function findReversal(current: string, earlier: string): string | null {
  const earlierContent = new Set(contentWords(earlier));
  const shared = contentWords(current).filter((word) => earlierContent.has(word)).length;
  if (shared < 2) return null;

  const currentText = normalize(current);
  const earlierText = normalize(earlier);

  const marker = /\b(actually|instead|not|never|changed my mind|no longer|reverse|scrap|drop)\b/.test(currentText);
  if (!marker) return null;

  // "not X" against "X": the same subject, opposite polarity.
  //
  // The negated word is read from the phrase itself rather than from the
  // significant-token list, because that list deliberately drops short
  // words — and "don't use SQLite" turns on "use".
  const negated: string[] = [];
  for (const match of currentText.matchAll(
    /\b(?:not|never|no|dont|doesnt|shouldnt|wouldnt|stop)\s+([a-z0-9-]{3,})/g,
  )) {
    const word = match[1] ?? "";
    if (word && new RegExp(`\\b${word}\\b`).test(earlierText)) negated.push(word);
  }
  if (negated.length > 0) return earlier;

  // "instead of X" / "rather than X" naming something the earlier turn chose.
  const instead = /\b(?:instead of|rather than|drop|scrap)\s+([a-z0-9 -]{3,40})/.exec(currentText);
  if (instead && overlap(instead[1] ?? "", earlierText) >= 1) return earlier;

  return null;
}
