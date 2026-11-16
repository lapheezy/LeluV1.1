/**
 * ==========================================================
 * LÉLU — OPERATIONAL MODEL NORMALIZATION
 *
 * Turns raw observations into the typed model, and — more
 * importantly — turns them into ONE state plus the ordered list
 * of reasons it is not better than that state.
 *
 * The ordering is the point. A capability that is unconfigured
 * is NOT also "degraded": the first failing gate is the answer a
 * person can act on.
 * ==========================================================
 */

import type {
  CapabilityStatus,
  EvidenceReference,
  OperationalFinding,
  OperationalSnapshot,
  OperationalState,
  RawCapability,
  RawStudioPayload,
  StudioId,
  StudioStatus,
} from "./types.ts";

/** Health states the existing adapters already report. */
export interface HealthLike {
  state: "healthy" | "degraded" | "unavailable" | "not_configured";
  detail: string;
  checkedAt?: number;
  contacted?: boolean;
}

/**
 * The state ladder, first failing rung first.
 *
 * `verified` is deliberately last: a capability can be perfectly
 * configured, available, authorized and executable and still not
 * have a proven result — and calling that VERIFIED would be the
 * same error as calling a green test run a reviewed change.
 */
export function resolveState(capability: {
  configured: boolean;
  available: boolean;
  authorized: boolean;
  selectable?: boolean;
  executable: boolean;
  verified: boolean;
}): { state: OperationalState; blockingReasons: string[] } {
  const reasons: string[] = [];
  if (!capability.configured) {
    reasons.push("not configured: the required environment or service is absent");
    return { state: "NOT_CONFIGURED", blockingReasons: reasons };
  }
  if (!capability.available) {
    reasons.push("configured but not reachable right now");
    return { state: "BLOCKED", blockingReasons: reasons };
  }
  if (!capability.authorized) {
    reasons.push("reachable but not authorized by policy for this action");
    return { state: "BLOCKED", blockingReasons: reasons };
  }
  if (capability.selectable === false) {
    reasons.push("authorized but not selectable: no registered backend can execute it");
    return { state: "BLOCKED", blockingReasons: reasons };
  }
  if (!capability.executable) {
    reasons.push("selected but there is no executable path (workspace, sandbox or runtime missing)");
    return { state: "CONFIGURED", blockingReasons: reasons };
  }
  if (!capability.verified) {
    reasons.push("executable but no result has been verified");
    return { state: "AVAILABLE", blockingReasons: reasons };
  }
  return { state: "VERIFIED", blockingReasons: [] };
}

/** Adapt an existing adapter/service health record into a state. */
export function stateFromHealth(health: HealthLike): OperationalState {
  switch (health.state) {
    case "healthy":
      return "AVAILABLE";
    case "degraded":
      return "DEGRADED";
    case "unavailable":
      return "UNAVAILABLE";
    case "not_configured":
    default:
      return "NOT_CONFIGURED";
  }
}

const STATE_SEVERITY: Record<OperationalState, number> = {
  VERIFIED: 0,
  AVAILABLE: 0,
  COMPLETED: 0,
  AUTHORIZED: 0,
  EXECUTING: 1,
  DEGRADED: 2,
  CONFIGURED: 2,
  BLOCKED: 3,
  NOT_CONFIGURED: 4,
  UNAVAILABLE: 4,
  FAILED: 4,
};

/** The studio's state is the worst capability it owns — not the best. */
export function worstState(states: OperationalState[]): OperationalState {
  if (states.length === 0) return "NOT_CONFIGURED";
  return states.reduce((worst, state) => (STATE_SEVERITY[state] > STATE_SEVERITY[worst] ? state : worst), states[0]!);
}

export function normalizeCapability(raw: RawCapability, studioId: StudioId, at: number): CapabilityStatus {
  const resolved = resolveState(raw);
  return {
    capabilityId: raw.capabilityId,
    studioId,
    label: raw.label,
    configured: raw.configured,
    available: raw.available,
    authorized: raw.authorized,
    selectable: raw.selectable,
    executable: raw.executable,
    verified: raw.verified,
    state: resolved.state,
    blockingReasons: resolved.blockingReasons,
    evidence: [
      {
        id: `ev-${studioId}-${raw.capabilityId}`,
        source: raw.source,
        provenance: raw.provenance,
        detail: raw.detail,
        at,
      },
    ],
  };
}

export function normalizeStudio(
  studioId: StudioId,
  payload: RawStudioPayload | null,
  at: number,
): StudioStatus {
  if (!payload || !payload.ok) {
    return {
      studioId,
      timestamp: at,
      operationalState: "UNAVAILABLE",
      capabilities: [],
      unavailableCapabilities: [],
      activeTasks: 0,
      unresolvedFindings: 0,
      dependencies: [],
      evidenceReferences: [
        {
          id: `ev-${studioId}-collection`,
          source: `studio:${studioId}`,
          provenance: "unavailable",
          detail: payload?.error ?? "the studio could not be read; nothing is claimed about it",
          at,
        },
      ],
      error: payload?.error ?? "studio unreadable",
    };
  }

  const capabilities = payload.capabilities.map((raw) => normalizeCapability(raw, studioId, payload.readAt || at));
  return {
    studioId,
    timestamp: payload.readAt || at,
    operationalState: worstState(capabilities.map((capability) => capability.state)),
    capabilities,
    unavailableCapabilities: capabilities
      .filter((capability) => capability.state !== "AVAILABLE" && capability.state !== "VERIFIED")
      .map((capability) => capability.capabilityId),
    activeTasks: 0,
    unresolvedFindings: (payload.findings ?? []).length,
    dependencies: payload.dependencies ?? [],
    evidenceReferences: payload.evidence ?? [],
  };
}

export function findingsFrom(
  studioId: StudioId,
  payload: RawStudioPayload | null,
): OperationalFinding[] {
  if (!payload?.ok) return [];
  return (payload.findings ?? []).map((finding) => ({
    findingId: `${studioId}:${finding.id}`,
    sourceStudio: studioId,
    severity: finding.severity,
    category: finding.category,
    description: finding.description,
    affectedCapability: finding.affectedCapability ?? null,
    remediation: finding.remediation,
    evidenceReference: `studio:${studioId}`,
    status: finding.status ?? "open",
  }));
}

/** Overall readiness, counted rather than asserted. */
export function summarizeReadiness(
  studios: StudioStatus[],
): OperationalSnapshot["overallReadiness"] {
  const capabilities = studios.flatMap((studio) => studio.capabilities);
  const ready = capabilities.filter(
    (capability) => capability.state === "AVAILABLE" || capability.state === "VERIFIED",
  ).length;
  const blocked = capabilities.filter(
    (capability) => capability.state === "BLOCKED" || capability.state === "NOT_CONFIGURED" || capability.state === "UNAVAILABLE",
  ).length;
  const total = capabilities.length;
  const score = total === 0 ? 0 : Number((ready / total).toFixed(3));
  return {
    score,
    readyCapabilities: ready,
    totalCapabilities: total,
    blockedCapabilities: blocked,
    detail:
      total === 0
        ? "No capability was collected, so readiness is zero rather than assumed."
        : `${ready} of ${total} capabilities are usable; ${blocked} are blocked or unconfigured.`,
  };
}

/* ------------------------------------------------------------------ *
 * SECRET HYGIENE
 * ------------------------------------------------------------------ */

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|credential|private[_-]?key|bearer)/i;

/**
 * Drop credential-shaped keys from anything the intelligence layer
 * stores or returns. The studios already avoid returning values; this
 * is the second lock, applied to data the collector did not create.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as unknown as T;
  if (!value || typeof value !== "object") return value;
  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    cleaned[key] = redactSecrets(item);
  }
  return cleaned as T;
}

export function evidenceOf(
  id: string,
  source: string,
  provenance: EvidenceReference["provenance"],
  detail: string,
  at = Date.now(),
): EvidenceReference {
  return { id, source, provenance, detail, at };
}
