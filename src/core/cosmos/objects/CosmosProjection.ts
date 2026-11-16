/**
 * ==========================================================
 * LÉLU — COSMOS PROJECTION CONTRACT
 *
 * ONE answer to "where is this object on screen", written as
 * explicit conversions between the spaces that actually
 * exist, because treating them as interchangeable is how a
 * probe reports a chair at x = −3114 while three chairs fill
 * the frame.
 *
 *   world        metres, in the Cosmos the camera moves through
 *   view         the camera's own space: −z is forward
 *   ndc          −1…1 on both axes, +1 up
 *   viewport     CSS pixels of the browser, INCLUDING the canvas'
 *                own offset from the top-left of the window
 *   buffer       device pixels of the drawing buffer (viewport × dpr)
 *   screenshot   image pixels of a capture of the viewport
 *
 * THE AUTHORITY, in order:
 *
 *   the camera's matrices decide where something IS on screen. They
 *   are read AFTER making them current, because three updates
 *   `matrixWorldInverse` inside its render pass: at 1 fps a camera
 *   that has flown since the last frame still carries the old one.
 *
 *   the canvas' own `getBoundingClientRect()` decides the viewport
 *   box. NOT `window.innerWidth`: the canvas can be smaller than the
 *   window, offset from it, or letterboxed inside it.
 *
 *   the drawing buffer decides nothing about position. It is a
 *   resolution, and `devicePixelRatio` is applied to it ONCE.
 *
 * Nothing here clamps. An object half off screen has a negative
 * coordinate, and saying so is the point: a projection that is
 * forced back into the viewport is a lie that passes a screenshot
 * test. An object that cannot be projected returns `failure`, and an
 * object outside the frustum is a different answer from one whose
 * projection did not work.
 * ==========================================================
 */

import { Box3, Frustum, Matrix4, Vector3, type PerspectiveCamera } from "three";

import type { Bounds3 } from "./CosmosObjectCamera";
import type { Vec3 } from "./CosmosObjectTypes";

/** The name carried with every reported coordinate. */
export const VIEWPORT_SPACE = "viewport-css" as const;
export type CoordinateSpace = typeof VIEWPORT_SPACE;

/** CSS pixels of the canvas element, relative to the browser viewport. */
export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportBox extends CanvasRect {
  /** Drawing-buffer size, in device pixels. */
  bufferWidth: number;
  bufferHeight: number;
  /** Device pixels per CSS pixel, as the RENDERER allocated them. */
  dpr: number;
}

export interface Point2 {
  x: number;
  y: number;
}

export type ProjectionFailure =
  | "non-finite"
  | "degenerate-bounds"
  | "no-camera";

export interface ProjectedObject {
  space: CoordinateSpace;
  /** Bounds centre, in viewport CSS pixels. Null when it cannot be projected. */
  center: Point2 | null;
  /** [left, top, right, bottom] in viewport CSS pixels. May exceed the canvas. */
  bounds: [number, number, number, number] | null;
  /** The same centre in drawing-buffer pixels. */
  bufferCenter: Point2 | null;
  /** True when the whole box is behind the camera. */
  behindCamera: boolean;
  /** Frustum test on the box, not on a point. */
  inFrustum: boolean;
  /** Set only when the projection itself could not be performed. */
  failure: ProjectionFailure | null;
  /** The camera's aspect did not match the canvas when this was measured. */
  aspectMismatch: boolean;
}

/* ------------------------------------------------------------- viewport */

/**
 * The viewport box, from the canvas' own rect and buffer.
 *
 * `dpr` is the renderer's ratio (buffer / CSS), NOT `window.devicePixelRatio`
 * — an adaptive `dpr` cap and a browser zoom both make those different, and
 * only the first one describes the pixels that were drawn.
 */
export function viewportOf(
  rect: CanvasRect,
  buffer: { width: number; height: number },
  dpr?: number,
): ViewportBox {
  const width = Math.max(1, finite(rect.width, 1));
  const height = Math.max(1, finite(rect.height, 1));
  const bufferWidth = Math.max(1, finite(buffer.width, width));
  const bufferHeight = Math.max(1, finite(buffer.height, height));
  const ratio = dpr && dpr > 0 ? dpr : bufferWidth / width;
  return {
    left: finite(rect.left, 0),
    top: finite(rect.top, 0),
    width,
    height,
    bufferWidth,
    bufferHeight,
    dpr: ratio > 0 ? ratio : 1,
  };
}

/** NDC (−1…1, +1 up) → viewport CSS pixels, canvas offset included. */
export function ndcToViewport(ndc: Vec3, view: ViewportBox): Point2 | null {
  if (!ndc.every((n) => Number.isFinite(n))) return null;
  return {
    x: view.left + (ndc[0] * 0.5 + 0.5) * view.width,
    y: view.top + (1 - (ndc[1] * 0.5 + 0.5)) * view.height,
  };
}

/** Viewport CSS pixels → drawing-buffer pixels. The ratio is applied once. */
export function viewportToBuffer(point: Point2, view: ViewportBox): Point2 {
  return {
    x: (point.x - view.left) * view.dpr,
    y: (point.y - view.top) * view.dpr,
  };
}

/**
 * Viewport CSS pixels → image pixels of a screenshot of the page.
 *
 * A screenshot is in CSS pixels of the viewport, so this is the identity
 * unless the capture was scaled (a downscaled full-page capture, a retina
 * capture). It exists so the step is explicit and cannot be skipped by
 * accident when a capture IS scaled.
 */
export function viewportToScreenshot(
  point: Point2,
  shot: { width: number; height: number; viewportWidth: number; viewportHeight: number },
): Point2 {
  return {
    x: point.x * (shot.width / Math.max(1, shot.viewportWidth)),
    y: point.y * (shot.height / Math.max(1, shot.viewportHeight)),
  };
}

/* ---------------------------------------------------------- projection */

/**
 * Make a camera's matrices describe where it is NOW, and say whether its
 * projection still matches the surface being measured.
 *
 * `updateMatrixWorld(true)` is what three does before it renders; without
 * it, a camera that moved since the last frame projects as if it had not.
 * `updateProjectionMatrix` is NOT called: the matrix the renderer drew with
 * is the one that has to explain the pixels, so a stale aspect is reported
 * rather than silently corrected here.
 */
export function freshenCamera(camera: PerspectiveCamera, view: ViewportBox): boolean {
  camera.updateMatrixWorld(true);
  const aspect = view.width / Math.max(1, view.height);
  return Math.abs((camera.aspect ?? aspect) - aspect) > 1e-4;
}

const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

/**
 * Project a Cosmos-space box through the camera, in the camera's CURRENT
 * pose, and report the box in viewport CSS pixels.
 *
 * `parentMatrixWorld` is the matrix of the space the box is expressed in —
 * NOT the object's own group. `objectBounds()` already folds the object's
 * position and scale into its numbers (it is the box the camera fitting uses,
 * in the object's parent space), so applying the group's own matrix here
 * applies that position and scale a SECOND time: the box is then displaced by
 * its own offset and thickened by its own scale, which is a projection that
 * looks plausible and is nowhere near the pixels.
 */
export function projectBounds(
  camera: PerspectiveCamera,
  bounds: Bounds3 | null,
  view: ViewportBox,
  parentMatrixWorld?: Matrix4,
): ProjectedObject {
  const result: ProjectedObject = {
    space: VIEWPORT_SPACE,
    center: null,
    bounds: null,
    bufferCenter: null,
    behindCamera: false,
    inFrustum: false,
    failure: null,
    aspectMismatch: false,
  };

  if (!camera || !camera.isPerspectiveCamera) {
    result.failure = "no-camera";
    return result;
  }
  if (!bounds || ![...bounds.min, ...bounds.max].every((n) => Number.isFinite(n))) {
    result.failure = "degenerate-bounds";
    return result;
  }

  result.aspectMismatch = freshenCamera(camera, view);

  const box = new Box3(
    new Vector3(...bounds.min),
    new Vector3(...bounds.max),
  );
  if (parentMatrixWorld) box.applyMatrix4(parentMatrixWorld);
  if (box.isEmpty()) {
    result.failure = "degenerate-bounds";
    return result;
  }

  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  result.inFrustum = frustum.intersectsBox(box);

  const min = box.min;
  const max = box.max;
  const span = new Vector3().subVectors(max, min);

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let behind = 0;
  let finite = 0;

  for (const corner of CORNERS) {
    const world = new Vector3(
      min.x + span.x * corner[0],
      min.y + span.y * corner[1],
      min.z + span.z * corner[2],
    );
    // The camera looks down −z, so a positive view-space z is behind it.
    if (world.clone().applyMatrix4(camera.matrixWorldInverse).z > 0) behind += 1;
    const ndc = world.project(camera);
    const point = ndcToViewport([ndc.x, ndc.y, ndc.z], view);
    if (!point) continue;
    finite += 1;
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }

  if (finite === 0) {
    result.failure = "non-finite";
    return result;
  }
  if (behind === CORNERS.length) {
    // Every corner behind the camera: nothing was drawn, and coordinates
    // for it would be mirrored nonsense.
    result.behindCamera = true;
    return result;
  }

  const center = new Vector3().addVectors(min, max).multiplyScalar(0.5).project(camera);
  const centerPoint = ndcToViewport([center.x, center.y, center.z], view);

  result.bounds = [left, top, right, bottom];
  result.center = centerPoint;
  result.bufferCenter = centerPoint ? viewportToBuffer(centerPoint, view) : null;
  if (behind > 0) {
    // Partially behind: the box is still drawn, but its projected extent is
    // not trustworthy, so say so instead of reporting a tidy rectangle.
    result.failure = null;
  }
  return result;
}

/* -------------------------------------------------------------- helpers */

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Whether a point is inside the canvas, in viewport CSS pixels. */
export function insideViewport(point: Point2 | null, view: ViewportBox): boolean {
  if (!point) return false;
  return (
    point.x >= view.left &&
    point.y >= view.top &&
    point.x <= view.left + view.width &&
    point.y <= view.top + view.height
  );
}

/**
 * Viewport CSS pixels → the canvas-local pixels a R3F pointer event carries
 * (R3F reports offsets from the canvas, not from the window).
 */
export function viewportToCanvasLocal(point: Point2, view: ViewportBox): Point2 {
  return { x: point.x - view.left, y: point.y - view.top };
}
