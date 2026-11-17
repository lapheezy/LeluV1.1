/**
 * ==========================================================
 * LÉLU ASRE — ADAPTIVE DEPENDENCY SCHEDULER (WP4)
 *
 * Runs a DAG of reconstruction tasks on N slots. Among the tasks whose
 * dependencies are done, the next one started is the one with the
 * highest
 *
 *          expected information gain / predicted cost
 *
 * subject to capacity (free slots, memory budget). Costs are predicted
 * by a cost model that learns from every measured run (EWMA per task
 * kind, normalised by a size hint), so the order improves as LÉLU works.
 *
 * Expected gain for a reconstruction task (see expectedGain):
 *     importance × (1 − confidence) × missing-fraction
 *   + error term (current reconstruction error, when measured)
 * — work that is already certain and complete is worth nothing.
 * ==========================================================
 */

export interface SchedTask<R = unknown> {
  id: string;
  /** Kind for the cost model (e.g. "component:hair"). */
  kind: string;
  deps: string[];
  gain: number;
  /** Size hint for cost prediction (e.g. samples to evaluate). */
  size: number;
  /** Prior cost estimate (ms) used until the model has measurements. */
  priorMs?: number;
  memoryMB?: number;
  run: () => Promise<R> | R;
}

export function expectedGain(p: { importance: number; confidence: number; missing: number; error?: number }): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return clamp(p.importance) * (1 - clamp(p.confidence)) * clamp(p.missing) + clamp(p.error ?? 0) * clamp(p.importance);
}

export class CostModel {
  private readonly perUnit = new Map<string, number>();
  constructor(private readonly alpha = 0.4) {}
  predict(kind: string, size: number, priorMs?: number): number {
    const k = this.perUnit.get(kind);
    if (k !== undefined) return Math.max(0.01, k * Math.max(1, size));
    return priorMs ?? Math.max(1, size) * 1e-4;
  }
  observe(kind: string, size: number, ms: number): void {
    const v = ms / Math.max(1, size);
    const k = this.perUnit.get(kind);
    this.perUnit.set(kind, k === undefined ? v : (1 - this.alpha) * k + this.alpha * v);
  }
  snapshot(): Record<string, number> {
    return Object.fromEntries(this.perUnit);
  }
}

export type Policy = "gain-per-cost" | "fifo";

export interface RunOptions {
  slots: number;
  memoryBudgetMB?: number;
  policy?: Policy;
  /** Stop starting new tasks once this much wall time has passed (anytime mode). */
  deadlineMs?: number;
  /** Tasks whose completion makes the result "usable" (time-to-first-usable is measured). */
  usableAfter?: string[];
  now?: () => number;
}

export interface TimelineEntry {
  id: string;
  slot: number;
  startMs: number;
  endMs: number;
  predictedMs: number;
  gain: number;
}

export interface RunResult<R> {
  results: Map<string, R>;
  order: string[];
  timeline: TimelineEntry[];
  makespanMs: number;
  firstUsableMs: number | null;
  skipped: string[];
  /** Σ gain of completed tasks, by completion time (for anytime curves). */
  gainCurve: Array<{ ms: number; cumulativeGain: number }>;
}

export class Scheduler {
  constructor(readonly costs = new CostModel()) {}

  async run<R>(tasks: SchedTask<R>[], opts: RunOptions): Promise<RunResult<R>> {
    const now = opts.now ?? (() => performance.now());
    const t0 = now();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const t of tasks) for (const d of t.deps) if (!byId.has(d)) throw new Error(`task ${t.id} depends on unknown ${d}`);
    const done = new Set<string>();
    const started = new Set<string>();
    const results = new Map<string, R>();
    const timeline: TimelineEntry[] = [];
    const order: string[] = [];
    const gainCurve: RunResult<R>["gainCurve"] = [];
    const freeSlots = Array.from({ length: Math.max(1, opts.slots) }, (_, i) => i);
    let memoryInUse = 0;
    let firstUsable: number | null = null;
    let cumulative = 0;
    const usable = new Set(opts.usableAfter ?? []);
    const running = new Map<string, Promise<void>>();
    const policy = opts.policy ?? "gain-per-cost";
    const fifoIndex = new Map(tasks.map((t, i) => [t.id, i]));

    const ready = () =>
      tasks.filter((t) => !started.has(t.id) && t.deps.every((d) => done.has(d)));
    const score = (t: SchedTask<R>) => (policy === "fifo" ? -fifoIndex.get(t.id)! : t.gain / this.costs.predict(t.kind, t.size, t.priorMs));

    const launch = (t: SchedTask<R>) => {
      const slot = freeSlots.shift()!;
      started.add(t.id);
      memoryInUse += t.memoryMB ?? 0;
      const predictedMs = this.costs.predict(t.kind, t.size, t.priorMs);
      const s = now();
      const p = Promise.resolve()
        .then(() => t.run())
        .then((r) => {
          const e = now();
          this.costs.observe(t.kind, t.size, e - s);
          results.set(t.id, r);
          done.add(t.id);
          order.push(t.id);
          timeline.push({ id: t.id, slot, startMs: s - t0, endMs: e - t0, predictedMs, gain: t.gain });
          cumulative += t.gain;
          gainCurve.push({ ms: e - t0, cumulativeGain: cumulative });
          if (firstUsable === null && usable.size && [...usable].every((u) => done.has(u))) firstUsable = e - t0;
        })
        .finally(() => {
          memoryInUse -= t.memoryMB ?? 0;
          freeSlots.push(slot);
          running.delete(t.id);
        });
      running.set(t.id, p);
    };

    for (;;) {
      const pastDeadline = opts.deadlineMs !== undefined && now() - t0 >= opts.deadlineMs;
      if (!pastDeadline) {
        const cands = ready().sort((a, b) => score(b) - score(a));
        for (const t of cands) {
          if (!freeSlots.length) break;
          const mem = t.memoryMB ?? 0;
          if (opts.memoryBudgetMB !== undefined && memoryInUse > 0 && memoryInUse + mem > opts.memoryBudgetMB) continue;
          launch(t);
        }
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }
    return {
      results,
      order,
      timeline: timeline.sort((a, b) => a.startMs - b.startMs),
      makespanMs: now() - t0,
      firstUsableMs: usable.size ? firstUsable : null,
      skipped: tasks.filter((t) => !done.has(t.id)).map((t) => t.id),
      gainCurve,
    };
  }
}
