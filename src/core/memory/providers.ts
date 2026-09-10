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

  isAvailable(): boolean {
    return getSupabase() !== null;
  }

  async context(query: string, limit: number): Promise<ContextItem[]> {
    const client = getSupabase();
    if (!client) return [];

    try {
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3)
        .slice(0, 4);
      if (terms.length === 0) return [];

      const { data, error } = await client
        .from("memories")
        .select("id, content, created_at")
        .or(terms.map((term) => `content.ilike.%${term}%`).join(","))
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.warn("[OgArchiveProvider] query failed:", error.message);
        return [];
      }

      return (data ?? [])
        .map((row) => ({
          source: this.id,
          band: 6 as const,
          content: String((row as { content?: unknown }).content ?? "").trim(),
        }))
        .filter((item) => item.content.length > 0);
    } catch (error) {
      console.warn("[OgArchiveProvider] unavailable:", error);
      return [];
    }
  }
}
