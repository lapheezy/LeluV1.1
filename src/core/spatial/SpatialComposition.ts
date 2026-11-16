/**
 * ==========================================================
 * LÉLU — SPATIAL COMPOSITION ENGINE
 *
 * Phase 2.2 · Gates D/E. Turns a sentence into a scene plan,
 * then commits the whole plan as ONE atomic revision.
 *
 *   request → plan (no writes) → owner approval → one commit
 *           → verification → reply
 *
 * Planning is separated from committing on purpose: a plan can
 * be shown to the owner without touching the scene, and the
 * commit re-checks the revision it was planned against, so a
 * scene that moved in between is refused instead of overwritten.
 *
 * Every object in a batch is created through the same registry
 * identity rules as a single create; every relationship is a
 * real typed link; validation happens inside the graph's draft
 * commit, so a rejected batch leaves no partial scene.
 * ==========================================================
 */

import SpatialAdapter from "./SpatialAdapter";
import { getLiveSceneProvider, type LiveSceneNode } from "./SpatialLiveScene";
import SpatialObjectRegistry from "./SpatialObjectRegistry";
import SpatialSceneGraph, { type SpatialMutation } from "./SpatialSceneGraph";
import SpatialTierGuard from "./SpatialTierGuard";
import {
  SPATIAL_DEFAULT_MATERIAL,
  type SpatialMaterial,
  type SpatialPrimitiveKind,
  type SpatialRefusal,
  type SpatialRelationshipKind,
  type SpatialSceneSnapshot,
  type SpatialVec3,
  type SpatialVerificationSummary,
} from "./SpatialTypes";
import { normalizeSpatialColor } from "./SpatialValidation";
import {
  objectExpectation,
  summarize,
  verifyObjects,
  verifyRenderer,
  type SpatialObjectExpectation,
} from "./SpatialVerification";

export interface PlannedObject {
  /** Local key, scoped to the plan — never a registry id. */
  key: string;
  name: string;
  kind: SpatialPrimitiveKind;
  position: SpatialVec3;
  scale: number;
  color: string;
  role: string;
}

export interface PlannedLink {
  from: string;
  to: string;
  kind: SpatialRelationshipKind;
}

export interface PlannedUpdate {
  id: string;
  position: SpatialVec3;
}

export interface SpatialCompositionPlan {
  planId: string;
  request: string;
  anchor: { id: string; name: string; position: SpatialVec3 } | null;
  objects: PlannedObject[];
  links: PlannedLink[];
  updates: PlannedUpdate[];
  expectedRevision: number;
  createdAt: number;
  summary: string;
}

export type PlanResult =
  | { ok: true; plan: SpatialCompositionPlan }
  | { ok: false; refusal: SpatialRefusal };

export interface CommitResult {
  ok: boolean;
  revision: number;
  message: string;
  objectIds?: string[];
  objectNames?: string[];
  verification?: SpatialVerificationSummary;
  rolledBack?: boolean;
  refusal?: SpatialRefusal;
}

const COLOURS = {
  station: "#94a3b8",
  mast: "#cbd5e1",
  dish: "#38bdf8",
  hull: "#64748b",
  star: "#fbbf24",
  research: "#22d3ee",
  lab: "#a78bfa",
  observatory: "#e879f9",
} as const;

const PLANET_COLOURS = ["#60a5fa", "#34d399", "#f472b6", "#f59e0b", "#a78bfa", "#22d3ee"];

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const PENDING_TTL_MS = 10 * 60_000;

function vec(x: number, y: number, z: number): SpatialVec3 {
  return { x: round(x), y: round(y), z: round(z) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function offset(base: SpatialVec3, dx: number, dy: number, dz: number): SpatialVec3 {
  return vec(base.x + dx, base.y + dy, base.z + dz);
}

function parseCount(text: string, fallback: number): number {
  const digit = /\b(\d{1,2})\b/.exec(text);
  if (digit) return Math.max(1, Math.min(10, Number(digit[1])));
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return value;
  }
  return fallback;
}

function nameFromRequest(request: string, fallback: string): string {
  const named = /\b(?:called|named)\s+([a-z0-9][a-z0-9 _-]{0,40}?)(?:\s+(?:at|in|on|to|near|beside)\b|$)/i.exec(
    request,
  );
  return named?.[1]?.trim() ?? fallback;
}

export default class SpatialComposition {
  private static instance: SpatialComposition | null = null;

  private readonly graph = SpatialSceneGraph.getInstance();
  private readonly registry = SpatialObjectRegistry.getInstance();
  private readonly guard = SpatialTierGuard.getInstance();
  private readonly adapter = SpatialAdapter.getInstance();
  private readonly plans = new Map<string, SpatialCompositionPlan>();
  private sequence = 0;

  public static getInstance(): SpatialComposition {
    if (!SpatialComposition.instance) SpatialComposition.instance = new SpatialComposition();
    return SpatialComposition.instance;
  }

  /** Plan only. Nothing is written to the scene here. */
  public prepare(request: string, anchorReference?: string): PlanResult {
    const text = request.trim();
    if (!text) return this.fail("validation-failed", "there is no scene request to plan");

    let anchor: SpatialCompositionPlan["anchor"] = null;
    if (anchorReference) {
      const resolved = this.adapter.resolve(anchorReference);
      if (!resolved) {
        return {
          ok: false,
          refusal: {
            code: "unknown-object",
            detail: `"${anchorReference}" is not in the world, so there is nothing to build beside`,
            candidates: this.adapter.candidates(anchorReference),
          },
        };
      }
      if (!resolved.position) {
        return this.fail("validation-failed", `"${resolved.name}" has no position to build beside`);
      }
      anchor = { id: resolved.id, name: resolved.name, position: resolved.position };
    }

    const built = this.planForText(text, anchor);
    if (!built.ok) return built;

    const plan = built.plan;
    if (plan.objects.length === 0 && plan.updates.length === 0) {
      return this.fail("validation-failed", "that request does not describe a scene I can build");
    }
    this.sequence += 1;
    const withId: SpatialCompositionPlan = {
      ...plan,
      planId: `plan-${Date.now().toString(36)}-${this.sequence}`,
      expectedRevision: this.graph.getRevision(),
      createdAt: Date.now(),
      summary: this.describe(plan),
    };
    this.plans.set(withId.planId, withId);
    this.prunePlans();
    return { ok: true, plan: withId };
  }

  public get(planId: string): SpatialCompositionPlan | null {
    return this.plans.get(planId) ?? null;
  }

  /** Most recent plan that has not been committed, within the TTL. */
  public pending(): SpatialCompositionPlan | null {
    this.prunePlans();
    let newest: SpatialCompositionPlan | null = null;
    for (const plan of this.plans.values()) {
      if (!newest || plan.createdAt > newest.createdAt) newest = plan;
    }
    return newest;
  }

  public forget(planId: string): void {
    this.plans.delete(planId);
  }

  /**
   * Commit a prepared plan as one revision. Requires an owner approval
   * for `scene.commit`; on verification failure the batch is undone and
   * the result says so.
   */
  public commit(
    planId: string,
    options: { approvalId?: string; expectedRevision?: number } = {},
  ): CommitResult {
    const plan = this.plans.get(planId);
    if (!plan) {
      return {
        ok: false,
        revision: this.graph.getRevision(),
        message: "I did not change the scene: that plan has expired or was already committed.",
        refusal: { code: "validation-failed", detail: "no prepared plan with that id" },
      };
    }
    // A plan is bound to the revision it was built against, so a scene that moved
    // in the meantime is refused rather than overwritten.
    const expectedRevision = options.expectedRevision ?? plan.expectedRevision;
    if (expectedRevision !== this.graph.getRevision()) {
      return {
        ok: false,
        revision: this.graph.getRevision(),
        message: `Nothing was applied: the scene moved to revision ${this.graph.getRevision()} while I was planning.`,
        refusal: {
          code: "stale-revision",
          detail: "the scene changed while the plan was waiting",
          expectedRevision,
          actualRevision: this.graph.getRevision(),
        },
      };
    }

    const authorization = this.guard.authorize(["scene.commit"], { approvalId: options.approvalId });
    if (!authorization.ok) {
      return {
        ok: false,
        revision: this.graph.getRevision(),
        message: this.refusalText(authorization.refusal),
        refusal: authorization.refusal,
      };
    }

    const mutations: SpatialMutation[] = [];
    const expectations: SpatialObjectExpectation[] = [];
    const created: { id: string; name: string }[] = [];
    const keyToId = new Map<string, string>();

    for (const planned of plan.objects) {
      const id = this.registry.nextId(planned.kind);
      const name = this.registry.uniqueName(planned.name, planned.kind);
      const color = normalizeSpatialColor(planned.color) ?? SPATIAL_DEFAULT_MATERIAL.color;
      const material: SpatialMaterial = {
        ...SPATIAL_DEFAULT_MATERIAL,
        color,
        emissive: color,
        emissiveIntensity: 0.22,
        metalness: 0.35,
        roughness: 0.4,
      };
      const now = Date.now();
      const object = {
        id,
        name,
        kind: planned.kind,
        transform: {
          position: planned.position,
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: planned.scale, y: planned.scale, z: planned.scale },
        },
        material,
        visible: true,
        provenance: "agent" as const,
        createdBy: "lelu" as const,
        tags: [`compose:${plan.planId}`],
        createdAt: now,
        updatedAt: now,
      };
      keyToId.set(planned.key, id);
      created.push({ id, name });
      mutations.push({ type: "create", object });
      expectations.push(objectExpectation(object));
    }

    for (const update of plan.updates) {
      const existing = this.registry.get(update.id);
      if (!existing) {
        return {
          ok: false,
          revision: this.graph.getRevision(),
          message: `I did not change the scene: "${update.id}" is no longer there to arrange.`,
          refusal: { code: "unknown-object", detail: `"${update.id}" is not in the scene` },
        };
      }
      mutations.push({ type: "update", id: update.id, patch: { transform: { position: update.position } } });
      expectations.push({ id: update.id, localPosition: update.position });
    }

    for (const link of plan.links) {
      const from = keyToId.get(link.from);
      const to = keyToId.get(link.to);
      if (!from || !to) continue;
      mutations.push({
        type: "connect",
        relationship: {
          id: `link-${from}-${to}-${link.kind}`,
          from,
          to,
          kind: link.kind,
          createdAt: Date.now(),
        },
      });
    }

    const commit = this.graph.commit(mutations, {
      expectedRevision,
      authorization: authorization.authorization,
      label: plan.summary,
    });
    if (!commit.ok) {
      return {
        ok: false,
        revision: commit.revision,
        message: this.refusalText(commit.refusal),
        refusal: commit.refusal,
      };
    }

    // Verification: graph + live renderer. Roll back the whole batch when
    // what is rendered does not match what was committed.
    const nodes: LiveSceneNode[] | null = getLiveSceneProvider()?.listNodes() ?? null;
    const snapshot = this.graph.snapshot();
    const checks = verifyObjects(snapshot, expectations, nodes);
    const report = summarize(checks, { screenshot: "not-captured" });
    this.plans.delete(planId);

    if (!report.ok) {
      const rollbackAuth = this.guard.authorize(["scene.undo"]);
      let rolledBack = false;
      if (rollbackAuth.ok) {
        rolledBack = this.graph.undo(rollbackAuth.authorization).ok;
      }
      const failed = report.checks.find((entry) => entry.status === "fail");
      return {
        ok: false,
        revision: this.graph.getRevision(),
        message: `I rolled that back: the ${failed?.layer ?? "renderer"} check failed (${failed?.detail ?? "no detail"}). Revision is ${this.graph.getRevision()}.`,
        rolledBack,
        verification: report,
        refusal: {
          code: "verification-failed",
          detail: `${failed?.layer ?? "renderer"} verification failed: ${failed?.detail ?? "unknown"}`,
        },
      };
    }

    return {
      ok: true,
      revision: snapshot.revision,
      message: `Committed ${created.length} object${created.length === 1 ? "" : "s"} at revision ${snapshot.revision}.`,
      objectIds: created.map((object) => object.id),
      objectNames: created.map((object) => object.name),
      verification: report,
    };
  }

  /** Verify a composition that is already committed (used by chat). */
  public verify(plan: SpatialCompositionPlan): SpatialVerificationSummary {
    const snapshot: SpatialSceneSnapshot = this.graph.snapshot();
    const nodes = getLiveSceneProvider()?.listNodes() ?? null;
    const names = new Set(plan.objects.map((object) => object.name));
    const expectations = snapshot.objects
      .filter((object) => object.tags.includes(`compose:${plan.planId}`) || names.has(object.name))
      .map(objectExpectation);
    return summarize(verifyObjects(snapshot, expectations, nodes));
  }

  /** Renderer-only check for the camera layer of a reply. */
  public verifyRendererOnly(expectations: readonly SpatialObjectExpectation[]): SpatialVerificationSummary {
    const nodes = getLiveSceneProvider()?.listNodes() ?? null;
    return summarize(verifyRenderer(expectations, nodes));
  }

  // ---- planning templates ----

  private planForText(
    text: string,
    anchor: SpatialCompositionPlan["anchor"],
  ): { ok: true; plan: Omit<SpatialCompositionPlan, "planId" | "expectedRevision" | "createdAt" | "summary"> } | { ok: false; refusal: SpatialRefusal } {
    const lower = text.toLowerCase();
    const base = anchor?.position ?? { x: 0, y: 0, z: 3.4 };
    const empty = { request: text, anchor, links: [], updates: [] };

    if (/planetary system|solar system|star and .*planets?|orbiting planets?/.test(lower)) {
      const count = parseCount(lower, 5);
      const objects: PlannedObject[] = [
        {
          key: "star",
          name: nameFromRequest(text, "Star"),
          kind: "sphere",
          position: offset(base, 0, 0, 0),
          scale: 0.85,
          color: COLOURS.star,
          role: "star",
        },
      ];
      for (let index = 0; index < count; index += 1) {
        const angle = (index / Math.max(1, count)) * Math.PI * 2;
        const radius = 3.2 + (index % 2) * 0.6;
        objects.push({
          key: `planet-${index + 1}`,
          name: `${nameFromRequest(text, "Planet")} ${index + 1}`.replace(/^Planet/, "Planet"),
          kind: "sphere",
          position: offset(base, Math.cos(angle) * radius, (index % 3) * 0.35 - 0.35, Math.sin(angle) * radius),
          scale: 0.34 + (index % 3) * 0.08,
          color: PLANET_COLOURS[index % PLANET_COLOURS.length],
          role: "planet",
        });
      }
      return {
        ok: true,
        plan: {
          ...empty,
          objects,
          links: objects.slice(1).map((object) => ({ from: "star", to: object.key, kind: "orbits" as const })),
        },
      };
    }

    if (/observatory|orbital/.test(lower)) {
      return {
        ok: true,
        plan: {
          ...empty,
          objects: [
            {
              key: "ring",
              name: `${nameFromRequest(text, "Observatory")} Ring`,
              kind: "torus",
              position: offset(base, 0, 0.9, 0),
              scale: 1.1,
              color: COLOURS.observatory,
              role: "structure",
            },
            {
              key: "sensor",
              name: `${nameFromRequest(text, "Observatory")} Sensor`,
              kind: "cylinder",
              position: offset(base, 0, 0.9, 0),
              scale: 0.32,
              color: COLOURS.dish,
              role: "instrument",
            },
            {
              key: "relay",
              name: `${nameFromRequest(text, "Observatory")} Relay`,
              kind: "sphere",
              position: offset(base, 1.6, 0, 0),
              scale: 0.28,
              color: COLOURS.star,
              role: "relay",
            },
          ],
          links: [
            { from: "ring", to: "sensor", kind: "contains" },
            { from: "ring", to: "relay", kind: "connected" },
          ],
        },
      };
    }

    if (/research station|station beside|station around/.test(lower)) {
      return {
        ok: true,
        plan: {
          ...empty,
          objects: [
            {
              key: "station",
              name: nameFromRequest(text, "Research Station"),
              kind: "box",
              position: offset(base, 1.8, 0.2, 0),
              scale: 0.7,
              color: COLOURS.station,
              role: "station",
            },
            {
              key: "mast",
              name: `${nameFromRequest(text, "Research Station")} Mast`,
              kind: "cylinder",
              position: offset(base, 1.8, 1.2, 0),
              scale: 0.42,
              color: COLOURS.mast,
              role: "mast",
            },
            {
              key: "dish",
              name: `${nameFromRequest(text, "Research Station")} Dish`,
              kind: "torus",
              position: offset(base, 1.8, 1.9, 0),
              scale: 0.4,
              color: COLOURS.dish,
              role: "dish",
            },
          ],
          links: [
            { from: "station", to: "mast", kind: "contains" },
            { from: "mast", to: "dish", kind: "connected" },
          ],
        },
      };
    }

    if (/laborator|lab\b|research zones?/.test(lower)) {
      const zones = Math.max(2, Math.min(5, parseCount(lower, 3)));
      const objects: PlannedObject[] = [];
      for (let index = 0; index < zones; index += 1) {
        const angle = (index / zones) * Math.PI * 2;
        objects.push({
          key: `zone-${index + 1}`,
          name: `${nameFromRequest(text, "Laboratory")} Zone ${index + 1}`,
          kind: "box",
          position: offset(base, Math.cos(angle) * 3, 0, Math.sin(angle) * 3),
          scale: 0.62,
          color: index % 2 === 0 ? COLOURS.lab : COLOURS.research,
          role: "zone",
        });
      }
      const hub: PlannedObject = {
        key: "hub",
        name: `${nameFromRequest(text, "Laboratory")} Hub`,
        kind: "cylinder",
        position: offset(base, 0, 0.2, 0),
        scale: 0.45,
        color: COLOURS.mast,
        role: "hub",
      };
      objects.push(hub);
      return {
        ok: true,
        plan: {
          ...empty,
          objects,
          links: objects
            .filter((object) => object.key !== "hub")
            .map((object) => ({ from: "hub", to: object.key, kind: "connected" as const })),
        },
      };
    }

    const structures = /(\d+|two|three|four|five|six)\s+(?:interconnected\s+)?structures?/.exec(lower);
    if (structures || /interconnected structures?/.test(lower)) {
      const count = parseCount(lower, 3);
      const objects: PlannedObject[] = [];
      for (let index = 0; index < count; index += 1) {
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        objects.push({
          key: `structure-${index + 1}`,
          name: `${nameFromRequest(text, "Structure")} ${index + 1}`,
          kind: "box",
          position: offset(base, Math.cos(angle) * 2.6, 0, Math.sin(angle) * 2.6),
          scale: 0.55,
          color: index % 2 === 0 ? COLOURS.station : COLOURS.research,
          role: "structure",
        });
      }
      const links: PlannedLink[] = [];
      for (let index = 0; index < objects.length; index += 1) {
        links.push({
          from: objects[index].key,
          to: objects[(index + 1) % objects.length].key,
          kind: "connected",
        });
      }
      return { ok: true, plan: { ...empty, objects, links } };
    }

    if (/symmetr|formation|arrange/.test(lower)) {
      const authored = this.adapter.list().filter((entity) => entity.source === "authored" && entity.position);
      if (authored.length < 2) {
        return this.fail(
          "validation-failed",
          "there are fewer than two objects to arrange — create something first",
        );
      }
      const center = { x: 0, y: 0, z: 3.4 };
      const radius = 2.4 + authored.length * 0.25;
      const updates = authored.slice(0, 8).map((entity, index) => {
        const angle = (index / Math.min(8, authored.length)) * Math.PI * 2;
        return {
          id: entity.id,
          position: offset(center, Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
        };
      });
      return { ok: true, plan: { ...empty, objects: [], links: [], updates } };
    }

    return this.fail(
      "validation-failed",
      "I can build a research station, an observatory, a laboratory, a planetary system, a run of connected structures, or a symmetrical formation",
    );
  }

  private describe(plan: Omit<SpatialCompositionPlan, "planId" | "expectedRevision" | "createdAt" | "summary">): string {
    const anchor = plan.anchor ? ` beside "${plan.anchor.name}"` : "";
    if (plan.updates.length > 0) {
      return `Arrange ${plan.updates.length} objects into a symmetrical formation${anchor}`;
    }
    const kinds = plan.objects.reduce<Record<string, number>>((acc, object) => {
      acc[object.role] = (acc[object.role] ?? 0) + 1;
      return acc;
    }, {});
    const detail = Object.entries(kinds)
      .map(([role, count]) => `${count} ${role}${count === 1 ? "" : "s"}`)
      .join(", ");
    return `Build ${plan.objects.length} objects${anchor} — ${detail}${plan.links.length ? `, ${plan.links.length} links` : ""}`;
  }

  private refusalText(refusal: SpatialRefusal): string {
    switch (refusal.code) {
      case "approval-required":
      case "approval-invalid":
        return `I prepared the scene but did not commit it. ${refusal.detail}. Say "…, I approve" and I'll commit it exactly once.`;
      case "tier-insufficient":
        return `I did not change the scene. That needs Tier ${refusal.requiredTier}, which this session has not been granted.`;
      case "stale-revision":
        return `Nothing was applied: ${refusal.detail}. Revision is ${refusal.actualRevision ?? this.graph.getRevision()}.`;
      default:
        return `I did not change the scene: ${refusal.detail}. Revision is still ${this.graph.getRevision()}.`;
    }
  }

  private prunePlans(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [id, plan] of this.plans) {
      if (plan.createdAt < cutoff) this.plans.delete(id);
    }
  }

  private fail(code: SpatialRefusal["code"], detail: string): PlanResult {
    return { ok: false, refusal: { code, detail } };
  }

  /** Test seam. */
  public resetForTests(): void {
    this.plans.clear();
    this.sequence = 0;
  }
}
