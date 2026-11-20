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

/** How many consecutive tokens make a fingerprint. */
const WINDOW = 6;
/** Windows kept per deleted memory — the head of the statement is what gets quoted. */
const MAX_WINDOWS = 48;
/** Below this many tokens a window is too generic to identify anything. */
const MIN_TOKENS = 4;
/** Bound the ledger so it cannot grow without limit. */
const MAX_ENTRIES = 400;

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

/** Does this text quote any of the tombstones? Returns the matching tombstone, if any. */
export function matchTombstone(
  text: string,
  tombstones: DeletionTombstone[],
): DeletionTombstone | undefined {
  if (!text.trim() || tombstones.length === 0) return undefined;
  const tokens = residueTokens(text);
  const bySize = new Map<number, DeletionTombstone[]>();
  for (const tombstone of tombstones) {
    if (tombstone.windows.length === 0) continue;
    const list = bySize.get(tombstone.size) ?? [];
    list.push(tombstone);
    bySize.set(tombstone.size, list);
  }
  for (const [size, group] of bySize) {
    if (tokens.length < size) continue;
    const present = new Set<string>();
    for (let i = 0; i + size <= tokens.length; i += 1) {
      present.add(hash(tokens.slice(i, i + size).join(" ")));
    }
    for (const tombstone of group) {
      if (tombstone.windows.some((window) => present.has(window))) {
        return tombstone;
      }
    }
  }
  return undefined;
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
    this.kv.set(DELETION_LEDGER_KEY, next);
    return tombstone;
  }

  public has(id: string): boolean {
    return this.entries().some((entry) => entry.id === id);
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
