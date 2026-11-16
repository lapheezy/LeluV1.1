/**
 * ==========================================================
 * LÉLU — THE INTELLIGENCE PAYLOAD A TURN IS ALLOWED TO CARRY
 *
 * CATEGORY: unit. No network, no files.
 *
 * Mission 6.1.3 measured, from the live broker log, that a
 * conversational turn carried 58 tool definitions and a 102 KB body:
 * OpenRouter refused it for credits (402), Groq for its 8000 TPM
 * (413 twice), and the turn only answered after both refusals. The
 * full surface is ~35 KB of JSON schema by itself.
 *
 * What is pinned here is the contract that replaced it:
 *
 *   · a turn is offered a RELEVANT subset, not the whole ecosystem;
 *   · the subset is always drawn from the derived list, never invented;
 *   · the discovery tools survive every selection, so a capability
 *     outside it stays findable;
 *   · relevance still works: a workflow question gets workflow tools,
 *     a memory question gets memory tools, a build question gets studio;
 *   · a size-refused retry is a subset of what the turn already had.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  CORE_TOOL_NAMES,
  DISCOVERY_TOOL_NAMES,
  REDUCED_TOOL_LIMIT,
  TURN_TOOL_BUDGET_BYTES,
  TURN_TOOL_LIMIT,
  reducedToolSchemas,
  selectToolSchemas,
  toolSchemasForModel,
  toolSchemasForRequest,
} from "../src/core/tools/ToolSchemas";

const derived = toolSchemasForModel();
const names = (schemas: Array<{ name: string }>) => schemas.map((schema) => schema.name);
const schemaBytes = (schemas: unknown[]) => new TextEncoder().encode(JSON.stringify(schemas)).length;

const CONVERSATIONAL = [
  "who are you?",
  "hey, how's it going?",
  "what did we discuss yesterday?",
  "what is the weather in Tokyo",
];

test("a conversational turn no longer transmits the whole tool ecosystem", () => {
  assert.ok(derived.length > 20, "the derived surface should be large enough for this to mean something");
  for (const prompt of CONVERSATIONAL) {
    const offered = toolSchemasForRequest(prompt);
    assert.ok(offered.length > 0, `no tools offered for: ${prompt}`);
    assert.ok(
      offered.length <= TURN_TOOL_LIMIT,
      `${offered.length} tools exceed the per-turn limit of ${TURN_TOOL_LIMIT}: ${prompt}`,
    );
    assert.ok(
      offered.length < derived.length,
      `the full ${derived.length}-tool surface was still offered for: ${prompt}`,
    );
  }
});

test("the payload is a fraction of the full surface, in bytes", () => {
  const fullBytes = schemaBytes(derived);
  const worst = Math.max(...CONVERSATIONAL.map((prompt) => schemaBytes(toolSchemasForRequest(prompt))));
  assert.ok(fullBytes > 20_000, `full surface should be substantial, was ${fullBytes} B`);
  assert.ok(worst <= TURN_TOOL_BUDGET_BYTES, `${worst} B exceeds the ${TURN_TOOL_BUDGET_BYTES} B turn budget`);
  assert.ok(
    worst < fullBytes * 0.5,
    `a conversational turn still carries ${Math.round((worst / fullBytes) * 100)}% of the full payload`,
  );
});

test("the discovery tools survive every selection, so nothing becomes unreachable", () => {
  const available = DISCOVERY_TOOL_NAMES.filter((name) => derived.some((schema) => schema.name === name));
  assert.ok(available.length > 0, "no discovery tool exists in this runtime");
  for (const prompt of [...CONVERSATIONAL, "build me a website", "run my workflow"]) {
    const offered = names(toolSchemasForRequest(prompt));
    for (const name of available) {
      assert.ok(offered.includes(name), `${name} was withheld for: ${prompt}`);
    }
  }
});

test("every offered schema comes from the derived list — nothing is invented", () => {
  for (const prompt of [...CONVERSATIONAL, "build me a website", "search the web for news"]) {
    for (const name of names(toolSchemasForRequest(prompt))) {
      assert.ok(derived.some((schema) => schema.name === name), `${name} is not in the derived surface`);
    }
  }
});

test("relevance still selects the right family", () => {
  const cases: Array<[string, string]> = [
    ["run my workflow from last week", "workflow_run"],
    ["what did we discuss yesterday?", "memory_recall"],
    ["build me a small website for my bakery", "studio_build"],
    ["write a file to the sandbox", "sandbox_write"],
    ["search the web for the latest launch", "research_web"],
  ];
  for (const [prompt, expected] of cases) {
    const offered = names(toolSchemasForRequest(prompt));
    assert.ok(offered.includes(expected), `${expected} was not offered for: ${prompt} (got ${offered.join(", ")})`);
  }
});

test("a turn with no signal keeps the conversational core, not the cheapest schemas", () => {
  const offered = names(toolSchemasForRequest("hmm"));
  const core = CORE_TOOL_NAMES.filter((name) => derived.some((schema) => schema.name === name));
  if (core.length > 0) {
    assert.ok(
      core.some((name) => offered.includes(name)),
      `a signal-free turn should keep something from the core, got ${offered.join(", ")}`,
    );
  }
});

test("an environment turn keeps its narrower environment family", () => {
  const offered = toolSchemasForRequest("create a visual environment for sustainable cities", "environment");
  assert.ok(offered.length > 0);
  assert.ok(
    offered.every((schema) => schema.name.startsWith("environment_")),
    `non-environment tool offered on an environment turn: ${names(offered).join(", ")}`,
  );
});

test("a size-refused retry is a strict subset of what the turn already had", () => {
  for (const prompt of [...CONVERSATIONAL, "build me a website", "run my workflow"]) {
    const offered = names(toolSchemasForRequest(prompt));
    const reduced = names(reducedToolSchemas(prompt));
    assert.ok(reduced.length > 0, `the retry lost every tool for: ${prompt}`);
    assert.ok(reduced.length <= REDUCED_TOOL_LIMIT);
    for (const name of reduced) {
      assert.ok(offered.includes(name), `${name} was invented on the retry for: ${prompt}`);
    }
  }
});

test("a caller-supplied list is honoured rather than replaced by the registry", () => {
  const tiny = [
    { name: "memory_recall", description: "recall", parameters: { type: "object", properties: {} } },
    { name: "workflow_run", description: "run a workflow", parameters: { type: "object", properties: {} } },
  ];
  const offered = reducedToolSchemas(tiny, "run my workflow");
  assert.ok(offered.length > 0);
  for (const schema of offered) {
    assert.ok(tiny.some((item) => item.name === schema.name), `${schema.name} came from outside the supplied list`);
  }
});

test("selection is deterministic: the same turn sends the same bytes", () => {
  const first = JSON.stringify(selectToolSchemas(derived, "build me a website"));
  const second = JSON.stringify(selectToolSchemas(derived, "build me a website"));
  assert.equal(first, second);
});
