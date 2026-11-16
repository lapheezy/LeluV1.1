/**
 * ==========================================================
 * LÉLU — SPATIAL SCENE GRAPH
 *
 * The single authoritative record of the live scene: objects,
 * relationships, a revision counter, an undo journal, and the
 * ONE commit path. Geometry is not owned here — the R3F layer
 * reads this graph and renders it with the existing renderer.
 *
 * Commit guarantees, each covered by tests:
 *
 *   - atomic: mutations are applied to a DRAFT, validated, and
 *     only then swapped in. A failure changes nothing;
 *   - guarded: a commit needs a SpatialAuthorization issued by
 *     SpatialTierGuard, and the registry refuses any write that
 *     is not sealed;
 *   - revisioned: an accepted commit increments the revision by
 *     exactly 1; a refused one does not increment it at all;
 *   - optimistic: callers pass the revision they based the
 *     change on, so a stale intent is refused rather than
 *     silently overwriting a newer scene;
 *   - reversible: every accepted commit keeps the state it
 *     replaced, so undo restores it exactly.
 * ==========================================================
 */

import {
  SPATIAL_LIMITS,
  type SpatialMaterial,
  type SpatialObject,
  type SpatialRefusal,
  type SpatialRelationship,
  type SpatialSceneSnapshot,
  type SpatialVec3,
} from "./SpatialTypes";
import SpatialObjectRegistry from "./SpatialObjectRegistry";
import { isSpatialWriteSeal } from "./SpatialSeal";
import {
  cloneSpatialObject,
  cloneSpatialRelationship,
  validateSpatialObject,
  validateSpatialRelationship,
  validateSpatialSnapshot,
} from "./SpatialValidation";

export interface SpatialObjectPatch {
  transform?: {
    position?: Partial<SpatialVec3>;
    rotation?: Partial<SpatialVec3>;
    scale?: Partial<SpatialVec3>;
  };
  material?: Partial<SpatialMaterial>;
  visible?: boolean;
  name?: string;
  tags?: string[];
}

export type SpatialMutation =
  | { type: "create"; object: SpatialObject }
  | { type: "update"; id: string; patch: SpatialObjectPatch }
  | { type: "delete"; id: string }
  | { type: "connect"; relationship: SpatialRelationship }
  | { type: "disconnect"; id: string };

export type SpatialCommitResult =
  | { ok: true; revision: number; applied: number }
  | { ok: false; revision: number; refusal: SpatialRefusal };

interface SpatialHistoryEntry {
  objects: Map<string, SpatialObject>;
  relationships: Map<string, SpatialRelationship>;
  label: string;
  at: number;
}

type SnapshotListener = (snapshot: SpatialSceneSnapshot) => void;

export default class SpatialSceneGraph {
  private static instance: SpatialSceneGraph | null = null;

  private readonly registry = SpatialObjectRegistry.getInstance();
  private relationships = new Map<string, SpatialRelationship>();
  private revision = 0;
  private history: SpatialHistoryEntry[] = [];
  private readonly listeners = new Set<SnapshotListener>();
  private cached: SpatialSceneSnapshot | null = null;

  public static getInstance(): SpatialSceneGraph {
    if (!SpatialSceneGraph.instance) {
      SpatialSceneGraph.instance = new SpatialSceneGraph();
    }
    return SpatialSceneGraph.instance;
  }

  public getRevision(): number {
    return this.revision;
  }

  /** Frozen, cached view — stable identity until the next commit. */
  public snapshot(): SpatialSceneSnapshot {
    if (!this.cached) {
      this.cached = Object.freeze({
        revision: this.revision,
        objects: Object.freeze(this.registry.all().map(cloneSpatialObject)),
        relationships: Object.freeze(this.relationshipsArray()),
        updatedAt: Date.now(),
      });
    }
    return this.cached;
  }

  public relationshipsList(): readonly SpatialRelationship[] {
    return this.snapshot().relationships;
  }

  public subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Apply mutations atomically.
   *
   * `expectedRevision` is the revision the caller built the change
   * against; a mismatch is a stale intent and is refused untouched.
   */
  public commit(
    mutations: readonly SpatialMutation[],
    options: { expectedRevision: number; authorization: unknown; label?: string },
  ): SpatialCommitResult {
    const authorization = options.authorization;

    if (!isSpatialAuthorizationLike(authorization)) {
      return this.fail({
        code: "unauthorized",
        detail: "this commit has no authorization from the spatial tier guard",
      });
    }
    if (!isSpatialWriteSeal(authorization.seal)) {
      return this.fail({
        code: "unauthorized",
        detail: "the commit seal was not issued by this process",
      });
    }
    if (mutations.length === 0) {
      return this.fail({ code: "validation-failed", detail: "the commit carried no mutations" });
    }
    if (options.expectedRevision !== this.revision) {
      return this.fail({
        code: "stale-revision",
        detail: `the scene moved from revision ${options.expectedRevision} to ${this.revision}`,
        expectedRevision: options.expectedRevision,
        actualRevision: this.revision,
      });
    }

    const draft = new Map<string, SpatialObject>();
    for (const object of this.registry.all()) {
      draft.set(object.id, cloneSpatialObject(object));
    }
    const draftRelationships = new Map<string, SpatialRelationship>();
    for (const [id, relationship] of this.relationships) {
      draftRelationships.set(id, cloneSpatialRelationship(relationship));
    }

    for (const mutation of mutations) {
      const error = this.applyToDraft(mutation, draft, draftRelationships);
      if (error) {
        return this.fail(error);
      }
    }

    for (const object of draft.values()) {
      const error = validateSpatialObject(object);
      if (error) {
        return this.fail({ code: "validation-failed", detail: error });
      }
    }
    const ids = new Set(draft.keys());
    for (const relationship of draftRelationships.values()) {
      const error = validateSpatialRelationship(relationship, ids);
      if (error) {
        return this.fail({ code: "validation-failed", detail: error });
      }
    }
    if (draft.size > SPATIAL_LIMITS.objects) {
      return this.fail({
        code: "limit-exceeded",
        detail: `the scene already holds ${SPATIAL_LIMITS.objects} objects`,
      });
    }
    if (draftRelationships.size > SPATIAL_LIMITS.relationships) {
      return this.fail({
        code: "limit-exceeded",
        detail: `the scene already holds ${SPATIAL_LIMITS.relationships} relationships`,
      });
    }

    // Atomic swap. Nothing above this line touched live state.
    const before: SpatialHistoryEntry = {
      objects: new Map(
        [...this.registry.all()].map((object) => [object.id, cloneSpatialObject(object)]),
      ),
      relationships: new Map(
        [...this.relationships].map(([id, relationship]) => [
          id,
          cloneSpatialRelationship(relationship),
        ]),
      ),
      label: options.label ?? "scene change",
      at: Date.now(),
    };

    if (!this.registry.write(draft, authorization.seal)) {
      return this.fail({
        code: "unauthorized",
        detail: "the registry refused the write seal",
      });
    }
    this.relationships = draftRelationships;
    this.revision += 1;
    this.remember(before);
    this.notify();

    return { ok: true, revision: this.revision, applied: mutations.length };
  }

  /** Reverse the last accepted mutation. This is itself a revision. */
  public undo(authorization: unknown): SpatialCommitResult {
    if (!isSpatialAuthorizationLike(authorization) || !authorization.ops.includes("scene.undo")) {
      return this.fail({
        code: "unauthorized",
        detail: "undo needs an authorization for scene.undo",
      });
    }
    const entry = this.history.pop();
    if (!entry) {
      return this.fail({ code: "validation-failed", detail: "there is nothing to undo" });
    }
    if (!this.registry.write(entry.objects, authorization.seal)) {
      return this.fail({ code: "unauthorized", detail: "the registry refused the write seal" });
    }
    this.relationships = entry.relationships;
    this.revision += 1;
    this.notify();
    return { ok: true, revision: this.revision, applied: 1 };
  }

  /** Restore a validated snapshot — a new revision, never a silent rollback. */
  public recover(snapshot: SpatialSceneSnapshot, authorization: unknown): SpatialCommitResult {
    if (!isSpatialAuthorizationLike(authorization) || !authorization.ops.includes("scene.recover")) {
      return this.fail({
        code: "unauthorized",
        detail: "recovery needs an authorization for scene.recover",
      });
    }
    const error = validateSpatialSnapshot(snapshot);
    if (error) {
      return this.fail({ code: "validation-failed", detail: `snapshot rejected: ${error}` });
    }
    const before: SpatialHistoryEntry = {
      objects: new Map(
        [...this.registry.all()].map((object) => [object.id, cloneSpatialObject(object)]),
      ),
      relationships: new Map(
        [...this.relationships].map(([id, relationship]) => [
          id,
          cloneSpatialRelationship(relationship),
        ]),
      ),
      label: "recovery",
      at: Date.now(),
    };
    const objects = new Map<string, SpatialObject>();
    for (const object of snapshot.objects) {
      objects.set(object.id, cloneSpatialObject(object));
    }
    const relationships = new Map<string, SpatialRelationship>();
    for (const relationship of snapshot.relationships) {
      relationships.set(relationship.id, cloneSpatialRelationship(relationship));
    }
    if (!this.registry.write(objects, authorization.seal)) {
      return this.fail({ code: "unauthorized", detail: "the registry refused the write seal" });
    }
    this.relationships = relationships;
    this.revision = Math.max(this.revision, snapshot.revision) + 1;
    this.remember(before);
    this.notify();
    return { ok: true, revision: this.revision, applied: snapshot.objects.length };
  }

  /** Test seam — a pristine, empty scene at revision 0. */
  public resetForTests(): void {
    this.registry.reset();
    this.relationships = new Map();
    this.revision = 0;
    this.history = [];
    this.cached = null;
    this.notify();
  }

  // ---- internals ----

  private applyToDraft(
    mutation: SpatialMutation,
    draft: Map<string, SpatialObject>,
    relationships: Map<string, SpatialRelationship>,
  ): SpatialRefusal | null {
    switch (mutation.type) {
      case "create": {
        if (draft.has(mutation.object.id)) {
          return {
            code: "already-exists",
            detail: `object id "${mutation.object.id}" already belongs to another object`,
          };
        }
        if (draft.size >= SPATIAL_LIMITS.objects) {
          return {
            code: "limit-exceeded",
            detail: `the scene holds the maximum of ${SPATIAL_LIMITS.objects} objects`,
          };
        }
        draft.set(mutation.object.id, cloneSpatialObject(mutation.object));
        return null;
      }
      case "update": {
        const existing = draft.get(mutation.id);
        if (!existing) {
          return { code: "unknown-object", detail: `"${mutation.id}" is not in the scene` };
        }
        const next = this.patchObject(existing, mutation.patch);
        if (typeof next === "string") {
          return { code: "validation-failed", detail: next };
        }
        if (mutation.patch.name) {
          const clash = [...draft.values()].find(
            (object) =>
              object.id !== existing.id &&
              object.name.toLowerCase() === mutation.patch.name?.trim().toLowerCase(),
          );
          if (clash) {
            return {
              code: "already-exists",
              detail: `another object is already named "${mutation.patch.name}"`,
            };
          }
        }
        draft.set(next.id, next);
        return null;
      }
      case "delete": {
        if (!draft.has(mutation.id)) {
          return { code: "unknown-object", detail: `"${mutation.id}" is not in the scene` };
        }
        draft.delete(mutation.id);
        for (const [id, relationship] of relationships) {
          if (relationship.from === mutation.id || relationship.to === mutation.id) {
            relationships.delete(id);
          }
        }
        return null;
      }
      case "connect": {
        const { from, to } = mutation.relationship;
        if (!draft.has(from)) {
          return { code: "unknown-object", detail: `"${from}" is not in the scene` };
        }
        if (!draft.has(to)) {
          return { code: "unknown-object", detail: `"${to}" is not in the scene` };
        }
        if (from === to) {
          return { code: "validation-failed", detail: "an object cannot be related to itself" };
        }
        const duplicate = [...relationships.values()].find(
          (relationship) =>
            relationship.from === from &&
            relationship.to === to &&
            relationship.kind === mutation.relationship.kind,
        );
        if (duplicate) {
          return {
            code: "already-exists",
            detail: `those objects are already linked (${duplicate.kind})`,
          };
        }
        if (relationships.size >= SPATIAL_LIMITS.relationships) {
          return {
            code: "limit-exceeded",
            detail: `the scene holds the maximum of ${SPATIAL_LIMITS.relationships} relationships`,
          };
        }
        relationships.set(mutation.relationship.id, cloneSpatialRelationship(mutation.relationship));
        return null;
      }
      case "disconnect": {
        if (!relationships.has(mutation.id)) {
          return {
            code: "unknown-object",
            detail: `relationship "${mutation.id}" is not in the scene`,
          };
        }
        relationships.delete(mutation.id);
        return null;
      }
    }
  }

  private patchObject(object: SpatialObject, patch: SpatialObjectPatch): SpatialObject | string {
    const next: SpatialObject = cloneSpatialObject(object);
    if (patch.transform?.position) {
      next.transform.position = { ...next.transform.position, ...patch.transform.position };
    }
    if (patch.transform?.rotation) {
      next.transform.rotation = { ...next.transform.rotation, ...patch.transform.rotation };
    }
    if (patch.transform?.scale) {
      next.transform.scale = { ...next.transform.scale, ...patch.transform.scale };
    }
    if (patch.material) {
      next.material = { ...next.material, ...patch.material };
    }
    if (patch.visible !== undefined) {
      next.visible = patch.visible;
    }
    if (patch.name !== undefined) {
      next.name = patch.name.trim().slice(0, SPATIAL_LIMITS.nameLength);
      if (!next.name) return "name cannot be empty";
    }
    if (patch.tags) {
      next.tags = [...patch.tags];
    }
    next.updatedAt = Date.now();
    const error = validateSpatialObject(next);
    return error ?? next;
  }

  private relationshipsArray(): SpatialRelationship[] {
    return [...this.relationships.values()].map(cloneSpatialRelationship);
  }

  private remember(entry: SpatialHistoryEntry): void {
    this.history.push(entry);
    if (this.history.length > SPATIAL_LIMITS.history) {
      this.history.splice(0, this.history.length - SPATIAL_LIMITS.history);
    }
  }

  private notify(): void {
    this.cached = null;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error("[Lélu Spatial] graph listener threw (contained)", error);
      }
    }
  }

  private fail(refusal: SpatialRefusal): SpatialCommitResult {
    return { ok: false, revision: this.revision, refusal };
  }
}

/**
 * Structural check kept local so the graph does not depend on the
 * guard's class identity — only on the shape its authorization has.
 * The seal inside is the unforgeable part.
 */
function isSpatialAuthorizationLike(value: unknown): value is {
  ops: readonly string[];
  seal: unknown;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { ops?: unknown }).ops) &&
    "seal" in (value as Record<string, unknown>)
  );
}
