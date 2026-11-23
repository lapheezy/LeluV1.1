/**
 * M23.0 — WP03: the echo guard, before and after.
 *
 * `legacyIsEchoUtterance` is the pre-fix rule COPIED VERBATIM from
 * `b46b0aa3:src/core/voice/VoiceEngine.ts`, so the comparison is not a
 * recollection of what the old rule did — it is the old rule, run.
 *
 * Same corpus, same two directions:
 *   echo catch rate    her words coming back must be discarded
 *   false reject rate  a person's interruption must not be discarded
 *
 * Usage: npx tsx MISSION-23.0/scripts/echo-guard-before-after.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isEchoUtterance } from "../../src/core/voice/VoiceEngine";

/** Verbatim from b46b0aa3 — the M22.9 rule, unchanged. */
function legacyIsEchoUtterance(candidate: string, spoken: string): boolean {
  const a = candidate.trim().toLowerCase();
  const b = spoken.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length <= 3) return true;
  if (b.includes(a) || a.includes(b)) return true;
  const tokenize = (s: string) => s.split(/\W+/).filter((t) => t.length > 0);
  const aTokens = tokenize(a);
  const bTokens = new Set(tokenize(b));
  if (aTokens.length === 0) return false;
  const overlap = aTokens.filter((t) => bTokens.has(t)).length / aTokens.length;
  return overlap >= 0.7;
}

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

function echoVariants(sentence: string): string[] {
  const words = sentence.replace(/[.,]/g, "").split(/\s+/);
  const cut = (n: number) => words.slice(0, Math.max(1, Math.round(words.length * n))).join(" ");
  return [sentence, cut(0.6), cut(0.35), words.slice(1).join(" ")];
}

const USER_UTTERANCES: Array<{ text: string; kind: string }> = [
  { text: "no", kind: "short-interrupt" },
  { text: "no!", kind: "short-interrupt" },
  { text: "stop", kind: "short-interrupt" },
  { text: "wait", kind: "short-interrupt" },
  { text: "hey", kind: "short-interrupt" },
  { text: "hold on", kind: "short-interrupt" },
  { text: "wait a second", kind: "short-interrupt" },
  { text: "actually no", kind: "short-interrupt" },
  { text: "what is the capital of Chile?", kind: "ordinary" },
  { text: "tell me about volcanoes instead", kind: "ordinary" },
  { text: "can you say that again more slowly?", kind: "ordinary" },
  { text: "I disagree with that", kind: "ordinary" },
  { text: "no, the capital of Peru is Lima and I know that", kind: "overlap" },
  { text: "binary search halves the space, yes, but what about the worst case", kind: "overlap" },
  { text: "is an API a contract or a protocol?", kind: "overlap" },
  { text: "six sides, but what is a hexagon called in Spanish?", kind: "overlap" },
  { text: "that is all for now", kind: "closing" },
  { text: "thank you", kind: "closing" },
  { text: "ok thanks bye", kind: "closing" },
];

type Guard = (candidate: string, spoken: string) => boolean;

function evaluate(guard: Guard, cacheBust: (spoken: string) => boolean) {
  let echoTotal = 0;
  let echoCaught = 0;
  for (const sentence of HER_SENTENCES) {
    for (const variant of echoVariants(sentence)) {
      echoTotal += 1;
      if (guard(variant, sentence) || cacheBust(sentence)) echoCaught += 1;
    }
  }
  let userTotal = 0;
  let userRejected = 0;
  const byKind: Record<string, { total: number; rejected: number }> = {};
  const rejectedSamples: Array<{ kind: string; text: string; spoken: string }> = [];
  for (const sentence of HER_SENTENCES) {
    for (const user of USER_UTTERANCES) {
      userTotal += 1;
      const rejected = guard(user.text, sentence);
      byKind[user.kind] ??= { total: 0, rejected: 0 };
      byKind[user.kind]!.total += 1;
      if (rejected) {
        byKind[user.kind]!.rejected += 1;
        userRejected += 1;
        if (rejectedSamples.length < 12) rejectedSamples.push({ kind: user.kind, text: user.text, spoken: sentence });
      }
    }
  }
  const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
  return {
    echo: { total: echoTotal, caught: echoCaught, catchRatePct: pct(echoCaught, echoTotal) },
    user: {
      total: userTotal,
      falselyRejected: userRejected,
      falseRejectRatePct: pct(userRejected, userTotal),
      byKind: Object.fromEntries(
        Object.entries(byKind).map(([kind, value]) => [kind, { ...value, rejectRatePct: pct(value.rejected, value.total) }]),
      ),
      rejectedSamples,
    },
  };
}

const before = evaluate(legacyIsEchoUtterance, () => false);
const after = evaluate(isEchoUtterance, () => false);

const report = {
  ranAt: new Date().toISOString(),
  measures: "software echo guard only; NOT browser AEC, NOT acoustic proof",
  physicalHardware: false,
  herSentences: HER_SENTENCES.length,
  userUtterances: USER_UTTERANCES.length,
  comparisons: HER_SENTENCES.length * echoVariants(HER_SENTENCES[0]!).length,
  interactions: HER_SENTENCES.length * USER_UTTERANCES.length,
  before,
  after,
  delta: {
    echoCatchRatePct: Math.round((after.echo.catchRatePct - before.echo.catchRatePct) * 10) / 10,
    falseRejectRatePct: Math.round((after.user.falseRejectRatePct - before.user.falseRejectRatePct) * 10) / 10,
    interruptionsRecovered: before.user.falselyRejected - after.user.falselyRejected,
  },
};

mkdirSync(join(process.cwd(), "MISSION-23.0", "logs"), { recursive: true });
writeFileSync(join(process.cwd(), "MISSION-23.0", "logs", "echo-guard-before-after.json"), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  before: { echoCatch: before.echo.catchRatePct, falseReject: before.user.falseRejectRatePct, shortInterruptReject: before.user.byKind["short-interrupt"]?.rejectRatePct },
  after: { echoCatch: after.echo.catchRatePct, falseReject: after.user.falseRejectRatePct, shortInterruptReject: after.user.byKind["short-interrupt"]?.rejectRatePct },
  delta: report.delta,
}, null, 2));
