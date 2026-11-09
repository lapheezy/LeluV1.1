/**
 * ==========================================================
 * LÉLU — ACQUISITION RUNTIME CLIENT
 *
 * The client half of `/api/acquisition`. Every method performs a
 * real request against a real runtime and returns the runtime's
 * own answer. Nothing is cached here and nothing is inferred.
 *
 * The base URL and access token come from SourceAccess — the same
 * one path the engineering workspace already uses, so a deployment
 * pointed at a real runtime reaches acquisition the same way.
 * ==========================================================
 */

import SourceAccess from "../selfdev/SourceAccess";
import type {
  AcquisitionLogEntry,
  AcquisitionRecord,
  RepositoryCommitSummary,
  RepositoryFileEntry,
} from "./AcquisitionTypes";

export type RuntimeResult<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface AcquisitionRuntimeStatus {
  ok: true;
  runtime: string;
  workspaceRoot: string;
  acquisitions: number;
  limits: {
    maxAcquisitions: number;
    maxRepositoryBytes: number;
    maxArchiveBytes: number;
    maxFileBytes: number;
    maxTimeoutMs: number;
  };
  identityVerification: boolean;
  tokenRequired: boolean;
  execLog: boolean;
  archiveImport: boolean;
  cloneHosts: string[];
  githubProxy: boolean;
  /** A credential is configured; validity is proven only by a real read. */
  githubCredentialConfigured?: boolean;
}

export interface ExecutionOutcome {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  operation: string;
}

export interface ApprovalGrant {
  ok: true;
  nonce: string;
  approver: string;
  scope: string;
  targetId: string;
  basis: string;
}

export default class AcquisitionRuntime {
  private static instance: AcquisitionRuntime | null = null;
  private lastError: string | null = null;
  private reachable = false;

  static getInstance(): AcquisitionRuntime {
    if (!AcquisitionRuntime.instance) {
      AcquisitionRuntime.instance = new AcquisitionRuntime();
    }
    return AcquisitionRuntime.instance;
  }

  static resetForTests(): void {
    AcquisitionRuntime.instance = null;
  }

  /** The last transport failure, for cognition to report honestly. */
  getLastError(): string | null {
    return this.lastError;
  }

  isReachable(): boolean {
    return this.reachable;
  }

  private async post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(SourceAccess.getInstance().url("/api/acquisition"), {
        method: "POST",
        headers: SourceAccess.getInstance().headers(),
        body: JSON.stringify(body),
      });
    } catch (error) {
      this.reachable = false;
      const message = `The acquisition runtime is not reachable: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.lastError = message;
      return { ok: false, error: message };
    }

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = { ok: false, error: text.slice(0, 400) || `HTTP ${response.status}` };
    }
    if (!response.ok && payload.ok !== false) {
      payload = { ok: false, error: `HTTP ${response.status}` };
    }
    this.reachable = payload.ok === true;
    this.lastError = payload.ok === true ? null : String(payload.error ?? "The acquisition runtime refused the request.");
    return payload;
  }

  /** Probe the runtime and report its real limits. */
  async status(): Promise<RuntimeResult<AcquisitionRuntimeStatus>> {
    const data = await this.post({ action: "status" });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "status failed") };
    return data as unknown as AcquisitionRuntimeStatus & { ok: true };
  }

  async list(): Promise<RuntimeResult<{ acquisitions: AcquisitionRecord[] }>> {
    const data = await this.post({ action: "list" });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "list failed") };
    return { ok: true, acquisitions: (data.acquisitions ?? []) as AcquisitionRecord[] };
  }

  async get(id: string): Promise<RuntimeResult<{ acquisition: AcquisitionRecord }>> {
    const data = await this.post({ action: "get", id });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "get failed") };
    return { ok: true, acquisition: data.acquisition as AcquisitionRecord };
  }

  async clone(input: { url: string; ref?: string }): Promise<RuntimeResult<{ acquisition: AcquisitionRecord }>> {
    const data = await this.post({ action: "clone", url: input.url, ref: input.ref ?? "" });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "clone failed") };
    return { ok: true, acquisition: data.acquisition as AcquisitionRecord };
  }

  async importArchive(input: {
    name: string;
    archiveBase64: string;
  }): Promise<RuntimeResult<{ acquisition: AcquisitionRecord }>> {
    const data = await this.post({ action: "import-archive", name: input.name, archiveBase64: input.archiveBase64 });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "import failed") };
    return { ok: true, acquisition: data.acquisition as AcquisitionRecord };
  }

  async tree(
    id: string,
    dirPath = ".",
  ): Promise<RuntimeResult<{ id: string; root: string; entries: RepositoryFileEntry[]; truncated: boolean }>> {
    const data = await this.post({ action: "tree", id, path: dirPath });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "tree failed") };
    return {
      ok: true,
      id: String(data.id ?? id),
      root: String(data.root ?? dirPath),
      entries: (data.entries ?? []) as RepositoryFileEntry[],
      truncated: data.truncated === true,
    };
  }

  async read(
    id: string,
    path: string,
  ): Promise<RuntimeResult<{ path: string; content: string; bytes: number; truncated: boolean }>> {
    const data = await this.post({ action: "read", id, path });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "read failed") };
    return {
      ok: true,
      path: String(data.path ?? path),
      content: String(data.content ?? ""),
      bytes: Number(data.bytes ?? 0),
      truncated: data.truncated === true,
    };
  }

  async write(id: string, path: string, content: string): Promise<RuntimeResult<{ path: string; bytes: number }>> {
    const data = await this.post({ action: "write", id, path, content });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "write failed") };
    return { ok: true, path: String(data.path ?? path), bytes: Number(data.bytes ?? 0) };
  }

  async exec(
    id: string,
    operation: "install" | "test" | "build" | "typecheck" | "command",
    options: { argv?: string[]; timeoutMs?: number; approval?: string } = {},
  ): Promise<RuntimeResult<{ result: ExecutionOutcome }>> {
    const data = await this.post({
      action: "exec",
      id,
      operation,
      ...(options.argv ? { argv: options.argv } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.approval ? { approval: { nonce: options.approval } } : {}),
    });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "exec failed") };
    return { ok: true, result: data.result as ExecutionOutcome };
  }

  async git<T extends Record<string, unknown>>(
    id: string,
    subaction: string,
    extra: Record<string, unknown> = {},
  ): Promise<RuntimeResult<T>> {
    const data = await this.post({ action: "git", id, subaction, ...extra });
    if (data.ok === false && typeof data.error === "string") return { ok: false, error: data.error };
    return { ok: true, ...(data as T) };
  }

  async commit(
    id: string,
    message: string,
    approval?: string,
  ): Promise<RuntimeResult<{ commit: string; branch: string; version: string | null; approver: string }>> {
    const data = await this.post({
      action: "git",
      id,
      subaction: "commit",
      message,
      ...(approval ? { approval: { nonce: approval } } : {}),
    });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "commit failed") };
    return {
      ok: true,
      commit: String(data.commit ?? ""),
      branch: String(data.branch ?? ""),
      version: data.version ? String(data.version) : null,
      approver: String(data.approver ?? ""),
    };
  }

  async createBranch(id: string, name: string): Promise<RuntimeResult<{ branch: string }>> {
    const data = await this.post({ action: "git", id, subaction: "branch", name });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "branch failed") };
    return { ok: true, branch: String(data.branch ?? name) };
  }

  async log(
    id: string,
    count = 10,
  ): Promise<RuntimeResult<{ log: string; commits: RepositoryCommitSummary[] }>> {
    const data = await this.post({ action: "git", id, subaction: "log", count });
    if (data.ok === false) return { ok: false, error: String(data.error ?? "log failed") };
    const log = String(data.log ?? "");
    const commits = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", author = "", date = "", ...rest] = line.split("\t");
        return { sha, author, date, message: rest.join("\t") };
      });
    return { ok: true, log, commits };
  }

  async diff(id: string, full = false): Promise<RuntimeResult<{ stat: string; patch: string }>> {
    const data = await this.post({ action: "git", id, subaction: "diff", full });
    if (data.ok === false) return { ok: false, error: String(data.error ?? "diff failed") };
    return { ok: true, stat: String(data.stat ?? ""), patch: String(data.patch ?? "") };
  }

  async rollback(
    id: string,
    version: string,
    approval: string,
  ): Promise<RuntimeResult<{ version: string; commit: string; approver: string }>> {
    const data = await this.post({ action: "rollback", id, version, approval: { nonce: approval } });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "rollback failed") };
    return {
      ok: true,
      version: String(data.version ?? version),
      commit: String(data.commit ?? ""),
      approver: String(data.approver ?? ""),
    };
  }

  async remove(id: string, approval: string): Promise<RuntimeResult<{ approver: string }>> {
    const data = await this.post({ action: "delete", id, approval: { nonce: approval } });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "delete failed") };
    return { ok: true, approver: String(data.approver ?? "") };
  }

  async logs(id: string, limit = 50): Promise<RuntimeResult<{ entries: AcquisitionLogEntry[] }>> {
    const data = await this.post({ action: "logs", id, limit });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "logs failed") };
    return { ok: true, entries: (data.entries ?? []) as AcquisitionLogEntry[] };
  }

  async update(
    id: string,
    patch: { status?: string; capability?: string; notes?: string[] },
  ): Promise<RuntimeResult<{ acquisition: AcquisitionRecord }>> {
    const data = await this.post({ action: "update", id, ...patch });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "update failed") };
    return { ok: true, acquisition: data.acquisition as AcquisitionRecord };
  }

  /** Ask the runtime for a single-use approval grant for a scoped action. */
  async approve(input: {
    scope: string;
    targetId: string;
  }): Promise<RuntimeResult<ApprovalGrant>> {
    const data = await this.post({ action: "approve", ...input });
    if (data.ok !== true) return { ok: false, error: String(data.error ?? "approval refused") };
    return data as unknown as ApprovalGrant & { ok: true };
  }

  /**
   * Server-side GitHub read. Used so repository research does not need
   * a GitHub token in the browser bundle.
   */
  async github<T>(path: string): Promise<T> {
    const data = await this.post({ action: "github", path });
    if (data.ok !== true) throw new Error(String(data.error ?? "GitHub proxy failed"));
    return data.data as T;
  }
}
