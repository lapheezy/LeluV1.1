/**
 * ==========================================================
 * LÉLU — ENVIRONMENT OPERATOR TOOLS (SESSION 02)
 *
 * Exposes environment orchestration capabilities directly to LÉLU's
 * cognition loop, AI providers, and tool dispatcher:
 *
 *   environment.compose          risk 1  construct workspaces and presentation surfaces
 *   environment.present_artifact risk 0  open/display visual artifacts (diagrams, tables, files)
 *   environment.mutate_surface   risk 1  in-place revision of an existing presentation surface
 *   environment.manage_workspace risk 1  organize layouts (grid, split, stack, auto, lock)
 *   environment.save_state       risk 0  snapshot active environment state
 *   environment.restore_state    risk 1  restore a saved environment state
 *
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import EnvironmentOrchestrationEngine, {
  type EnvironmentTaskCategory,
  type SurfaceComposition,
} from "./EnvironmentOrchestrationEngine";
import WorkspaceEngine from "../workspace/WorkspaceEngine";

interface ToolExecutor {
  id: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

const tool = (
  id: string,
  name: string,
  description: string,
  riskLevel: number,
  permissions: string[],
): ToolDefinition =>
  ({
    id,
    name,
    description,
    category: "Environment",
    permissions,
    riskLevel,
    available: true,
    executionRoute: "front-end:EnvironmentOrchestrationEngine",
    verificationMethod: "environment.compose",
  }) as ToolDefinition;

export const ENVIRONMENT_TOOLS: ToolDefinition[] = [
  tool(
    "environment.compose",
    "Compose Operational Environment",
    "Dynamically construct an operational presentation environment with multiple workspaces, interactive surfaces, and optional 3D cosmos objects based on user intent.",
    1,
    ["WRITE", "EXECUTE"],
  ),
  tool(
    "environment.present_artifact",
    "Present Visual Artifact",
    "Present or render a structured visual artifact (diagram, table, document, browser, chart) directly in the active environment workspace.",
    0,
    ["READ", "WRITE"],
  ),
  tool(
    "environment.mutate_surface",
    "Mutate Presentation Surface",
    "Revise or update an existing workspace surface in-place (updating text, diagram nodes, table rows, or focus state) without rebuilding the environment.",
    1,
    ["WRITE"],
  ),
  tool(
    "environment.manage_workspace",
    "Manage Workspace Arrangement",
    "Control spatial layout, arrange presentation surfaces (grid, split, stack, auto), focus specific views, or lock layout.",
    1,
    ["WRITE", "EXECUTE"],
  ),
  tool(
    "environment.save_state",
    "Save Environment State",
    "Snapshot the current environment workspace layout, surfaces, and active project context for subsequent recall.",
    0,
    ["READ", "WRITE"],
  ),
  tool(
    "environment.restore_state",
    "Restore Environment State",
    "Restore a previously saved environment snapshot, reconstructing its exact layout and surfaces.",
    1,
    ["WRITE", "EXECUTE"],
  ),
];

function str(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  return typeof val === "string" ? val.trim() : "";
}

export const ENVIRONMENT_EXECUTORS: ToolExecutor[] = [
  {
    id: "environment.compose",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Name or title for the composed environment." },
        category: {
          type: "string",
          enum: ["research", "creative", "development", "data", "planning", "3d", "conversation"],
          description: "Task category driving the presentation.",
        },
        layout: {
          type: "string",
          enum: ["auto", "grid", "split", "stack"],
          description: "Layout orchestration mode.",
        },
        prompt: {
          type: "string",
          description: "Natural language description to synthesize surfaces from when explicit surfaces are not provided.",
        },
        surfaces: {
          type: "array",
          description: "Explicit surfaces to instantiate.",
          items: {
            type: "object",
            properties: {
              kind: { type: "string" },
              title: { type: "string" },
              text: { type: "string" },
              url: { type: "string" },
              spec: { type: "object" },
            },
            required: ["kind", "title"],
          },
        },
      },
    },
    run: async (args) => {
      const engine = EnvironmentOrchestrationEngine.getInstance();
      const title = str(args, "title") || "Operational Workspace";
      const category = (str(args, "category") || "development") as EnvironmentTaskCategory;
      const layout = str(args, "layout") as "auto" | "grid" | "split" | "stack" | "";
      const prompt = str(args, "prompt");

      let surfaces: SurfaceComposition[] = [];
      if (Array.isArray(args.surfaces) && args.surfaces.length > 0) {
        surfaces = args.surfaces as SurfaceComposition[];
      } else if (prompt) {
        surfaces = engine.synthesizeInterfaceFromNL(prompt, category);
      } else {
        surfaces = engine.synthesizeInterfaceFromNL(title, category);
      }

      const res = await engine.composeEnvironment({
        title,
        category,
        layout: layout || undefined,
        surfaces,
      });

      return {
        ok: true,
        content: `Composed environment "${title}" (${category}) with ${res.createdViews.length} surface(s) in "${res.activeLayout}" layout. Active views: ${res.createdViews.map((v) => `[${v.id}] ${v.title}`).join(", ")}.`,
        data: {
          createdViews: res.createdViews.map((v) => ({ id: v.id, kind: v.kind, title: v.title })),
          layout: res.activeLayout,
        },
      };
    },
  },

  {
    id: "environment.present_artifact",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["diagram", "chart", "table", "timeline", "file", "browser"],
          description: "Type of artifact to present.",
        },
        title: { type: "string", description: "Artifact title." },
        text: { type: "string", description: "Text or markdown content for file artifacts." },
        url: { type: "string", description: "URL for browser artifacts." },
        spec: { type: "object", description: "Structured VisualSpec data for diagram, chart, table, or timeline." },
      },
      required: ["kind", "title"],
    },
    run: async (args) => {
      const workspace = WorkspaceEngine.getInstance();
      const kind = str(args, "kind") as any;
      const title = str(args, "title");
      const text = str(args, "text");
      const url = str(args, "url");
      const spec = args.spec as any;

      const view = workspace.openView({
        kind,
        title,
        text,
        url,
        spec,
        show: true,
      });

      return {
        ok: true,
        content: `Presented ${kind} artifact "${title}" [id: ${view.id}]. Visible in workspace revision ${view.revision}.`,
        data: { id: view.id, revision: view.revision, kind },
      };
    },
  },

  {
    id: "environment.mutate_surface",
    parameters: {
      type: "object",
      properties: {
        viewId: { type: "string", description: "The ID of the view to mutate." },
        title: { type: "string", description: "New title." },
        text: { type: "string", description: "Updated text or document content." },
        spec: { type: "object", description: "Updated visual specification data." },
        elementsToHighlight: {
          type: "array",
          items: { type: "string" },
          description: "Node or element IDs to focus/highlight.",
        },
      },
      required: ["viewId"],
    },
    run: async (args) => {
      const engine = EnvironmentOrchestrationEngine.getInstance();
      const viewId = str(args, "viewId");
      const elementsToHighlight = Array.isArray(args.elementsToHighlight)
        ? (args.elementsToHighlight as string[])
        : undefined;

      const res = engine.mutateSurface(viewId, {
        title: str(args, "title") || undefined,
        text: str(args, "text") || undefined,
        spec: args.spec as any,
        viewState: elementsToHighlight ? { highlighted: elementsToHighlight } : undefined,
      });

      if (!res.ok || !res.view) {
        return { ok: false, content: res.error ?? "Failed to mutate surface." };
      }

      return {
        ok: true,
        content: `Surface [${viewId}] updated to revision ${res.view.revision}: "${res.view.title}".`,
        data: { id: res.view.id, revision: res.view.revision },
      };
    },
  },

  {
    id: "environment.manage_workspace",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["layout", "focus", "split", "stack", "close", "minimize", "maximize"],
          description: "Workspace operation.",
        },
        layout: { type: "string", enum: ["auto", "grid", "split", "stack"] },
        viewId: { type: "string", description: "Target view ID for focus, close, minimize, maximize." },
        viewIds: { type: "array", items: { type: "string" }, description: "View IDs for split or stack." },
      },
      required: ["action"],
    },
    run: async (args) => {
      const workspace = WorkspaceEngine.getInstance();
      const action = str(args, "action");
      const viewId = str(args, "viewId");
      const viewIds = Array.isArray(args.viewIds) ? (args.viewIds as string[]) : [];

      if (action === "layout") {
        const layout = str(args, "layout") as "auto" | "grid" | "split" | "stack";
        if (!layout) return { ok: false, content: "Action 'layout' requires layout mode." };
        workspace.setLayout(layout);
        return { ok: true, content: `Workspace layout set to "${layout}".` };
      }

      if (action === "focus") {
        if (!viewId) return { ok: false, content: "Focus requires viewId." };
        workspace.focusView(viewId);
        return { ok: true, content: `Focused view [${viewId}].` };
      }

      if (action === "split") {
        if (viewIds.length < 2) return { ok: false, content: "Split requires at least 2 viewIds." };
        workspace.splitView(viewIds);
        return { ok: true, content: `Split workspace with views: ${viewIds.join(", ")}.` };
      }

      if (action === "stack") {
        if (viewIds.length < 2) return { ok: false, content: "Stack requires at least 2 viewIds." };
        workspace.stackView(viewIds);
        return { ok: true, content: `Stacked views: ${viewIds.join(", ")}.` };
      }

      if (action === "close") {
        if (!viewId) return { ok: false, content: "Close requires viewId." };
        workspace.closeView(viewId);
        return { ok: true, content: `Closed view [${viewId}].` };
      }

      if (action === "minimize") {
        if (!viewId) return { ok: false, content: "Minimize requires viewId." };
        workspace.minimizeView(viewId);
        return { ok: true, content: `Minimized view [${viewId}].` };
      }

      if (action === "maximize") {
        if (!viewId) return { ok: false, content: "Maximize requires viewId." };
        workspace.maximizeView(viewId);
        return { ok: true, content: `Maximized view [${viewId}].` };
      }

      return { ok: false, content: `Unknown action: "${action}".` };
    },
  },

  {
    id: "environment.save_state",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Descriptive name for the saved environment snapshot." },
        category: {
          type: "string",
          enum: ["research", "creative", "development", "data", "planning", "3d", "conversation"],
        },
      },
      required: ["name"],
    },
    run: async (args) => {
      const engine = EnvironmentOrchestrationEngine.getInstance();
      const name = str(args, "name");
      const category = (str(args, "category") || "development") as EnvironmentTaskCategory;
      const snapshot = engine.saveSnapshot(name, category);
      return {
        ok: true,
        content: `Saved environment state snapshot "${name}" (id: ${snapshot.id}) with ${snapshot.workspaceSnapshot.views.length} active views.`,
        data: { snapshotId: snapshot.id, viewCount: snapshot.workspaceSnapshot.views.length },
      };
    },
  },

  {
    id: "environment.restore_state",
    parameters: {
      type: "object",
      properties: {
        snapshotId: { type: "string", description: "Snapshot ID to restore." },
      },
      required: ["snapshotId"],
    },
    run: async (args) => {
      const engine = EnvironmentOrchestrationEngine.getInstance();
      const snapshotId = str(args, "snapshotId");
      const res = engine.restoreSnapshot(snapshotId);
      if (!res.ok || !res.snapshot) {
        return { ok: false, content: res.error ?? "Failed to restore environment snapshot." };
      }
      return {
        ok: true,
        content: `Restored environment snapshot "${res.snapshot.name}" (${res.snapshot.category}). ${res.snapshot.workspaceSnapshot.views.length} views restored.`,
        data: { snapshotId, layout: res.snapshot.workspaceSnapshot.layout },
      };
    },
  },
];

export function registerEnvironmentTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const definition of ENVIRONMENT_TOOLS) {
    registry.register(definition);
  }
}
