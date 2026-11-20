/**
 * ==========================================================
 * LÉLU
 * MEMORY DELETION LEDGER
 *
 * When a memory is deleted, the record is gone — which is the
 * point. But "gone" has to be verifiable later: a checkpoint, a
 * project note or a summary written before the deletion can still
 * quote the statement, and once the record is gone nothing in the
 * system can tell whether a given sentence *was* a deleted memory.
 *
 * This ledger keeps exactly enough to answer that question and
 * nothing more:
 *
 *   - the memory id, when it was deleted, and which conversation
 *     it came from (provenance, for audit);
 *   - hashes of overlapping token windows from the statement.
 *
 * It never stores the statement, any token, or a reversible form
 * of it. A match on a 6-token window is evidence that a text quotes
 * the deleted statement; the window itself cannot be read back.
 *
 * The ledger is append-only, bounded, and idempotent per id.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export const DELETION_LEDGER_KEY = "memory.deletions.v1";

/**
 * Deletions the cloud has not confirmed yet (M22.7).
 *
 * Kept beside the ledger rather than in a second authority: the same tombstone,
 * waiting for the remote copy to catch up. Bounded, retried with backoff, and
 * never silently dropped — a deletion that was never confirmed stays visible
 * in the integrity status instead of being reported as finished.
 */
export const DELETION_OUTBOX_KEY = "memory.deletions.outbox.v1";

/** How many unconfirmed deletions are remembered. */
const MAX_OUTBOX = 200;
/** Attempts before a remote deletion stops being retried automatically. */
export const MAX_REMOTE_ATTEMPTS = 8;

/** How many consecutive tokens make a fingerprint. */
const WINDOW = 6;
/** Windows kept per deleted memory — the head of the statement is what gets quoted. */
const MAX_WINDOWS = 48;
/** Below this many tokens a window is too generic to identify anything. */
const MIN_TOKENS = 4;
/** Bound the ledger so it cannot grow without limit. */
const MAX_ENTRIES = 400;

export interface RemoteDeletion {
  /** The deleted memory's id. */
  id: string;
  /** Fingerprint hash to send with it — never the statement. */
  fingerprint: string;
  /** When it was first queued. */
  at: number;
  /** Failed attempts so far; bounded so retries cannot loop forever. */
  attempts: number;
  /** Short upstream reason from the last attempt, for the status surface. */
  lastError: string | null;
}

export interface DeletionTombstone {
  /** The deleted memory's id. */
  id: string;
  /** When the deletion happened. */
  at: number;
  /** The conversation the memory came from, when known. */
  conversationId: string | null;
  /** Token windows the statement was made of (hashed). */
  windows: string[];
  /** Window size used; equal to the token count when the text is short. */
  size: number;
  /** Token count of the statement, for auditing without the text. */
  tokens: number;
}

/** Normalize to the same token stream the fingerprints use. */
export function residueTokens(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/gu)
    .filter((token) => token.length > 0);
}

function hash(window: string): string {
  // FNV-1a, 32-bit. Only used to compare windows, never for security.
  let value = 0x811c9dc5;
  for (let i = 0; i < window.length; i += 1) {
    value ^= window.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}

/** Fingerprint a statement: its overlapping token windows, hashed. */
export function fingerprintStatement(text: string): { windows: string[]; size: number; tokens: number } {
  const tokens = residueTokens(text);
  if (tokens.length < MIN_TOKENS) {
    return { windows: [], size: 0, tokens: tokens.length };
  }
  const size = Math.min(WINDOW, tokens.length);
  const windows: string[] = [];
  for (let i = 0; i + size <= tokens.length && windows.length < MAX_WINDOWS; i += 1) {
    windows.push(hash(tokens.slice(i, i + size).join(" ")));
  }
  return { windows: [...new Set(windows)], size, tokens: tokens.length };
}

/**
 * Fingerprints flipped into a lookup table once, instead of rebuilt per field.
 *
 * `matchTombstone` below already answered the question correctly, but it did so
 * by grouping every tombstone for every piece of text it was asked about — so a
 * 1,000-project scan rebuilt the same maps a few thousand times. The migration,
 * the boot healer and recall protection all ask the same question, so they now
 * build this index once per run (M22.6, WP06).
 */
export interface TombstoneIndex {
  /** Window size → (window hash → the tombstone that owns it). */
  bySize: Map<number, Map<string, DeletionTombstone>>;
}

export function buildTombstoneIndex(tombstones: DeletionTombstone[]): TombstoneIndex {
  const bySize = new Map<number, Map<string, DeletionTombstone>>();
  for (const tombstone of tombstones) {
    if (tombstone.windows.length === 0) continue;
    let group = bySize.get(tombstone.size);
    if (!group) {
      group = new Map<string, DeletionTombstone>();
      bySize.set(tombstone.size, group);
    }
    for (const window of tombstone.windows) {
      if (!group.has(window)) group.set(window, tombstone);
    }
  }
  return { bySize };
}

/** Same answer as `matchTombstone`, without rebuilding the lookup per text. */
export function matchTombstoneIndex(
  text: string,
  index: TombstoneIndex,
): DeletionTombstone | undefined {
  if (!text.trim() || index.bySize.size === 0) return undefined;
  const tokens = residueTokens(text);
  for (const [size, group] of index.bySize) {
    if (tokens.length < size) continue;
    for (let i = 0; i + size <= tokens.length; i += 1) {
      const tombstone = group.get(hash(tokens.slice(i, i + size).join(" ")));
      if (tombstone) return tombstone;
    }
  }
  return undefined;
}

/** Does this text quote any of the tombstones? Returns the matching tombstone, if any. */
export function matchTombstone(
  text: string,
  tombstones: DeletionTombstone[],
): DeletionTombstone | undefined {
  return matchTombstoneIndex(text, buildTombstoneIndex(tombstones));
}

export default class DeletionLedger {
  private static instance: DeletionLedger | null = null;

  private readonly kv = KvStore.getInstance();

  public static getInstance(): DeletionLedger {
    if (!DeletionLedger.instance) {
      DeletionLedger.instance = new DeletionLedger();
    }
    return DeletionLedger.instance;
  }

  public entries(): DeletionTombstone[] {
    const stored = this.kv.get<DeletionTombstone[]>(DELETION_LEDGER_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  /**
   * Record a deletion. Called with the record in hand, before it is removed,
   * so the fingerprints are of what was actually stored. Re-deleting the same
   * id replaces its entry rather than duplicating it.
   */
  public record(entry: {
    id: string;
    text: string;
    conversationId?: string | null;
    at?: number;
  }): DeletionTombstone | undefined {
    const print = fingerprintStatement(entry.text);
    if (print.windows.length === 0) {
      // Too short to identify safely. Recording nothing is better than
      // matching half the language.
      return undefined;
    }
    const tombstone: DeletionTombstone = {
      id: entry.id,
      at: entry.at ?? Date.now(),
      conversationId: entry.conversationId ?? null,
      windows: print.windows,
      size: print.size,
      tokens: print.tokens,
    };
    const next = [tombstone, ...this.entries().filter((existing) => existing.id !== tombstone.id)]
      .slice(0, MAX_ENTRIES);
    // A failed ledger write means the deletion can no longer be PROVEN later,
    // even though the record is gone. The caller must be able to say so instead
    // of reporting a clean forget (M22.6, WP02.7).
    if (!this.kv.set(DELETION_LEDGER_KEY, next)) {
      throw new Error("Deletion ledger is unavailable — deletion could not be recorded.");
    }
    return tombstone;
  }

  /**
   * Record several deletions in ONE write.
   *
   * Bulk pathways (a cleared conversation, a reset) used to remove records with
   * no tombstone at all. Recording them one at a time would write the whole
   * ledger per record — O(n²) bytes for a bulk wipe — and would leave a partial
   * ledger if the tab closed mid-loop. This writes once, and returns only the
   * tombstones that were identifiable (statements under four tokens cannot be
   * fingerprinted and are deliberately not recorded).
   */
  public recordMany(
    entries: Array<{ id: string; text: string; conversationId?: string | null; at?: number }>,
  ): DeletionTombstone[] {
    if (entries.length === 0) return [];
    const at = entries[0].at ?? Date.now();
    const existing = this.entries();
    const replaced = new Set(entries.map((entry) => entry.id));
    const recorded: DeletionTombstone[] = [];
    for (const entry of entries) {
      const print = fingerprintStatement(entry.text);
      if (print.windows.length === 0) continue;
      recorded.push({
        id: entry.id,
        at: entry.at ?? at,
        conversationId: entry.conversationId ?? null,
        windows: print.windows,
        size: print.size,
        tokens: print.tokens,
      });
    }
    if (recorded.length === 0) return [];
    const next = [...recorded, ...existing.filter((entry) => !replaced.has(entry.id))].slice(0, MAX_ENTRIES);
    // A ledger write that fails is not a successful deletion; the caller learns
    // it from the return value rather than from a log line.
    if (!this.kv.set(DELETION_LEDGER_KEY, next)) {
      throw new Error("Deletion ledger is unavailable — deletion could not be recorded.");
    }
    return recorded;
  }

  public has(id: string): boolean {
    return this.entries().some((entry) => entry.id === id);
  }

  /** The hash sent with a remote deletion: evidence, never the text. */
  public fingerprintFor(id: string): string {
    return this.entries().find((entry) => entry.id === id)?.windows[0] ?? "";
  }

  /**
   * Adopt tombstones learned from the server (M22.7, WP03).
   *
   * A deletion made on another device — or before this browser had any storage
   * at all — arrives as an id on `memory_tombstones`. Without this, a fresh
   * browser keeps no local record of it, and hydration is free to merge the
   * statement straight back in. Ids only: the server never held the text.
   *
   * Returns how many ids were newly adopted.
   */
  public adoptRemote(ids: string[]): number {
    const entries = this.entries();
    const known = new Set(entries.map((entry) => entry.id));
    const additions: DeletionTombstone[] = [];
    const at = Date.now();
    for (const id of ids) {
      if (!id || known.has(id)) continue;
      known.add(id);
      additions.push({ id, at, conversationId: null, windows: [], size: 0, tokens: 0 });
    }
    if (additions.length === 0) return 0;
    const next = [...additions, ...entries].slice(0, MAX_ENTRIES);
    if (!this.kv.set(DELETION_LEDGER_KEY, next)) return 0;
    return additions.length;
  }

  /* ---------------------------------------------------------------- *
   * Remote deletion outbox
   * ---------------------------------------------------------------- */

  public remoteQueue(): RemoteDeletion[] {
    const stored = this.kv.get<RemoteDeletion[]>(DELETION_OUTBOX_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  /**
   * Remember that a deletion still has to reach the cloud.
   *
   * Idempotent per id: a second failure updates the attempt count rather than
   * queuing the same id twice, so a device that is offline for an hour does not
   * accumulate a queue it can never drain.
   */
  public queueRemote(id: string, fingerprint = ""): void {
    const queue = this.remoteQueue();
    const existing = queue.find((entry) => entry.id === id);
    const next = existing
      ? queue.map((entry) => (entry.id === id ? { ...entry, fingerprint: fingerprint || entry.fingerprint } : entry))
      : [{ id, fingerprint, at: Date.now(), attempts: 0, lastError: null }, ...queue].slice(0, MAX_OUTBOX);
    // The local ledger already proves the deletion; failing to remember the
    // retry weakens propagation but must not undo the deletion.
    if (!this.kv.set(DELETION_OUTBOX_KEY, next)) {
      console.warn("[DeletionLedger] could not queue the remote deletion");
    }
  }

  /** Drop an id once the cloud has confirmed it. */
  public dropRemote(id: string): void {
    const next = this.remoteQueue().filter((entry) => entry.id !== id);
    // Bounded queue; a failed write is retried by the next flush.
    this.kv.set(DELETION_OUTBOX_KEY, next);
  }

  /** Record a failed attempt, with a short, text-free reason. */
  public noteRemoteAttempt(id: string, error: string | null): void {
    const next = this.remoteQueue().map((entry) =>
      entry.id === id ? { ...entry, attempts: entry.attempts + 1, lastError: error } : entry,
    );
    this.kv.set(DELETION_OUTBOX_KEY, next);
  }

  /** What is still unconfirmed, for the integrity status. Ids and codes only. */
  public remoteSummary(): { pending: number; exhausted: number; lastError: string | null } {
    const queue = this.remoteQueue();
    return {
      pending: queue.length,
      exhausted: queue.filter((entry) => entry.attempts >= MAX_REMOTE_ATTEMPTS).length,
      lastError: queue.find((entry) => entry.lastError)?.lastError ?? null,
    };
  }

  /**
   * Drop a tombstone.
   *
   * Only for COMPENSATION: a delete records its fingerprint before it removes
   * the record (so a concurrent context read cannot quote it in the gap). If the
   * removal itself then fails, the record still exists — and a tombstone for a
   * live record would make it unretrievable through recall. This undoes that.
   */
  public discard(id: string): void {
    const next = this.entries().filter((entry) => entry.id !== id);
    this.kv.set(DELETION_LEDGER_KEY, next);
  }

  /** Cheap change signature, so a cache can tell when the ledger moved. */
  public signature(): string {
    const entries = this.entries();
    return `${entries.length}:${entries[0]?.at ?? 0}:${entries[0]?.id ?? ""}`;
  }

  /** Audit view: ids and counts only — never the deleted text. */
  public summary(): { entries: number; oldest: number | null; newest: number | null } {
    const entries = this.entries();
    return {
      entries: entries.length,
      oldest: entries.length ? Math.min(...entries.map((entry) => entry.at)) : null,
      newest: entries.length ? Math.max(...entries.map((entry) => entry.at)) : null,
    };
  }
}
