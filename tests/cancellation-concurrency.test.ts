/**
 * ==========================================================
 * LÉLU — CANCELLATION AND CONCURRENCY REGRESSION SUITE
 *
 * CATEGORY: unit / integration (no network, no DOM).
 *
 * Covers:
 *   Phase 1-3  — chat cancellation: AbortSignal path, per-turn
 *                isolation (cancel A, B continues), Stop button
 *                contract on AIService.cancelTurn()
 *   Phase 16   — MultiChatStore regression guard
 *   Phase 17   — concurrent-chat isolation, TurnOwnership
 *                pre-binding, per-conversation Orchestrator queue
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// ---- helpers -------------------------------------------------------

function src(path: string): string {
  return readFileSync(path, "utf8");
}

// ---- Phase 3: Signal audit ----------------------------------------

test("AIProvider.ts declares signal?: AbortSignal on AIRequest", () => {
  const code = src("src/providers/AIProvider.ts");
  assert.ok(
    /signal\?\s*:\s*AbortSignal/.test(code),
    "AIRequest must have signal?: AbortSignal",
  );
});

test("every provider combines request.signal with its timeout via AbortSignal.any", () => {
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
    const code = src(path);
    assert.ok(
      /AbortSignal\.any\(\[request\.signal/.test(code),
      `${path}: fetch signal must use AbortSignal.any([request.signal, ...])`,
    );
  }
});

test("AIService holds a per-conversation AbortController map", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    /convControllers\s*=\s*new Map/.test(code),
    "AIService must declare convControllers Map",
  );
});

test("AIService exposes cancelTurn(conversationId)", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    /public cancelTurn\(conversationId/.test(code),
    "AIService must have a public cancelTurn method",
  );
  // Must abort the controller, not a global abort
  assert.ok(
    /convControllers\.get\(conversationId\)/.test(code),
    "cancelTurn must look up the per-conversation controller",
  );
});

test("AIService.chat creates a controller and passes signal to AIRequest", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    /new AbortController\(\)/.test(code),
    "chat() must create an AbortController",
  );
  assert.ok(
    /signal:\s*controller\.signal/.test(code),
    "chat() must pass controller.signal on the AIRequest",
  );
});

test("AIService.chat cleans up the controller in its finally block", () => {
  const code = src("src/core/AIService.ts");
  // Match both options.conversationId and options?.conversationId forms
  assert.ok(
    /convControllers\.delete\(options\??\.conversationId\)/.test(code),
    "finally block must delete the controller from the map",
  );
});

test("AIService.chat returns cancelled response without emitting an error notification", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    /provider:\s*["']cancelled["']/.test(code),
    "AbortError path must return provider: 'cancelled'",
  );
  // The isCancelled branch must NOT call emitNotification
  const cancelledBlock = code.match(/isCancelled[\s\S]*?return \{[\s\S]*?provider:.*?cancelled[\s\S]*?\};/);
  assert.ok(cancelledBlock, "isCancelled return block must exist");
  assert.ok(
    !/emitNotification/.test(cancelledBlock[0]),
    "cancelled path must not emit an error notification",
  );
});

// ---- Phase 1: Stop button in GenesisChat --------------------------

test("GenesisChat renders a Stop button (data-lelu-stop-button) while isSending", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    /data-lelu-stop-button/.test(code),
    "GenesisChat must render a Stop button with data-lelu-stop-button attribute",
  );
  assert.ok(
    /isSending/.test(code.slice(code.indexOf("data-lelu-stop-button") - 400, code.indexOf("data-lelu-stop-button") + 100)),
    "Stop button must be gated on isSending",
  );
});

test("GenesisChat stop handler calls ai.cancelTurn with the active conversationId", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    /ai\.cancelTurn\(conversationId\)/.test(code),
    "stopTurn must call ai.cancelTurn(conversationId)",
  );
});

test("GenesisChat settles silently (no error toast) when cancelledRef is set", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    /cancelledRef\.current/.test(code),
    "send() must check cancelledRef to detect user-initiated cancellation",
  );
  // After a cancel, setExchange(null) must be called (not showing an error)
  const cancelBlock = code.match(/cancelledRef\.current\s*[\s\S]{0,200}setExchange\(null\)/);
  assert.ok(cancelBlock, "cancel path must call setExchange(null) to clear the exchange");
});

// ---- Phase 14: Response-first -------------------------------------

test("AIService emits the message BEFORE the async memory/cognition work", () => {
  const code = src("src/core/AIService.ts");
  // "// RESPONSE-FIRST" marks the main-path emitMessage call. There is an
  // earlier void async IIFE in the file (delegation path, line ~348), so we
  // cannot use the first indexOf("void (async"). Instead: verify that the
  // RESPONSE-FIRST comment exists, and that memory.learn(message appears
  // in the void block that follows it (not before it).
  const rfIdx = code.indexOf("// RESPONSE-FIRST");
  assert.ok(rfIdx > 0, "// RESPONSE-FIRST comment must exist in AIService");
  const voidAfterRF = code.indexOf("void (async () => {", rfIdx);
  assert.ok(voidAfterRF > rfIdx, "a void async IIFE must follow the // RESPONSE-FIRST comment");
  const memLearnInVoid = code.indexOf("await this.memory.learn(message", voidAfterRF);
  assert.ok(
    memLearnInVoid > voidAfterRF,
    "memory.learn(message) must be inside the void async block (response-first ordering)",
  );
});

test("AIService fires memory/cognition work in a void async block after emitMessage", () => {
  const code = src("src/core/AIService.ts");
  assert.ok(
    /void \(async \(\) => \{/.test(code),
    "post-response work must be wrapped in a void async IIFE",
  );
});

test("AIService records the assistant turn synchronously before returning", () => {
  const code = src("src/core/AIService.ts");
  // conversation.record("assistant") in the main path (line ~663) must appear
  // before the response-first void async block (line ~669). Anchor the void
  // search from the // RESPONSE-FIRST comment to skip the earlier delegation
  // void at line ~348.
  const rfIdx = code.indexOf("// RESPONSE-FIRST");
  assert.ok(rfIdx > 0, "// RESPONSE-FIRST comment must exist");
  const voidAfterRF = code.indexOf("void (async () => {", rfIdx);
  assert.ok(voidAfterRF > rfIdx, "void async IIFE must follow the RESPONSE-FIRST comment");
  // Find conversation.record("assistant") between RESPONSE-FIRST and the void
  const recordInWindow = code.indexOf('conversation.record("assistant"', rfIdx);
  assert.ok(recordInWindow > 0, "conversation.record('assistant') must exist in main path");
  assert.ok(
    recordInWindow < voidAfterRF,
    "conversation.record('assistant') must appear synchronously before the void async block",
  );
});

// ---- Phase 16: MultiChatStore regression guard --------------------

test("MultiChatStore.flush method exists (durable write path)", () => {
  const code = src("src/core/multichat/MultiChatStore.ts");
  assert.ok(
    /flush\s*\(/.test(code),
    "MultiChatStore must expose a flush() method",
  );
});

test("MultiChatStore has a getActiveId method", () => {
  const code = src("src/core/multichat/MultiChatStore.ts");
  assert.ok(
    /getActiveId\s*\(/.test(code),
    "MultiChatStore must expose getActiveId()",
  );
});

// ---- Phase 17: Concurrency identity / TurnOwnership ---------------

test("TurnOwnership.bindMessage is exported and pre-registers messageId→conversationId", () => {
  const code = src("src/core/multichat/TurnOwnership.ts");
  assert.ok(
    /export function bindMessage/.test(code),
    "bindMessage must be exported from TurnOwnership",
  );
  assert.ok(
    /ownerByMessage\.set\(messageId, conversationId\)/.test(code),
    "bindMessage must set the ownerByMessage mapping",
  );
});

test("AIService.chat calls bindMessage before the first await", () => {
  const code = src("src/core/AIService.ts");
  const bindIdx = code.indexOf("bindMessage(streamId");
  const awaitIdx = code.indexOf("await this.memory.enrich");
  assert.ok(bindIdx > 0, "bindMessage must be called in chat()");
  assert.ok(awaitIdx > 0, "memory.enrich await must exist");
  assert.ok(
    bindIdx < awaitIdx,
    "bindMessage must be called before the first await (closes the attribution race)",
  );
});

test("Orchestrator uses per-conversation executingByConv Map (not a global boolean)", () => {
  const code = src("src/core/orchestrator/Orchestrator.ts");
  assert.ok(
    /executingByConv\s*=\s*new Map/.test(code),
    "Orchestrator must use a per-conversation Map for serialization",
  );
  assert.ok(
    !/executing\s*=\s*false/.test(code),
    "Orchestrator must NOT have a global boolean executing flag",
  );
});

test("GenesisChat uses per-conversation turn queue (convTailsRef Map)", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    /convTailsRef\s*=\s*useRef<Map/.test(code),
    "GenesisChat must use a per-conversation turn queue (convTailsRef)",
  );
});

test("GenesisChat stream listener filters events by conversationId", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  assert.ok(
    /event\.conversationId\s*&&\s*event\.conversationId\s*!==\s*turnConversationId/.test(code),
    "Stream listener must filter out events from other conversations",
  );
});

// ---- Phase 18: No duplicate systems --------------------------------

test("there is exactly one AbortController creation pattern in AIService", () => {
  const code = src("src/core/AIService.ts");
  const matches = [...code.matchAll(/new AbortController\(\)/g)];
  assert.equal(
    matches.length,
    1,
    "AIService must create exactly one AbortController (in chat())",
  );
});

test("cancelTurn is the single cancellation entry point — GenesisChat uses only it", () => {
  const code = src("src/app/scene/genesis/GenesisChat.tsx");
  // Should not create its own AbortController
  assert.ok(
    !/new AbortController/.test(code),
    "GenesisChat must not create its own AbortController — it delegates to ai.cancelTurn()",
  );
});
