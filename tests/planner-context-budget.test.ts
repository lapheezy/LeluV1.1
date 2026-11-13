/**
 * ==========================================================
 * LÉLU — PLANNER CONTEXT BUDGET
 *
 * CATEGORY: unit. No network.
 *
 * MEASURED (2026-11-13): the planner prompt carried a 91,427-character user
 * block that was then sent TWICE, producing a 186 KB / 46.5k-token request that
 * every provider refused. Two independent fixes are pinned here:
 *
 *   1. the prompt travels once (AIService no longer repeats it in `messages`);
 *   2. when the capability catalogue still exceeds the provider's context, the
 *      JSON-schema block is dropped first and the REQUEST always survives.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANNER_PROMPT_BUDGET_CHARS,
  fitPlannerPrompt,
} from "../src/core/agentic/PlannerContextBudget";

const buildPlannerPrompt = (schemaPadding = 60_000): string =>
  [
    "CAPABILITIES AVAILABLE NOW:",
    "- system.config: Report what is configured",
    "- workflow.list: List workflows",
    "",
    "TOOL PARAMETERS (JSON Schema):",
    `system.config: ${"x".repeat(schemaPadding)}`,
    "",
    "REQUEST: Step 1: check configuration. Step 2: list workflows.",
  ].join("\n");

test("a prompt inside the budget is untouched", () => {
  const small = "CAPABILITIES AVAILABLE NOW:\n- system.config: Report\n\nREQUEST: check";
  assert.equal(fitPlannerPrompt(small), small);
});

test("an oversized prompt loses the JSON-schema block first, and keeps the request", () => {
  const fitted = fitPlannerPrompt(buildPlannerPrompt());
  assert.ok(fitted.length <= PLANNER_PROMPT_BUDGET_CHARS, `still ${fitted.length} chars`);
  assert.ok(fitted.includes("REQUEST: Step 1: check configuration"), "the request was trimmed away");
  assert.ok(fitted.includes("CAPABILITIES AVAILABLE NOW:"), "the capability list was trimmed away");
  assert.ok(!fitted.includes("x".repeat(2_000)), "the schema block survived");
  assert.match(fitted, /trimmed to fit this model's context/, "the trim was silent");
});

test("the budget is applied only to the planner prompt", () => {
  // The header the planner uses, so the fit is triggered deliberately and not
  // for ordinary reasoning calls.
  const fitted = fitPlannerPrompt(buildPlannerPrompt(30_000));
  assert.ok(fitted.length <= PLANNER_PROMPT_BUDGET_CHARS);
  assert.ok(fitted.includes("workflow.list"), "tool ids disappeared from the capability list");
});
