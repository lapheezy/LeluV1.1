/**
 * ==========================================================
 * LÉLU — CONTINUITY CONTRACT
 *
 * Mission 14.4 keeps every existing data authority exactly where
 * it is. This file describes the sidecar metadata those authorities
 * need in order to reconcile with an optional cloud copy:
 *
 *   - a local revision that advances on every real local change
 *   - the last cloud revision this device actually observed
 *   - a durable outbox operation per unsynchronised revision
 *   - an explicit conflict record instead of a silent overwrite
 *
 * The authority still owns the record. Nothing here becomes a
 * second store of projects, chats, knowledge or spatial objects.
 * ==========================================================
 */

export const CONTINUITY_AUTHORITIES = [
  "projects",
  "conversations",
  "knowledge",
  "knowledgeGraph",
  "spatialObjects",
  "cosmosNavigation",
] as const;

export type ContinuityAuthority = (typeof CONTINUITY_AUTHORITIES)[number];

export type ContinuitySyncState =
  | "local_only"
  | "pending_upload"
  | "uploading"
  | "synced"
  | "pending_download"
  | "conflict"
  | "retry_required"
  | "authentication_required"
  | "cloud_unavailable";

export type ContinuityOperationType = "upsert" | "delete";

/** A record as an authority exposes it to continuity. */
export interface ContinuityRecord {
  id: string;
  /** Monotonic local change marker. Authorities without one get this sidecar value. */
  updatedAt: number;
  data: unknown;
  /** Present only for authorities that support tombstoned deletion. */
  deleted?: boolean;
}

/** One local revision. It is never reused, even after a conflict. */
export interface ContinuityRecordMeta {
  authority: ContinuityAuthority;
  id: string;
  localRevision: number;
  lastSyncedRevision: number;
  lastSyncedHash: string | null;
  hash: string;
  cloudRevision: string | null;
  state: ContinuitySyncState;
  updatedAt: number;
  lastAttemptAt: number | null;
  lastError: string | null;
}

/** Durable work. The payload is the exact record revision being uploaded. */
export interface ContinuityOutboxOperation {
  id: string;
  idempotencyKey: string;
  authority: ContinuityAuthority;
  recordId: string;
  type: ContinuityOperationType;
  localRevision: number;
  createdAt: number;
  attempts: number;
  state: ContinuitySyncState;
  payload: ContinuityRecord;
  /** The cloud revision this upload was based on; null means "new record". */
  expectedCloudRevision: string | null;
  lastError: string | null;
  nextAttemptAt: number | null;
}

export type ContinuityConflictResolution =
  | "keep_local"
  | "keep_cloud"
  | "merge";

export interface ContinuityConflict {
  id: string;
  authority: ContinuityAuthority;
  recordId: string;
  localRevision: number;
  cloudRevision: string | null;
  local: ContinuityRecord | null;
  cloud: ContinuityRecord | null;
  detectedAt: number;
  state: "open" | "resolved";
  reason: string;
  resolution: ContinuityConflictResolution | null;
  resolvedAt: number | null;
}

export interface ContinuityPersistedState {
  version: 1;
  records: ContinuityRecordMeta[];
  outbox: ContinuityOutboxOperation[];
  conflicts: ContinuityConflict[];
  lastError: string | null;
  lastProcessedAt: number | null;
}

export interface ContinuityAuthorityStatus {
  authority: ContinuityAuthority;
  local: number;
  pending: number;
  synced: number;
  conflicts: number;
  failed: number;
  state: ContinuitySyncState;
  detail: string;
}

export interface ContinuityStatus {
  localOnly: boolean;
  pending: number;
  conflicts: number;
  failed: number;
  uploading: number;
  lastError: string | null;
  lastProcessedAt: number | null;
  authorities: ContinuityAuthorityStatus[];
}

export type ContinuityPushResult =
  | {
      status: "applied";
      cloudRevision: string;
    }
  | {
      status: "conflict";
      cloudRevision: string | null;
      remote: ContinuityRecord | null;
      reason: string;
    }
  | {
      status: "authentication_required" | "cloud_unavailable" | "retry_required";
      reason: string;
      retryAfterMs?: number;
    };

export interface ContinuityPullResult {
  records: Array<ContinuityRecord & { cloudRevision: string | null }>;
}

/**
 * The only cloud surface continuity needs. A deterministic test
 * transport and the optional Supabase transport implement the same
 * contract, so the engine cannot tell a simulation from a real
 * cloud — but every result is labelled by the transport that made it.
 */
export interface ContinuityTransport {
  readonly kind: "supabase" | "simulated";
  availability(): "ready" | "authentication_required" | "cloud_unavailable";
  push(operation: ContinuityOutboxOperation): Promise<ContinuityPushResult>;
  pull(authority: ContinuityAuthority): Promise<ContinuityPullResult>;
}

/** Stable JSON so a record's hash does not depend on key insertion order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** FNV-1a, synchronous, dependency-free and stable across reloads. */
export function continuityHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Timestamps are transport/revision markers, not record content. Two
 * devices can hold the same record with different `updatedAt` values; that
 * alone must not create a conflict or a new local revision. Nested message
 * timestamps and visit counters are also presentation/ordering metadata.
 */
const VOLATILE_CONTENT_KEYS = new Set([
  "updatedAt",
  "createdAt",
  "updated_at",
  "created_at",
  "revision",
  "timestamp",
  "visits",
  "lastVisited",
]);

function contentWithoutVolatileKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contentWithoutVolatileKeys);
  if (value === null || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!VOLATILE_CONTENT_KEYS.has(key)) output[key] = contentWithoutVolatileKeys(item);
  }
  return output;
}

/** Hash the meaningful record content, not its clock readings. */
export function continuityContentHash(data: unknown, deleted = false): string {
  return continuityHash({ data: contentWithoutVolatileKeys(data), deleted });
}

export function isContinuityAuthority(value: string): value is ContinuityAuthority {
  return (CONTINUITY_AUTHORITIES as readonly string[]).includes(value);
}

export const CONTINUITY_BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000] as const;
