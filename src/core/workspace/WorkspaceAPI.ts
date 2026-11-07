/**
 * ==========================================================
 * LÉLU — WORKSPACE API
 *
 * One door for everything that changes the spatial workspace,
 * so LÉLU, an authorized agent, and the user's own controls go
 * through the same rules instead of each having their own.
 *
 * It does not re-implement any of the systems it drives:
 *
 *   open / arrange / restore  → WorkspaceEngine (the views and
 *                               the layout that already exist)
 *   navigate / rooms          → CosmosNavigation
 *   documents, images, tasks  → SpatialObjects (links to records)
 *   background work           → TaskEngine (its real task records)
 *   approval                  → ApprovalGate (the existing gate)
 *   GREEN / YELLOW / RED      → CosmosAutonomy (one pure policy)
 *
 * A call that needs approval does NOT run: it returns the pending
 * approval id, and the same call with that id runs once, only if the
 * decision was "approved" and the arguments are unchanged. That is the
 * same single-use rule the tool dispatcher follows.
 *
 * Every applied call is written to a bounded journal, so "what did she
 * do to the workspace" has an answer that is not a guess.
 * ==========================================================
 */

import ApprovalGate, { stableHash } from "../agentic/ApprovalGate";
import {
  ExtensionJournal,
  classifyCosmosAction,
  isProtectedTarget,
  type Actor,
  type Boundary,
  type CosmosAction,
  type ExtensionDraft,
  type ExtensionRecord,
} from "../cosmos/CosmosAutonomy";
import CosmosNavigation from "../cosmos/CosmosNavigation";
import SpatialObjects, { type RecordLink, type SpatialKind } from "../cosmos/SpatialObjects";
import TaskEngine from "../tasks/TaskEngine";
import KvStore from "../storage/KvStore";
import WorkspaceEngine, { type WorkspaceLayoutMode, type WorkspaceViewKind } from "./WorkspaceEngine";

export const WORKSPACE_TOOL = "cosmos.workspace";
const KEY = "lelu.workspace.api.v1";
const MAX_JOURNAL = 100;

export interface WorkspaceCall {
  action: CosmosAction;
  actor?: Actor;
  approvalId?: string;
  /** Open or read a view. */
  view?: { id?: string; kind: WorkspaceViewKind; title: string; text?: string; url?: string };
  layout?: WorkspaceLayoutMode;
  /** A CosmosNavigation destination (room, planet, galaxy, core). */
  roomId?: string;
  projectId?: string;
  taskId?: string;
  /** A link to a REAL record, plus how it should appear. */
  object?: { kind: SpatialKind; title: string; link: RecordLink; note?: string; pinned?: boolean };
  room?: { label: string; parentId?: string | null };
  extensionId?: string;
}

export interface WorkspaceJournalEntry {
  id: string;
  action: CosmosAction;
  actor: Actor;
  boundary: Boundary;
  ok: boolean;
  message: string;
  at: number;
}

export interface WorkspaceResult {
  ok: boolean;
  boundary: Boundary;
  requiresApproval: boolean;
  approvalId?: string;
  message: string;
}

interface PersistedApiState {
  activeProjectId: string | null;
  journal: WorkspaceJournalEntry[];
  /** The room of the last SAVED workspace — what "restore" returns to. */
  savedRoomId: string | null;
}

export default class WorkspaceAPI {
  private static instance: WorkspaceAPI | null = null;

  private activeProjectId: string | null = null;
  private savedRoomId: string | null = null;
  private journal: WorkspaceJournalEntry[] = [];
  private listeners = new Set<(entry: WorkspaceJournalEntry) => void>();
  private readonly extensions = new ExtensionJournal();

  private constructor() {
    this.load();
  }

  static getInstance(): WorkspaceAPI {
    if (!WorkspaceAPI.instance) WorkspaceAPI.instance = new WorkspaceAPI();
    return WorkspaceAPI.instance;
  }

  static reset(): void {
    WorkspaceAPI.instance = null;
    try {
      KvStore.getInstance().remove(KEY);
    } catch {
      /* storage blocked */
    }
  }

  /** The policy for a call, without running it — used by the panel's legend. */
  explain(action: CosmosAction, actor: Actor = "lelu"): ReturnType<typeof classifyCosmosAction> {
    return classifyCosmosAction(action, actor);
  }

  /** Is this target protected ground? */
  protected_(target: string): { protected: boolean; reason: string } {
    return isProtectedTarget(target);
  }

  journalEntries(): WorkspaceJournalEntry[] {
    return [...this.journal];
  }

  onApplied(listener: (entry: WorkspaceJournalEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get activeProject(): string | null {
    return this.activeProjectId;
  }

  /**
   * Run one workspace call.
   *
   * YELLOW for LÉLU/agents and RED for everyone return a pending approval
   * instead of acting; the caller repeats the call with the approval id.
   */
  execute(call: WorkspaceCall): WorkspaceResult {
    const actor: Actor = call.actor ?? "lelu";
    const decision = classifyCosmosAction(call.action, actor);

    // Protected targets are classified red even when the action name is
    // ordinary — a "read-file" of .env is not a green read.
    const target = call.view?.url ?? call.projectId ?? call.roomId ?? call.object?.link?.id ?? "";
    const protection = target ? isProtectedTarget(target) : { protected: false, reason: "" };
    const requiresApproval = decision.requiresApproval || protection.protected;

    if (requiresApproval) {
      const args = { action: call.action, request: approvalPayload(call) };
      if (call.approvalId && ApprovalGate.getInstance().consume(call.approvalId, WORKSPACE_TOOL, args)) {
        const result = this.apply(call);
        this.record(call, actor, protection.protected ? "red" : decision.boundary, result);
        return { ...result, boundary: protection.protected ? "red" : decision.boundary };
      }
      const request = ApprovalGate.getInstance().request({
        taskId: "workspace",
        tool: WORKSPACE_TOOL,
        args,
        title: `Workspace: ${call.action}`,
        detail: protection.protected
          ? `${protection.reason} — ${describe(call)}`
          : `${decision.reason} — ${describe(call)}`,
        systemsAffected: protection.protected ? [target || call.action] : ["workspace"],
      });
      return {
        ok: false,
        boundary: protection.protected ? "red" : decision.boundary,
        requiresApproval: true,
        approvalId: request.id,
        message: `Waiting for approval: ${describe(call)}`,
      };
    }

    const result = this.apply(call);
    this.record(call, actor, decision.boundary, result);
    return result;
  }

  /**
   * What the workspace holds right now, from the real stores — the state a
   * returning session needs to put back.
   */
  snapshot(): {
    roomId: string;
    roomPath: string[];
    activeProjectId: string | null;
    layout: WorkspaceLayoutMode;
    views: Array<{ id: string; kind: string; title: string }>;
    focusId: string | null;
    objects: number;
    openTasks: number;
    capturedAt: number;
  } {
    const nav = CosmosNavigation.getInstance();
    const engine = WorkspaceEngine.getInstance();
    const workspace = engine.getState();
    // Saving the workspace is what makes it the place "restore" returns to,
    // so a later walk through the cosmos cannot overwrite it by accident.
    this.savedRoomId = nav.current().id;
    engine.saveLayout();
    this.persist();
    return {
      roomId: nav.current().id,
      roomPath: nav.pathTo(nav.current().id).map((node) => node.label),
      activeProjectId: this.activeProjectId,
      layout: workspace.layout,
      views: workspace.views.map((view) => ({ id: view.id, kind: view.kind, title: view.title })),
      focusId: workspace.focusId,
      objects: SpatialObjects.getInstance().list().length,
      openTasks: TaskEngine.getInstance().list().filter((task) => task.status === "running" || task.status === "paused" || task.status === "waiting").length,
      capturedAt: Date.now(),
    };
  }

  /** Return to the saved workspace: the room, the project, and the layout. */
  restore(): WorkspaceResult & { roomId: string } {
    const engine = WorkspaceEngine.getInstance();
    const restoredLayout = engine.restoreLayout();
    const nav = CosmosNavigation.getInstance();
    const saved = this.savedRoomId;
    const target = saved && nav.get(saved) ? saved : nav.current().id;
    nav.navigateTo(target);
    const entry: WorkspaceJournalEntry = {
      id: `ws-${crypto.randomUUID().slice(0, 8)}`,
      action: "restore-workspace",
      actor: "user",
      boundary: "green",
      ok: true,
      message: `Restored ${nav.current().label}${this.activeProjectId ? ` · project ${this.activeProjectId}` : ""}${restoredLayout ? " · layout" : ""}`,
      at: Date.now(),
    };
    this.push(entry);
    return {
      ok: true,
      boundary: "green",
      requiresApproval: false,
      message: entry.message,
      roomId: nav.current().id,
    };
  }

  /* ---------------- reversible expansion ---------------- */

  beginExtension(label: string, applies: string[], snapshot: unknown): ExtensionDraft {
    return this.extensions.begin({ label, applies, snapshot });
  }

  verifyExtension(id: string, check: () => boolean): boolean {
    return this.extensions.verify(id, check);
  }

  /** Publish a verified extension. Yellow: a person approves unless they asked. */
  publishExtension(id: string, actor: Actor = "lelu", approvalId?: string): WorkspaceResult {
    const result = this.execute({ action: "publish-extension", actor, approvalId, extensionId: id });
    if (!result.ok) return result;
    const published = this.extensions.publish(id);
    return {
      ...result,
      ok: published.ok,
      message: published.reason,
    };
  }

  rollbackExtension(id: string): { ok: boolean; snapshot?: unknown; reason: string } {
    const rolled = this.extensions.rollback(id);
    if (!rolled.ok) return { ok: false, reason: rolled.reason };
    this.push({
      id: `ws-${crypto.randomUUID().slice(0, 8)}`,
      action: "publish-extension",
      actor: "lelu",
      boundary: "yellow",
      ok: true,
      message: `Rolled back "${id}" to its checkpoint`,
      at: Date.now(),
    });
    return { ok: true, snapshot: rolled.snapshot, reason: "rolled back to the checkpoint" };
  }

  extensions_(): ExtensionRecord[] {
    return this.extensions.list();
  }

  /* ---------------- internals ---------------- */

  private apply(call: WorkspaceCall): WorkspaceResult {
    const nav = CosmosNavigation.getInstance();
    const engine = WorkspaceEngine.getInstance();
    const objects = SpatialObjects.getInstance();

    switch (call.action) {
      case "navigate": {
        const node = call.roomId ? nav.navigateTo(call.roomId) : null;
        if (!node) return fail("navigate", `no destination "${call.roomId ?? ""}"`);
        return ok(`Moved to ${node.label}`);
      }

      case "open-workspace":
      case "read-file":
      case "open-browser": {
        if (!call.view) return fail(call.action, "nothing to open was named");
        const view = engine.openView({
          ...(call.view.id ? { id: call.view.id } : {}),
          kind: call.view.kind,
          title: call.view.title,
          ...(call.view.text !== undefined ? { text: call.view.text } : {}),
          ...(call.view.url !== undefined ? { url: call.view.url } : {}),
          source: { tool: "workspace-api" },
        });
        return ok(`Opened "${view.title}"`);
      }

      case "arrange-windows": {
        const layout: WorkspaceLayoutMode = call.layout ?? "auto";
        engine.setLayout(layout);
        if (layout === "split" || layout === "stack") {
          const ids = engine.getState().views.slice(-2).map((view) => view.id);
          if (ids.length === 2) {
            if (layout === "split") engine.splitView(ids);
            else engine.stackView(ids);
          }
        }
        return ok(`Arranged windows: ${layout}`);
      }

      case "place-object": {
        if (!call.object) return fail("place-object", "no object was named");
        const placed = objects.place({
          kind: call.object.kind,
          title: call.object.title,
          link: call.object.link,
          roomId: call.roomId ?? nav.current().id,
          ...(call.object.note !== undefined ? { note: call.object.note } : {}),
          ...(call.object.pinned !== undefined ? { pinned: call.object.pinned } : {}),
        });
        if (!placed.ok) return fail("place-object", placed.error);
        return ok(`${placed.duplicate ? "Updated" : "Placed"} "${placed.object.title}" in ${nav.current().label}`);
      }

      case "create-room": {
        if (!call.room?.label) return fail("create-room", "a room needs a name");
        const made = nav.createRoom({
          label: call.room.label,
          parentId: call.room.parentId ?? nav.current().id,
          origin: call.actor === "user" ? "user" : "lelu",
          opens: call.projectId ? { projectId: call.projectId } : null,
        });
        if (!made.ok) return fail("create-room", made.error);
        return ok(`${made.created ? "Created" : "Found"} room "${made.node.label}"`);
      }

      case "remove-room": {
        if (!call.roomId) return fail("remove-room", "no room was named");
        const removed = nav.removeRoom(call.roomId);
        if (!removed.ok) return fail("remove-room", removed.error);
        return ok(`Removed room "${removed.node.label}" (reversible)`);
      }

      case "switch-project": {
        if (!call.projectId) return fail("switch-project", "no project was named");
        this.activeProjectId = call.projectId;
        this.persist();
        return ok(`Switched to project ${call.projectId}`);
      }

      case "restore-workspace":
        return { ...this.restore(), ok: true };

      case "run-task":
      case "pause-task":
      case "resume-task":
      case "cancel-task": {
        if (!call.taskId) return fail(call.action, "no task was named");
        const tasks = TaskEngine.getInstance();
        const task =
          call.action === "run-task"
            ? tasks.start(call.taskId)
            : call.action === "pause-task"
              ? tasks.pause(call.taskId)
              : call.action === "resume-task"
                ? tasks.resume(call.taskId)
                : tasks.cancel(call.taskId);
        if (!task) return fail(call.action, `task ${call.taskId} cannot ${call.action.replace("-task", "")} from where it is`);
        return ok(`Task ${task.status}: ${task.goal}`);
      }

      case "publish-extension": {
        if (!call.extensionId) return fail("publish-extension", "no extension was named");
        const draft = this.extensions.get(call.extensionId);
        if (!draft) return fail("publish-extension", "no such draft extension");
        if (draft.status !== "verified") {
          return fail("publish-extension", "the extension has not passed its checks, so it is not published");
        }
        return ok(`Ready to publish "${draft.label}"`);
      }

      default:
        return fail(call.action, `${call.action} is protected and is not carried out by the workspace API`);
    }
  }

  private record(call: WorkspaceCall, actor: Actor, boundary: Boundary, result: WorkspaceResult): void {
    this.push({
      id: `ws-${crypto.randomUUID().slice(0, 8)}`,
      action: call.action,
      actor,
      boundary,
      ok: result.ok,
      message: result.message,
      at: Date.now(),
    });
    this.persist();
  }

  private push(entry: WorkspaceJournalEntry): void {
    this.journal = [...this.journal, entry].slice(-MAX_JOURNAL);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch (error) {
        console.error("[WorkspaceAPI] listener failed:", error);
      }
    }
  }

  private persist(): void {
    try {
      const payload: PersistedApiState = {
        activeProjectId: this.activeProjectId,
        journal: this.journal.slice(-MAX_JOURNAL),
        savedRoomId: this.savedRoomId,
      };
      KvStore.getInstance().set(KEY, payload);
    } catch {
      /* best-effort */
    }
  }

  private load(): void {
    try {
      const stored = KvStore.getInstance().get<PersistedApiState>(KEY);
      if (!stored) return;
      this.activeProjectId = stored.activeProjectId ?? null;
      this.savedRoomId = stored.savedRoomId ?? null;
      this.journal = Array.isArray(stored.journal) ? stored.journal.slice(-MAX_JOURNAL) : [];
    } catch {
      /* a broken journal is not state */
    }
  }
}

function ok(message: string): WorkspaceResult {
  return { ok: true, boundary: "green", requiresApproval: false, message };
}

function fail(action: string, message: string): WorkspaceResult {
  return { ok: false, boundary: "green", requiresApproval: false, message: `${action}: ${message}` };
}

/** The part of a call that must be identical for an approval to be spent. */
function approvalPayload(call: WorkspaceCall): Record<string, unknown> {
  return {
    view: call.view ?? null,
    layout: call.layout ?? null,
    roomId: call.roomId ?? null,
    projectId: call.projectId ?? null,
    taskId: call.taskId ?? null,
    object: call.object ?? null,
    room: call.room ?? null,
    extensionId: call.extensionId ?? null,
  };
}

function describe(call: WorkspaceCall): string {
  if (call.view) return `open ${call.view.kind} “${call.view.title}”`;
  if (call.room) return `create room “${call.room.label}”`;
  if (call.roomId) return call.action === "navigate" ? `go to ${call.roomId}` : `${call.action} ${call.roomId}`;
  if (call.object) return `place ${call.object.kind} “${call.object.title}”`;
  if (call.taskId) return `${call.action} ${call.taskId}`;
  if (call.layout) return `arrange ${call.layout}`;
  return call.action;
}

/** Stable hash used by tests and callers to predict an approval's args. */
export function workspaceArgsHash(call: WorkspaceCall): string {
  return stableHash({ action: call.action, request: approvalPayload(call) });
}
