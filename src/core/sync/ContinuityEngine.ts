/**
 * ==========================================================
 * LÉLU — LOCAL-FIRST CONTINUITY ENGINE
 *
 * Local writes are already immediate and canonical. This engine
 * only records what changed, keeps that work in a durable outbox,
 * and — when an authenticated cloud is actually available — asks
 * a transport to apply the exact revision it observed.
 *
 * It does not subscribe to a cloud client directly, does not
 * block a local write, and never reports `synced` without a
 * transport acknowledgement for that exact local revision.
 * ==========================================================
 */

import {
  CONTINUITY_BACKOFF_MS,
  continuityContentHash,
  type ContinuityAuthority,
  type ContinuityConflict,
  type ContinuityConflictResolution,
  type ContinuityOutboxOperation,
  type ContinuityPersistedState,
  type ContinuityPushResult,
  type ContinuityRecord,
  type ContinuityRecordMeta,
  type ContinuityStatus,
  type ContinuitySyncState,
  type ContinuityTransport,
} from "./ContinuityTypes";
import ContinuityStore from "./ContinuityStore";
import { AUTHORITY_ADAPTERS, adapterFor } from "./AuthorityAdapters";
import {
  subscribeContinuitySignals,
  noteContinuityChange,
  type ContinuitySignal,
} from "./ContinuitySignals";

type EngineListener = () => void;

const MAX_BATCH = 20;

function now(): number {
  return Date.now();
}

function recordHash(record: ContinuityRecord): string {
  return continuityContentHash(record.data, record.deleted === true);
}

function sameRevision(a: number, b: number): boolean {
  return a === b;
}

export interface ContinuityEngineOptions {
  transport?: ContinuityTransport | null;
  autoProcess?: boolean;
}

export interface ContinuityResolutionResult {
  ok: boolean;
  detail: string;
  conflict?: ContinuityConflict;
}

export default class ContinuityEngine {
  private static instance: ContinuityEngine | null = null;

  private state: ContinuityPersistedState;
  private transport: ContinuityTransport | null = null;
  private started = false;
  private processing = false;
  private unsubscribeSignals: (() => void) | null = null;
  private listeners = new Set<EngineListener>();

  private constructor() {
    this.state = ContinuityStore.getInstance().getState();
  }

  public static getInstance(): ContinuityEngine {
    if (!ContinuityEngine.instance) ContinuityEngine.instance = new ContinuityEngine();
    return ContinuityEngine.instance;
  }

  /** Test seam: drop the singleton without deleting durable user data. */
  public static resetForTests(): void {
    ContinuityEngine.instance?.stop();
    ContinuityEngine.instance = null;
  }

  public setTransport(transport: ContinuityTransport | null): void {
    this.transport = transport;
  }

  public start(options: ContinuityEngineOptions = {}): void {
    if (this.started) {
      if (options.transport !== undefined) this.transport = options.transport;
      return;
    }
    this.started = true;
    if (options.transport !== undefined) this.transport = options.transport;
    this.state = ContinuityStore.getInstance().getState();
    this.unsubscribeSignals = subscribeContinuitySignals((signal) => this.onSignal(signal));
    this.seedFromAuthorities();
    this.save();
    if (options.autoProcess) void this.processOutbox();
  }

  public stop(): void {
    this.unsubscribeSignals?.();
    this.unsubscribeSignals = null;
    this.started = false;
  }

  public subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // status listeners are advisory
      }
    }
  }

  private save(): void {
    ContinuityStore.getInstance().save(this.state);
    this.notify();
  }

  private findMeta(authority: ContinuityAuthority, id: string): ContinuityRecordMeta | undefined {
    return this.state.records.find((record) => record.authority === authority && record.id === id);
  }

  private createMeta(authority: ContinuityAuthority, record: ContinuityRecord): ContinuityRecordMeta {
    return {
      authority,
      id: record.id,
      localRevision: 1,
      lastSyncedRevision: 0,
      lastSyncedHash: null,
      hash: recordHash(record),
      cloudRevision: null,
      state: "local_only",
      updatedAt: record.updatedAt,
      lastAttemptAt: null,
      lastError: null,
    };
  }

  private openConflict(authority: ContinuityAuthority, id: string): ContinuityConflict | undefined {
    return this.state.conflicts.find((conflict) =>
      conflict.state === "open" && conflict.authority === authority && conflict.recordId === id);
  }

  private seedFromAuthorities(): void {
    for (const adapter of AUTHORITY_ADAPTERS) {
      for (const record of adapter.read()) {
        const meta = this.findMeta(adapter.authority, record.id);
        if (!meta) {
          const created = this.createMeta(adapter.authority, record);
          this.state.records.push(created);
          this.enqueue(adapter.authority, record, created);
          continue;
        }
        // A write that happened while the engine was stopped is still a
        // local change. Compare the content, not only timestamps.
        if (meta.hash !== recordHash(record)) {
          this.observeLocalRecord(adapter.authority, record, meta);
        }
      }
    }
  }

  private onSignal(signal: ContinuitySignal): void {
    if (signal.origin === "remote") {
      this.observeRemoteSignal(signal);
      return;
    }
    let changed = false;
    for (const record of signal.records) {
      const meta = this.findMeta(signal.authority, record.id);
      if (!meta) {
        const created = this.createMeta(signal.authority, record);
        this.state.records.push(created);
        this.enqueue(signal.authority, record, created);
        changed = true;
      } else if (this.observeLocalRecord(signal.authority, record, meta)) {
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private observeLocalRecord(
    authority: ContinuityAuthority,
    record: ContinuityRecord,
    meta: ContinuityRecordMeta,
  ): boolean {
    const hash = recordHash(record);
    // Re-reporting the same content is not a new revision. This matters
    // because a store signals its full snapshot, not a delta.
    if (meta.hash === hash) return false;

    const conflict = this.openConflict(authority, record.id);
    meta.localRevision += 1;
    meta.hash = hash;
    meta.updatedAt = record.updatedAt;
    meta.lastError = null;
    if (conflict) {
      conflict.local = record;
      meta.state = "conflict";
    } else {
      meta.state = "pending_upload";
      this.enqueue(authority, record, meta);
    }
    return true;
  }

  private enqueue(
    authority: ContinuityAuthority,
    record: ContinuityRecord,
    meta: ContinuityRecordMeta,
    ignoreOpenConflict = false,
  ): void {
    if (!ignoreOpenConflict && this.openConflict(authority, record.id)) return;
    const id = `${authority}:${record.id}:r${meta.localRevision}`;
    if (this.state.outbox.some((operation) => operation.id === id)) return;
    // A newer local revision supersedes an operation that has not started.
    // An in-flight operation is left alone; its stale acknowledgement is
    // discarded when it returns.
    this.state.outbox = this.state.outbox.filter((operation) =>
      operation.authority !== authority ||
      operation.recordId !== record.id ||
      operation.state === "uploading" ||
      operation.localRevision >= meta.localRevision);
    this.state.outbox.push({
      id,
      idempotencyKey: id,
      authority,
      recordId: record.id,
      type: record.deleted ? "delete" : "upsert",
      localRevision: meta.localRevision,
      createdAt: now(),
      attempts: 0,
      state: "pending_upload",
      payload: record,
      expectedCloudRevision: meta.cloudRevision,
      lastError: null,
      nextAttemptAt: null,
    });
  }

  private observeRemoteSignal(signal: ContinuitySignal): void {
    let changed = false;
    for (const record of signal.records) {
      const meta = this.findMeta(signal.authority, record.id);
      const hash = recordHash(record);
      if (!meta) {
        const created = this.createMeta(signal.authority, record);
        created.state = "synced";
        created.lastSyncedRevision = created.localRevision;
        created.lastSyncedHash = hash;
        created.cloudRevision = signal.cloudRevision ?? null;
        this.state.records.push(created);
        changed = true;
        continue;
      }
      if (this.openConflict(signal.authority, record.id)) continue;
      meta.hash = hash;
      meta.lastSyncedRevision = meta.localRevision;
      meta.lastSyncedHash = hash;
      meta.cloudRevision = signal.cloudRevision ?? meta.cloudRevision;
      meta.state = "synced";
      meta.updatedAt = record.updatedAt;
      meta.lastError = null;
      this.state.outbox = this.state.outbox.filter((operation) =>
        operation.authority !== signal.authority || operation.recordId !== record.id);
      changed = true;
    }
    if (changed) this.save();
  }

  public pending(): ContinuityOutboxOperation[] {
    return this.state.outbox.map((operation) => ({ ...operation }));
  }

  public conflicts(includeResolved = false): ContinuityConflict[] {
    return this.state.conflicts
      .filter((conflict) => includeResolved || conflict.state === "open")
      .map((conflict) => ({ ...conflict }));
  }

  public status(): ContinuityStatus {
    const authorities = AUTHORITY_ADAPTERS.map((adapter) => {
      const records = this.state.records.filter((record) => record.authority === adapter.authority);
      const open = this.state.conflicts.filter((conflict) =>
        conflict.state === "open" && conflict.authority === adapter.authority);
      const pending = this.state.outbox.filter((operation) =>
        operation.authority === adapter.authority).length;
      const synced = records.filter((record) => record.state === "synced").length;
      const failed = records.filter((record) =>
        record.state === "retry_required" ||
        record.state === "authentication_required" ||
        record.state === "cloud_unavailable").length;
      const state = open.length > 0
        ? "conflict"
        : pending > 0
          ? records.find((record) => record.state !== "synced" && record.state !== "local_only")?.state ?? "pending_upload"
          : records.length > 0 && synced === records.length
            ? "synced"
            : "local_only";
      return {
        authority: adapter.authority,
        local: records.length,
        pending,
        synced,
        conflicts: open.length,
        failed,
        state: state as ContinuitySyncState,
        detail: open.length > 0
          ? `${open.length} unresolved conflict(s); local data remains authoritative.`
          : pending > 0
            ? `${pending} operation(s) waiting for an authenticated cloud.`
            : synced === records.length && records.length > 0
              ? "Local and cloud revisions agree."
              : "Local authority; no cloud revision has been acknowledged.",
      };
    });
    const pending = this.state.outbox.length;
    const conflicts = this.state.conflicts.filter((conflict) => conflict.state === "open").length;
    const failed = this.state.records.filter((record) =>
      record.state === "retry_required" ||
      record.state === "authentication_required" ||
      record.state === "cloud_unavailable").length;
    return {
      localOnly: pending > 0 || conflicts > 0,
      pending,
      conflicts,
      failed,
      uploading: this.state.outbox.filter((operation) => operation.state === "uploading").length,
      lastError: this.state.lastError,
      lastProcessedAt: this.state.lastProcessedAt,
      authorities,
    };
  }

  public async processOutbox(): Promise<ContinuityStatus> {
    if (this.processing) return this.status();
    if (!this.transport) {
      this.state.lastError = "No continuity transport is configured; local operation continues.";
      this.save();
      return this.status();
    }
    const availability = this.transport.availability();
    if (availability !== "ready") {
      this.markUnavailable(availability);
      return this.status();
    }

    this.processing = true;
    try {
      const eligible = this.state.outbox
        .filter((operation) =>
          operation.state !== "uploading" &&
          (!operation.nextAttemptAt || operation.nextAttemptAt <= now()))
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, MAX_BATCH);

      for (const operation of eligible) {
        const meta = this.findMeta(operation.authority, operation.recordId);
        if (!meta) {
          this.removeOperation(operation.id);
          continue;
        }
        if (meta.state === "conflict" || this.openConflict(operation.authority, operation.recordId)) {
          this.removeOperation(operation.id);
          continue;
        }
        if (operation.localRevision < meta.localRevision) {
          // A newer local revision is already queued. Never upload stale work.
          this.removeOperation(operation.id);
          continue;
        }

        operation.state = "uploading";
        operation.attempts += 1;
        operation.lastError = null;
        meta.state = "uploading";
        meta.lastAttemptAt = now();
        this.save();

        let result: ContinuityPushResult;
        try {
          result = await this.transport.push(operation);
        } catch (error) {
          result = {
            status: "retry_required",
            reason: error instanceof Error ? error.message : String(error),
          };
        }

        if (result.status === "applied") {
          // An acknowledgement is only meaningful for the revision the
          // transport actually saw. A newer local edit keeps its outbox entry.
          if (sameRevision(meta.localRevision, operation.localRevision)) {
            meta.state = "synced";
            meta.lastSyncedRevision = operation.localRevision;
            meta.lastSyncedHash = meta.hash;
            meta.cloudRevision = result.cloudRevision;
            meta.lastError = null;
            this.removeOperation(operation.id);
          } else {
            this.removeOperation(operation.id);
          }
          this.state.lastError = null;
        } else if (result.status === "conflict") {
          this.recordConflict(operation, meta, result);
        } else if (result.status === "authentication_required") {
          operation.state = "authentication_required";
          operation.lastError = result.reason;
          meta.state = "authentication_required";
          meta.lastError = result.reason;
          this.state.lastError = result.reason;
          this.save();
          break;
        } else if (result.status === "cloud_unavailable") {
          operation.state = "cloud_unavailable";
          operation.lastError = result.reason;
          meta.state = "cloud_unavailable";
          meta.lastError = result.reason;
          this.state.lastError = result.reason;
          this.save();
          break;
        } else {
          const delay = result.retryAfterMs ?? CONTINUITY_BACKOFF_MS[Math.min(operation.attempts - 1, CONTINUITY_BACKOFF_MS.length - 1)];
          operation.state = "retry_required";
          operation.lastError = result.reason;
          operation.nextAttemptAt = now() + Math.max(250, delay);
          meta.state = "retry_required";
          meta.lastError = result.reason;
          this.state.lastError = result.reason;
          this.save();
          break;
        }
      }
      this.state.lastProcessedAt = now();
      this.save();
      return this.status();
    } finally {
      this.processing = false;
    }
  }

  /**
   * Pull then push. Pulling first means a remote change is compared with
   * the last successfully synchronized revision before any upload can
   * overwrite it.
   */
  public async synchronize(): Promise<ContinuityStatus> {
    if (!this.transport) {
      this.state.lastError = "No continuity transport is configured; local operation continues.";
      this.save();
      return this.status();
    }
    const availability = this.transport.availability();
    if (availability !== "ready") {
      this.markUnavailable(availability);
      return this.status();
    }
    await this.pullAll();
    return this.processOutbox();
  }

  private markUnavailable(availability: "authentication_required" | "cloud_unavailable"): void {
    const detail = availability === "authentication_required"
      ? "An authenticated cloud session is required; pending local changes are preserved."
      : "Cloud access is unavailable; local operation and pending changes continue.";
    for (const operation of this.state.outbox) {
      if (operation.state === "uploading" || operation.state === "pending_upload" || operation.state === "retry_required") {
        operation.state = availability;
        operation.lastError = detail;
      }
    }
    for (const record of this.state.records) {
      if (record.state === "uploading" || record.state === "pending_upload" || record.state === "retry_required") {
        record.state = availability;
        record.lastError = detail;
      }
    }
    this.state.lastError = detail;
    this.save();
  }

  private async pullAll(): Promise<void> {
    if (!this.transport) return;
    for (const adapter of AUTHORITY_ADAPTERS) {
      let result;
      try {
        result = await this.transport.pull(adapter.authority);
      } catch (error) {
        this.state.lastError = error instanceof Error ? error.message : String(error);
        continue;
      }
      for (const remote of result.records) {
        const local = adapter.read().find((record) => record.id === remote.id) ?? null;
        const meta = this.findMeta(adapter.authority, remote.id);
        if (!meta) {
          adapter.apply(remote, { force: true });
          // The authority reports the applied record through a remote
          // signal, which may already have created this metadata. Reuse it
          // instead of creating a second entry for the same record.
          const applied = this.findMeta(adapter.authority, remote.id) ?? this.createMeta(adapter.authority, remote);
          applied.hash = recordHash(remote);
          applied.state = "synced";
          applied.lastSyncedRevision = applied.localRevision;
          applied.lastSyncedHash = applied.hash;
          applied.cloudRevision = remote.cloudRevision;
          if (!this.state.records.includes(applied)) this.state.records.push(applied);
          continue;
        }
        if (this.openConflict(adapter.authority, remote.id)) continue;
        const remoteHash = recordHash(remote);
        const localChanged = !sameRevision(meta.localRevision, meta.lastSyncedRevision) ||
          (meta.lastSyncedHash !== null && meta.hash !== meta.lastSyncedHash);
        const remoteChanged = remote.cloudRevision !== null && remote.cloudRevision !== meta.cloudRevision;
        if (!localChanged && remoteChanged) {
          adapter.apply(remote, { force: true });
          meta.hash = remoteHash;
          meta.lastSyncedRevision = meta.localRevision;
          meta.lastSyncedHash = remoteHash;
          meta.cloudRevision = remote.cloudRevision;
          meta.state = "synced";
          meta.lastError = null;
        } else if (localChanged && remoteChanged && remoteHash !== meta.lastSyncedHash && remoteHash !== meta.hash) {
          this.recordConflictFromRecords(adapter.authority, local, remote, meta, remote.cloudRevision,
            "Local and cloud revisions both changed since the last synchronization.");
        } else if (localChanged && remoteHash === meta.lastSyncedHash) {
          // The cloud still has the last synchronized value; the local
          // revision is safe to upload against that expected revision.
          meta.cloudRevision = remote.cloudRevision;
        }
      }
    }
    this.save();
  }

  private recordConflict(
    operation: ContinuityOutboxOperation,
    meta: ContinuityRecordMeta,
    result: Extract<ContinuityPushResult, { status: "conflict" }>,
  ): void {
    this.recordConflictFromRecords(
      operation.authority,
      operation.payload,
      result.remote,
      meta,
      result.cloudRevision,
      result.reason,
    );
    this.removeOperation(operation.id);
  }

  private recordConflictFromRecords(
    authority: ContinuityAuthority,
    local: ContinuityRecord | null,
    cloud: ContinuityRecord | null,
    meta: ContinuityRecordMeta,
    cloudRevision: string | null,
    reason: string,
  ): void {
    const existing = this.openConflict(authority, meta.id);
    if (existing) {
      existing.local = local;
      existing.cloud = cloud;
      existing.cloudRevision = cloudRevision;
      existing.reason = reason;
      meta.state = "conflict";
      meta.lastError = reason;
      this.state.lastError = reason;
      this.state.outbox = this.state.outbox.filter((operation) =>
        operation.authority !== authority || operation.recordId !== meta.id);
      this.save();
      return;
    }
    this.state.conflicts.push({
      id: `conflict:${authority}:${meta.id}:${meta.localRevision}:${cloudRevision ?? "none"}`,
      authority,
      recordId: meta.id,
      localRevision: meta.localRevision,
      cloudRevision,
      local,
      cloud,
      detectedAt: now(),
      state: "open",
      reason,
      resolution: null,
      resolvedAt: null,
    });
    meta.state = "conflict";
    meta.lastError = reason;
    this.state.lastError = reason;
    this.state.outbox = this.state.outbox.filter((operation) =>
      operation.authority !== authority || operation.recordId !== meta.id);
    this.save();
  }

  private removeOperation(id: string): void {
    this.state.outbox = this.state.outbox.filter((operation) => operation.id !== id);
  }

  /**
   * Resolve one conflict. The caller must choose; this method never
   * guesses between two real versions.
   */
  public resolveConflict(
    conflicts: ContinuityConflict[],
    id: string,
    resolution: ContinuityConflictResolution,
  ): ContinuityResolutionResult {
    // Resolve the live record, not the caller's copy: the caller usually
    // passes a snapshot for display, and mutating that copy would leave the
    // durable conflict open while reporting success.
    const conflict = this.state.conflicts.find((item) => item.id === id) ?? conflicts.find((item) => item.id === id);
    if (!conflict) return { ok: false, detail: `No conflict "${id}".` };
    if (conflict.state !== "open") return { ok: false, detail: `Conflict "${id}" is already resolved.` };
    const adapter = adapterFor(conflict.authority);
    const meta = this.findMeta(conflict.authority, conflict.recordId);
    if (!meta) return { ok: false, detail: "The conflict has no local revision metadata." };

    if (resolution === "keep_cloud") {
      if (!conflict.cloud) {
        return { ok: false, detail: "The cloud version is a deletion; choose keep_local or merge explicitly." };
      }
      adapter.apply(conflict.cloud, { force: true });
      meta.localRevision += 1;
      meta.hash = recordHash(conflict.cloud);
      meta.lastSyncedRevision = meta.localRevision;
      meta.lastSyncedHash = meta.hash;
      meta.cloudRevision = conflict.cloudRevision;
      meta.state = "synced";
      meta.lastError = null;
    } else if (resolution === "keep_local") {
      if (!conflict.local) return { ok: false, detail: "The local version is not available." };
      meta.localRevision += 1;
      meta.hash = recordHash(conflict.local);
      // The next upload is conditional on the cloud revision that caused
      // the conflict, never on a guessed or last-writer timestamp.
      meta.cloudRevision = conflict.cloudRevision;
      meta.state = "pending_upload";
      meta.lastError = null;
      this.enqueue(conflict.authority, conflict.local, meta, true);
    } else {
      const merged = conflict.local && conflict.cloud
        ? adapter.merge(conflict.local, conflict.cloud)
        : null;
      if (!merged) {
        return {
          ok: false,
          detail: "No safe automatic merge exists for this authority; choose keep_local or keep_cloud.",
        };
      }
      adapter.apply(merged, { force: true });
      meta.localRevision += 1;
      meta.hash = recordHash(merged);
      meta.cloudRevision = conflict.cloudRevision;
      meta.state = "pending_upload";
      meta.lastError = null;
      this.enqueue(conflict.authority, merged, meta, true);
    }

    conflict.state = "resolved";
    conflict.resolution = resolution;
    conflict.resolvedAt = now();
    this.save();
    return {
      ok: true,
      detail: `Conflict ${id} resolved with ${resolution}; the chosen revision is ${meta.state}.`,
      conflict: { ...conflict },
    };
  }

  /** Evidence snapshot; stable JSON, no secret material. */
  public evidence(): Record<string, unknown> {
    return {
      status: this.status(),
      records: this.state.records.map((record) => ({ ...record })),
      outbox: this.state.outbox.map((operation) => ({
        id: operation.id,
        authority: operation.authority,
        recordId: operation.recordId,
        localRevision: operation.localRevision,
        type: operation.type,
        state: operation.state,
        attempts: operation.attempts,
        expectedCloudRevision: operation.expectedCloudRevision,
        lastError: operation.lastError,
      })),
      conflicts: this.state.conflicts.map((conflict) => ({
        id: conflict.id,
        authority: conflict.authority,
        recordId: conflict.recordId,
        localRevision: conflict.localRevision,
        cloudRevision: conflict.cloudRevision,
        state: conflict.state,
        reason: conflict.reason,
        resolution: conflict.resolution,
      })),
    };
  }
}

/** Explicitly mark a local revision after an authority used the engine directly. */
export function noteLocalContinuity(
  authority: ContinuityAuthority,
  records: ContinuityRecord[],
): void {
  noteContinuityChange(authority, "local", records);
}
