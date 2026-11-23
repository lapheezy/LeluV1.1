/**
 * ==========================================================
 * LÉLU — MISSION REMOTE-SYNC AUTHORIZATION GATE
 *
 * MissionLedger is local-only in this build. Before any future adapter may
 * send a mission record to Supabase, every condition below must be true,
 * and the gate starts CLOSED. Cloud persistence being connected is not one
 * of the conditions: an unrelated Supabase write cannot authorize missions.
 *
 * This is deliberately a separate decision from `durability` (the local
 * write reached storage) and from `sync` (the record's last known transport
 * label). The gate answers one question: may a remote adapter run at all?
 * ==========================================================
 */

export interface MissionSyncRequirements {
  /** A real Supabase session exists and has been observed. */
  authenticatedSession: boolean;
  /** The session's user id is known, not inferred from a browser token. */
  identityKnown: boolean;
  /** The existing account is authorized to store this data. */
  accountAuthorized: boolean;
  /** The user explicitly authorized MissionLedger cloud persistence. */
  userAuthorizedMissionStorage: boolean;
  /** The mission schema was inspected and accepted. */
  schemaVerified: boolean;
  /** Row-level security permits the intended per-user operations. */
  rlsVerified: boolean;
  /** A sync adapter is registered and available. */
  adapterRegistered: boolean;
  /** A remote write can be attributed to the authenticated owner. */
  ownerAttributable: boolean;
}

export interface MissionSyncDecision {
  eligible: boolean;
  /** Human-readable reasons the gate is closed; empty only when eligible. */
  blockers: string[];
}

const CLOSED: MissionSyncRequirements = {
  authenticatedSession: false,
  identityKnown: false,
  accountAuthorized: false,
  userAuthorizedMissionStorage: false,
  schemaVerified: false,
  rlsVerified: false,
  adapterRegistered: false,
  ownerAttributable: false,
};

const REQUIREMENT_LABELS: Array<[keyof MissionSyncRequirements, string]> = [
  ["authenticatedSession", "no authenticated Supabase session"],
  ["identityKnown", "the authenticated identity is unknown"],
  ["accountAuthorized", "the account is not authorized for mission storage"],
  ["userAuthorizedMissionStorage", "the user has not authorized MissionLedger cloud persistence"],
  ["schemaVerified", "the target mission schema is not verified"],
  ["rlsVerified", "row-level security for the target operations is not verified"],
  ["adapterRegistered", "no mission sync adapter is registered"],
  ["ownerAttributable", "a remote write cannot be attributed to the authenticated owner"],
];

export function evaluateMissionSync(requirements: MissionSyncRequirements): MissionSyncDecision {
  const blockers = REQUIREMENT_LABELS
    .filter(([key]) => requirements[key] !== true)
    .map(([, label]) => label);
  return { eligible: blockers.length === 0, blockers };
}

/**
 * Holds the current mission-sync context. It defaults to every requirement
 * false and exposes no way to open the gate implicitly from network status.
 *
 * No adapter is registered in this build, so `available()` is false even if
 * a caller sets the other flags. A future adapter must register itself and
 * supply the verified identity/RLS evidence; only then can writes begin.
 */
export default class MissionSyncGate {
  private static instance: MissionSyncGate | null = null;

  private requirements: MissionSyncRequirements = { ...CLOSED };

  public static getInstance(): MissionSyncGate {
    if (!MissionSyncGate.instance) MissionSyncGate.instance = new MissionSyncGate();
    return MissionSyncGate.instance;
  }

  /** Read the current decision without changing it. */
  public evaluate(): MissionSyncDecision {
    return evaluateMissionSync(this.requirements);
  }

  /** True only when every authorization and implementation condition holds. */
  public available(): boolean {
    return this.evaluate().eligible;
  }

  public requirementsSnapshot(): MissionSyncRequirements {
    return { ...this.requirements };
  }

  /**
   * Set verified context. This is for an authorized adapter's boot path and
   * for tests; it does not perform a write and cannot infer consent.
   */
  public setRequirements(next: Partial<MissionSyncRequirements>): void {
    this.requirements = { ...this.requirements, ...next };
  }

  /** Close the gate and forget any capability flags. */
  public reset(): void {
    this.requirements = { ...CLOSED };
  }
}
