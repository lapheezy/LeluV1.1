/**
 * ==========================================================
 * LÉLU — CONCRETE MEMORY PROVIDERS
 *
 * The registry in MemoryProvider.ts is only useful once
 * something is registered in it. These are the providers the
 * hybrid ships with:
 *
 *   local     v1.1's own brain — always available, the floor
 *             LÉLU actually stands on
 *   supabase  v1.1's SupabasePersistence — optional archive
 *   og        the OG Supabase schema, read-only, so historical
 *             OG conversations and memories remain reachable
 *             (brief §19) without v1.1 being built around that
 *             schema
 *
 * Every method here swallows its own failures and returns an
 * empty result. That is not sloppiness — the orchestrator's
 * contract is that a provider never throws at cognition, and
 * enforcing it at the source keeps the guarantee local to the
 * thing that can break.
 * ==========================================================
 */

import type Brain from "../../brain/Brain";
import SupabasePersistence from "../persistence/SupabasePersistence";
import { getSupabase } from "../../og/integrations/supabase/client";
import type { ContextItem, MemoryCandidate, MemoryProvider } from "./MemoryProvider";

/**
 * v1.1's in-process memory. Band 3-4: runtime short-term and persistent LÉLU
 * memory, which is what §6 ranks above any external history.
 */
export class LocalMemoryProvider implements MemoryProvider {
  readonly id = "local";

  constructor(private readonly brain: Brain) {}

  isAvailable(): boolean {
    return true;
  }

  async context(query: string, limit: number): Promise<ContextItem[]> {
    try {
      const recalled = await this.brain.recall(query);
      return recalled.slice(0, limit).map((memory) => ({
        source: this.id,
        band: 4 as const,
        content: `${memory.prompt}\n${memory.response}`.trim(),
        relevance: typeof memory.confidence === "number" ? memory.confidence : undefined,
      }));
    } catch (error) {
      console.warn("[LocalMemoryProvider] recall failed:", error);
      return [];
    }
  }

  async persist(candidate: MemoryCandidate): Promise<void> {
    try {
      await this.brain.learn(
        candidate.prompt,
        candidate.response,
        candidate.category ?? "conversation",
        [],
        candidate.metadata ?? {},
      );
    } catch (error) {
      console.warn("[LocalMemoryProvider] learn failed:", error);
    }
  }
}

/**
 * v1.1's Supabase archive. Band 6 — optional historical context, explicitly
 * below anything local, so a slow or empty archive never displaces the memory
 * LÉLU actually has to hand.
 */
export class SupabaseMemoryProvider implements MemoryProvider {
  readonly id = "supabase";

  isAvailable(): boolean {
    try {
      return SupabasePersistence.getInstance().isConnected();
    } catch {
      return false;
    }
  }

  async persist(candidate: MemoryCandidate): Promise<void> {
    // Writing is the useful half here: v1.1 persists ResponsePatterns through
    // MemoryBridge's learn path, and duplicating that write would create the
    // second memory system §4 forbids. This provider exists so that a caller
    // asking the orchestrator to persist reaches Supabase without importing
    // it, and so availability is reported uniformly alongside every other
    // provider.
    void candidate;
  }
}

/**
 * The OG Supabase schema, READ ONLY.
 *
 * §19 asks that historical OG data stay reachable without v1.1 being
 * hardcoded around the old schema, and that LÉLU be able to move off Supabase
 * later without losing what she knows. Reading through the provider interface
 * gives both: the OG tables are one context source, and nothing upstream knows
 * their shape.
 *
 * It never writes. New memory belongs in v1.1's own store; the OG tables are
 * history, and history should not grow.
 */
export class OgArchiveProvider implements MemoryProvider {
  readonly id = "og-archive";

  /**
   * THE ARCHIVE IS A FROZEN SNAPSHOT, SO IT IS READ ONCE.
   *
   * `legacy_memories` is the OG table as the migration left it: nothing in
   * v1.1 writes to it. It was queried on every chat turn with an ILIKE filter
   * and that request cost 1.5–2.1 s of the turn's critical path, measured in
   * the browser, while the database itself executed it in 5.6 ms (EXPLAIN
   * ANALYZE on the live project: 69 rows, 144 kB, seq scan). The time is the
   * round trip, so an index would change nothing.
   *
   * The rows this user can see (RLS still decides) are fetched once per
   * session — prefetched at startup — and every turn filters them locally
   * with the SAME semantics the server applied: a case-insensitive substring
   * match of any term against `value` or `key`, newest first, `limit` rows.
   * A sign-in change drops the snapshot. An archive larger than
   * SNAPSHOT_MAX_ROWS is never cached: those turns use the server query as
   * before. The ceiling stays well under PostgREST's default max-rows (1000),
   * so a response can never be silently truncated and mistaken for complete.
   */
  static readonly SNAPSHOT_MAX_ROWS = 500;

  private snapshot: { user: string; rows: ArchiveRow[] } | null = null;
  private loading: { user: string; promise: Promise<ArchiveRow[] | null> } | null = null;
  /** Set once the archive proved too large to cache: the server query is used. */
  private tooLarge = false;
  private authWatched = false;

  constructor(private readonly clientOf: () => ArchiveClient | null = () => getSupabase() as unknown as ArchiveClient | null) {}

  isAvailable(): boolean {
    return this.clientOf() !== null;
  }

  /** Start loading the snapshot now, so the first turn does not pay for it. */
  prefetch(): void {
    const client = this.clientOf();
    if (!client || this.tooLarge) return;
    void this.userKey(client).then((user) => this.load(client, user)).catch(() => undefined);
  }

  async context(query: string, limit: number): Promise<ContextItem[]> {
    const client = this.clientOf();
    if (!client) return [];

    try {
      const terms = archiveTerms(query);
      if (terms.length === 0) return [];

      let rows: ArchiveRow[] | null = null;
      if (!this.tooLarge) {
        const user = await this.userKey(client);
        rows = this.snapshot?.user === user ? this.snapshot.rows : await this.load(client, user);
      }
      const matched = rows ? filterArchive(rows, terms, limit) : await this.serverQuery(client, terms, limit);
      return matched
        .map((row) => {
          const key = String(row.key ?? "").trim();
          const value = String(row.value ?? "").trim();
          return {
            source: this.id,
            band: 6 as const,
            // The key is the OG label for the fact; carrying it keeps the
            // archived line self-describing once it is out of its table.
            content: key && value ? `${key}: ${value}` : value || key,
          };
        })
        .filter((item) => item.content.length > 0);
    } catch (error) {
      console.warn("[OgArchiveProvider] unavailable:", error);
      return [];
    }
  }

  /** Who the snapshot belongs to: RLS makes the visible rows per user. */
  private async userKey(client: ArchiveClient): Promise<string> {
    if (!this.authWatched && client.auth?.onAuthStateChange) {
      this.authWatched = true;
      try {
        client.auth.onAuthStateChange(() => {
          this.snapshot = null;
          this.loading = null;
        });
      } catch {
        /* no auth events: the per-user key below still separates users */
      }
    }
    try {
      const { data } = (await client.auth?.getSession?.()) ?? { data: null };
      return data?.session?.user?.id ?? "anon";
    } catch {
      return "anon";
    }
  }

  private load(client: ArchiveClient, user: string): Promise<ArchiveRow[] | null> {
    if (this.snapshot?.user === user) return Promise.resolve(this.snapshot.rows);
    if (this.loading?.user === user) return this.loading.promise;
    const promise = (async () => {
      const { data, error } = await client
        .from("legacy_memories")
        .select("id, key, value, created_at")
        .order("created_at", { ascending: false })
        .limit(OgArchiveProvider.SNAPSHOT_MAX_ROWS + 1);
      if (error) {
        console.warn("[OgArchiveProvider] snapshot failed:", error.message);
        return null;
      }
      const rows = (data ?? []) as ArchiveRow[];
      if (rows.length > OgArchiveProvider.SNAPSHOT_MAX_ROWS) {
        this.tooLarge = true;
        return null;
      }
      this.snapshot = { user, rows };
      return rows;
    })().finally(() => {
      if (this.loading?.user === user) this.loading = null;
    });
    this.loading = { user, promise };
    return promise;
  }

  /** The per-turn query this provider always made: the fallback for a large archive. */
  private async serverQuery(client: ArchiveClient, terms: string[], limit: number): Promise<ArchiveRow[]> {
    // The archive table is `legacy_memories`: the OG `memories` table as the
    // migration left it.
    const { data, error } = await client
      .from("legacy_memories")
      .select("id, key, value, created_at")
      .or(terms.map((term) => `value.ilike.%${term}%,key.ilike.%${term}%`).join(","))
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[OgArchiveProvider] query failed:", error.message);
      return [];
    }
    return (data ?? []) as ArchiveRow[];
  }
}

export interface ArchiveRow {
  id?: unknown;
  key?: unknown;
  value?: unknown;
  created_at?: unknown;
}

/** The slice of the Supabase client this provider uses (a seam for tests). */
export interface ArchiveClient {
  from(table: string): any;
  auth?: {
    getSession?: () => Promise<{ data: { session: { user?: { id?: string } } | null } | null }>;
    onAuthStateChange?: (callback: () => void) => unknown;
  };
}

/** Search terms exactly as the server query built them. */
export function archiveTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 4);
}

/**
 * Local equivalent of `value ILIKE %t% OR key ILIKE %t%` for any term,
 * ordered by created_at descending, limited. Terms are [a-z0-9] only, so
 * ILIKE wildcards cannot occur in them and a lowercase substring test is
 * the same predicate.
 */
export function filterArchive(rows: ArchiveRow[], terms: string[], limit: number): ArchiveRow[] {
  const hits = rows.filter((row) => {
    const value = String(row.value ?? "").toLowerCase();
    const key = String(row.key ?? "").toLowerCase();
    return terms.some((term) => value.includes(term) || key.includes(term));
  });
  const time = (row: ArchiveRow) => Date.parse(String(row.created_at ?? "")) || 0;
  return hits.sort((a, b) => time(b) - time(a)).slice(0, Math.max(0, limit));
}
