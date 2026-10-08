/**
 * ==========================================================
 * LÉLU — MEMORY / CONTEXT PROVIDER LAYER
 *
 * Cognition should ask for CONTEXT. It should not ask Supabase
 * for context (integration brief §5).
 *
 * Before this, MemoryBridge.learn() called
 * SupabasePersistence.getInstance().persistMemories() directly,
 * which is a hardwire in both directions: LÉLU could not use a
 * different store, and a Supabase problem was a LÉLU problem.
 * The OG interfaces would have doubled that wire, since their
 * whole data layer is Supabase-shaped.
 *
 * So persistence becomes a registry of providers behind one
 * question — "give me relevant context" / "here is something
 * worth keeping" — and Supabase becomes one provider among
 * them rather than the floor LÉLU stands on.
 *
 * THE RULE THAT MATTERS
 * ---------------------
 * A provider failure is isolated. Every call site here catches,
 * logs, and continues with whatever the other providers
 * returned. If Supabase is down, unconfigured, signed out or
 * simply slow, LÉLU still renders, still chats, still thinks
 * and still remembers locally — that is §5 and §21 stated as
 * code rather than as intent.
 * ==========================================================
 */

/** Where a piece of context came from, and how much it should be trusted. */
export interface ContextItem {
  /** Provider id that supplied it. */
  source: string;
  /** The text handed to cognition. */
  content: string;
  /**
   * Priority band from brief §6 — lower is nearer the current turn and is
   * preferred when context has to be cut.
   *
   *   1 current conversation      5 project / agent context
   *   2 immediate working context 6 optional historical (e.g. Supabase)
   *   3 runtime short-term memory 7 other external sources
   *   4 persistent LÉLU memory
   */
  band: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** 0..1 where the provider can express it. */
  relevance?: number;
}

export interface MemoryCandidate {
  prompt: string;
  response: string;
  category?: string;
  /** Where this came from, so LÉLU can say how she knows something (§8). */
  attribution?: string;
  metadata?: Record<string, unknown>;
}

/**
 * One place LÉLU can read context from and/or write durable memory to.
 *
 * Both methods are optional: a read-only research source implements
 * `context()` alone, a write-only archive implements `persist()` alone.
 */
export interface MemoryProvider {
  readonly id: string;
  /** False when the provider cannot serve right now (unconfigured, offline). */
  isAvailable(): boolean;
  /** Context relevant to this query. Must not throw; may return []. */
  context?(query: string, limit: number): Promise<ContextItem[]>;
  /** Durably keep a candidate. Must not throw. */
  persist?(candidate: MemoryCandidate): Promise<void>;
}

export interface GatherOptions {
  /** Per-provider cap on items. */
  limit?: number;
  /** Bands to include; omit for all. */
  bands?: Array<ContextItem["band"]>;
  /** How long any one provider may take before it is skipped. */
  timeoutMs?: number;
}

/** Resolve, or give up quietly — a slow provider must not stall a turn. */
async function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class MemoryOrchestrator {
  private static instance: MemoryOrchestrator | null = null;
  private readonly providers = new Map<string, MemoryProvider>();

  static getInstance(): MemoryOrchestrator {
    if (!MemoryOrchestrator.instance) MemoryOrchestrator.instance = new MemoryOrchestrator();
    return MemoryOrchestrator.instance;
  }

  register(provider: MemoryProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  list(): Array<{ id: string; available: boolean }> {
    return [...this.providers.values()].map((p) => ({ id: p.id, available: p.isAvailable() }));
  }

  /**
   * Collect context from every available provider, ordered by band.
   *
   * Providers are queried in parallel and each is individually guarded, so one
   * failing or hanging source costs its own results and nothing else. The
   * return is sorted by band then relevance, which is the §6 hierarchy — the
   * caller can then cut from the end and lose the least important context
   * first.
   */
  async gather(query: string, options: GatherOptions = {}): Promise<ContextItem[]> {
    const { limit = 8, bands, timeoutMs = 4_000 } = options;

    const readable = [...this.providers.values()].filter(
      (provider) => typeof provider.context === "function" && provider.isAvailable(),
    );

    const results = await Promise.all(
      readable.map(async (provider) => {
        try {
          return await withTimeout(
            provider.context!(query, limit).catch((error) => {
              console.warn("[MemoryOrchestrator] %s failed to supply context:", provider.id, error);
              return [] as ContextItem[];
            }),
            timeoutMs,
            [] as ContextItem[],
          );
        } catch (error) {
          console.warn("[MemoryOrchestrator] %s threw:", provider.id, error);
          return [] as ContextItem[];
        }
      }),
    );

    const items = results.flat().filter((item) => (bands ? bands.includes(item.band) : true));
    return items.sort(
      (a, b) => a.band - b.band || (b.relevance ?? 0) - (a.relevance ?? 0),
    );
  }

  /**
   * Offer a candidate to every writable provider.
   *
   * Deliberately best-effort and parallel: local memory succeeding while a
   * remote archive fails is a good outcome, not a partial failure to report
   * upward. Callers are not told which providers took it, because there is
   * nothing useful they could do differently.
   */
  async persist(candidate: MemoryCandidate): Promise<{ accepted: string[]; failed: string[] }> {
    const writable = [...this.providers.values()].filter(
      (provider) => typeof provider.persist === "function" && provider.isAvailable(),
    );

    const accepted: string[] = [];
    const failed: string[] = [];

    await Promise.all(
      writable.map(async (provider) => {
        try {
          await provider.persist!(candidate);
          accepted.push(provider.id);
        } catch (error) {
          failed.push(provider.id);
          console.warn("[MemoryOrchestrator] %s failed to persist:", provider.id, error);
        }
      }),
    );

    return { accepted, failed };
  }

  /** Test seam. */
  static reset(): void {
    MemoryOrchestrator.instance = null;
  }
}

export default MemoryOrchestrator;
