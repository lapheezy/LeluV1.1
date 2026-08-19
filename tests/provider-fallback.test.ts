import assert from "node:assert/strict";
import test from "node:test";

import AIProviderRegistry from "../src/core/AIProviderRegistry";
import ExecutionLogger from "../src/core/ExecutionLogger";
import ProviderResolver from "../src/core/router/ProviderResolver";
import type AIProvider from "../src/providers/AIProvider";
import type {
  AIRequest,
  AIResponse,
  AIProviderHealth,
} from "../src/providers/AIProvider";

const request: AIRequest = {
  messages: [{ role: "user", content: "hello" }],
  prompt: "hello",
};

function fakeProvider(
  name: string,
  priority: number,
  generate: AIProvider["generate"],
): AIProvider {
  const health: AIProviderHealth = {
    available: true,
    initialized: true,
    lastChecked: Date.now(),
  };

  return {
    name,
    priority,
    enabled: true,
    timeout: 1000,
    requiresApiKey: false,
    capabilities: ["chat"],
    async initialize() {},
    async isAvailable() {
      return true;
    },
    async health() {
      return health;
    },
    canHandle() {
      return true;
    },
    generate,
  };
}

test("ProviderResolver falls through in priority order and preserves telemetry", async () => {
  const registry = new AIProviderRegistry();
  const primary = fakeProvider("Primary", 1, async () => {
    throw new Error("rate limited");
  });
  const secondaryResponse: AIResponse = {
    text: "hello from secondary",
    provider: "Secondary",
    model: "free-model",
    processingTime: 42,
    metadata: {
      usage: { total_tokens: 12 },
    },
  };
  const secondary = fakeProvider(
    "Secondary",
    2,
    async () => secondaryResponse,
  );

  registry.registerMany([secondary, primary]);
  await registry.initialize();

  const logger = new ExecutionLogger();
  const result = await new ProviderResolver().execute({
    request,
    started: Date.now(),
    brain: {} as never,
    knowledgeProviders: {} as never,
    aiProviders: registry,
    logger,
  });

  assert.equal(result.response?.provider, "Secondary");
  assert.equal(result.response?.metadata?.usage, secondaryResponse.metadata?.usage);
  assert.equal(registry.failure("Primary")?.reason, "rate limited");
  assert.equal(
    logger.all().some((entry) => entry.message.includes("falling back")),
    true,
  );
  assert.equal(
    logger.all().some((entry) => entry.metadata?.activeProvider === "Secondary"),
    true,
  );

  const availableAfterFailure = await registry.available();
  assert.deepEqual(availableAfterFailure.map((provider) => provider.name), [
    "Secondary",
  ]);
});
