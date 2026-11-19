/**
 * LÉLU — VOICE PERFORMANCE BENCH (WP14)
 *
 * Answers one question with numbers: what does the personality
 * layer cost per turn?
 *
 * Everything measured here is local, deterministic work that runs
 * before or after the model call. No provider is contacted.
 *
 * Run: npx tsx scripts/voice-bench.ts
 */

import { composeVoice } from "../src/core/identity/voice/VoiceComposer";
import VoicePerformance from "../src/core/identity/voice/VoicePerformance";
import { stripChatbotisms } from "../src/core/identity/voice/ChatbotismFilter";
import { appraise } from "../src/core/identity/voice/EmotionAppraisal";
import { checkReply } from "../src/core/identity/voice/VoiceDriftGuard";

const PROMPTS = [
  "hey, how's it going?",
  "it still doesn't work. third time. i already told you the error.",
  "my dad died last month and i can't focus on anything",
  "walk me through how the memory bands fit together in detail",
  "no, i disagree — React is always better than Vue",
  "ngl this build is mid, no cap",
  "ASAP — demo in 10 minutes, the build is broken",
  "write me a short story about a machine that forgets on purpose",
  "can you fix it?",
  "be straight with me: is this architecture going to hold at scale?",
];

const REPLY = [
  "Two causes, same symptom. StrictMode double-invokes effects in development only; in production the id changes identity every render, so the effect re-runs.",
  "The type error is separate: load(id) probably expects a narrowed id rather than the raw one. Fix the identity first, then the type follows.",
  "If it still fires twice after that, the dependency is not the problem — the component is remounting. Check the key.",
].join("\n\n");

function time<T>(run: () => T): { ms: number; value: T } {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

function stats(samples: number[]): { mean: number; p50: number; p95: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    mean: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(3)),
    p50: Number(at(0.5).toFixed(3)),
    p95: Number(at(0.95).toFixed(3)),
  };
}

const perf = VoicePerformance.getInstance();
perf.reset();

// Warm-up: the first call loads the profile from storage.
for (let index = 0; index < 5; index += 1) composeVoice({ prompt: PROMPTS[index % PROMPTS.length] });

const composeSamples: number[] = [];
const perPrompt: Array<{ prompt: string; ms: number; chars: number; emotion: string; mode: string }> = [];
for (let index = 0; index < 200; index += 1) {
  const prompt = PROMPTS[index % PROMPTS.length];
  const { ms, value } = time(() => composeVoice({ prompt }));
  composeSamples.push(ms);
  if (index < PROMPTS.length * 2) {
    perPrompt.push({
      prompt,
      ms: Number(ms.toFixed(3)),
      chars: value.text.length,
      emotion: value.appraisal.primary,
      mode: value.appraisal.mode,
    });
  }
}

const transformSamples: number[] = [];
for (let index = 0; index < 200; index += 1) {
  const { ms } = time(() => stripChatbotisms(REPLY));
  transformSamples.push(ms);
}

const appraisalSamples: number[] = [];
for (let index = 0; index < 500; index += 1) {
  const prompt = PROMPTS[index % PROMPTS.length];
  const { ms } = time(() => appraise(prompt));
  appraisalSamples.push(ms);
}

const driftSamples: number[] = [];
for (let index = 0; index < 200; index += 1) {
  const { ms } = time(() => checkReply({ reply: REPLY, recentReplies: [REPLY], provider: "Groq" }));
  driftSamples.push(ms);
}

console.log("LÉLU — voice performance (local, no provider calls)\n");
console.log(`composeVoice        ${JSON.stringify(stats(composeSamples))} ms over 200 turns`);
console.log(`  per stage         ${JSON.stringify(perf.summary().perStage)}`);
console.log(`stripChatbotisms    ${JSON.stringify(stats(transformSamples))} ms over 200 replies`);
console.log(`appraise            ${JSON.stringify(stats(appraisalSamples))} ms over 500 messages`);
console.log(`checkReply          ${JSON.stringify(stats(driftSamples))} ms over 200 replies`);

const directive = composeVoice({ prompt: PROMPTS[1] });
console.log(`\ndirective size      ${directive.text.length} chars (full density)`);
console.log(`stance              ${directive.stance.register}/${directive.stance.length}, fallback ${directive.stance.challenge}`);
console.log("\nper-prompt (first two passes):");
for (const row of perPrompt) {
  console.log(`  ${String(row.ms).padStart(6)}ms  ${row.emotion.padEnd(13)} ${row.mode.padEnd(9)} ${String(row.chars).padStart(5)}c  ${row.prompt.slice(0, 48)}`);
}
