/**
 * ==========================================================
 * LÉLU
 * ENGINEERING AUTHORIZATION — who may change the real project
 *
 * Working inside a sandbox copy and changing the actual project
 * are different acts with different permission requirements, and
 * this module is the boundary between them.
 *
 * A grant is issued ONLY by an explicit human action. Three
 * conditions must hold, and none of them is "the model asked":
 *
 *   1. An AUTHENTICATED identity exists. The Supabase session is
 *      the source of user identity — the same session the rest of
 *      LÉLU already uses. No session, no grant.
 *   2. The AutonomyGate permits project-level work. This is the
 *      user's own configured ceiling, so lowering it revokes the
 *      ability regardless of anything else.
 *   3. The user explicitly authorized THIS workspace and THESE
 *      paths. A grant names what it covers; it is not a blanket
 *      permission and it expires.
 *
 * The enforcement is structural rather than advisory. ToolSchemas
 * only advertises workspace_apply while a grant exists, so a model
 * without one cannot call it at all, and ToolDispatcher re-checks
 * before executing in case the grant lapsed mid-conversation.
 * ==========================================================
 */

import AutonomyGate from "../cognition/AutonomyGate";
import SupabasePersistence from "../persistence/SupabasePersistence";

/** Autonomy level required to change the real project. */
export const APPLY_AUTONOMY_LEVEL = 4;

/** How long a human authorization stays valid. */
const GRANT_TTL_MS = 15 * 60 * 1000;

export interface ApplyGrant {
  workspaceId: string;
  /** The authenticated identity that authorized this, for the audit record. */
  grantedBy: string;
  grantedAt: number;
  expiresAt: number;
  /** Exactly which paths were authorized. Empty means every change. */
  paths: string[];
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  /** Present only when allowed. */
  grant?: ApplyGrant;
}

export default class EngineeringAuthorization {
  private static instance: EngineeringAuthorization | null = null;

  private grants = new Map<string, ApplyGrant>();

  private constructor() {}

  public static getInstance(): EngineeringAuthorization {
    if (!EngineeringAuthorization.instance) {
      EngineeringAuthorization.instance = new EngineeringAuthorization();
    }
    return EngineeringAuthorization.instance;
  }

  /**
   * The authenticated identity, or null.
   *
   * Read from the EXISTING Supabase session rather than a second auth
   * system. `isConnected()` is true only once a user id is present, so
   * an anonymous or offline runtime yields no identity and therefore
   * cannot authorize anything.
   */
  public identity(): string | null {
    try {
      const supabase = SupabasePersistence.getInstance();
      if (!supabase.isConnected()) return null;
      const auth = supabase.getAuthState();
      if (!auth.session) return null;
      return auth.email ?? auth.session.user?.id ?? null;
    } catch {
      return null;
    }
  }

  /** Why applying is or is not currently possible, without changing anything. */
  public preflight(): { ready: boolean; reason: string } {
    const identity = this.identity();
    if (!identity) {
      return {
        ready: false,
        reason:
          "No authenticated session. Applying changes to the real project requires a signed-in " +
          "Supabase identity; sandbox work does not.",
      };
    }
    if (!AutonomyGate.getInstance().can(APPLY_AUTONOMY_LEVEL)) {
      return {
        ready: false,
        reason:
          `Autonomy level ${APPLY_AUTONOMY_LEVEL} (project autonomy) is required to change the ` +
          `real project. The current level is lower.`,
      };
    }
    return { ready: true, reason: `Authorized identity: ${identity}.` };
  }

  /**
   * Record an explicit human authorization for one workspace.
   *
   * This must only ever be called from a deliberate user action. It is
   * never called by the tool dispatcher, so a model cannot reach it:
   * a model can prepare and validate a change set and ask for it to be
   * applied, and the answer comes from the user, not from the request.
   */
  public authorize(workspaceId: string, paths: string[] = []): AuthorizationDecision {
    const preflight = this.preflight();
    if (!preflight.ready) {
      return { allowed: false, reason: preflight.reason };
    }
    const identity = this.identity();
    if (!identity) {
      return { allowed: false, reason: "The authenticated session ended before authorization." };
    }

    const grant: ApplyGrant = {
      workspaceId,
      grantedBy: identity,
      grantedAt: Date.now(),
      expiresAt: Date.now() + GRANT_TTL_MS,
      paths: [...paths],
    };
    this.grants.set(workspaceId, grant);
    return { allowed: true, reason: `Authorized by ${identity}.`, grant };
  }

  /** Is there a live human authorization for this workspace right now? */
  public authorizationFor(workspaceId: string): ApplyGrant | null {
    const grant = this.grants.get(workspaceId);
    if (!grant) return null;
    if (Date.now() > grant.expiresAt) {
      this.grants.delete(workspaceId);
      return null;
    }
    // The conditions are re-checked, not just remembered: signing out or
    // lowering the autonomy level revokes a grant that was already given.
    if (!this.preflight().ready) return null;
    return grant;
  }

  /** Any workspace currently carrying a live authorization. */
  public authorizedWorkspaces(): string[] {
    return [...this.grants.keys()].filter((id) => this.authorizationFor(id) !== null);
  }

  /** Consume the authorization for a workspace once it has been applied. */
  public consume(workspaceId: string): void {
    this.grants.delete(workspaceId);
  }

  /** Withdraw an authorization without applying it. */
  public revoke(workspaceId: string): void {
    this.grants.delete(workspaceId);
  }
}
