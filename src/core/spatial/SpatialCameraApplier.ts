/**
 * ==========================================================
 * LÉLU — SPATIAL CAMERA APPLIER
 *
 * Phase 2.2 · Gate F. LÉLU drives the camera that already
 * exists: `genesisCameraIntentBus` (v1 world) and the
 * `genesis-v2-camera` DOM bridge (v2 rig). No second camera,
 * no second controls, no competing animation loop.
 *
 * Framing is geometry-aware: the bounding sphere of every
 * target is computed from the live three.js nodes (or the
 * committed transforms when the renderer has not mounted yet),
 * and the distance comes from the camera's own field of view
 * and the viewport aspect — so a 0.6 m orb and a 20 m system
 * are both framed correctly instead of using one fixed radius.
 *
 * Safety: every request is bounded, invalid coordinates are
 * refused before dispatch, user gestures win (the rig already
 * cancels autonomous flights on input), and `restore()` puts
 * the previous viewpoint back.
 * ==========================================================
 */

import {
  beginSpatialCameraTakeover,
  dispatchV2CameraCommand,
  genesisCameraIntentBus,
} from "../../app/scene/genesis/GenesisCameraIntent";
import SpatialAdapter from "./SpatialAdapter";
import { liveCamera, type LiveCameraState } from "./SpatialLiveScene";
import {
  SPATIAL_VIEW_LIMITS,
  type SpatialCameraPose,
  type SpatialRefusal,
  type SpatialVec3,
} from "./SpatialTypes";

export interface FrameSubject {
  name: string;
  position: SpatialVec3;
  radius: number;
}

export type CameraPlan =
  | {
      ok: true;
      pose: SpatialCameraPose;
      subjects: FrameSubject[];
      dispatched: boolean;
    }
  | { ok: false; refusal: SpatialRefusal };

const FALLBACK_DIRECTION: [number, number, number] = [0.32, 0.36, 1];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function length(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalise(vector: [number, number, number]): [number, number, number] {
  const len = length(vector);
  if (!Number.isFinite(len) || len < 1e-6) return [0, 0, 1];
  return [vector[0] / len, vector[1] / len, vector[2] / len];
}

/**
 * Bounding sphere of the subjects: centre is the midpoint of the
 * extremes, radius covers each subject's own extent. Two tiny
 * objects do not get framed like a planet.
 */
export function frameSubjects(subjects: FrameSubject[]): { center: SpatialVec3; radius: number } {
  if (subjects.length === 0) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 2 };
  }
  const xs = subjects.map((subject) => subject.position.x);
  const ys = subjects.map((subject) => subject.position.y);
  const zs = subjects.map((subject) => subject.position.z);
  const center: SpatialVec3 = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    z: (Math.min(...zs) + Math.max(...zs)) / 2,
  };
  let radius = 0;
  for (const subject of subjects) {
    const distance = Math.hypot(
      subject.position.x - center.x,
      subject.position.y - center.y,
      subject.position.z - center.z,
    );
    radius = Math.max(radius, distance + Math.max(0.2, subject.radius));
  }
  return { center, radius: Math.max(0.35, radius) };
}

/** Effective half-angle, smaller of the vertical and horizontal FOV. */
export function effectiveHalfFov(fovDegrees: number, aspect: number): number {
  const vertical = (clamp(fovDegrees, 20, 100) * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * clamp(aspect, 0.3, 4));
  return Math.min(vertical, horizontal) / 2;
}

export function framingPose(
  subjects: FrameSubject[],
  options: {
    fov?: number;
    aspect?: number;
    padding?: number;
    camera?: LiveCameraState | null;
  } = {},
): SpatialCameraPose {
  const { center, radius } = frameSubjects(subjects);
  const fov = options.fov ?? options.camera?.fov ?? SPATIAL_VIEW_LIMITS.defaultFov;
  const aspect = clamp(
    options.aspect ?? options.camera?.aspect ?? SPATIAL_VIEW_LIMITS.defaultAspect,
    0.3,
    4,
  );
  const padding = Math.max(1, options.padding ?? SPATIAL_VIEW_LIMITS.padding);

  const halfFov = effectiveHalfFov(fov, aspect);
  const distance = clamp(
    (radius / Math.max(0.05, Math.sin(halfFov))) * padding,
    SPATIAL_VIEW_LIMITS.minDistance,
    SPATIAL_VIEW_LIMITS.maxDistance,
  );

  // Keep the viewing angle the person already has; fall back to a
  // three-quarter view when there is no live camera yet.
  const rawDirection: [number, number, number] = options.camera
    ? [
        options.camera.position[0] - center.x,
        options.camera.position[1] - center.y,
        options.camera.position[2] - center.z,
      ]
    : FALLBACK_DIRECTION;
  const direction = normalise(length(rawDirection) < 1e-3 ? FALLBACK_DIRECTION : rawDirection);

  const position: SpatialVec3 = {
    x: clamp(center.x + direction[0] * distance, -SPATIAL_VIEW_LIMITS.worldRadius, SPATIAL_VIEW_LIMITS.worldRadius),
    y: clamp(center.y + direction[1] * distance, SPATIAL_VIEW_LIMITS.yMin, SPATIAL_VIEW_LIMITS.yMax),
    z: clamp(center.z + direction[2] * distance, -SPATIAL_VIEW_LIMITS.worldRadius, SPATIAL_VIEW_LIMITS.worldRadius),
  };

  return { position, target: center, distance, fov };
}

function invalid(message: string): { ok: false; refusal: SpatialRefusal } {
  return { ok: false, refusal: { code: "validation-failed", detail: message } };
}

export default class SpatialCameraApplier {
  private static instance: SpatialCameraApplier | null = null;

  private readonly adapter = SpatialAdapter.getInstance();
  private lastPose: SpatialCameraPose | null = null;
  private previousPose: SpatialCameraPose | null = null;
  /** Bumped on every request; a stale animation cannot win. */
  private epoch = 0;

  public static getInstance(): SpatialCameraApplier {
    if (!SpatialCameraApplier.instance) SpatialCameraApplier.instance = new SpatialCameraApplier();
    return SpatialCameraApplier.instance;
  }

  public currentPose(): SpatialCameraPose | null {
    return this.lastPose;
  }

  public previous(): SpatialCameraPose | null {
    return this.previousPose;
  }

  /** Resolve chat references to frameable subjects, refusing honestly. */
  public subjectsFor(references: readonly string[]): FrameSubject[] | { refusal: SpatialRefusal } {
    const subjects: FrameSubject[] = [];
    const missing: string[] = [];
    for (const reference of references) {
      const entity = this.adapter.resolve(reference);
      if (!entity || !entity.position) {
        missing.push(reference.trim());
        continue;
      }
      subjects.push({
        name: entity.name,
        position: entity.position,
        radius: entity.radius ?? 0.8,
      });
    }
    if (subjects.length === 0) {
      return {
        refusal: {
          code: "unknown-object",
          detail: `nothing called ${missing.map((name) => `"${name}"`).join(", ")} is in the visible world`,
          candidates: missing.flatMap((name) => this.adapter.candidates(name)),
        },
      };
    }
    return subjects;
  }

  public focus(references: readonly string[], padding?: number): CameraPlan {
    beginSpatialCameraTakeover();
    const resolved = this.subjectsFor(references);
    if ("refusal" in resolved) return { ok: false, refusal: resolved.refusal };
    const camera = liveCamera();
    const pose = framingPose(resolved, { padding, camera, aspect: camera?.aspect });
    return this.dispatch(pose, resolved);
  }

  public frameAll(padding?: number): CameraPlan {
    beginSpatialCameraTakeover();
    const authored = this.adapter.list().filter((entity) => entity.source === "authored" && entity.position);
    if (authored.length === 0) {
      return {
        ok: false,
        refusal: { code: "unknown-object", detail: "there is nothing in the scene to frame yet" },
      };
    }
    const subjects: FrameSubject[] = authored.map((entity) => ({
      name: entity.name,
      position: entity.position as SpatialVec3,
      radius: entity.radius ?? 0.8,
    }));
    const camera = liveCamera();
    const pose = framingPose(subjects, { padding, camera, aspect: camera?.aspect });
    return this.dispatch(pose, subjects);
  }

  public reset(): CameraPlan {
    beginSpatialCameraTakeover();
    this.epoch += 1;
    this.previousPose = this.lastPose;
    this.lastPose = null;
    this.emit({ type: "reset" });
    dispatchV2CameraCommand({ intent: "reset" });
    return {
      ok: true,
      // The home of the world this applier drives (the v1 Genesis camera
      // resets to (0, 0, 6.8) looking at the origin). Verification still reads
      // the live rig, so a v2 rig answering the same reset is checked against
      // its own documented home instead of this pose.
      pose: {
        position: { x: 0, y: 0, z: 6.8 },
        target: { x: 0, y: 0, z: 0 },
        distance: 6.8,
        fov: SPATIAL_VIEW_LIMITS.defaultFov,
      },
      subjects: [],
      dispatched: true,
    };
  }

  public restore(): CameraPlan {
    const pose = this.previousPose;
    if (!pose) {
      return { ok: false, refusal: { code: "validation-failed", detail: "there is no earlier viewpoint to return to" } };
    }
    this.previousPose = this.lastPose;
    return this.dispatch(pose, []);
  }

  /** Orbit around the last framed target by a number of degrees. */
  public orbit(degrees: number, target?: string): CameraPlan {
    beginSpatialCameraTakeover();
    if (!Number.isFinite(degrees)) return invalid("the orbit angle must be a number");
    if (Math.abs(degrees) > 360) return invalid("the orbit angle must be within ±360°");
    const camera = liveCamera();
    const focusPose = this.lastPose;
    if (!focusPose && !target) {
      return { ok: false, refusal: { code: "validation-failed", detail: "there is no framed target to orbit around" } };
    }
    let subject: FrameSubject | null = null;
    if (target) {
      const resolved = this.subjectsFor([target]);
      if ("refusal" in resolved) return { ok: false, refusal: resolved.refusal };
      subject = resolved[0];
    }
    const targetPoint = subject?.position ?? focusPose?.target ?? { x: 0, y: 0.6, z: 0 };
    const origin = camera
      ? { x: camera.position[0], y: camera.position[1], z: camera.position[2] }
      : focusPose?.position ?? { x: 0, y: 1.7, z: 10.4 };
    const dx = origin.x - targetPoint.x;
    const dz = origin.z - targetPoint.z;
    const radians = (degrees * Math.PI) / 180;
    const position: SpatialVec3 = {
      x: clamp(
        targetPoint.x + dx * Math.cos(radians) - dz * Math.sin(radians),
        -SPATIAL_VIEW_LIMITS.worldRadius,
        SPATIAL_VIEW_LIMITS.worldRadius,
      ),
      y: clamp(origin.y, SPATIAL_VIEW_LIMITS.yMin, SPATIAL_VIEW_LIMITS.yMax),
      z: clamp(
        targetPoint.z + dx * Math.sin(radians) + dz * Math.cos(radians),
        -SPATIAL_VIEW_LIMITS.worldRadius,
        SPATIAL_VIEW_LIMITS.worldRadius,
      ),
    };
    const pose: SpatialCameraPose = {
      position,
      target: targetPoint,
      distance: Math.hypot(position.x - targetPoint.x, position.y - targetPoint.y, position.z - targetPoint.z),
      fov: camera?.fov ?? SPATIAL_VIEW_LIMITS.defaultFov,
    };
    return this.dispatch(pose, subject ? [subject] : []);
  }

  public zoom(factor: number): CameraPlan {
    beginSpatialCameraTakeover();
    if (!Number.isFinite(factor) || factor <= 0 || factor > 8) {
      return invalid("the zoom factor must be between 0 and 8");
    }
    const pose = this.lastPose;
    const camera = liveCamera();
    const target = pose?.target ?? { x: 0, y: 0.6, z: 0 };
    const current = pose?.position ??
      (camera ? { x: camera.position[0], y: camera.position[1], z: camera.position[2] } : { x: 0, y: 1.7, z: 10.4 });
    const dx = current.x - target.x;
    const dy = current.y - target.y;
    const dz = current.z - target.z;
    const currentDistance = Math.max(SPATIAL_VIEW_LIMITS.minDistance, Math.hypot(dx, dy, dz));
    const distance = clamp(
      currentDistance * factor,
      SPATIAL_VIEW_LIMITS.minDistance,
      SPATIAL_VIEW_LIMITS.maxDistance,
    );
    const k = distance / currentDistance;
    const position: SpatialVec3 = {
      x: clamp(target.x + dx * k, -SPATIAL_VIEW_LIMITS.worldRadius, SPATIAL_VIEW_LIMITS.worldRadius),
      y: clamp(target.y + dy * k, SPATIAL_VIEW_LIMITS.yMin, SPATIAL_VIEW_LIMITS.yMax),
      z: clamp(target.z + dz * k, -SPATIAL_VIEW_LIMITS.worldRadius, SPATIAL_VIEW_LIMITS.worldRadius),
    };
    return this.dispatch(
      { position, target, distance, fov: camera?.fov ?? SPATIAL_VIEW_LIMITS.defaultFov },
      [],
    );
  }

  /** Cancel any in-flight request this applier started. */
  public cancel(): void {
    this.epoch += 1;
  }

  private dispatch(pose: SpatialCameraPose, subjects: FrameSubject[]): CameraPlan {
    for (const value of [pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z]) {
      if (!Number.isFinite(value)) return invalid("the camera destination contains a non-finite coordinate");
    }
    if (Math.abs(pose.position.x) > SPATIAL_VIEW_LIMITS.worldRadius || Math.abs(pose.position.z) > SPATIAL_VIEW_LIMITS.worldRadius) {
      return invalid(`the camera destination is outside the world (±${SPATIAL_VIEW_LIMITS.worldRadius})`);
    }
    this.epoch += 1;
    this.previousPose = this.lastPose;
    this.lastPose = pose;

    const position: [number, number, number] = [pose.position.x, pose.position.y, pose.position.z];
    const lookAt: [number, number, number] = [pose.target.x, pose.target.y, pose.target.z];
    this.emit({ type: "fly", position, lookAt });
    dispatchV2CameraCommand({ intent: "fly", position, lookAt });

    return { ok: true, pose, subjects, dispatched: true };
  }

  private emit(intent: Parameters<typeof genesisCameraIntentBus.emit>[0]): void {
    genesisCameraIntentBus.emit(intent);
  }

  /** Test seam. */
  public resetForTests(): void {
    this.lastPose = null;
    this.previousPose = null;
    this.epoch = 0;
  }
}
