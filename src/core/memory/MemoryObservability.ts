/**
 * ==========================================================
 * LÉLU — WHAT MEMORY AND EXECUTION ACTUALLY COST
 *
 * Mission 44.6/44.7 measured one turn at a time. That answers \"is this
 * turn slow?\" and not \"is memory growing, is retrieval getting worse, is
 * work being resumed without repeating itself?\". Those are questions
 * about a window, so they need a record that outlives a turn.
 *
 * This is a content-free journal. Every entry is a count, a duration, an
 * outcome and identifiers — never a message, a prompt or a memory's text.
 * The journal is bounded (both by age and by count), persisted through the
 * existing KvStore, and readable at the levels the mission asks for:
 * minute, hour, day, and by project, agent and conversation.
 *
 * HONESTY ABOUT NUMBERS
 * ---------------------
 * `availability` says, per metric, whether it is measured, estimated or
 * unavailable — and it is computed from the journal, not asserted. A
 * retrieval latency is measured only if some retrieval reported one; a
 * relevance rate is measured only if a caller reported how many of the
 * records it retrieved were actually used. Nothing here invents a value
 * to fill a column.
 *
 * MANUAL CONTROLS
 * ---------------
 * `configure()` can pause recording, change retention or cap the journal.
 * Those are the same knobs an operator needs when memory becomes a cost
 * problem, and they take effect immediately because every read goes
 * through the same instance.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type MemoryEventKind =
  | "memory-write"
  | "memory-write-failed"
  | "retrieval"
  | "retrieval-failed"
  | "conflict"
  | "stale"
  | "cross-conversation"
  | "work-resumed"
  | "duplicate-prevented"
  | "approval"
  | "rejection"
  | "governance-denied";

export interface MemoryEvent {
  at: number;
  kind: MemoryEventKind;
  /** Content-free identifiers only. */
  conversationId?: string;
  projectId?: string;
  agentId?: string;
  /** How long the operation took, when it was measured. */
  latencyMs?: number;
  /** Records retrieved. */
  items?: number;
  /** Of those, records that were actually used. */
  relevant?: number;
  /** A count that belongs to the event (steps resumed, writes refused…). */
  count?: number;
  /** A short, content-free reason string. */
  detail?: string;
}

export interface WindowStats {
  windowMs: number | null;
  events: number;
  writes: number;
  writeFailures: number;
  retrievals: number;
  retrievalFailures: number;
  latency: { min: number | null; max: number | null; average: number | null; samples: number };
  /** relevant / items, over the events that reported both. */
  relevanceRate: number | null;
  conflicts: number;
  stale: number;
  crossConversation: number;
  workResumed: number;
  duplicatePrevented: number;
  approvals: number;
  rejections: number;
  governanceDenied: number;
  itemsRetrieved: number;
}

export type Availability = "measured" | "estimated" | "unavailable";

export interface MemorySnapshot {
  generatedAt: number;
  /** Oldest retained event, or null when the journal is empty. */
  since: number | null;
  retained: number;
  window: { configured: number; maxEvents: number; enabled: boolean; persisted: boolean };
  minute: WindowStats;
  hour: WindowStats;
  day: WindowStats;
  total: WindowStats;
  byProject: Record<string, WindowStats>;
  byAgent: Record<string, WindowStats>;
  byConversation: Record<string, WindowStats>;
  storage: {
    /** Bytes of this journal, as measured from its serialised form. */
    journalBytes: number;
    /** Whole-store consumption: not measurable from inside the journal. */
    storeBytes: null;
  };
  availability: {
    writes: Availability;
    retrievals: Availability;
    retrievalLatency: Availability;
    relevance: Availability;
    conflicts: Availability;
    stale: Availability;
    storageBytes: Availability;
    totalStoreBytes: Availability;
  };
}

// KvStore prefixes keys itself; see the note in StandingInstructions.
const KEY = "memory.observability.v1";

const DEFAULTS = {
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  maxEvents: 600,
  enabled: true,
};

/** An empty window: every counter zero, every statistic absent. */
export function emptyStats(windowMs: number | null): WindowStats {
  return {
    windowMs,
    events: 0,
    writes: 0,
    writeFailures: 0,
    retrievals: 0,
    retrievalFailures: 0,
    latency: { min: null, max: null, average: null, samples: 0 },
    relevanceRate: null,
    conflicts: 0,
    stale: 0,
    crossConversation: 0,
    workResumed: 0,
    duplicatePrevented: 0,
    approvals: 0,
    rejections: 0,
    governanceDenied: 0,
    itemsRetrieved: 0,
  };
}

/** Fold a set of events into one window. Pure, so tests can call it directly. */
export function summarise(events: readonly MemoryEvent[], windowMs: number | null): WindowStats {
  const stats = emptyStats(windowMs);
  let latencySum = 0;
  let relevanceItems = 0;
  let relevanceUsed = 0;

  for (const event of events) {
    stats.events += 1;
    switch (event.kind) {
      case "memory-write":
        stats.writes += 1;
        break;
      case "memory-write-failed":
        stats.writeFailures += 1;
        break;
      case "retrieval":
        stats.retrievals += 1;
        break;
      case "retrieval-failed":
        stats.retrievalFailures += 1;
        break;
      case "conflict":
        stats.conflicts += 1;
        break;
      case "stale":
        stats.stale += 1;
        break;
      case "cross-conversation":
        stats.crossConversation += 1;
        break;
      case "work-resumed":
        stats.workResumed += 1;
        break;
      case "duplicate-prevented":
        stats.duplicatePrevented += 1;
        break;
      case "approval":
        stats.approvals += 1;
        break;
      case "rejection":
        stats.rejections += 1;
        break;
      case "governance-denied":
        stats.governanceDenied += 1;
        break;
    }
    if (typeof event.latencyMs === "number" && Number.isFinite(event.latencyMs)) {
      const value = Math.max(0, event.latencyMs);
      stats.latency.min = stats.latency.min === null ? value : Math.min(stats.latency.min, value);
      stats.latency.max = stats.latency.max === null ? value : Math.max(stats.latency.max, value);
      latencySum += value;
      stats.latency.samples += 1;
    }
    if (typeof event.items === "number") stats.itemsRetrieved += event.items;
    if (typeof event.items === "number" && typeof event.relevant === "number") {
      relevanceItems += event.items;
      relevanceUsed += Math.min(event.relevant, event.items);
    }
  }

  if (stats.latency.samples > 0) {
    stats.latency.average = Math.round((latencySum / stats.latency.samples) * 10) / 10;
  }
  if (relevanceItems > 0) {
    stats.relevanceRate = Math.round((relevanceUsed / relevanceItems) * 1000) / 1000;
  }
  return stats;
}

/** Group events by one identifier, keeping the order they first appeared. */
function groupBy(events: readonly MemoryEvent[], pick: (event: MemoryEvent) => string | undefined): Record<string, WindowStats> {
  const groups = new Map<string, MemoryEvent[]>();
  for (const event of events) {
    const key = pick(event);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(event);
    else groups.set(key, [event]);
  }
  const out: Record<string, WindowStats> = {};
  for (const [key, bucket] of groups) out[key] = summarise(bucket, null);
  return out;
}

export default class MemoryObservability {
  private static instance: MemoryObservability | null = null;

  private readonly kv = KvStore.getInstance();
  private events: MemoryEvent[] = [];
  private config = { ...DEFAULTS };
  private loaded = false;

  private constructor() {}

  public static getInstance(): MemoryObservability {
    if (!MemoryObservability.instance) MemoryObservability.instance = new MemoryObservability();
    return MemoryObservability.instance;
  }

  /** Test seam: drop the singleton so each test starts from an empty journal. */
  public static resetForTests(): void {
    MemoryObservability.instance = null;
  }

  /** Read the journal once, lazily — construction must not touch storage. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const stored = this.kv.get<{ events?: MemoryEvent[]; config?: Partial<typeof DEFAULTS> }>(KEY);
    const events = stored?.events;
    this.events = Array.isArray(events) ? events.filter((event) => this.isEvent(event)) : [];
    if (stored?.config && typeof stored.config === "object") {
      this.config = { ...DEFAULTS, ...stored.config };
    }
  }

  private isEvent(value: unknown): value is MemoryEvent {
    if (!value || typeof value !== "object") return false;
    const event = value as Partial<MemoryEvent>;
    return typeof event.at === "number" && typeof event.kind === "string";
  }

  /**
   * Manual resource controls. Returns the configuration actually in force,
   * so a caller that asks for something refused can see the difference.
   */
  public configure(patch: Partial<typeof DEFAULTS>): typeof DEFAULTS {
    this.ensureLoaded();
    if (typeof patch.enabled === "boolean") this.config.enabled = patch.enabled;
    if (typeof patch.retentionMs === "number" && patch.retentionMs >= 0) {
      this.config.retentionMs = Math.round(patch.retentionMs);
    }
    if (typeof patch.maxEvents === "number" && patch.maxEvents > 0) {
      this.config.maxEvents = Math.round(patch.maxEvents);
    }
    this.trim(Date.now());
    this.persist();
    return { ...this.config };
  }

  public configuration(): typeof DEFAULTS {
    this.ensureLoaded();
    return { ...this.config };
  }

  /**
   * Record one event.
   *
   * Never throws: observability is a report about the system, and a report
   * that can fail the thing it observes is worse than no report.
   */
  public record(event: Omit<MemoryEvent, "at"> & { at?: number }): void {
    try {
      this.ensureLoaded();
      if (!this.config.enabled) return;
      const full: MemoryEvent = { ...event, at: event.at ?? Date.now() };
      this.events.push(full);
      this.trim(full.at);
      this.persist();
    } catch {
      /* a full or absent store must not break a turn */
    }
  }

  /** The retained events, newest last, optionally limited to a window. */
  public journal(options: { windowMs?: number; now?: number } = {}): MemoryEvent[] {
    this.ensureLoaded();
    const now = options.now ?? Date.now();
    const cutoff = options.windowMs === undefined ? 0 : now - options.windowMs;
    return this.events.filter((event) => event.at >= cutoff);
  }

  public snapshot(now = Date.now()): MemorySnapshot {
    this.ensureLoaded();
    const all = this.events;
    const within = (windowMs: number) => all.filter((event) => event.at >= now - windowMs);

    const serialised = JSON.stringify(all);
    const measuredLatency = all.some((event) => typeof event.latencyMs === "number");
    const measuredRelevance = all.some((event) => typeof event.items === "number" && typeof event.relevant === "number");

    return {
      generatedAt: now,
      // The OLDEST retained event, not the first one inserted: entries can be
      // recorded with an explicit time that is earlier than one already kept.
      since: all.length > 0 ? Math.min(...all.map((event) => event.at)) : null,
      retained: all.length,
      window: {
        configured: this.config.retentionMs,
        maxEvents: this.config.maxEvents,
        enabled: this.config.enabled,
        persisted: true,
      },
      minute: summarise(within(60_000), 60_000),
      hour: summarise(within(60 * 60_000), 60 * 60_000),
      day: summarise(within(24 * 60 * 60_000), 24 * 60 * 60_000),
      total: summarise(all, null),
      byProject: groupBy(all, (event) => event.projectId),
      byAgent: groupBy(all, (event) => event.agentId),
      byConversation: groupBy(all, (event) => event.conversationId),
      storage: { journalBytes: serialised.length, storeBytes: null },
      availability: {
        writes: all.length > 0 ? "measured" : "unavailable",
        retrievals: all.some((event) => event.kind === "retrieval") ? "measured" : "unavailable",
        retrievalLatency: measuredLatency ? "measured" : "unavailable",
        relevance: measuredRelevance ? "measured" : "unavailable",
        conflicts: all.some((event) => event.kind === "conflict") ? "measured" : "unavailable",
        stale: all.some((event) => event.kind === "stale") ? "measured" : "unavailable",
        storageBytes: "measured",
        // The journal cannot see the rest of the store; reporting a number
        // here would be an estimate dressed as a measurement.
        totalStoreBytes: "unavailable",
      },
    };
  }

  /** Drop everything. An operator control, not something a turn calls. */
  public clear(): void {
    this.ensureLoaded();
    this.events = [];
    this.persist();
  }

  /** Age out old entries and enforce the cap, oldest first. */
  private trim(now: number): void {
    const cutoff = now - this.config.retentionMs;
    if (this.config.retentionMs > 0) {
      this.events = this.events.filter((event) => event.at >= cutoff);
    }
    if (this.events.length > this.config.maxEvents) {
      this.events = this.events.slice(this.events.length - this.config.maxEvents);
    }
  }

  private persist(): void {
    try {
      this.kv.set(KEY, { events: this.events, config: this.config });
    } catch {
      /* best-effort, as above */
    }
  }
}
