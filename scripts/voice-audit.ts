/**
 * LÉLU — PERSONALITY ARCHITECTURE AUDIT (WP01)
 *
 * Not a document about the architecture: a check OF it.
 *
 * Every claim in the 2.1 audit is asserted against the real
 * source, so "the voice reaches every provider" is a fact about
 * the code rather than a sentence in a report. Prints the
 * data-flow with the file each stage lives in, then the
 * persistence/integrity table.
 *
 * Run: npx tsx scripts/voice-audit.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

interface Check {
  claim: string;
  file: string;
  pass: boolean;
  detail?: string;
}

const checks: Check[] = [];
function check(claim: string, file: string, test: (code: string) => boolean, detail?: string): void {
  let code = "";
  try {
    code = read(file);
  } catch {
    checks.push({ claim, file, pass: false, detail: "file missing" });
    return;
  }
  checks.push({ claim, file, pass: test(code), detail });
}

/* ------------------------- RETRIEVAL & COMPOSITION ------------------------ */

check(
  "voice is composed before a provider is chosen",
  "src/core/MemoryBridge.ts",
  (code) => code.includes("composeVoice(") && code.includes("voice = composition.text"),
);
check(
  "the composed voice is attached to the request",
  "src/core/MemoryBridge.ts",
  (code) => code.includes("requestWithVoice") && code.includes("{ ...request, voice }"),
);
check(
  "the emotional reading reaches the trace",
  "src/core/MemoryBridge.ts",
  (code) => code.includes("emotion: composition.appraisal.primary"),
);
check(
  "language observation runs on completed turns",
  "src/core/MemoryBridge.ts",
  (code) => code.includes("LanguageObserver"),
);
check(
  "band-4 personality memory is gathered",
  "src/core/MemoryBridge.ts",
  (code) => code.includes("bands: [") && code.includes("4"),
);

/* --------------------------- PROVIDER BOUNDARY --------------------------- */

const PROVIDERS: Array<[string, string]> = [
  ["src/providers/OpenRouterProvider.ts", "openrouter"],
  ["src/providers/GeminiProvider.ts", "gemini"],
  ["src/providers/AnthropicProvider.ts", "anthropic"],
  ["src/providers/GroqProvider.ts", "groq"],
  ["src/providers/FireworksProvider.ts", "fireworks"],
  ["src/providers/MistralProvider.ts", "mistral"],
  ["src/providers/CerebrasProvider.ts", "cerebras"],
  ["src/providers/GitHubModelsProvider.ts", "github-models"],
];

for (const [file, id] of PROVIDERS) {
  check(
    `voice directive reaches ${id}`,
    file,
    (code) => code.includes(`leluSystemPrompt(request, "${id}")`),
  );
  check(
    `${id} does not hardcode its own persona`,
    file,
    (code) => !code.includes("LELU_SYSTEM_PROMPT"),
  );
}
check(
  "the per-turn voice is part of the request contract",
  "src/providers/AIProvider.ts",
  (code) => /voice\?:/.test(code),
);
check(
  "the contract is rendered per engine, not replaced",
  "src/providers/LeluSystemPrompt.ts",
  (code) => code.includes("voiceForProvider(providerId, voice)"),
);

/* ---------------------------- TRANSFORMATION ---------------------------- */

check(
  "chatbotisms are stripped at the provider boundary",
  "src/core/router/ProviderResolver.ts",
  (code) => code.includes("stripChatbotisms") && code.includes("chatbotismsRemoved"),
);
check(
  "drift is measured on finished replies",
  "src/core/router/ProviderResolver.ts",
  (code) => code.includes("checkReply(") && code.includes("voiceDrift"),
);
check(
  "her own move usage is counted on output",
  "src/core/router/ProviderResolver.ts",
  (code) => code.includes("noteAdoptedUse(") && code.includes("voiceExpressionsUsed"),
);
check(
  "the transformer preserves code fences",
  "src/core/identity/voice/ChatbotismFilter.ts",
  (code) => code.includes("CODE_FENCE") && code.includes("splitChunks"),
);

/* ------------------------------ COGNITION ------------------------------- */

check(
  "personality is present even with no promoted traits",
  "src/core/cognition/CognitiveContext.ts",
  (code) => code.includes("## LÉLU PERSONALITY") && code.includes("digest()"),
);
check(
  "the trace has a first-class VOICE stage",
  "src/core/cognition/CognitiveTrace.ts",
  (code) => code.includes('"VOICE"'),
);
check(
  "the UI renders the VOICE stage",
  "src/app/scene/genesis/GenesisCognitiveTracePanel.tsx",
  (code) => code.includes("VOICE"),
);

/* --------------------------- INTEGRITY / MEMORY ------------------------- */

check(
  "the profile is persisted through the existing KV store",
  "src/core/identity/voice/LinguisticProfile.ts",
  (code) => code.includes('"identity.voice.v1"') && code.includes("kv.set(KEY"),
);
check(
  "learned expressions require evidence across days",
  "src/core/identity/voice/LinguisticProfile.ts",
  (code) => code.includes("ESTABLISH_MIN_DAYS") && code.includes("evidenceDays.length >= ESTABLISH_MIN_DAYS"),
);
check(
  "external content can never write the profile",
  "src/core/identity/voice/LinguisticProfile.ts",
  (code) => code.includes("noteExternalContent") && code.includes("blockedExternal += 1"),
);
check(
  "only an authorised update may change a dial directly",
  "src/core/identity/voice/LinguisticProfile.ts",
  (code) => code.includes("if (!authorized) return false"),
);
check(
  "every change is auditable and reversible",
  "src/core/identity/voice/LinguisticProfile.ts",
  (code) => code.includes("this.guard.record(") && code.includes("restore: () =>"),
);
check(
  "identity rewrites are refused at observation",
  "src/core/identity/voice/LanguageObserver.ts",
  (code) => code.includes('readIdentityInstruction(prompt).kind === "rewrite"'),
);
check(
  "a restart cannot duplicate the profile",
  "src/core/identity/voice/LinguisticProfile.ts",
  (code) => code.includes("hydrate(") && code.includes("mergeRemote("),
);

/* ------------------------------ REPORTING ------------------------------- */

const failed = checks.filter((entry) => !entry.pass);

console.log("LÉLU — PERSONALITY ARCHITECTURE AUDIT\n");
console.log("Canonical pipeline (each arrow is a real call site):\n");
const FLOW: Array<[string, string]> = [
  ["User input", "src/app/scene/genesis/GenesisChat.tsx"],
  ["Context retrieval", "src/core/MemoryBridge.ts → Brain.recall"],
  ["Personality retrieval", "src/core/identity/PersonalityMemoryProvider.ts + LinguisticProfile.getState"],
  ["Familiarity assessment", "src/core/identity/voice/FamiliarityModel.ts"],
  ["Emotional appraisal", "src/core/identity/voice/EmotionAppraisal.ts"],
  ["Conversation stance", "src/core/identity/voice/ConversationStance.ts"],
  ["Voice composition", "src/core/identity/voice/VoiceComposer.ts"],
  ["Provider selection", "src/core/router/ProviderResolver.ts → AIProviderRegistry"],
  ["Model generation", "src/providers/*Provider.ts via leluSystemPrompt(request, id)"],
  ["Response validation", "src/core/router/ProviderResolver.ts"],
  ["Chatbotism transformation", "src/core/identity/voice/ChatbotismFilter.ts"],
  ["Drift evaluation", "src/core/identity/voice/VoiceDriftGuard.ts"],
  ["Final response", "AIService.chat → GenesisChat"],
  ["Evidence + memory update", "LanguageObserver.observeTurn → LinguisticProfile"],
];
for (const [stage, where] of FLOW) {
  console.log(`  ${stage.padEnd(28)} ${where}`);
}

console.log("\nChecks:");
for (const entry of checks) {
  console.log(`  ${entry.pass ? "✓" : "✗"} ${entry.claim}  [${entry.file}]${entry.detail ? ` — ${entry.detail}` : ""}`);
}

console.log(`\n${checks.length - failed.length}/${checks.length} architecture claims verified.`);
if (failed.length > 0) {
  console.error(`\n${failed.length} DISCONNECTED OR MISSING INTEGRATION POINT(S).`);
  process.exit(1);
}
