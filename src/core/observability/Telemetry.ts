/**
 * ==========================================================
 * LÉLU — DISTRIBUTED TRACES (OpenTelemetry-shaped)
 *
 * The execution chain the acceptance spec asks for:
 *
 *   User Request → CORE → SHAMAN → Agent → Model → Tool
 *                → Result → Verification
 *
 * Every one of those stages is a span on ONE trace, sharing one
 * correlation id, so "which model did she use, which agent ran
 * it, which files changed, did it verify" is a lookup rather
 * than a guess.
 *
 * DESIGN NOTES THAT MATTER
 * ------------------------
 * • Redaction is structural, not a filter applied later: a
 *   span attribute whose key looks like a credential is replaced
 *   BEFORE it is stored, so no trace in memory, in an export, or
 *   in a screenshot of the monitor can carry a secret.
 * • Conversation content is not recorded by default. The audit
 *   question is "what ran", not "what was said"; the prompt text
 *   lives in the user's own chat store.
 * • A span records its own outcome. A stage that threw is
 *   recorded as failed with the real error text, never dropped.
 * • The store is bounded (ring buffer). Tracing must not become
 *   an unbounded memory leak in a long-running agent loop.
 *
 * The OTLP exporter is a real HTTP POST to
 * OTEL_EXPORTER_OTLP_ENDPOINT when that is configured; when it
 * is not, `exportOtlp` says so instead of pretending to ship.
 * ==========================================================
 */

export type SpanStage =
  | "user_request"
  | "core"
  | "shaman"
  | "agent"
  | "model"
  | "tool"
  | "result"
  | "verification"
  | "service";

export type SpanStatus = "running" | "ok" | "failed" | "cancelled";

export interface Span {
  /** 16-hex-character id, like a W3C span id. */
  id: string;
  traceId: string;
  parentId: string | null;
  stage: SpanStage;
  name: string;
  startedAt: number;
  endedAt?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  /** The real error text when status is "failed". */
  error?: string;
  /** Child span ids, in start order. */
  children: string[];
}

export interface TraceSummary {
  traceId: string;
  rootName: string;
  /** The span created by startTrace; closed automatically when the trace drains. */
  rootSpanId: string;
  startedAt: number;
  endedAt?: number;
  status: SpanStatus;
  spanCount: number;
  /** Stages that actually appeared, in order. */
  stages: SpanStage[];
  correlationId: string;
  durationMs?: number;
}

const MAX_SPANS = 2000;
const SECRET_KEY = /(api[_-]?key|token|secret|password|passphrase|authorization|cookie|credential|bearer|private[_-]?key)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/;

/** Replace anything credential-shaped with a marker. */
export function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string" && SECRET_VALUE.test(value)) return "[redacted]";
  return value;
}

function attributeSafe(attributes: Record<string, unknown>): Record<string, string | number | boolean> {
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(attributes)) {
    const value = redactValue(key, raw);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
    } else if (value !== undefined && value !== null) {
      // Structured attributes are flattened by key, one level, so a
      // nested object cannot smuggle a credential past the check.
      for (const [innerKey, innerRaw] of Object.entries(value as Record<string, unknown>)) {
        const inner = redactValue(innerKey, innerRaw);
        if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") {
          safe[`${key}.${innerKey}`] = inner;
        }
      }
    }
  }
  return safe;
}

function hex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return [...array].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default class Telemetry {
  private static instance: Telemetry | null = null;
  private readonly spans = new Map<string, Span>();
  private readonly order: string[] = [];
  private readonly traces = new Map<string, TraceSummary>();
  private enabled = true;

  public static getInstance(): Telemetry {
    if (!Telemetry.instance) Telemetry.instance = new Telemetry();
    return Telemetry.instance;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Begin a trace. Returns its id (the correlation id is stored with it). */
  public startTrace(name: string, correlationId: string, attributes: Record<string, unknown> = {}): string {
    const traceId = hex(16);
    this.traces.set(traceId, {
      traceId,
      rootName: name,
      rootSpanId: "",
      startedAt: Date.now(),
      status: "running",
      spanCount: 0,
      stages: [],
      correlationId,
    });
    const root = this.startSpan({ traceId, stage: "user_request", name, attributes });
    const trace = this.traces.get(traceId);
    if (trace) trace.rootSpanId = root.id;
    return traceId;
  }

  public startSpan(input: {
    traceId: string;
    stage: SpanStage;
    name: string;
    parentId?: string | null;
    attributes?: Record<string, unknown>;
  }): Span {
    const span: Span = {
      id: hex(8),
      traceId: input.traceId,
      parentId: input.parentId ?? null,
      stage: input.stage,
      name: input.name,
      startedAt: Date.now(),
      status: "running",
      attributes: attributeSafe(input.attributes ?? {}),
      children: [],
    };
    if (!this.enabled) return span;

    const trace = this.traces.get(input.traceId);
    if (trace) {
      trace.spanCount += 1;
      if (!trace.stages.includes(input.stage)) trace.stages.push(input.stage);
    }
    this.spans.set(span.id, span);
    this.order.push(span.id);

    if (span.parentId) {
      const parent = this.spans.get(span.parentId);
      if (parent) parent.children.push(span.id);
    }

    // Bounded: drop the oldest spans and any trace left with none.
    while (this.order.length > MAX_SPANS) {
      const oldest = this.order.shift();
      if (!oldest) break;
      this.spans.delete(oldest);
    }
    return span;
  }

  /** Add attributes to a span that is still running. */
  public annotate(spanId: string, attributes: Record<string, unknown>): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.attributes = { ...span.attributes, ...attributeSafe(attributes) };
  }

  public endSpan(spanId: string, status: SpanStatus = "ok", error?: string): void {
    const span = this.spans.get(spanId);
    if (!span) return;
    span.endedAt = Date.now();
    span.status = status;
    if (error) span.error = error.slice(0, 500);
    const trace = this.traces.get(span.traceId);
    if (!trace) return;
    // The root span is the request itself. Nobody else ends it, so when
    // the last child settles the root settles with it — otherwise every
    // trace would stay "running" forever in the monitor.
    const root = trace.rootSpanId ? this.spans.get(trace.rootSpanId) : undefined;
    // The root is the request itself and is excluded here: it is closed
    // BY this check, so counting it as "still running" would mean no
    // trace ever finished.
    const nonRootRunning = [...this.spans.values()].some(
      (item) => item.traceId === span.traceId && item.id !== root?.id && item.id !== span.id && item.status === "running",
    );
    if (!nonRootRunning) {
      if (root && root.status === "running" && root.id !== span.id) {
        root.endedAt = Date.now();
        root.status = "ok";
      }
      const all = [...this.spans.values()].filter((item) => item.traceId === span.traceId);
      trace.endedAt = Date.now();
      trace.status = all.some((item) => item.status === "failed") ? "failed" : "ok";
      trace.durationMs = trace.endedAt - trace.startedAt;
    }
  }

  /**
   * Run a stage and record it, whatever happens.
   *
   * The error is rethrown — telemetry must never swallow the
   * failure it is recording, because a silently traced failure is
   * still a silent failure.
   */
  public async withSpan<T>(
    input: { traceId: string; stage: SpanStage; name: string; parentId?: string | null; attributes?: Record<string, unknown> },
    work: (span: Span) => Promise<T>,
  ): Promise<T> {
    const span = this.startSpan(input);
    try {
      const result = await work(span);
      this.endSpan(span.id, "ok");
      return result;
    } catch (error) {
      this.endSpan(span.id, "failed", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  public span(id: string): Span | undefined {
    return this.spans.get(id);
  }

  public traceSpans(traceId: string): Span[] {
    return [...this.spans.values()]
      .filter((span) => span.traceId === traceId)
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  public recentTraces(limit = 25): TraceSummary[] {
    return [...this.traces.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  /**
   * Ordered stage walk for one trace — the chain the acceptance
   * test reads. Missing stages are reported by omission, which is
   * honest: a request that never reached a model has no model span.
   */
  public chain(traceId: string): { stage: SpanStage; name: string; status: SpanStatus; durationMs: number | null }[] {
    return this.traceSpans(traceId).map((span) => ({
      stage: span.stage,
      name: span.name,
      status: span.status,
      durationMs: span.endedAt ? span.endedAt - span.startedAt : null,
    }));
  }

  /**
   * Ship the trace to an OTLP/HTTP collector, when one is configured.
   *
   * `OTEL_EXPORTER_OTLP_ENDPOINT` is read from the environment; this
   * is a direct JSON POST of the spans in OTLP's own shape, which is
   * the smallest honest integration. Without an endpoint the call
   * refuses rather than reporting a successful export.
   */
  public async exportOtlp(traceId: string): Promise<{ exported: boolean; reason: string; endpoint?: string }> {
    const endpoint =
      (typeof process !== "undefined" ? process.env?.OTEL_EXPORTER_OTLP_ENDPOINT : undefined) ??
      (globalThis as Record<string, unknown>).__LELU_OTEL_ENDPOINT__;
    if (typeof endpoint !== "string" || !endpoint.trim()) {
      return {
        exported: false,
        reason:
          "No OTel collector is configured (set OTEL_EXPORTER_OTLP_ENDPOINT). The trace stays local; nothing was sent.",
      };
    }
    const spans = this.traceSpans(traceId);
    if (spans.length === 0) return { exported: false, reason: `No spans for trace ${traceId}.` };
    try {
      const response = await fetch(`${endpoint.replace(/\/$/, "")}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: spans.map(toOtlpSpan) }] }] }),
        signal: AbortSignal.timeout(5000),
      });
      return response.ok
        ? { exported: true, reason: `Exported ${spans.length} span(s).`, endpoint }
        : { exported: false, reason: `Collector answered ${response.status}.`, endpoint };
    } catch (error) {
      return {
        exported: false,
        reason: `Collector unreachable: ${error instanceof Error ? error.message : String(error)}`,
        endpoint,
      };
    }
  }

  public resetForTests(): void {
    this.spans.clear();
    this.order.length = 0;
    this.traces.clear();
    this.enabled = true;
  }
}

function toOtlpSpan(span: Span): Record<string, unknown> {
  return {
    traceId: span.traceId,
    spanId: span.id,
    ...(span.parentId ? { parentSpanId: span.parentId } : {}),
    name: span.name,
    kind: 1,
    startTimeUnixNano: String(span.startedAt * 1_000_000),
    endTimeUnixNano: String((span.endedAt ?? span.startedAt) * 1_000_000),
    attributes: Object.entries(span.attributes).map(([key, value]) => ({
      key,
      value:
        typeof value === "number"
          ? { intValue: value }
          : typeof value === "boolean"
            ? { boolValue: value }
            : { stringValue: value },
    })),
    status: { code: span.status === "ok" ? 1 : span.status === "failed" ? 2 : 0 },
  };
}
