/**
 * ==========================================================
 * LÉLU — SPATIAL INTENT BUS
 *
 * intent → validate → guard → commit → verify → event.
 *
 * This is the only entry point chat (or any caller) gets. It
 * builds declarative mutations, asks the tier guard for a sealed
 * authorization, commits them atomically with an expected
 * revision, then RE-READS the scene to confirm the post-condition
 * before it reports success.
 *
 * If that verification fails, the bus undoes its own commit and
 * reports `verification-failed` — a reply never describes a
 * scene that is not there.
 *
 * Intents are serialized through a promise chain, so concurrent
 * requests queue instead of interleaving their read/commit
 * windows. A caller that passes an old `expectedRevision` still
 * gets a `stale-revision` refusal.
 * ==========================================================
 */

import AgentEventBus from "../agent/AgentEvents";
import SpatialObjectRegistry from "./SpatialObjectRegistry";
import SpatialPresence, { type SpatialTraversal } from "./SpatialPresence";
import SpatialSceneGraph, { type SpatialMutation } from "./SpatialSceneGraph";
import SpatialTierGuard from "./SpatialTierGuard";
import {
  SPATIAL_DEFAULT_MATERIAL,
  SPATIAL_LIMITS,
  SPATIAL_PRIMITIVE_LABELS,
  defaultSpatialPlacement,
  type SpatialIntent,
  type SpatialIntentResult,
  type SpatialMaterial,
  type SpatialObject,
  type SpatialOperationId,
  type SpatialRefusal,
  type SpatialRelationshipKind,
  type SpatialVec3,
} from "./SpatialTypes";
import { normalizeSpatialColor, sameSpatialPosition } from "./SpatialValidation";

export interface SpatialApplyOptions {
  /** Single-use owner approval id, when the operation requires one. */
  approvalId?: string;
  /** The revision this intent was built against. */
  expectedRevision?: number;
  taskId?: string;
}

interface IntentPlan {
  ops: SpatialOperationId[];
  /** Human sentence describing the change that was committed. */
  label: string;
  mutations: SpatialMutation[];
  objectIds: string[];
  relationshipId?: string;
  traversal: SpatialTraversal;
  attention?: { id: string; name: string };
  /** Re-reads the committed scene. Returns null when verified. */
  verify: () => string | null;
}

type BuildResult =
  | { ok: true; plan: IntentPlan }
  | { ok: false; refusal: SpatialRefusal };

type ResolveResult =
  | { ok: true; object: SpatialObject }
  | { ok: false; refusal: SpatialRefusal };

export default class SpatialIntentBus {
  private static instance: SpatialIntentBus | null = null;

  private readonly graph = SpatialSceneGraph.getInstance();
  private readonly registry = SpatialObjectRegistry.getInstance();
  private readonly guard = SpatialTierGuard.getInstance();
  private readonly presence = SpatialPresence.getInstance();
  private tail: Promise<unknown> = Promise.resolve();

  public static getInstance(): SpatialIntentBus {
    if (!SpatialIntentBus.instance) {
      SpatialIntentBus.instance = new SpatialIntentBus();
    }
    return SpatialIntentBus.instance;
  }

  /**
   * Apply one intent. Resolves with the real outcome; never throws
   * for a refused or invalid intent — the result carries why.
   */
  public apply(
    intent: SpatialIntent,
    options: SpatialApplyOptions = {},
  ): Promise<SpatialIntentResult> {
    const taskId = String(options.taskId ?? Date.now());
    const run = () => this.run(intent, options, taskId);
    const queued = this.tail.then(run, run);
    this.tail = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.tail = Promise.resolve();
    this.graph.resetForTests();
    this.guard.reset();
    this.presence.resetForTests();
  }

  // ---- dispatch ----

  private async run(
    intent: SpatialIntent,
    options: SpatialApplyOptions,
    taskId: string,
  ): Promise<SpatialIntentResult> {
    switch (intent.op) {
      case "scene.list":
        return this.readScene(taskId);
      case "scene.inspect":
        return this.inspect(intent.target, taskId);
      case "scene.undo":
        return this.undo(taskId);
      default:
        return this.mutate(intent, options, taskId);
    }
  }

  private readScene(taskId: string): SpatialIntentResult {
    const authorization = this.guard.authorize(["scene.list"]);
    if (!authorization.ok) return this.refuse("scene.list", authorization.refusal, taskId);

    const snapshot = this.graph.snapshot();
    const parts = snapshot.objects.map(
      (object) =>
        `"${object.name}" (${object.kind}) at (${formatVec(object.transform.position)})`,
    );
    const message =
      snapshot.objects.length === 0
        ? `The scene is empty — revision ${snapshot.revision}.`
        : `Scene revision ${snapshot.revision}: ${snapshot.objects.length} object${snapshot.objects.length === 1 ? "" : "s"} — ${parts.join("; ")}${
            snapshot.relationships.length > 0
              ? `; ${snapshot.relationships.length} relationship${snapshot.relationships.length === 1 ? "" : "s"}`
              : ""
          }.`;

    this.presence.record({
      op: "scene.list",
      traversal: "inspecting",
      revision: snapshot.revision,
    });
    this.emitEvent(taskId, "scene.list", `listed ${snapshot.objects.length} object(s)`);
    return {
      ok: true,
      op: "scene.list",
      revision: snapshot.revision,
      message,
      objectIds: snapshot.objects.map((object) => object.id),
    };
  }

  private inspect(target: string, taskId: string): SpatialIntentResult {
    const authorization = this.guard.authorize(["scene.inspect"]);
    if (!authorization.ok) return this.refuse("scene.inspect", authorization.refusal, taskId);

    const resolved = this.resolveTarget(target);
    if (!resolved.ok) return this.refuse("scene.inspect", resolved.refusal, taskId);

    const object = resolved.object;
    const links = this.graph
      .relationshipsList()
      .filter((relationship) => relationship.from === object.id || relationship.to === object.id)
      .map((relationship) => relationship.kind);
    const message = [
      `"${object.name}" — ${SPATIAL_PRIMITIVE_LABELS[object.kind]} (${object.id}), ${object.visible ? "visible" : "hidden"}`,
      `position (${formatVec(object.transform.position)}), rotation (${formatVec(object.transform.rotation)}) rad, scale (${formatVec(object.transform.scale)})`,
      `material ${object.material.color}, metalness ${object.material.metalness}, roughness ${object.material.roughness}, opacity ${object.material.opacity}`,
      links.length > 0 ? `relationships: ${links.join(", ")}` : "no relationships",
      `provenance: ${object.provenance} (${object.createdBy})`,
    ].join(". ");

    this.presence.record({
      op: "scene.inspect",
      traversal: "inspecting",
      objectId: object.id,
      objectName: object.name,
      revision: this.graph.getRevision(),
    });
    this.emitEvent(taskId, "scene.inspect", `inspected "${object.name}"`);
    return {
      ok: true,
      op: "scene.inspect",
      revision: this.graph.getRevision(),
      message,
      objectId: object.id,
      objectName: object.name,
    };
  }

  private undo(taskId: string): SpatialIntentResult {
    this.emitStarted(taskId, "undo the last scene change");
    const authorization = this.guard.authorize(["scene.undo"]);
    if (!authorization.ok) return this.refuse("scene.undo", authorization.refusal, taskId);

    const result = this.graph.undo(authorization.authorization);
    if (!result.ok) return this.refuse("scene.undo", result.refusal, taskId);

    this.presence.record({
      op: "scene.undo",
      traversal: "constructing",
      revision: result.revision,
    });
    this.emitEvent(taskId, "scene.undo", "undid the last change");
    this.emitResult(taskId, "undid the last scene change", result.revision);
    return {
      ok: true,
      op: "scene.undo",
      revision: result.revision,
      message: `Undone — the scene is back to the state before the last change, at revision ${result.revision}.`,
    };
  }

  private mutate(
    intent: Exclude<SpatialIntent, { op: "scene.list" | "scene.inspect" | "scene.undo" }>,
    options: SpatialApplyOptions,
    taskId: string,
  ): SpatialIntentResult {
    const built = this.build(intent);
    if (!built.ok) return this.refuse(intent.op, built.refusal, taskId);

    const plan = built.plan;
    this.emitStarted(taskId, plan.label);

    const expectedRevision = options.expectedRevision ?? this.graph.getRevision();
    const authorization = this.guard.authorize(plan.ops, { approvalId: options.approvalId });
    if (!authorization.ok) return this.refuse(intent.op, authorization.refusal, taskId);

    const commit = this.graph.commit(plan.mutations, {
      expectedRevision,
      authorization: authorization.authorization,
      label: plan.label,
    });
    if (!commit.ok) return this.refuse(intent.op, commit.refusal, taskId);

    const verification = plan.verify();
    if (verification) {
      // The commit landed but does not match what we promised. Undo it
      // and report the truth rather than describe a scene we did not get.
      const rollback = this.guard.authorize(["scene.undo"]);
      if (rollback.ok) this.graph.undo(rollback.authorization);
      return this.refuse(
        intent.op,
        { code: "verification-failed", detail: verification },
        taskId,
      );
    }

    const snapshot = this.graph.snapshot();
    const attention = plan.attention
      ? snapshot.objects.find((object) => object.id === plan.attention?.id)
      : undefined;
    this.presence.record({
      op: intent.op,
      traversal: plan.traversal,
      objectId: attention?.id,
      objectName: attention?.name,
      revision: snapshot.revision,
    });
    this.emitEvent(taskId, intent.op, plan.label);
    this.emitResult(taskId, plan.label, snapshot.revision);

    const count = snapshot.objects.length;
    const message =
      intent.op === "object.create"
        ? `${plan.label}. Scene revision ${snapshot.revision} — ${count} object${count === 1 ? "" : "s"}.`
        : `${plan.label}. Scene revision ${snapshot.revision}.`;

    return {
      ok: true,
      op: intent.op,
      revision: snapshot.revision,
      message,
      objectId: plan.attention?.id,
      objectName: plan.attention?.name,
      objectIds: plan.objectIds,
      relationshipId: plan.relationshipId,
    };
  }

  // ---- planning ----

  private build(
    intent: Exclude<SpatialIntent, { op: "scene.list" | "scene.inspect" | "scene.undo" }>,
  ): BuildResult {
    switch (intent.op) {
      case "object.create":
        return this.planCreate(intent);
      case "object.move":
        return this.planMove(intent);
      case "object.rotate":
        return this.planRotate(intent);
      case "object.scale":
        return this.planScale(intent);
      case "object.setVisible":
        return this.planVisibility(intent);
      case "material.set":
        return this.planMaterial(intent);
      case "object.connect":
        return this.planConnect(intent);
      case "object.delete":
        return this.planDelete(intent);
    }
  }

  private planCreate(
    intent: Extract<SpatialIntent, { op: "object.create" }>,
  ): BuildResult {
    const base = defaultSpatialPlacement(this.registry.count());
    const position: SpatialVec3 = {
      x: intent.position?.x ?? base.x,
      y: intent.position?.y ?? base.y,
      z: intent.position?.z ?? base.z,
    };
    const scale = intent.scale ?? 1;
    if (!Number.isFinite(scale) || scale < SPATIAL_LIMITS.scaleMin || scale > SPATIAL_LIMITS.scaleMax) {
      return fail(
        "validation-failed",
        `scale must be between ${SPATIAL_LIMITS.scaleMin} and ${SPATIAL_LIMITS.scaleMax}`,
      );
    }

    const color = normalizeSpatialColor(intent.color ?? SPATIAL_DEFAULT_MATERIAL.color);
    if (!color) return fail("validation-failed", `"${intent.color}" is not a #rrggbb colour`);

    const material: SpatialMaterial = { ...SPATIAL_DEFAULT_MATERIAL, ...intent.material, color };
    if (intent.material?.emissive) {
      const emissive = normalizeSpatialColor(intent.material.emissive);
      if (!emissive) {
        return fail("validation-failed", `"${intent.material.emissive}" is not a #rrggbb colour`);
      }
      material.emissive = emissive;
    }

    const id = this.registry.nextId(intent.kind);
    const name = intent.name
      ? this.registry.uniqueName(intent.name, intent.kind)
      : this.registry.nextName(intent.kind);
    const now = Date.now();
    const object: SpatialObject = {
      id,
      name,
      kind: intent.kind,
      transform: {
        position,
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: scale, y: scale, z: scale },
      },
      material,
      visible: true,
      provenance: "agent",
      createdBy: "lelu",
      tags: [],
      createdAt: now,
      updatedAt: now,
    };

    return {
      ok: true,
      plan: {
        ops: ["object.create"],
        label: `Created "${name}" (${intent.kind}) at (${formatVec(position)})`,
        mutations: [{ type: "create", object }],
        objectIds: [id],
        traversal: "constructing",
        attention: { id, name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === id);
          if (!committed) return `"${name}" is not in the scene after the commit`;
          if (!sameSpatialPosition(committed.transform.position, position)) {
            return `"${name}" is not at the position that was committed`;
          }
          return null;
        },
      },
    };
  }

  private planMove(intent: Extract<SpatialIntent, { op: "object.move" }>): BuildResult {
    const resolved = this.resolveTarget(intent.target);
    if (!resolved.ok) return resolved;
    const object = resolved.object;
    const current = object.transform.position;
    const position: SpatialVec3 = intent.position
      ? {
          x: intent.position.x ?? current.x,
          y: intent.position.y ?? current.y,
          z: intent.position.z ?? current.z,
        }
      : {
          x: current.x + (intent.delta?.x ?? 0),
          y: current.y + (intent.delta?.y ?? 0),
          z: current.z + (intent.delta?.z ?? 0),
        };
    if (sameSpatialPosition(position, current)) {
      return fail("validation-failed", `"${object.name}" is already at that position`);
    }
    if (Math.abs(position.x) > SPATIAL_LIMITS.position || Math.abs(position.y) > SPATIAL_LIMITS.position || Math.abs(position.z) > SPATIAL_LIMITS.position) {
      return fail("validation-failed", `that destination is outside the scene bounds (±${SPATIAL_LIMITS.position})`);
    }

    return {
      ok: true,
      plan: {
        ops: ["object.move"],
        label: `Moved "${object.name}" to (${formatVec(position)})`,
        mutations: [
          { type: "update", id: object.id, patch: { transform: { position } } },
        ],
        objectIds: [object.id],
        traversal: "moving",
        attention: { id: object.id, name: object.name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === object.id);
          if (!committed) return `"${object.name}" disappeared during the move`;
          if (!sameSpatialPosition(committed.transform.position, position)) {
            return `"${object.name}" did not end up at the committed position`;
          }
          return null;
        },
      },
    };
  }

  private planRotate(intent: Extract<SpatialIntent, { op: "object.rotate" }>): BuildResult {
    const resolved = this.resolveTarget(intent.target);
    if (!resolved.ok) return resolved;
    const object = resolved.object;
    const rotation: SpatialVec3 = {
      x: object.transform.rotation.x + (intent.delta.x ?? 0),
      y: object.transform.rotation.y + (intent.delta.y ?? 0),
      z: object.transform.rotation.z + (intent.delta.z ?? 0),
    };
    const degrees = Math.round(
      (Math.max(Math.abs(intent.delta.x ?? 0), Math.abs(intent.delta.y ?? 0), Math.abs(intent.delta.z ?? 0)) *
        180) /
        Math.PI,
    );
    return {
      ok: true,
      plan: {
        ops: ["object.rotate"],
        label: `Rotated "${object.name}" by ${degrees}°`,
        mutations: [{ type: "update", id: object.id, patch: { transform: { rotation } } }],
        objectIds: [object.id],
        traversal: "moving",
        attention: { id: object.id, name: object.name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === object.id);
          if (!committed) return `"${object.name}" disappeared during the rotation`;
          const matches =
            Math.abs(committed.transform.rotation.x - rotation.x) < 1e-6 &&
            Math.abs(committed.transform.rotation.y - rotation.y) < 1e-6 &&
            Math.abs(committed.transform.rotation.z - rotation.z) < 1e-6;
          return matches ? null : `"${object.name}" is not at the committed rotation`;
        },
      },
    };
  }

  private planScale(intent: Extract<SpatialIntent, { op: "object.scale" }>): BuildResult {
    const resolved = this.resolveTarget(intent.target);
    if (!resolved.ok) return resolved;
    const object = resolved.object;
    const current = object.transform.scale.x;
    const absolute = intent.scale;
    const factor = intent.factor ?? 1;
    if (absolute === undefined && (!Number.isFinite(factor) || factor <= 0)) {
      return fail("validation-failed", "scale factor must be a positive number");
    }
    const next = absolute ?? current * factor;
    if (!Number.isFinite(next) || next < SPATIAL_LIMITS.scaleMin || next > SPATIAL_LIMITS.scaleMax) {
      return fail(
        "validation-failed",
        `the resulting scale must stay between ${SPATIAL_LIMITS.scaleMin} and ${SPATIAL_LIMITS.scaleMax}`,
      );
    }
    const scale: SpatialVec3 = { x: next, y: next, z: next };
    return {
      ok: true,
      plan: {
        ops: ["object.scale"],
        label: `Resized "${object.name}" to ${round(next)}× its base size`,
        mutations: [{ type: "update", id: object.id, patch: { transform: { scale } } }],
        objectIds: [object.id],
        traversal: "moving",
        attention: { id: object.id, name: object.name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === object.id);
          if (!committed) return `"${object.name}" disappeared during the resize`;
          return Math.abs(committed.transform.scale.x - next) < 1e-6
            ? null
            : `"${object.name}" is not at the committed scale`;
        },
      },
    };
  }

  private planVisibility(intent: Extract<SpatialIntent, { op: "object.setVisible" }>): BuildResult {
    const resolved = this.resolveTarget(intent.target);
    if (!resolved.ok) return resolved;
    const object = resolved.object;
    return {
      ok: true,
      plan: {
        ops: ["object.setVisible"],
        label: `${intent.visible ? "Showed" : "Hid"} "${object.name}"`,
        mutations: [{ type: "update", id: object.id, patch: { visible: intent.visible } }],
        objectIds: [object.id],
        traversal: "moving",
        attention: { id: object.id, name: object.name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === object.id);
          if (!committed) return `"${object.name}" disappeared while changing visibility`;
          return committed.visible === intent.visible
            ? null
            : `"${object.name}" did not change visibility`;
        },
      },
    };
  }

  private planMaterial(intent: Extract<SpatialIntent, { op: "material.set" }>): BuildResult {
    const resolved = this.resolveTarget(intent.target);
    if (!resolved.ok) return resolved;
    const object = resolved.object;

    const patch: Partial<SpatialMaterial> = {};
    if (intent.color !== undefined) {
      const color = normalizeSpatialColor(intent.color);
      if (!color) return fail("validation-failed", `"${intent.color}" is not a #rrggbb colour`);
      patch.color = color;
    }
    if (intent.emissive !== undefined) {
      const emissive = normalizeSpatialColor(intent.emissive);
      if (!emissive) return fail("validation-failed", `"${intent.emissive}" is not a #rrggbb colour`);
      patch.emissive = emissive;
    }
    if (intent.metalness !== undefined) patch.metalness = clamp01(intent.metalness);
    if (intent.roughness !== undefined) patch.roughness = clamp01(intent.roughness);
    if (intent.opacity !== undefined) patch.opacity = clamp01(intent.opacity);
    if (intent.emissiveIntensity !== undefined) {
      patch.emissiveIntensity = Math.min(3, Math.max(0, intent.emissiveIntensity));
    }
    if (intent.wireframe !== undefined) patch.wireframe = intent.wireframe;
    if (Object.keys(patch).length === 0) {
      return fail("validation-failed", "no material property was requested");
    }

    const descriptor =
      patch.color !== undefined
        ? `colour ${patch.color}`
        : patch.emissiveIntensity !== undefined
          ? "glow"
          : Object.keys(patch).join(", ");

    return {
      ok: true,
      plan: {
        ops: ["material.set"],
        label: `Changed "${object.name}" — ${descriptor}`,
        mutations: [{ type: "update", id: object.id, patch: { material: patch } }],
        objectIds: [object.id],
        traversal: "constructing",
        attention: { id: object.id, name: object.name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === object.id);
          if (!committed) return `"${object.name}" disappeared while changing its material`;
          for (const [key, value] of Object.entries(patch) as Array<
            [keyof SpatialMaterial, SpatialMaterial[keyof SpatialMaterial]]
          >) {
            if (committed.material[key] !== value) {
              return `"${object.name}" did not take the committed ${key}`;
            }
          }
          return null;
        },
      },
    };
  }

  private planConnect(intent: Extract<SpatialIntent, { op: "object.connect" }>): BuildResult {
    const from = this.resolveTarget(intent.from);
    if (!from.ok) return from;
    const to = this.resolveTarget(intent.to);
    if (!to.ok) return to;
    if (from.object.id === to.object.id) {
      return fail("validation-failed", `"${from.object.name}" cannot be linked to itself`);
    }
    const kind: SpatialRelationshipKind = intent.kind ?? "connected";
    const id = `link-${from.object.id}-${to.object.id}-${kind}`;

    return {
      ok: true,
      plan: {
        ops: ["object.connect"],
        label: `Linked "${from.object.name}" → "${to.object.name}" (${kind})`,
        mutations: [
          {
            type: "connect",
            relationship: { id, from: from.object.id, to: to.object.id, kind, createdAt: Date.now() },
          },
        ],
        objectIds: [from.object.id, to.object.id],
        relationshipId: id,
        traversal: "constructing",
        attention: { id: to.object.id, name: to.object.name },
        verify: () => {
          const committed = this.graph.snapshot().relationships.find((link) => link.id === id);
          return committed ? null : "the relationship is not in the scene after the commit";
        },
      },
    };
  }

  private planDelete(intent: Extract<SpatialIntent, { op: "object.delete" }>): BuildResult {
    const resolved = this.resolveTarget(intent.target);
    if (!resolved.ok) return resolved;
    const object = resolved.object;
    return {
      ok: true,
      plan: {
        ops: ["object.delete"],
        label: `Deleted "${object.name}"`,
        mutations: [{ type: "delete", id: object.id }],
        objectIds: [object.id],
        traversal: "constructing",
        attention: { id: object.id, name: object.name },
        verify: () => {
          const committed = this.graph.snapshot().objects.find((candidate) => candidate.id === object.id);
          return committed ? `"${object.name}" is still in the scene after the delete` : null;
        },
      },
    };
  }

  // ---- helpers ----

  private resolveTarget(reference: string): ResolveResult {
    const object = this.registry.resolve(reference);
    if (object) return { ok: true, object };
    return {
      ok: false,
      refusal: {
        code: "unknown-object",
        detail: `"${reference.trim()}" is not in the scene`,
        candidates: this.registry.describeContents(),
      },
    };
  }

  private emitStarted(taskId: string, label: string): void {
    const events = AgentEventBus.getInstance();
    events.emit({ type: "tool_selected", taskId, tool: "spatial", label });
    events.emit({ type: "tool_started", taskId, tool: "spatial", label });
  }

  private emitEvent(taskId: string, op: string, label: string): void {
    AgentEventBus.getInstance().emit({
      type: "spatial_event",
      taskId,
      op,
      label,
      side: "frontend",
      layer: "spatial",
    });
  }

  private emitResult(taskId: string, label: string, revision: number): void {
    AgentEventBus.getInstance().emit({
      type: "tool_result",
      taskId,
      tool: "spatial",
      result: `${label} (scene revision ${revision})`,
    });
  }

  private refuse(
    op: SpatialOperationId,
    refusal: SpatialRefusal,
    taskId: string,
  ): SpatialIntentResult {
    const revision = this.graph.getRevision();
    const message = this.refusalMessage(refusal, revision);
    AgentEventBus.getInstance().emit({
      type: "tool_failed",
      taskId,
      tool: "spatial",
      error: message,
    });
    return { ok: false, op, revision, message, refusal };
  }

  private refusalMessage(refusal: SpatialRefusal, revision: number): string {
    switch (refusal.code) {
      case "approval-required":
        return `I did not change the scene. ${capitalize(refusal.detail)}. Say "…, I approve" and I'll run it exactly once. Revision is still ${revision}.`;
      case "approval-invalid":
        return `I did not change the scene. ${capitalize(refusal.detail)} — ask me again with a fresh "I approve". Revision is still ${revision}.`;
      case "tier-insufficient":
        return `I did not change the scene. That needs Tier ${refusal.requiredTier}${
          refusal.grantedTier ? ` and this session is granted up to Tier ${refusal.grantedTier}` : ""
        }. Revision is still ${revision}.`;
      case "stale-revision":
        return `Nothing was applied: ${refusal.detail} while I was preparing that. Revision is ${refusal.actualRevision ?? revision}.`;
      case "unknown-object": {
        const candidates = refusal.candidates?.length
          ? ` In the scene: ${refusal.candidates.join(", ")}.`
          : " The scene is empty.";
        return `I did not change the scene: ${refusal.detail}.${candidates} Revision is still ${revision}.`;
      }
      default:
        return `I did not change the scene: ${refusal.detail}. Revision is still ${revision}.`;
    }
  }

}

function fail(code: SpatialRefusal["code"], detail: string): BuildResult {
  return { ok: false, refusal: { code, detail } };
}

function formatVec(vector: SpatialVec3): string {
  return `${round(vector.x)}, ${round(vector.y)}, ${round(vector.z)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
