/**
 * ==========================================================
 * LÉLU — CREATIVE OPERATION VERIFICATION
 *
 * "The tool returned ok" is a claim about the tool. This is the
 * check about the world: did the object the person meant end up
 * in the state they asked for, and is that state persisted?
 *
 * The checks are per operation, because the operations differ:
 * a rotation must change the rotation and leave the position
 * alone; a scale must not smuggle in a translation; a selection
 * must change nothing at all.
 *
 * Evidence classes are kept apart here on purpose:
 *   STORE      — the authoritative state in CreativeObjects
 *   PERSISTED  — that state written through the store's persistence
 *   GEOMETRY   — the meshes the renderer draws (browser probe, not this file)
 * A STORE pass is not a rendering pass, and this module never says otherwise.
 * ==========================================================
 */

export type Vec3 = [number, number, number];

export interface OperationSnapshot {
  id: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  revision: number;
  visible?: boolean;
  archived?: boolean;
}

export interface OperationExpectation {
  action: string;
  /** The object the instruction meant. */
  objectId: string;
  /** Absolute values the operation should produce, when they are knowable. */
  expect?: { position?: Vec3; rotation?: Vec3; scale?: Vec3 };
  /** Values the operation must leave untouched. */
  preserve?: Array<"position" | "rotation" | "scale">;
  /** Absolute tolerance: mm for position, degrees for rotation, factor for scale. */
  tolerance?: number;
  /** Does this action mutate the object at all? */
  mutates?: boolean;
}

export interface VerificationCheck {
  name: string;
  ok: boolean;
  detail?: unknown;
  /**
   * A critical check is the operation's own outcome: the right object, a real
   * change, the value that was asked for. Failing one of those is FAILED.
   * A non-critical check (an untouched field, persistence) failing is PARTIAL:
   * the thing happened, but not cleanly.
   */
  critical?: boolean;
}

export type VerificationStatus = "VERIFIED" | "PARTIAL" | "FAILED";

export interface VerificationResult {
  status: VerificationStatus;
  action: string;
  objectId: string;
  checks: VerificationCheck[];
  evidence: "STORE";
  persisted: boolean;
  note?: string;
}

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;
const sameVec = (a: Vec3, b: Vec3, tolerance: number) => a.every((value, index) => near(value, b[index], tolerance));

const MUTATING = new Set([
  "move",
  "rotate",
  "scale",
  "duplicate",
  "detach",
  "attach",
  "reuse",
  "set-material",
  "visibility",
  "archive",
  "unarchive",
  "float",
  "anchor",
  "pause",
]);

export function verifyCreativeOperation(
  expectation: OperationExpectation,
  before: OperationSnapshot | null,
  after: OperationSnapshot | null,
  persisted: boolean,
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const tolerance = expectation.tolerance ?? 0.5;
  const mutates = expectation.mutates ?? MUTATING.has(expectation.action);

  // 1. The object the instruction meant is the object that was touched.
  checks.push({
    name: "targets the intended object",
    ok: Boolean(after) && after!.id === expectation.objectId,
    detail: { expected: expectation.objectId, actual: after?.id ?? null },
    critical: true,
  });

  // 2. A mutation happened (or, for selection, provably did not).
  const changed = Boolean(before && after) && before!.revision !== after!.revision;
  checks.push({
    name: mutates ? "the store recorded the change" : "the object was left untouched",
    ok: mutates ? changed : !changed,
    detail: { before: before?.revision ?? null, after: after?.revision ?? null },
    critical: true,
  });

  if (expectation.expect?.position && after) {
    checks.push({
      name: "position is what was asked for",
      ok: sameVec(after.position, expectation.expect.position, tolerance),
      critical: true,
      detail: { expected: expectation.expect.position.map(Math.round), actual: after.position.map(Math.round) },
    });
  }
  if (expectation.expect?.rotation && after) {
    checks.push({
      name: "rotation is what was asked for",
      ok: sameVec(after.rotation, expectation.expect.rotation, Math.max(1, tolerance)),
      critical: true,
      detail: { expected: expectation.expect.rotation, actual: after.rotation },
    });
  }
  if (expectation.expect?.scale && after) {
    checks.push({
      name: "scale is what was asked for",
      ok: sameVec(after.scale, expectation.expect.scale, 0.01),
      critical: true,
      detail: { expected: expectation.expect.scale, actual: after.scale },
    });
  }

  for (const field of expectation.preserve ?? []) {
    if (!before || !after) continue;
    const ok =
      field === "scale" ? sameVec(after.scale, before.scale, 0.01) : sameVec(after[field], before[field], tolerance);
    checks.push({
      name: `${field} was left alone`,
      ok,
      detail: { before: before[field], after: after[field] },
    });
  }

  // 3. Persistence is its own condition, never implied by the store change.
  checks.push({ name: "persisted", ok: persisted, detail: { persisted } });

  const failed = checks.filter((check) => !check.ok);
  const criticalFailure = failed.some((check) => check.critical);
  const status: VerificationStatus =
    failed.length === 0 ? "VERIFIED" : criticalFailure ? "FAILED" : "PARTIAL";

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
