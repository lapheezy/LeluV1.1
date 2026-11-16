/**
 * ==========================================================
 * LÉLU — COSMOS TOOLS
 *
 * The workspace API and the live map, offered to LÉLU through
 * the SAME pipeline every other tool uses: ToolRegistry marks
 * it, ToolDispatcher runs it, AutonomyGate gates it, and the
 * activity timeline shows the real result.
 *
 * The model-facing tool id is "cosmos.workspace". It never
 * decides its own boundary: every call goes through
 * WorkspaceAPI.execute, which classifies it with
 * CosmosAutonomy and raises a real ApprovalGate request when
 * the boundary says wait.
 *
 * The actor is ALWAYS "lelu". A model must not be able to pass
 * actor:"user" and thereby treat its own click as consent —
 * that would make the approval gate decorative.
 * ==========================================================
 */

import ToolRegistry, { type ToolDefinition } from "../tools/ToolRegistry";
import { registerExecutor } from "../tools/ToolDispatcher";
import type { ToolExecutionResult, ToolExecutor } from "../tools/ToolDispatcher";
import type { CosmosAction } from "./CosmosAutonomy";
import CosmosNavigation from "./CosmosNavigation";
import CosmosInspector from "./CosmosInspector";
import { describeCosmosMap, syncCosmosMap } from "./CosmosLiveMap";
import WorkspaceAPI, { type WorkspaceCall } from "../workspace/WorkspaceAPI";
import type { WorkspaceLayoutMode, WorkspaceViewKind } from "../workspace/WorkspaceEngine";
import type { SpatialKind } from "./SpatialObjects";

const WORKSPACE_ACTIONS: CosmosAction[] = [
  "navigate",
  "open-workspace",
  "read-file",
  "open-browser",
  "arrange-windows",
  "switch-project",
  "place-object",
  "create-room",
  "remove-room",
  "run-task",
  "pause-task",
  "resume-task",
  "cancel-task",
  "restore-workspace",
  "publish-extension",
];

const VIEW_KINDS: WorkspaceViewKind[] = [
  "diagram",
  "chart",
  "table",
  "timeline",
  "wireframe",
  "file",
  "browser",
  "video",
  "image",
  "memory",
  "cognition",
  "providers",
  "genesis",
  "activity",
  "executive",
  "design",
];

const LAYOUTS: WorkspaceLayoutMode[] = ["auto", "grid", "split", "stack"];

const SPATIAL_KINDS: SpatialKind[] = [
  "message",
  "document",
  "image",
  "video",
  "research",
  "project",
  "task",
  "file",
  "conversation",
  "note",
];

const definition = (
  id: string,
  name: string,
  description: string,
  riskLevel: 0 | 1,
  inputSchema?: Record<string, unknown>,
): ToolDefinition => ({
  id,
  name,
  description,
  category: "Cosmos",
  permissions: riskLevel === 0 ? ["READ"] : ["READ", "WRITE"],
  riskLevel,
  available: true,
  ...(inputSchema ? { inputSchema } : {}),
});

export const COSMOS_TOOLS: ToolDefinition[] = [
  definition(
    "cosmos.workspace",
    "Operate the Workspace",
    "Move around the cosmos and change the workspace: go to a room, open or read something, arrange windows, place a link to a real record, make or remove a room, run or pause a background task, switch project, restore the saved workspace. Actions that outlive the moment come back with an approval id instead of running.",
    1,
  ),
  definition(
    "cosmos.map",
    "Read the Cosmos Map",
    "Synchronise and read the live map: galaxies, agent planets, projects, open workspace views, rooms and the trail to where you are now",
    0,
  ),
  definition(
    "cosmos.inspect",
    "Inspect a Placed Record",
    "Read the real record behind an object placed in a room (a project, task, conversation, note or link), or open it in the workspace",
    0,
  ),
];

export function registerCosmosTools(): void {
  const registry = ToolRegistry.getInstance();
  for (const tool of COSMOS_TOOLS) registry.register(tool);
  // The executors join the dispatcher through its own runtime registration
  // path (registerExecutor), which registers the definition as well. A
  // static import of these executors from ToolDispatcher would be a cycle:
  // this module drives WorkspaceAPI, whose approval gate reads ToolRegistry.
  for (const executor of COSMOS_EXECUTORS) {
    const definition = COSMOS_TOOLS.find((tool) => tool.id === executor.id);
    if (!definition) continue;
    const added = registerExecutor(executor, definition);
    if (!added.ok) console.warn(`[CosmosTools] ${executor.id} was not registered: ${added.reason}`);
  }
}

const str = (args: Record<string, unknown>, key: string): string =>
  typeof args[key] === "string" ? (args[key] as string).trim() : "";

function obj(args: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = args[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Turn model arguments into a validated WorkspaceCall.
 *
 * Arguments are checked before anything executes: an unknown action or a
 * view kind that does not exist is refused with the valid options, rather
 * than silently falling through to a default the user never saw.
 */
export function parseWorkspaceCall(args: Record<string, unknown>): { ok: true; call: WorkspaceCall } | { ok: false; error: string } {
  const action = str(args, "action") as CosmosAction;
  if (!action) return { ok: false, error: `cosmos_workspace needs an action. One of: ${WORKSPACE_ACTIONS.join(", ")}.` };
  if (!WORKSPACE_ACTIONS.includes(action)) {
    return {
      ok: false,
      error: `"${action}" is not a workspace action. One of: ${WORKSPACE_ACTIONS.join(", ")}. Protected actions (secrets, authentication, database, deployment, autonomy) are never available as tools.`,
    };
  }

  const call: WorkspaceCall = { action, actor: "lelu" };

  const approvalId = str(args, "approvalId");
  if (approvalId) call.approvalId = approvalId;

  const roomId = str(args, "roomId");
  if (roomId) call.roomId = roomId;

  const projectId = str(args, "projectId");
  if (projectId) call.projectId = projectId;

  const taskId = str(args, "taskId");
  if (taskId) call.taskId = taskId;

  const extensionId = str(args, "extensionId");
  if (extensionId) call.extensionId = extensionId;

  const layout = str(args, "layout");
  if (layout) {
    if (!(LAYOUTS as string[]).includes(layout)) {
      return { ok: false, error: `"${layout}" is not a window layout. One of: ${LAYOUTS.join(", ")}.` };
    }
    call.layout = layout as WorkspaceLayoutMode;
  }

  const view = obj(args, "view");
  if (view) {
    const kind = String(view.kind ?? "").trim() as WorkspaceViewKind;
    const title = String(view.title ?? "").trim();
    if (!title) return { ok: false, error: "a view needs a title." };
    if (!(VIEW_KINDS as string[]).includes(kind)) {
      return { ok: false, error: `"${kind}" is not a view kind. One of: ${VIEW_KINDS.join(", ")}.` };
    }
    const text = typeof view.text === "string" ? view.text : undefined;
    const url = typeof view.url === "string" ? view.url : undefined;
    const id = typeof view.id === "string" ? view.id : undefined;
    call.view = {
      kind,
      title,
      ...(id ? { id } : {}),
      ...(text !== undefined ? { text } : {}),
      ...(url !== undefined ? { url } : {}),
    };
  }

  const room = obj(args, "room");
  if (room) {
    const label = String(room.label ?? "").trim();
    if (!label) return { ok: false, error: "a new room needs a label." };
    const parentId = typeof room.parentId === "string" && room.parentId.trim() ? room.parentId.trim() : null;
    call.room = { label, parentId };
  }

  const object = obj(args, "object");
  if (object) {
    const kind = String(object.kind ?? "").trim() as SpatialKind;
    const title = String(object.title ?? "").trim();
    const link = obj(object, "link");
    const linkKind = link ? String(link.kind ?? "").trim() : "";
    const linkId = link ? String(link.id ?? "").trim() : "";
    if (!(SPATIAL_KINDS as string[]).includes(kind)) {
      return { ok: false, error: `"${kind}" is not a placeable kind. One of: ${SPATIAL_KINDS.join(", ")}.` };
    }
    if (!title) return { ok: false, error: "a placed object needs a title." };
    if (!linkKind || !linkId) {
      return { ok: false, error: "a placed object must link to a real record: pass object.link {kind, id}." };
    }
    call.object = {
      kind,
      title,
      link: { kind: linkKind, id: linkId },
      ...(typeof object.note === "string" ? { note: object.note } : {}),
      ...(typeof object.pinned === "boolean" ? { pinned: object.pinned } : {}),
    };
  }

  // Validate the arguments the chosen action actually needs, before the
  // policy check, so a missing id is reported as a bad call rather than
  // as a boundary refusal.
  const needs: Partial<Record<CosmosAction, keyof WorkspaceCall>> = {
    navigate: "roomId",
    "remove-room": "roomId",
    "run-task": "taskId",
    "pause-task": "taskId",
    "resume-task": "taskId",
    "cancel-task": "taskId",
    "switch-project": "projectId",
    "publish-extension": "extensionId",
  };
  const required = needs[action];
  if (required && !call[required]) {
    return { ok: false, error: `${action} needs ${String(required)}.` };
  }
  if ((action === "open-workspace" || action === "read-file" || action === "open-browser") && !call.view) {
    return { ok: false, error: `${action} needs a view {kind, title} (plus url for open-browser).` };
  }
  if (action === "place-object" && !call.object) {
    return { ok: false, error: "place-object needs an object {kind, title, link}." };
  }
  if (action === "create-room" && !call.room) {
    return { ok: false, error: "create-room needs a room {label}." };
  }
  if (action === "arrange-windows" && !call.layout) {
    return { ok: false, error: "arrange-windows needs a layout (auto, grid, split, stack)." };
  }

  return { ok: true, call };
}

export const COSMOS_EXECUTORS: ToolExecutor[] = [
  {
    id: "cosmos.workspace",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: WORKSPACE_ACTIONS,
          description: "What to do. go to a room (navigate), open a view, place a record, make a room, run or pause a task, and so on.",
        },
        roomId: { type: "string", description: "A destination id from cosmos_map (a room, planet or galaxy)." },
        projectId: { type: "string", description: "A project id, for switch-project." },
        taskId: { type: "string", description: "A background task id, for run/pause/resume/cancel-task." },
        layout: { type: "string", enum: LAYOUTS, description: "Window arrangement, for arrange-windows." },
        view: {
          type: "object",
          properties: {
            id: { type: "string", description: "Reuse this view id to update a window already open." },
            kind: { type: "string", enum: VIEW_KINDS },
            title: { type: "string" },
            text: { type: "string" },
            url: { type: "string" },
          },
          required: ["kind", "title"],
          description: "The window to open (open-workspace / read-file / open-browser).",
        },
        room: {
          type: "object",
          properties: { label: { type: "string" }, parentId: { type: "string" } },
          required: ["label"],
          description: "The room to create.",
        },
        object: {
          type: "object",
          properties: {
            kind: { type: "string", enum: SPATIAL_KINDS },
            title: { type: "string" },
            link: {
              type: "object",
              properties: { kind: { type: "string" }, id: { type: "string" } },
              required: ["kind", "id"],
              description: "The REAL record this object stands for.",
            },
            note: { type: "string" },
            pinned: { type: "boolean" },
          },
          required: ["kind", "title", "link"],
          description: "The record to place in the room.",
        },
        extensionId: { type: "string", description: "A verified extension to publish." },
        approvalId: {
          type: "string",
          description:
            "Only after the user approved this exact call: the id returned by the previous attempt. It works once, for the same arguments.",
        },
      },
      required: ["action"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const parsed = parseWorkspaceCall(args);
      if (!parsed.ok) return { ok: false, content: parsed.error };

      const result = WorkspaceAPI.getInstance().execute(parsed.call);
      const data = {
        ok: result.ok,
        boundary: result.boundary,
        requiresApproval: result.requiresApproval,
        ...(result.approvalId ? { approvalId: result.approvalId } : {}),
      };

      if (result.requiresApproval) {
        return {
          ok: false,
          content:
            `NOT DONE YET — this is a ${result.boundary} action: ${result.message} Nothing in the workspace has changed. ` +
            `The user can approve or reject it from the approvals shown in the conversation` +
            `${result.approvalId ? ` (approval id ${result.approvalId})` : ""}. ` +
            `After they approve, call cosmos_workspace again with the same arguments plus that approvalId; after they reject it, do not retry.`,
          data,
        };
      }

      return {
        ok: result.ok,
        content: `${result.boundary.toUpperCase()}: ${result.message}`,
        data,
      };
    },
  },

  {
    id: "cosmos.map",
    parameters: {
      type: "object",
      properties: {
        sync: {
          type: "boolean",
          description: "Re-read the live environment first (default true). Set false to read the map as it stands.",
        },
      },
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const sync = args.sync !== false;
      const synced = sync ? await syncCosmosMap() : { ok: true, destinations: 0, retired: 0 };
      const nav = CosmosNavigation.getInstance();
      const nodes = nav.getState().nodes;
      return {
        ok: true,
        content:
          `${sync && synced.ok ? `Synchronised with the live environment: ${synced.destinations} destinations, ${synced.retired} retired.\n` : ""}` +
          `${synced.ok ? "" : `The live stores could not be read (${synced.error ?? "unknown error"}), so this is the map as it stands.\n`}` +
          describeCosmosMap(),
        data: {
          destinations: nodes.length,
          rooms: nodes.filter((node) => node.level === "room").length,
          currentId: nav.current().id,
          trail: nav.getState().trail,
        },
      };
    },
  },

  {
    id: "cosmos.inspect",
    parameters: {
      type: "object",
      properties: {
        objectId: { type: "string", description: "The id of an object placed in a room." },
        open: { type: "boolean", description: "Open the record in the workspace as well as reporting it." },
      },
      required: ["objectId"],
    },
    run: async (args): Promise<ToolExecutionResult> => {
      const objectId = str(args, "objectId");
      if (!objectId) return { ok: false, content: "cosmos_inspect needs an objectId." };
      const inspector = CosmosInspector.getInstance();
      const inspection = inspector.inspect(objectId);
      const lines = [
        `${inspection.title} — ${inspection.link.kind} ${inspection.link.id} in ${inspection.roomId}`,
        ...inspection.lines.map((line) => `  ${line}`),
      ];
      if (args.open === true) {
        const opened = inspector.open(objectId);
        lines.push(opened.ok ? `Opened: ${opened.message}` : `Not opened: ${opened.message}`);
      }
      return { ok: inspection.ok, content: lines.join("\n"), data: inspection };
    },
  },
];
