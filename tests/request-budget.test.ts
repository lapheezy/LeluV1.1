/**
 * LÉLU — REQUEST BUDGET: bytes are bytes, and nothing else is called a token.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { describeRequestBudget } from "../src/core/router/RequestBudget";

const envTools = ["environment_compose","environment_present_artifact","environment_mutate_surface","environment_manage_workspace","environment_save_state","environment_restore_state"]
  .map((name) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: {} } }));

test("an environment turn is measured with all six environment tools at FULL", () => {
  const budget = describeRequestBudget({
    messages: [{ role: "system", content: "x".repeat(400) }, { role: "user", content: "hi" }],
    prompt: "create an environment",
    tools: envTools,
    tier: "FULL",
    provider: "Groq",
  });
  assert.equal(budget.toolCount, 6);
  assert.equal(budget.toolNames.length, 6);
  assert.equal(budget.tier, "FULL");
  assert.ok(budget.systemBytes > 0 && budget.historyBytes > 0 && budget.promptBytes > 0);
  assert.equal(budget.totalBytes, budget.systemBytes + budget.historyBytes + budget.promptBytes + budget.toolSchemaBytes);
  assert.equal(budget.estimation, "bytes/4", "an estimate must say what it estimates");
  assert.equal(budget.estimatedTokens, Math.ceil(budget.totalBytes / 4));
});

test("the NONE tier carries no schemas and says so", () => {
  const budget = describeRequestBudget({ prompt: "hi", tools: [], tier: "NONE" });
  assert.equal(budget.toolCount, 0);
  assert.equal(budget.toolSchemaBytes, 0);
  assert.equal(budget.tier, "NONE");
});

test("byte counts stay byte counts for non-ASCII", () => {
  const text = "\u00e9";
  const budget = describeRequestBudget({ prompt: text, tools: [] });
  const expected = new TextEncoder().encode(text).length;
  assert.equal(expected, 2, "U+00E9 is two UTF-8 bytes");
  assert.equal(budget.promptBytes, expected, "bytes, not characters");
  assert.equal(budget.promptBytes > text.length, true, "a byte count exceeds the character count here");
  assert.equal(budget.totalBytes, expected);
});

test("an empty tool list costs no schema bytes", () => {
  const budget = describeRequestBudget({ prompt: "hi", tools: [] });
  assert.equal(budget.toolSchemaBytes, 0);
});

test("no message content is copied into the budget", () => {
  const secretish = "my private diary entry";
  const budget = describeRequestBudget({ messages: [{ role: "user", content: secretish }], tools: [] });
  assert.ok(!JSON.stringify(budget).includes(secretish), "the budget must not carry user content");
});
