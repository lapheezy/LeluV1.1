import { test } from "node:test";
import assert from "node:assert/strict";
import { partialWorkReply, summarizeToolResult } from "../src/core/router/partialWork";

test("partial-work reply lists each step's real result without inference", () => {
  const text = partialWorkReply(
    [
      { tool: "sketch.draw", ok: true, summary: "Drew 14 strokes on the canvas" },
      { tool: "world.place", ok: false, summary: "No room for object" },
    ],
    "Groq",
    "Groq failed 429: tokens per day exhausted",
  );
  assert.match(text, /NOT complete/);
  assert.match(text, /1\. sketch\.draw — done: Drew 14 strokes/);
  assert.match(text, /2\. world\.place — failed: No room/);
  assert.match(text, /1 step\(s\) succeeded and are saved; 1 failed/);
  assert.match(text, /did not switch to any paid service/);
});

test("tool summaries are one line, bounded, and never echo credentials", () => {
  assert.equal(summarizeToolResult(undefined), undefined);
  assert.equal(summarizeToolResult("\n\nFetched page\nmore"), "Fetched page");
  assert.ok(!summarizeToolResult("used key gsk_ABCDEFGHIJKLMNOP1234")!.includes("ABCDEFGH"));
  assert.ok(summarizeToolResult("x".repeat(500))!.length <= 160);
});

test("deterministic operations are answered without invoking any model", async () => {
  const { default: TimeResolver } = await import("../src/core/router/TimeResolver");
  let modelCalls = 0;
  const context = {
    request: { prompt: "what time is it", messages: [] },
    started: Date.now(),
    logger: { info() {}, warn() {}, error() {} },
    aiProviders: new Proxy({}, { get: () => () => { modelCalls += 1; throw new Error("no model allowed"); } }),
  } as never;
  const result = await new TimeResolver().execute(context);
  assert.equal(result.handled, true);
  assert.match(result.response?.text ?? "", /Right now it's/);
  assert.equal(modelCalls, 0);
});
