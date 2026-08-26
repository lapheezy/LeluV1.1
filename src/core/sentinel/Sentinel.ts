/**
 * ==========================================================
 * LÉLU — SENTINEL
 *
 * Persistent system awareness layer. Monitors:
 * - APIs and providers
 * - Cognition health
 * - Memory status
 * - Agent activity
 * - UI events (tabs, panels, chat)
 * - Performance (render time, memory usage)
 * - Errors and warnings
 * - Runtime state
 *
 * Converts raw events into meaningful world-state updates
 * that LELU, Architect, and Engineering can act on.
 * ==========================================================
 */

import CapabilityManifest from "../capabilities/CapabilityManifest";

export type SentinelEventType =
  | "provider_health"
  | "provider_error"
  | "cognition_active"
  | "cognition_error"
  | "memory_update"
  | "memory_error"
  | "agent_created"
  | "agent_completed"
  | "agent_error"
  | "tab_opened"
  | "tab_closed"
  | "chat_started"
  | "chat_error"
  | "performance_warning"
  | "runtime_start"
  | "runtime_error"
  | "system_event";

export type SentinelSeverity = "info" | "warning" | "error" | "critical";

export interface SentinelEvent {
  id: string;
  type: SentinelEventType;
  severity: SentinelSeverity;
  message: string;
  timestamp: number;
  source: string;
  metadata?: Record<string, unknown>;
  acknowledged: boolean;
}

export type SentinelListener = (event: SentinelEvent) => void;

export interface SentinelSnapshot {
  events: SentinelEvent[];
  activeWarnings: number;
  activeErrors: number;
  lastCheck: number;
  uptime: number;
}

export default class Sentinel {
  private static instance: Sentinel | null = null;
  private events: SentinelEvent[] = [];
  private listeners = new Set<SentinelListener>();
  private startTime = Date.now();
  private idCounter = 0;
  private maxEvents = 200;

  private constructor() {}

  static getInstance(): Sentinel {
    if (!Sentinel.instance) {
      Sentinel.instance = new Sentinel();
    }
    return Sentinel.instance;
  }

  // ---- Event reporting ----

  report(
    type: SentinelEventType,
    severity: SentinelSeverity,
    message: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): SentinelEvent {
    const event: SentinelEvent = {
      id: `sentinel-${++this.idCounter}`,
      type,
      severity,
      message,
      timestamp: Date.now(),
      source,
      metadata,
      acknowledged: false,
    };

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(0, this.maxEvents);
    }

    // Update capability manifest based on event type
    this.syncCapabilities(event);

    this.notify(event);
    return event;
  }

  /** Shorthand for info-level events */
  info(
    type: SentinelEventType,
    message: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): SentinelEvent {
    return this.report(type, "info", message, source, metadata);
  }

  /** Shorthand for warnings */
  warn(
    type: SentinelEventType,
    message: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): SentinelEvent {
    return this.report(type, "warning", message, source, metadata);
  }

  /** Shorthand for errors */
  error(
    type: SentinelEventType,
    message: string,
    source: string,
    metadata?: Record<string, unknown>,
  ): SentinelEvent {
    return this.report(type, "error", message, source, metadata);
  }

  // ---- Acknowledgment ----

  acknowledge(eventId: string): void {
    const event = this.events.find((e) => e.id === eventId);
    if (event) event.acknowledged = true;
  }

  acknowledgeAll(): void {
    for (const event of this.events) event.acknowledged = true;
  }

  // ---- Queries ----

  getSnapshot(): SentinelSnapshot {
    const activeWarnings = this.events.filter(
      (e) => e.severity === "warning" && !e.acknowledged,
    ).length;
    const activeErrors = this.events.filter(
      (e) =>
        (e.severity === "error" || e.severity === "critical") &&
        !e.acknowledged,
    ).length;

    return {
      events: this.events.slice(0, 50), // last 50
      activeWarnings,
      activeErrors,
      lastCheck: Date.now(),
      uptime: Date.now() - this.startTime,
    };
  }

  getUnacknowledged(): SentinelEvent[] {
    return this.events.filter((e) => !e.acknowledged);
  }

  getByType(type: SentinelEventType): SentinelEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  getBySeverity(severity: SentinelSeverity): SentinelEvent[] {
    return this.events.filter((e) => e.severity === severity);
  }

  // ---- Subscriptions ----

  subscribe(fn: SentinelListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- Internal ----

  private notify(event: SentinelEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private syncCapabilities(event: SentinelEvent): void {
    const cap = CapabilityManifest.getInstance();
    switch (event.type) {
      case "provider_health":
        cap.markUsed("ai-chat");
        break;
      case "provider_error":
        cap.updateStatus("ai-chat", "degraded", event.message);
        break;
      case "memory_update":
        cap.markUsed("short-term-memory");
        break;
      case "memory_error":
        cap.updateStatus("long-term-memory", "degraded", event.message);
        break;
      case "agent_created":
        cap.markUsed("agent-registry");
        break;
      case "runtime_error":
        cap.updateStatus("ai-chat", "degraded", event.message);
        break;
    }
  }
}