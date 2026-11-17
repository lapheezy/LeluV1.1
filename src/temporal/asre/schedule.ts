/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — ADAPTIVE DEPENDENCY-AWARE SCHEDULING
 *
 * The scheduler answers one question at a time:
 *
 *   T_next = argmax( ExpectedInformationGain / ComputationalCost )
 *
 * A task is only eligible when its dependencies are done, so a component
 * cannot be refined before the part it hangs from exists. Among the
 * eligible tasks, the ratio decides — not "the biggest", and not "the
 * first".
 *
 * Concurrency is measured, never assumed. `runSchedule` records wall clock,
 * CPU time, the utilisation implied by the two, and peak RSS, for the
 * sequential and the limited-concurrency run alike. On this hardware the
 * honest answer is often "parallel is slower": task setup and memory
 * pressure can cost more than the work removed.
 * ==========================================================
 */

import type { ComponentId } from "./types.ts";

export interface ScheduledTask {
  id: string;
  label: string;
  component: ComponentId | "global";
  /** Task ids that must finish first. */
  dependsOn: string[];
  /** Expected information gain, 0..1, from the measurement that priced it. */
  expectedInformationGain: number;
  /** Cost in milliseconds: measured when possible, otherwise an estimate. */
  costMs: number;
  /** How the gain was derived, so it can be challenged. */
  gainBasis: string;
  /** How the cost was derived (measured / priced from a model of the work). */
  costBasis: string;
}

export interface TaskPriority {
  id: string;
  value: number;
  eligible: boolean;
  blockedBy: string[];
}

/** Expected gain per millisecond. A cost of zero is treated as the minimum unit. */
export function priorityValue(task: ScheduledTask): number {
  return task.expectedInformationGain / Math.max(0.001, task.costMs);
}

export function readyTasks(tasks: ScheduledTask[], done: ReadonlySet<string>): ScheduledTask[] {
  return tasks.filter((task) => !done.has(task.id) && task.dependsOn.every((dep) => done.has(dep)));
}

export function priorities(tasks: ScheduledTask[], done: ReadonlySet<string>): TaskPriority[] {
  return tasks
    .filter((task) => !done.has(task.id))
    .map((task) => {
      const blockedBy = task.dependsOn.filter((dep) => !done.has(dep));
      return { id: task.id, value: priorityValue(task), eligible: blockedBy.length === 0, blockedBy };
    })
    .sort((a, b) => b.value - a.value);
}

/** The next task to run: highest gain per unit cost among the ready tasks. */
export function nextTask(tasks: ScheduledTask[], done: ReadonlySet<string>): ScheduledTask | null {
  const ready = readyTasks(tasks, done);
  if (ready.length === 0) return null;
  return ready.reduce((best, task) => (priorityValue(task) > priorityValue(best) ? task : best), ready[0]);
}

/** Full order the greedy scheduler would produce, for the report. */
export function planOrder(tasks: ScheduledTask[]): ScheduledTask[] {
  const done = new Set<string>();
  const order: ScheduledTask[] = [];
  for (;;) {
    const task = nextTask(tasks, done);
    if (!task) break;
    order.push(task);
    done.add(task.id);
  }
  // A cycle leaves tasks unreachable; surface it rather than silently dropping.
  if (order.length !== tasks.length) {
    const stuck = tasks.filter((t) => !done.has(t.id)).map((t) => t.id);
    throw new Error(`Task graph has a dependency cycle; unreachable tasks: ${stuck.join(", ")}`);
  }
  return order;
}

/**
 * Split an ordered plan into waves that respect dependencies: everything in
 * wave n depends only on waves < n, so a wave is safe to run concurrently.
 */
export function planWaves(tasks: ScheduledTask[], maxPerWave = Infinity): ScheduledTask[][] {
  const order = planOrder(tasks);
  const level = new Map<string, number>();
  for (const task of order) {
    const parentLevel = task.dependsOn.reduce((max, dep) => Math.max(max, (level.get(dep) ?? -1) + 1), 0);
    level.set(task.id, parentLevel);
  }
  const byLevel = new Map<number, ScheduledTask[]>();
  for (const task of order) {
    const l = level.get(task.id) ?? 0;
    const list = byLevel.get(l) ?? [];
    list.push(task);
    byLevel.set(l, list);
  }
  const waves: ScheduledTask[][] = [];
  for (const l of [...byLevel.keys()].sort((a, b) => a - b)) {
    const list = byLevel.get(l) as ScheduledTask[];
    for (let start = 0; start < list.length; start += maxPerWave) {
      waves.push(list.slice(start, start + maxPerWave));
    }
  }
  return waves;
}

/* ------------------------------------------------------------- measurement */

export interface ResourceSample {
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  /** cpu / wall, so 1.0 means one core busy and 4.0 means four. */
  cpuUtilisation: number;
  peakRssBytes: number | null;
  /** True when CPU and memory numbers were actually available. */
  measured: boolean;
  platform: string;
}

interface ProcLike {
  cpuUsage?: () => { user: number; system: number };
  memoryUsage?: () => { rss: number };
  platform?: string;
}

function proc(): ProcLike | null {
  const candidate = (globalThis as { process?: ProcLike }).process;
  return candidate && typeof candidate.cpuUsage === "function" ? candidate : null;
}

/**
 * Run `fn` while sampling CPU and RSS. Sampling is on a timer because Node
 * exposes no peak-RSS counter; the sample interval is recorded so the
 * resolution of the number is not overstated.
 */
export async function sampleResources<T>(fn: () => Promise<T> | T, intervalMs = 20): Promise<{ value: T; sample: ResourceSample }> {
  const p = proc();
  const started = performance.now();
  const cpuStart = p?.cpuUsage ? p.cpuUsage() : null;
  let peakRss = p?.memoryUsage ? p.memoryUsage().rss : 0;
  const timer = p?.memoryUsage
    ? setInterval(() => {
        const rss = p.memoryUsage ? p.memoryUsage().rss : 0;
        if (rss > peakRss) peakRss = rss;
      }, intervalMs)
    : null;
  if (timer && typeof timer === "object" && "unref" in timer) (timer as { unref: () => void }).unref();

  try {
    const value = await fn();
    const wallMs = performance.now() - started;
    const cpuEnd = p?.cpuUsage ? p.cpuUsage() : null;
    if (timer) clearInterval(timer as unknown as number);
    const user = cpuStart && cpuEnd ? cpuEnd.user - cpuStart.user : 0;
    const system = cpuStart && cpuEnd ? cpuEnd.system - cpuStart.system : 0;
    return {
      value,
      sample: {
        wallMs,
        cpuUserMs: user / 1000,
        cpuSystemMs: system / 1000,
        cpuUtilisation: wallMs > 0 ? user / 1000 / wallMs : 0,
        peakRssBytes: p?.memoryUsage ? peakRss : null,
        measured: Boolean(cpuStart && cpuEnd),
        platform: p?.platform ?? "unknown",
      },
    };
  } finally {
    if (timer) clearInterval(timer as unknown as number);
  }
}

/** Run asynchronous work with at most `limit` in flight. */
export async function runPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface RunRecord {
  taskId: string;
  startedAtMs: number;
  finishedAtMs: number;
  gain: number;
  costMs: number;
  error: string | null;
}

export interface ScheduleResult {
  records: RunRecord[];
  order: string[];
  waves: string[][];
  sample: ResourceSample;
  concurrency: number;
  /** Tasks that ran while another task was in flight. */
  overlappedTasks: number;
  errors: string[];
}

/**
 * Execute a task graph.
 *
 * `concurrency: 1` is the sequential reference. With more, tasks from the
 * same dependency wave run together, and the measured CPU utilisation says
 * whether the machine was actually busy or merely queueing.
 */
export async function runSchedule(
  tasks: ScheduledTask[],
  options: {
    concurrency?: number;
    runner: (task: ScheduledTask) => Promise<unknown>;
    /** Hard cap so a runaway schedule cannot hang the caller. */
    maxTasks?: number;
  },
): Promise<ScheduleResult> {
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const limit = options.maxTasks ?? tasks.length;
  const done = new Set<string>();
  const records: RunRecord[] = [];
  const errors: string[] = [];
  const order: string[] = [];
  const waves: string[][] = [];
  const t0 = performance.now();
  const executed = tasks.slice(0, limit);

  const result = await sampleResources(async () => {
    for (;;) {
      const ready = readyTasks(executed, done);
      if (ready.length === 0) break;
      const wave = [...ready].sort((a, b) => priorityValue(b) - priorityValue(a)).slice(0, concurrency);
      waves.push(wave.map((t) => t.id));
      await runPool(wave, concurrency, async (task) => {
        const started = performance.now() - t0;
        try {
          await options.runner(task);
          records.push({ taskId: task.id, startedAtMs: started, finishedAtMs: performance.now() - t0, gain: task.expectedInformationGain, costMs: task.costMs, error: null });
          order.push(task.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${task.id}: ${message}`);
          records.push({ taskId: task.id, startedAtMs: started, finishedAtMs: performance.now() - t0, gain: task.expectedInformationGain, costMs: task.costMs, error: message });
          order.push(task.id);
        } finally {
          done.add(task.id);
        }
      });
    }
    return null;
  });

  // Overlap: how many tasks started before another task's window closed.
  let overlapped = 0;
  for (const record of records) {
    if (records.some((other) => other !== record && other.startedAtMs < record.finishedAtMs && other.finishedAtMs > record.startedAtMs)) overlapped++;
  }

  const unreachable = executed.filter((t) => !done.has(t.id)).map((t) => t.id);
  if (unreachable.length > 0) errors.push(`unreachable tasks (dependency cycle): ${unreachable.join(", ")}`);

  return { records, order, waves, sample: result.sample, concurrency, overlappedTasks: overlapped, errors };
}

/**
 * Information gain for a refinement task.
 *
 * Missing geometry and low confidence are the signal; a part that is fully
 * covered and already trusted has almost nothing to gain. This is a priced
 * heuristic, and it says so rather than pretending to be an exact posterior.
 */
export function expectedInformationGain(input: {
  meanConfidence: number;
  missingFraction: number;
  coverage: number;
  reconstructionError: number;
}): { gain: number; basis: string } {
  const gain =
    0.4 * Math.max(0, 1 - input.meanConfidence) +
    0.3 * Math.max(0, Math.min(1, input.missingFraction)) +
    0.2 * Math.max(0, Math.min(1, 1 - input.coverage)) +
    0.1 * Math.max(0, Math.min(1, input.reconstructionError));
  return {
    gain: Math.max(0, Math.min(1, gain)),
    basis: `0.4*(1-confidence=${input.meanConfidence.toFixed(3)}) + 0.3*missing=${input.missingFraction.toFixed(3)} + 0.2*(1-coverage=${input.coverage.toFixed(3)}) + 0.1*error=${input.reconstructionError.toFixed(3)}`,
  };
}
