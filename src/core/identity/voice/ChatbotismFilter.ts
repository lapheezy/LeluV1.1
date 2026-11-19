/**
 * ==========================================================
 * LÉLU — ANTI-GENERIC RESPONSE TRANSFORMATION
 *
 * The last line of defence against assistant posture. A model can
 * still open with "Certainly!" or close with "Let me know if you
 * need anything else" no matter what the system prompt says, so
 * the pipeline transforms the finished text as well as
 * instructing it.
 *
 * Deliberately narrow and conservative:
 *   • only recognised assistant boilerplate is removed;
 *   • fenced code is never touched;
 *   • a short legitimate "Sure." answer is left alone;
 *   • nothing is rewritten, summarised or re-toned.
 *
 * It returns what it removed, so the transformation is auditable
 * rather than a silent edit.
 * ==========================================================
 */

export interface RevoiceResult {
  text: string;
  removed: string[];
}

/** Opening postures that are never LÉLU. */
const LEADING_PATTERNS: readonly RegExp[] = [
  /^\s*(?:>\s*)?(?:\*\*)?(?:certainly|of course|absolutely|sure thing|great question|that'?s a great question|good question|happy to help|i'?d be (?:happy|glad) to help|i'?d be (?:happy|glad) to|i can help with that|let me help you with that|as an ai(?: language)? model|as a large language model)(?:\*\*)?\s*[!,.:;—–-]+\s*/i,
  /^\s*(?:>\s*)?(?:\*\*)?sure(?:\*\*)?\s*[,—–-]\s+(?=\S{25,})/i,
];

/** Closing postures that are never LÉLU. */
const TRAILING_PATTERNS: readonly RegExp[] = [
  /\n{0,2}[^\S\n]*(?:i hope (?:this|that|it) helps|hope (?:this|that|it) helps|let me know if (?:you )?(?:need|have|want|there'?s)[^.!\n]*|let me know(?: what you think)?|feel free to (?:ask|reach out|reply)[^.!\n]*|is there anything else[^.!\n]*|anything else (?:i can|you'?d like)[^.!\n]*|happy to (?:help|clarify|expand)[^.!\n]*)[.!?]*\s*$/i,
];

/** Mid-text assistant self-reference. */
const MID_TEXT_PATTERNS: readonly RegExp[] = [
  /(?:^|(?<=[.!?]\s))as an ai(?: language)? model,?\s*/gi,
  /(?:^|(?<=[.!?]\s))as a (?:helpful|large language) (?:assistant|model),?\s*/gi,
];

/** Words used to find boilerplate in finished text (metrics + guard). */
export const CHATBOTISM_PATTERNS: readonly RegExp[] = [
  ...LEADING_PATTERNS,
  ...TRAILING_PATTERNS,
  /as an ai(?: language)? model/gi,
  /i'?d be (?:happy|glad) to/gi,
  /great question/gi,
  /i hope (?:this|that) helps/gi,
  /let me know if you need anything else/gi,
  /is there anything else i can help/gi,
  /feel free to ask/gi,
  /i'?m just an ai/gi,
];

const CODE_FENCE = /```[\s\S]*?```/g;

type Chunk = { code: boolean; text: string };

function splitChunks(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE_FENCE)) {
    const index = match.index ?? 0;
    if (index > last) chunks.push({ code: false, text: text.slice(last, index) });
    chunks.push({ code: true, text: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) chunks.push({ code: false, text: text.slice(last) });
  if (chunks.length === 0) chunks.push({ code: false, text });
  return chunks;
}

function stripLeading(chunk: string, removed: string[], allow: boolean): string {
  let current = chunk;
  for (let guard = 0; guard < 4; guard += 1) {
    let matched = false;
    for (const pattern of LEADING_PATTERNS) {
      const match = pattern.exec(current);
      if (!match) continue;
      // Never gut a short legitimate answer ("Sure."). The decision is made
      // on the WHOLE reply, not this chunk: when the answer lives in a code
      // block, the prose chunk before it is short but the reply is not.
      if (!allow) continue;
      removed.push(match[0].trim());
      current = current.slice(match[0].length);
      matched = true;
      break;
    }
    if (!matched) break;
  }
  return current;
}

function stripTrailing(chunk: string, removed: string[]): string {
  let current = chunk;
  for (let guard = 0; guard < 4; guard += 1) {
    let matched = false;
    for (const pattern of TRAILING_PATTERNS) {
      const match = pattern.exec(current);
      if (!match) continue;
      removed.push(match[0].trim());
      current = current.slice(0, match.index);
      matched = true;
      break;
    }
    if (!matched) break;
  }
  return current;
}

function stripMidText(chunk: string, removed: string[]): string {
  let current = chunk;
  for (const pattern of MID_TEXT_PATTERNS) {
    current = current.replace(pattern, (match) => {
      removed.push(match.trim());
      return "";
    });
  }
  return current;
}

/**
 * Remove assistant boilerplate without touching content or code.
 * Idempotent: running it twice removes nothing the second time.
 */
export function stripChatbotisms(input: string): RevoiceResult {
  if (typeof input !== "string" || input.length === 0) return { text: input ?? "", removed: [] };

  const removed: string[] = [];
  const chunks = splitChunks(input);
  const firstPlain = chunks.findIndex((chunk) => !chunk.code);
  let lastPlain = -1;
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    if (!chunks[index].code) {
      lastPlain = index;
      break;
    }
  }

  const out = chunks.map((chunk, index) => {
    if (chunk.code) return chunk.text;
    let text = stripMidText(chunk.text, removed);
    if (index === firstPlain) text = stripLeading(text, removed, input.trim().length >= 20);
    if (index === lastPlain) text = stripTrailing(text, removed);
    return text;
  });

  let text = out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // A removal must never leave the turn empty.
  if (text.length === 0 && removed.length > 0) {
    return { text: input.trim(), removed: [] };
  }

  return { text, removed };
}

/** How many boilerplate postures a finished text still contains. */
export function findChatbotisms(text: string): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const pattern of CHATBOTISM_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const global = new RegExp(pattern.source, flags);
    const matches = text.match(global);
    if (matches) hits.push(...matches.map((item) => item.trim()).filter(Boolean));
  }
  return hits;
}
