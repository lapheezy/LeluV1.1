/**
 * ==========================================================
 * LÉLU — BOUNDED CACHE (acquired capability)
 *
 * A small, bounded, LRU-evicting cache for LÉLU's working memory.
 *
 * The eviction semantics are adapted from quick-lru by Sindre
 * Sorhus (MIT), acquired through LÉLU's own Repo Executive and
 * Repo Executor and recorded under `acquired.bounded-memory-cache`.
 * The implementation is LÉLU's own: a Map-backed LRU with an
 * optional per-entry maximum age, explicit statistics, and no
 * timers, so it is safe in a browser and in tests.
 *
 * See NOTICE.md in this directory for the upstream attribution and
 * the licence text carried with the adaptation.
 * ==========================================================
 */

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  expired: number;
}

interface Entry<V> {
  value: V;
  storedAt: number;
  maxAgeMs: number | null;
}

export default class BoundedCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private expired = 0;

  constructor(private readonly maxSize = 256) {
    if (!Number.isFinite(maxSize) || maxSize < 1) {
      throw new Error("BoundedCache maxSize must be a positive integer.");
    }
  }

  get size(): number {
    return this.entries.size;
  }

  private isExpired(entry: Entry<V>, now: number): boolean {
    // `>=` so a zero max-age expires immediately instead of surviving the
    // millisecond it was written in.
    return entry.maxAgeMs !== null && now - entry.storedAt >= entry.maxAgeMs;
  }

  /** Read and mark as most-recently-used. Expired entries are not returned. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (this.isExpired(entry, Date.now())) {
      this.entries.delete(key);
      this.expired += 1;
      this.misses += 1;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  has(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry, Date.now())) {
      this.entries.delete(key);
      this.expired += 1;
      return false;
    }
    return true;
  }

  /** Store a value and evict the least-recently-used entries over capacity. */
  set(key: K, value: V, options: { maxAgeMs?: number } = {}): void {
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      storedAt: Date.now(),
      maxAgeMs: typeof options.maxAgeMs === "number" && options.maxAgeMs >= 0 ? options.maxAgeMs : null,
    });
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.evictions += 1;
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): K[] {
    return [...this.entries.keys()];
  }

  stats(): CacheStats {
    return {
      size: this.entries.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      expired: this.expired,
    };
  }
}

/** The capability's working store. Bounded at 256 entries. */
export const WORKING_MEMORY = new BoundedCache<string, string>(256);

export interface BoundedCacheSelftest {
  ok: boolean;
  steps: string[];
  stats: CacheStats;
}

/**
 * A real self-test of the adapted behaviour: insert, read, expire and
 * evict. Used by the `memory.cache` tool's `selftest` action so a USE
 * stage proves behaviour rather than existence.
 */
export function selftestBoundedCache(): BoundedCacheSelftest {
  const steps: string[] = [];
  const cache = new BoundedCache<string, number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  const readBack = cache.get("a") === 1;
  steps.push(`get('a') === 1: ${readBack}`);
  cache.set("c", 3);
  const evicted = !cache.has("b") && cache.has("a") && cache.has("c");
  steps.push(`LRU evicted 'b' after inserting 'c': ${evicted}`);
  const expiredCache = new BoundedCache<string, string>(4);
  expiredCache.set("stale", "value", { maxAgeMs: 0 });
  const expiredEntry = expiredCache.get("stale");
  steps.push(`expired entry returned: ${expiredEntry !== undefined}`);
  const stats = cache.stats();
  steps.push(`evictions recorded: ${stats.evictions}`);
  return { ok: readBack && evicted && expiredEntry === undefined && stats.evictions === 1, steps, stats };
}
