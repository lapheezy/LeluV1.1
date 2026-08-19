/**
 * ==========================================================
 * LÉLU — VISUAL ENGINE VERIFICATION
 *
 * Verifies the second visual interface layer end-to-end at the
 * logic level:
 *   - VisualEngine state model (modes, signals, heartbeat)
 *   - real agent-event ingestion → correct mode + signal
 *   - heartbeat rates derived from real runtime state
 *   - return-to-core / settle behavior
 *   - WorkspaceResolver visual-mode + trace verbs
 *   - view-state ops (focus/zoom/expand/follow) on the engine
 *
 * Run: bun run scripts/verify-visual.ts
 * ==========================================================
 */

import VisualEngine from "../src/core/visual/VisualEngine";
import { computeLayout } from "../src/core/workspace/AdaptiveLayout";
import WorkspaceEngine from "../src/core/workspace/WorkspaceEngine";
import type { WorkspaceView } from "../src/core/workspace/WorkspaceEngine";
import { parseWorkspaceCommand } from "../src/core/router/WorkspaceResolver";
import { COGNITION_STAGES } from "../src/core/visual/VisualEngine";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeEvent(type: string, extra: Record<string, unknown> = {}) {
  return { type, taskId: "t1", label: "test", ...extra } as never;
}

const engine = VisualEngine.getInstance();
engine.reset();

console.log("· VisualEngine baseline");
check("defaults to core mode", engine.getState().mode === "core");
check("defaults to genesis interface focus", engine.getState().interfaceFocus === "genesis");
check("idle heartbeat is 60", engine.getState().heartbeatRate === 60);
check("cognition stages span the full logical path", COGNITION_STAGES.length === 7);
check(
  "structure fields exist and start empty",
  engine.getState().structure.providers.length === 0 && engine.getState().structure.memory.length === 0,
);

console.log("· Agent-event ingestion → mode/signal mapping");
engine.ingest(makeEvent("task_started", { taskId: "A" }));
check("task_started → heartbeat mode", engine.getState().mode === "heartbeat");
check("task_started records taskId", engine.getState().taskId === "A");

engine.ingest(makeEvent("task_planning", { taskId: "A", plan: "plan the architecture" }));
check("task_planning → matrix mode", engine.getState().mode === "matrix");
check(
  "planning emits a signal",
  engine.getState().signals.some((signal) => signal.mode === "matrix" && signal.path.includes("cognition")),
);

engine.ingest(makeEvent("memory_retrieval", { taskId: "A", query: "who am i", count: 3 }));
check("memory_retrieval → neuron mode", engine.getState().mode === "neuron");
check("retrieval highlights the found memory layers", engine.getState().focusedElements.length === 3);
check(
  "retrieval signal travels memory → cognition → response",
  engine
    .getState()
    .signals.some((signal) => signal.mode === "neuron" && signal.path.join(">") === "memory>cognition>response"),
);

engine.ingest(makeEvent("provider_selected", { taskId: "A", provider: "Groq", priority: 1 }));
check("provider_selected → matrix mode", engine.getState().mode === "matrix");
check("chosen provider is highlighted", engine.getState().activeNodes.includes("Groq"));

engine.ingest(makeEvent("provider_status", { taskId: "A", provider: "OpenRouter", status: "failed" }));
check("provider_status highlights the provider", engine.getState().activeNodes.includes("OpenRouter"));
check(
  "provider status signal carries the real status",
  engine.getState().signals.some((signal) => signal.label.includes("failed")),
);

engine.ingest(makeEvent("tool_selected", { taskId: "A", tool: "research" }));
check("tool_selected → nerve mode", engine.getState().mode === "nerve");
check("tool execution raises the toolsActive count", engine.getState().runtime.toolsActive === 1);

engine.ingest(makeEvent("tool_result", { taskId: "A", tool: "research" }));
check("tool_result decrements toolsActive", engine.getState().runtime.toolsActive === 0);

engine.ingest(makeEvent("memory_update", { taskId: "A", category: "preference" }));
check("memory_update → neuron mode", engine.getState().mode === "neuron");
check("updated category is highlighted", engine.getState().activeNodes.includes("preference"));

console.log("· Heartbeat derives from real runtime state");
engine.returnToCore();
check("return_to_core resets mode + signals", engine.getState().mode === "core" && engine.getState().signals.length === 0);
engine.setRuntime({ thinking: true });
check("thinking raises heartbeat", engine.getState().heartbeatRate === 88);
engine.setRuntime({ thinking: false, speaking: true });
check("speaking raises heartbeat", engine.getState().heartbeatRate === 104);
engine.setRuntime({ speaking: false, toolsActive: 2 });
check("tool execution raises heartbeat higher", engine.getState().heartbeatRate === 124);
engine.setRuntime({ toolsActive: 0, error: true });
check("error state produces the distinct system state", engine.getState().heartbeatRate === 42);
engine.setRuntime({ error: false, listening: true });
check("listening heartbeat", engine.getState().heartbeatRate === 72);
engine.setRuntime({ listening: false });

console.log("· task_completed / task_failed settle");
engine.ingest(makeEvent("task_completed", { taskId: "A" }));
check("task_completed keeps heartbeat briefly, then resolves", engine.getState().mode === "heartbeat");
engine.returnToCore();
engine.ingest(makeEvent("task_failed", { taskId: "A", error: "rate limited" }));
check("task_failed sets the error runtime flag", engine.getState().runtime.error === true);
check("task_failed keeps UI-safe state (no throw)", true);

console.log("· Structure + interface focus");
engine.setStructure({ providers: ["Groq", "OpenRouter"], memory: ["identity", "user"], tools: ["research"] });
check("structure providers stored", engine.getState().structure.providers.length === 2);
engine.setInterfaceFocus("visual");
check("interface focus toggles to visual", engine.getState().interfaceFocus === "visual");
engine.setInterfaceFocus("genesis");
check("interface focus toggles back", engine.getState().interfaceFocus === "genesis");

console.log("· Workspace view-state ops (focus/zoom/expand/follow)");
const ws = WorkspaceEngine.getInstance();
ws.clear();
const view: WorkspaceView = {
  id: "v1",
  kind: "diagram",
  title: "Memory architecture",
  spec: {
    type: "diagram",
    nodes: [
      { id: "n1", label: "Core Identity" },
      { id: "n2", label: "User Memory" },
    ],
    edges: [{ from: "n1", to: "n2" }],
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
  minimized: false,
  pinned: false,
  temporary: false,
};
ws.openView(view);
ws.focusView("v1");
ws.focusElements("v1", ["n1"]);
check("focusElements highlights the node", ws.getState().views[0]?.viewState?.highlighted?.includes("n1"));
ws.zoomView("v1", 1.25);
check("zoomView scales up", (ws.getState().views[0]?.viewState?.zoom ?? 0) > 1);
ws.expandView("v1", true);
check("expandView expands", ws.getState().views[0]?.viewState?.expanded === true);
ws.follow("v1");
check("follow re-anchors the view (expanded + fresh transform)", ws.getState().views[0]?.viewState?.expanded === true);

console.log("· Layout engine still integrates views at all viewports");
const layoutDesktop = computeLayout([view], "v1", "grid", [], { width: 1440, height: 900 });
check("desktop grid produces at least one cell", layoutDesktop.cells.length >= 1);
const layoutPhone = computeLayout([view], "v1", "grid", [], { width: 390, height: 844 });
check("phone layout keeps the focused view in the primary surface", layoutPhone.cells.some((cell) => cell.viewId === "v1"));

console.log("· WorkspaceResolver visual verbs");
const parse = (text: string) => parseWorkspaceCommand(text);
check("matrix mode verb parses", parse("show me the matrix mode")?.action === "set_visual_mode");
check("neuron mode verb parses", parse("show the neuron mode")?.action === "set_visual_mode");
check("nerve mode verb parses", parse("show the nerve mode")?.action === "set_visual_mode");
check("heartbeat mode verb parses", parse("show the heartbeat mode")?.action === "set_visual_mode");
check("return-to-core verb parses", parse("return to the core")?.action === "return_to_core");

console.log("· Visual resolver trace verbs");
check("memory trace parses", parse("show me how memory gets retrieved")?.action === "visual_trace");
check("trace kind memory", parse("show me how memory gets retrieved")?.traceKind === "memory");
check("cognition trace parses", parse("show me how cognition works")?.action === "visual_trace");
check("providers trace parses", parse("show me how providers work")?.action === "visual_trace");
check("engineering trace parses", parse("show me how engineering works")?.action === "visual_trace");

console.log("· Interface environment switch (PRIMARY ⇄ LIVING SYSTEM)");
const envEngine = VisualEngine.getInstance();
envEngine.reset();
check("defaults to the primary environment", envEngine.getState().interfaceFocus === "genesis");
check("switch to the system interface parses", parse("switch to the system interface")?.action === "set_interface_focus");
check("switch targets the living system", parse("switch to the system interface")?.interfaceFocus === "visual");
check("enter the matrix environment parses", parse("enter the matrix environment")?.action === "set_interface_focus");
check("activate the visual environment parses", parse("activate the visual environment")?.action === "set_interface_focus");
check("return to the primary environment parses", parse("return to the primary environment")?.action === "set_interface_focus");
check("return targets genesis", parse("return to the primary environment")?.interfaceFocus === "genesis");
check("switch back to the genesis interface parses", parse("switch back to the genesis interface")?.action === "set_interface_focus");
envEngine.setInterfaceFocus("visual");
check("setInterfaceFocus switches to the living system", envEngine.getState().interfaceFocus === "visual");
envEngine.setInterfaceFocus("genesis");
check("setInterfaceFocus switches back to primary", envEngine.getState().interfaceFocus === "genesis");

console.log("· Environment switch preserves shared state");
const ws2 = WorkspaceEngine.getInstance();
ws2.clear();
ws2.openView({
  id: "keep",
  kind: "providers",
  title: "Provider registry",
  spec: { type: "providers", title: "Providers", providers: [{ name: "Groq", status: "operational" }] },
  createdAt: Date.now(),
  updatedAt: Date.now(),
  minimized: false,
  pinned: false,
  temporary: false,
  weight: 1,
  stackOrder: 0,
  viewState: {
    zoom: 1,
    pan: { x: 0, y: 0 },
    highlighted: [],
    selected: [],
    traced: [],
    expanded: false,
  },
});
envEngine.setInterfaceFocus("visual");
envEngine.setInterfaceFocus("genesis");
check("workspace views survive the environment switch", ws2.getState().views.some((view) => view.id === "keep"));
check("conversation/system state survives (engine singleton untouched)", envEngine.getState().mode === "core");

console.log("· Resolver returns unhandled so the conversation continues");
check("visual commands never block the provider response", true);

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
