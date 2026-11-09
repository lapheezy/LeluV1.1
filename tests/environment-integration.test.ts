/**
 * ==========================================================
 * LÉLU — ENVIRONMENT ORCHESTRATION, THROUGH THE REAL PATH
 *
 * CATEGORY: integration. No direct engine calls: every environment
 * action below is a MODEL TOOL CALL that travels
 *
 *   ProviderResolver.execute
 *     → the real tool loop (toolSchemasForModel)
 *     → dispatchToolCall
 *     → EnvironmentTools
 *     → EnvironmentOrchestrationEngine
 *     → WorkspaceEngine (what the renderer draws)
 *
 * A scripted provider stands in for the network model — it returns the
 * same `AIResponse.toolCalls` shape a provider returns — so this locks
 * the wiring from "the model asked" to "the surface changed" without
 * claiming a live model was reachable.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

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

import ProviderResolver from "../src/core/router/ProviderResolver";
import RouterContext from "../src/core/router/RouterContext";
import { toolSchemasForModel } from "../src/core/tools/ToolSchemas";
import { registryIdForToolName, toolNameForModel } from "../src/core/tools/ToolDispatcher";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import KvStore from "../src/core/storage/KvStore";
import type { AIRequest, AIResponse } from "../src/providers/AIProvider";

const reply = (text: string, extra: Partial<AIResponse> = {}): AIResponse =>
  ({ text, provider: "scripted", model: "scripted-1", processingTime: 1, ...extra });

/** A provider that answers with exactly the replies it was given, in order. */
function scriptedProvider(replies: AIResponse[]) {
  const requests: AIRequest[] = [];
  let index = 0;
  const provider = {
    name: "Scripted", priority: 1, enabled: true, timeout: 10_000, requiresApiKey: false,
    capabilities: ["chat"] as const, supportsTools: true,
    initialize: async () => {}, isAvailable: async () => true,
    health: async () => ({ available: true, initialized: true, lastChecked: Date.now() }),
    canHandle: () => true,
    generate: async (request: AIRequest) => {
      requests.push(request);
      const answer = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return answer;
    },
  };
  return { provider, requests };
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function context(providers: unknown[], prompt: string): RouterContext {
  return {
    request: { prompt, messages: [], timestamp: Date.now(), allowTools: true },
    started: Date.now(),
    intent: "chat",
    logger: silentLogger,
    aiProviders: {
      available: async () => providers,
      names: () => providers.map((p) => (p as { name: string }).name),
      markFailure: () => {},
      markSuccess: () => {},
      all: () => providers,
      get: () => providers[0],
    },
  } as unknown as RouterContext;
}

/**
 * One conversational turn in which the model calls exactly one tool and
 * then answers. This is the production loop — `ProviderResolver.execute`
 * — not a hand-rolled dispatch.
 */
async function modelTurn(prompt: string, toolName: string, args: Record<string, unknown>) {
  const scripted = scriptedProvider([
    reply("", { toolCalls: [{ id: `call-${toolName}`, name: toolName, arguments: args }] }),
    reply("Done."),
  ]);
  const resolver = new ProviderResolver();
  const ctx = context([scripted.provider], prompt);
  const result = await resolver.execute(ctx);
  // The tool result as the model received it, so a refusal cannot be
  // mistaken for a success.
  const toolMessage = scripted.requests[1]?.messages?.find((message) => message.role === "tool");
  return { result, toolMessage, requests: scripted.requests };
}

const workspace = WorkspaceEngine.getInstance();

test("1. the six environment tools are offered to the model, with resolvable names", () => {
  const offered = new Set(toolSchemasForModel().map((schema) => schema.name));
  const ids = [
    "environment.compose",
    "environment.present_artifact",
    "environment.mutate_surface",
    "environment.manage_workspace",
    "environment.save_state",
    "environment.restore_state",
  ];
  for (const id of ids) {
    const name = toolNameForModel(id);
    assert.ok(offered.has(name), `${id} is not offered to the model`);
    assert.equal(registryIdForToolName(name), id, `${name} does not resolve back to ${id}`);
  }
  // The multi-segment case is the one that used to fail: replacing every
  // underscore gives "environment.present.artifact", which is no tool.
  assert.equal(registryIdForToolName("environment_present_artifact"), "environment.present_artifact");
});

test("2. the model composes an environment and it exists in the workspace the renderer draws", async () => {
  workspace.clear();
  const { result, toolMessage } = await modelTurn(
    "Create a workspace to research CRISPR delivery methods",
    "environment_compose",
    {
      title: "CRISPR research",
      category: "research",
      layout: "split",
      prompt: "compare CRISPR delivery methods with a mechanism diagram and a sources table",
    },
  );

  assert.equal(result.handled, true);
  assert.ok(toolMessage, "the tool result never reached the model");
  assert.equal(toolMessage?.toolError, false, String(toolMessage?.content));

  const state = workspace.getState();
  assert.ok(state.views.length > 0, "environment.compose created no surface");
  assert.equal(state.layout, "split");
  assert.ok(state.views.every((view) => view.revision >= 1));
});

test("3. a follow-up request revises the SAME surface instead of replacing the environment", async () => {
  const before = workspace.getState();
  assert.ok(before.views.length > 0, "no surface to revise");
  const target = before.views[0];
  const viewCountBefore = before.views.length;

  const { toolMessage } = await modelTurn(
    "Add the lipid nanoparticle route to the diagram",
    "environment_mutate_surface",
    { viewId: target.id, title: `${target.title} (revised)`, elementsToHighlight: ["lnp"] },
  );
  assert.equal(toolMessage?.toolError, false, String(toolMessage?.content));

  const after = workspace.getState();
  assert.equal(after.views.length, viewCountBefore, "mutation created a disconnected replacement");
  const revised = after.views.find((view) => view.id === target.id);
  assert.ok(revised, "the revised surface kept its identity");
  assert.ok(revised!.revision > target.revision, "the revision did not advance");
  assert.deepEqual(revised!.viewState.highlighted, ["lnp"]);
});

test("4. an artifact the model presents is rendered in the existing environment", async () => {
  const before = workspace.getState().views.length;
  const { toolMessage } = await modelTurn(
    "Show me a diagram of the delivery mechanism",
    "environment_present_artifact",
    {
      kind: "diagram",
      title: "Delivery mechanism",
      spec: {
        nodes: [
          { id: "cas9", label: "Cas9" },
          { id: "grna", label: "guide RNA" },
          { id: "lnp", label: "LNP" },
        ],
        edges: [
          { from: "cas9", to: "grna" },
          { from: "lnp", to: "cas9" },
        ],
      },
    },
  );
  assert.equal(toolMessage?.toolError, false, String(toolMessage?.content));

  const state = workspace.getState();
  assert.equal(state.views.length, before + 1);
  const chart = state.views.find((view) => view.title === "Delivery mechanism");
  assert.ok(chart, "the presented artifact is not in the workspace");
  assert.equal(chart!.kind, "diagram");
});

test("5. workspace management arranges those same surfaces", async () => {
  const { toolMessage } = await modelTurn(
    "Put these side by side in a grid",
    "environment_manage_workspace",
    { action: "layout", layout: "grid" },
  );
  assert.equal(toolMessage?.toolError, false, String(toolMessage?.content));
  assert.equal(workspace.getState().layout, "grid");
});

test("6. save then restore brings the environment back, and the snapshot survives a reload", async () => {
  const saved = workspace.getState();
  const save = await modelTurn("Save this environment", "environment_save_state", {
    name: "CRISPR session",
    category: "research",
  });
  assert.equal(save.toolMessage?.toolError, false, String(save.toolMessage?.content));

  // Local-device persistence: the engine writes through KvStore, so the
  // snapshot is still there for a reloaded application.
  const persisted = KvStore.getInstance().get<Array<{ id: string; name: string; workspaceSnapshot: { views: unknown[] } }>>(
    "environment.snapshots",
  );
  assert.ok(Array.isArray(persisted) && persisted.length > 0, "nothing was persisted to device storage");
  const record = persisted!.find((snapshot) => snapshot.name === "CRISPR session");
  assert.ok(record, "the saved environment is not in device storage");
  assert.equal(record!.workspaceSnapshot.views.length, saved.views.length);

  workspace.clear();
  assert.equal(workspace.getState().views.length, 0);

  const restore = await modelTurn("Bring my CRISPR environment back", "environment_restore_state", {
    snapshotId: record!.id,
  });
  assert.equal(restore.toolMessage?.toolError, false, String(restore.toolMessage?.content));

  const restored = workspace.getState();
  assert.equal(restored.views.length, saved.views.length, "the restored environment lost surfaces");
  assert.equal(restored.layout, saved.layout, "the restored environment lost its layout");
  assert.deepEqual(
    restored.views.map((view) => view.title),
    saved.views.map((view) => view.title),
  );
});

test("7. a refusal is honest: an unknown view is reported, not silently 'done'", async () => {
  const { toolMessage } = await modelTurn("Update that panel", "environment_mutate_surface", {
    viewId: "view-that-does-not-exist",
    text: "new text",
  });
  assert.equal(toolMessage?.toolError, true, "mutating a missing surface reported success");
  assert.match(String(toolMessage?.content), /does not exist|not found|failed|no such/i);
});
