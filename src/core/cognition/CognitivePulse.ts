/**
 * ==========================================================
 * LÉLU — COGNITIVE PULSE
 *
 * Mission 14's bounded, event-driven awareness.
 *
 * This is a REDUCER over the existing AgentEventBus, not a new
 * event system and not a polling loop. It subscribes once, keeps
 * a bounded window of events that actually change the operational
 * picture, and persists a short digest so continuity survives a
 * reload.
 *
 * What it deliberately does NOT do:
 *   - no timers, no intervals, no "background consciousness";
 *   - no emitting onto the bus it listens to (no feedback loop);
 *   - no narration of every token, resize or hover;
 *   - no duplicate entry when several agents report the same
 *     failure inside the dedupe window.
 *
 * A pulse entry is a record of something that HAPPENED. It is not
 * a prediction and it never upgrades a failure to progress.
 * ==========================================================
 */

import AgentEventBus, { type AgentEvent } from "../agent/AgentEvents.ts";
import KvStore from "../storage/KvStore.ts";
import { redactText } from "../operational-intelligence/evidence.ts";

export type PulseKind =
  | "progress"
  | "failure"
  | "degradation"
  | "approval"
  | "workspace"
  | "cognition";

export type PulseSeverity = "info" | "attention" | "critical";

export interface PulseEntry {
  id: string;
  at: number;
  kind: PulseKind;
  severity: PulseSeverity;
  /** The event type that produced it. */
  event: string;
  /** Plain-language summary, secret-redacted. */
  summary: string;
  taskId: string;
  /** Whether the last persistence attempt accepted the digest. */
  durable: boolean;
}

export interface PulseSummary {
  total: number;
  byKind: Record<PulseKind, number>;
  attention: number;
  critical: number;
  latest: number | null;
  durable: boolean;
}

interface PulseBus {
  subscribe(listener: (event: AgentEvent) => void): () => void;
}

export interface CognitivePulseOptions {
  bus?: PulseBus;
  kv?: KvStore;
  now?: () => number;
  dedupeWindowMs?: number;
}

const KEY = "lelu.pulse.v1";
const HISTORY_LIMIT = 120;
const PERSIST_LIMIT = 40;
const DEFAULT_DEDUPE_MS = 20_000;
const FINGERPRINT_LIMIT = 200;

function newId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return `pulse-${cryptoApi.randomUUID().slice(0, 8)}`;
  }
  return `pulse-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Translate one real event into at most one meaningful pulse.
 *
 * Exported for direct testing: the mapping is the whole policy, and
 * a policy that cannot be tested on its own tends to grow noise.
 */
export function pulseForEvent(
  event: AgentEvent,
  at: number,
): Omit<PulseEntry, "id" | "durable"> | null {
  const base = { at, taskId: event.taskId, event: event.type } as const;

  switch (event.type) {
    case "task_failed":
      return {
        ...base,
        kind: "failure",
        severity: "critical",
        summary: `Task failed: ${event.label}${event.error ? ` — ${event.error}` : ""}`,
      };
    case "task_completed":
      return {
        ...base,
        kind: "progress",
        severity: "info",
        summary: `Task completed: ${event.label}`,
      };
    case "agent_failed":
      return {
        ...base,
        kind: "failure",
        severity: "attention",
        summary: `Agent ${event.agent} failed: ${event.objective}${event.error ? ` — ${event.error}` : ""}`,
      };
    case "agent_completed":
      return {
        ...base,
        kind: "progress",
        severity: "info",
        summary: `Agent ${event.agent} completed: ${event.objective}`,
      };
    case "tool_failed":
      return {
        ...base,
        kind: "failure",
        severity: "attention",
        summary: `Tool ${event.tool} failed${event.error ? `: ${event.error}` : ""}`,
      };
    case "provider_status": {
      // Only a status that changes what is possible is an operational event.
      if (!/fail|unavailable|reject|error|exhaust|blocked/i.test(event.status)) return null;
      return {
        ...base,
        kind: "degradation",
        severity: "attention",
        summary: `Provider ${event.provider} reported ${event.status}`,
      };
    }
    case "execution_phase": {
      if (event.phase !== "provider_failed" && event.phase !== "provider_fallback") return null;
      return {
        ...base,
        kind: "degradation",
        severity: "attention",
        summary: `${event.label}${event.detail ? ` — ${event.detail}` : ""}`,
      };
    }
    case "approval_requested":
      return {
        ...base,
        kind: "approval",
        severity: "attention",
        summary: `Approval needed: ${event.title}`,
      };
    case "approval_resolved":
      return {
        ...base,
        kind: "approval",
        severity: "info",
        summary: `Approval ${event.approvalId} was ${event.decision}`,
      };
    case "workspace_open":
      return { ...base, kind: "workspace", severity: "info", summary: "Workspace opened" };
    case "workspace_minimize":
      return { ...base, kind: "workspace", severity: "info", summary: "Workspace minimized" };
    case "cognition": {
      // Only transitions that change what she knows or is waiting on.
      const meaningful = new Set([
        "objective-completed",
        "objective-scheduled",
        "objective-yielded",
        "question-asked",
        "approval-required",
        "lesson-persisted",
        "lesson-persist-refused",
        "completion-verified",
      ]);
      if (!meaningful.has(event.stage)) return null;
      const severity: PulseSeverity =
        event.stage === "question-asked" || event.stage === "approval-required"
          ? "attention"
          : event.stage === "lesson-persist-refused"
            ? "attention"
            : "info";
      return {
        ...base,
        kind: "cognition",
        severity,
        summary: `${event.stage}: ${event.detail}`,
      };
    }
    case "execution_evidence": {
      const outcome = (event.record as { outcome?: string }).outcome;
      if (outcome !== "failed" && outcome !== "timed-out") return null;
      return {
        ...base,
        kind: "failure",
        severity: "attention",
        summary: `Tool ${event.record.tool} ${outcome} during ${event.record.path}`,
      };
    }
    default:
      return null;
  }
}

export class CognitivePulse {
  private readonly bus: PulseBus;
  private readonly kv: KvStore;
  private readonly now: () => number;
  private readonly dedupeWindowMs: number;
  private readonly entries: PulseEntry[] = [];
  private readonly fingerprints = new Map<string, number>();
  private readonly listeners = new Set<(entry: PulseEntry) => void>();
  private unsubscribe: (() => void) | null = null;
  private durable = true;

  constructor(options: CognitivePulseOptions = {}) {
    this.bus = options.bus ?? AgentEventBus.getInstance();
    this.kv = options.kv ?? KvStore.getInstance();
    this.now = options.now ?? (() => Date.now());
    this.dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_MS;
    this.load();
  }

  /** Idempotent: subscribing twice does not duplicate entries. */
  public start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe((event) => this.observe(event));
  }

  /** Stop listening. Used by tests and by an explicit runtime shutdown. */
  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  public get running(): boolean {
    return this.unsubscribe !== null;
  }

  private load(): void {
    let stored: { entries?: unknown } | null = null;
    try {
      stored = this.kv.get<{ entries?: unknown }>(KEY);
    } catch {
      stored = null;
    }
    const raw = stored && Array.isArray(stored.entries) ? stored.entries : [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.summary !== "string" || typeof entry.at !== "number") continue;
      this.entries.push({
        id: typeof entry.id === "string" ? entry.id : newId(),
        at: entry.at,
        kind:
          entry.kind === "failure" ||
          entry.kind === "degradation" ||
          entry.kind === "approval" ||
          entry.kind === "workspace" ||
          entry.kind === "cognition"
            ? entry.kind
            : "progress",
        severity:
          entry.severity === "attention" || entry.severity === "critical" ? entry.severity : "info",
        event: typeof entry.event === "string" ? entry.event : "unknown",
        summary: redactText(entry.summary),
        taskId: typeof entry.taskId === "string" ? entry.taskId : "unknown",
        durable: true,
      });
    }
    this.trim();
  }

  private trim(): void {
    if (this.entries.length > HISTORY_LIMIT) {
      this.entries.splice(0, this.entries.length - HISTORY_LIMIT);
    }
  }

  private save(): boolean {
    try {
      this.durable = this.kv.set(KEY, { version: 1, entries: this.entries.slice(-PERSIST_LIMIT) });
    } catch {
      this.durable = false;
    }
    for (const entry of this.entries.slice(-PERSIST_LIMIT)) entry.durable = this.durable;
    return this.durable;
  }

  private pruneFingerprints(at: number): void {
    if (this.fingerprints.size <= FINGERPRINT_LIMIT) return;
    for (const [key, seenAt] of this.fingerprints) {
      if (at - seenAt > this.dedupeWindowMs) this.fingerprints.delete(key);
    }
  }

  /**
   * Feed one event. Public so a caller with its own event stream (a
   * test, an importer) can reuse the same policy without a second bus
   * subscription.
   */
  public observe(event: AgentEvent): PulseEntry | null {
    const at = this.now();
    const mapped = pulseForEvent(event, at);
    if (!mapped) return null;

    const fingerprint = `${mapped.kind}:${mapped.event}:${mapped.summary}`;
    const seenAt = this.fingerprints.get(fingerprint);
    if (seenAt !== undefined && at - seenAt <= this.dedupeWindowMs) return null;

    this.fingerprints.set(fingerprint, at);
    this.pruneFingerprints(at);

    const entry: PulseEntry = {
      ...mapped,
      summary: redactText(mapped.summary).slice(0, 400),
      id: newId(),
      durable: true,
    };
    this.entries.push(entry);
    this.trim();
    this.save();
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // An observer must never break the event path.
      }
    }
    return entry;
  }

  public subscribe(listener: (entry: PulseEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Newest-first. */
  public recent(count = 10): PulseEntry[] {
    return this.entries.slice(-Math.max(0, count)).reverse();
  }

  public summary(): PulseSummary {
    const byKind: Record<PulseKind, number> = {
      progress: 0,
      failure: 0,
      degradation: 0,
      approval: 0,
      workspace: 0,
      cognition: 0,
    };
    for (const entry of this.entries) byKind[entry.kind] += 1;
    return {
      total: this.entries.length,
      byKind,
      attention: this.entries.filter((entry) => entry.severity === "attention").length,
      critical: this.entries.filter((entry) => entry.severity === "critical").length,
      latest: this.entries.length > 0 ? this.entries[this.entries.length - 1]!.at : null,
      durable: this.durable,
    };
  }

  /** Compact, prompt-safe digest. Empty state is stated, not hidden. */
  public digest(limit = 6): string {
    const recent = this.recent(limit);
    const summary = this.summary();
    if (recent.length === 0) {
      return "COGNITIVE PULSE: no meaningful events have been observed in this runtime.";
    }
    return [
      `COGNITIVE PULSE — ${summary.total} recorded (${summary.attention} need attention, ${summary.critical} critical)` +
        (summary.durable ? "" : " · digest is memory-only"),
      ...recent.map((entry) => {
        const time = new Date(entry.at).toISOString().slice(11, 19);
        return `  ${time} [${entry.kind}/${entry.severity}] ${entry.summary}`;
      }),
    ].join("\n");
  }

  /** Clear the in-memory digest and its persisted copy. */
  public clear(): boolean {
    this.entries.length = 0;
    this.fingerprints.clear();
    try {
      this.durable = this.kv.set(KEY, { version: 1, entries: [] });
    } catch {
      this.durable = false;
    }
    return this.durable;
  }
}

let instance: CognitivePulse | null = null;

export default class CognitivePulseStore {
  public static getInstance(): CognitivePulse {
    if (!instance) instance = new CognitivePulse();
    return instance;
  }

  /** Test seam: replace the singleton with an isolated pulse. */
  public static setForTests(pulse: CognitivePulse | null): void {
    instance = pulse;
  }
}
