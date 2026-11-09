/**
 * ==========================================================
 * LÉLU — WHAT A PROMPT ASKS FOR, WITHOUT LOSING WHAT IT SAYS
 *
 * Mission 10.1 found a prompt reaching the model with its subject gone. The
 * cause was here: `ResearchResolver.buildQuery` removed anything its filler
 * list matched — including "find", "could" and the accented name LÉLU — and
 * then cut the result at 120 characters, mid-word. A research request about
 * "a maintained open-source library … typo-tolerant search" became
 * "maintained … typo-tolerant search. Compare relevant candidates, inspect
 * their licenses, and rec", and the repository nothing named was never found.
 *
 * Two rules replace that:
 *
 *   1. PROTECTED SPANS SURVIVE. A URL, an `owner/name`, a backticked token, a
 *      dotted/underscored identifier or an ALL-CAPS name is never removed and
 *      never cut through. Those are the things a search can actually find.
 *   2. NOTHING IS DROPPED SILENTLY. Leading conversational scaffolding ("can
 *      you please") may be lifted, and a long query may be shortened at a word
 *      boundary, but the caller is told exactly what was left out.
 *
 * An instruction — two sentences, or a request to compare/approve/acquire — is
 * not a search phrase at all, so its wording is kept as written.
 * ==========================================================
 */

export interface QuerySubject {
  /** What to search for. Never a mid-word fragment. */
  query: string;
  /** Phrases lifted from the front, in order, so a caller can report them. */
  removedPrefix: string[];
  /** Words at the end not included because of the length ceiling. */
  omittedTail: string[];
  /** URLs, owner/name pairs, quoted and code-like tokens the query keeps. */
  protectedSpans: string[];
  /** `verbatim` when the prompt was treated as an instruction. */
  method: "verbatim" | "scaffolding-removed";
  /** Whether the query was shortened at a word boundary. */
  shortened: boolean;
}

/** Phrases a person says *around* a request; they carry no searchable content. */
const LEADING_SCAFFOLDING: RegExp[] = [
  /^(?:hey|hi|hello)[\s,!.]+/i,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?/i,
  /^(?:please\s+)?(?:tell|show|give|send)\s+me\s+(?:about\s+)?/i,
  /^(?:please\s+)?(?:find|search\s+for|look\s+up|look\s+for|research|discover)\s+/i,
];

/** Proof that a prompt is a task, not a phrase to hand a search engine. */
const INSTRUCTION =
  /\b(?:approve|approval|authori[sz]e|acquire|commit|integrate|adapt|do not|don't|must|required|constraint|compare|inspect|recommend|evaluate|verify|run (?:the |its )?tests?)\b/i;

/** URLs, `owner/name`, `code`, identifiers and ALL-CAPS names. */
export function protectedSpans(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)"'<>]+/g)) found.add(match[0]);
  for (const match of text.matchAll(/`([^`]+)`/g)) found.add(match[1] ?? "");
  for (const match of text.matchAll(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*(?:[._][A-Za-z0-9_]+)+\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/\b[A-Z]{2,}[A-Z0-9_]*\b/g)) found.add(match[0]);
  for (const match of text.matchAll(/"([^"]{3,})"/g)) found.add(match[1] ?? "");
  return [...found].map((span) => span.trim()).filter((span) => span.length > 2);
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** True when the text reads as work to do rather than a thing to look up. */
export function isInstruction(text: string): boolean {
  if (sentences(text).length > 1) return true;
  return INSTRUCTION.test(text);
}

/**
 * Shorten at a boundary, never inside a protected span and never mid-word.
 * Returns the kept text and the words left out, so the omission is reportable.
 */
function shorten(text: string, maxChars: number): { kept: string; omitted: string[]; shortened: boolean } {
  if (text.length <= maxChars) return { kept: text, omitted: [], shortened: false };

  const spans = protectedSpans(text);
  // A cut that would fall inside a protected span moves past that span's end.
  let end = maxChars;
  for (const span of spans) {
    const at = text.indexOf(span);
    if (at < 0) continue;
    if (at < end && at + span.length > end) end = Math.min(text.length, at + span.length);
  }
  // Then back to the last word boundary before the (possibly moved) cut.
  const boundary = Math.max(
    text.lastIndexOf(" ", end),
    text.lastIndexOf(",", end),
    text.lastIndexOf(";", end),
  );
  if (boundary > maxChars * 0.5) end = boundary;

  const kept = text.slice(0, end).replace(/[\s,;:]+$/, "").trim();
  const omitted = text
    .slice(end)
    .replace(/^[\s,;:]+/, "")
    .split(/\s+/)
    .filter(Boolean);
  return { kept, omitted, shortened: true };
}

/**
 * The searchable subject of a prompt.
 *
 * `maxChars` is a ceiling for providers that answer short queries well; the
 * subject of the sentence survives it because shortening happens at a word
 * boundary and never through a URL, repository name or identifier.
 */
export function querySubject(prompt: string, options: { maxChars?: number } = {}): QuerySubject {
  const maxChars = Math.max(40, options.maxChars ?? 240);
  const original = prompt.trim();
  const spans = protectedSpans(original);

  if (isInstruction(original)) {
    const { kept, omitted, shortened } = shorten(original, maxChars);
    return {
      query: kept,
      removedPrefix: [],
      omittedTail: omitted,
      protectedSpans: spans,
      method: "verbatim",
      shortened,
    };
  }

  let working = original.replace(/[?.!]+$/g, "").trim();
  const removedPrefix: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEADING_SCAFFOLDING) {
      const match = working.match(pattern);
      if (!match) continue;
      removedPrefix.push(match[0].trim());
      working = working.slice(match[0].length).trim();
      changed = true;
      break;
    }
  }

  // Lifting scaffolding must not cost a protected span: if it did, keep the
  // wording as written instead of a sentence with the repository missing.
  const lostSpan = spans.some((span) => !working.includes(span));
  if (!working || lostSpan) working = original.replace(/[?.!]+$/g, "").trim();

  const { kept, omitted, shortened } = shorten(working, maxChars);
  return {
    query: kept,
    removedPrefix,
    omittedTail: omitted,
    protectedSpans: spans,
    method: removedPrefix.length > 0 && !lostSpan ? "scaffolding-removed" : "verbatim",
    shortened,
  };
}
