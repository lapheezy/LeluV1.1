/**
 * ==========================================================
 * LÉLU — RELATIONSHIP AUTHORIZATION (OpenFGA model)
 *
 * The "who is related to what, and for how long" half of the
 * security gateway. It answers questions policy cannot:
 *
 *   Owner → Device → Authorized Session → Granted Capabilities
 *
 * A user owns a device. A session on that device is authorized
 * by the owner. The session is granted capabilities. The grant
 * expires, or is revoked, and the session stops working — with
 * no redeploy and no code change.
 *
 * WHY NOT JUST SUPABASE ROLES
 * ---------------------------
 * Roles cannot express "this phone, in this session, for the next
 * twenty minutes, may access the device bridge but not the
 * repository". That is a relationship with a lifetime, and it is
 * the shape a device bridge and delegated access both need.
 *
 * NO DUPLICATE IDENTITIES: a subject user id is the EXISTING
 * Supabase user id. This store never creates a user; it records
 * relationships between ids that already exist.
 *
 * The in-memory store is complete and is what the browser and the
 * tests use. plugins/integration/openfga.ts talks to a real
 * OpenFGA server when one is configured, using the same tuple
 * shape, so the two are interchangeable rather than parallel.
 * ==========================================================
 */

export type Relation = "owner" | "member" | "editor" | "operator" | "authorized_session" | "granted";

export type ObjectType = "user" | "organization" | "device" | "project" | "workspace" | "agent" | "service_account" | "session";

export interface RelationshipTuple {
  user: string; // "user:<id>"
  relation: Relation;
  object: string; // "<type>:<id>"
  /** Optional capability list for a `granted` tuple. */
  capabilities?: string[];
  /** Epoch ms. Absent = no expiry. */
  expiresAt?: number;
  /** Who created it, for the audit trail. */
  grantedBy?: string;
  createdAt: number;
}

export interface CheckRequest {
  user: string;
  relation: Relation;
  object: string;
  /** Narrow a `granted` check to one capability. */
  capability?: string;
}

export interface CheckResult {
  allowed: boolean;
  reason: string;
  /** The tuple that allowed it, when one did. */
  via?: RelationshipTuple;
}

export interface DeviceSessionGrant {
  deviceId: string;
  sessionId: string;
  capabilities: string[];
  expiresAt: number;
}

function objectType(object: string): string {
  return object.split(":")[0] ?? "";
}

export function isExpired(tuple: RelationshipTuple, now = Date.now()): boolean {
  return typeof tuple.expiresAt === "number" && tuple.expiresAt <= now;
}

export default class RelationshipStore {
  private static instance: RelationshipStore | null = null;
  private tuples: RelationshipTuple[] = [];

  public static getInstance(): RelationshipStore {
    if (!RelationshipStore.instance) RelationshipStore.instance = new RelationshipStore();
    return RelationshipStore.instance;
  }

  /** Add a relationship. Re-granting the same triple refreshes its expiry. */
  public grant(input: {
    user: string;
    relation: Relation;
    object: string;
    capabilities?: string[];
    ttlMs?: number;
    grantedBy?: string;
  }): RelationshipTuple {
    const existing = this.tuples.find(
      (tuple) => tuple.user === input.user && tuple.relation === input.relation && tuple.object === input.object,
    );
    const tuple: RelationshipTuple = {
      user: input.user,
      relation: input.relation,
      object: input.object,
      ...(input.capabilities ? { capabilities: [...input.capabilities] } : {}),
      ...(typeof input.ttlMs === "number" ? { expiresAt: Date.now() + input.ttlMs } : {}),
      ...(input.grantedBy ? { grantedBy: input.grantedBy } : {}),
      createdAt: Date.now(),
    };
    if (existing) {
      Object.assign(existing, tuple);
      return existing;
    }
    this.tuples.push(tuple);
    return tuple;
  }

  /** Remove a relationship. Returns whether one was actually removed. */
  public revoke(input: { user: string; relation: Relation; object: string }): boolean {
    const before = this.tuples.length;
    this.tuples = this.tuples.filter(
      (tuple) => !(tuple.user === input.user && tuple.relation === input.relation && tuple.object === input.object),
    );
    return this.tuples.length !== before;
  }

  /** Revoke every relationship a session holds, e.g. on sign-out. */
  public revokeSession(sessionId: string): number {
    const before = this.tuples.length;
    this.tuples = this.tuples.filter(
      (tuple) => !(tuple.object === `session:${sessionId}` || tuple.user === `session:${sessionId}`),
    );
    return before - this.tuples.length;
  }

  /** Drop expired tuples; returns how many were removed. */
  public prune(now = Date.now()): number {
    const before = this.tuples.length;
    this.tuples = this.tuples.filter((tuple) => !isExpired(tuple, now));
    return before - this.tuples.length;
  }

  public all(): RelationshipTuple[] {
    return this.tuples.filter((tuple) => !isExpired(tuple));
  }

  /**
   * OpenFGA's core question: is `user` related to `object` by
   * `relation` right now?
   *
   * Direct tuples only, plus one documented inheritance: an
   * organization `member` is a `member` of every project whose
   * `owner organization:<id>` tuple exists, and a project `editor`
   * may operate that project's workspaces. Those two are the only
   * implied relations — everything else must be stated, because an
   * unstated implication is how authorization quietly widens.
   */
  public check(request: CheckRequest, now = Date.now()): CheckResult {
    this.prune(now);
    const direct = this.tuples.find(
      (tuple) =>
        tuple.user === request.user &&
        tuple.relation === request.relation &&
        tuple.object === request.object &&
        !isExpired(tuple, now),
    );
    if (direct) {
      if (request.capability && direct.capabilities && !direct.capabilities.includes(request.capability)) {
        return {
          allowed: false,
          reason: `Grant exists for ${request.object} but does not include capability "${request.capability}".`,
          via: direct,
        };
      }
      return { allowed: true, reason: `Direct ${request.relation} on ${request.object}.`, via: direct };
    }

    // Organization membership implies project membership.
    if (request.relation === "member" && objectType(request.object) === "project") {
      const projectId = request.object.split(":")[1] ?? "";
      const organization = this.ownerOrganization(projectId);
      if (organization) {
        const membership = this.tuples.find(
          (tuple) =>
            tuple.user === request.user &&
            tuple.relation === "member" &&
            tuple.object === `organization:${organization}` &&
            !isExpired(tuple, now),
        );
        if (membership) {
          return {
            allowed: true,
            reason: `Member of organization:${organization}, which owns ${request.object}.`,
            via: membership,
          };
        }
      }
    }

    return {
      allowed: false,
      reason: `No live ${request.relation} relationship between ${request.user} and ${request.object}.`,
    };
  }

  /** The organization that owns a project, if one is recorded. */
  public ownerOrganization(projectId: string): string {
    const tuple = this.tuples.find(
      (item) => item.object === `project:${projectId}` && item.relation === "owner" && objectType(item.user) === "organization",
    );
    return tuple ? tuple.user.split(":")[1] ?? "" : "";
  }

  /** Every object of a type the user can reach by a relation. */
  public listObjects(user: string, relation: Relation, type: ObjectType): string[] {
    this.prune();
    return this.tuples
      .filter((tuple) => tuple.user === user && tuple.relation === relation && objectType(tuple.object) === type)
      .map((tuple) => tuple.object);
  }

  /**
   * Create the documented device chain in one call:
   *   owner → device, device → session (authorized_session),
   *   session → granted capabilities.
   *
   * This is the ONLY supported way to authorise a device session,
   * so the chain cannot be half-built by accident.
   */
  public grantDeviceSession(input: {
    ownerUserId: string;
    deviceId: string;
    sessionId: string;
    capabilities: string[];
    ttlMs: number;
  }): DeviceSessionGrant {
    this.grant({ user: `user:${input.ownerUserId}`, relation: "owner", object: `device:${input.deviceId}`, grantedBy: input.ownerUserId });
    this.grant({
      user: `device:${input.deviceId}`,
      relation: "authorized_session",
      object: `session:${input.sessionId}`,
      ttlMs: input.ttlMs,
      grantedBy: input.ownerUserId,
    });
    this.grant({
      user: `session:${input.sessionId}`,
      relation: "granted",
      object: `device:${input.deviceId}`,
      capabilities: [...input.capabilities],
      ttlMs: input.ttlMs,
      grantedBy: input.ownerUserId,
    });
    return {
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      capabilities: [...input.capabilities],
      expiresAt: Date.now() + input.ttlMs,
    };
  }

  /**
   * May this session use this capability on this device right now?
   * The single call the device bridge and the policy layer both use.
   */
  public sessionMay(sessionId: string, deviceId: string, capability: string): CheckResult {
    return this.check({
      user: `session:${sessionId}`,
      relation: "granted",
      object: `device:${deviceId}`,
      capability,
    });
  }

  /** Replace the whole store. Used by tests and by a server sync. */
  public replace(tuples: RelationshipTuple[]): void {
    this.tuples = tuples.map((tuple) => ({ ...tuple }));
  }

  public resetForTests(): void {
    this.tuples = [];
  }
}
