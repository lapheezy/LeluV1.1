/**
 * Turn raw observations into verdicts, using the same module the unit tests
 * cover. Run: npx tsx artifacts/perf/m17-wp06-p02/verify.ts
 *
 * Input  raw.json — what the browser recorded, per viewport, per object:
 *        projected box (viewport CSS px), identity-mask bounds (buffer px,
 *        converted here by the recorded dpr), the visibility flags and the
 *        pointer-selection result.
 * Output measurements.json — the acceptance record, with the declared
 *        thresholds echoed so the report cannot drift from the code.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  VERIFICATION_THRESHOLDS,
  classify,
  summarise,
  type PixelRect,
  type ProjectionObservation,
} from "../../../src/core/cosmos/objects/ProjectionVerification";

type RawRect = [number, number, number, number];

interface RawObject {
  id: string;
  name: string;
  bounds: RawRect;
  centre: [number, number];
  onScreen: boolean;
  inFrustum: boolean;
  failure: string | null;
  mask: { buffer: [number, number]; dpr: number; area: number; bbox: RawRect | null; centroid: [number, number] | null; components: number } | null;
  selection?: string[] | null;
}

interface RawViewport {
  size: [number, number];
  viewport: { width: number; height: number; dpr: number };
  camera: Record<string, unknown>;
  settled: boolean;
  objects: RawObject[];
  frame?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const raw: RawViewport[] = JSON.parse(readFileSync(join(here, "raw.json"), "utf8"));

const rect = (values: RawRect | null, scale: number): PixelRect | null =>
  values ? { left: values[0] / scale, top: values[1] / scale, right: values[2] / scale, bottom: values[3] / scale } : null;

const record = raw.map((viewport) => {
  const observations = viewport.objects.map((object) => {
    const dpr = object.mask?.dpr ?? viewport.viewport.dpr ?? 1;
    const observation: ProjectionObservation = {
      id: object.id,
      projected: rect(object.bounds, 1),
      observed: rect(object.mask?.bbox ?? null, dpr),
      observedArea: (object.mask?.area ?? 0) / (dpr * dpr),
      projectedCentre: object.centre,
      observedCentre: rect(object.mask?.bbox ?? null, dpr)
        ? [
            (rect(object.mask!.bbox, dpr)!.left + rect(object.mask!.bbox, dpr)!.right) / 2,
            (rect(object.mask!.bbox, dpr)!.top + rect(object.mask!.bbox, dpr)!.bottom) / 2,
          ]
        : null,
      raycastOwner: object.selection && object.selection.length === 1 ? object.selection[0] : null,
      projectedOnScreen: object.onScreen,
      projectedInFrustum: object.inFrustum,
      projectionFailure: object.failure,
      viewport: { width: viewport.viewport.width, height: viewport.viewport.height },
    };
    const agreement = classify(observation);
    const maskArea = object.mask?.area ?? 0;
    const boxArea = (object.bounds[2] - object.bounds[0]) * (object.bounds[3] - object.bounds[1]);
    return {
      id: object.id,
      name: object.name,
      projected: object.bounds,
      projectedCentre: object.centre,
      observedMask: object.mask?.bbox ?? null,
      observedAreaPx: maskArea,
      maskComponents: object.mask?.components ?? 0,
      fillRatio: boxArea > 0 ? maskArea / boxArea : null,
      pointerSelection: object.selection ?? null,
      agreement,
    };
  });
  return {
    size: viewport.size,
    settled: viewport.settled,
    viewport: viewport.viewport,
    camera: viewport.camera,
    frame: viewport.frame ?? null,
    objects: observations,
    summary: summarise(observations.map((o) => ({ id: o.id, agreement: o.agreement }))),
  };
});

const output = {
  mission: "M17-COE-WP06-P02",
  method:
    "identity mask read from the renderer's own frame buffer: the object is hidden for one direct render and the two buffers are diffed in the same task, so the mask is exactly the pixels the object covered. Independent of material colour and lighting; yaw-rotated silhouettes come out as silhouettes. Pointer selection at the projected centre is the second, independent identity oracle.",
  thresholds: VERIFICATION_THRESHOLDS,
  viewports: record,
};
writeFileSync(join(here, "measurements.json"), JSON.stringify(output, null, 2));
for (const viewport of record) {
  const line = viewport.objects.map((o) => `${o.id}=${o.agreement.verdict}`).join(" ");
  console.log(`${viewport.size[0]}x${viewport.size[1]}  ${line}  passed=${viewport.summary.passed}`);
}
