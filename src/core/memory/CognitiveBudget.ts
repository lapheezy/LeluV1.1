/**
 * ==========================================================
 * LÉLU — COGNITIVE BUDGET
 *
 * The OG version had one serious failure mode: memory and
 * reasoning could multiply until LÉLU was overloaded and
 * crashed. The hybrid must not inherit it (integration brief
 * §9), and the brief is specific about the shape of the fix —
 * when a limit is approached:
 *
 *     CONSOLIDATE → COMPRESS → DEDUPLICATE
 *                 → REDUCE CONTEXT → CONTINUE
 *
 * Never crash. That last word is the design constraint: every
 * method here degrades and returns, and none of them throw on
 * exhaustion.
 *
 * WHAT WAS ALREADY SAFE, AND IS NOT DUPLICATED HERE
 * -------------------------------------------------
 * v1.1 already solved parts of §9, and re-solving them would
 * have created the second memory system the brief forbids:
 *
 *   - Duplicate detection, merge and supersede already live in
 *     MemoryEngine.learn() (findExisting → overlap → reinforce
 *     / supersede / merge). Memory writes are already
 *     idempotent-ish; this module does not re-implement that.
 *   - Retrieval already does not create. MemoryEngine.recall()
 *     performs no writes, so "recalling a memory must not copy
 *     it" holds today.
 *   - Bounded reasoning already exists as TOOL_LOOP_MAX_ROUNDS
 *     (40) with a no-progress cutoff in ProviderResolver.
 *
 * WHAT WAS MISSING, AND IS WHAT THIS FILE ADDS
 * --------------------------------------------
 *   - Bounded context. MemoryBridge.enrich() merged recalled
 *     memory into the prompt with no ceiling, which is the
 *     exact path by which a long-lived LÉLU grows her own
 *     prompt until every turn is enormous.
 *   - Bounded agent depth. Nothing stopped an agent spawning
 *     work that spawned work.
 *   - Per-turn accounting, so the ladder above has something to
 *     measure before it acts.
 * ==========================================================
 */

/** Ceilings. Deliberately generous — this is a backstop, not a throttle. */
export const BUDGET_LIMITS = {
  /**
   * Characters of assembled context per turn. ~24k chars is roughly 6k
   * tokens: large enough that ordinary recall is untouched, small enough
   * that runaway accumulation is caught long before a provider's window.
   */
  contextChars: 24_000,
  /** Memory writes attributable to one turn. */
  memoryWrites: 24,
  /** How deep agent-spawns-agent may nest. */
  agentDepth: 3,
  /** Reflection/self-study passes per turn. */
  reflectionPasses: 4,
} as const;

export interface BudgetSnapshot {
  contextChars: number;
  memoryWrites: number;
  agentDepth: number;
  reflectionPasses: number;
}

export interface ReductionOutcome {
  /** The context after whatever reduction was required. */
  context: string;
  /** Which rungs of the ladder actually ran. */
  applied: Array<"consolidate" | "compress" | "deduplicate" | "reduce">;
  /** Characters removed. Zero when the context was already within budget. */
  removed: number;
}

/** Split assembled context into the blocks the bridge joined together. */
function blocks(context: string): string[] {
  return context.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
}

/** Normalized signature for near-duplicate detection between blocks. */
function signature(block: string): string {
  return block
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 24)
    .sort()
    .join(" ");
}

/**
 * Collapse repeated context blocks.
 *
 * Recall legitimately returns the same fact reached by several routes — the
 * same preference surfacing from a memory, a reflection and the conversation
 * summary. Sending it three times spends budget to say one thing.
 */
export function deduplicateContext(context: string): { context: string; removed: number } {
  const seen = new Set<string>();
  const kept: string[] = [];
  let removed = 0;

  for (const block of blocks(context)) {
    const sig = signature(block);
    if (sig.length > 0 && seen.has(sig)) {
      removed += block.length;
      continue;
    }
    if (sig.length > 0) seen.add(sig);
    kept.push(block);
  }
  return { context: kept.join("\n\n"), removed };
}

/**
 * Compress the oldest half of the context by keeping each block's opening
 * sentences. Newer context is left intact — recency is the best available
 * proxy for relevance to the current turn.
 */
export function compressContext(context: string, targetChars: number): { context: string; removed: number } {
  const parts = blocks(context);
  if (parts.length <= 1) return { context, removed: 0 };

  const pivot = Math.floor(parts.length / 2);
  let removed = 0;

  const compressed = parts.map((block, index) => {
    if (index >= pivot) return block;
    if (block.length <= 400) return block;
    const head = block.slice(0, 400);
    const cut = head.lastIndexOf(". ");
    const kept = cut > 160 ? head.slice(0, cut + 1) : head;
    removed += block.length - kept.length;
    return `${kept} […]`;
  });

  const result = compressed.join("\n\n");
  if (result.length <= targetChars) return { context: result, removed };
  return { context: result, removed };
}

/**
 * Drop whole blocks from the oldest end until the context fits.
 *
 * The last rung, and the only lossy one. It runs only after deduplication and
 * compression have already been tried, which is the brief's ordering.
 */
export function reduceContext(context: string, targetChars: number): { context: string; removed: number } {
  const parts = blocks(context);
  let removed = 0;
  while (parts.length > 1 && parts.join("\n\n").length > targetChars) {
    const dropped = parts.shift();
    removed += (dropped?.length ?? 0) + 2;
  }
  let result = parts.join("\n\n");
  if (result.length > targetChars) {
    removed += result.length - targetChars;
    result = result.slice(0, targetChars);
  }
  return { context: result, removed };
}

/**
 * Bring assembled context inside budget, running only the rungs needed.
 *
 * Context within budget is returned untouched — the common path costs one
 * length check, so this is safe to call on every turn.
 */
export function fitContext(
  context: string,
  limit: number = BUDGET_LIMITS.contextChars,
): ReductionOutcome {
  const applied: ReductionOutcome["applied"] = [];
  if (context.length <= limit) return { context, applied, removed: 0 };

  let working = context;
  let removed = 0;

  const deduped = deduplicateContext(working);
  if (deduped.removed > 0) {
    applied.push("deduplicate");
    working = deduped.context;
    removed += deduped.removed;
  }
  if (working.length <= limit) return { context: working, applied, removed };

  const compressed = compressContext(working, limit);
  if (compressed.removed > 0) {
    applied.push("compress");
    working = compressed.context;
    removed += compressed.removed;
  }
  if (working.length <= limit) return { context: working, applied, removed };

  const reduced = reduceContext(working, limit);
  applied.push("reduce");
  working = reduced.context;
  removed += reduced.removed;

  return { context: working, applied, removed };
}

/**
 * Per-turn accounting.
 *
 * One instance tracks one turn. `charge()` reports whether the operation is
 * still within budget; callers degrade on false rather than being thrown at,
 * because "do less" is the required behaviour and an exception is a crash by
 * another name.
 */
export class CognitiveBudget {
  private readonly counts: BudgetSnapshot = {
    contextChars: 0,
    memoryWrites: 0,
    agentDepth: 0,
    reflectionPasses: 0,
  };

  private readonly exceeded = new Set<keyof BudgetSnapshot>();

  constructor(private readonly limits: typeof BUDGET_LIMITS = BUDGET_LIMITS) {}

  /** Record usage and report whether it stayed inside the ceiling. */
  charge(kind: keyof BudgetSnapshot, amount = 1): boolean {
    this.counts[kind] += amount;
    const withinBudget = this.counts[kind] <= this.limits[kind];
    if (!withinBudget && !this.exceeded.has(kind)) {
      this.exceeded.add(kind);
      console.warn(
        "[CognitiveBudget] %s budget reached (%d/%d) — degrading rather than continuing to grow.",
        kind,
        this.counts[kind],
        this.limits[kind],
      );
    }
    return withinBudget;
  }

  /** Would one more of these fit? Does not consume budget. */
  allows(kind: keyof BudgetSnapshot, amount = 1): boolean {
    return this.counts[kind] + amount <= this.limits[kind];
  }

  snapshot(): BudgetSnapshot {
    return { ...this.counts };
  }

  /** Kinds that hit their ceiling during this turn. */
  overspent(): Array<keyof BudgetSnapshot> {
    return [...this.exceeded];
  }
}

/**
 * Guard for agent-spawns-agent nesting.
 *
 * Depth is per chain, not global, so breadth is unrestricted while a runaway
 * recursive descent is stopped. The brief asks for bounded agent execution
 * without making agents useless, and depth is the dimension that actually
 * explodes.
 */
export class AgentDepthGuard {
  private static readonly chains = new Map<string, number>();

  static enter(chainId: string, maxDepth = BUDGET_LIMITS.agentDepth): boolean {
    const depth = (AgentDepthGuard.chains.get(chainId) ?? 0) + 1;
    if (depth > maxDepth) {
      console.warn(
        "[AgentDepthGuard] chain %s refused at depth %d (max %d) — not spawning further work.",
        chainId,
        depth,
        maxDepth,
      );
      return false;
    }
    AgentDepthGuard.chains.set(chainId, depth);
    return true;
  }

  static exit(chainId: string): void {
    const depth = (AgentDepthGuard.chains.get(chainId) ?? 1) - 1;
    if (depth <= 0) AgentDepthGuard.chains.delete(chainId);
    else AgentDepthGuard.chains.set(chainId, depth);
  }

  static depth(chainId: string): number {
    return AgentDepthGuard.chains.get(chainId) ?? 0;
  }

  /** Test seam; also used when a run is abandoned mid-chain. */
  static reset(): void {
    AgentDepthGuard.chains.clear();
  }
}
