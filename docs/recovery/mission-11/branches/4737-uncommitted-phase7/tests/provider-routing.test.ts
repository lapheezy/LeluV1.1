/**
 * ==========================================================
 * LÉLU — PROVIDER ROUTING ORDER
 *
 * CATEGORY: unit. Real ModelRouter and real environment resolver;
 * nothing is stubbed except the process environment.
 *
 * Why this exists: VITE_DEFAULT_PROVIDER=anthropic was read, reported
 * in diagnostics, and then appended LAST to the preference list — so it
 * only decided ties and the priority chain (Groq, OpenRouter, …)
 * answered first whenever one of those was configured. "Use Anthropic"
 * has to mean Anthropic is actually attempted first.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { AIRequest } from "../src/providers/AIProvider";

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return { messages: [], prompt: "hello", ...overrides };
}

test("the configured default provider is attempted first, with the chain intact behind it", async () => {
  const runtime = globalThis as unknown as Record<string, string | undefined>;
  runtime.__LELU_DEFAULT_PROVIDER__ = "anthropic";

  const { reloadEnvironment } = await import("../src/core/Environment");
  reloadEnvironment();

  const { default: ModelRouter } = await import("../src/core/model/ModelRouter");
  const decision = ModelRouter.getInstance().route(request());

  assert.equal(decision.preferredProviders[0], "Anthropic");
  assert.match(decision.reason, /Anthropic/);
  // Routing only ORDERS; it must not disable anything. Anything named here
  // is tried first and ProviderResolver then walks the rest of the registry
  // priority chain, so a failing Anthropic still degrades as before.
  assert.equal(decision.offlineEnabled, false);
  assert.deepEqual(decision.blockedProviders, []);
});

test("a text-only default cannot lead a vision turn", async () => {
  const runtime = globalThis as unknown as Record<string, string | undefined>;
  runtime.__LELU_DEFAULT_PROVIDER__ = "cerebras";

  const { reloadEnvironment } = await import("../src/core/Environment");
  reloadEnvironment();

  const { default: ModelRouter } = await import("../src/core/model/ModelRouter");
  const decision = ModelRouter.getInstance().route(
    request({
      media: [{ kind: "image", dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png" }],
    }),
  );

  assert.equal(decision.modality, "vision");
  assert.notEqual(
    decision.preferredProviders[0],
    "Cerebras",
    "a provider that cannot read images must not lead a vision turn",
  );
  // The lead is one of the catalog's vision-capable providers.
  assert.ok(
    ["Groq", "OpenRouter", "GitHub Models", "Anthropic"].includes(
      decision.preferredProviders[0],
    ),
    `expected a vision provider first, got ${decision.preferredProviders[0]}`,
  );
});
