/**
 * ==========================================================
 * LÉLU — T0→T11 LATENCY PROBE  (+ TRACE CORRELATION)
 *
 * Records sub-millisecond timestamps at each stage of the
 * send→first-visible-response pipeline.  Also carries the
 * correlation IDs that link UI-layer state to the AIService
 * stream without creating a competing request system.
 *
 * HOW TO ENABLE (browser DevTools):
 *   localStorage.setItem('__leluProfiling', '1');
 *   // then reload and send a message
 *
 * HOW TO READ RESULTS:
 *   window.__leluLatencyLog   ← array of completed traces
 *
 * Checkpoints:
 *   T0  Send button pressed (GenesisChat)
 *   T1  AIService.chat() receives the call
 *   T2  runtime.process() begins (provider request)
 *   T3  First onDelta callback (first SSE chunk from provider)
 *   T4  emitStream() fires (same tick as T3 in this codebase)
 *   T5  Stream subscriber receives event (GenesisChat subscribeStream)
 *   T6  setExchange() called (React state update queued)
 *   T7  requestAnimationFrame fires (next browser paint opportunity)
 *   T8–T11  Require real browser GPU — ENVIRONMENT-BOUND
 *
 * Correlation IDs (added by annotate()):
 *   exchangeId  GenesisChat's UI-layer exchange UUID (set at T0)
 *   streamId    AIService's stream/message UUID (set inside chat())
 *
 * Error capture (set by traceError()):
 *   error.stage    Which stage threw (A–G classification)
 *   error.message  Sanitised message — NEVER logs API keys/tokens
 * ==========================================================
 */

export interface LatencyTrace {
  id: string;
  checkpoints: Partial<Record<LatencyCheckpoint, number>>;
  deltas?: Record<string, number>;
  /** Correlation IDs — populated by annotate() calls from GenesisChat and AIService. */
  exchangeId?: string;
  streamId?: string;
  /** First error that aborted this trace, if any. */
  error?: { stage: string; message: string };
}

export type LatencyCheckpoint = "T0" | "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7";

let active: LatencyTrace | null = null;
const log: LatencyTrace[] = [];

function isEnabled(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      Boolean(localStorage.getItem("__leluProfiling"))
    );
  } catch {
    return false;
  }
}

/** Start a new trace (T0). Returns a traceId used to cross-reference later marks. */
export function startTrace(): string {
  if (!isEnabled()) return "";
  const id = crypto.randomUUID().slice(0, 8);
  active = { id, checkpoints: { T0: performance.now() } };
  return id;
}

/**
 * Attach a correlation ID to the active trace.
 * field must be 'exchangeId' or 'streamId'.
 * No-op if profiling is disabled or no trace is active.
 */
export function annotate(
  field: "exchangeId" | "streamId",
  value: string,
  traceId?: string,
): void {
  if (!isEnabled() || !active) return;
  if (traceId && active.id !== traceId) return;
  active[field] = value;
}

/**
 * Record an error at a named pipeline stage.
 * Only the FIRST error per trace is kept.
 * NEVER pass raw API keys, tokens, or secrets as the message.
 * stage should be one of: A=Input B=AIService C=Runtime D=Provider E=Streaming F=Subscription G=UI
 */
export function traceError(stage: string, message: string, traceId?: string): void {
  if (!isEnabled() || !active) return;
  if (traceId && active.id !== traceId) return;
  if (!active.error) {
    active.error = { stage, message };
  }
}

/** Record a checkpoint. No-op if profiling is not enabled or no active trace. */
export function mark(checkpoint: LatencyCheckpoint, traceId?: string): void {
  if (!isEnabled() || !active) return;
  if (traceId && active.id !== traceId) return;
  active.checkpoints[checkpoint] = performance.now();

  if (checkpoint === "T6") {
    // Schedule T7 (next rAF = next paint opportunity)
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame(() => {
        if (active) {
          active.checkpoints.T7 = performance.now();
          finaliseTrace();
        }
      });
    } else {
      finaliseTrace();
    }
  }
}

function finaliseTrace(): void {
  if (!active) return;
  const cp = active.checkpoints;
  const t0 = cp.T0 ?? 0;
  const deltas: Record<string, number> = {};
  const order: LatencyCheckpoint[] = ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7"];
  for (let i = 1; i < order.length; i++) {
    const prev = cp[order[i - 1]];
    const curr = cp[order[i]];
    if (prev !== undefined && curr !== undefined) {
      deltas[`${order[i - 1]}→${order[i]}`] = +(curr - prev).toFixed(3);
    }
  }
  if (cp.T7 !== undefined) {
    deltas[`T0→T7 (total)`] = +(cp.T7 - t0).toFixed(3);
  }
  active.deltas = deltas;
  log.push(active);

  // Surface on window for DevTools inspection
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>)["__leluLatencyLog"] = log;
  }

  const correlationLine = [
    active.exchangeId ? `exchange=${active.exchangeId.slice(0, 8)}` : null,
    active.streamId   ? `stream=${active.streamId.slice(0, 8)}`     : null,
  ].filter(Boolean).join("  ");

  console.groupCollapsed(
    `[LÉLU Latency] trace ${active.id}` +
    (correlationLine ? `  |  ${correlationLine}` : "") +
    (active.error ? `  ⚠ ${active.error.stage}: ${active.error.message}` : ""),
  );
  console.table(deltas);
  console.log("Checkpoints (ms from page load):", { ...cp });
  if (active.exchangeId || active.streamId) {
    console.log("Correlation IDs:", {
      exchangeId: active.exchangeId ?? "(not set)",
      streamId:   active.streamId   ?? "(not set)",
    });
  }
  if (active.error) {
    console.warn(`Error at stage ${active.error.stage}:`, active.error.message);
  }
  console.log(
    "Note: T8-T11 (React render, commit, GPU paint) require real browser DevTools.",
    "Use Performance tab → record while sending a message.",
  );
  console.groupEnd();

  active = null;
}

/** Expose log for test assertions. */
export function getLog(): readonly LatencyTrace[] {
  return log;
}

/** Clear the log (useful in tests). */
export function clearLog(): void {
  log.length = 0;
  active = null;
}
