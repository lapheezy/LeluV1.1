/**
 * ==========================================================
 * LÉLU
 * VERSION HISTORY — versioned self-development + rollback
 *
 * Every meaningful experiment gets a version record and (when
 * development starts) a sandbox snapshot as its rollback point.
 * Snapshots capture the sandbox state before implementation;
 * rollback restores it. Version records hold the change
 * description, files changed, test results, known issues and
 * the rollback point — so untracked modifications can never
 * become indistinguishable from production.
 *
 * Production code is NEVER modified by this system. "Versions"
 * here version the sandbox working copy + the self-development
 * state; integration into real production happens through the
 * explicit approval boundary (the user applying a candidate).
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import SandboxFS from "../engineering/SandboxFS";

export interface SandboxSnapshot {
  id: string;
  label: string;
  createdAt: number;
  files: Record<string, { content: string; updatedAt: number }>;
}

export interface VersionRecord {
  id: string;
  /** Semver-ish label, e.g. "1.6.0". */
  version: string;
  changeDescription: string;
  filesChanged: string[];
  tests: string;
  results: string;
  performance?: string;
  knownIssues: string;
  rollbackSnapshotId?: string;
  improvementId?: string;
  createdAt: number;
}

const VERSIONS_KEY = "lelu.selfdev.versions.v1";
const SNAPSHOTS_KEY = "lelu.selfdev.snapshots.v1";
const MAX_SNAPSHOTS = 8;

export const LELU_VERSION = "1.6.0";

export default class VersionHistory {
  private static instance: VersionHistory | null = null;
  private versions: VersionRecord[];
  private snapshots: SandboxSnapshot[];

  private constructor() {
    this.versions = KvStore.getInstance().get<VersionRecord[]>(VERSIONS_KEY) ?? [];
    this.snapshots = KvStore.getInstance().get<SandboxSnapshot[]>(SNAPSHOTS_KEY) ?? [];
  }

  public static getInstance(): VersionHistory {
    if (!VersionHistory.instance) {
      VersionHistory.instance = new VersionHistory();
    }
    return VersionHistory.instance;
  }

  private persistVersions(): void {
    try {
      KvStore.getInstance().set(VERSIONS_KEY, this.versions);
    } catch {
      // best-effort
    }
  }

  private persistSnapshots(): void {
    try {
      KvStore.getInstance().set(SNAPSHOTS_KEY, this.snapshots);
    } catch {
      // best-effort
    }
  }

  public listVersions(): VersionRecord[] {
    return [...this.versions].sort((a, b) => b.createdAt - a.createdAt);
  }

  public listSnapshots(): SandboxSnapshot[] {
    return [...this.snapshots].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Snapshot the current sandbox as a rollback point. */
  public snapshotSandbox(label: string, improvementId?: string): SandboxSnapshot {
    const sandbox = SandboxFS.getInstance();
    const files = Object.fromEntries(
      sandbox.filePaths().map((path) => [path, { content: sandbox.read(path) ?? "", updatedAt: Date.now() }]),
    );
    const snapshot: SandboxSnapshot = {
      id: crypto.randomUUID(),
      label,
      createdAt: Date.now(),
      files,
    };
    this.snapshots = [snapshot, ...this.snapshots].slice(0, MAX_SNAPSHOTS);
    this.persistSnapshots();
    if (improvementId) {
      const version = this.findVersionByImprovement(improvementId);
      if (version) {
        this.updateVersion(version.id, { rollbackSnapshotId: snapshot.id });
      }
    }
    return snapshot;
  }

  /** Restore the sandbox from a snapshot — the rollback mechanism. */
  public rollback(snapshotId: string): { ok: boolean; error?: string } {
    const snapshot = this.snapshots.find((item) => item.id === snapshotId);
    if (!snapshot) {
      return { ok: false, error: "Snapshot not found." };
    }
    const sandbox = SandboxFS.getInstance();
    sandbox.reset();
    for (const [path, record] of Object.entries(snapshot.files)) {
      const result = sandbox.write(path, record.content);
      if (!result.ok) {
        return { ok: false, error: `Could not restore ${path}: ${result.error}` };
      }
    }
    return { ok: true };
  }

  public recordVersion(input: Omit<VersionRecord, "id" | "createdAt">): VersionRecord {
    const record: VersionRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    this.versions = [record, ...this.versions];
    this.persistVersions();
    return record;
  }

  public updateVersion(id: string, patch: Partial<VersionRecord>): void {
    this.versions = this.versions.map((version) => (version.id === id ? { ...version, ...patch } : version));
    this.persistVersions();
  }

  public findVersionByImprovement(improvementId: string): VersionRecord | undefined {
    return this.versions.find((version) => version.improvementId === improvementId);
  }

  public removeVersion(id: string): void {
    this.versions = this.versions.filter((version) => version.id !== id);
    this.persistVersions();
  }

  public removeSnapshot(id: string): void {
    this.snapshots = this.snapshots.filter((snapshot) => snapshot.id !== id);
    this.persistSnapshots();
  }
}
