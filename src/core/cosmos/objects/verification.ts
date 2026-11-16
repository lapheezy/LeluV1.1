/**
 * ==========================================================
 * LÉLU — OBJECT OPERATION VERIFICATION
 *
 * "The tool returned ok" is a claim about the tool. This is the check about
 * the world: did the object the person meant end up in the state they asked
 * for, and is that state persisted?
 *
 * The checks are per operation, because operations differ: a rotation must
 * change the rotation and leave the position alone; a rescale must not
 * smuggle in a translation; a selection must change nothing at all.
 *
 * Evidence is kept apart on purpose:
 *   STORE      — the authoritative state in CosmosObjectStore
 *   PERSISTED  — that state written through the store's own storage
 *   GEOMETRY   — what the renderer draws (browser probe; never inferred here)
 * A STORE pass is not a rendering pass, and this module never says otherwise.
 * ==========================================================
 */

import KvStore from "../../storage/KvStore";
import { COSMOS_OBJECTS_KEY } from "./CosmosObjectStore";
import type { CosmosObject, Vec3 } from "./CosmosObjectTypes";

export type VerificationStatus = "VERIFIED" | "PARTIAL" | "FAILED";

export interface ObjectSnapshot {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: number;
  updatedAt: number;
  provenance: number;
  visible: boolean;
  locked: boolean;
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail?: unknown;
  /** The operation's own outcome. Failing one of these is FAILED, not PARTIAL. */
  critical?: boolean;
}

export interface VerificationResult {
  status: VerificationStatus;
  action: string;
  objectId: string;
  checks: VerificationCheck[];
  evidence: "STORE";
  persisted: boolean;
  note?: string;
}

export interface OperationExpectation {
  action: string;
  objectId: string;
  /** Absolute values the operation should produce, when they are knowable. */
  expect?: { position?: Vec3; rotation?: Vec3; scale?: number };
  /** Values the operation must leave untouched. */
  preserve?: Array<"position" | "rotation" | "scale">;
  /** Does this action change the object at all? */
  mutates?: boolean;
  tolerance?: number;
}

export const snapshotOf = (object: CosmosObject): ObjectSnapshot => ({
  id: object.id,
  position: [...object.frame.position] as Vec3,
  rotation: [...object.frame.rotation] as Vec3,
  scale: object.frame.scale,
  updatedAt: object.updatedAt,
  provenance: object.provenance.length,
  visible: object.visible,
  locked: object.locked,
});

/** Did this object survive a reload? Reads the same storage the store writes. */
export function persistedObject(id: string): { updatedAt: number } | null {
  try {
    const saved = KvStore.getInstance().get<{ objects?: Array<{ id: string; updatedAt: number }> }>(COSMOS_OBJECTS_KEY);
    const found = saved?.objects?.find((object) => object.id === id);
    return found ? { updatedAt: found.updatedAt } : null;
  } catch {
    return null;
  }
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
const sameVec = (a: Vec3, b: Vec3, tolerance: number) => a.every((value, index) => near(value, b[index], tolerance));

const MUTATING = new Set([
  "spawn",
  "position",
  "transform",
  "animate",
  "split",
  "duplicate",
  "integrate",
  "extract",
  "isolate",
  "relocate",
  "reset",
  "group",
  "ungroup",
  "remove",
  "restore",
  "place",
  "undo",
  "redo",
  "lock",
  "rename",
]);

export function verifyObjectOperation(
  expectation: OperationExpectation,
  before: ObjectSnapshot | null,
  after: ObjectSnapshot | null,
  persisted: boolean,
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const tolerance = expectation.tolerance ?? 0.005;
  const mutates = expectation.mutates ?? MUTATING.has(expectation.action);

  checks.push({
    name: "targets the intended object",
    ok: Boolean(after) && after!.id === expectation.objectId,
    detail: { expected: expectation.objectId, actual: after?.id ?? null },
    critical: true,
  });

  const changed = Boolean(before && after) && (before!.updatedAt !== after!.updatedAt || before!.provenance !== after!.provenance);
  checks.push({
    name: mutates ? "the store recorded the change" : "the object was left untouched",
    ok: mutates ? changed : !changed,
    detail: { before: before ? { at: before.updatedAt, n: before.provenance } : null, after: after ? { at: after.updatedAt, n: after.provenance } : null },
    critical: true,
  });

  if (expectation.expect?.position && after) {
    checks.push({
      name: "position is what was asked for",
      ok: sameVec(after.position, expectation.expect.position, Math.max(tolerance, 0.02)),
      detail: { expected: expectation.expect.position, actual: after.position },
      critical: true,
    });
  }
  if (expectation.expect?.rotation && after) {
    checks.push({
      name: "rotation is what was asked for",
      ok: sameVec(after.rotation, expectation.expect.rotation, 0.5),
      detail: { expected: expectation.expect.rotation, actual: after.rotation },
      critical: true,
    });
  }
  if (typeof expectation.expect?.scale === "number" && after) {
    checks.push({
      name: "scale is what was asked for",
      ok: near(after.scale, expectation.expect.scale, 0.01),
      detail: { expected: expectation.expect.scale, actual: after.scale },
      critical: true,
    });
  }

  for (const field of expectation.preserve ?? []) {
    if (!before || !after) continue;
    const ok = field === "scale" ? near(after.scale, before.scale, 0.01) : sameVec(after[field], before[field], Math.max(tolerance, 0.005));
    checks.push({ name: `${field} was left alone`, ok, detail: { before: before[field], after: after[field] } });
  }

  checks.push({ name: "persisted", ok: persisted, detail: { persisted } });

  const failed = checks.filter((check) => !check.ok);
  const criticalFailure = failed.some((check) => check.critical);
  const status: VerificationStatus = failed.length === 0 ? "VERIFIED" : criticalFailure ? "FAILED" : "PARTIAL";

  return {
    status,
    action: expectation.action,
    objectId: expectation.objectId,
    checks,
    evidence: "STORE",
    persisted,
    ...(status === "VERIFIED" ? {} : { note: failed.map((check) => check.name).join("; ") }),
  };
}
