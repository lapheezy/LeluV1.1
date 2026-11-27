/**
 * ==========================================================
 * LÉLU — PROVIDER FAULTS, ONE ROUND AT A TIME
 *
 * CATEGORY: unit, over the REAL stream reader the providers use, fed
 * synthetic responses. Every case here is a failure the free providers
 * actually produce (Mission 44.5/44.6 traces): a 429 on a spent daily
 * allowance, a 500 mid-turn, a connection that drops while text is arriving,
 * a round the output budget cut off, and a tool call whose arguments are not
 * valid JSON.
 *
 * What must hold in every case: the reader reports the failure with the
 * provider's own words, bounded (it never retries on its own), and it never
 * carries a half-assembled TOOL CALL — a truncated call must never be
 * executed. Text already shown to the user is carried so it can be kept.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  EmptyCompletionError,
  readOpenAIStream,
  streamedCompletionAnswer,
} from "../src/providers/openaiTools";

function sse(chunks: string[], breakAfter?: Error): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      // A real connection drops AFTER the bytes it already sent have been
      // delivered: erroring synchronously here would discard the queue and
      // test something the network never does.
      if (breakAfter) setTimeout(() => controller.error(breakAfter), 5);
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const delta = (payload: Record<string, unknown>) => `data: ${JSON.stringify(payload)}\n\n`;

test("HTTP 429 is reported with the provider's own reason, and not retried here", async () => {
  const response = new Response(
    JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day" } }),
    { status: 429 },
  );
  await assert.rejects(
    () => readOpenAIStream(response, "OpenRouter", () => {}),
    (error: Error) => {
      assert.match(error.message, /OpenRouter HTTP 429/);
      assert.match(error.message, /free-models-per-day/, "the provider's reason survives");
      return true;
    },
  );
});

test("HTTP 500 mid-turn is reported, never silently empty", async () => {
  const response = new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 500 });
  await assert.rejects(
    () => readOpenAIStream(response, "Groq", () => {}),
    /Groq HTTP 500: upstream unavailable/,
  );
});

test("a connection that drops mid-answer carries the text already shown, and no tool call", async () => {
  const response = sse(
    [
      delta({ choices: [{ delta: { content: "The branch is " } }] }),
      delta({ choices: [{ delta: { content: "mission/44-6" } }] }),
    ],
    new Error("connection reset by peer"),
  );
  const shown: string[] = [];
  await assert.rejects(
    () => readOpenAIStream(response, "OpenRouter", (text) => shown.push(text)),
    (error: Error & { partialText?: string; partialToolCalls?: unknown }) => {
      assert.match(error.message, /OpenRouter stream interrupted: connection reset by peer/);
      assert.equal(error.partialText, "The branch is mission/44-6", "the words the user already read are kept");
      assert.equal(error.partialToolCalls, undefined, "a half-assembled call is never carried");
      return true;
    },
  );
  assert.deepEqual(shown, ["The branch is ", "The branch is mission/44-6"], "deltas reached the caller in order");
});

test("a stream that breaks before any text has nothing to keep", async () => {
  const response = sse([delta({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lab_repo" } }] } }] })], new Error("socket hang up"));
  await assert.rejects(
    () => readOpenAIStream(response, "Groq", () => {}),
    (error: Error & { partialText?: string; partialToolCalls?: unknown }) => {
      assert.equal(error.partialText, undefined);
      assert.equal(error.partialToolCalls, undefined, "a partial name is not a call");
      return true;
    },
  );
});

test("a user Stop is an abort, not a provider fault", async () => {
  const abort = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
  const response = sse([delta({ choices: [{ delta: { content: "partial" } }] })], abort);
  await assert.rejects(
    () => readOpenAIStream(response, "Groq", () => {}),
    (error: Error) => {
      assert.equal(error.name, "AbortError", "the resolver recognises a stop by this name");
      return true;
    },
  );
});

test("a round cut off by its output budget is retryable, and is not answered with its own thinking", async () => {
  const response = sse([
    delta({ choices: [{ delta: { reasoning: "Let me think about the branch".repeat(3) } }] }),
    delta({ choices: [{ delta: {}, finish_reason: "length" }] }),
    "data: [DONE]\n\n",
  ]);
  const reply = await readOpenAIStream(response, "Groq", () => {});
  assert.equal(reply.text, "");
  assert.ok((reply.reasoning ?? "").length > 0);
  assert.throws(
    () => streamedCompletionAnswer("Groq", reply),
    (error: unknown) => {
      assert.ok(error instanceof EmptyCompletionError);
      assert.equal(error.truncated, true, "truncation is the one empty answer a bigger budget fixes");
      return true;
    },
  );
});

test("reasoning alone is the answer only when the round ended normally", async () => {
  const response = sse([
    delta({ choices: [{ delta: { reasoning: "The branch is mission/44-6." } }] }),
    delta({ choices: [{ delta: {}, finish_reason: "stop" }] }),
  ]);
  const reply = await readOpenAIStream(response, "OpenRouter", () => {});
  const answer = streamedCompletionAnswer("OpenRouter", reply);
  assert.deepEqual(answer, { text: "The branch is mission/44-6.", fromReasoning: true });
});

test("tool arguments are assembled across fragments, and invalid JSON becomes an empty call", async () => {
  const good = sse([
    delta({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "lab_repository", arguments: '{"path":' } }] } }] }),
    delta({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"."}' } }] } }] }),
    delta({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
  ]);
  const assembled = await readOpenAIStream(good, "Groq", () => {});
  assert.equal(assembled.toolCalls.length, 1);
  assert.equal(assembled.toolCalls[0].name, "lab_repository");
  assert.deepEqual(assembled.toolCalls[0].arguments, { path: "." });

  const bad = sse([
    delta({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_b", function: { name: "lab_experiment", arguments: '{"id": ' } }] } }] }),
    delta({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
  ]);
  const malformed = await readOpenAIStream(bad, "Groq", () => {});
  assert.equal(malformed.toolCalls.length, 1, "the call is still reported…");
  assert.deepEqual(malformed.toolCalls[0].arguments, {}, "…with no arguments, so the tool reports a real failure");
});
