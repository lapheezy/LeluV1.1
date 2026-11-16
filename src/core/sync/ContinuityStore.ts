/**
 * LÉLU — CONTINUITY STORE
 *
 * Durable sidecar metadata, outbox and conflict log. It extends the
 * existing KvStore authority; it is not a second database for any
 * project, conversation, knowledge or spatial record.
 */

import KvStore from "../storage/KvStore";
import {
  CONTINUITY_AUTHORITIES,
  type ContinuityAuthority,
  type ContinuityConflict,
  type ContinuityOutboxOperation,
  type ContinuityPersistedState,
  type ContinuityRecordMeta,
  type ContinuitySyncState,
  isContinuityAuthority,
} from "./ContinuityTypes";

const KEY = "continuity.sync.v1";
const MAX_OUTBOX = 2_000;
const MAX_CONFLICTS = 200;

const STATES: ContinuitySyncState[] = [
  "local_only",
  "pending_upload",
  "uploading",
  "synced",
  "pending_download",
  "conflict",
  "retry_required",
  "authentication_required",
  "cloud_unavailable",
];

function emptyState(): ContinuityPersistedState {
  return {
    version: 1,
    records: [],
    outbox: [],
    conflicts: [],
    lastError: null,
    lastProcessedAt: null,
  };
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function state(value: unknown): ContinuitySyncState {
  return typeof value === "string" && (STATES as string[]).includes(value)
    ? value as ContinuitySyncState
    : "local_only";
}

function sanitizeRecord(value: unknown): ContinuityRecordMeta | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ContinuityRecordMeta>;
  if (!isContinuityAuthority(String(record.authority)) || !record.id) return null;
  return {
    authority: record.authority as ContinuityAuthority,
    id: String(record.id),
    localRevision: Math.max(0, Math.floor(finite(record.localRevision))),
    lastSyncedRevision: Math.max(0, Math.floor(finite(record.lastSyncedRevision))),
    lastSyncedHash: nullableString(record.lastSyncedHash),
    hash: String(record.hash ?? ""),
    cloudRevision: nullableString(record.cloudRevision),
    state: state(record.state),
    updatedAt: finite(record.updatedAt),
    lastAttemptAt: record.lastAttemptAt == null ? null : finite(record.lastAttemptAt),
    lastError: nullableString(record.lastError),
  };
}

function sanitizeOperation(value: unknown): ContinuityOutboxOperation | null {
  if (!value || typeof value !== "object") return null;
  const operation = value as Partial<ContinuityOutboxOperation>;
  if (!isContinuityAuthority(String(operation.authority)) || !operation.id || !operation.recordId) return null;
  if (!operation.payload || typeof operation.payload !== "object") return null;
  return {
    id: String(operation.id),
    idempotencyKey: String(operation.idempotencyKey ?? operation.id),
    authority: operation.authority as ContinuityAuthority,
    recordId: String(operation.recordId),
    type: operation.type === "delete" ? "delete" : "upsert",
    localRevision: Math.max(0, Math.floor(finite(operation.localRevision))),
    createdAt: finite(operation.createdAt),
    attempts: Math.max(0, Math.floor(finite(operation.attempts))),
    state: state(operation.state),
    payload: operation.payload as ContinuityOutboxOperation["payload"],
    expectedCloudRevision: nullableString(operation.expectedCloudRevision),
    lastError: nullableString(operation.lastError),
    nextAttemptAt: operation.nextAttemptAt == null ? null : finite(operation.nextAttemptAt),
  };
}

function sanitizeConflict(value: unknown): ContinuityConflict | null {
  if (!value || typeof value !== "object") return null;
  const conflict = value as Partial<ContinuityConflict>;
  if (!isContinuityAuthority(String(conflict.authority)) || !conflict.id || !conflict.recordId) return null;
  return {
    id: String(conflict.id),
    authority: conflict.authority as ContinuityAuthority,
    recordId: String(conflict.recordId),
    localRevision: Math.max(0, Math.floor(finite(conflict.localRevision))),
    cloudRevision: nullableString(conflict.cloudRevision),
    local: conflict.local && typeof conflict.local === "object"
      ? conflict.local as ContinuityConflict["local"]
      : null,
    cloud: conflict.cloud && typeof conflict.cloud === "object"
      ? conflict.cloud as ContinuityConflict["cloud"]
      : null,
    detectedAt: finite(conflict.detectedAt),
    state: conflict.state === "resolved" ? "resolved" : "open",
    reason: String(conflict.reason ?? "revision mismatch"),
    resolution: conflict.resolution === "keep_local" || conflict.resolution === "keep_cloud" || conflict.resolution === "merge"
      ? conflict.resolution
      : null,
    resolvedAt: conflict.resolvedAt == null ? null : finite(conflict.resolvedAt),
  };
}

function sanitize(raw: unknown): ContinuityPersistedState {
  if (!raw || typeof raw !== "object") return emptyState();
  const value = raw as Partial<ContinuityPersistedState>;
  return {
    version: 1,
    records: Array.isArray(value.records)
      ? value.records.map(sanitizeRecord).filter((item): item is ContinuityRecordMeta => Boolean(item))
      : [],
    outbox: Array.isArray(value.outbox)
      ? value.outbox.map(sanitizeOperation).filter((item): item is ContinuityOutboxOperation => Boolean(item)).slice(-MAX_OUTBOX)
      : [],
    conflicts: Array.isArray(value.conflicts)
      ? value.conflicts.map(sanitizeConflict).filter((item): item is ContinuityConflict => Boolean(item)).slice(-MAX_CONFLICTS)
      : [],
    lastError: nullableString(value.lastError),
    lastProcessedAt: value.lastProcessedAt == null ? null : finite(value.lastProcessedAt),
  };
}

export default class ContinuityStore {
  private static instance: ContinuityStore | null = null;
  private state: ContinuityPersistedState = emptyState();
  private loaded = false;

  public static getInstance(): ContinuityStore {
    if (!ContinuityStore.instance) ContinuityStore.instance = new ContinuityStore();
    return ContinuityStore.instance;
  }

  public static reset(): void {
    ContinuityStore.instance = null;
    try {
      KvStore.getInstance().remove(KEY);
    } catch {
      // storage blocked; the next instance starts empty
    }
  }

  public getState(): ContinuityPersistedState {
    this.load();
    return this.state;
  }

  public save(next: ContinuityPersistedState): void {
    this.state = {
      ...next,
      version: 1,
      outbox: next.outbox.slice(-MAX_OUTBOX),
      conflicts: next.conflicts.slice(-MAX_CONFLICTS),
    };
    try {
      KvStore.getInstance().set(KEY, this.state);
    } catch {
      // A storage failure must not break the write that triggered continuity.
      // The in-memory state remains usable for this session.
    }
  }

  public resetInline(): void {
    this.state = emptyState();
    this.loaded = true;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.state = sanitize(KvStore.getInstance().get<unknown>(KEY));
    } catch {
      this.state = emptyState();
    }
  }
}

/** Exposed for documentation/evidence without exposing storage internals. */
export const CONTINUITY_AUTHORITY_ORDER: readonly ContinuityAuthority[] = CONTINUITY_AUTHORITIES;
