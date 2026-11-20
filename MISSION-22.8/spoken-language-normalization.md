# WP05 — Spoken language normalization

**Priority:** P1 · **Status:** VERIFIED (unit + live).

## The defect

M22.7 measured it directly: markdown and emoji reached the speaker. The reply
the conversation renders and the reply a listener hears were the same string,
and a string written for the eye contains things a voice cannot say:

| Rendered | Heard before M22.8 |
|---|---|
| `**Mission 22.8** completed. 🚀` | "asterisk asterisk Mission twenty two point eight asterisk asterisk completed. rocket" |
| `- one\n- two` | "dash one dash two" |
| `[the docs](https://example.com/docs)` | the URL, character by character |
| ` ```js … ``` ` | the code, read aloud |
| `$5`, `50%`, `1,024` | "dollar five", "fifty percent sign", "one comma zero two four" |

## The implementation

One pure function in a new module, `src/core/voice/spokenText.ts`:

```ts
export function toSpokenText(text: string): string
```

Every speech path calls it — `speakResponse`, `feedStreamingSpeech`,
`finishStreamingSpeech`, `speakThroughLivekit` — so there is one answer to
"what does she say", not four. If it returns `""` nothing is sent to a
provider: a reply that was only an emoji or only a code block is never
synthesised as silence.

### Rules, in the order they run

1. **Fenced code** (` ``` `, `~~~`) is removed — a listener cannot hear syntax,
   and the code is on screen.
2. **Images** keep their alt text; **links** keep their label; **inline code**
   keeps its content without backticks.
3. **HTML tags and comments** are removed; **horizontal rules** removed.
4. **Tables**: the separator row goes, pipes become spaces (a table is read as a
   sentence: "Name Value a two").
5. **Blockquotes, list markers, headings**: structural characters removed, words
   kept.
6. **Emphasis** (`**`, `__`, `*`, `_`, `~~`) unwrapped, then markdown escapes
   (`\*`) resolved.
7. **Typography** normalised: curly quotes → straight, en/em dash → comma pause,
   ellipsis → `...`, bullets → comma.
8. **Symbols with no sound** (`# ^ * ~ | < > { } [ ] \ @ ` `) removed.
9. **Emoji** removed, including ZWJ sequences, variation selectors, skin-tone
   modifiers, keycaps and regional-indicator flags; `:shortcode:` forms too.
10. **URLs** become a sayable domain: `https://www.example.com/path?q=1` →
    "example dot com". Path and query are dropped (they are noise, and they are
    on screen).
11. **Abbreviations** expanded: `e.g.` → for example, `i.e.` → that is,
    `etc.` → et cetera, `vs.` → versus, `approx.` → approximately, `Dr.` →
    Doctor, `Mr.`/`Mrs.`/`Ms.`, `St.` → Saint, `No. 5` → number five,
    `Fig.` → figure, `dept.` → department, `est. 1999` → established 1999,
    `w/` → with, `w/o` → without, `c. 1200` → circa 1200.
12. **Money and percentages**: `$5` → five dollars, `£1` → one pound,
    `€5` → five euros, `50%` → fifty percent.
13. **Numbers** become words: `22.8` → twenty-two point eight,
    `1,024` → one thousand twenty-four, `2026` → two thousand twenty-six,
    `007` → zero zero seven (a leading zero is a code, not a quantity).
14. **Whitespace and punctuation**: collapsed, spacing before punctuation fixed,
    and a reply that ends without terminal punctuation gets a full stop so the
    next sentence does not run into it.

### What is deliberately NOT touched

The mission warns against destructive normalization of technical vocabulary.
Three rules protect it:

* **Mixed alphanumeric tokens are left alone** — `GPT-4o`, `sha256`, `8fe5023`,
  `v2.1.3` keep their spelling. The number rule uses a look-behind/ahead that
  refuses a digit adjacent to a letter.
* **Three-or-more-part dotted numbers are left alone** — `127.0.0.1`, semantic
  versions. (A plain decimal like `22.8` is converted.)
* **Bare-domain detection requires a real TLD and a boundary** — this bug was
  caught by the test suite: `navigator.mediaDevices.` was briefly spoken as
  "navigator dot mediaDevices" because `.me` matched inside `mediaDevices`. The
  rule now requires the TLD to end the token.

## Acceptance populations

`tests/voice-spoken-text.test.ts` — 8 tests, 61 assertions, all passing.

| Population | Required | Covered |
|---|---|---|
| Markdown-heavy replies | 20 | **21** (headings, bold, italic, lists, links, images, code, tables, blockquote, rules, escapes, em dash, bare URL, `www.` domain) |
| Replies containing emoji | 20 | **20** (rocket, check, skin tone, ZWJ family, flag, shortcode, heart+VS16, sun, repeats, coffee, warning, pointing, stars, keycap, mixed, ship, target, double skin tone, clock, arrows) |
| Technical explanations | 10 | **10** (npm/bun commands, `.env`, `getUserMedia()`, `GMT-4o`, commit hash, `sha256`, `v2.1.3`, IP:port, `M22.7`, `UTF-8`/`C++`) |
| Numbers and abbreviations | 10 | **10** (decimal, thousands separator, percent, dollars, pounds, small integer, year, `No.`, `e.g.`, `etc.`+`Dr.`) |

Plus: code-block-only and emoji-only replies produce `""`; `numberToWords`
covers 0–1,000,000; sentence splitting matches what the streamer uses;
normalization is idempotent for text that is already speech.

Example expectations that are asserted verbatim:

```
"Your project is ready! 🚀"        → "Your project is ready!"
"Mission 22.8 completed."          → "Mission twenty-two point eight completed."
"| Name | Value |\n| --- | ... "   → "Name Value a two."
"Call getUserMedia() on navigator.mediaDevices."
                                   → "Call getUserMedia() on navigator.mediaDevices."
```

## The difference, as audio

Two files in `audio/`, both synthesised with the same Piper voice:

| File | Said | Length |
|---|---|---|
| `rendered-string-as-speech.wav` | `**Mission 22.8** completed! 🚀` — the raw rendered string | 5.84 s |
| `normalized-string-as-speech.wav` | `Mission twenty-two point eight completed!` — what `toSpokenText` produces | 2.54 s |

The rendered form is **2.3× longer** because every asterisk, the emoji and the
numeric notation are pronounced. That is the M22.7 complaint, made audible.

## Live evidence

Every browser run in this mission captured the text sent to `/api/voice/tts`
(`window.__leluTts[].text`). In both the 19-turn and 21-turn runs, no request
contained `**`, `#`, a code fence, a URL, an emoji, or a bare markdown list
marker. The transcripts and the spoken requests are in
`logs/latency-acceptance.json` and `logs/interruption-run.json`.

## Honest limits

* **Meaning can be lost with the picture.** "I ❤️ it" is spoken as "I it."
  The mission's own example chooses this trade (drop the emoji, keep the
  sentence); a future version could map a small emoji vocabulary to words
  ("heart" → "love") instead of deleting it.
* **Code blocks are skipped entirely.** A listener is not told "there is a code
  block here". That is a real gap for a reply that is mostly code.
* **Domain reading is literal.** "lelu dot dev" is intelligible but not how a
  person says a brand name; a pronunciation dictionary would be needed.
* **No SSML or prosody control.** Pauses are punctuation, not markup — Piper's
  default sentence silence (0.2 s) is the only pause model in play.
