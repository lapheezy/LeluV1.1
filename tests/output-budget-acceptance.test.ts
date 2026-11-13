/**
 * ==========================================================
 * LÉLU — OUTPUT BUDGET AND TRUNCATION
 *
 * CATEGORY: integration (provider + stubbed HTTP). No network.
 *
 * Mission 6.1.4 added DEFAULT_OUTPUT_TOKENS = 2048 because an unset
 * `max_tokens` made OpenRouter reserve its whole 16,384-token ceiling
 * and refuse the turn for credits. That default is only safe if two
 * things are true, and both are pinned here:
 *
 *   1. a caller's own maxTokens is never overwritten by it;
 *   2. a reply the provider CUT OFF (finish_reason=length) is marked
 *      truncated, so a 200 is not mistaken for a complete answer.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

// A placeholder, not a credential: the transport is stubbed below.
process.env.VITE_GROQ_API_KEY ??= "test-only-placeholder";
process.env.VITE_OPENROUTER_API_KEY ??= "test-only-placeholder";

const realFetch = globalThis.fetch;

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

function stubProviderHttp(choices: unknown, capture: Captured[]) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!/groq\.com|openrouter\.ai/.test(url)) return realFetch(input as never, init as never);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    capture.push({ url, body });
    if (body.stream === true) {
      const frame =
        `data: ${JSON.stringify({ id: "t", choices: [{ delta: { content: "hi" }, index: 0 }] })}\n\n` +
        `data: ${JSON.stringify({ id: "t", choices: [{ delta: {}, finish_reason: "length", index: 0 }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n` +
        "data: [DONE]\n\n";
      return new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(
      JSON.stringify({
        id: "t",
        model: "stub",
        choices,
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

const restore = () => {
  globalThis.fetch = realFetch;
};

test("an ordinary Groq turn names the safe default output budget", async () => {
  const { default: GroqProvider } = await import("../src/providers/GroqProvider");
  const { DEFAULT_OUTPUT_TOKENS } = await import("../src/providers/AIProvider");
  const capture: Captured[] = [];
  stubProviderHttp([{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], capture);
  try {
    const provider = new GroqProvider();
    await provider.initialize();
    await provider.generate({ prompt: "hello", messages: [], model: "llama-test" } as never);
    assert.equal(capture.length, 1);
    assert.equal(capture[0].body.max_tokens, DEFAULT_OUTPUT_TOKENS);
  } finally {
    restore();
  }
});

test("a caller's own output budget is preserved, never overwritten", async () => {
  const { default: GroqProvider } = await import("../src/providers/GroqProvider");
  const capture: Captured[] = [];
  stubProviderHttp([{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], capture);
  try {
    const provider = new GroqProvider();
    await provider.initialize();
    await provider.generate({ prompt: "hello", messages: [], model: "llama-test", maxTokens: 6000 } as never);
    assert.equal(capture[0].body.max_tokens, 6000);
  } finally {
    restore();
  }
});

test("OpenRouter also names the budget instead of leaving the ceiling open", async () => {
  const { default: OpenRouterProvider } = await import("../src/providers/OpenRouterProvider");
  const { DEFAULT_OUTPUT_TOKENS } = await import("../src/providers/AIProvider");
  const capture: Captured[] = [];
  stubProviderHttp([{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], capture);
  try {
    const provider = new OpenRouterProvider();
    await provider.initialize();
    await provider.generate({ prompt: "hello", messages: [], model: "openai/gpt-4o-mini" } as never);
    assert.equal(capture[0].body.max_tokens, DEFAULT_OUTPUT_TOKENS);
  } finally {
    restore();
  }
});

test("a cut-off reply is marked truncated, not reported as complete", async () => {
  const { default: GroqProvider } = await import("../src/providers/GroqProvider");
  const capture: Captured[] = [];
  stubProviderHttp([{ message: { role: "assistant", content: "The answer is half" }, finish_reason: "length" }], capture);
  try {
    const provider = new GroqProvider();
    await provider.initialize();
    const response = await provider.generate({ prompt: "explain", messages: [], model: "llama-test" } as never);
    const metadata = (response.metadata ?? {}) as Record<string, unknown>;
    assert.equal(metadata.truncated, true, "a length-truncated reply was reported as complete");
    assert.equal(metadata.finishReason, "length");
  } finally {
    restore();
  }
});

test("a complete reply is not flagged as truncated", async () => {
  const { default: GroqProvider } = await import("../src/providers/GroqProvider");
  const capture: Captured[] = [];
  stubProviderHttp([{ message: { role: "assistant", content: "whole answer" }, finish_reason: "stop" }], capture);
  try {
    const provider = new GroqProvider();
    await provider.initialize();
    const response = await provider.generate({ prompt: "explain", messages: [], model: "llama-test" } as never);
    const metadata = (response.metadata ?? {}) as Record<string, unknown>;
    assert.equal(metadata.truncated, false);
  } finally {
    restore();
  }
});
