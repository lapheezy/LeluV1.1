/**
 * ==========================================================
 * LÉLU — STARTUP / RUNTIME TELEMETRY
 *
 * Records real measured milestones (APP_START, CHAT_READY,
 * PROVIDER_READY, …) once each, with high-resolution timing.
 * No simulation: every mark is placed at the actual moment
 * the subsystem becomes usable.
 * ==========================================================
 */

const MARKS: Record<string, number> = {};

/** Milestones LÉLU tracks, in target startup order. */
export const PERF_MILESTONES = [
  "APP_START",
  "CHAT_READY",
  "PROVIDER_READY",
  "BOOTSTRAP_DONE",
] as const;

export type PerfMilestone = (typeof PERF_MILESTONES)[number];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Mark a milestone (first call wins; later calls are ignored). */
export function markPerf(milestone: string): void {
  if (MARKS[milestone] !== undefined) return;
  const t = now();
  MARKS[milestone] = t;
  try {
    performance.mark(`lelu:${milestone}`);
  } catch {
    // performance.mark unsupported — wall-clock value still recorded.
  }
  console.info(`[perf] ${milestone} @ ${Math.round(t)}ms`);
}

/** Measured snapshot for diagnostics/self-state — ms since app start. */
export function perfSnapshot(): Record<string, number> {
  return { ...MARKS };
}

// APP_START is the moment this module is first imported — i.e. the
// earliest point in the application's own code execution.
markPerf("APP_START");
