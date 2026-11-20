/**
 * ==========================================================
 * LÉLU — SPOKEN TEXT (what she SAYS, not what the screen shows)
 * ==========================================================
 *
 * The reply the conversation renders and the reply the speaker reads
 * are not the same string. "Your project is ready! 🚀" has an emoji
 * the voice cannot pronounce; "**Mission 22.8** completed" has
 * asterisks and a decimal that a listener hears as "twenty-two point
 * eight", not as "twenty two dot eight". Piper, ElevenLabs and
 * speechSynthesis all read the raw characters literally, so the
 * formatting a person skims became noise in their ears (measured in
 * the M22.7 live run: markdown symbols and emoji descriptions were
 * spoken aloud).
 *
 * This is ONE pure function in front of the existing TTS path. It does
 * not rewrite her answer: the meaning, the words, the technical terms
 * and the names all survive; only the visual layer is removed and the
 * numeric/abbreviated forms are given the pronunciation a person would
 * use. Nothing here touches the conversation, the memory or the model.
 *
 * Deliberate limits:
 *  - a token that mixes letters and digits (GPT-4o, sha256, v2.1.3) is
 *    LEFT ALONE: turning it into words would destroy the name;
 *  - an IP address or a semantic version (three or more dot-separated
 *    numbers) is LEFT ALONE for the same reason;
 *  - URLs are read as a domain you could say out loud, never spelled
 *    character by character;
 *  - fenced code is not read (a listener cannot hear syntax; the code
 *    is on screen), inline code keeps its content.
 *
 * Pure and dependency-free so every rule is unit-testable without an
 * audio device, a provider or a browser.
 */

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** 0..999 as words. */
function under1000(value: number): string {
  if (value < 20) return ONES[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const ones = value % 10;
    return ones ? `${tens}-${ONES[ones]}` : tens;
  }
  const hundreds = `${ONES[Math.floor(value / 100)]} hundred`;
  const rest = value % 100;
  return rest ? `${hundreds} ${under1000(rest)}` : hundreds;
}

/** A non-negative integer as words, up to the billions. */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value);
  const whole = Math.floor(value);
  if (whole === 0) return "zero";
  const scales: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  let remaining = whole;
  const parts: string[] = [];
  for (const [size, name] of scales) {
    if (remaining >= size) {
      const count = Math.floor(remaining / size);
      parts.push(`${under1000(count)} ${name}`);
      remaining %= size;
    }
  }
  if (remaining > 0) parts.push(under1000(remaining));
  return parts.join(" ");
}

/**
 * A numeric literal the way a person says it: "22.8" → "twenty-two
 * point eight", "2026" → "two thousand twenty-six", "007" → "zero zero
 * seven" (a leading zero is a code, not a quantity).
 */
function numericLiteralToWords(literal: string): string {
  const clean = literal.replace(/,/g, "");
  // A leading zero means digits, not a number: "007", "00".
  if (/^0\d/.test(clean)) {
    return clean
      .split("")
      .map((digit) => ONES[Number(digit)] ?? digit)
      .join(" ");
  }
  const [whole, fraction] = clean.split(".");
  let words = numberToWords(Number(whole));
  if (fraction) {
    const digits = fraction
      .split("")
      .map((digit) => ONES[Number(digit)] ?? digit)
      .join(" ");
    words = `${words} point ${digits}`;
  }
  return words;
}

/* ------------------------------------------------------------------ *
 * Abbreviations
 * ------------------------------------------------------------------ */

/** Spelled-out abbreviations, whole-token, case-insensitive. */
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\be\.g\./gi, "for example"],
  [/\bi\.e\./gi, "that is"],
  [/\betc\./gi, "et cetera"],
  [/\bvs\.?/gi, "versus"],
  [/\bapprox\./gi, "approximately"],
  [/\bw\/o\b/gi, "without"],
  [/\bw\//gi, "with"],
  [/\bc\.\s*(?=\d{3,4}\b)/g, "circa "],
  [/\bDr\./g, "Doctor"],
  [/\bMr\./g, "Mister"],
  [/\bMrs\./g, "Missus"],
  [/\bMs\./g, "Miss"],
  [/\bSt\.\s+(?=[A-Z])/g, "Saint "],
  [/\bNo\.\s*(?=\d)/g, "number "],
  [/\bFig\./g, "figure"],
  [/\bfig\./g, "figure"],
  [/\bdept\./gi, "department"],
  [/\best\.\s*(?=\d{4})/gi, "established "],
];

/* ------------------------------------------------------------------ *
 * URLs
 * ------------------------------------------------------------------ */

/**
 * A URL as something sayable: the host, with dots spoken. Path and query
 * are dropped — reading "slash api slash v1 question mark limit equals
 * twenty" is noise, and the address itself is on the screen.
 */
function urlToSpoken(raw: string): string {
  try {
    const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;
    const url = new URL(withProtocol);
    const host = url.hostname.replace(/^www\./i, "");
    if (!host) return "";
    const spokenHost = host.replace(/\./g, " dot ").replace(/-/g, " dash ");
    if (host === "localhost" || /^\d+(\.\d+){3}$/.test(host)) return spokenHost;
    return spokenHost;
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ *
 * Markdown / typography
 * ------------------------------------------------------------------ */

/**
 * Every character that belongs to a picture rather than a word: pictographs,
 * regional-indicator flags, variation selectors, joiners, keycaps and the
 * skin-tone modifiers. Written as alternatives rather than one character
 * class so the intent of each code point is explicit.
 */
const EMOJI = new RegExp(
  [
    "\\p{Extended_Pictographic}",
    "\\p{Regional_Indicator}",
    "\\uFE0F",
    "\\u200D",
    "\\u20E3",
    "\\u{1F3FB}",
    "\\u{1F3FC}",
    "\\u{1F3FD}",
    "\\u{1F3FE}",
    "\\u{1F3FF}",
  ].join("|"),
  "gu",
);
/** GitHub-style shortcodes (:rocket:, :white_check_mark:). Both colons required. */
const EMOJI_CODE = /(?<![\w:]):[a-z][a-z0-9_+-]{1,}:(?![\w:])/gi;

function stripMarkdown(text: string): string {
  let out = text;

  // Fenced code blocks: not spoken (the code is on screen, not in the ear).
  out = out.replace(/```[\s\S]*?```/g, " ");
  out = out.replace(/~~~[\s\S]*?~~~/g, " ");

  // Images: her alt text is the description; the URL is not speech.
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links: the label is what a person would say.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // Inline code keeps its content, without the backticks.
  out = out.replace(/`([^`]+)`/g, "$1");

  // HTML tags and comments.
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  out = out.replace(/<\/?[a-z][^>]*>/gi, " ");

  // Horizontal rules.
  out = out.replace(/^\s*([-*_]\s*){3,}$/gm, " ");

  // Table separator rows, then pipes as separators (a table read as a
  // sentence: "Name, value").
  out = out.replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ");
  out = out.replace(/\s*\|\s*/g, " ");

  // Blockquotes and list markers at line start.
  out = out.replace(/^\s{0,3}>\s?/gm, "");
  out = out.replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, "");

  // Headings: the hashes are structural, the words are not.
  out = out.replace(/^\s{0,3}#{1,6}\s*/gm, "");
  out = out.replace(/\s#+\s*$/gm, "");

  // Emphasis markers, but not a lone asterisk used as a footnote marker.
  out = out.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2");
  out = out.replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, "$2");
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");

  // Markdown escapes: "\*" is an asterisk, said as nothing.
  out = out.replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1");

  // Typographic punctuation a voice cannot read as a pause.
  out = out.replace(/[“”„«»]/g, '"');
  out = out.replace(/[‘’‚‹›]/g, "'");
  out = out.replace(/[–—]/g, ", ");
  out = out.replace(/…/g, "...");
  out = out.replace(/[•·]/g, ", ");

  // Symbols that carry no sound.
  out = out.replace(/[#^*~|<>{}[\]\\@`]/g, " ");
  out = out.replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/gi, " ");

  return out;
}

/* ------------------------------------------------------------------ *
 * The function
 * ------------------------------------------------------------------ */

/**
 * Turn a rendered reply into the text to speak.
 *
 * Returns "" when nothing is pronounceable (a reply that was only an
 * emoji or only a code block): the caller must not ask a provider to
 * synthesise silence.
 */
export function toSpokenText(text: string): string {
  if (!text) return "";
  let out = stripMarkdown(text);

  // Emoji, before numbers: a keycap emoji is "1️⃣", not the number one.
  out = out.replace(EMOJI, " ");
  out = out.replace(EMOJI_CODE, " ");

  // URLs (bare), before numbers: a URL's digits are its address.
  out = out.replace(/\bhttps?:\/\/[^\s)]+/gi, (match) => urlToSpoken(match));
  out = out.replace(/\bwww\.[^\s)]+/gi, (match) => urlToSpoken(match));
  // A bare domain with a known TLD, not the end of a sentence.
  out = out.replace(
    /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|dev|ai|app|co|edu|gov|me|sh|xyz|so|gg)(?![\p{L}\p{N}-])(?:\/[^\s)]*)?/giu,
    (match) => urlToSpoken(match),
  );

  // Abbreviations.
  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);

  // Money and percentages, before the plain numbers they contain.
  out = out.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)/g, (_match, amount: string) =>
    `${numericLiteralToWords(amount)} ${amount.replace(/,/g, "") === "1" ? "dollar" : "dollars"}`,
  );
  out = out.replace(/£\s?(\d[\d,]*(?:\.\d+)?)/g, (_match, amount: string) =>
    `${numericLiteralToWords(amount)} ${amount.replace(/,/g, "") === "1" ? "pound" : "pounds"}`,
  );
  out = out.replace(/€\s?(\d[\d,]*(?:\.\d+)?)/g, (_match, amount: string) =>
    `${numericLiteralToWords(amount)} ${amount.replace(/,/g, "") === "1" ? "euro" : "euros"}`,
  );
  out = out.replace(/(\d[\d,]*(?:\.\d+)?)\s*%/g, (_match, amount: string) => `${numericLiteralToWords(amount)} percent`);

  // Standalone numbers. A token touching a letter (GPT-4o, sha256) or a
  // version/IP (three or more dot-separated parts) is left exactly as it is.
  out = out.replace(
    /(?<![\p{L}\p{N}_.-])(\d[\d,]*(?:\.\d+)?)(?![\p{L}\p{N}_]|\.\d)/gu,
    (match, literal: string) => {
      const parts = literal.replace(/,/g, "").split(".");
      if (parts.length >= 3) return match;
      return numericLiteralToWords(literal);
    },
  );

  // Whitespace: one space, one sentence gap. Punctuation a voice needs.
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/\s+([,.;:!?])/g, "$1");
  out = out.replace(/([,;:])(?:\s*[,;:])+/g, "$1");
  out = out.replace(/\.{3,}/g, "...");
  out = out.replace(/^[,;:.\s]+/, "");
  // A reply that ends without terminal punctuation gets a full stop, so the
  // engine does not run it into whatever is spoken next.
  if (out && !/[.!?…]$/.test(out)) out = `${out}.`;

  return out.trim();
}

/**
 * Split spoken text into sentence-sized pieces for incremental synthesis.
 * A pure helper so the streaming cursor and the provider chunker agree on
 * where a sentence ends.
 */
export function spokenSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
