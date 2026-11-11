/**
 * LÉLU — REQUEST BUDGET ENFORCEMENT
 *
 * The ceiling is the difference between a request that is measured and a
 * request that is made to fit. These check the order it gives things up in,
 * and the things it must never give up.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  fitRequestBudget,
  requestCeiling,
  type RequestBudget,
} from "../src/core/router/RequestBudget";

const tool = (name: string, bytes: number) => ({
  name,
  description: `${name} ${"d".repeat(bytes)}`,
  parameters: { type: "object", properties: { path: { type: "string" } } },
});

const manyTools = Array.from({ length: 20 }, (_, index) => tool(`tool_${index}`, 900));

test("a request already under the ceiling is returned untouched", () => {
  const messages = [{ role: "user", content: "hello" }];
  const tools = [tool("a", 10)];
  const fit = fitRequestBudget({
    messages,
    prompt: "hello",
    tools,
    tier: "FULL",
    provider: "Groq",
    model: "llama-3.3-70b-versatile",
    limitBytes: 100_000,
  });
  assert.equal(fit.changed, false);
  assert.equal(fit.tools.length, 1);
  assert.deepEqual(fit.messages, messages);
  assert.equal(fit.budget.totalBytes <= 100_000, true);
});

test("tool schemas are given up first, from the end, and the tier says so", () => {
  const fit = fitRequestBudget({
    messages: [{ role: "system", content: "you are LELU" }],
    prompt: "draw a chart",
    tools: manyTools,
    tier: "FULL",
    provider: "Groq",
    model: "llama-3.3-70b-versatile",
    limitBytes: 12_000,
  });
  assert.equal(fit.changed, true);
  assert.ok(fit.droppedTools > 0, "some schemas must be withheld");
  assert.ok(fit.tools.length < manyTools.length);
  assert.equal(fit.tier, fit.tools.length === 0 ? "NONE" : "REDUCED");
  assert.ok(fit.budget.totalBytes <= 12_000);
  // The schemas kept are the ones the caller put first: relevance order holds.
  assert.equal(fit.tools[0]?.name, "tool_0");
});

test("the prompt and the most recent messages survive every trim", () => {
  const messages = [
    { role: "system", content: "system instructions" },
    ...Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index} ${"h".repeat(600)}`,
    })),
    { role: "user", content: "THE REAL QUESTION" },
  ];
  const fit = fitRequestBudget({
    messages,
    prompt: "THE REAL QUESTION",
    tools: manyTools,
    tier: "FULL",
    provider: "Groq",
    limitBytes: 6_000,
    protectedTail: 4,
  });
  assert.ok(fit.droppedMessages > 0 || fit.trimmedMessages > 0, "history must be reduced");
  assert.equal(fit.messages.at(-1)?.content, "THE REAL QUESTION");
  assert.equal(
    fit.messages.some((message) => message.role === "system"),
    true,
    "system instructions are never dropped",
  );
  assert.ok(fit.budget.totalBytes <= 6_000);
});

test("a tool result is never left without the assistant turn that asked for it", () => {
  const messages = [
    { role: "system", content: "s" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "1", name: "tool_0", arguments: {} }],
    },
    { role: "tool", content: "r".repeat(40_000), toolCallId: "1", toolName: "tool_0" },
    { role: "user", content: "and now?" },
  ];
  const fit = fitRequestBudget({
    messages,
    prompt: "and now?",
    tools: [],
    tier: "NONE",
    provider: "Groq",
    limitBytes: 5_000,
    protectedTail: 2,
  });
  const orphan = fit.messages.some(
    (message, index) => message.role === "tool" && fit.messages[index - 1]?.role !== "assistant",
  );
  assert.equal(orphan, false, "an orphaned tool message is rejected by providers");
});

test("the ceiling prefers the provider transport limit over a large context window", () => {
  const ceiling = requestCeiling({
    provider: "Groq",
    model: "llama-3.3-70b-versatile",
  });
  assert.equal(ceiling.source, "provider");
  // Measured live, twice: `413 … (TPM): Limit 8000, Requested 10184`, and then
  // `429 … TPM: Limit 8000, Used 2454, Requested 7846 … tools≈7868tok` for a
  // 35,246-byte turn — the tool schemas alone were the entire minute, because
  // JSON tokenises at ~3.2 bytes/token rather than the 4 assumed for prose.
  // The ceiling therefore has to leave room for prompt, system and history.
  assert.equal(ceiling.bytes, 12_000, "tools must not consume the whole per-minute budget");
  assert.ok(
    ceiling.bytes / 4 <= 8_000,
    "the ceiling may never exceed the account's measured per-minute limit",
  );
});

test("a known model without a provider transport limit uses its context window", () => {
  const ceiling = requestCeiling({ provider: "OpenRouter", model: "anthropic/claude-3.5-sonnet" });
  assert.equal(ceiling.source, "model");
  assert.ok(ceiling.bytes > 400_000, `expected a large window, got ${ceiling.bytes}`);
});

test("an unknown model says so instead of inventing a window", () => {
  const ceiling = requestCeiling({ provider: "Custom", model: "mystery-1" });
  assert.equal(ceiling.source, "default");
  assert.equal(ceiling.detail, "no provider or model ceiling known");
});

test("an operator override wins, because it is the only exact number", () => {
  const ceiling = requestCeiling({ provider: "Groq", model: "llama-3.3-70b-versatile", limitBytes: 9_000 });
  assert.equal(ceiling.source, "configured");
  assert.equal(ceiling.bytes, 9_000);
});

test("the fitted budget is the byte count that will actually be sent", () => {
  const fit = fitRequestBudget({
    messages: [
      { role: "system", content: "s".repeat(2_000) },
      { role: "user", content: "x".repeat(5_000) },
    ],
    prompt: "question",
    tools: [],
    tier: "NONE",
    provider: "Groq",
    limitBytes: 100_000,
  });
  assert.equal(fit.changed, false, "nothing to trim at this ceiling");
  const bytes = (value: unknown) => new TextEncoder().encode(String(value)).length;
  const expected =
    fit.messages.reduce((sum: number, message: { content?: unknown }) => sum + bytes(message.content), 0) +
    bytes("question") +
    bytes("system") +
    bytes("user");
  const measured: RequestBudget = fit.budget;
  assert.equal(measured.totalBytes, expected);
});

test("nothing is dropped when there is nothing left to drop, and it says so", () => {
  const fit = fitRequestBudget({
    messages: [{ role: "system", content: "s" }],
    prompt: "p".repeat(20_000),
    tools: [],
    tier: "NONE",
    provider: "Groq",
    limitBytes: 5_000,
    protectedTail: 2,
  });
  assert.ok(fit.notes.some((note) => /prompt itself is larger/.test(note)));
  assert.equal(fit.droppedMessages, 0);
});
