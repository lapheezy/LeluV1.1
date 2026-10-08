/**
 * ==========================================================
 * LÉLU — KNOWLEDGE INGESTION
 *
 * CATEGORY: unit. The real pipeline with a stand-in analyst,
 * so extraction behaviour is tested without spending a model
 * call — and so the analyst can be made to misbehave.
 *
 * Why this exists: §7 wants LÉLU to accept "read this" and
 * actually process it; §8 is emphatic that reading is not
 * storing, and names the failure directly — an 8,000-message
 * conversation must not become 8,000 memories. That is the
 * bound that killed the OG build, so it is the bound with a
 * test.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  detectSource,
  extractionPrompt,
  ingest,
  toCandidates,
  windowSource,
} from "../src/core/memory/IngestionPipeline";

test("source detection distinguishes the shapes that need different retrieval", () => {
  assert.equal(detectSource("https://youtu.be/abc123").kind, "youtube");
  assert.equal(detectSource("look at https://www.youtube.com/watch?v=x").kind, "youtube");
  assert.equal(detectSource("https://chatgpt.com/share/abc").kind, "chatgpt-share");
  assert.equal(detectSource("read https://example.com/post").kind, "url");
  assert.equal(detectSource("remember that I prefer short answers").kind, "note");
  assert.equal(detectSource("   ").kind, "unknown");
});

test("a pasted multi-turn conversation is recognised as one", () => {
  const pasted = [
    "User: what did we decide about the schema?",
    "Assistant: to keep memories in one table",
    "User: and the index?",
    "Assistant: on created_at",
    "User: good",
  ].join("\n");

  assert.equal(detectSource(pasted).kind, "conversation");
});

test("attribution is carried so LÉLU can say how she knows something", () => {
  const source = detectSource("https://example.com/article");
  assert.ok(source.attribution.includes("example.com"));

  const candidates = toCandidates("The project ships on Friday.", source);
  assert.equal(candidates[0].attribution, source.attribution);
  assert.equal(candidates[0].metadata?.sourceUrl, "https://example.com/article");
});

test("windowing keeps the end of a source, not just the beginning", () => {
  const body = `${"START ".repeat(3_000)}CONCLUSION: we chose Postgres.`;
  const { text, truncated } = windowSource(body, 2_000);

  assert.equal(truncated, true);
  assert.ok(text.includes("CONCLUSION"), "decisions live at the end and must survive truncation");
  assert.ok(text.includes("START"), "the opening should survive too");
  assert.ok(text.length < body.length);
});

test("an 8,000-message conversation does not become 8,000 memories", async () => {
  // The failure mode from the OG build, reproduced at scale.
  const huge = Array.from(
    { length: 8_000 },
    (_, i) => `User: message ${i}\nAssistant: reply ${i}`,
  ).join("\n");

  // An analyst that misbehaves in the worst plausible way: it returns a line
  // for every message it saw, ignoring the instruction to summarise.
  const floodingAnalyst = async () =>
    Array.from({ length: 8_000 }, (_, i) => `Fact number ${i} that was mentioned.`).join("\n");

  const result = await ingest(huge, floodingAnalyst);

  assert.ok(result.stats.sourceChars > 100_000, "the source really is enormous");
  assert.ok(result.stats.truncated, "it must have been windowed before analysis");
  assert.ok(
    result.stats.analysedChars <= 13_000,
    `the model must not be shown the whole thing (saw ${result.stats.analysedChars})`,
  );
  assert.ok(
    result.candidates.length <= 12,
    `expected a bounded set of memories, got ${result.candidates.length}`,
  );
  assert.ok(result.candidates.length > 0, "but it should still learn something");
});

test("repeated facts in one extraction collapse to a single candidate", () => {
  const source = detectSource("a note");
  const repeated = [
    "The deadline is Friday.",
    "the deadline is friday",
    "- The deadline is Friday.",
    "The index goes on created_at.",
  ].join("\n");

  const candidates = toCandidates(repeated, source);

  assert.equal(candidates.length, 2, "the same fact three ways is still one fact");
});

test("an analyst finding nothing yields no memories", () => {
  const candidates = toCandidates("NOTHING", detectSource("a note"));
  assert.deepEqual(candidates, []);
});

test("list punctuation is stripped from extracted facts", () => {
  const candidates = toCandidates("1. The build runs on bun.\n- Tests run on node.", detectSource("a note"));
  assert.equal(candidates[0].response, "The build runs on bun.");
  assert.equal(candidates[1].response, "Tests run on node.");
});

test("the extraction instruction names what is durable and what is not", () => {
  const prompt = extractionPrompt(detectSource("a note"), "body");
  assert.ok(/decisions/i.test(prompt));
  assert.ok(/discard/i.test(prompt), "it must say what to throw away, not only what to keep");
  assert.ok(/at most 12/i.test(prompt), "the cap must reach the model too, not only the parser");
});

test("an analyst that throws is reported, not propagated", async () => {
  const result = await ingest("remember this note", async () => {
    throw new Error("provider unavailable");
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.error, "provider unavailable");
  assert.equal(result.stats.retrieved, true, "retrieval did succeed; analysis is what failed");
});

test("an empty source is refused with a reason", async () => {
  const result = await ingest("   ", async () => "anything");
  assert.equal(result.candidates.length, 0);
  assert.ok(result.error);
});
