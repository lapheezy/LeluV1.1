/**
 * LÉLU — REQUEST INTEGRITY
 *
 * Mission 10.1 watched a repository request arrive at the model with its
 * subject removed. These tests hold the two properties that caused it:
 *
 *   1. The subject of a prompt survives every shortening step.
 *   2. When something genuinely has to be left out, the caller is told what.
 *
 * Each case records the five artefacts the mission asks for:
 *   originalUserInput → assembledRequest → fittedRequest → providerPayload
 *   → semanticPreservationResult
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isInstruction, protectedSpans, querySubject } from "../src/core/router/RequestQuery";
import { fitRequestBudget } from "../src/core/router/RequestBudget";
import { inspectRequest, semanticTerms } from "../src/core/observability/RequestIntegrity";

const capture = (input: string, options: { maxChars?: number; ceilingBytes?: number } = {}) => {
  const subject = querySubject(input, options);
  const fitted = fitRequestBudget({
    messages: [
      { role: "system", content: "You are LÉLU." },
      { role: "user", content: input },
    ],
    prompt: input,
    tools: [],
    tier: "FULL",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
    ...(options.ceilingBytes ? { limitBytes: options.ceilingBytes } : {}),
  });
  const payload = JSON.stringify({ messages: fitted.messages, prompt: input });
  return {
    originalUserInput: input,
    assembledRequest: { promptBytes: fitted.budget.promptBytes, totalBytes: fitted.budget.totalBytes },
    fittedRequest: { changed: fitted.changed, notes: fitted.notes },
    providerPayload: { text: payload, hasPrompt: payload.includes(input) },
    semanticPreservationResult: inspectRequest({ originalUserInput: input, fitted, payloadText: payload }),
    subject,
  };
};

// The exact prompt Mission 10.1 watched get destroyed.
const RESEARCH =
  "Find a maintained open-source library that could improve LÉLU’s typo-tolerant search. Compare relevant candidates, inspect their licenses, and recommend the best fit.";

test("the prompt that lost its subject keeps it", () => {
  const out = capture(RESEARCH, { maxChars: 120 });
  const query = out.subject.query;
  assert.match(query, /typo-tolerant search/i, "the subject survives");
  assert.match(query, /open-source|library|maintained/i, "the kind of thing asked for survives");
  assert.ok(!/…$/.test(query) || out.subject.omittedTail.length > 0, "a shortened query says what it dropped");
  assert.notEqual(query.at(-1), "c", "never cut mid-word");
  assert.equal(out.providerPayload.hasPrompt, true, "the provider payload still carries the prompt verbatim");
  assert.equal(out.semanticPreservationResult.semanticPreservation.ok, true);
});

test("a short question loses only its scaffolding, and says so", () => {
  const out = querySubject("Can you please tell me about typo tolerant search?");
  assert.match(out.query, /typo tolerant search/i);
  assert.ok(out.removedPrefix.length > 0, "what was lifted is reported");
  assert.ok(out.query.length > 0);
});

test("a long prompt keeps the whole request when it fits", () => {
  const long = `${"Context sentence about the ecosystem. ".repeat(20)}Acquire typesense/typesense.`;
  const out = capture(long, { ceilingBytes: 96_000 });
  assert.equal(out.fittedRequest.changed, false, "nothing is dropped below the ceiling");
  assert.equal(out.providerPayload.hasPrompt, true);
  assert.match(out.providerPayload.text, /typesense\/typesense/);
});

test("a multi-paragraph prompt keeps every paragraph when it fits", () => {
  const paragraphs = [
    "I need a search capability.",
    "Constraints: keep the licence permissive; do not modify canonical code.",
    "Inspect https://github.com/typesense/typesense before recommending it.",
  ].join("\n\n");
  const out = capture(paragraphs, { ceilingBytes: 96_000 });
  assert.equal(out.fittedRequest.changed, false);
  for (const paragraph of paragraphs.split("\n\n")) {
    assert.ok(out.providerPayload.text.includes(paragraph), `paragraph survived: ${paragraph.slice(0, 24)}`);
  }
});

test("every URL and repository name is protected, including under a short ceiling", () => {
  const input =
    "Compare https://github.com/typesense/typesense with github.com/quickwit-oss/tantivy and sindresorhus/quick-lru, then acquire the best one.";
  const spans = protectedSpans(input);
  assert.ok(spans.some((span) => span.includes("typesense/typesense")));
  const out = querySubject(input, { maxChars: 60 });
  for (const span of spans) {
    if (span.length > 60) continue; // cannot fit what is longer than the ceiling
    assert.ok(out.query.includes(span) || out.omittedTail.join(" ").includes(span), `span accounted for: ${span}`);
  }
  assert.ok(out.omittedTail.length > 0, "omissions are listed, not silent");
});

test("an approval instruction is treated as work, not as a search phrase", () => {
  const input =
    "Acquire the recommended capability. Do not commit without my approval, and tell me what tests passed.";
  assert.equal(isInstruction(input), true);
  const out = querySubject(input);
  assert.equal(out.method, "verbatim");
  assert.match(out.query, /Do not commit without my approval/);
  assert.match(out.query, /tests passed/);
});

test("technical identifiers and code tokens survive", () => {
  const input = "Investigate `repo.research` and RequestBudget.fitRequestBudget before acquire_probe.";
  const terms = semanticTerms(input);
  assert.ok(terms.includes("repo.research"));
  assert.ok(terms.includes("RequestBudget.fitRequestBudget"));
  const out = querySubject(input);
  for (const term of terms) assert.ok(out.query.includes(term), `kept: ${term}`);
});

test("a very long history is reduced without touching the prompt", () => {
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `older message ${index} ${"h".repeat(400)}`,
  }));
  const fitted = fitRequestBudget({
    messages: [{ role: "system", content: "sys" }, ...history, { role: "user", content: "THE CURRENT REQUEST" }],
    prompt: "THE CURRENT REQUEST",
    tools: [],
    tier: "FULL",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    limitBytes: 8_000,
    protectedTail: 4,
  });
  const record = inspectRequest({
    originalUserInput: "THE CURRENT REQUEST",
    fitted,
    payloadText: JSON.stringify(fitted.messages),
  });
  assert.ok(record.fittedRequest.droppedMessages > 0 || record.fittedRequest.trimmedMessages > 0);
  assert.equal(fitted.messages.at(-1)?.content, "THE CURRENT REQUEST");
  assert.equal(record.providerPayload.promptPresent, true);
  assert.equal(record.semanticPreservation.ok, true);
});

test("large tool schemas are given up before the prompt ever is", () => {
  const tools = Array.from({ length: 30 }, (_, index) => ({
    name: `tool_${index}`,
    description: `d${"d".repeat(800)}`,
    parameters: { type: "object", properties: {} },
  }));
  const prompt = "Acquire typesense/typesense and report its commit.";
  const fitted = fitRequestBudget({
    messages: [{ role: "system", content: "sys" }, { role: "user", content: prompt }],
    prompt,
    tools,
    tier: "FULL",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    limitBytes: 10_000,
  });
  const record = inspectRequest({ originalUserInput: prompt, fitted, payloadText: JSON.stringify(fitted.messages) });
  assert.ok(record.fittedRequest.droppedTools > 0, "schemas were withheld");
  assert.equal(fitted.messages.at(-1)?.content, prompt, "the prompt is untouched");
  assert.equal(record.providerPayload.promptPresent, true);
});

test("the integrity record states a missing subject instead of hiding it", () => {
  const fitted = fitRequestBudget({
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "truncated text" }],
    prompt: "the full request naming typesense/typesense",
    tools: [],
    tier: "FULL",
    provider: "openrouter",
    model: "openai/gpt-4o-mini",
  });
  const record = inspectRequest({
    originalUserInput: "the full request naming typesense/typesense",
    fitted,
    payloadText: JSON.stringify(fitted.messages),
  });
  assert.equal(record.providerPayload.promptPresent, false);
  assert.equal(record.semanticPreservation.ok, false);
  assert.ok(record.semanticPreservation.missing.includes("typesense/typesense"));
});
