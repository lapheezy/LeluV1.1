/**
 * ==========================================================
 * LÉLU — PHASE 18: NO DUPLICATE SYSTEMS AUDIT
 *
 * Verifies there is exactly ONE of each core singleton/system
 * in the codebase. Adding a second AIService, Orchestrator,
 * MemoryBridge, MultiChatStore, ProviderResolver, or streaming
 * architecture is a hard constraint violation.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function grep(pattern: string, flags = ""): string[] {
  try {
    const result = execSync(
      `grep -rn ${flags} "${pattern}" src/ --include="*.ts" --include="*.tsx"`,
      { cwd: "/home/user/LeluV1.1", encoding: "utf8" },
    );
    return result.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ---- Core singletons must exist exactly once ----------------------

test("AIService is defined exactly once", () => {
  const hits = grep("^export default class AIService\\b", "-E");
  assert.equal(hits.length, 1, `AIService class must be defined exactly once, found: ${hits.join(", ")}`);
});

test("ProviderResolver is defined exactly once", () => {
  const hits = grep("^export default class ProviderResolver\\b", "-E");
  assert.equal(hits.length, 1, `ProviderResolver must be defined exactly once, found: ${hits.join(", ")}`);
});

test("Orchestrator is defined exactly once", () => {
  const hits = grep("^export default class Orchestrator\\b", "-E");
  assert.equal(hits.length, 1, `Orchestrator must be defined exactly once, found: ${hits.join(", ")}`);
});

test("MemoryBridge is defined exactly once", () => {
  const hits = grep("^export default class MemoryBridge\\b", "-E");
  assert.equal(hits.length, 1, `MemoryBridge must be defined exactly once, found: ${hits.join(", ")}`);
});

test("MultiChatStore is defined exactly once", () => {
  const hits = grep("^export default class MultiChatStore\\b", "-E");
  assert.equal(hits.length, 1, `MultiChatStore must be defined exactly once, found: ${hits.join(", ")}`);
});

// ---- No second chat UI, cognition loop, streaming system ----------

test("GenesisChat is the only chat scene component", () => {
  // Fixed-string search: "export default function GenesisChat(" matches only
  // the real component — GenesisChatSurface is a different name entirely.
  const defs = grep("export default function GenesisChat(", "-F");
  assert.equal(
    defs.length,
    1,
    `GenesisChat must be defined in exactly one file, found: ${defs.join(", ")}`,
  );
});

test("there is no second AgentCognitionRuntime class", () => {
  const hits = grep("class AgentCognitionRuntime\\b", "-E");
  assert.equal(hits.length, 1, `AgentCognitionRuntime must be defined exactly once`);
});

test("ToolDispatcher has a single dispatch entry point (dispatchToolCall)", () => {
  // ToolDispatcher is a module of exported functions, not a class.
  // The single authoritative entry point is dispatchToolCall.
  const hits = grep("export async function dispatchToolCall");
  assert.equal(hits.length, 1, `dispatchToolCall must be defined exactly once, found: ${hits.join(", ")}`);
});

// ---- AbortController used only in the one right place -------------

test("no AI provider or chat UI creates its own AbortController", () => {
  // Providers must delegate cancellation to AIService, not self-manage.
  // Local adapters (LocalLLMAdapter, BrowserTool, SourceAccess) may use
  // AbortController for their own timeouts — that is not a violation.
  const allHits = grep("new AbortController\\(\\)");
  const forbidden = allHits.filter((h) =>
    h.includes("src/providers/") || h.includes("GenesisChat"),
  );
  assert.equal(
    forbidden.length,
    0,
    `Providers and GenesisChat must not create their own AbortController: ${forbidden.join(", ")}`,
  );
});

// ---- Provider list is authoritative — no inline fetch bypasses ----

test("provider fetch calls all use AbortSignal (no unguarded fetch in providers)", () => {
  const providers = [
    "src/providers/AnthropicProvider.ts",
    "src/providers/GroqProvider.ts",
    "src/providers/OpenRouterProvider.ts",
    "src/providers/MistralProvider.ts",
    "src/providers/CerebrasProvider.ts",
    "src/providers/FireworksProvider.ts",
    "src/providers/GeminiProvider.ts",
    "src/providers/GitHubModelsProvider.ts",
  ];
  for (const path of providers) {
    const code = readFileSync(`/home/user/LeluV1.1/${path}`, "utf8");
    // Every provider file must reference AbortSignal somewhere
    assert.ok(
      /AbortSignal/.test(code),
      `${path}: must use AbortSignal (no unguarded fetch)`,
    );
  }
});
