/**
 * Does the projected box describe the object that was actually drawn?
 *
 * `CosmosProjection` answers "where does this object's box land in the
 * viewport". This module answers a different question — "is that where the
 * renderer put it" — from evidence the projection did not produce:
 *
 *   - an identity mask: the pixels that changed when that one canonical object
 *     was hidden for a frame. The renderer is the authority on which pixels
 *     belong to an object, so this needs no colour rule, no material
 *     assumption and no lighting assumption, and it handles a yaw-rotated
 *     silhouette because it IS the silhouette;
 *   - a raycast at the projected centre, which reports the canonical id the
 *     camera's own geometry puts under that point.
 *
 * Nothing here recomputes a projection. It compares a claim against
 * observations, so a broken projection is detected rather than reproduced.
 *
 * Thresholds are declared once, before any measurement, and are not adjusted
 * per object.
 */

export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ProjectionObservation {
  /** canonical object id */
  id: string;
  /** box from the projection under test, in the space named by `space` */
  projected: PixelRect | null;
  /** identity mask bounds, already converted into the same space */
  observed: PixelRect | null;
  /** mask pixel count, in the same space */
  observedArea: number;
  projectedCentre: [number, number] | null;
  observedCentre: [number, number] | null;
  /** canonical id the raycaster reports at `projectedCentre`, if any */
  raycastOwner: string | null;
  projectedOnScreen: boolean;
  projectedInFrustum: boolean;
  projectionFailure: string | null;
  /** the viewport the box was measured in, for clipping checks */
  viewport: { width: number; height: number };
  /** the mask's own bounds, before conversion — used to detect a truncated capture */
  observedInScreenshot?: PixelRect | null;
}

export const VERIFICATION_THRESHOLDS = {
  /** share of the observed silhouette that must fall inside the box */
  coverageMatch: 0.98,
  coveragePartial: 0.85,
  /** centre displacement, same units as the rects (CSS px of the viewport) */
  centreMatch: 12,
  centrePartial: 30,
  /** mask area over box area, below which the capture is considered clipped */
  clippedFill: 0.35,
  /** a mask smaller than this is not evidence of anything */
  minMaskArea: 40,
} as const;

export type AgreementVerdict =
  | "match"
  | "partial"
  | "outside"
  | "clipped"
  | "not-rendered"
  | "missing"
  | "projection-failure"
  | "uncertain";

export interface Agreement {
  verdict: AgreementVerdict;
  reason: string;
  /** share of the observed mask inside the projected box, 0..1 */
  coverage: number | null;
  /** share of the projected box covered by the mask, 0..1 */
  fill: number | null;
  /** centre displacement in the rects' units, for the record */
  centreDelta: number | null;
  /**
   * Alignment of the visible silhouette with its box, in the rects' units.
   *
   * The area centroid and the full centre are both biased by occlusion and by
   * yaw: a chair whose legs are behind the planet loses its lower third, and a
   * chair turned 45° is narrower than its box. The silhouette's horizontal
   * centre and its top edge survive both, and a projection that is actually
   * wrong moves them.
   */
  deltaX: number | null;
  deltaTop: number | null;
  raycastAgrees: boolean;
}

export function rectArea(rect: PixelRect | null): number {
  if (!rect) return 0;
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

export function rectCentre(rect: PixelRect | null): [number, number] | null {
  if (!rect) return null;
  return [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2];
}

export function intersectionArea(a: PixelRect | null, b: PixelRect | null): number {
  if (!a || !b) return 0;
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

export function iou(a: PixelRect | null, b: PixelRect | null): number {
  const inter = intersectionArea(a, b);
  const union = rectArea(a) + rectArea(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function centreDistance(a: [number, number] | null, b: [number, number] | null): number | null {
  if (!a || !b) return null;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** True when any part of the box lies outside the viewport. */
export function exceedsViewport(rect: PixelRect | null, viewport: { width: number; height: number }): boolean {
  if (!rect) return false;
  return rect.left < 0 || rect.top < 0 || rect.right > viewport.width || rect.bottom > viewport.height;
}

/**
 * Classify one object. Every branch is decided from the declared thresholds;
 * an absent observation is "missing" (a failure), never a pass.
 */
export function classify(observation: ProjectionObservation): Agreement {
  const box = observation.projected;
  const mask = observation.observed;
  const raycastAgrees = observation.raycastOwner === observation.id;

  if (observation.projectionFailure) {
    return {
      verdict: "projection-failure",
      reason: observation.projectionFailure,
      coverage: null,
      fill: null,
      centreDelta: null,
      deltaX: null,
      deltaTop: null,
      raycastAgrees,
    };
  }
  if (!box) {
    return {
      verdict: "projection-failure",
      reason: "the projection produced no box at all",
      coverage: null,
      fill: null,
      centreDelta: null,
      deltaX: null,
      deltaTop: null,
      raycastAgrees,
    };
  }

  const boxArea = rectArea(box);
  const maskArea = Math.max(0, observation.observedArea);
  const inter = intersectionArea(box, mask);
  const coverage = maskArea > 0 ? inter / maskArea : null;
  const fill = boxArea > 0 ? inter / boxArea : null;
  const centreDelta = centreDistance(observation.projectedCentre, observation.observedCentre);

  /* Nothing changed when the object was hidden: nothing was drawn, or it was
     drawn entirely outside the viewport or behind another surface. */
  if (maskArea < VERIFICATION_THRESHOLDS.minMaskArea || !mask) {
    if (!observation.projectedOnScreen || !observation.projectedInFrustum) {
      return {
        verdict: "not-rendered",
        reason: "no mask, and the projection already reported the object off-screen",
        coverage,
        fill,
        centreDelta,
        deltaX: null,
        deltaTop: null,
        raycastAgrees,
      };
    }
    return {
      verdict: "missing",
      reason: "the projection claims an on-screen object, but hiding it changed nothing",
      coverage,
      fill,
      centreDelta,
      deltaX: null,
      deltaTop: null,
      raycastAgrees,
    };
  }

  /* The object was drawn, but the box does not contain it. */
  if ((coverage ?? 0) < VERIFICATION_THRESHOLDS.coveragePartial) {
    return {
      verdict: "outside",
      reason: `only ${((coverage ?? 0) * 100).toFixed(1)}% of the drawn silhouette falls inside the projected box`,
      coverage,
      fill,
      centreDelta,
      deltaX: null,
      deltaTop: null,
      raycastAgrees,
    };
  }

  /* Part of the box lies outside the viewport and the mask is much smaller
     than the box: the capture cannot judge the missing part. */
  if ((fill ?? 1) < VERIFICATION_THRESHOLDS.clippedFill && exceedsViewport(box, observation.viewport)) {
    return {
      verdict: "clipped",
      reason: "the box extends beyond the viewport; the capture only shows the visible part",
      coverage,
      fill,
      centreDelta,
      deltaX: null,
      deltaTop: null,
      raycastAgrees,
    };
  }

  const coverageValue = coverage ?? 0;
  const observed = observation.observed as PixelRect;
  const deltaX = Math.abs((observed.left + observed.right) / 2 - (box.left + box.right) / 2);
  const deltaTop = Math.abs(observed.top - box.top);
  const matched = Math.max(deltaX, deltaTop) <= VERIFICATION_THRESHOLDS.centreMatch;
  const near = Math.max(deltaX, deltaTop) <= VERIFICATION_THRESHOLDS.centrePartial;
  const occluded = (fill ?? 1) < 0.9;
  const occlusionNote = occluded
    ? `; the visible silhouette fills ${(((fill ?? 0) * 100) | 0)}% of the box, so part of the object is behind scene geometry`
    : "";

  if (coverageValue >= VERIFICATION_THRESHOLDS.coverageMatch && matched) {
    return {
      verdict: "match",
      reason: `the drawn silhouette lies inside the box and its edges align (Δx ${deltaX.toFixed(1)} px, Δtop ${deltaTop.toFixed(1)} px)${occlusionNote}`,
      coverage,
      fill,
      centreDelta,
      deltaX,
      deltaTop,
      raycastAgrees,
    };
  }
  if (coverageValue >= VERIFICATION_THRESHOLDS.coveragePartial && near) {
    return {
      verdict: "partial",
      reason: `the box contains the silhouette, but its edges are off (Δx ${deltaX.toFixed(1)} px, Δtop ${deltaTop.toFixed(1)} px)${occlusionNote}`,
      coverage,
      fill,
      centreDelta,
      deltaX,
      deltaTop,
      raycastAgrees,
    };
  }
  return {
    verdict: "uncertain",
    reason: `mixed evidence: coverage ${((coverage ?? 0) * 100).toFixed(0)}%, Δx ${deltaX.toFixed(1)} px, Δtop ${deltaTop.toFixed(1)} px`,
    coverage,
    fill,
    centreDelta,
    deltaX,
    deltaTop,
    raycastAgrees,
  };
}

/** Summarise a viewport's observations for the acceptance record. */
export function summarise(observations: Array<{ id: string; agreement: Agreement }>) {
  const counts: Record<string, number> = {};
  for (const { agreement } of observations) counts[agreement.verdict] = (counts[agreement.verdict] ?? 0) + 1;
  const failures = observations.filter(({ agreement }) => agreement.verdict === "missing" || agreement.verdict === "outside" || agreement.verdict === "projection-failure");
  return {
    total: observations.length,
    counts,
    passed: failures.length === 0,
    failures: failures.map(({ id, agreement }) => ({ id, verdict: agreement.verdict, reason: agreement.reason })),
  };
}
