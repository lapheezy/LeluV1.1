/**
 * ==========================================================
 * LÉLU
 * DELETION GUARD (M22.6, WP05)
 *
 * The deletion ledger (M22.5) can prove that a piece of text
 * quotes a memory the user deleted. This module is the one
 * place that ASKS it, so that proof changes what the system is
 * permitted to use — not only what the Memory panel lists.
 *
 * It is consulted from every path that can carry a remembered
 * statement into a model request:
 *
 *   - PatternMemory.search      recollection of records
 *   - buildCognitiveContext     project checkpoints + names
 *   - MemoryBridge.enrich       the merged context block
 *   - the request sanitizer     the final provider payload
 *
 * Policy, stated once:
 *
 *   - Only text that MATCHES a tombstone is removed. Fingerprints
 *     are six-token window hashes, so a match is strong evidence
 *     but not cryptographic proof of identity (documented in
 *     M22.6/known-limitations.md).
 *   - Removal is SENTENCE-granular. A sentence that quotes a
 *     deleted statement can carry an unrelated detail; that
 *     detail goes with it. Over-removal is the safe direction —
 *     a deleted statement must not survive inside a longer line.
 *   - Nothing here is destructive. The guard never writes to the
 *     memory store or to project text; it filters what is read.
 *     Persisted copies are cleaned by ResidueMigration, which is
 *     the only writer.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import DeletionLedger, {
  buildTombstoneIndex,
  matchTombstoneIndex,
  type DeletionTombstone,
  type TombstoneIndex,
} from "./DeletionLedger";

/** Where the guard's own counters live. Counts only — never text. */
export const GUARD_STATS_KEY = "memory.deletions.guard.v1";

export interface GuardStats {
  /** Texts examined for tombstone matches. */
  checked: number;
  /** Texts that matched at least one deleted statement. */
  matched: number;
  /** Segments removed from context or payloads. */
  removedSegments: number;
  /** Provider payloads sanitized. */
  payloads: number;
  lastAt: number | null;
}

export interface ScrubResult {
  text: string;
  /** Segments dropped because they quoted a deleted memory. */
  removed: number;
  /** Ids of the tombstones responsible (ids only, never text). */
  tombstoneIds: string[];
}

const EMPTY: ScrubResult = { text: "", removed: 0, tombstoneIds: [] };

/**
 * Split text into removable sentences while keeping its shape.
 *
 * Lines are split first because context blocks are line-oriented (a single
 * quoted checkpoint is one line among many sections), then sentences inside a
 * line. The separator is captured so reassembly does not silently glue
 * unrelated sentences together.
 */
function segmentsOf(text: string): Array<{ value: string; separator: string }> {
  const segments: Array<{ value: string; separator: string }> = [];
  for (const line of text.split(/(\n)/)) {
    if (line === "\n") {
      // Keep the line break on the previous segment so removing a whole
      // sentence does not collapse two sections into one line.
      if (segments.length > 0) segments[segments.length - 1].separator += "\n";
      else segments.push({ value: "", separator: "\n" });
      continue;
    }
    const parts = line.split(/(?<=[.!?])\s+/);
    parts.forEach((part, index) => {
      if (index === 0) segments.push({ value: part, separator: "" });
      else segments.push({ value: part, separator: " " });
    });
  }
  return segments;
}

export default class DeletionGuard {
  private static instance: DeletionGuard | null = null;

  private readonly kv = KvStore.getInstance();

  /** Cached index, rebuilt only when the ledger actually changes. */
  private index: TombstoneIndex | null = null;
  private indexSignature = "";

  private counters: GuardStats = {
    checked: 0,
    matched: 0,
    removedSegments: 0,
    payloads: 0,
    lastAt: null,
  };

  public static getInstance(): DeletionGuard {
    if (!DeletionGuard.instance) DeletionGuard.instance = new DeletionGuard();
    return DeletionGuard.instance;
  }

  /** The tombstones as they stand, without re-reading storage per call. */
  public tombstones(): DeletionTombstone[] {
    return DeletionLedger.getInstance().entries();
  }

  private currentIndex(): TombstoneIndex {
    const ledger = DeletionLedger.getInstance();
    const signature = ledger.signature();
    if (this.index && signature === this.indexSignature) return this.index;
    this.index = buildTombstoneIndex(ledger.entries());
    this.indexSignature = signature;
    return this.index;
  }

  /** Does this text quote a deleted memory? */
  public quotes(text: string | null | undefined): boolean {
    if (typeof text !== "string" || !text.trim()) return false;
    this.counters.checked += 1;
    const index = this.currentIndex();
    if (index.bySize.size === 0) return false;
    const hit = matchTombstoneIndex(text, index);
    if (hit) this.counters.matched += 1;
    return Boolean(hit);
  }

  /** Which tombstone, if any — for audit counters and trace records. */
  public match(text: string | null | undefined): DeletionTombstone | undefined {
    if (typeof text !== "string" || !text.trim()) return undefined;
    const index = this.currentIndex();
    if (index.bySize.size === 0) return undefined;
    return matchTombstoneIndex(text, index);
  }

  /**
   * Remove the sentences that quote a deleted memory.
   *
   * Returns the text unchanged (and the SAME string) when nothing matched, so
   * callers can cheaply check `removed === 0`.
   */
  public scrub(text: string | null | undefined): ScrubResult {
    if (typeof text !== "string" || !text.trim()) return EMPTY;
    const index = this.currentIndex();
    if (index.bySize.size === 0) return { text, removed: 0, tombstoneIds: [] };

    this.counters.checked += 1;
    const tombstoneIds = new Set<string>();
    let removed = 0;
    let output = "";

    for (const segment of segmentsOf(text)) {
      const hit = segment.value.trim() ? matchTombstoneIndex(segment.value, index) : undefined;
      if (hit) {
        removed += 1;
        tombstoneIds.add(hit.id);
        // Drop the segment AND its separator: a dangling " " or newline is
        // harmless, a dangling fragment of a deleted sentence is not.
        continue;
      }
      // A separator that belonged to a removed segment must not precede the
      // next surviving segment.
      if (output.length > 0 || segment.value.length > 0) output += segment.separator;
      output += segment.value;
    }

    if (removed === 0) return { text, removed: 0, tombstoneIds: [] };
    this.counters.matched += 1;
    this.counters.removedSegments += removed;
    this.counters.lastAt = Date.now();
    this.persistCounters();
    return { text: output.replace(/\n{3,}/g, "\n\n").trim(), removed, tombstoneIds: [...tombstoneIds] };
  }

  /** Drop list entries that quote a deleted memory. */
  public filterList(values: string[] | null | undefined): string[] {
    if (!Array.isArray(values) || values.length === 0) return [];
    return values.filter((value) => !this.quotes(value));
  }

  /**
   * Scrub one free-text field. An emptied field becomes `undefined`, which is
   * what the project model uses for "not recorded" — never an empty string,
   * so readers cannot mistake a removed quote for a real blank.
   */
  public scrubField(value: string | null | undefined): string | undefined {
    if (typeof value !== "string" || !value.trim()) return value ?? undefined;
    const result = this.scrub(value);
    return result.removed > 0 && !result.text.trim() ? undefined : result.text;
  }

  /**
   * Sanitize an assembled context block (the last thing every provider sees
   * before the dialogue turns). Returns the input unchanged when clean.
   */
  public sanitizeContext(context: string | null | undefined): { context: string; removed: number } {
    if (typeof context !== "string" || !context.trim()) return { context: context ?? "", removed: 0 };
    const result = this.scrub(context);
    return { context: result.removed > 0 ? result.text : context, removed: result.removed };
  }

  /**
   * Final payload guard. Scrubs system/context turns, and NEVER the newest user
   * message: the user may legitimately restate something, and silently deleting
   * their own words would be a different bug. Recorded as a limitation.
   */
  public sanitizeMessages<T extends { role: string; content: unknown }>(
    messages: T[],
  ): { messages: T[]; removed: number } {
    if (!Array.isArray(messages) || messages.length === 0) return { messages, removed: 0 };
    this.counters.payloads += 1;
    let removed = 0;
    const next = messages.map((message, index) => {
      const isNewestUser = message.role === "user" && index === messages.length - 1;
      if (isNewestUser || typeof message.content !== "string") return message;
      const result = this.scrub(message.content as string);
      if (result.removed === 0) return message;
      removed += result.removed;
      return { ...message, content: result.text };
    });
    if (removed > 0) this.persistCounters();
    return { messages: next, removed };
  }

  /**
   * Scrub every string inside a record before it is written elsewhere (M22.7).
   *
   * Derived stores — the identity record, the daily journal, the curiosity
   * ledger, knowledge entries, cognitive event payloads — are re-serialised
   * copies of things LÉLU concluded, not the user's own transcript. A deletion
   * that only filtered reads left those copies intact, and each sync then
   * uploaded the deleted sentence again under a different shape. This walks the
   * object once, at the outbound seam, and removes it there.
   *
   * Deliberately conservative: only strings are touched, depth and node counts
   * are bounded so a pathological object cannot stall a sync, and the same
   * object reference is returned when nothing matched (the common case).
   */
  public scrubDeep<T>(value: T): T {
    const index = this.currentIndex();
    if (index.bySize.size === 0) return value;
    if (typeof value === "string") return this.scrub(value).text as unknown as T;
    if (value === null || typeof value !== "object") return value;

    const MAX_DEPTH = 6;
    const MAX_NODES = 2_000;
    let nodes = 0;
    let touched = false;

    const walk = (input: unknown, depth: number): unknown => {
      if (nodes >= MAX_NODES || depth > MAX_DEPTH) return input;
      nodes += 1;
      if (typeof input === "string") {
        const result = this.scrub(input);
        if (result.removed > 0) touched = true;
        return result.text;
      }
      if (Array.isArray(input)) return input.map((item) => walk(item, depth + 1));
      if (!input || typeof input !== "object") return input;
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
        output[key] = walk(item, depth + 1);
      }
      return output;
    };

    const scrubbed = walk(value, 0) as T;
    return touched ? scrubbed : value;
  }

  /** Counts only. Safe to show in a diagnostic panel or evidence file. */
  public stats(): GuardStats {
    const stored = this.kv.get<GuardStats>(GUARD_STATS_KEY);
    return stored ?? this.counters;
  }

  public resetStats(): void {
    this.counters = { checked: 0, matched: 0, removedSegments: 0, payloads: 0, lastAt: null };
    this.kv.remove(GUARD_STATS_KEY);
  }

  private persistCounters(): void {
    this.kv.set(GUARD_STATS_KEY, this.counters);
  }

  /** Test seam: drop the cached index after a ledger change in the same tick. */
  public invalidate(): void {
    this.index = null;
    this.indexSignature = "";
  }

  static reset(): void {
    DeletionGuard.instance = null;
  }
}
