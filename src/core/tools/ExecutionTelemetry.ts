/**
 * ==========================================================
 * LÉLU — EXECUTION TELEMETRY (client → server)
 *
 * The dispatcher already emits a record for every stage of every real tool
 * invocation on the existing AgentEventBus. The activity card consumes those
 * events; this forwards the SAME records to the server, so the execution log
 * survives the tab and can be checked after the fact.
 *
 * Deliberately small and boring:
 *   · one subscription to the existing bus, no second bus;
 *   · batched, fire-and-forget, and never able to fail a turn;
 *   · no tool arguments, no prompt text, no credentials — only the record.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import type { ExecutionRecord } from "./ExecutionEvidence";

const ENDPOINT = "/api/execution/events";
const FLUSH_MS = 400;
const MAX_QUEUE = 200;

export default class ExecutionTelemetry {
  private static instance: ExecutionTelemetry | null = null;
  private queue: ExecutionRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private starting = false;
  private failedFlushes = 0;

  static getInstance(): ExecutionTelemetry {
    if (!ExecutionTelemetry.instance) ExecutionTelemetry.instance = new ExecutionTelemetry();
    return ExecutionTelemetry.instance;
  }

  /** Idempotent: dispatch calls this on every invocation, only the first binds. */
  start(): void {
    if (this.starting) return;
    this.starting = true;
    try {
      AgentEventBus.getInstance().subscribe((event) => {
        if (event.type !== "execution_evidence") return;
        this.enqueue(event.record);
      });
    } catch {
      // A host without an event bus simply gets no server-side evidence.
    }
  }

  private enqueue(record: ExecutionRecord): void {
    this.queue.push(record);
    if (this.queue.length > MAX_QUEUE) this.queue = this.queue.slice(-MAX_QUEUE);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  /** Exposed for tests and for a page being closed. */
  async flush(): Promise<number> {
    if (this.queue.length === 0) return 0;
    const batch = this.queue.splice(0, this.queue.length);
    if (typeof fetch !== "function") return 0;
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (!response.ok) {
        this.failedFlushes += 1;
        return 0;
      }
      this.failedFlushes = 0;
      return batch.length;
    } catch {
      // Offline or a closed page: the record is still in the client log and the
      // UI card. Dropping it beats blocking or retrying a finished turn.
      this.failedFlushes += 1;
      return 0;
    }
  }

  /** Diagnostics for /status-style surfaces, without any payload content. */
  stats(): { queued: number; failedFlushes: number } {
    return { queued: this.queue.length, failedFlushes: this.failedFlushes };
  }
}
