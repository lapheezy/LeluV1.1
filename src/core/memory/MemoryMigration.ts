/**
 * ==========================================================
 * LÉLU — MEMORY PORTABILITY
 *
 * Integration brief §19. The architecture should support
 *
 *     OG Supabase → Memory Provider → LÉLU Core
 *
 * rather than
 *
 *     LÉLU → Supabase forever.
 *
 * The provider layer already gives the first arrow: OG history
 * is read through OgArchiveProvider and nothing upstream knows
 * the old schema. What was missing is the ability to actually
 * LEAVE — to take what is in a remote store, hold it in a form
 * that belongs to no store, and put it back somewhere else.
 *
 * So the bundle below is deliberately schema-neutral. It has no
 * Supabase column names, no OG table names, no provider
 * identifiers beyond a free-text attribution. It is a list of
 * things LÉLU knows and where each came from — which is all
 * that has to survive a change of database.
 *
 * IMPORT GOES THROUGH THE ORCHESTRATOR, NOT AROUND IT
 * ---------------------------------------------------
 * Migrated memories are offered as ordinary candidates, so
 * MemoryEngine's existing deduplication decides what is new,
 * what reinforces something already known, and what supersedes
 * it. Writing them straight into the store would be faster and
 * would reproduce the OG failure exactly: importing the same
 * archive twice would double LÉLU's memory. Running through
 * the normal path means a second import is close to a no-op.
 *
 * Import is also bounded per run. An archive is precisely the
 * kind of large source §8 warns about, and "restore everything
 * at once" is how a migration becomes an outage.
 * ==========================================================
 */

import { BUDGET_LIMITS } from "./CognitiveBudget";
import MemoryOrchestrator, { type MemoryCandidate } from "./MemoryProvider";

/** The unit of portability: one thing LÉLU knows. */
export interface PortableMemory {
  /** What she knows. */
  content: string;
  /** What it answers, when that was recorded. */
  prompt?: string;
  /** Where it came from, in human terms. Survives the move. */
  attribution?: string;
  /** Milliseconds since epoch, when the source recorded one. */
  recordedAt?: number;
  category?: string;
}

export interface MemoryBundle {
  /** Bundle format, so a future reader can tell what it is holding. */
  format: "lelu.memory.bundle";
  version: 1;
  exportedAt: number;
  /** Free text — "og-archive", "supabase", a filename. Not a schema. */
  origin: string;
  memories: PortableMemory[];
}

const MAX_IMPORT_PER_RUN = 250;

/** Build a bundle from whatever a caller has managed to read. */
export function createBundle(origin: string, memories: PortableMemory[]): MemoryBundle {
  return {
    format: "lelu.memory.bundle",
    version: 1,
    exportedAt: Date.now(),
    origin,
    memories: memories.filter((memory) => memory.content?.trim().length > 0),
  };
}

/** Is this actually one of ours? Checked before anything is imported. */
export function isMemoryBundle(value: unknown): value is MemoryBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Partial<MemoryBundle>;
  return (
    bundle.format === "lelu.memory.bundle" &&
    bundle.version === 1 &&
    Array.isArray(bundle.memories)
  );
}

/**
 * Read everything a provider will give up, as a bundle.
 *
 * Uses the provider interface rather than any store's API, which is what
 * makes this work for the OG archive, v1.1's Supabase, or anything added
 * later without this file changing.
 */
export async function exportFromProvider(
  providerId: string,
  queries: string[],
  perQuery = 50,
): Promise<MemoryBundle> {
  const orchestrator = MemoryOrchestrator.getInstance();
  const seen = new Set<string>();
  const memories: PortableMemory[] = [];

  for (const query of queries) {
    const items = await orchestrator.gather(query, { limit: perQuery });
    for (const item of items) {
      if (item.source !== providerId) continue;
      const key = item.content.trim().toLowerCase().replace(/\s+/g, " ");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      memories.push({ content: item.content.trim(), attribution: item.source });
    }
  }

  return createBundle(providerId, memories);
}

export interface ImportOutcome {
  offered: number;
  skipped: number;
  truncated: boolean;
  acceptedBy: string[];
}

/**
 * Bring a bundle into LÉLU's own memory.
 *
 * Every entry goes in as a candidate, so the deduplication that already
 * exists decides its fate. Re-importing the same bundle should therefore
 * change very little — which is the property that makes a migration safe to
 * retry, and the one that stops an archive from multiplying her memory.
 */
export async function importBundle(
  bundle: unknown,
  options: { max?: number } = {},
): Promise<ImportOutcome> {
  if (!isMemoryBundle(bundle)) {
    return { offered: 0, skipped: 0, truncated: false, acceptedBy: [] };
  }

  const max = Math.min(options.max ?? MAX_IMPORT_PER_RUN, MAX_IMPORT_PER_RUN);
  const orchestrator = MemoryOrchestrator.getInstance();
  const accepted = new Set<string>();

  const usable = bundle.memories.filter((memory) => memory.content?.trim().length >= 12);
  const batch = usable.slice(0, max);
  let offered = 0;

  for (const memory of batch) {
    const candidate: MemoryCandidate = {
      prompt: memory.prompt ?? `What do I know from ${memory.attribution ?? bundle.origin}?`,
      response: memory.content.trim(),
      category: memory.category ?? "migrated",
      attribution: memory.attribution ?? bundle.origin,
      metadata: {
        migratedFrom: bundle.origin,
        bundleExportedAt: bundle.exportedAt,
        ...(memory.recordedAt ? { originallyRecordedAt: memory.recordedAt } : {}),
      },
    };
    const { accepted: took } = await orchestrator.persist(candidate);
    took.forEach((id) => accepted.add(id));
    offered += 1;
  }

  return {
    offered,
    skipped: bundle.memories.length - batch.length,
    truncated: usable.length > batch.length,
    acceptedBy: [...accepted],
  };
}

/** Ceiling shared with the cognitive budget, so one import cannot outrun it. */
export const IMPORT_LIMITS = {
  perRun: MAX_IMPORT_PER_RUN,
  perTurnMemoryWrites: BUDGET_LIMITS.memoryWrites,
} as const;
