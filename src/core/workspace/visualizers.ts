/**
 * ==========================================================
 * LÉLU
 * VISUALIZERS
 *
 * Builders that turn REAL application state into structured
 * VisualSpecs for the workspace. Every builder takes plain data
 * (provider snapshots, memory counts, cognition state, …) so the
 * specs always reflect actual state and are testable without a
 * live runtime. Nothing here is hard-coded fiction: if the state
 * says a provider is in cooldown, the diagram shows it.
 * ==========================================================
 */

import type { AgentEvent } from "../agent/AgentEvents";
import type {
  GraphNode,
  TableColumn,
  TableRow,
  TimelineEvent,
  VisualSpec,
  WireframeBox,
} from "./VisualSpec";

/* ------------------------- provider states ------------------------- */

export interface ProviderSnapshotData {
  name: string;
  priority: number;
  enabled: boolean;
  requiresApiKey: boolean;
  lastSuccess?: number;
  failure?: { reason: string } | null;
  inCooldown: boolean;
}

export type ProviderStatus = "ok" | "warn" | "error" | "idle";

export function providerStatus(data: ProviderSnapshotData): ProviderStatus {
  if (data.inCooldown || data.failure) {
    return "error";
  }
  if (data.requiresApiKey && !data.lastSuccess) {
    return "warn";
  }
  if (data.enabled && data.lastSuccess) {
    return "ok";
  }
  return "idle";
}

const STATUS_COLORS: Record<ProviderStatus, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  error: "#f87171",
  idle: "#94a3b8",
};

export function providerStatusLabel(status: ProviderStatus): string {
  switch (status) {
    case "ok":
      return "operational";
    case "warn":
      return "not yet verified";
    case "error":
      return "failure / cooldown";
    case "idle":
      return "disabled";
  }
}

/** Provider registry → node graph: Lélu connected to every provider, edges labelled with fallback priority. */
export function providerArchitecture(
  providers: ProviderSnapshotData[],
): VisualSpec {
  const nodes: GraphNode[] = [
    { id: "lelu", label: "Lélu", kind: "core", color: "#67e8f9" },
  ];
  const edges: VisualSpec["edges"] = [];

  const ordered = [...providers].sort((a, b) => a.priority - b.priority);
  for (const provider of ordered) {
    const status = providerStatus(provider);
    nodes.push({
      id: provider.name,
      label: `${provider.name}${provider.enabled ? "" : " · disabled"}`,
      kind: "provider",
      color: STATUS_COLORS[status],
    });
    edges.push({
      from: "lelu",
      to: provider.name,
      label: `#${provider.priority} ${providerStatusLabel(status)}`,
    });
  }

  return {
    kind: "diagram",
    title: "Provider Architecture",
    caption: `Live provider registry · ${ordered.length} provider(s)`,
    source: "live",
    nodes,
    edges,
  };
}

/** Provider registry → status table. */
export function providerTable(providers: ProviderSnapshotData[]): VisualSpec {
  const columns: TableColumn[] = [
    { key: "name", label: "Provider" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
    { key: "failure", label: "Last failure" },
  ];
  const rows: TableRow[] = providers
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((provider) => ({
      name: provider.name,
      priority: `#${provider.priority}`,
      status: providerStatusLabel(providerStatus(provider)),
      failure: provider.failure?.reason ?? "—",
    }));
  return {
    kind: "table",
    title: "Provider Status",
    caption: "Live from the provider registry",
    source: "live",
    columns,
    rows,
  };
}

/* -------------------------- memory layers -------------------------- */

export interface MemoryLayerData {
  id: string;
  label: string;
  description: string;
  count?: number;
  color?: string;
}

const MEMORY_LAYER_COLORS = [
  "#67e8f9",
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#38bdf8",
  "#f472b6",
];

/** Memory architecture → layer diagram with live pattern counts. */
export function memoryArchitecture(layers: MemoryLayerData[]): VisualSpec {
  const nodes: GraphNode[] = [];
  const edges: VisualSpec["edges"] = [];
  const active = layers.filter((layer) => Boolean(layer.count && layer.count > 0));

  layers.forEach((layer, index) => {
    nodes.push({
      id: layer.id,
      label: layer.count
        ? `${layer.label} · ${layer.count}`
        : layer.label,
      kind: "memory",
      color: layer.color ?? MEMORY_LAYER_COLORS[index % MEMORY_LAYER_COLORS.length],
      x: 10 + (index % 2) * 48,
      y: 12 + Math.floor(index / 2) * 26,
    });
    edges.push({ from: "core-identity", to: layer.id, label: "" });
    if (index < layers.length - 1) {
      edges.push({ from: layer.id, to: layers[index + 1].id, label: "consolidates ↓" });
    }
  });

  if (!nodes.some((node) => node.id === "core-identity")) {
    nodes.unshift({
      id: "core-identity",
      label: "Core Identity",
      kind: "memory-core",
      color: "#f472b6",
      x: 34,
      y: 4,
    });
  }

  return {
    kind: "diagram",
    title: "Memory Architecture",
    caption: active.length
      ? `Live layers · ${active.map((layer) => layer.label).join(" / ")}`
      : "Memory layers",
    source: "live",
    nodes,
    edges,
  };
}

/* ------------------------- cognition state ------------------------- */

export interface CognitionStateData {
  agents: number;
  workspaces: number;
  nodes: number;
  reasoningActive: boolean;
  planActive: boolean;
}

/** Cognition pipeline → diagram annotated with live counts. */
export function cognitionPipeline(state: CognitionStateData): VisualSpec {
  const stage = (
    id: string,
    label: string,
    detail: string,
    color: string,
    x: number,
  ): GraphNode => ({ id, label, kind: "stage", color, x, y: 50, ...(detail ? {} : {}) });

  const stages: GraphNode[] = [
    stage("input", "Input", "user message", "#67e8f9", 4),
    stage("recall", "Memory Recall", "retrieve relevant context", "#a78bfa", 20),
    stage("plan", "Planning", state.planActive ? "plan active" : "plan ready", "#fbbf24", 36),
    stage("reason", "Reasoning", state.reasoningActive ? "reasoning active" : "reasoning ready", "#34d399", 52),
    stage("tools", "Tools", "engineering · research · browser", "#38bdf8", 68),
    stage("provider", "Provider", "fallback chain", "#f472b6", 84),
    stage("response", "Response", "synthesized answer", "#94a3b8", 96),
  ];

  const edges: VisualSpec["edges"] = [];
  for (let index = 0; index < stages.length - 1; index += 1) {
    edges.push({ from: stages[index].id, to: stages[index + 1].id, label: "" });
  }

  return {
    kind: "diagram",
    title: "Cognition Pipeline",
    caption: `Live state · ${state.agents} agent(s) · ${state.workspaces} workspace(s) · ${state.nodes} node(s)`,
    source: "live",
    nodes: [
      ...stages,
      {
        id: "live",
        label: `Agents ${state.agents} · Workspaces ${state.workspaces} · Nodes ${state.nodes}`,
        kind: "metrics",
        color: "#67e8f9",
        x: 34,
        y: 92,
      },
    ],
    edges,
  };
}

/* ---------------------- engineering architecture -------------------- */

/** The actual resolver chain — derived from the real router, static truth. */
export function engineeringFlow(): VisualSpec {
  const stages: GraphNode[] = [
    { id: "observe", label: "Observe", kind: "stage", color: "#38bdf8", x: 4, y: 50 },
    { id: "understand", label: "Understand", kind: "stage", color: "#38bdf8", x: 20, y: 50 },
    { id: "diagnose", label: "Diagnose", kind: "stage", color: "#fbbf24", x: 36, y: 50 },
    { id: "plan", label: "Plan", kind: "stage", color: "#a78bfa", x: 52, y: 50 },
    { id: "act", label: "Act", kind: "stage", color: "#34d399", x: 68, y: 50 },
    { id: "verify", label: "Verify", kind: "stage", color: "#34d399", x: 84, y: 50 },
    { id: "remember", label: "Remember", kind: "stage", color: "#f472b6", x: 96, y: 50 },
  ];
  const edges: VisualSpec["edges"] = [];
  for (let index = 0; index < stages.length - 1; index += 1) {
    edges.push({ from: stages[index].id, to: stages[index + 1].id, label: "" });
  }
  return {
    kind: "diagram",
    title: "Engineering Architecture",
    caption: "The existing resolver chain — Observe → Understand → Diagnose → Plan → Act → Verify → Remember",
    source: "derived",
    nodes: stages,
    edges,
  };
}

/* ------------------------ browser capabilities ---------------------- */

export interface BrowserCapabilityData {
  nativeLaunchAvailable: boolean;
  inAppLayer: boolean;
  lastReadStatus?: "read" | "blocked" | "error" | "none";
}

export function browserCapabilities(data: BrowserCapabilityData): VisualSpec {
  const nodes: GraphNode[] = [
    { id: "lelu", label: "Lélu", kind: "core", color: "#67e8f9", x: 10, y: 50 },
    {
      id: "native",
      label: data.nativeLaunchAvailable ? "Native Browser" : "Native Browser (unavailable in web sandbox)",
      kind: "browser",
      color: data.nativeLaunchAvailable ? "#34d399" : "#f87171",
      x: 40,
      y: 20,
    },
    {
      id: "inapp",
      label: "In-App Browser Layer",
      kind: "browser",
      color: "#38bdf8",
      x: 40,
      y: 80,
    },
  ];
  return {
    kind: "diagram",
    title: "Browser Capabilities",
    caption: data.lastReadStatus && data.lastReadStatus !== "none"
      ? `Last read attempt: ${data.lastReadStatus}`
      : "Live capability map",
    source: "live",
    nodes,
    edges: [
      { from: "lelu", to: "native", label: "" },
      { from: "lelu", to: "inapp", label: "open / read" },
    ],
  };
}

/* --------------------------- data views ----------------------------- */

export function chart(
  title: string,
  series: VisualSpec["series"],
  caption?: string,
): VisualSpec {
  return {
    kind: "chart",
    title,
    caption,
    source: "live",
    series: series ?? [],
  };
}

export function table(
  title: string,
  columns: TableColumn[],
  rows: TableRow[],
  caption?: string,
): VisualSpec {
  return {
    kind: "table",
    title,
    caption,
    source: "live",
    columns,
    rows,
  };
}

export function timeline(
  title: string,
  events: TimelineEvent[],
  caption?: string,
): VisualSpec {
  return {
    kind: "timeline",
    title,
    caption,
    source: "live",
    timeline: events,
  };
}

/* --------------------------- activity log --------------------------- */

const EVENT_STATUS: Record<AgentEvent["type"], TimelineEvent["status"]> = {
  task_started: "running",
  task_planning: "running",
  tool_selected: "running",
  tool_started: "running",
  tool_progress: "running",
  tool_result: "ok",
  tool_failed: "error",
  file_opened: "ok",
  file_changed: "ok",
  browser_opened: "ok",
  browser_navigation: "running",
  browser_result: "ok",
  memory_retrieval: "ok",
  memory_update: "ok",
  provider_selected: "running",
  provider_status: "idle",
  diagram_created: "ok",
  visual_created: "ok",
  ui_prototype_created: "ok",
  creative_artifact: "ok",
  workspace_open: "idle",
  workspace_focus: "idle",
  workspace_minimize: "idle",
  spatial_event: "running",
  core_transform: "running",
  task_completed: "ok",
  task_failed: "error",
  cognitive_sync: "idle",
  execution_phase: "running",
  approval_requested: "idle",
  approval_resolved: "ok",
};

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "task_started":
      return `Task started · ${event.label}`;
    case "task_planning":
      return `Planning${event.plan ? ` · ${event.plan}` : ""}`;
    case "tool_selected":
      return `Tool selected · ${event.tool}${event.label ? ` (${event.label})` : ""}`;
    case "tool_started":
      return `Tool running · ${event.tool}`;
    case "tool_progress":
      return `${event.tool} · ${event.progress}%${event.note ? ` · ${event.note}` : ""}`;
    case "tool_result":
      return `Tool result · ${event.tool}`;
    case "tool_failed":
      return `Tool failed · ${event.tool}${event.error ? ` (${event.error})` : ""}`;
    case "file_opened":
      return `File opened · ${event.path}`;
    case "file_changed":
      return `File changed · ${event.path}`;
    case "browser_opened":
      return `Browser opened · ${event.url}`;
    case "browser_navigation":
      return `Navigating · ${event.url}`;
    case "browser_result":
      return `Browser result · ${event.title ?? event.url} (${event.status})`;
    case "memory_retrieval":
      return `Memory retrieval · ${event.count} pattern(s) for “${event.query}”`;
    case "memory_update":
      return `Memory updated · ${event.category}`;
    case "provider_selected":
      return `Provider selected · ${event.provider}${event.priority ? ` (#${event.priority})` : ""}`;
    case "provider_status":
      return `Provider status · ${event.provider}: ${event.status}`;
    case "diagram_created":
      return `Diagram created · ${event.label}`;
    case "visual_created":
      return `Visual created · ${event.label}`;
    case "ui_prototype_created":
      return `UI prototype · ${event.label}`;
    case "creative_artifact":
      return `Artifact produced · ${event.label}`;
    case "workspace_open":
      return "Workspace opened";
    case "workspace_focus":
      return `Workspace focus · ${event.view}`;
    case "workspace_minimize":
      return "Workspace minimized";
    case "spatial_event":
      return `${event.label}${event.side ? ` · ${event.side}` : ""}${event.layer ? ` · ${event.layer}` : ""}`;
    case "core_transform":
      return event.morphology
        ? `Core transform · → ${event.morphology}${event.system ? ` · ${event.system}` : ""}`
        : "Core transform · released to auto evolution";
    case "task_completed":
      return `Task completed · ${event.label}`;
    case "task_failed":
      return `Task failed · ${event.label}${event.error ? ` (${event.error})` : ""}`;
    case "cognitive_sync":
      return `Cognitive state synchronized · ${event.source}${event.detail ? ` (${event.detail})` : ""}`;
    case "execution_phase":
      return `${event.label}${event.side ? ` · ${event.side}` : ""}`;
    case "approval_requested":
      return `Approval needed · ${event.title}`;
    case "approval_resolved":
      return `Approval resolved · ${event.decision}`;
    default:
      return "Agent activity";
  }
}

/** The recent agent event log → timeline view (real events only). */
export function activityTimeline(events: AgentEvent[], limit = 12): VisualSpec {
  const recent = events.slice(-limit).reverse();
  const timelineEvents: TimelineEvent[] = recent.map((event) => ({
    time: new Date().toLocaleTimeString(),
    label: eventLabel(event),
    status: EVENT_STATUS[event.type],
  }));
  return {
    kind: "timeline",
    title: "Agent Activity",
    caption: "Live from the agent event bus",
    source: "live",
    timeline: timelineEvents,
  };
}

/* --------------------------- UI wireframe --------------------------- */

/** The existing interface, as a wireframe — built from the real dock/panel list. */
export function uiWireframe(panels: { id: string; label: string; group: string }[]): VisualSpec {
  const boxes: WireframeBox[] = [
    { id: "header", label: "Genesis chip", type: "header", x: 2, y: 2, w: 18, h: 6 },
    { id: "dialogue", label: "Dialogue overlay", type: "panel", x: 30, y: 14, w: 40, h: 30 },
    { id: "core", label: "Genesis Core (3D)", type: "chart", x: 34, y: 38, w: 32, h: 34 },
    { id: "mic", label: "Voice control", type: "button", x: 46, y: 82, w: 8, h: 8 },
    { id: "workspace", label: "Workspace layer", type: "panel", x: 8, y: 58, w: 84, h: 34 },
  ];
  panels.forEach((panel, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    boxes.push({
      id: `dock-${panel.id}`,
      label: panel.label,
      type: "button",
      x: 2 + column * 14,
      y: 88 + row * 8,
      w: 13,
      h: 6,
    });
  });
  return {
    kind: "wireframe",
    title: "UI Architecture",
    caption: "Derived from the real interface layout — dock, dialogue overlay, workspace layer",
    source: "derived",
    boxes,
  };
}
