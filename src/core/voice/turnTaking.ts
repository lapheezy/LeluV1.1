/**
 * ==========================================================
 * LÉLU — WHEN HAS THE PERSON FINISHED SPEAKING?
 *
 * A fixed silence cannot tell a thinking pause from the end of a turn: at
 * 0.9 s, "What day comes after Monday? … One short sentence." (a 1.2 s pause
 * in the middle) became two turns, the second superseding her answer to the
 * first (measured in the live conversation runs).
 *
 * Endpointing in two layers:
 *   1. a short silence (SEGMENT_END_SILENCE_MS) closes a SEGMENT, which is
 *      transcribed at once;
 *   2. whether the TURN is over depends on what was said: a finished question
 *      or statement is handed to her soon after, an unfinished thought
 *      ("…and", "because", a trailing comma, "um") waits longer for the rest.
 *      If the person speaks again before the turn is handed over, the new
 *      segment joins the same turn.
 *
 * The transcription runs during the wait, so a finished question reaches her
 * no later than with the old fixed 0.9 s. Pure, so the rule is testable.
 * ==========================================================
 */

/** Silence that closes a segment (it is then transcribed straight away). */
export const SEGMENT_END_SILENCE_MS = 700;

export type TurnShape = "question" | "statement" | "unfinished";

/**
 * Further silence, after the segment closed, before the turn is handed over.
 * Totals after the last word: question 1.5 s, statement 1.6 s, unfinished
 * 2.7 s. Speech resuming is noticed within ~50-200 ms (the next segment
 * starts from the previous noise floor, and any sound above it pauses the
 * handover), so a pause of up to ~1.3 s after a finished question — the
 * 1.0-1.23 s pauses that split turns in the live runs — stays one turn.
 * Transcription runs during the wait, so this costs ~0.2 s over the old
 * fixed 0.9 s + transcription.
 */
export const TURN_GRACE_MS: Readonly<Record<TurnShape, number>> = {
  question: 800,
  statement: 900,
  unfinished: 2000,
};

/**
 * Words a finished thought does not end on: conjunctions, articles and
 * possessive determiners, fillers, and "of". Pronouns, auxiliaries and other
 * prepositions are left out on purpose: "is it?", "that's what it is.",
 * "where are you from?" and "turn it on." are all finished.
 */
const CONTINUATION_WORDS = new Set([
  "and", "but", "or", "nor", "so", "because", "cause", "since", "if", "although", "though", "unless", "whereas",
  "the", "a", "an", "my", "your", "our", "their", "its",
  "of",
  "um", "uh", "erm", "hmm", "mm", "er", "ah",
]);

/** Fillers that are a thinking pause even with a full stop after them. */
const FILLER_ONLY = /^(um+|uh+|erm+|hmm+|mm+|er+|ah+|so|well|okay so|and|but)[.,!?…\s]*$/i;

/**
 * What the words so far look like: a finished question, a finished
 * statement, or a thought that is not finished. Whisper punctuates even
 * fragments, so the last word matters as much as the last mark.
 */
export function turnShape(text: string): TurnShape {
  const trimmed = text.trim();
  if (!trimmed) return "unfinished";
  if (FILLER_ONLY.test(trimmed)) return "unfinished";
  // Trailing comma, dash, colon, semicolon, or an ellipsis: more is coming.
  if (/(?:[,;:—–-]|\.\.\.|…)$/.test(trimmed)) return "unfinished";
  const words = trimmed
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const last = words.at(-1) ?? "";
  if (/\?$/.test(trimmed)) return CONTINUATION_WORDS.has(last) && words.length > 2 ? "unfinished" : "question";
  if (/[.!]$/.test(trimmed)) return CONTINUATION_WORDS.has(last) && words.length > 1 ? "unfinished" : "statement";
  // No closing mark at all: Whisper heard it as cut off.
  return "unfinished";
}

/** How long to wait after the segment closed before handing the turn over. */
export function turnGraceMs(text: string): number {
  return TURN_GRACE_MS[turnShape(text)];
}

/** Join a continuation segment to the turn so far, as one line. */
export function joinSegments(previous: string, next: string): string {
  const a = previous.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  // A fragment ending in "..." loses the dots.
  const head = a.replace(/(?:\.\.\.|…)$/, "");
  // The word at the cut can be heard twice ("Tell me about the" + "The ocean…").
  const lastWord = head.split(/\s+/).at(-1)?.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "") ?? "";
  const tail = b.split(/\s+/);
  const firstWord = tail[0]?.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "") ?? "";
  const rest = lastWord && lastWord === firstWord ? tail.slice(1).join(" ") : b;
  return `${head} ${rest}`.replace(/\s+/g, " ").trim();
}
