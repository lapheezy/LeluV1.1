/**
 * ==========================================================
 * LÉLU
 * ENGINEERING WORKSPACE — isolated copies of the real project
 *
 * The client half of the workspace endpoints on the engineering
 * runtime. Every method here performs a real operation against a
 * real directory on disk; none of them reports an outcome it did
 * not receive from the server.
 *
 * The lifecycle state is DERIVED from what the backend actually
 * returned — a copy exists because the server said it created one
 * and listing it finds files, validation passed because a command
 * exited zero. Nothing here infers state from conversation.
 *
 * Credentials are not handled a second time: the base URL and the
 * runtime token come from SourceAccess, which already owns them.
 * ==========================================================
 */

import SourceAccess from "../selfdev/SourceAccess";
import AgentEventBus from "../agent/AgentEvents";
import EngineeringAuthorization from "./EngineeringAuthorization";
import SupabasePersistence from "../persistence/SupabasePersistence";

export type WorkspacePhase =
  | "no-runtime"
  | "not-copied"
  | "copied"
  | "inspected"
  | "modified"
  | "validating"
  | "validation-failed"
  | "validation-passed"
  | "awaiting-authorization"
  | "authorized"
  | "applied"
  | "failed";

export interface WorkspaceChange {
  path: string;
  status: "added" | "modified" | "deleted";
  addedLines: number;
  removedLines: number;
  /** The actual changed lines, when the diff was asked for with a patch. */
  patch?: string;
}

export interface WorkspaceRecord {
  id: string;
  root: string;
  createdAt: number;
  fileCount: number;
}

export interface WorkspaceState {
  phase: WorkspacePhase;
  workspaceId: string | null;
  fileCount: number;
  filesRead: number;
  filesChanged: number;
  changes: WorkspaceChange[];
  lastValidation: {
    operation: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
    /** Trimmed output — never a summary written by the model. */
    output: string;
  } | null;
  appliedPaths: string[];
  lastError: string | null;
  updatedAt: number;
}

type Listener = (state: WorkspaceState) => void;

const MAX_OUTPUT_CHARS = 6000;

export default class EngineeringWorkspace {
  private static instance: EngineeringWorkspace | null = null;

  private readonly source = SourceAccess.getInstance();
  private readonly events = AgentEventBus.getInstance();
  private listeners = new Set<Listener>();

  private state: WorkspaceState = {
    phase: "not-copied",
    workspaceId: null,
    fileCount: 0,
    filesRead: 0,
    filesChanged: 0,
    changes: [],
    lastValidation: null,
    appliedPaths: [],
    lastError: null,
    updatedAt: 0,
  };

  private constructor() {}

  public static getInstance(): EngineeringWorkspace {
    if (!EngineeringWorkspace.instance) {
      EngineeringWorkspace.instance = new EngineeringWorkspace();
    }
    return EngineeringWorkspace.instance;
  }

  public getState(): WorkspaceState {
    return { ...this.state, changes: [...this.state.changes] };
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch, updatedAt: Date.now() };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch {
        /* a listener must never break the workspace */
      }
    }
  }

  /* ---------------------------- transport ---------------------------- */

  /**
   * The current Supabase access token, or "".
   *
   * Sent as a bearer credential ONLY on the two routes that reach the
   * real project, so the server can establish identity itself. It is
   * never logged, never put in a prompt, and never included in a tool
   * result — the model sees the outcome of an apply, not the token that
   * authorized it.
   */
  private accessToken(): string {
    try {
      const auth = SupabasePersistence.getInstance().getAuthState();
      return auth.session?.access_token ?? "";
    } catch {
      return "";
    }
  }

  /**
   * Record a milestone against the authenticated user.
   *
   * Fire-and-forget and contained: engineering must never stall or fail
   * because cloud persistence is unavailable. With no session there is
   * no identity to attribute the row to and nothing is written — the
   * work still happens, it is just not durable.
   */
  private record(eventType: string, payload: Record<string, unknown>): void {
    void SupabasePersistence.getInstance()
      .persistEngineeringEvent(eventType, this.state.workspaceId ?? "unassigned", payload)
      .catch(() => false);
  }

  private async post(
    route: string,
    body: Record<string, unknown>,
    options: { withIdentity?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const headers = { ...this.source.headers() } as Record<string, string>;
    if (options.withIdentity) {
      const token = this.accessToken();
      if (token) headers["authorization"] = `Bearer ${token}`;
    }
    const response = await fetch(this.source.url(route), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { ok: false, error: text.slice(0, 400) || `HTTP ${response.status}` };
    }
    if (!response.ok && data.ok !== false) {
      data.ok = false;
      data.error = data.error ?? `HTTP ${response.status}`;
    }
    return data;
  }

  /* ---------------------------- operations ---------------------------- */

  /** Create a REAL copy of the project. Returns the server's own record. */
  public async createCopy(workspaceId?: string): Promise<
    { ok: true; workspace: WorkspaceRecord } | { ok: false; error: string }
  > {
    const id = workspaceId ?? `ws-${Date.now().toString(36)}`;
    const data = await this.post("/api/engineer/workspace", { action: "create", workspace: id });
    if (data.ok !== true) {
      const error = String(data.error ?? "The runtime did not create a workspace.");
      this.update({ phase: "failed", lastError: error });
      return { ok: false, error };
    }
    const workspace = data.workspace as WorkspaceRecord;
    this.record("workspace_created", { workspaceId: workspace.id, fileCount: workspace.fileCount });
    this.update({
      phase: "copied",
      workspaceId: workspace.id,
      fileCount: workspace.fileCount,
      filesRead: 0,
      filesChanged: 0,
      changes: [],
      lastValidation: null,
      appliedPaths: [],
      lastError: null,
    });
    return { ok: true, workspace };
  }

  public async listWorkspaces(): Promise<WorkspaceRecord[]> {
    const data = await this.post("/api/engineer/workspace", { action: "list" });
    return Array.isArray(data.workspaces) ? (data.workspaces as WorkspaceRecord[]) : [];
  }

  public async remove(workspaceId: string): Promise<boolean> {
    const data = await this.post("/api/engineer/workspace", { action: "remove", workspace: workspaceId });
    if (data.ok === true && this.state.workspaceId === workspaceId) {
      this.update({ phase: "not-copied", workspaceId: null, fileCount: 0, changes: [] });
    }
    return data.ok === true;
  }

  public async listDir(workspaceId: string, path = "."): Promise<
    { ok: true; entries: Array<{ name: string; path: string; type: string; size?: number }> }
    | { ok: false; error: string }
  > {
    const data = await this.post("/api/engineer/list", { workspace: workspaceId, path });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "list failed") };
    if (this.state.phase === "copied") this.update({ phase: "inspected" });
    return { ok: true, entries: (data.entries ?? []) as Array<{ name: string; path: string; type: string; size?: number }> };
  }

  public async readFile(workspaceId: string, path: string): Promise<
    { ok: true; content: string } | { ok: false; error: string }
  > {
    const data = await this.post("/api/engineer/read", { workspace: workspaceId, path });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "read failed") };
    this.update({
      filesRead: this.state.filesRead + 1,
      ...(this.state.phase === "copied" ? { phase: "inspected" as const } : {}),
    });
    return { ok: true, content: String(data.content ?? "") };
  }

  public async writeFile(workspaceId: string, path: string, content: string): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    const data = await this.post("/api/engineer/write", { workspace: workspaceId, path, content });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "write failed") };
    // filesChanged comes from the real diff, not from counting writes:
    // writing a file back to its original content changes nothing.
    await this.refreshChanges(workspaceId);
    this.update({ phase: "modified" });
    return { ok: true };
  }

  public async deleteFile(workspaceId: string, path: string): Promise<
    { ok: true } | { ok: false; error: string }
  > {
    const data = await this.post("/api/engineer/delete", { workspace: workspaceId, path });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "delete failed") };
    await this.refreshChanges(workspaceId);
    this.update({ phase: "modified" });
    return { ok: true };
  }

  /** Run a whitelisted validation command INSIDE the copy. */
  public async validate(
    workspaceId: string,
    operation: "typecheck" | "test" | "build" | "inspect",
  ): Promise<
    { ok: boolean; exitCode: number; output: string; durationMs: number } | { ok: false; error: string }
  > {
    this.update({ phase: "validating" });
    const data = await this.post("/api/engineer/command", {
      workspace: workspaceId,
      operation,
      timeoutMs: 180_000,
    });

    if (typeof data.status !== "number") {
      const error = String(data.error ?? "The runtime did not run the command.");
      this.update({ phase: "failed", lastError: error });
      return { ok: false, error };
    }

    const stdout = String(data.stdout ?? "");
    const stderr = String(data.stderr ?? "");
    const combined = `${stdout}\n${stderr}`.trim();
    const output = combined.length > MAX_OUTPUT_CHARS
      ? `${combined.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]`
      : combined;
    const ok = data.ok === true;

    this.record("validated", {
      workspaceId,
      operation,
      ok,
      exitCode: Number(data.status),
      durationMs: Number(data.durationMs ?? 0),
    });
    this.update({
      phase: ok ? "validation-passed" : "validation-failed",
      lastValidation: {
        operation,
        ok,
        exitCode: Number(data.status),
        durationMs: Number(data.durationMs ?? 0),
        output,
      },
      lastError: ok ? null : `${operation} exited ${Number(data.status)}`,
    });

    return { ok, exitCode: Number(data.status), output, durationMs: Number(data.durationMs ?? 0) };
  }

  /** The REAL difference between the copy and the source project. */
  public async diff(workspaceId: string, includePatch = false): Promise<WorkspaceChange[]> {
    return this.refreshChanges(workspaceId, includePatch);
  }

  private async refreshChanges(
    workspaceId: string,
    includePatch = false,
  ): Promise<WorkspaceChange[]> {
    const data = await this.post("/api/engineer/workspace", {
      action: "diff",
      workspace: workspaceId,
      includePatch,
    });
    const changes = Array.isArray(data.changes) ? (data.changes as WorkspaceChange[]) : [];
    this.update({ changes, filesChanged: changes.length });
    return changes;
  }

  /**
   * Prepare an apply: report exactly what would change and take the
   * server's single-use grant. This does NOT change the real project,
   * and holding the grant is not authorization — see apply().
   */
  public async requestApply(workspaceId: string): Promise<
    { ok: true; changes: WorkspaceChange[]; grant: string } | { ok: false; error: string }
  > {
    const data = await this.post(
      "/api/engineer/workspace",
      { action: "request-apply", workspace: workspaceId },
      { withIdentity: true },
    );
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "request-apply failed") };
    const changes = (data.changes ?? []) as WorkspaceChange[];
    this.update({ phase: "awaiting-authorization", changes, filesChanged: changes.length });
    return { ok: true, changes, grant: String(data.grant ?? "") };
  }

  /**
   * Apply the change set to the REAL project.
   *
   * Requires a live human authorization for this workspace. The check
   * happens here as well as in the tool layer, because a grant can
   * lapse (sign-out, lowered autonomy) between being offered and being
   * used, and the last moment before writing is the one that matters.
   */
  public async apply(workspaceId: string): Promise<
    { ok: true; applied: string[]; authorizedBy: string } | { ok: false; error: string }
  > {
    const authorization = EngineeringAuthorization.getInstance();
    const grantHeld = authorization.authorizationFor(workspaceId);
    if (!grantHeld) {
      const error =
        `Not applied: no live authorization for workspace "${workspaceId}". ` +
        authorization.preflight().reason;
      this.update({ phase: "awaiting-authorization", lastError: error });
      return { ok: false, error };
    }

    const prepared = await this.requestApply(workspaceId);
    if (!prepared.ok) return prepared;

    const data = await this.post(
      "/api/engineer/workspace",
      {
        action: "apply",
        workspace: workspaceId,
        confirm: true,
        grant: prepared.grant,
        paths: grantHeld.paths,
      },
      { withIdentity: true },
    );

    if (data.ok !== true) {
      const error = String(data.error ?? "apply failed");
      this.update({ phase: "failed", lastError: error });
      return { ok: false, error };
    }

    const applied = (data.applied ?? []) as string[];
    // The audit record of a change reaching the real project: who
    // authorized it, and exactly which files were written.
    this.record("applied", {
      workspaceId,
      applied,
      authorizedBy: grantHeld.grantedBy,
      appliedBy: String(data.appliedBy ?? grantHeld.grantedBy),
    });
    authorization.consume(workspaceId);
    this.update({ phase: "applied", appliedPaths: applied, lastError: null });

    // An audit record on the existing event bus: who authorized it, and
    // exactly which files reached the real project.
    this.events.emit({
      type: "tool_result",
      taskId: `engineering-apply-${Date.now()}`,
      tool: "workspace.apply",
      result:
        `Applied ${applied.length} file(s) to the real project, authorized by ` +
        `${grantHeld.grantedBy}: ${applied.join(", ")}`,
      results: [],
      status: "complete",
    });

    return { ok: true, applied, authorizedBy: grantHeld.grantedBy };
  }

  /**
   * Mark the project.* tools available or unavailable from the REAL
   * runtime probe.
   *
   * They are registered as unavailable, because they only work where a
   * development runtime is actually serving /api/engineer. A static
   * deployment has no such runtime, and offering the model tools that
   * cannot run is exactly what produces a claimed action that never
   * happened — so availability is a measured fact, refreshed here.
   */
  public async syncToolAvailability(): Promise<boolean> {
    const { default: ToolRegistry } = await import("../tools/ToolRegistry");
    let reachable = false;
    try {
      const status = await this.source.status();
      reachable = status.reachable === true;
    } catch {
      reachable = false;
    }
    const registry = ToolRegistry.getInstance();
    for (const id of [
      "project.copy",
      "project.list",
      "project.read",
      "project.write",
      "project.delete",
      "project.validate",
      "project.diff",
      "project.apply",
    ]) {
      registry.updateAvailability(id, reachable);
    }
    if (!reachable && this.state.phase !== "no-runtime") {
      this.update({ phase: "no-runtime" });
    } else if (reachable && this.state.phase === "no-runtime") {
      this.update({ phase: "not-copied" });
    }
    return reachable;
  }

  /** A short, factual description of the real state, for cognition. */
  public describe(): string {
    const state = this.state;
    if (!state.workspaceId) return "No project copy exists in the engineering sandbox.";
    const parts = [
      `Workspace "${state.workspaceId}" holds a copy of ${state.fileCount} file(s).`,
      `Phase: ${state.phase}.`,
      `${state.filesRead} file(s) read, ${state.filesChanged} changed.`,
    ];
    if (state.lastValidation) {
      parts.push(
        `Last validation: ${state.lastValidation.operation} exited ` +
          `${state.lastValidation.exitCode} (${state.lastValidation.ok ? "passed" : "FAILED"}).`,
      );
    }
    if (state.appliedPaths.length > 0) {
      parts.push(`Applied to the real project: ${state.appliedPaths.join(", ")}.`);
    }
    if (state.lastError) parts.push(`Last error: ${state.lastError}`);
    return parts.join(" ");
  }
}
