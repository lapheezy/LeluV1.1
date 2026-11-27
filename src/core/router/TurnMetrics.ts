/**
 * ==========================================================
 * LÉLU — TURN METRICS (counts and timings, never content)
 *
 * Mission 44.7 asks for measured reliability numbers rather than
 * impressions: time to first text, total response time, provider
 * attempts, failures and fallbacks. Those are all observable at the one
 * place that owns the provider chain (ProviderResolver.execute), so they
 * are counted THERE and nowhere else — one counter per real event, no
 * second event bus, no per-token logging.
 *
 * The rule this module keeps: a measurement is only ever produced by the
 * code that observed the event. `noteFirstText` is called from the delta
 * callback, not inferred from the final text; a fallback is counted when
 * the chain really moves to another provider, not when a provider looks
 * unhealthy.
 *
 * Nothing here carries prompt text, tool arguments, tool results or
 * credentials — only counts and millisecond durations.
 * ==========================================================
 */

export interface TurnMeasurement {
  /** When the turn began (ProviderResolver's own start). */
  startedAt: number;
  /** When the first streamed delta arrived, if one did. */
  firstTextAt?: number;
  /** Providers actually asked, in order. */
  providerAttempts: number;
  /** Attempts that threw a real provider error (not a user Stop). */
  providerFailures: number;
  /** Times the chain moved on to another provider. */
  fallbacks: number;
}

export interface TurnMetricsSummary {
  /** Null when nothing streamed: measured only where it happened. */
  timeToFirstTextMs: number | null;
  totalMs: number;
  providerAttempts: number;
  providerFailures: number;
  fallbacks: number;
  toolsRun: number;
}

export function newTurnMeasurement(now = Date.now()): TurnMeasurement {
  return { startedAt: now, providerAttempts: 0, providerFailures: 0, fallbacks: 0 };
}

export function noteProviderAttempt(measurement: TurnMeasurement): void {
  measurement.providerAttempts += 1;
}

export function noteProviderFailure(measurement: TurnMeasurement): void {
  measurement.providerFailures += 1;
}

export function noteFallback(measurement: TurnMeasurement): void {
  measurement.fallbacks += 1;
}

/** The first delta of the turn; later deltas are not a new measurement. */
export function noteFirstText(measurement: TurnMeasurement, now = Date.now()): void {
  if (measurement.firstTextAt !== undefined) return;
  measurement.firstTextAt = now;
}

export function summarizeTurn(
  measurement: TurnMeasurement,
  toolsRun: number,
  now = Date.now(),
): TurnMetricsSummary {
  return {
    timeToFirstTextMs: measurement.firstTextAt === undefined ? null : Math.max(0, measurement.firstTextAt - measurement.startedAt),
    totalMs: Math.max(0, now - measurement.startedAt),
    providerAttempts: measurement.providerAttempts,
    providerFailures: measurement.providerFailures,
    fallbacks: measurement.fallbacks,
    toolsRun: Math.max(0, toolsRun),
  };
}

/** One log line per completed turn. Counts only. */
export function formatTurnMetrics(summary: TurnMetricsSummary): string {
  const first = summary.timeToFirstTextMs === null ? "none" : `${summary.timeToFirstTextMs}ms`;
  return (
    `[turn] firstText=${first} total=${summary.totalMs}ms attempts=${summary.providerAttempts} ` +
    `failures=${summary.providerFailures} fallbacks=${summary.fallbacks} tools=${summary.toolsRun}`
  );
}
