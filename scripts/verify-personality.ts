/**
 * ==========================================================
 * LÉLU — PERSONALITY ACCEPTANCE RUNNER
 *
 * Prints the real measurements from the voice evaluation:
 * stance fidelity, boilerplate density, lexical diversity,
 * repetition and sentence rhythm, baseline vs evolved — plus
 * the before/after text for every scenario.
 *
 * These samples are deterministic and provider-free on purpose:
 * the point is that the SYSTEM (profile + stance + directive +
 * transformation) is what changed. Live-model comparison is a
 * separate manual step and is not claimed here.
 *
 * Usage: npm run verify:personality
 * ==========================================================
 */

import { evaluateSuite, SCENARIOS } from "../src/core/identity/voice/VoiceEvaluation";
import { composeVoice } from "../src/core/identity/voice/VoiceComposer";
import { stripChatbotisms } from "../src/core/identity/voice/ChatbotismFilter";
import { formatCognitiveContext, buildCognitiveContext } from "../src/core/cognition/CognitiveContext";

const suite = evaluateSuite();

function row(label: string, baseline: number, evolved: number): string {
  return `  ${label.padEnd(24)} ${String(baseline).padStart(8)} ${String(evolved).padStart(8)}`;
}

console.log("LÉLU — CONVERSATIONAL PERSONALITY EVALUATION");
console.log("============================================\n");
console.log("Metric                    baseline   evolved");
console.log(row("boilerplate /100 words", suite.baseline.boilerplate, suite.evolved.boilerplate));
console.log(row("lexical diversity (TTR)", suite.baseline.diversity, suite.evolved.diversity));
console.log(row("repeated 3-grams", suite.baseline.repetition, suite.evolved.repetition));
console.log(row("sentence rhythm (sd)", suite.baseline.rhythm, suite.evolved.rhythm));
console.log(row("stance fidelity", 0, suite.meanFit));
console.log(`\nBoilerplate removed by the response transformation alone: ${suite.boilerplateRemovedByTransform}\n`);

for (const scenario of suite.scenarios) {
  const source = SCENARIOS.find((item) => item.id === scenario.id);
  console.log(`--- ${scenario.name} (${scenario.id}) — ${scenario.stance.register}/${scenario.stance.length}`);
  console.log(`    stance fit: ${scenario.fit} · boilerplate ${scenario.baseline.boilerplate} → ${scenario.evolved.boilerplate}`);
  console.log(`\n  BEFORE:\n    ${(source?.baseline ?? "").replace(/\n/g, "\n    ")}`);
  console.log(`\n  AFTER:\n    ${(source?.evolved ?? "").replace(/\n/g, "\n    ")}\n`);
}

console.log("--- WHAT THE MODEL IS ACTUALLY TOLD (this turn) ---\n");
const composition = composeVoice({
  prompt: "this effect fires twice and the type is wrong",
  recentMessages: [
    { role: "user", content: "ngl the build is mid, no cap" },
    { role: "assistant", content: "It builds. The loading state is the only part that got attention." },
  ],
});
console.log(composition.text);
console.log(`\nstance: ${composition.stance.reasons.join(" | ")}`);
console.log(`familiarity: ${composition.familiarity.tier} (${composition.familiarity.score})`);

console.log("\n--- RESPONSE TRANSFORMATION ---\n");
const raw = "Certainly! As an AI language model, I can help. The effect depends on an inline object, so it re-runs every render. I hope this helps! Let me know if you need anything else!";
const cleaned = stripChatbotisms(raw);
console.log(`removed: ${cleaned.removed.join(" | ")}`);
console.log(`result:  ${cleaned.text}`);

console.log("\n--- COGNITIVE CONTEXT (personality section) ---\n");
try {
  const context = formatCognitiveContext(buildCognitiveContext());
  const personality = context.slice(context.indexOf("## LÉLU PERSONALITY"));
  console.log(personality.split("\n\n")[0]);
} catch (error) {
  console.log(`  (context assembly unavailable in this runtime: ${error instanceof Error ? error.message : String(error)})`);
}

const failures: string[] = [];
if (suite.meanFit < 0.95) failures.push(`stance fidelity ${suite.meanFit} < 0.95`);
if (suite.evolved.boilerplate !== 0) failures.push(`evolved boilerplate ${suite.evolved.boilerplate} !== 0`);
if (suite.evolved.repetition > 0.02) failures.push(`repetition ${suite.evolved.repetition} > 0.02`);
if (suite.evolved.diversity < 0.6) failures.push(`diversity ${suite.evolved.diversity} < 0.6`);

console.log("\n============================================");
if (failures.length > 0) {
  console.log("FAILED:");
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("PASSED — stance fidelity, boilerplate, repetition and diversity within acceptance.");
}
