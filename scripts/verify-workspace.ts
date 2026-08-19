/**
 * Verification for the visual agent workspace: the WorkspaceEngine
 * structured API (create/open/focus/close/minimize/maximize/resize/
 * split/stack/pin/group/reorder/save-restore/closeTemporary), the
 * AgentEvents bus, the adaptive layout engine, the workspace command
 * parser, and the real-state visualizers.
 */

import assert from "node:assert/strict";
import AgentEventBus from "../src/core/agent/AgentEvents";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import { computeLayout, columnCount, isMobile } from "../src/core/workspace/AdaptiveLayout";
import { parseWorkspaceCommand } from "../src/core/router/WorkspaceResolver";
import {
  memoryArchitecture,
  providerArchitecture,
  providerStatus,
  uiWireframe,
} from "../src/core/workspace/visualizers";

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function view(id: string, index: number, overrides: Partial<Parameters<typeof computeLayout>[0][number]> = {}) {
  return {
    id,
    kind: "chart" as const,
    title: id,
    createdAt: index,
    updatedAt: index,
    minimized: false,
    pinned: false,
    temporary: false,
    weight: 1,
    stackOrder: index,
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log("AgentEvents bus");

  await check("emit dispatches to subscribers", () => {
    let received = 0;
    const unsubscribe = AgentEventBus.getInstance().subscribe(() => {
      received += 1;
    });
    AgentEventBus.getInstance().emit({ type: "task_started", taskId: "t1", label: "x" });
    unsubscribe();
    AgentEventBus.getInstance().emit({ type: "task_started", taskId: "t1", label: "y" });
    assert.equal(received, 1);
  });

  await check("a throwing listener is contained, others still run", () => {
    let received = 0;
    const bus = AgentEventBus.getInstance();
    const remove = bus.subscribe(() => {
      throw new Error("boom");
    });
    const remove2 = bus.subscribe(() => {
      received += 1;
    });
    bus.emit({ type: "task_completed", taskId: "t1", label: "x" });
    remove();
    remove2();
    assert.equal(received, 1);
  });

  console.log("WorkspaceEngine — controlled API");

  await check("openView creates, focuses, and shows a view", () => {
    const engine = WorkspaceEngine.getInstance();
    engine.minimizeAll();
    engine.openView({ kind: "diagram", title: "Test Diagram" });
    const state = engine.getState();
    assert.equal(state.visible, true);
    assert.equal(state.views.length, 1);
    assert.equal(state.views[0].title, "Test Diagram");
    assert.equal(state.focusId, state.views[0].id);
    engine.clear();
  });

  await check("openView with the same id updates instead of stacking", () => {
    const engine = WorkspaceEngine.getInstance();
    const first = engine.openView({ id: "view-providers", kind: "providers", title: "Provider Map" });
    const second = engine.openView({ id: "view-providers", kind: "providers", title: "Provider Map v2" });
    assert.equal(engine.getState().views.length, 1);
    assert.equal(second.title, "Provider Map v2");
    engine.clear();
  });

  await check("closeView removes and re-focuses", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "diagram", title: "A" });
    const b = engine.openView({ kind: "chart", title: "B" });
    engine.closeView(a.id);
    const state = engine.getState();
    assert.equal(state.views.length, 1);
    assert.equal(state.views[0].title, "B");
    assert.equal(state.focusId, b.id);
    engine.clear();
  });

  await check("minimizeView keeps the view, restoreView brings it back", () => {
    const engine = WorkspaceEngine.getInstance();
    const viewItem = engine.openView({ kind: "table", title: "Data" });
    engine.minimizeView(viewItem.id);
    assert.equal(engine.getState().views[0].minimized, true);
    engine.restoreView(viewItem.id);
    assert.equal(engine.getState().views[0].minimized, false);
    engine.clear();
  });

  await check("splitView enables two-up mode", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "diagram", title: "A" });
    const b = engine.openView({ kind: "chart", title: "B" });
    engine.splitView([a.id, b.id]);
    assert.deepEqual(engine.getState().splitIds, [a.id, b.id]);
    engine.clear();
  });

  await check("updateView replaces the visual model in place", () => {
    const engine = WorkspaceEngine.getInstance();
    const viewItem = engine.openView({ kind: "diagram", title: "Architecture", spec: { kind: "diagram", title: "Architecture", nodes: [{ id: "a", label: "A" }] } });
    engine.updateView(viewItem.id, {
      spec: { kind: "diagram", title: "Architecture", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
    });
    const updated = engine.getState().views[0];
    assert.equal(updated.spec?.nodes?.length, 2);
    engine.clear();
  });

  await check("minimizeAll pins the workspace; agent events no longer auto-show", () => {
    const engine = WorkspaceEngine.getInstance();
    engine.minimizeAll();
    AgentEventBus.getInstance().emit({ type: "tool_started", taskId: "t2", tool: "engineering" });
    assert.equal(engine.getState().visible, false);
    engine.clear();
    engine.show();
    AgentEventBus.getInstance().emit({ type: "tool_started", taskId: "t3", tool: "engineering" });
    assert.equal(engine.getState().visible, true);
    engine.clear();
  });

  await check("events accumulate in the activity log", () => {
    const engine = WorkspaceEngine.getInstance();
    engine.clear();
    AgentEventBus.getInstance().emit({ type: "tool_result", taskId: "t4", tool: "engineering", result: "ok" });
    AgentEventBus.getInstance().emit({ type: "memory_retrieval", taskId: "t4", query: "q", count: 3 });
    assert.ok(engine.getState().events.length >= 2);
    engine.clear();
  });

  await check("showFile/showBrowser/showData convenience wrappers work", () => {
    const engine = WorkspaceEngine.getInstance();
    engine.showFile("Code", "console.log(1)");
    engine.showBrowser("Page", "https://example.com");
    assert.equal(engine.getState().views.length, 2);
    engine.clear();
  });

  console.log("WorkspaceEngine — structured operations");

  await check("maximizeView enlarges, focuses, and restores", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "diagram", title: "A" });
    const b = engine.openView({ kind: "chart", title: "B" });
    engine.maximizeView(a.id);
    const state = engine.getState();
    assert.equal(state.focusId, a.id);
    assert.equal(state.views.find((item) => item.id === a.id)?.weight, 2);
    assert.equal(state.views.find((item) => item.id === b.id)?.weight, 1);
    engine.clear();
  });

  await check("resizeView clamps weight to 1..3", () => {
    const engine = WorkspaceEngine.getInstance();
    const viewItem = engine.openView({ kind: "chart", title: "Data" });
    engine.resizeView(viewItem.id, 5);
    assert.equal(engine.getState().views[0].weight, 3);
    engine.resizeView(viewItem.id, -5);
    assert.equal(engine.getState().views[0].weight, 1);
    engine.clear();
  });

  await check("pinned views survive closeTemporary", () => {
    const engine = WorkspaceEngine.getInstance();
    const temp = engine.openView({ kind: "chart", title: "Temp", temporary: true });
    const pinned = engine.openView({ kind: "diagram", title: "Keep", temporary: true, pinned: true });
    const count = engine.closeTemporary();
    assert.equal(count, 1);
    assert.equal(engine.getState().views.length, 1);
    assert.equal(engine.getState().views[0].id, pinned.id);
    engine.clear();
  });

  await check("groupViews assigns a shared group", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "chart", title: "A" });
    const b = engine.openView({ kind: "chart", title: "B" });
    engine.groupViews([a.id, b.id], "research");
    assert.equal(engine.getState().views[0].group, "research");
    assert.equal(engine.getState().views[1].group, "research");
    engine.clear();
  });

  await check("stackView layers views and focuses the top", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "chart", title: "A" });
    const b = engine.openView({ kind: "diagram", title: "B" });
    engine.stackView([a.id, b.id]);
    const state = engine.getState();
    assert.equal(state.layout, "stack");
    assert.equal(state.focusId, b.id);
    assert.ok(state.views.find((item) => item.id === a.id)?.stackOrder! < state.views.find((item) => item.id === b.id)?.stackOrder!);
    engine.clear();
  });

  await check("reorderViews changes display order", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "chart", title: "A" });
    const b = engine.openView({ kind: "diagram", title: "B" });
    const c = engine.openView({ kind: "table", title: "C" });
    engine.reorderViews([c.id, a.id, b.id]);
    const order = engine.getState().views.map((item) => item.title);
    assert.deepEqual(order, ["C", "A", "B"]);
    engine.clear();
  });

  await check("saveLayout + restoreLayout restores views and mode", () => {
    const engine = WorkspaceEngine.getInstance();
    const a = engine.openView({ kind: "chart", title: "A" });
    engine.openView({ kind: "diagram", title: "B" });
    engine.setLayout("split");
    engine.saveLayout();
    engine.clear();
    assert.equal(engine.getState().views.length, 0);
    assert.equal(engine.restoreLayout(), true);
    const state = engine.getState();
    assert.equal(state.views.length, 2);
    assert.equal(state.layout, "split");
    assert.ok(state.views.some((item) => item.id === a.id));
    engine.clear();
  });

  console.log("Adaptive layout engine");

  await check("columnCount adapts to the viewport", () => {
    assert.equal(columnCount(375), 1);
    assert.equal(columnCount(900), 2);
    assert.equal(columnCount(1280), 3);
    assert.equal(columnCount(1800), 4);
  });

  await check("isMobile below 768px", () => {
    assert.equal(isMobile(375), true);
    assert.equal(isMobile(1280), false);
  });

  await check("desktop grid places many views with focus spanning 2", () => {
    const views = ["a", "b", "c", "d"].map((id, index) => view(id, index));
    const layout = computeLayout(views, "b", "auto", [], { width: 1280, height: 800 });
    assert.equal(layout.cols, 3);
    assert.equal(layout.cells.length, 4);
    assert.equal(layout.cells.find((cell) => cell.viewId === "b")?.colSpan, 2);
    assert.equal(layout.secondary.length, 0);
  });

  await check("mobile grid keeps focus+pinned and moves the rest to the strip", () => {
    const views = ["a", "b", "c"].map((id, index) => view(id, index, { pinned: id === "a" }));
    const layout = computeLayout(views, "b", "auto", [], { width: 375, height: 700 });
    assert.equal(layout.cols, 1);
    assert.ok(layout.cells.some((cell) => cell.viewId === "b"));
    assert.ok(layout.cells.some((cell) => cell.viewId === "a"));
    assert.ok(layout.secondary.includes("c"));
  });

  await check("split mode places two members side by side on desktop", () => {
    const views = ["a", "b"].map((id, index) => view(id, index));
    const layout = computeLayout(views, "b", "split", ["a", "b"], { width: 1280, height: 800 });
    assert.equal(layout.mode, "split");
    assert.equal(layout.cols, 2);
  });

  await check("stack mode layers all views", () => {
    const views = ["a", "b", "c"].map((id, index) => view(id, index));
    const layout = computeLayout(views, "c", "stack", [], { width: 1280, height: 800 });
    assert.equal(layout.mode, "stack");
    assert.equal(layout.cells.length, 3);
    assert.equal(layout.cells[2].layer, 2);
  });

  console.log("Workspace command parser");

  await check("'show me a diagram of your provider architecture' → open providers", () => {
    const command = parseWorkspaceCommand("show me a diagram of your provider architecture");
    assert.equal(command.action, "open_view");
    assert.equal(command.kind, "providers");
  });

  await check("'two tabs — one with UI engineering and another with TV stats' → split", () => {
    const command = parseWorkspaceCommand("show me two tabs: one with a diagram of how to change your UI and another with TV show statistics");
    assert.equal(command.action, "split_view");
  });

  await check("'move the memory system to the right' → update_visual", () => {
    const command = parseWorkspaceCommand("move the memory system to the right");
    assert.equal(command.action, "update_visual");
    assert.equal(command.direction, "right");
    assert.ok(command.nodeLabel?.includes("memory"));
  });

  await check("'add the fallback provider' to the diagram → update_visual add", () => {
    const command = parseWorkspaceCommand("add the fallback provider to the diagram");
    assert.equal(command.action, "update_visual");
    assert.ok(command.addNode?.includes("fallback"));
  });

  await check("'close the browser view' → close_view", () => {
    const command = parseWorkspaceCommand("close the browser view");
    assert.equal(command.action, "close_view");
    assert.equal(command.kind, "browser");
  });

  await check("multi-open: providers, architecture, browser, statistics → open_many", () => {
    const command = parseWorkspaceCommand("show me the providers, the architecture, the browser results, and the statistics");
    assert.equal(command.action, "open_many");
    assert.ok((command.kinds?.length ?? 0) >= 3);
  });

  await check("'break that down' → open_many decomposition", () => {
    const command = parseWorkspaceCommand("break that down");
    assert.equal(command.action, "open_many");
    assert.ok((command.kinds?.length ?? 0) >= 3);
  });

  await check("'show me everything' → open_many expansion", () => {
    const command = parseWorkspaceCommand("show me everything");
    assert.equal(command.action, "open_many");
    assert.ok((command.kinds?.length ?? 0) >= 5);
  });

  await check("'focus on the chart' → focus_view", () => {
    const command = parseWorkspaceCommand("focus on the chart");
    assert.equal(command.action, "focus_view");
    assert.equal(command.kind, "chart");
  });

  await check("'maximize the provider view' → maximize_view", () => {
    const command = parseWorkspaceCommand("maximize the provider view");
    assert.equal(command.action, "maximize_view");
    assert.equal(command.kind, "providers");
  });

  await check("'pin the chart' → pin_view", () => {
    const command = parseWorkspaceCommand("pin the chart");
    assert.equal(command.action, "pin_view");
    assert.equal(command.kind, "chart");
  });

  await check("'lock the layout' → lock_layout", () => {
    assert.equal(parseWorkspaceCommand("lock the layout").action, "lock_layout");
  });

  await check("'restore the previous layout' → restore_layout", () => {
    assert.equal(parseWorkspaceCommand("restore the previous layout").action, "restore_layout");
  });

  await check("'close the temporary views' → close_temporary", () => {
    assert.equal(parseWorkspaceCommand("close the temporary views").action, "close_temporary");
  });

  await check("plain chat text → none", () => {
    assert.equal(parseWorkspaceCommand("hello, how are you?").action, "none");
  });

  console.log("Visualizers — real state only");

  await check("providerArchitecture reflects status colors", () => {
    const spec = providerArchitecture([
      { name: "Groq", priority: 1, enabled: true, requiresApiKey: true, lastSuccess: 100, failure: null, inCooldown: false },
      { name: "OpenRouter", priority: 2, enabled: true, requiresApiKey: true, failure: { reason: "401" }, inCooldown: true },
    ]);
    assert.equal(spec.kind, "diagram");
    const groq = spec.nodes?.find((node) => node.id === "Groq");
    const or = spec.nodes?.find((node) => node.id === "OpenRouter");
    assert.equal(groq?.color, "#34d399");
    assert.equal(or?.color, "#f87171");
    assert.ok(spec.edges?.some((edge) => edge.label?.includes("#1")));
  });

  await check("providerStatus classifies honestly", () => {
    assert.equal(providerStatus({ name: "A", priority: 1, enabled: true, requiresApiKey: true, lastSuccess: 1, failure: null, inCooldown: false }), "ok");
    assert.equal(providerStatus({ name: "A", priority: 1, enabled: true, requiresApiKey: true, failure: { reason: "402" }, inCooldown: true }), "error");
    assert.equal(providerStatus({ name: "A", priority: 1, enabled: true, requiresApiKey: true, failure: null, inCooldown: false }), "warn");
  });

  await check("memoryArchitecture shows live counts per layer", () => {
    const spec = memoryArchitecture([
      { id: "core-identity", label: "Core Identity", description: "identity", count: 2 },
      { id: "user", label: "User Memory", description: "preference", count: 5 },
    ]);
    assert.ok(spec.nodes?.some((node) => node.label.includes("2")));
    assert.ok(spec.nodes?.some((node) => node.label.includes("5")));
  });

  await check("uiWireframe builds boxes from the panel list", () => {
    const spec = uiWireframe([
      { id: "chat", label: "Chat", group: "core" },
      { id: "memory", label: "Memory", group: "intelligence" },
    ]);
    assert.ok((spec.boxes?.length ?? 0) >= 7);
  });

  console.log("\nWorkspace verification complete.");
}

void main();
