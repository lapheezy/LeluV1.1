/**
 * M23.0 — WP03: measure the SOFTWARE echo guard.
 *
 * This is not a measurement of browser acoustic echo cancellation. AEC needs
 * a physical microphone hearing a physical speaker, and this container has
 * neither. What it measures is the engine's own second line of defence:
 * `isEchoUtterance(candidate, spoken)` — the rule that decides a transcript is
 * her own voice coming back rather than a person interrupting.
 *
 * Two error directions matter, and they are not symmetric:
 *
 *   false CATCH   an echo was treated as a user turn  → she answers herself
 *   false REJECT  a real interruption was treated as echo → she talks over
 *                 the person, which is the "missed interruption" defect
 *
 * The adversarial cases are short interrupt words ("no", "stop") and genuine
 * replies that reuse her vocabulary — the two ways a real barge-in looks like
 * an echo.
 *
 * Usage: npx tsx MISSION-23.0/scripts/echo-guard-matrix.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isEchoUtterance } from "../../src/core/voice/VoiceEngine";

const OUT = join(process.cwd(), "MISSION-23.0", "logs");
mkdirSync(OUT, { recursive: true });

/** Sentences she actually spoke in the M22.9/M23.0 runs. */
const HER_SENTENCES = [
  "Lima is the capital of Peru, and it sits on the Pacific coast.",
  "Binary search halves the search space each step, so it runs in logarithmic time.",
  "An API is a contract that lets one program ask another for something.",
  "Saturn is the planet best known for its rings.",
  "Two plus two is four.",
  "Go to bed and wake up at the same time every day, even at weekends.",
  "HTTP stands for HyperText Transfer Protocol.",
  "Jane Austen wrote Pride and Prejudice.",
  "A hexagon has six sides.",
  "Water boils at one hundred degrees Celsius at sea level.",
  "Machine learning is how a program improves from examples instead of rules.",
  "The speed of light is about three hundred million metres per second.",
];

/**
 * What ASR typically returns when the microphone hears her own speaker: a
 * partial, slightly damaged copy. Generating these from her real sentences is
 * what makes the guard's false-catch rate meaningful.
 */
function echoVariants(sentence: string): string[] {
  const words = sentence.replace(/[.,]/g, "").split(/\s+/);
  const cut = (n: number) => words.slice(0, Math.max(1, Math.round(words.length * n))).join(" ");
  return [
    sentence, // perfect return (digital loopback)
    cut(0.6), // recogniser lost the tail
    cut(0.35), // only the beginning came through
    words.slice(1).join(" "), // first word clipped by the VAD
  ];
}

/** Genuine things a person says, grouped by how easy they are to confuse. */
const USER_UTTERANCES: Array<{ text: string; kind: "short-interrupt" | "ordinary" | "overlap" | "closing" }> = [
  // Short interrupts: the words a person uses to stop a talker.
  { text: "no", kind: "short-interrupt" },
  { text: "no!", kind: "short-interrupt" },
  { text: "stop", kind: "short-interrupt" },
  { text: "wait", kind: "short-interrupt" },
  { text: "hey", kind: "short-interrupt" },
  { text: "hold on", kind: "short-interrupt" },
  { text: "wait a second", kind: "short-interrupt" },
  { text: "actually no", kind: "short-interrupt" },
  // Ordinary turns.
  { text: "what is the capital of Chile?", kind: "ordinary" },
  { text: "tell me about volcanoes instead", kind: "ordinary" },
  { text: "can you say that again more slowly?", kind: "ordinary" },
  { text: "I disagree with that", kind: "ordinary" },
  // Hard negatives: genuine replies that reuse her vocabulary.
  { text: "no, the capital of Peru is Lima and I know that", kind: "overlap" },
  { text: "binary search halves the space, yes, but what about the worst case", kind: "overlap" },
  { text: "is an API a contract or a protocol?", kind: "overlap" },
  { text: "six sides, but what is a hexagon called in Spanish?", kind: "overlap" },
  // Closings the person says while she is still speaking.
  { text: "that is all for now", kind: "closing" },
  { text: "thank you", kind: "closing" },
  { text: "ok thanks bye", kind: "closing" },
];

const rows: Array<Record<string, unknown>> = [];

// Direction 1: does the guard catch her own voice coming back?
let echoTotal = 0;
let echoCaught = 0;
for (const sentence of HER_SENTENCES) {
  for (const variant of echoVariants(sentence)) {
    echoTotal += 1;
    const caught = isEchoUtterance(variant, sentence);
    if (caught) echoCaught += 1;
    rows.push({ direction: "echo", kind: "echo", spoken: sentence, candidate: variant, caught });
  }
}

// Direction 2: does the guard swallow a genuine interruption?
let userTotal = 0;
let userRejected = 0;
const byKind: Record<string, { total: number; rejected: number }> = {};
for (const sentence of HER_SENTENCES) {
  for (const user of USER_UTTERANCES) {
    userTotal += 1;
    const rejected = isEchoUtterance(user.text, sentence);
    if (rejected) userRejected += 1;
    byKind[user.kind] ??= { total: 0, rejected: 0 };
    byKind[user.kind]!.total += 1;
    if (rejected) byKind[user.kind]!.rejected += 1;
    if (rejected) rows.push({ direction: "user", kind: user.kind, spoken: sentence, candidate: user.text, caught: true });
  }
}

const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

const report = {
  ranAt: new Date().toISOString(),
  measures: "software echo guard (isEchoUtterance); NOT browser AEC, NOT acoustic",
  physicalHardware: false,
  herSentences: HER_SENTENCES.length,
  echo: {
    total: echoTotal,
    caught: echoCaught,
    catchRatePct: pct(echoCaught, echoTotal),
    missedEchoes: echoTotal - echoCaught,
  },
  user: {
    total: userTotal,
    falselyRejected: userRejected,
    falseRejectRatePct: pct(userRejected, userTotal),
    byKind: Object.fromEntries(
      Object.entries(byKind).map(([kind, value]) => [kind, { ...value, rejectRatePct: pct(value.rejected, value.total) }]),
    ),
  },
  wronglyRejected: rows.filter((row) => row.direction === "user"),
  missedEchoSample: rows.filter((row) => row.direction === "echo" && !row.caught).slice(0, 20),
};

writeFileSync(join(OUT, "echo-guard-matrix.json"), JSON.stringify({ ...report, rows }, null, 2));

console.log(JSON.stringify({
  echoCatchRatePct: report.echo.catchRatePct,
  echoCaught: `${echoCaught}/${echoTotal}`,
  userFalseRejectRatePct: report.user.falseRejectRatePct,
  userFalseRejects: `${userRejected}/${userTotal}`,
  byKind: report.user.byKind,
}, null, 2));

if (report.wronglyRejected.length > 0) {
  console.log("\nGenuine interruptions swallowed as echo (first 12):");
  for (const row of report.wronglyRejected.slice(0, 12)) {
    console.log(`  [${String(row.kind)}] "${String(row.candidate)}"  vs her "${String(row.spoken).slice(0, 48)}…"`);
  }
}
