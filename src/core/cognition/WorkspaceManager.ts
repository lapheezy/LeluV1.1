/**
 * ==========================================================
 * LÉLU
 * WORKSPACE MANAGER — scoped observations
 *
 * A workspace is a named place where observations are filed
 * ("core", "projects", "knowledge"). It used to be a bare
 * `string[]` per workspace: every observation's text sat in a
 * global array with no owner, no conversation and no way to
 * decide who may read it. Names could be listed safely; the
 * ITEMS could not.
 *
 * Now an observation carries provenance when it is filed, and
 * the text is only readable through an authorized accessor.
 * `all()` returns names and counts — never content — so the
 * existing "Workspaces: core, projects" context line keeps
 * working without exposing anything.
 * ==========================================================
 */

import type { MemoryScopeContext } from "../memory/MemorySovereignty";
import { currentSessionId } from "../memory/MemorySovereignty";

export type WorkspaceObservationScope =
  | "conversation-local"
  | "session-local"
  | "user-persistent"
  | "project-associated"
  | "agent-reported"
  | "historical"
  | "inferred";

export interface WorkspaceObservationOrigin {
  userId: string | null;
  conversationId: string | null;
  sessionId: string | null;
  workspaceId: string;
  sourceType: "user-said" | "lelu-observed" | "agent-reported" | "inferred" | "external-tool";
  createdAt: number;
  /** 0..1 — how sure the writer was. */
  confidence: number;
  retention: "durable" | "session" | "expires";
  scope: WorkspaceObservationScope;
  /** The memory this observation was derived from, when there was one. */
  memoryId?: string;
  /**
   * Filed with no origin at all. Retained for the workspace's own display,
   * never shown as any conversation's context.
   */
  unattributed?: boolean;
}

export interface WorkspaceObservation {
  id: string;
  text: string;
  origin: WorkspaceObservationOrigin;
}

export interface Workspace {
  id: string;
  name: string;
  purpose: string;
  createdAt: number;
  observations: WorkspaceObservation[];
}

/** What may be listed globally: names and counts, never text. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  purpose: string;
  createdAt: number;
  observationCount: number;
}

export interface WorkspaceAccess {
  userId: string | null;
  conversationId: string | null;
  sessionId: string | null;
}

function accessFromScope(scope: MemoryScopeContext): WorkspaceAccess {
  return { userId: scope.userId, conversationId: scope.conversationId, sessionId: scope.sessionId };
}

/**
 * May this observation's TEXT be read in this turn?
 *
 * Same rule as memory: a name is discoverable, content is not. An
 * observation with no conversation belongs to nobody and is shown to no
 * conversation; it stays available for the workspace's own UI.
 */
export function isObservationVisible(observation: WorkspaceObservation, access: WorkspaceAccess): boolean {
  const origin = observation.origin;

  if (origin.unattributed) return false;
  if (origin.userId && origin.userId !== access.userId) return false;

  switch (origin.scope) {
    case "session-local":
      return Boolean(origin.sessionId) && origin.sessionId === access.sessionId;
    case "conversation-local":
    case "agent-reported":
    case "inferred":
      return Boolean(origin.conversationId) && origin.conversationId === access.conversationId;
    case "project-associated":
      // Project-scoped material is only readable where it was filed.
      return Boolean(origin.conversationId) && origin.conversationId === access.conversationId;
    case "historical":
    case "user-persistent":
    default:
      return true;
  }
}

export default class WorkspaceManager {
  private readonly workspaces = new Map<string, Workspace>();

  public create(id: string, name: string, purpose = ""): Workspace {
    const existing = this.workspaces.get(id);
    if (existing) return existing;
    const workspace: Workspace = { id, name, purpose, createdAt: Date.now(), observations: [] };
    this.workspaces.set(id, workspace);
    return workspace;
  }

  /** Create if missing — the default-workspace path. */
  public ensure(id: string, name: string, purpose = ""): Workspace {
    return this.workspaces.get(id) ?? this.create(id, name, purpose);
  }

  /**
   * File an observation. Without an origin it is treated as unattributed —
   * retained for the workspace's own display, never shown as a
   * conversation's context.
   */
  public add(
    id: string,
    text: string,
    origin: Partial<Omit<WorkspaceObservationOrigin, "workspaceId" | "createdAt">> & { workspaceId?: string } = {},
  ): WorkspaceObservation | undefined {
    const workspace = this.workspaces.get(id);
    if (!workspace) return undefined;

    const scope: WorkspaceObservationScope =
      origin.scope ?? (origin.conversationId ? "conversation-local" : "session-local");

    const observation: WorkspaceObservation = {
      id: crypto.randomUUID(),
      text,
      origin: {
        userId: origin.userId ?? null,
        conversationId: origin.conversationId ?? null,
        sessionId: origin.sessionId ?? currentSessionId(),
        workspaceId: origin.workspaceId ?? id,
        sourceType: origin.sourceType ?? "lelu-observed",
        createdAt: Date.now(),
        confidence: origin.confidence ?? 0.6,
        retention: origin.retention ?? (scope === "session-local" ? "session" : "durable"),
        scope,
        ...(origin.memoryId ? { memoryId: origin.memoryId } : {}),
        ...(!origin.conversationId && !origin.sourceType && !origin.scope ? { unattributed: true } : {}),
      },
    };

    workspace.observations.push(observation);
    // Bounded like every other in-memory cognition store.
    if (workspace.observations.length > 500) workspace.observations.shift();
    return observation;
  }

  /** Names, purposes and counts. NOT text. */
  public all(): WorkspaceSummary[] {
    return [...this.workspaces.values()].map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      purpose: workspace.purpose,
      createdAt: workspace.createdAt,
      observationCount: workspace.observations.length,
    }));
  }

  /** Authorized observation text for one workspace. */
  public itemsFor(id: string, scope: MemoryScopeContext): string[] {
    const workspace = this.workspaces.get(id);
    if (!workspace) return [];
    const access = accessFromScope(scope);
    return workspace.observations
      .filter((observation) => isObservationVisible(observation, access))
      .map((observation) => observation.text);
  }

  /** Delete one observation wherever it is filed. Returns how many went. */
  public forgetMemory(memoryId: string): number {
    let removed = 0;
    for (const workspace of this.workspaces.values()) {
      const before = workspace.observations.length;
      workspace.observations = workspace.observations.filter(
        (observation) => observation.origin.memoryId !== memoryId,
      );
      removed += before - workspace.observations.length;
    }
    return removed;
  }

  /** Delete one observation by id, wherever it is filed. */
  public forgetObservation(observationId: string): number {
    let removed = 0;
    for (const workspace of this.workspaces.values()) {
      const before = workspace.observations.length;
      workspace.observations = workspace.observations.filter(
        (observation) => observation.id !== observationId,
      );
      removed += before - workspace.observations.length;
    }
    return removed;
  }

  /**
   * Replace an observation with a corrected one. The old text is removed, not
   * kept beside the correction, so a superseded statement cannot be quoted as
   * current fact. The replacement keeps the same origin unless one is given.
   */
  public supersede(
    observationId: string,
    text: string,
    origin?: Partial<Omit<WorkspaceObservationOrigin, "workspaceId" | "createdAt">>,
  ): WorkspaceObservation | undefined {
    for (const workspace of this.workspaces.values()) {
      const previous = workspace.observations.find((observation) => observation.id === observationId);
      if (!previous) continue;
      this.forgetObservation(observationId);
      return this.add(workspace.id, text, {
        userId: origin?.userId ?? previous.origin.userId,
        conversationId: origin?.conversationId ?? previous.origin.conversationId,
        sessionId: origin?.sessionId ?? previous.origin.sessionId,
        sourceType: origin?.sourceType ?? previous.origin.sourceType,
        scope: origin?.scope ?? previous.origin.scope,
        confidence: origin?.confidence ?? previous.origin.confidence,
        retention: origin?.retention ?? previous.origin.retention,
        ...(previous.origin.memoryId ? { memoryId: previous.origin.memoryId } : {}),
      });
    }
    return undefined;
  }

  /** Delete every observation filed in a conversation. */
  public forgetConversation(conversationId: string): number {
    let removed = 0;
    for (const workspace of this.workspaces.values()) {
      const before = workspace.observations.length;
      workspace.observations = workspace.observations.filter(
        (observation) => observation.origin.conversationId !== conversationId,
      );
      removed += before - workspace.observations.length;
    }
    return removed;
  }
}
