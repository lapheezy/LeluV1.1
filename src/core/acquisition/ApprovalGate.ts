/**
 * ==========================================================
 * LÉLU — ACQUISITION APPROVAL GATE
 *
 * The permission boundary for acquisition work. It exists in
 * addition to the server's own approval grants, because the two
 * answer different questions:
 *
 *   • this gate answers "may LÉLU, acting on this objective,
 *     take this class of action at all right now?" — autonomy
 *     ceiling plus an explicit operator authorization;
 *   • the server answers "who is this, and is that action
 *     approved for THIS acquisition?" — nonce, scope, identity.
 *
 * Both must agree. A missing client grant stops the executor
 * before it asks the server; a missing server grant stops the
 * action even if the client was tricked.
 *
 * Grants are never persisted and are issued only by an explicit
 * call to authorize() with a named approver. The tool dispatcher
 * never calls authorize(), so a model cannot mint one.
 * ==========================================================
 */

import AutonomyGate from "../cognition/AutonomyGate";
import EngineeringAuthorization from "../engineering/EngineeringAuthorization";

export type ApprovalScope =
  | "external-write"
  | "canonical-write"
  | "destructive"
  | "credential-access"
  | "production-deploy"
  | "untrusted-script";

export interface ScopeRequirement {
  /** Autonomy level required (0-5, see AutonomyGate). */
  autonomy: number;
  description: string;
}

export const SCOPE_REQUIREMENTS: Record<ApprovalScope, ScopeRequirement> = {
  "external-write": { autonomy: 3, description: "Write to a system outside this project (a branch, a registry, an API)." },
  "canonical-write": { autonomy: 4, description: "Commit or apply changes to an authorized LÉLU repository branch." },
  destructive: { autonomy: 4, description: "Delete or roll back acquired work." },
  "credential-access": { autonomy: 4, description: "Read or use a credential." },
  "production-deploy": { autonomy: 5, description: "Deploy to production." },
  "untrusted-script": { autonomy: 4, description: "Execute code from an acquired repository with lifecycle scripts enabled." },
};

/** How the approval was established — recorded with every grant. */
export type ApprovalBasis = "verified-session" | "local-operator" | "runtime-operator";

export interface ApprovalGrant {
  scope: ApprovalScope;
  targetId: string;
  approver: string;
  basis: ApprovalBasis;
  detail: string;
  grantedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface ApprovalDecision {
  allowed: boolean;
  reason: string;
  grant?: ApprovalGrant;
}

const GRANT_TTL_MS = 15 * 60 * 1000;

export default class ApprovalGate {
  private static instance: ApprovalGate | null = null;
  private grants = new Map<string, ApprovalGrant>();
  private audit: Array<{ at: number; scope: ApprovalScope; targetId: string; allowed: boolean; reason: string }> = [];

  static getInstance(): ApprovalGate {
    if (!ApprovalGate.instance) {
      ApprovalGate.instance = new ApprovalGate();
    }
    return ApprovalGate.instance;
  }

  static resetForTests(): void {
    ApprovalGate.instance = null;
  }

  /** Why a scope is or is not currently available, without granting anything. */
  preflight(scope: ApprovalScope): { ready: boolean; reason: string; basis: ApprovalBasis } {
    const requirement = SCOPE_REQUIREMENTS[scope];
    const identity = EngineeringAuthorization.getInstance().identity();
    const basis: ApprovalBasis = identity ? "verified-session" : "local-operator";

    if (!AutonomyGate.getInstance().can(requirement.autonomy)) {
      return {
        ready: false,
        basis,
        reason:
          `"${scope}" needs autonomy level ${requirement.autonomy} (${requirement.description}). ` +
          `The current level is ${AutonomyGate.getInstance().getLevel()}.`,
      };
    }
    if (!identity) {
      return {
        ready: true,
        basis,
        reason:
          "No Supabase session is present in this runtime, so an approval is recorded as local-operator. " +
          "The server independently requires its own grant for the same action.",
      };
    }
    return { ready: true, basis, reason: `Approver identity available: ${identity}.` };
  }

  /**
   * Record an explicit operator authorization.
   *
   * Deliberately requires a named approver and the reason: this is the
   * entry point a person (or an authenticated operator script) uses, not
   * something a tool call can reach.
   */
  authorize(scope: ApprovalScope, targetId: string, approver: string, detail: string): ApprovalDecision {
    const name = approver.trim();
    if (!name) {
      return this.decide(scope, targetId, false, "An approval must name who gave it.");
    }
    const preflight = this.preflight(scope);
    if (!preflight.ready) return this.decide(scope, targetId, false, preflight.reason);

    const grant: ApprovalGrant = {
      scope,
      targetId,
      approver: name,
      basis: preflight.basis,
      detail: detail.slice(0, 500),
      grantedAt: Date.now(),
      expiresAt: Date.now() + GRANT_TTL_MS,
      nonce: `local_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
    };
    this.grants.set(`${scope}|${targetId}`, grant);
    this.audit.push({ at: Date.now(), scope, targetId, allowed: true, reason: `${name} (${preflight.basis})` });
    this.trimAudit();
    return { allowed: true, reason: `${scope} authorized by ${name}.`, grant };
  }

  /** A live grant for exactly this scope and target, or null. */
  grantFor(scope: ApprovalScope, targetId: string): ApprovalGrant | null {
    const grant = this.grants.get(`${scope}|${targetId}`);
    if (!grant) return null;
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(`${scope}|${targetId}`);
      return null;
    }
    // Re-checked, not remembered: lowering autonomy revokes a grant.
    if (!this.preflight(scope).ready) return null;
    return grant;
  }

  /** Require a live grant; a refusal carries the reason a caller can act on. */
  require(scope: ApprovalScope, targetId: string): ApprovalDecision {
    const grant = this.grantFor(scope, targetId);
    if (grant) return { allowed: true, reason: `Authorized by ${grant.approver}.`, grant };
    const preflight = this.preflight(scope);
    return this.decide(
      scope,
      targetId,
      false,
      preflight.ready
        ? `No authorization has been given for "${scope}" on "${targetId}".`
        : preflight.reason,
    );
  }

  /** Is any live approval held for this scope? Used to gate tool offers. */
  hasAnyGrant(scope: ApprovalScope): boolean {
    const prefix = `${scope}|`;
    for (const key of [...this.grants.keys()]) {
      if (!key.startsWith(prefix)) continue;
      if (this.grantFor(scope, key.slice(prefix.length))) return true;
    }
    return false;
  }

  consume(scope: ApprovalScope, targetId: string): void {
    this.grants.delete(`${scope}|${targetId}`);
  }

  revoke(scope: ApprovalScope, targetId: string): void {
    this.grants.delete(`${scope}|${targetId}`);
  }

  auditLog(): ReadonlyArray<{ at: number; scope: ApprovalScope; targetId: string; allowed: boolean; reason: string }> {
    return [...this.audit];
  }

  private decide(scope: ApprovalScope, targetId: string, allowed: boolean, reason: string): ApprovalDecision {
    this.audit.push({ at: Date.now(), scope, targetId, allowed, reason });
    this.trimAudit();
    return { allowed, reason };
  }

  private trimAudit(): void {
    if (this.audit.length > 200) this.audit = this.audit.slice(-200);
  }
}
