/**
 * LÉLU — CONTINUITY SIGNALS
 *
 * The existing authorities own their writes. They report what
 * changed, and whether the change came from this device or from a
 * cloud reconciliation. The continuity engine subscribes here.
 *
 * This module deliberately imports no store and no client, so a
 * store can report a local write without creating an import cycle
 * through the synchronization engine.
 */

import type { ContinuityAuthority, ContinuityRecord } from "./ContinuityTypes";

export type ContinuitySignalOrigin = "local" | "remote";

export interface ContinuitySignal {
  authority: ContinuityAuthority;
  origin: ContinuitySignalOrigin;
  records: ContinuityRecord[];
  /** Cloud revision that produced a remote signal, when known. */
  cloudRevision?: string | null;
  at: number;
}

type Listener = (signal: ContinuitySignal) => void;

const listeners = new Set<Listener>();

function cloneRecord(record: ContinuityRecord): ContinuityRecord {
  return {
    ...record,
    ...(record.deleted !== undefined ? { deleted: record.deleted } : {}),
  };
}

/**
 * Report a change after it has been committed locally. This must
 * never throw into the authority's write path.
 */
export function noteContinuityChange(
  authority: ContinuityAuthority,
  origin: ContinuitySignalOrigin,
  records: ContinuityRecord[],
  cloudRevision: string | null = null,
): void {
  if (records.length === 0) return;
  const signal: ContinuitySignal = {
    authority,
    origin,
    records: records.map(cloneRecord),
    cloudRevision,
    at: Date.now(),
  };
  for (const listener of listeners) {
    try {
      listener(signal);
    } catch {
      // A continuity observer must not break a project/chat/spatial write.
    }
  }
}

export function subscribeContinuitySignals(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test/reset seam. Production never needs to clear the observer set. */
export function clearContinuitySignals(): void {
  listeners.clear();
}
