/**
 * ==========================================================
 * LÉLU — TURN-SCOPED TOOL OFFERING
 *
 * CATEGORY: unit. No network, no files.
 *
 * What is pinned: an environment turn is offered the environment family,
 * and every other turn keeps the full derived set. The property exists
 * because the full set is ~19.5k tokens and a provider with an 8k TPM
 * limit answered 413 — after which the resolver retried without tools at
 * all, so the model could not choose a tool it was never shown.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  REDUCED_TOOL_LIMIT,
  reducedToolSchemas,
  scopeToolSchemas,
  toolSchemasForModel,
} from "../src/core/tools/ToolSchemas";

const schema = (name: string) => ({
  name,
  description: `test tool ${name}`,
  parameters: { type: "object", properties: {} },
});

const ALL = [
  schema("environment_compose"),
  schema("environment_present_artifact"),
  schema("environment_mutate_surface"),
  schema("environment_manage_workspace"),
  schema("environment_save_state"),
  schema("environment_restore_state"),
  schema("project_copy"),
  schema("project_read"),
  schema("memory_recall"),
  schema("research_search"),
];

test("an environment turn is offered the environment family only", () => {
  const offered = scopeToolSchemas(ALL, "Create a visual environment for the future of sustainable cities.");
  assert.deepEqual(
    offered.map((s) => s.name),
    [
      "environment_compose",
      "environment_present_artifact",
      "environment_mutate_surface",
      "environment_manage_workspace",
      "environment_save_state",
      "environment_restore_state",
    ],
  );
});

test("a workspace word also scopes the turn", () => {
  for (const prompt of [
    "build me a workspace about Voyager",
    "rearrange the layout",
    "present a summary table",
    "open a panel with the diagram",
  ]) {
    const offered = scopeToolSchemas(ALL, prompt);
    assert.ok(
      offered.every((s) => s.name.startsWith("environment_")),
      `expected only environment tools for: ${prompt}`,
    );
  }
});

test("an ordinary turn keeps the full set", () => {
  const offered = scopeToolSchemas(ALL, "who are you, and what did we discuss yesterday?");
  assert.equal(offered.length, ALL.length, "a conversational turn must keep every tool it had");
});

test("narrowing fails OPEN when the family has no tools", () => {
  const noEnvironment = [schema("project_copy"), schema("memory_recall")];
  const offered = scopeToolSchemas(noEnvironment, "create an environment");
  assert.equal(offered.length, noEnvironment.length, "an empty category must not strip every tool");
});

test("the resolver's derived list is what gets narrowed, not a second list", () => {
  // Whatever the registry/dispatcher/gate agree on in THIS runtime, the
  // scoped answer is a subset of it — never an invented schema.
  const derived = toolSchemasForModel();
  const scoped = scopeToolSchemas(derived, "create an environment about cities");
  assert.ok(scoped.length <= derived.length);
  for (const item of scoped) {
    assert.ok(derived.some((d) => d.name === item.name), `${item.name} must come from the derived list`);
  }
});

test("a size-refused environment turn retries with a smaller environment set, never none", () => {
  const offered = reducedToolSchemas("create an environment about cities");
  assert.ok(offered.length > 0, "a refused turn must keep at least one tool");
  assert.ok(offered.length <= REDUCED_TOOL_LIMIT);
  assert.ok(offered.every((s) => s.name.startsWith("environment_")));
});

test("a size-refused ordinary turn keeps the cheapest schemas instead of losing every tool", () => {
  const offered = reducedToolSchemas("who are you, and what did we discuss yesterday?");
  assert.ok(offered.length > 0 && offered.length <= REDUCED_TOOL_LIMIT);
  const scoped = reducedToolSchemas(ALL, "summarise the conversation");
  assert.ok(scoped.length > 0);
  for (const item of scoped) assert.ok(ALL.some((a) => a.name === item.name), "no invented schema");
});

test("the reduced set stays a subset of the full derived set", () => {
  const derived = toolSchemasForModel();
  for (const prompt of ["create an environment", "hello there", "build a workspace"]) {
    const reduced = reducedToolSchemas(prompt);
    assert.ok(reduced.length <= Math.max(REDUCED_TOOL_LIMIT, 0) || reduced.length === derived.length);
    for (const item of reduced) assert.ok(derived.some((d) => d.name === item.name));
  }
});
