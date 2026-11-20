/**
 * ==========================================================
 * LÉLU — WHAT SHE SAYS IS NOT WHAT THE SCREEN SHOWS
 *
 * CATEGORY: unit, pure. spokenText.ts with no browser, no provider,
 * no audio device.
 *
 * Measured in the M22.7 live run: markdown symbols and emoji were read
 * aloud ("**Mission 22.8** completed" reached the speaker with its
 * asterisks, and an emoji description was pronounced). This suite holds
 * the four populations the mission asks for — markdown-heavy replies,
 * emoji replies, technical explanations and numbers/abbreviations — and
 * checks that the spoken form keeps the meaning while dropping the
 * visual layer.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { toSpokenText, numberToWords, spokenSentences } from "../src/core/voice/spokenText";

/** No markdown scaffolding survives into speech. */
function assertSpeakable(text: string, label: string): void {
  assert.doesNotMatch(text, /\*\*|__|```|https?:\/\/|^\s*#|\||<[a-z/]/i, `${label}: visual scaffolding reached the speaker`);
  assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `${label}: an emoji reached the speaker`);
  assert.doesNotMatch(text, /\s{2,}/, `${label}: headroom is collapsed`);
}

/* ----------------------------- markdown ------------------------------ */

const MARKDOWN_CASES: Array<[string, string]> = [
  ["## Status", "Status."],
  ["**Done** now", "Done now."],
  ["*emphasis* here", "emphasis here."],
  ["- item one\n- item two", "item one item two."],
  ["1. First\n2. Second", "First Second."],
  ["[the docs](https://example.com/docs)", "the docs."],
  ["Use `npm test` to run.", "Use npm test to run."],
  ["![a red bicycle](img.png)", "a red bicycle."],
  ["> quoted line", "quoted line."],
  ["### Heading ###", "Heading."],
  ["~~old~~ new", "old new."],
  ["<b>Bold</b> text", "Bold text."],
  ["A [link](https://example.com) and **bold**", "A link and bold."],
  ["---\nTitled\n---", "Titled."],
  ["Line with \\* escape", "Line with escape."],
  ["| Name | Value |\n| --- | --- |\n| a | 2 |", "Name Value a two."],
  ["See https://example.com/path?q=1 for more.", "See example dot com for more."],
  ["Visit www.lelu.dev today.", "Visit lelu dot dev today."],
  ["1) paren list", "paren list."],
  ["Text — with an em dash.", "Text, with an em dash."],
];

test("markdown-heavy replies are spoken as sentences, not as syntax", () => {
  assert.equal(MARKDOWN_CASES.length >= 20, true, "the mission asks for at least twenty");
  for (const [input, expected] of MARKDOWN_CASES) {
    const spoken = toSpokenText(input);
    assert.equal(spoken, expected, `markdown: ${JSON.stringify(input)}`);
    assertSpeakable(spoken, input);
  }
});

test("a code block is not read aloud, and nothing pronounceable is not synthesised", () => {
  assert.equal(toSpokenText("```js\nconst x = 1;\n```"), "");
  assert.equal(toSpokenText("🚀"), "");
  assert.equal(toSpokenText(""), "");
  assert.equal(toSpokenText("   \n  "), "");
});

/* ------------------------------- emoji -------------------------------- */

const EMOJI_CASES: Array<[string, string]> = [
  ["Your project is ready! 🚀", "Your project is ready!"],
  ["Done ✅", "Done."],
  ["Great 👍🏽 work", "Great work."],
  ["Family 👨‍👩‍👧 portrait", "Family portrait."],
  ["Flag 🇫🇷 here", "Flag here."],
  [":rocket: Launch", "Launch."],
  ["I ❤️ LÉLU", "I LÉLU."],
  ["☀️ sunny day", "sunny day."],
  ["emoji at end 😀😀😀", "emoji at end."],
  ["Café ☕ break", "Café break."],
  ["Warning ⚠️", "Warning."],
  ["👉 point", "point."],
  ["Stars ⭐⭐⭐", "Stars."],
  ["Mix 🎉 and ✅ done", "Mix and done."],
  ["1️⃣ first item", "one first item."],
  ["Ship it 🚢🚀", "Ship it."],
  ["Nice 🎯", "Nice."],
  ["Hooray 🙌🏼🙌🏼", "Hooray."],
  ["Clock 🕒 says noon", "Clock says noon."],
  ["Arrows ↔️ work", "Arrows work."],
];

test("emoji replies keep their words and lose their pictures", () => {
  assert.equal(EMOJI_CASES.length >= 20, true, "the mission asks for at least twenty");
  for (const [input, expected] of EMOJI_CASES) {
    const spoken = toSpokenText(input);
    assert.equal(spoken, expected, `emoji: ${JSON.stringify(input)}`);
    assertSpeakable(spoken, input);
  }
});

/* ----------------------------- technical ----------------------------- */

const TECHNICAL_CASES: Array<[string, string[]]> = [
  ["Run npm install then bun run build.", ["npm install", "bun run build"]],
  ["The API key lives in .env", ["API key", ".env"]],
  ["Call getUserMedia() on navigator.mediaDevices.", ["getUserMedia", "navigator.mediaDevices"]],
  ["Use GPT-4o for this turn.", ["GPT-4o"]],
  ["Commit 8fe5023 stays on the branch.", ["8fe5023"]],
  ["The sha256 digest is stable.", ["sha256"]],
  ["v2.1.3 is the release.", ["v2.1.3"]],
  ["The worker listens on 127.0.0.1:8788.", ["127.0.0.1"]],
  ["M22.7 established the pipeline.", ["M22.7"]],
  ["UTF-8 text and C++ code.", ["UTF-8", "C++"]],
];

test("technical terms and identifiers are never rewritten into words", () => {
  assert.equal(TECHNICAL_CASES.length >= 10, true, "the mission asks for at least ten");
  for (const [input, mustKeep] of TECHNICAL_CASES) {
    const spoken = toSpokenText(input);
    for (const term of mustKeep) {
      assert.ok(spoken.includes(term), `technical: ${JSON.stringify(input)} lost ${term} → ${spoken}`);
    }
    assertSpeakable(spoken, input);
  }
});

/* ------------------------- numbers and abbreviations ------------------ */

const NUMBER_CASES: Array<[string, string, string]> = [
  ["Mission 22.8 completed.", "Mission twenty-two point eight completed.", "decimal"],
  ["There are 1,024 items.", "There are one thousand twenty-four items.", "thousands separator"],
  ["50% done", "fifty percent done.", "percent"],
  ["$5 please", "five dollars please.", "dollars"],
  ["£1 only", "one pound only.", "pounds"],
  ["3 cats", "three cats.", "small number"],
  ["2026 report", "two thousand twenty-six report.", "year"],
  ["No. 5 wins", "number five wins.", "abbreviation with a number"],
  ["e.g. this", "for example this.", "e.g."],
  ["etc. and Dr. Chen", "et cetera and Doctor Chen.", "etc./Dr."],
];

test("numbers and abbreviations are pronounced, not spelled", () => {
  assert.equal(NUMBER_CASES.length >= 10, true, "the mission asks for at least ten");
  for (const [input, expected, label] of NUMBER_CASES) {
    assert.equal(toSpokenText(input), expected, `numbers (${label}): ${JSON.stringify(input)}`);
  }
});

test("numberToWords covers the ranges speech actually needs", () => {
  assert.equal(numberToWords(0), "zero");
  assert.equal(numberToWords(7), "seven");
  assert.equal(numberToWords(21), "twenty-one");
  assert.equal(numberToWords(100), "one hundred");
  assert.equal(numberToWords(1_024), "one thousand twenty-four");
  assert.equal(numberToWords(86_400), "eighty-six thousand four hundred");
  assert.equal(numberToWords(1_000_000), "one million");
});

/* ----------------------------- sentences ------------------------------ */

test("spoken sentences split where a provider should synthesise", () => {
  assert.deepEqual(spokenSentences("One. Two! Three?"), ["One.", "Two!", "Three?"]);
  assert.deepEqual(spokenSentences(""), []);
});

test("normalisation is idempotent for text that is already speech", () => {
  const once = toSpokenText("Your project is ready! Nothing else changed.");
  assert.equal(toSpokenText(once), once);
});
