/**
 * ==========================================================
 * LÉLU — SPATIAL MUTATION BRIDGE (Phase 2.3)
 *
 * The compatibility layer between a spatial reference and the
 * system that actually OWNS the entity.
 *
 * It exists to answer one question honestly: may LÉLU change
 * this thing, and if not, who owns it? Discovery (Phase 2.2)
 * made every entity addressable; that does not make every
 * entity writable.
 *
 *   authored  → this core owns it (SpatialSceneGraph). Writable
 *               through the existing sealed commit path.
 *   cosmos    → CosmosEntityRegistry owns it, and it exposes no
 *               transform/material setter and no change
 *               notification, so a mesh or field write would be
 *               neither authoritative nor rendered.
 *   world     → WorldRegistry destinations are labels and
 *               metadata; they have no transform at all.
 *   scene     → live three.js nodes are rendered products of a
 *               component's own state; writing the mesh would be
 *               overwritten on the next frame.
 *
 * A blocked category is reported blocked, with its owner named.
 * Nothing here writes to Genesis, Cosmos, the world registry or
 * the three.js scene, and no new registry is introduced.
 * ==========================================================
 */

import SpatialAdapter, { type SpatialEntityRef, type SpatialEntitySource } from "./SpatialAdapter";
import type { SpatialRefusal } from "./SpatialTypes";

export type MutationCapability =
  | "position"
  | "rotation"
  | "scale"
  | "visibility"
  | "material"
  | "relationship"
  | "delete";

export const MUTATION_CAPABILITIES: readonly MutationCapability[] = [
  "position",
  "rotation",
  "scale",
  "visibility",
  "material",
  "relationship",
  "delete",
];

export interface EntityMutationSupport {
  source: SpatialEntitySource;
  /** Who LÉLU would have to ask, in plain language. */
  owner: string;
  writable: boolean;
  supported: MutationCapability[];
  blocked: MutationCapability[];
  reason: string;
  /** Where a successful write is verified after the fact. */
  verification: string;
}

export interface SpatialMutationAudit {
  at: number;
  ref: string | null;
  source: SpatialEntitySource | null;
  requested: string;
  outcome: "allowed" | "blocked" | "unknown";
  reason: string;
  revision: number;
}

const SUPPORT: Record<SpatialEntitySource, EntityMutationSupport> = {
  authored: {
    source: "authored",
    owner: "the spatial scene graph (this core)",
    writable: true,
    supported: [...MUTATION_CAPABILITIES],
    blocked: [],
    reason:
      "Authored objects are owned by SpatialSceneGraph, so a sealed commit is both authoritative and what the R3F layer renders.",
    verification: "graph snapshot + live mesh (local position, material, visibility)",
  },
  cosmos: {
    source: "cosmos",
    owner: "CosmosEntityRegistry",
    writable: false,
    supported: [],
    blocked: [...MUTATION_CAPABILITIES],
    reason:
      "CosmosEntityRegistry exposes registration, visitation and deactivation, but no transform or material setter and no change notification. A field write would be neither authoritative nor rendered, so it is refused rather than faked.",
    verification: "not attempted: no authoritative mutation path exists",
  },
  world: {
    source: "world",
    owner: "WorldRegistry",
    writable: false,
    supported: [],
    blocked: [...MUTATION_CAPABILITIES],
    reason:
      "WorldRegistry destinations are labels and metadata (weight, scale class) with no spatial transform; there is nothing to move, rotate or recolour.",
    verification: "not attempted: destinations carry no transform",
  },
  scene: {
    source: "scene",
    owner: "the Genesis component that renders the node",
    writable: false,
    supported: [],
    blocked: [...MUTATION_CAPABILITIES],
    reason:
      "Live three.js nodes (Core, planets, avatar) are rendered products of their owning component's state and animation. Writing the mesh directly would be overwritten and would not update the authoritative state.",
    verification: "not attempted: renderer-owned node",
  },
};

export default class SpatialMutationBridge {
  private static instance: SpatialMutationBridge | null = null;

  private readonly adapter = SpatialAdapter.getInstance();
  private readonly auditTrail: SpatialMutationAudit[] = [];

  public static getInstance(): SpatialMutationBridge {
    if (!SpatialMutationBridge.instance) SpatialMutationBridge.instance = new SpatialMutationBridge();
    return SpatialMutationBridge.instance;
  }

  public supportFor(source: SpatialEntitySource): EntityMutationSupport {
    return SUPPORT[source];
  }

  /** The documented compatibility matrix, in a stable order. */
  public matrix(): EntityMutationSupport[] {
    return (["authored", "cosmos", "world", "scene"] as const).map((source) => SUPPORT[source]);
  }

  /**
   * Decide whether a reference may be mutated.
   *
   * A reference that does not resolve is `unknown-object`; a reference
   * owned somewhere else is `read-only-entity` with the owner and the
   * reason, so chat can explain instead of claiming a change.
   */
  public authorize(
    reference: string,
    capability: MutationCapability,
    revision: number,
  ):
    | { ok: true; entity: SpatialEntityRef }
    | { ok: false; refusal: SpatialRefusal } {
    const entity = this.adapter.resolve(reference);
    if (!entity) {
      this.record(reference, null, capability, "unknown", "no entity matches this reference", revision);
      return {
        ok: false,
        refusal: {
          code: "unknown-object",
          detail: `"${reference.trim()}" is not in the world`,
          candidates: this.adapter.candidates(reference),
        },
      };
    }

    const support = SUPPORT[entity.source];
    if (!support.writable || !support.supported.includes(capability)) {
      this.record(entity.ref, entity.source, capability, "blocked", support.reason, revision);
      return {
        ok: false,
        refusal: {
          code: "validation-failed",
          detail: `"${entity.name}" is owned by ${support.owner} and is read-only for ${capability}. ${support.reason}`,
        },
      };
    }

    this.record(entity.ref, entity.source, capability, "allowed", support.reason, revision);
    return { ok: true, entity };
  }

  /** Recent decisions, newest last. Bounded so it cannot grow without limit. */
  public audit(limit = 32): SpatialMutationAudit[] {
    return this.auditTrail.slice(-limit);
  }

  private record(
    reference: string,
    source: SpatialEntitySource | null,
    requested: string,
    outcome: SpatialMutationAudit["outcome"],
    reason: string,
    revision: number,
  ): void {
    this.auditTrail.push({
      at: Date.now(),
      ref: reference,
      source,
      requested,
      outcome,
      reason,
      revision,
    });
    if (this.auditTrail.length > 128) this.auditTrail.splice(0, this.auditTrail.length - 128);
  }

  /** Test seam. */
  public resetForTests(): void {
    this.auditTrail.length = 0;
  }
}
