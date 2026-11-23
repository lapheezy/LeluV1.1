/**
 * ==========================================================
 * LÉLU — MISSION EVIDENCE VOCABULARY
 *
 * The existing operational model answers "can this capability
 * run, and in what lifecycle state" (NOT_CONFIGURED, BLOCKED,
 * AVAILABLE, VERIFIED…). Mission 14 asks a different question:
 * HOW WELL IS THIS CLAIM SUPPORTED?
 *
 * This file does not replace the operational model. It is a
 * translation layer over it, so one system does not end up with
 * two competing vocabularies for the same truth.
 *
 * The rule that matters:
 *
 *   registered ≠ reachable ≠ executed ≠ verified
 *
 * A capability that is merely listed is PARTIAL. A provider that
 * has never answered live is not VERIFIED. A stored note is
 * REPORTED. A test double is SIMULATED. Nothing becomes VERIFIED
 * by being asserted.
 * ==========================================================
 */

import type { OperationalState } from "./types.ts";

/** The only evidence labels LÉLU may use about herself. */
export type MissionEvidence =
  | "VERIFIED"
  | "REPORTED"
  | "PARTIAL"
  | "BLOCKED"
  | "UNAVAILABLE"
  | "PROPOSED"
  | "SIMULATED";

export const MISSION_EVIDENCE_LABELS: readonly MissionEvidence[] = [
  "VERIFIED",
  "REPORTED",
  "PARTIAL",
  "BLOCKED",
  "UNAVAILABLE",
  "PROPOSED",
  "SIMULATED",
];

export const MISSION_EVIDENCE_MEANINGS: Record<MissionEvidence, string> = {
  VERIFIED: "Observed directly in this runtime, or proven by a recorded result.",
  REPORTED: "Stored or told to LÉLU, but not re-observed in this snapshot.",
  PARTIAL: "Part of the path exists; the complete workflow is not proven.",
  BLOCKED: "Present, but an explicit obstacle (configuration, policy, dependency) prevents use.",
  UNAVAILABLE: "Absent from this runtime, or unreachable; nothing is claimed about it.",
  PROPOSED: "A plan, hypothesis or candidate — not implemented and not running.",
  SIMULATED: "Produced by a test double or fixture, never by the real system.",
};

/** A single claim about LÉLU's own state, with its support. */
export interface EvidenceClaim {
  id: string;
  /** The claim in plain words. Never a bare capability name. */
  statement: string;
  state: MissionEvidence;
  /** The module, store or route the claim is read from. */
  source: string;
  observedAt: number;
  detail?: string;
}

export function evidenceClaim(
  id: string,
  statement: string,
  state: MissionEvidence,
  source: string,
  observedAt: number = Date.now(),
  detail?: string,
): EvidenceClaim {
  return {
    id,
    statement,
    state,
    source,
    observedAt,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Map an existing operational lifecycle state onto evidence.
 *
 * Deliberately conservative:
 *   VERIFIED (operational)  → VERIFIED
 *   AVAILABLE / EXECUTING   → PARTIAL   (present, not proven end-to-end)
 *   COMPLETED               → PARTIAL   (it finished once; this snapshot did not observe it)
 *   AUTHORIZED / CONFIGURED → PARTIAL
 *   DEGRADED                → PARTIAL
 *   BLOCKED                 → BLOCKED
 *   NOT_CONFIGURED          → BLOCKED   (configuration is the obstacle)
 *   UNAVAILABLE / FAILED    → UNAVAILABLE
 */
export function missionEvidenceFromOperational(state: OperationalState): MissionEvidence {
  switch (state) {
    case "VERIFIED":
      return "VERIFIED";
    case "BLOCKED":
      return "BLOCKED";
    case "NOT_CONFIGURED":
      return "BLOCKED";
    case "UNAVAILABLE":
    case "FAILED":
      return "UNAVAILABLE";
    case "AVAILABLE":
    case "AUTHORIZED":
    case "EXECUTING":
    case "COMPLETED":
    case "CONFIGURED":
    case "DEGRADED":
    default:
      return "PARTIAL";
  }
}

/** Count claims by state, including zeros, so a missing state is visible. */
export function countEvidence(claims: EvidenceClaim[]): Record<MissionEvidence, number> {
  const counts = {
    VERIFIED: 0,
    REPORTED: 0,
    PARTIAL: 0,
    BLOCKED: 0,
    UNAVAILABLE: 0,
    PROPOSED: 0,
    SIMULATED: 0,
  } satisfies Record<MissionEvidence, number>;
  for (const claim of claims) counts[claim.state] += 1;
  return counts;
}

/** True only for support that came from a real observation or a recorded result. */
export function isProven(state: MissionEvidence): boolean {
  return state === "VERIFIED";
}

/* ------------------------------------------------------------------ *
 * SECRET HYGIENE
 *
 * Ledger entries and pulse summaries are written by agents — the
 * exact place a pasted key or token ends up. Redact before storing,
 * not only before display.
 * ------------------------------------------------------------------ */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  // Provider and platform key shapes.
  { pattern: /\b(sk|rk)-[A-Za-z0-9_-]{16,}\b/g, replace: "[redacted-key]" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replace: "[redacted-token]" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: "[redacted-token]" },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replace: "[redacted-key]" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: "[redacted-token]" },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, replace: "[redacted-jwt]" },
  // Authorization headers.
  { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, replace: "$1 [redacted]" },
  // key=value / key: value pairs whose key names a credential.
  {
    pattern: /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)\b\s*[:=]\s*[^\s,;"']{4,}/gi,
    replace: "$1=[redacted]",
  },
];

/** Redact credential-shaped text. Pure; safe to call on every write. */
export function redactText(text: string): string {
  let cleaned = text;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern, replace);
  }
  return cleaned;
}

/** Redact a free-text list, dropping empty results. */
export function redactLines(lines: string[]): string[] {
  return lines.map((line) => redactText(line).trim()).filter(Boolean);
}
