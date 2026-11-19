/**
 * ==========================================================
 * LÉLU — VOICE PERFORMANCE INSTRUMENTATION
 *
 * The personality system must cost microseconds, not turns.
 * Every stage it adds is measured here — retrieval, appraisal,
 * composition, transformation — so "it feels slower" can be
 * answered with numbers instead of an opinion.
 *
 * Deliberately allocation-light and dependency-free: a mark is
 * two numbers in an array. It never calls a model, never reads
 * storage, and every public method is guarded so instrumentation
 * can never be the reason a turn fails.
 * ==========================================================
 */

export type VoiceStage =
  | "profile-load"
  | "appraisal"
  | "stance"
  | "compose"
  | "provider-directive"
  | "transform"
  | "drift-check";

export interface VoiceSpan {
  stage: VoiceStage;
  ms: number;
  at: number;
}

export interface VoiceTimingSummary {
  samples: number;
  perStage: Record<string, { count: number; p50: number; p95: number; max: number }>;
  totalP50: number;
  totalP95: number;
}

const MAX_SPANS = 500;

export class VoicePerformance {
  private static instance: VoicePerformance | null = null;
  private readonly spans: VoiceSpan[] = [];

  public static getInstance(): VoicePerformance {
    if (!VoicePerformance.instance) VoicePerformance.instance = new VoicePerformance();
    return VoicePerformance.instance;
  }

  /** Time a synchronous stage and return its result unchanged. */
  public measure<T>(stage: VoiceStage, run: () => T): T {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      return run();
    } finally {
      const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
      this.record(stage, ended - started);
    }
  }

  /** Time an async stage. Rejections are timed and rethrown untouched. */
  public async measureAsync<T>(stage: VoiceStage, run: () => Promise<T>): Promise<T> {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      return await run();
    } finally {
      const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
      this.record(stage, ended - started);
    }
  }

  public record(stage: VoiceStage, ms: number): void {
    try {
      if (!Number.isFinite(ms) || ms < 0) return;
      this.spans.push({ stage, ms: Number(ms.toFixed(3)), at: Date.now() });
      if (this.spans.length > MAX_SPANS) this.spans.splice(0, this.spans.length - MAX_SPANS);
    } catch {
      /* instrumentation never costs a turn */
    }
  }

  public reset(): void {
    this.spans.length = 0;
  }

  public summary(): VoiceTimingSummary {
    const byStage = new Map<VoiceStage, number[]>();
    for (const span of this.spans) {
      const list = byStage.get(span.stage) ?? [];
      list.push(span.ms);
      byStage.set(span.stage, list);
    }
    // A per-turn total is not recoverable from spans alone, so the
    // summary reports the per-stage percentiles and the p50/p95 of the
    // stage sum as an upper bound (stages do not overlap).
    const stages: Record<string, { count: number; p50: number; p95: number; max: number }> = {};
    const sums: number[] = [];
    let turnSum = 0;
    for (const [stage, values] of byStage) {
      const sorted = [...values].sort((a, b) => a - b);
      stages[stage] = {
        count: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: Number((sorted[sorted.length - 1] ?? 0).toFixed(3)),
      };
      turnSum += percentile(sorted, 0.5);
    }
    if (Object.keys(stages).length > 0) sums.push(turnSum);
    const sortedSums = sums.sort((a, b) => a - b);
    return {
      samples: this.spans.length,
      perStage: stages,
      totalP50: Number((percentile(sortedSums, 0.5) || turnSum).toFixed(3)),
      totalP95: Number((percentile(sortedSums, 0.95) || turnSum).toFixed(3)),
    };
  }

  public snapshot(): VoiceSpan[] {
    return [...this.spans];
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

export default VoicePerformance;
