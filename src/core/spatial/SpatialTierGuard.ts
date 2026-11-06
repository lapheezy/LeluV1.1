/**
 * ==========================================================
 * LÉLU — SPATIAL TIER GUARD
 *
 * Tiers are permissions, not labels. The table below derives
 * every operation's tier from the documented security model
 * (docs/architecture/SECURITY_AND_PERMISSION_MODEL.md §4), and
 * this guard is the ONLY producer of a SpatialAuthorization —
 * the token SpatialSceneGraph requires before it will write.
 *
 * Rules, in the order they are checked:
 *
 *   1. the operation exists and has an applier;
 *   2. its tier is inside the session's granted set
 *      (configuration: 1–3 by default, never self-elevated
 *      from chat);
 *   3. destructive / Tier 4–5 operations carry a single-use,
 *      owner-issued approval (120 s, one execution).
 *
 * A refusal is a typed result, never a silent no-op — the chat
 * surfaces the exact code, the required tier and the revision
 * that stayed unchanged.
 * ==========================================================
 */

import {
  SPATIAL_TIER_LABELS,
  type SpatialOperationDef,
  type SpatialOperationId,
  type SpatialRefusal,
  type SpatialTier,
} from "./SpatialTypes";
import { issueSpatialWriteSeal, type SpatialWriteSeal } from "./SpatialSeal";

export const SPATIAL_OPERATIONS: Record<SpatialOperationId, SpatialOperationDef> = {
  "scene.list": {
    id: "scene.list",
    tier: 1,
    mutates: false,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "List every object in the scene with its id, kind and position.",
  },
  "scene.inspect": {
    id: "scene.inspect",
    tier: 1,
    mutates: false,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Read one object's full transform, material and relationships.",
  },
  "object.create": {
    id: "object.create",
    tier: 3,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Author a new primitive object into the live scene.",
  },
  "object.move": {
    id: "object.move",
    tier: 2,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Move an existing object to a new position.",
  },
  "object.rotate": {
    id: "object.rotate",
    tier: 2,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Rotate an existing object.",
  },
  "object.scale": {
    id: "object.scale",
    tier: 2,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Resize an existing object proportionally.",
  },
  "object.setVisible": {
    id: "object.setVisible",
    tier: 2,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Show or hide an existing object.",
  },
  "material.set": {
    id: "material.set",
    tier: 2,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Change an object's colour, metalness, roughness, glow or opacity.",
  },
  "object.connect": {
    id: "object.connect",
    tier: 3,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Create a typed relationship between two objects.",
  },
  "object.delete": {
    id: "object.delete",
    tier: 3,
    mutates: true,
    destructive: true,
    requiresApproval: true,
    implemented: true,
    description: "Remove an object and every relationship touching it.",
  },
  "scene.undo": {
    id: "scene.undo",
    tier: 2,
    mutates: true,
    destructive: false,
    requiresApproval: false,
    implemented: true,
    description: "Reverse the last accepted scene mutation.",
  },
  "scene.recover": {
    id: "scene.recover",
    tier: 4,
    mutates: true,
    destructive: true,
    requiresApproval: true,
    implemented: true,
    description: "Restore a validated scene snapshot (disaster recovery).",
  },
  "scene.compose": {
    id: "scene.compose",
    tier: 4,
    mutates: true,
    destructive: false,
    requiresApproval: true,
    implemented: false,
    description: "Plan and execute a multi-step scene composition.",
  },
  "scene.commit": {
    id: "scene.commit",
    tier: 5,
    mutates: true,
    destructive: true,
    requiresApproval: true,
    implemented: false,
    description: "Commit a prepared change set after an owner-reviewed preview.",
  },
};

const SEALED_SYMBOL = Symbol("lelu.spatial.authorization");

export interface SpatialAuthorization {
  readonly [SEALED_SYMBOL]: true;
  readonly seal: SpatialWriteSeal;
  readonly ops: readonly SpatialOperationId[];
  readonly tier: SpatialTier;
  readonly approvalId?: string;
  readonly issuedAt: number;
}

const authorizations = new WeakSet<object>();

export function isSpatialAuthorization(value: unknown): value is SpatialAuthorization {
  return typeof value === "object" && value !== null && authorizations.has(value);
}

export type SpatialAuthorizationResult =
  | { ok: true; authorization: SpatialAuthorization }
  | { ok: false; refusal: SpatialRefusal };

interface ApprovalRecord {
  id: string;
  ops: Set<SpatialOperationId>;
  expiresAt: number;
  used: boolean;
}

const APPROVAL_TTL_MS = 120_000;

export default class SpatialTierGuard {
  private static instance: SpatialTierGuard | null = null;

  /**
   * Configuration grant. Tiers 1–3 are the app's configured
   * operator authority; 4–5 need a grant this build does not ship,
   * so they refuse as `tier-insufficient` even with an approval.
   */
  private granted: Set<SpatialTier> = new Set<SpatialTier>([1, 2, 3]);
  private readonly approvals = new Map<string, ApprovalRecord>();

  public static getInstance(): SpatialTierGuard {
    if (!SpatialTierGuard.instance) {
      SpatialTierGuard.instance = new SpatialTierGuard();
    }
    return SpatialTierGuard.instance;
  }

  public grantedTiers(): SpatialTier[] {
    return [...this.granted].sort();
  }

  public maxGrantedTier(): SpatialTier {
    return this.grantedTiers().reduce<SpatialTier>((max, tier) => (tier > max ? tier : max), 1);
  }

  /** Configuration change — not reachable from chat. */
  public grant(tier: SpatialTier): void {
    this.granted.add(tier);
  }

  public revoke(tier: SpatialTier): void {
    this.granted.delete(tier);
  }

  public operation(id: SpatialOperationId): SpatialOperationDef {
    return SPATIAL_OPERATIONS[id];
  }

  /**
   * Record an owner gesture. Only an explicit approval phrase in
   * the chat resolver reaches this — LÉLU cannot mint one for
   * herself. The approval is single-use and expires in 120 s.
   */
  public requestApproval(
    ops: readonly SpatialOperationId[],
    detail: string,
  ): { approvalId: string; expiresAt: number } {
    const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.approvals.set(approvalId, {
      id: approvalId,
      ops: new Set(ops),
      expiresAt: Date.now() + APPROVAL_TTL_MS,
      used: false,
    });
    if (typeof console !== "undefined") {
      console.info(`[LÉLU spatial] owner approval granted for ${ops.join(", ")} — ${detail}`);
    }
    return { approvalId, expiresAt: Date.now() + APPROVAL_TTL_MS };
  }

  /**
   * Authorize a set of operations for one commit.
   *
   * Returns a sealed authorization (the only thing the scene graph
   * accepts) or a typed refusal. Nothing here mutates the scene.
   */
  public authorize(
    ops: readonly SpatialOperationId[],
    options: { approvalId?: string } = {},
  ): SpatialAuthorizationResult {
    if (ops.length === 0) {
      return {
        ok: false,
        refusal: { code: "validation-failed", detail: "no operations were requested" },
      };
    }

    let tier: SpatialTier = 1;
    let needsApproval = false;
    let destructive: SpatialOperationDef | undefined;

    for (const op of ops) {
      const def = SPATIAL_OPERATIONS[op];
      if (!def) {
        return {
          ok: false,
          refusal: { code: "validation-failed", detail: `unknown operation "${op}"` },
        };
      }
      if (!def.implemented) {
        return {
          ok: false,
          refusal: {
            code: "not-implemented",
            detail: `"${op}" is defined as Tier ${def.tier} but has no applier in this build`,
            requiredTier: def.tier,
            grantedTier: this.maxGrantedTier(),
          },
        };
      }
      tier = def.tier > tier ? def.tier : tier;
      if (def.requiresApproval) needsApproval = true;
      if (def.destructive && !destructive) destructive = def;
    }

    if (!this.granted.has(tier)) {
      return {
        ok: false,
        refusal: {
          code: "tier-insufficient",
          detail: `${tier === 1 ? "Tier 1" : `Tier ${tier} (${SPATIAL_TIER_LABELS[tier]})`} is not granted to this session`,
          requiredTier: tier,
          grantedTier: this.maxGrantedTier(),
        },
      };
    }

    let approvalId: string | undefined;
    if (needsApproval) {
      const approval = options.approvalId ? this.approvals.get(options.approvalId) : undefined;
      const invalid = (): SpatialAuthorizationResult => ({
        ok: false,
        refusal: {
          code: approval ? "approval-invalid" : "approval-required",
          detail: approval
            ? "that approval is expired, used, or for a different operation"
            : `${destructive?.id ?? ops.join(", ")} needs your explicit approval`,
          requiredTier: tier,
        },
      });
      if (!approval) return invalid();
      if (approval.used || approval.expiresAt < Date.now()) return invalid();
      for (const op of ops) {
        if (SPATIAL_OPERATIONS[op].requiresApproval && !approval.ops.has(op)) return invalid();
      }
      approval.used = true;
      this.approvals.delete(approval.id);
      approvalId = approval.id;
    }

    const seal = issueSpatialWriteSeal(0, ops);
    const authorization: SpatialAuthorization = Object.freeze({
      [SEALED_SYMBOL]: true as const,
      seal,
      ops: [...ops],
      tier,
      approvalId,
      issuedAt: Date.now(),
    });
    authorizations.add(authorization);
    return { ok: true, authorization };
  }

  /** Test seam. */
  public reset(): void {
    this.granted = new Set<SpatialTier>([1, 2, 3]);
    this.approvals.clear();
  }
}
