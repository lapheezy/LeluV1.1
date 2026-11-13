/**
 * ==========================================================
 * MISSION 6.1.4 — WHERE THE TOOL TOKENS COME FROM
 *
 * The chat path reaches a provider through ProviderResolver.generateWithTools,
 * which offers `toolSchemasForRequest(prompt, intent)` and then fits the body
 * to the provider ceiling with `fitRequestBudget`. This script calls those
 * exact functions — no reimplementation — and prints what each one decides
 * for a given prompt and provider.
 *
 * It prints counts and sizes only: never a tool description's text, never a
 * credential.
 * ==========================================================
 */

import { toolSchemasForModel, toolSchemasForRequest, reducedToolSchemas } from "../src/core/tools/ToolSchemas.ts";
import { describeRequestBudget, fitRequestBudget, requestCeiling } from "../src/core/router/RequestBudget.ts";

const TOKENS_PER_BYTE = 1 / 3.2; // measured JSON-schema density (see RequestBudget.ts)

const bytes = (value: unknown): number =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value ?? "")).length;

const prompts: Array<[string, string, string | undefined]> = [
  ["conversational", "What are you?", undefined],
  ["conversational (task-ish)", "Explain in one short paragraph what entropy means.", undefined],
  ["environment", "Build me a table panel in the workspace.", "environment"],
  ["tool-ish", "Search the web for today's space weather and save it to a file.", undefined],
];

const named = (schemas: Array<{ name: string }>) => schemas.map((schema) => schema.name);

console.log("\nTOOL SURFACE");
const full = toolSchemasForModel();
const fullBytes = bytes(full);
console.log(`  registered ∩ executable ∩ permitted   ${full.length} tools`);
console.log(`  serialized bytes                     ${fullBytes} (${(fullBytes / 1024).toFixed(1)} KB)`);
console.log(`  tokens at 3.2 bytes/token            ~${Math.round(fullBytes * TOKENS_PER_BYTE)}`);
console.log(`  tokens at 4 bytes/token              ~${Math.round(fullBytes / 4)}`);

console.log("\nWHAT ONE TURN IS OFFERED (toolSchemasForRequest)");
for (const [label, prompt, intent] of prompts) {
  const offered = toolSchemasForRequest(prompt, intent);
  const size = bytes(offered);
  console.log(
    `  ${label.padEnd(26)} ${String(offered.length).padStart(3)} tools  ${String(size).padStart(7)} B  ~${String(Math.round(size * TOKENS_PER_BYTE)).padStart(6)} tok  ${offered.length === full.length ? "(FULL SET)" : ""}`,
  );
}

console.log("\nWHAT A SIZE-REFUSED RETRY IS OFFERED (reducedToolSchemas)");
for (const [label, prompt, intent] of prompts) {
  const offered = reducedToolSchemas(prompt, intent);
  const size = bytes(offered);
  console.log(`  ${label.padEnd(26)} ${String(offered.length).padStart(3)} tools  ${String(size).padStart(7)} B  ~${String(Math.round(size * TOKENS_PER_BYTE)).padStart(6)} tok`);
}

console.log("\nCEILINGS (requestCeiling)");
for (const [provider, model] of [
  ["groq", "openai/gpt-oss-120b"],
  ["groq", "openai/gpt-oss-20b"],
  ["openrouter", "openai/gpt-4o-mini"],
] as Array<[string, string]>) {
  const ceiling = requestCeiling({ provider, model, maxTokens: 1024 });
  console.log(`  ${provider}/${model}`.padEnd(38) + `${ceiling.bytes} B (${(ceiling.bytes / 1024).toFixed(1)} KB) ← ${ceiling.source}: ${ceiling.detail}`);
}

console.log("\nDOES THE FITTER ACTUALLY SHRINK A CONVERSATIONAL TURN?");
const system = { role: "system" as const, content: "x".repeat(1700) }; // ~428 tokens, as measured in 6.1.3
const history = [
  { role: "user" as const, content: "y".repeat(6000) },
  { role: "assistant" as const, content: "z".repeat(6000) },
  { role: "user" as const, content: "w".repeat(3000) },
];
for (const [provider, model] of [
  ["groq", "openai/gpt-oss-120b"],
  ["openrouter", "openai/gpt-4o-mini"],
] as Array<[string, string]>) {
  const tools = toolSchemasForRequest("What are you?");
  const before = describeRequestBudget({ messages: [system, ...history] as never, prompt: "What are you?", tools });
  const fitted = fitRequestBudget({
    messages: [system, ...history] as never,
    prompt: "What are you?",
    tools,
    tier: "FULL",
    provider,
    model,
    protectedTail: 12,
  });
  console.log(`\n  ${provider}/${model}`);
  console.log(`    before   ${before.totalBytes} B (${(before.totalBytes / 1024).toFixed(1)} KB), ${before.toolCount} tools, ${(before.toolSchemaBytes / 1024).toFixed(1)} KB of schemas`);
  console.log(`    ceiling  ${fitted.ceiling.bytes} B (${(fitted.ceiling.bytes / 1024).toFixed(1)} KB) ← ${fitted.ceiling.source}`);
  console.log(`    after    ${fitted.budget.totalBytes} B (${(fitted.budget.totalBytes / 1024).toFixed(1)} KB), ${fitted.budget.toolCount} tools, tier ${fitted.tier}`);
  console.log(`    changed  ${fitted.changed} — dropped ${fitted.droppedTools} tools, ${fitted.droppedMessages} messages, trimmed ${fitted.trimmedMessages}`);
  if (fitted.notes.length > 0) console.log(`    notes    ${fitted.notes.join("; ")}`);
}

console.log("\nFIRST TOOLS THE FULL SET CARRIES (order = drop order is from the end)");
console.log("  " + named(full).slice(0, 8).join(", ") + " …");
console.log("  " + named(full).slice(-6).join(", ") + "  ← these are the first withheld");
console.log("");
