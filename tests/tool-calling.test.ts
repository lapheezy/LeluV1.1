/**
 * ==========================================================
 * LÉLU — NATIVE TOOL CALLING
 *
 * Locks the tool_use / tool_result path. The wire shapes here
 * were each verified against the live Anthropic API before
 * being written down; the cases that assert a REFUSAL exist
 * because the opposite behaviour is what makes LÉLU claim an
 * action she never performed.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

// Shim window/localStorage for KvStore in Node.js test env
if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import AnthropicProvider from "../src/providers/AnthropicProvider";
import GeminiProvider from "../src/providers/GeminiProvider";
import GroqProvider from "../src/providers/GroqProvider";
import {
  extractOpenAIToolCalls,
  openAIToolPayload,
  toOpenAIMessages,
  trailingUserTurn,
} from "../src/providers/openaiTools";
import { toolSchemasForModel, toolSchemaDiagnostics } from "../src/core/tools/ToolSchemas";
import {
  dispatchToolCall,
  executableToolIds,
  registryIdForToolName,
  toolNameForModel,
} from "../src/core/tools/ToolDispatcher";
import ProjectStore from "../src/core/projects/ProjectStore";
import AgentEventBus from "../src/core/agent/AgentEvents";

/* ------------------------------------------------------------------ *
 * WHAT IS OFFERED
 * ------------------------------------------------------------------ */

test("every offered tool has a real executor behind it", () => {
  const executable = new Set(executableToolIds());
  for (const schema of toolSchemasForModel()) {
    assert.ok(
      executable.has(registryIdForToolName(schema.name)),
      `${schema.name} was offered to a model with no executor behind it`,
    );
  }
});

test("a tool above the current autonomy level is not offered", () => {
  // workspace.* needs a development runtime and a raised autonomy
  // level; with neither it must be absent from the offer, not merely
  // fail when called.
  const offered = new Set(toolSchemasForModel().map((schema) => schema.name));
  const blocked = toolSchemaDiagnostics().filter((row) => !row.permitted);
  for (const row of blocked) {
    assert.ok(
      !offered.has(toolNameForModel(row.id)),
      `${row.id} is not permitted but was still offered`,
    );
  }
});

test("model-facing tool names carry no dots, and map back to registry ids", () => {
  for (const schema of toolSchemasForModel()) {
    // Anthropic and the OpenAI-shaped providers both reject dots.
    assert.match(schema.name, /^[a-zA-Z0-9_-]{1,128}$/);
    assert.ok(schema.parameters, `${schema.name} has no parameter schema`);
  }
  assert.equal(toolNameForModel("research.web"), "research_web");
  assert.equal(registryIdForToolName("research_web"), "research.web");
});

/* ------------------------------------------------------------------ *
 * REAL EXECUTION
 * ------------------------------------------------------------------ */

test("a dispatched tool runs for real and reports what it did", async () => {
  const project = ProjectStore.getInstance().create({
    name: "Dispatch Regression",
    description: "",
  });

  const result = await dispatchToolCall(
    { id: "call-1", name: "project_manage", arguments: { action: "list" } },
    "test-task",
  );

  assert.equal(result.ok, true);
  assert.match(result.content, /Dispatch Regression/);
  assert.ok(result.content.includes(project.id));
});

test("an unknown tool is refused rather than reported as done", async () => {
  const result = await dispatchToolCall(
    { id: "call-2", name: "definitely_not_a_tool", arguments: {} },
    "test-task",
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /no tool named/i);
});

test("research without the router context refuses instead of reporting an empty search", async () => {
  // The distinction matters: "I searched and found nothing" and "I could
  // not search" are different claims, and only one of them is true when
  // the provider registry is missing.
  const result = await dispatchToolCall(
    { id: "call-3", name: "research_web", arguments: { query: "anything" } },
    "test-task",
  );
  assert.equal(result.ok, false);
  assert.match(result.content, /without it, so no search was performed/);
});

test("execution emits the events the timeline and memory provenance read", async () => {
  const seen: string[] = [];
  const unsub = AgentEventBus.getInstance().subscribe((event) => {
    if (event.type.startsWith("tool_")) seen.push(event.type);
  });

  await dispatchToolCall(
    { id: "call-4", name: "memory_store", arguments: { summary: "regression probe" } },
    "test-task",
  );
  unsub();

  assert.ok(seen.includes("tool_selected"), "no tool_selected event");
  assert.ok(seen.includes("tool_started"), "no tool_started event");
  assert.ok(seen.includes("tool_result"), "no terminal tool_result event");
});

/* ------------------------------------------------------------------ *
 * WIRE SHAPES
 * ------------------------------------------------------------------ */

test("providers that support tools declare it, and the flag is what the router reads", () => {
  assert.equal(new AnthropicProvider().supportsTools, true);
  assert.equal(new GeminiProvider().supportsTools, true);
  assert.equal(new GroqProvider().supportsTools, true);
});

test("OpenAI-shaped translation preserves tool_calls and tool results", () => {
  const wire = toOpenAIMessages([
    { role: "user", content: "list my projects" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "tc-1", name: "project_manage", arguments: { action: "list" } }],
    },
    { role: "tool", content: "one project", toolCallId: "tc-1", toolName: "project_manage" },
  ]);

  const assistant = wire[1] as Record<string, unknown>;
  const calls = assistant.tool_calls as Array<Record<string, unknown>>;
  assert.equal(assistant.content, null, "a pure tool-request turn must send content:null");
  assert.equal(calls[0].id, "tc-1");
  // Arguments travel as a JSON string in this dialect, not an object.
  assert.equal(
    ((calls[0].function as Record<string, unknown>).arguments as string),
    '{"action":"list"}',
  );

  const toolTurn = wire[2] as Record<string, unknown>;
  assert.equal(toolTurn.role, "tool");
  assert.equal(toolTurn.tool_call_id, "tc-1");
});

test("the live prompt is not re-appended after a tool result", () => {
  const base = { prompt: "list my projects", messages: [] };
  assert.equal(trailingUserTurn({ ...base } as never, "list my projects").length, 1);

  const midLoop = {
    prompt: "list my projects",
    messages: [{ role: "tool" as const, content: "one project", toolCallId: "tc-1" }],
  };
  assert.equal(
    trailingUserTurn(midLoop as never, "list my projects").length,
    0,
    "the question was asked again after it had already been answered",
  );
});

test("malformed tool arguments yield an empty object rather than throwing", () => {
  const calls = extractOpenAIToolCalls({
    message: {
      tool_calls: [{ id: "tc-9", function: { name: "research_web", arguments: "{not json" } }],
    },
  });
  // Throwing here would drop the whole provider to the fallback chain
  // over one bad character; the empty object is reported to the model
  // as a real failure it can correct.
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].arguments, {});
});

test("no tools means no tools key — a non-tool request is unchanged", () => {
  assert.deepEqual(openAIToolPayload({ prompt: "hi", messages: [] } as never), {});
  const withTools = openAIToolPayload({
    prompt: "hi",
    messages: [],
    tools: [{ name: "research_web", description: "d", parameters: { type: "object" } }],
  } as never);
  const tools = withTools.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].type, "function");
  assert.equal((tools[0].function as Record<string, unknown>).name, "research_web");
});
