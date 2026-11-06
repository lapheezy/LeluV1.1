/**
 * ==========================================================
 * LÉLU — INTEGRATION RUNTIME STATE (server side)
 *
 * The bounded, in-memory record the studios read. It holds only
 * things that actually happened in this process:
 *
 *   • policy decisions the gate evaluated (engine + duration);
 *   • scans that really ran, with their real reports;
 *   • audit entries written beside those decisions;
 *   • the live relationship tuples;
 *   • the orchestrator's locks and outcome history;
 *   • the telemetry spans produced by real requests.
 *
 * Everything is cap-bounded. An observability surface that grows
 * without a limit becomes the outage it was meant to detect.
 *
 * Nothing here is seeded, simulated or pre-populated: a fresh
 * server answers "no decision has been made yet", which is the
 * truth, rather than a dashboard full of plausible numbers.
 * ==========================================================
 */

import Telemetry from "../../src/core/observability/Telemetry.ts";
import RelationshipStore from "../../src/core/security/authz/RelationshipStore.ts";
import EngineeringOrchestrator from "../../src/core/engineering/EngineeringOrchestrator.ts";
import type { runSecurityGate } from "./scanners.ts";

/** The gate's own report shape, taken from the function that produces it. */
type GateReport = Awaited<ReturnType<typeof runSecurityGate>>;

const MAX_DECISIONS = 100;
const MAX_SCANS = 20;
const MAX_AUDIT = 200;

export interface DecisionRecord {
  at: number;
  subjectKind: string;
  subjectId: string | null;
  action: string;
  resourceKind: string;
  resourceId: string | null;
  allowed: boolean;
  requiresApproval: boolean;
  rules: string[];
  engine: "opa" | "reference";
  durationMs: number;
  agrees: boolean;
  correlationId: string;
}

export interface AuditEntry {
  at: number;
  subject: string;
  action: string;
  resource: string;
  decision: string;
  engine: string;
  correlationId: string;
}

export interface ScanRecord {
  at: number;
  target: string;
  report: GateReport;
}

export class IntegrationState {
  private static instance: IntegrationState | null = null;

  public readonly telemetry = Telemetry.getInstance();
  public readonly relationships = RelationshipStore.getInstance();
  public readonly orchestrator = EngineeringOrchestrator.getInstance();

  private decisions: DecisionRecord[] = [];
  private scans: ScanRecord[] = [];
  private audit: AuditEntry[] = [];

  public static getInstance(): IntegrationState {
    if (!IntegrationState.instance) IntegrationState.instance = new IntegrationState();
    return IntegrationState.instance;
  }

  public recordDecision(record: Omit<DecisionRecord, "at">): DecisionRecord {
    const entry: DecisionRecord = { ...record, at: Date.now() };
    this.decisions.unshift(entry);
    if (this.decisions.length > MAX_DECISIONS) this.decisions.length = MAX_DECISIONS;
    this.recordAudit({
      subject: `${record.subjectKind}${record.subjectId ? `:${record.subjectId}` : ""}`,
      action: record.action,
      resource: record.resourceId ?? `${record.resourceKind}:*`,
      decision: record.allowed ? "allow" : record.requiresApproval ? "requires_approval" : "deny",
      engine: record.engine,
      correlationId: record.correlationId,
    });
    return entry;
  }

  public recordScan(target: string, report: GateReport): ScanRecord {
    const entry: ScanRecord = { at: Date.now(), target, report };
    this.scans.unshift(entry);
    if (this.scans.length > MAX_SCANS) this.scans.length = MAX_SCANS;
    return entry;
  }

  public recordAudit(entry: Omit<AuditEntry, "at">): void {
    this.audit.unshift({ ...entry, at: Date.now() });
    if (this.audit.length > MAX_AUDIT) this.audit.length = MAX_AUDIT;
  }

  public decisions_(): DecisionRecord[] {
    return [...this.decisions];
  }

  public scans_(): ScanRecord[] {
    return [...this.scans];
  }

  /**
   * Newest scan of any kind — what the Security Center shows by default.
   *
   * Flattened deliberately: the panel reads `gatePassed` and `results`
   * at the top level, and a nested `report` made both read as undefined,
   * which is exactly the kind of shape mismatch that turns an honest
   * screen into a blank one.
   */
  public lastScan(): (GateReport & { target: string; scannedAt: number }) | null {
    const [first] = this.scans;
    if (!first) return null;
    return { ...first.report, target: first.target, scannedAt: first.at };
  }

  public audit_(): AuditEntry[] {
    return [...this.audit];
  }

  public relationshipSummary(): { enforced: boolean; sessions: number; tuples: number; detail: string } {
    const tuples = this.relationships.all();
    const sessions = new Set(
      tuples
        .flatMap((tuple) => [tuple.user, tuple.object])
        .filter((value) => value.startsWith("session:"))
        .map((value) => value.slice("session:".length)),
    );
    return {
      enforced: true,
      sessions: sessions.size,
      tuples: tuples.length,
      detail:
        tuples.length === 0
          ? "No relationship tuple exists in this process yet. Device access therefore cannot be granted until a user grants a session."
          : `${tuples.length} live tuple(s), ${sessions.size} device session(s). Expired tuples are pruned on read; a revoked session fails its next call.`,
    };
  }

  public traceBuffer(): { spans: number; capacity: number } {
    return { spans: this.telemetry.recentTraces(500).reduce((total, trace) => total + trace.spanCount, 0), capacity: 2000 };
  }

  /** Test hook: clear the bounded records without touching singletons' identity. */
  public resetForTests(): void {
    this.decisions = [];
    this.scans = [];
    this.audit = [];
  }
}

export const integrationState = IntegrationState.getInstance();
