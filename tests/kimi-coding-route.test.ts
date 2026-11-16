/**
 * Kimi-on-Fireworks coding route + Anthropic opt-in policy.
 * Offline: fetch is stubbed, so this pins behaviour, not the network.
 * The live counterpart is scripts/verify-kimi-fireworks.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";

import FireworksProvider from "../src/providers/FireworksProvider";
import AnthropicProvider from "../src/providers/AnthropicProvider";
import ModelRouter from "../src/core/model/ModelRouter";
import { defaultModel } from "../src/core/ProviderModels";
import { anthropicEnabled } from "../src/core/model/ProviderPolicy";
import AnthropicEngineeringAgent from "../src/core/engineering/AnthropicEngineeringAgent";

const KIMI = "accounts/fireworks/models/kimi-k3p1-pro";

function withEnv(values: Record<string, string | undefined>, body: () => Promise<void>): Promise<void> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(values)) {
    previous[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return body().finally(() => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function stubFetch(handler: (body: any) => Response): { bodies: any[]; restore: () => void } {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    bodies.push(body);
    return handler(body);
  }) as typeof fetch;
  return { bodies, restore: () => { globalThis.fetch = original; } };
}

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1 } }), { status: 200 });

test("the coding model defaults to serverless Kimi K3.1 Pro", () => {
  assert.equal(defaultModel("fireworksCoding"), KIMI);
});

test("coding turns use the coding model; chat turns keep the chat model", async () => {
  await withEnv({ FIREWORKS_API_KEY: "test", FIREWORKS_CODING_MODEL: undefined, VITE_FIREWORKS_CODING_MODEL: undefined }, async () => {
    const fetchStub = stubFetch(() => ok("done"));
    try {
      const fw = new FireworksProvider();
      await fw.initialize();
      const coding = await fw.generate({ prompt: "fix it", messages: [], workload: "coding" });
      const chat = await fw.generate({ prompt: "hi", messages: [] });
      assert.equal(fetchStub.bodies[0].model, KIMI);
      assert.equal(coding.model, KIMI);
      assert.equal(fetchStub.bodies[1].model, defaultModel("fireworks"));
      assert.notEqual(chat.model, KIMI);
    } finally {
      fetchStub.restore();
    }
  });
});

test("FIREWORKS_CODING_MODEL overrides the coding model", async () => {
  await withEnv({ FIREWORKS_API_KEY: "test", FIREWORKS_CODING_MODEL: "accounts/fireworks/models/kimi-k2p7-code" }, async () => {
    const fetchStub = stubFetch(() => ok("done"));
    try {
      const fw = new FireworksProvider();
      await fw.initialize();
      await fw.generate({ prompt: "x", messages: [], workload: "coding" });
      assert.equal(fetchStub.bodies[0].model, "accounts/fireworks/models/kimi-k2p7-code");
    } finally {
      fetchStub.restore();
    }
  });
});

test("streamed responses deliver deltas and assemble tool calls", async () => {
  await withEnv({ FIREWORKS_API_KEY: "test" }, async () => {
    const sse = [
      { choices: [{ delta: { content: "Look" } }] },
      { choices: [{ delta: { content: "ing" } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "read_file", arguments: "{\"pa" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "th\":\"a.ts\"}" } }] }, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } },
    ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    const fetchStub = stubFetch(() => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    try {
      const fw = new FireworksProvider();
      await fw.initialize();
      const seen: string[] = [];
      const r = await fw.generate({
        prompt: "x",
        messages: [],
        workload: "coding",
        onDelta: (t) => seen.push(t),
        tools: [{ name: "read_file", description: "read", parameters: { type: "object" } }],
      });
      assert.equal(fetchStub.bodies[0].stream, true);
      assert.deepEqual(seen, ["Look", "Looking"]);
      assert.equal(r.toolCalls?.[0].name, "read_file");
      assert.deepEqual(r.toolCalls?.[0].arguments, { path: "a.ts" });
      assert.deepEqual(r.metadata?.usage, { prompt_tokens: 10, completion_tokens: 4 });
    } finally {
      fetchStub.restore();
    }
  });
});

test("engineering intent routes the coding provider (Fireworks) first", () => {
  const decision = ModelRouter.getInstance().route({ prompt: "refactor this", messages: [] }, "engineering");
  assert.equal(decision.preferredProviders[0], "Fireworks");
  assert.equal(decision.workload, "coding");
});

test("Anthropic is disabled by default even with a key, and opt-in works", async () => {
  await withEnv({ LELU_ENABLE_ANTHROPIC: undefined, VITE_LELU_ENABLE_ANTHROPIC: undefined, ANTHROPIC_API_KEY: "test" }, async () => {
    assert.equal(anthropicEnabled(), false);
    const a = new AnthropicProvider();
    await a.initialize();
    assert.equal(a.enabled, false);
    (a as { enabled: boolean }).enabled = true; // assignment cannot bypass the policy
    assert.equal(a.enabled, false);
    assert.equal(await a.isAvailable(), false);
    await assert.rejects(a.generate({ prompt: "hi", messages: [] }), /disabled by policy/);
  });
  await withEnv({ LELU_ENABLE_ANTHROPIC: "true" }, async () => {
    assert.equal(anthropicEnabled(), true);
    assert.equal(new AnthropicProvider().enabled, true);
  });
});

test("the Anthropic managed engineering agent is unavailable unless opted in", async () => {
  await withEnv({ LELU_ENABLE_ANTHROPIC: undefined, VITE_LELU_ENABLE_ANTHROPIC: undefined, ANTHROPIC_API_KEY: "test", GITHUB_TOKEN: "test" }, async () => {
    const gate = AnthropicEngineeringAgent.getInstance().availability();
    assert.equal(gate.available, false);
    assert.match(gate.reason ?? "", /disabled by policy/);
  });
});
