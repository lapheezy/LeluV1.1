/**
 * ==========================================================
 * LÉLU — ANTHROPIC INTEGRATION CONTRACT
 *
 * CATEGORY: integration. The real AnthropicProvider and the
 * real model broker; only global fetch is substituted, so the
 * exact request LÉLU sends — and how she reads each kind of
 * reply — can be inspected without spending a real call.
 *
 * Why this exists: each case below was a way a current Claude
 * model turned a good turn into a provider failure (a silent
 * drop to the next vendor in the chain) or into a wrong answer:
 * sampling params on a model that rejects them, tool blocks in
 * a tool-less request, a truncated tool call executed anyway,
 * a refusal re-asked of another provider, a stream error read
 * as a finished reply, an overload with no retry.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import AnthropicProvider, {
  acceptsSamplingParams,
  replayableBlocks,
  retryDelayMs,
  supportsServerFallback,
  SERVER_FALLBACK_BETA,
} from "../src/providers/AnthropicProvider";
import type { AIMessage, AIRequest } from "../src/providers/AIProvider";
import { createModelApi, createRateLimiter } from "../plugins/modelApi";

/* ------------------------------ harness ------------------------------ */

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

type Reply = { status?: number; json?: unknown; sse?: string[]; headers?: Record<string, string> };

/** Replace fetch with a scripted upstream; returns what was sent. */
function scriptFetch(replies: Reply[]): { sent: Sent[]; restore: () => void } {
  const sent: Sent[] = [];
  const realFetch = globalThis.fetch;
  let index = 0;
  globalThis.fetch = (async (input: unknown, init: RequestInit) => {
    sent.push({
      url: String(input),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init.body ?? "{}")),
    });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    const status = reply.status ?? 200;
    if (reply.sse) {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of reply.sse!) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
          controller.close();
        },
      });
      return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify(reply.json ?? {}), {
      status,
      headers: { "content-type": "application/json", ...(reply.headers ?? {}) },
    });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = realFetch) };
}

async function provider(env: Record<string, string> = {}): Promise<AnthropicProvider> {
  const saved: Record<string, string | undefined> = {};
  const all = { ANTHROPIC_API_KEY: "sk-test", ...env };
  for (const [name, value] of Object.entries(all)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  const instance = new AnthropicProvider();
  await instance.initialize();
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  return instance;
}

function request(overrides: Partial<AIRequest> = {}): AIRequest {
  return { prompt: "hello", messages: [], ...overrides };
}

const text = (value: string, extra: Record<string, unknown> = {}) => ({
  json: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: value }], ...extra },
});

/* ------------------------------ request shape ------------------------------ */

test("sampling params are sent only to models that accept them", async () => {
  assert.equal(acceptsSamplingParams("claude-opus-5-5"), false);
  assert.equal(acceptsSamplingParams("claude-sonnet-5-5"), false);
  assert.equal(acceptsSamplingParams("claude-opus-4-7"), false);
  assert.equal(acceptsSamplingParams("claude-sonnet-4-5"), true);
  assert.equal(acceptsSamplingParams("claude-haiku-4-5-20251001"), true);
  assert.equal(acceptsSamplingParams("claude-3-5-sonnet-20241022"), true);

  const { sent, restore } = scriptFetch([text("ok")]);
  try {
    const p = await provider();
    await p.generate(request({ model: "claude-opus-5-5", temperature: 0 }));
    await p.generate(request({ model: "claude-sonnet-4-5", temperature: 0 }));
  } finally {
    restore();
  }
  assert.equal("temperature" in sent[0].body, false, "temperature reached a model that 400s on it");
  assert.equal(sent[1].body.temperature, 0, "a legacy model lost its temperature");
});

test("the default model is current and opts into the server-side refusal fallback", async () => {
  const { sent, restore } = scriptFetch([text("ok")]);
  try {
    await (await provider()).generate(request());
  } finally {
    restore();
  }
  assert.equal(sent[0].body.model, "claude-opus-5-5");
  assert.equal(sent[0].body.fallbacks, "default");
  assert.equal(sent[0].headers["anthropic-beta"], SERVER_FALLBACK_BETA);
});

test("the refusal fallback is per-model and can be switched off", async () => {
  assert.equal(supportsServerFallback("claude-sonnet-4-5"), false);
  assert.equal(supportsServerFallback("claude-fable-5-1"), true);

  const { sent, restore } = scriptFetch([text("ok")]);
  try {
    await (await provider()).generate(request({ model: "claude-sonnet-4-5" }));
    await (await provider({ ANTHROPIC_REFUSAL_FALLBACK: "off" })).generate(request());
  } finally {
    restore();
  }
  for (const call of sent) {
    assert.equal("fallbacks" in call.body, false);
    assert.equal("anthropic-beta" in call.headers, false);
  }
});

/* ------------------------------ tool history ------------------------------ */

const toolHistory: AIMessage[] = [
  { role: "user", content: "read the file" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "toolu_1", name: "project_read", arguments: { path: "a.ts" } }],
    providerBlocks: {
      provider: "anthropic",
      blocks: [
        { type: "thinking", thinking: "", signature: "sig-abc" },
        { type: "tool_use", id: "toolu_1", name: "project_read", input: { path: "a.ts" } },
      ],
    },
  },
  { role: "tool", content: "export const a = 1;", toolCallId: "toolu_1", toolName: "project_read" },
];

test("with tools offered, our own tool turn is replayed verbatim — thinking included", async () => {
  const { sent, restore } = scriptFetch([text("done")]);
  try {
    await (await provider()).generate(
      request({
        messages: toolHistory,
        tools: [{ name: "project_read", description: "read", parameters: { type: "object" } }],
      }),
    );
  } finally {
    restore();
  }
  const messages = sent[0].body.messages as Array<{ role: string; content: unknown }>;
  assert.deepEqual(messages[1].content, toolHistory[1].providerBlocks!.blocks);
  const result = (messages[2].content as Array<Record<string, unknown>>)[0];
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "toolu_1");
});

test("with tools withheld, the tool exchange is replayed as text, not as tool blocks", async () => {
  // The router's closing round withholds tools. Tool blocks in a request
  // that defines no tools are a 400 — the finished work would be lost.
  const { sent, restore } = scriptFetch([text("summary")]);
  try {
    await (await provider()).generate(request({ messages: toolHistory }));
  } finally {
    restore();
  }
  const body = JSON.stringify(sent[0].body.messages);
  assert.equal(body.includes('"tool_use"'), false);
  assert.equal(body.includes('"tool_result"'), false);
  assert.match(body, /Called project_read/);
  assert.match(body, /Result of project_read/);
  assert.match(body, /export const a = 1;/);
});

/* ------------------------------ reading replies ------------------------------ */

test("every text block is read, not only the first", async () => {
  const { restore } = scriptFetch([
    { json: { stop_reason: "end_turn", content: [{ type: "text", text: "one " }, { type: "text", text: "two" }] } },
  ]);
  try {
    const reply = await (await provider()).generate(request());
    assert.equal(reply.text, "one two");
  } finally {
    restore();
  }
});

test("a tool-call reply carries its raw blocks for the next round", async () => {
  const content = [
    { type: "thinking", thinking: "", signature: "s" },
    { type: "tool_use", id: "t1", name: "x", input: {} },
  ];
  const { restore } = scriptFetch([{ json: { stop_reason: "tool_use", content } }]);
  try {
    const reply = await (await provider()).generate(
      request({ tools: [{ name: "x", description: "x", parameters: { type: "object" } }] }),
    );
    assert.equal(reply.toolCalls?.length, 1);
    assert.deepEqual(reply.providerBlocks, { provider: "anthropic", blocks: content });
  } finally {
    restore();
  }
});

test("a refusal is returned as LÉLU's answer, never thrown to the next provider", async () => {
  const { restore } = scriptFetch([
    { json: { stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] } },
  ]);
  try {
    const reply = await (await provider()).generate(request());
    assert.equal(reply.stopReason, "refusal");
    assert.ok(reply.text.length > 0);
    assert.deepEqual(reply.metadata?.refusal, { category: "cyber" });
  } finally {
    restore();
  }
});

test("a tool call cut off by max_tokens is dropped, not executed", async () => {
  const { restore } = scriptFetch([
    {
      json: {
        stop_reason: "max_tokens",
        content: [
          { type: "tool_use", id: "t1", name: "project_read", input: { path: "a" } },
          { type: "tool_use", id: "t2", name: "project_write", input: { path: "b" } },
        ],
      },
    },
  ]);
  try {
    const reply = await (await provider()).generate(
      request({ tools: [{ name: "project_read", description: "r", parameters: { type: "object" } }] }),
    );
    assert.deepEqual(reply.toolCalls?.map((call) => call.id), ["t1"]);
    assert.equal(reply.metadata?.truncatedToolCall, "project_write");
    assert.equal(JSON.stringify(reply.providerBlocks).includes("t2"), false);
  } finally {
    restore();
  }
});

test("blocks before a mid-output fallback are trimmed to text when replayed", () => {
  const kept = replayableBlocks([
    { type: "thinking", thinking: "" },
    { type: "text", text: "partial" },
    { type: "tool_use", id: "old" },
    { type: "fallback", from: { model: "a" }, to: { model: "b" } },
    { type: "tool_use", id: "new" },
  ]);
  assert.deepEqual(kept.map((block) => block.type), ["text", "tool_use"]);
  assert.equal(kept[1].id, "new");
});

/* ------------------------------ retries ------------------------------ */

test("an overload is retried on the same provider before the chain moves on", async () => {
  const { sent, restore } = scriptFetch([
    { status: 529, json: { error: { message: "Overloaded" } }, headers: { "retry-after": "0" } },
    text("recovered"),
  ]);
  try {
    const reply = await (await provider()).generate(request());
    assert.equal(reply.text, "recovered");
    assert.equal(sent.length, 2);
  } finally {
    restore();
  }
});

test("a malformed request is not retried — it would fail the same way", async () => {
  const { sent, restore } = scriptFetch([{ status: 400, json: { error: { message: "bad" } } }]);
  try {
    await assert.rejects((await provider()).generate(request()), /Anthropic failed 400: bad/);
    assert.equal(sent.length, 1);
  } finally {
    restore();
  }
});

test("retry delays honour retry-after and stay bounded", () => {
  assert.equal(retryDelayMs(1, "2"), 2000);
  assert.equal(retryDelayMs(1, "3600"), 8000);
  assert.equal(retryDelayMs(1, null), 500);
  assert.equal(retryDelayMs(2, null), 1000);
});

/* ------------------------------ streaming ------------------------------ */

const sse = (event: Record<string, unknown>) => JSON.stringify(event);

test("a stream reports its stop reason and the model that served it", async () => {
  const { restore } = scriptFetch([
    {
      sse: [
        sse({ type: "message_start", message: { model: "claude-opus-5-5", usage: { input_tokens: 5 } } }),
        sse({ type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } }),
        sse({ type: "content_block_delta", delta: { type: "text_delta", text: " there" } }),
        sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }),
      ],
    },
  ]);
  const deltas: string[] = [];
  try {
    const reply = await (await provider()).generate(request({ onDelta: (t) => deltas.push(t) }));
    assert.equal(reply.text, "Hi there");
    assert.equal(reply.stopReason, "end_turn");
    assert.equal(reply.metadata?.finishReason, "end_turn");
    assert.deepEqual(reply.metadata?.usage, { input_tokens: 5, output_tokens: 2 });
    assert.deepEqual(deltas, ["Hi", "Hi there"]);
  } finally {
    restore();
  }
});

test("an error event mid-stream fails the turn instead of passing off partial text", async () => {
  const { restore } = scriptFetch([
    {
      sse: [
        sse({ type: "content_block_delta", delta: { type: "text_delta", text: "Half an ans" } }),
        sse({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
      ],
    },
  ]);
  try {
    await assert.rejects(
      (await provider()).generate(request({ onDelta: () => {} })),
      /overloaded_error/,
    );
  } finally {
    restore();
  }
});

test("a streamed refusal discards the partial and is not thrown", async () => {
  const { restore } = scriptFetch([
    {
      sse: [
        sse({ type: "content_block_delta", delta: { type: "text_delta", text: "Sure, step one" } }),
        sse({ type: "message_delta", delta: { stop_reason: "refusal" } }),
      ],
    },
  ]);
  const deltas: string[] = [];
  try {
    const reply = await (await provider()).generate(request({ onDelta: (t) => deltas.push(t) }));
    assert.equal(reply.stopReason, "refusal");
    assert.equal(reply.text.includes("step one"), false);
    assert.equal(deltas[deltas.length - 1], reply.text, "the partial was left on screen");
  } finally {
    restore();
  }
});

/* ------------------------------ broker ------------------------------ */

async function brokerCall(
  api: ReturnType<typeof createModelApi>,
  headers: Record<string, string> = {},
  onClose?: (fire: () => void) => void,
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  let handler: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  api.attach({ use: (_path, fn) => (handler = fn as never) });
  const response = { status: 200, headers: {} as Record<string, string>, body: "" };
  await new Promise<void>((resolve) => {
    const res = {
      set statusCode(value: number) { response.status = value; },
      get statusCode() { return response.status; },
      setHeader: (name: string, value: string) => { response.headers[name.toLowerCase()] = value; },
      end: (body?: string) => { response.body = body ?? ""; resolve(); },
      on: (_event: string, fn: () => void) => onClose?.(() => { fn(); resolve(); }),
      writableFinished: false,
    };
    const req = {
      method: "POST",
      url: "/anthropic/messages",
      headers,
      on: (event: string, fn: (chunk?: unknown) => void) => {
        if (event === "data") fn(Buffer.from("{}"));
        if (event === "end") fn();
      },
    };
    handler!(req, res, () => resolve());
  });
  return response;
}

test("the broker passes a valid anthropic-beta header and drops a malformed one", async () => {
  const { sent, restore } = scriptFetch([text("ok")]);
  try {
    const api = createModelApi((name) => (name === "ANTHROPIC_API_KEY" ? "sk-server" : undefined));
    await brokerCall(api, { "anthropic-beta": SERVER_FALLBACK_BETA, "x-api-key": "sk-page" });
    await brokerCall(api, { "anthropic-beta": "x\r\nx-api-key: sk-page" });
  } finally {
    restore();
  }
  assert.equal(sent[0].headers["anthropic-beta"], SERVER_FALLBACK_BETA);
  assert.equal(sent[0].headers["x-api-key"], "sk-server");
  assert.equal("anthropic-beta" in sent[1].headers, false, "a malformed beta value was forwarded");
});

test("the broker rate-limits a client and says when to come back", async () => {
  const { restore } = scriptFetch([text("ok")]);
  try {
    const api = createModelApi((name) =>
      name === "ANTHROPIC_API_KEY" ? "sk-server" : name === "LELU_BROKER_RATE_PER_MIN" ? "1" : undefined,
    );
    assert.equal((await brokerCall(api)).status, 200);
    const limited = await brokerCall(api);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) >= 1);
  } finally {
    restore();
  }
});

test("the rate limiter window resets after a minute", () => {
  let now = 0;
  const limiter = createRateLimiter(2, () => now);
  assert.equal(limiter.take("a"), 0);
  assert.equal(limiter.take("a"), 0);
  assert.ok(limiter.take("a") > 0);
  assert.equal(limiter.take("b"), 0, "one client's budget is not another's");
  now = 60_000;
  assert.equal(limiter.take("a"), 0);
  assert.equal(createRateLimiter(0).take("a"), 0, "0 disables the limit");
});

test("a client that disconnects aborts the upstream request", async () => {
  const realFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = ((_input: unknown, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    })) as typeof fetch;
  try {
    const api = createModelApi(() => "sk-server");
    await brokerCall(api, {}, (fire) => setTimeout(fire, 10));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(aborted, true, "the upstream kept running for a client that had gone");
  } finally {
    globalThis.fetch = realFetch;
  }
});
