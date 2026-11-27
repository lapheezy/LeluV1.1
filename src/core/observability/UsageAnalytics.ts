/**
 * ==========================================================
 * LÉLU — USAGE ANALYTICS (WP19.3 – 19.8)
 *
 * Reads the authorities, stores nothing of its own:
 *   UsageLedger rollups   minute (48 h) and hour (120 d) buckets
 *   ConversationRegistry  per-conversation lifecycle and usage
 *   ResourcePolicy        limits (capacity) and alert thresholds
 *   UsageBudgetGate       calls in flight now
 *
 * Every figure says whether it is MEASURED (counted, timed, reported by
 * the provider) or UNAVAILABLE (nothing in this runtime exposes it). Token
 * figures are provider-reported only: a bucket whose calls reported no
 * tokens shows tokens as unavailable, never 0 and never an estimate.
 * ==========================================================
 */

import UsageLedger, { emptyBucket, type UsageBucket } from "./UsageLedger";
import ConversationRegistry, { type ConversationRecord } from "./ConversationRegistry";
import ResourcePolicy, { type Policy } from "./ResourcePolicy";
import UsageBudgetGate from "./UsageBudgetGate";

export type Resolution = "minute" | "hour" | "day" | "week" | "month";

export interface Point {
  key: string;
  start: number;
  calls: number;
  failed: number;
  rateLimited: number;
  /** null when no call in the bucket reported tokens. */
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  reasoningTokens: number | null;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  gauges: Record<string, { min: number; max: number; avg: number; last: number }>;
  bucket: UsageBucket;
}

export interface Range {
  metric: string;
  availability: "measured" | "unavailable";
  lowest: number | null;
  lowestAt: string | null;
  highest: number | null;
  highestAt: string | null;
  average: number | null;
  current: number | null;
  peak: number | null;
  capacity: number | null;
  remaining: number | null;
  pctUsed: number | null;
  trend: "rising" | "falling" | "flat" | "unknown";
}

/** What this runtime cannot measure, and exactly why (WP19.10). */
export const UNAVAILABLE: Array<{ metric: string; why: string }> = [
  { metric: "CPU utilisation", why: "Browsers expose no CPU usage API; the Node/Bun server process could (process.cpuUsage), but the app's usage path runs in the browser." },
  { metric: "GPU utilisation", why: "WebGL/WebGPU expose no utilisation counter. The 3D views report their own draw calls and triangles instead." },
  { metric: "JS heap on Safari/Firefox/iOS", why: "performance.memory is Chromium-only; on other engines the heap gauge is absent, not zero." },
  { metric: "Provider remaining quota / rate-limit headroom", why: "Requests go through the broker, which does not forward providers' x-ratelimit-* headers; only rate-limit refusals (429) are counted." },
  { metric: "Tokens for some providers", why: "Counted only when the provider returns a usage object; calls without one show tokens as unavailable." },
  { metric: "Cost", why: "Only providers that report cost (e.g. OpenRouter usage.cost) have it; LÉLU holds no price table and never estimates." },
  { metric: "Per-request bandwidth to providers", why: "Measured as same-origin transfer size of /api calls in this tab only (Resource Timing); cross-origin bytes are hidden by the browser." },
];

/** Gauges measured right now, from this runtime. Absent = unavailable. */
export async function sampleGauges(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out.activeConversations = ConversationRegistry.getInstance().activeCount();
  out.inFlightCalls = UsageBudgetGate.getInstance().inFlightCount();
  const mem = (globalThis as { performance?: { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } } }).performance?.memory;
  if (mem && mem.usedJSHeapSize > 0) {
    out.jsHeapMB = Math.round((mem.usedJSHeapSize / 1048576) * 10) / 10;
    out.jsHeapLimitMB = Math.round(mem.jsHeapSizeLimit / 1048576);
  }
  // Event-loop lag: how late a zero-delay timer fires (measured, ~1 ms when idle).
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 0));
  out.eventLoopLagMs = Math.round((performance.now() - t0) * 10) / 10;
  try {
    const since = performance.now() - 60_000;
    const entries = (performance.getEntriesByType?.("resource") ?? []) as PerformanceResourceTiming[];
    const api = entries.filter((e) => e.startTime >= since && /\/api\//.test(e.name) && e.transferSize > 0);
    if (api.length) out.apiBytesPerMin = api.reduce((s, e) => s + e.transferSize, 0);
  } catch {
    /* Resource Timing unavailable */
  }
  return out;
}

/** Sample now and store into the ledger's current minute/hour (bounded cost, measured). */
export async function recordSample(): Promise<{ gauges: Record<string, number>; costMs: number }> {
  const t0 = performance.now();
  const gauges = await sampleGauges();
  UsageLedger.getInstance().sampleGauges(gauges);
  return { gauges, costMs: Math.round((performance.now() - t0) * 100) / 100 };
}

function merge(into: UsageBucket, b: UsageBucket): void {
  into.calls += b.calls;
  into.ok += b.ok;
  into.failed += b.failed;
  into.rateLimited += b.rateLimited;
  into.tokenReportedCalls += b.tokenReportedCalls;
  into.inputTokens += b.inputTokens;
  into.outputTokens += b.outputTokens;
  into.cachedInputTokens += b.cachedInputTokens;
  into.reasoningTokens += b.reasoningTokens;
  into.latencyMs += b.latencyMs;
  if (b.minLatencyMs !== null) into.minLatencyMs = into.minLatencyMs === null ? b.minLatencyMs : Math.min(into.minLatencyMs, b.minLatencyMs);
  if (b.maxLatencyMs !== null) into.maxLatencyMs = into.maxLatencyMs === null ? b.maxLatencyMs : Math.max(into.maxLatencyMs, b.maxLatencyMs);
  for (const [k, v] of Object.entries(b.agents)) into.agents[k] = (into.agents[k] ?? 0) + v;
  for (const [k, v] of Object.entries(b.conversations)) into.conversations[k] = (into.conversations[k] ?? 0) + v;
  for (const [k, v] of Object.entries(b.models)) into.models[k] = (into.models[k] ?? 0) + v;
  for (const [k, g] of Object.entries(b.gauges)) {
    const t = into.gauges[k];
    if (!t) into.gauges[k] = { ...g };
    else {
      t.min = Math.min(t.min, g.min);
      t.max = Math.max(t.max, g.max);
      t.sum += g.sum;
      t.n += g.n;
      t.last = g.last;
    }
  }
}

function keyFor(resolution: Resolution, hourKey: string): string {
  if (resolution === "day") return hourKey.slice(0, 10);
  if (resolution === "month") return hourKey.slice(0, 7);
  if (resolution === "week") {
    const d = new Date(`${hourKey.slice(0, 10)}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
    return `${monday.toISOString().slice(0, 10)} wk`;
  }
  return hourKey;
}

function startOf(key: string): number {
  const iso = key.replace(" wk", "");
  const full = iso.length === 7 ? `${iso}-01T00:00` : iso.length === 10 ? `${iso}T00:00` : iso.length === 13 ? `${iso}:00` : iso;
  return Date.parse(`${full}:00Z`);
}

export function toPoint(key: string, b: UsageBucket): Point {
  const tokens = b.tokenReportedCalls > 0;
  return {
    key,
    start: startOf(key),
    calls: b.calls,
    failed: b.failed,
    rateLimited: b.rateLimited,
    inputTokens: tokens ? b.inputTokens : null,
    outputTokens: tokens ? b.outputTokens : null,
    cachedTokens: tokens ? b.cachedInputTokens : null,
    reasoningTokens: tokens ? b.reasoningTokens : null,
    avgLatencyMs: b.calls ? Math.round(b.latencyMs / b.calls) : null,
    maxLatencyMs: b.maxLatencyMs,
    gauges: Object.fromEntries(Object.entries(b.gauges).map(([k, g]) => [k, { min: g.min, max: g.max, avg: Math.round((g.sum / g.n) * 10) / 10, last: g.last }])),
    bucket: b,
  };
}

/** Usage at a resolution, optionally within [from, to] (ms). Buckets with no data are absent. */
export function series(resolution: Resolution, range: { from?: number; to?: number } = {}, ledger = UsageLedger.getInstance()): Point[] {
  const base = ledger.rollups(resolution === "minute" ? "minute" : "hour");
  const grouped = new Map<string, UsageBucket>();
  for (const { key, bucket } of base) {
    const k = resolution === "minute" ? key : keyFor(resolution, key);
    merge(grouped.get(k) ?? grouped.set(k, emptyBucket()).get(k)!, bucket);
  }
  return [...grouped.entries()]
    .map(([k, b]) => toPoint(k, b))
    .filter((p) => (range.from === undefined || p.start >= range.from) && (range.to === undefined || p.start <= range.to))
    .sort((a, b) => a.start - b.start);
}

/** Lowest / highest / average / current / peak for one metric over points (WP19.4). */
export function rangeOf(points: Point[], metric: string, read: (p: Point) => number | null, capacity: number | null = null): Range {
  const values = points.map((p) => ({ key: p.key, v: read(p) })).filter((x): x is { key: string; v: number } => typeof x.v === "number");
  if (!values.length) return { metric, availability: "unavailable", lowest: null, lowestAt: null, highest: null, highestAt: null, average: null, current: null, peak: null, capacity, remaining: null, pctUsed: null, trend: "unknown" };
  let lo = values[0];
  let hi = values[0];
  for (const x of values) {
    if (x.v < lo.v) lo = x;
    if (x.v > hi.v) hi = x;
  }
  const avg = values.reduce((s, x) => s + x.v, 0) / values.length;
  const current = values.at(-1)!.v;
  const half = Math.floor(values.length / 2);
  const a = half ? values.slice(0, half).reduce((s, x) => s + x.v, 0) / half : 0;
  const b = values.length - half ? values.slice(half).reduce((s, x) => s + x.v, 0) / (values.length - half) : 0;
  const trend = values.length < 4 ? "unknown" : b > a * 1.15 ? "rising" : b < a * 0.85 ? "falling" : "flat";
  return {
    metric,
    availability: "measured",
    lowest: lo.v,
    lowestAt: lo.key,
    highest: hi.v,
    highestAt: hi.key,
    average: Math.round(avg * 100) / 100,
    current,
    peak: hi.v,
    capacity,
    remaining: capacity === null ? null : Math.max(0, capacity - current),
    pctUsed: capacity ? Math.round((current / capacity) * 1000) / 10 : null,
    trend,
  };
}

/** The system-level ranges at a resolution, with capacity from the owner's limits. */
export function systemRanges(resolution: Resolution, range: { from?: number; to?: number } = {}): Range[] {
  const pts = series(resolution, range);
  const p = ResourcePolicy.getInstance().get();
  const hourly = resolution === "hour";
  const gauge = (name: string) => (x: Point) => x.gauges[name]?.max ?? null;
  return [
    rangeOf(pts, "model calls", (x) => x.calls, hourly ? p.hourlyCalls : null),
    rangeOf(pts, "input tokens (reported)", (x) => x.inputTokens, null),
    rangeOf(pts, "output tokens (reported)", (x) => x.outputTokens, null),
    rangeOf(pts, "cached tokens (reported)", (x) => x.cachedTokens, null),
    rangeOf(pts, "reasoning tokens (reported)", (x) => x.reasoningTokens, null),
    rangeOf(pts, "failed calls", (x) => x.failed),
    rangeOf(pts, "rate-limited calls", (x) => x.rateLimited),
    rangeOf(pts, "average latency ms", (x) => x.avgLatencyMs),
    rangeOf(pts, "active conversations", gauge("activeConversations"), p.maxConcurrentConversations),
    rangeOf(pts, "calls in flight", gauge("inFlightCalls"), p.maxConcurrentCalls),
    rangeOf(pts, "JS heap MB", gauge("jsHeapMB"), pts.at(-1)?.gauges.jsHeapLimitMB?.last ?? null),
    rangeOf(pts, "event-loop lag ms", gauge("eventLoopLagMs")),
    rangeOf(pts, "API bytes / min", gauge("apiBytesPerMin")),
  ];
}

/** Ranges across a set of conversation records (per-conversation level). */
export function conversationRanges(records: ConversationRecord[]): Range[] {
  const pts = records.map((r) => ({ key: r.id, r }));
  const mk = (metric: string, read: (r: ConversationRecord) => number | null) => {
    const values = pts.map((x) => ({ key: x.key, v: read(x.r) })).filter((x): x is { key: string; v: number } => typeof x.v === "number");
    if (!values.length) return { metric, availability: "unavailable" as const, lowest: null, lowestAt: null, highest: null, highestAt: null, average: null, current: null, peak: null, capacity: null, remaining: null, pctUsed: null, trend: "unknown" as const };
    const sorted = [...values].sort((a, b) => a.v - b.v);
    return {
      metric,
      availability: "measured" as const,
      lowest: sorted[0].v,
      lowestAt: sorted[0].key,
      highest: sorted.at(-1)!.v,
      highestAt: sorted.at(-1)!.key,
      average: Math.round((values.reduce((s, x) => s + x.v, 0) / values.length) * 100) / 100,
      current: values[0].v,
      peak: sorted.at(-1)!.v,
      capacity: null,
      remaining: null,
      pctUsed: null,
      trend: "unknown" as const,
    };
  };
  return [
    mk("model calls per conversation", (r) => r.modelCalls),
    mk("reported tokens per conversation", (r) => (r.tokenReportedCalls ? r.inputTokens + r.outputTokens : null)),
    mk("tool calls per conversation", (r) => r.toolCalls),
    mk("max latency ms", (r) => r.latency.max),
  ];
}

/** Per-agent usage over points (from the ledger buckets' agent counts). */
export function byAgent(points: Point[]): Array<{ agentId: string; calls: number }> {
  const m = new Map<string, number>();
  for (const p of points) for (const [a, n] of Object.entries(p.bucket.agents)) m.set(a, (m.get(a) ?? 0) + n);
  return [...m.entries()].map(([agentId, calls]) => ({ agentId, calls })).sort((a, b) => b.calls - a.calls);
}

export function byModel(points: Point[]): Array<{ model: string; calls: number }> {
  const m = new Map<string, number>();
  for (const p of points) for (const [k, n] of Object.entries(p.bucket.models)) m.set(k, (m.get(k) ?? 0) + n);
  return [...m.entries()].map(([model, calls]) => ({ model, calls })).sort((a, b) => b.calls - a.calls);
}

export function topConversations(n = 5, since?: number): ConversationRecord[] {
  return ConversationRegistry.getInstance()
    .list(since !== undefined ? { from: since } : {})
    .sort((a, b) => b.modelCalls - a.modelCalls || b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
    .slice(0, n);
}

/* ---------------------------------------------------------- alerts (WP19.7) */

export interface Alert {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  recommendation: string;
  /** The records behind it. */
  evidence: string[];
}

export function alerts(now = Date.now(), policy: Policy = ResourcePolicy.getInstance().get()): Alert[] {
  const out: Alert[] = [];
  const minutes = series("minute", { from: now - 3_600_000 });
  const last = minutes.at(-1);
  const prior = minutes.slice(0, -1);
  if (last && prior.length >= 5) {
    const avg = prior.reduce((s, p) => s + p.calls, 0) / prior.length;
    if (avg > 0 && last.calls >= avg * policy.alerts.spikeFactor && last.calls >= 5)
      out.push({ id: "spike", severity: "warning", title: "Usage spike", detail: `${last.calls} model calls in the minute ${last.key}, ${Math.round(last.calls / avg)}× the hour's average (${avg.toFixed(1)}).`, recommendation: "Open the top conversations of that minute; throttle the one driving it or set a per-conversation hourly limit.", evidence: Object.keys(last.bucket.conversations) });
  }
  const rate = minutes.reduce((s, p) => s + p.rateLimited, 0);
  if (rate > 0) out.push({ id: "rate-limit", severity: "warning", title: "Provider rate limits hit", detail: `${rate} call(s) were refused as rate-limited in the last hour.`, recommendation: "Lower 'Model calls at once', or add a cooldown so calls spread out.", evidence: [] });
  const reg = ConversationRegistry.getInstance();
  for (const r of reg.list({ from: now - 3_600_000 })) {
    const [tool, count] = Object.entries(r.tools).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (tool && count >= policy.alerts.repeatedToolCalls)
      out.push({ id: `loop:${r.id}`, severity: "warning", title: "Repeated tool calls", detail: `${r.title}: ${tool} was called ${count} times.`, recommendation: "This may be a loop. Inspect it; throttle or terminate it if it is not making progress.", evidence: [r.id] });
    if (r.modelCalls >= 10 && r.messagesOut === 0 && r.type !== "background" && r.type !== "unattributed")
      out.push({ id: `unproductive:${r.id}`, severity: "info", title: "Consuming without output", detail: `${r.title}: ${r.modelCalls} model calls and no reply delivered.`, recommendation: "Check whether it is stuck; pause it to stop further use.", evidence: [r.id] });
    if (r.failedCalls >= 3) out.push({ id: `failing:${r.id}`, severity: "warning", title: "Failing workload", detail: `${r.title}: ${r.failedCalls} failed calls (last: ${r.errors.at(-1)?.message ?? "?"}).`, recommendation: "Pause it until the provider recovers, or switch its provider.", evidence: [r.id] });
  }
  for (const r of reg.list({ status: ["active"] }))
    if (now - r.lastActivityAt > policy.alerts.stalledMinutes * 60_000)
      out.push({ id: `stalled:${r.id}`, severity: "info", title: "Stalled", detail: `${r.title} has been active with no activity for ${Math.round((now - r.lastActivityAt) / 60_000)} min.`, recommendation: "Terminate it if nothing is expected from it.", evidence: [r.id] });
  const hour = ResourcePolicy.getInstance().hourCounters();
  if (policy.hourlyCalls && hour.calls >= (policy.hourlyCalls * policy.alerts.budgetWarnPct) / 100)
    out.push({ id: "hourly-budget", severity: hour.calls >= policy.hourlyCalls ? "critical" : "warning", title: "Hourly limit", detail: `${hour.calls} of ${policy.hourlyCalls} model calls used this hour.`, recommendation: "Raise the hourly limit or pause background work until the hour resets.", evidence: [] });
  const g = last?.gauges ?? {};
  if (g.jsHeapMB && g.jsHeapLimitMB && g.jsHeapMB.max > g.jsHeapLimitMB.last * 0.8)
    out.push({ id: "memory", severity: "warning", title: "Memory pressure", detail: `JS heap ${g.jsHeapMB.max} MB of ${g.jsHeapLimitMB.last} MB.`, recommendation: "Close unused 3D views and windows.", evidence: [] });
  if (policy.maxConcurrentConversations && g.activeConversations && g.activeConversations.max >= policy.maxConcurrentConversations * 0.8)
    out.push({ id: "concurrency", severity: "info", title: "Many concurrent sessions", detail: `${g.activeConversations.max} active conversations (limit ${policy.maxConcurrentConversations}).`, recommendation: "Pause background or idle conversations.", evidence: [] });
  if (policy.emergencyStop) out.push({ id: "emergency", severity: "critical", title: "Emergency stop is on", detail: policy.emergencyStop.reason, recommendation: "Release it when you are ready; no model call is sent until then.", evidence: [] });
  return out;
}

/* ---------------------------------------------------------- export (WP19.8) */

export function exportJson(): string {
  const ledger = UsageLedger.getInstance();
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      conversations: ConversationRegistry.getInstance().exportAll(),
      minutes: ledger.rollups("minute"),
      hours: ledger.rollups("hour"),
      events: ledger.allEvents(),
      policy: ResourcePolicy.getInstance().get(),
      unavailable: UNAVAILABLE,
    },
    null,
    1,
  );
}

export function exportCsv(): string {
  const cols = ["id", "parentId", "type", "status", "initiator", "title", "participants", "startedAt", "lastActivityAt", "endedAt", "messagesIn", "messagesOut", "modelCalls", "failedCalls", "rateLimited", "tokenReportedCalls", "inputTokens", "outputTokens", "toolCalls", "providers", "models"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = ConversationRegistry.getInstance()
    .exportAll()
    .map((r) =>
      [r.id, r.parentId, r.type, r.status, r.initiator, r.title, r.participants.join(" "), new Date(r.startedAt).toISOString(), new Date(r.lastActivityAt).toISOString(), r.endedAt ? new Date(r.endedAt).toISOString() : "", r.messagesIn, r.messagesOut, r.modelCalls, r.failedCalls, r.rateLimited, r.tokenReportedCalls, r.tokenReportedCalls ? r.inputTokens : "", r.tokenReportedCalls ? r.outputTokens : "", r.toolCalls, JSON.stringify(r.providers), JSON.stringify(r.models)]
        .map(esc)
        .join(","),
    );
  return [cols.join(","), ...rows].join("\n");
}
