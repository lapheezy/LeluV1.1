/**
 * ==========================================================
 * LÉLU — CROSS-STUDIO OPERATIONAL INTELLIGENCE — TYPES
 *
 * What LÉLU is allowed to know about her own operational
 * reality, expressed in one vocabulary shared by all four
 * studios.
 *
 * The distinction this file exists to protect:
 *
 *   configured  ≠ available   (a variable is set, the service is down)
 *   available   ≠ authorized  (the engine runs, policy says no)
 *   authorized  ≠ executable  (policy agrees, no workspace exists)
 *   executable  ≠ verified    (it ran, nobody checked the result)
 *
 * A single boolean would collapse all four into "online", which is
 * exactly the lie this phase is meant to remove.
 * ==========================================================
 */

/** The truthful state of any capability or studio. */
export type OperationalState =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "AVAILABLE"
  | "DEGRADED"
  | "BLOCKED"
  | "AUTHORIZED"
  | "EXECUTING"
  | "COMPLETED"
  | "FAILED"
  | "VERIFIED"
  | "UNAVAILABLE";

/**
 * Where a fact came from. Evidence that was not observed must never
 * be presented as if it had been.
 *
 *   api         — read from an existing LÉLU API response
 *   local       — inspected on this machine (env, filesystem, process)
 *   external    — a real round trip to an outside service answered
 *   simulated   — a test double or fixture produced it
 *   unavailable — nothing could be observed; the state is an absence
 */
export type EvidenceProvenance = "api" | "local" | "external" | "simulated" | "unavailable";

export type StudioId = "engineering" | "voice" | "infrastructure" | "security";

export const STUDIO_IDS: readonly StudioId[] = ["engineering", "voice", "infrastructure", "security"];

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type FindingStatus = "open" | "acknowledged" | "remediated" | "accepted" | "false_positive";

export interface EvidenceReference {
  id: string;
  /** The API route, file, command or URL the fact was read from. */
  source: string;
  provenance: EvidenceProvenance;
  detail: string;
  at: number;
}

export interface CapabilityStatus {
  capabilityId: string;
  studioId: StudioId;
  label: string;
  configured: boolean;
  available: boolean;
  authorized: boolean;
  selectable: boolean;
  executable: boolean;
  verified: boolean;
  /** The single state that summarizes the flags above, in order. */
  state: OperationalState;
  /** Exactly why it is not usable, in the order the flags failed. */
  blockingReasons: string[];
  evidence: EvidenceReference[];
}

export interface DependencyStatus {
  dependencyId: string;
  dependentCapability: string;
  requiredCapability: string;
  /** True when the requirement is currently satisfied. */
  satisfied: boolean;
  state: OperationalState;
  blockingReason: string | null;
  evidence: EvidenceReference[];
}

export interface OperationalFinding {
  findingId: string;
  sourceStudio: StudioId;
  severity: FindingSeverity;
  category: "configuration" | "availability" | "authorization" | "execution" | "security" | "verification";
  description: string;
  affectedCapability: string | null;
  remediation: string;
  evidenceReference: string | null;
  status: FindingStatus;
}

export interface StudioStatus {
  studioId: StudioId;
  timestamp: number;
  operationalState: OperationalState;
  capabilities: CapabilityStatus[];
  unavailableCapabilities: string[];
  activeTasks: number;
  unresolvedFindings: number;
  dependencies: string[];
  evidenceReferences: EvidenceReference[];
  /** Set when the studio could not be read at all. */
  error?: string;
}

export interface OperationalSnapshot {
  snapshotId: string;
  timestamp: number;
  studioStatuses: StudioStatus[];
  capabilities: CapabilityStatus[];
  dependencies: DependencyStatus[];
  findings: OperationalFinding[];
  overallReadiness: {
    /** 0–1 over usable capabilities. */
    score: number;
    readyCapabilities: number;
    totalCapabilities: number;
    blockedCapabilities: number;
    detail: string;
  };
  /** Collection metadata, so a stale answer is visibly stale. */
  collection: {
    collectedAt: number;
    durationMs: number;
    fromCache: boolean;
    stale: boolean;
    studiosRead: number;
    studiosFailed: number;
  };
}

/** What a studio source hands the collector. */
export interface RawCapability {
  capabilityId: string;
  label: string;
  configured: boolean;
  available: boolean;
  authorized: boolean;
  selectable: boolean;
  executable: boolean;
  verified: boolean;
  detail: string;
  provenance: EvidenceProvenance;
  source: string;
}

export interface RawFinding {
  id: string;
  severity: FindingSeverity;
  category: OperationalFinding["category"];
  description: string;
  affectedCapability?: string | null;
  remediation: string;
  status?: FindingStatus;
}

export interface RawStudioPayload {
  ok: boolean;
  readAt: number;
  capabilities: RawCapability[];
  findings?: RawFinding[];
  dependencies?: string[];
  /** Evidence for the studio as a whole (endpoint, probe, error). */
  evidence?: EvidenceReference[];
  error?: string;
}
