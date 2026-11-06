/**
 * ==========================================================
 * LÉLU — SPATIAL VERIFICATION
 *
 * Phase 2.2 · Gate G. Establishes whether an operation actually
 * happened, and says which layer failed when it did not.
 *
 *   graph      — the committed snapshot matches the plan
 *   renderer   — the live three.js node exists, sits where the
 *                commit says (parent space), and carries the
 *                committed colour/visibility
 *   camera     — the live camera arrived where the applier sent
 *                it, and the target is inside its field of view
 *   screenshot — never fabricated here: reported as skipped,
 *                because the browser panel captures pixels, not
 *                this module
 *
 * A skipped layer is reported as skipped, never as a pass. When
 * the renderer layer fails, the intent bus rolls the commit back
 * and the reply says so.
 * ==========================================================
 */

import type { LiveCameraState, LiveSceneNode } from "./SpatialLiveScene";
import type {
  SpatialCameraPose,
  SpatialObject,
  SpatialSceneSnapshot,
  SpatialVec3,
  SpatialVerificationCheck,
  SpatialVerificationLayer,
  SpatialVerificationSummary,
} from "./SpatialTypes";

export interface SpatialObjectExpectation {
  id: string;
  name?: string;
  /** Committed local position — the value the R3F layer renders from. */
  localPosition?: SpatialVec3;
  color?: string;
  visible?: boolean;
}

const POSITION_TOLERANCE = 0.02;
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;

function distance(a: SpatialVec3, b: SpatialVec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function tuple(values: [number, number, number]): SpatialVec3 {
  return { x: values[0], y: values[1], z: values[2] };
}

function check(
  layer: SpatialVerificationLayer,
  name: string,
  status: SpatialVerificationCheck["status"],
  detail: string,
): SpatialVerificationCheck {
  return { layer, name, status, detail };
}

/** Layer 1 — the authoritative graph. */
export function verifyGraph(
  snapshot: SpatialSceneSnapshot,
  expectations: readonly SpatialObjectExpectation[],
): SpatialVerificationCheck[] {
  const checks: SpatialVerificationCheck[] = [];
  const byId = new Map(snapshot.objects.map((object) => [object.id, object]));

  for (const expectation of expectations) {
    const object = byId.get(expectation.id);
    if (!object) {
      checks.push(check("graph", `object ${expectation.id}`, "fail", "the committed scene does not contain it"));
      continue;
    }
    checks.push(check("graph", `object ${expectation.id}`, "pass", `present as "${object.name}"`));
    if (expectation.localPosition) {
      const delta = distance(object.transform.position, expectation.localPosition);
      checks.push(
        check(
          "graph",
          `position ${object.name}`,
          delta <= POSITION_TOLERANCE ? "pass" : "fail",
          `committed (${round(object.transform.position)}) vs planned (${round(expectation.localPosition)})`,
        ),
      );
    }
    if (expectation.color) {
      checks.push(
        check(
          "graph",
          `material ${object.name}`,
          object.material.color.toLowerCase() === expectation.color.toLowerCase() ? "pass" : "fail",
          `committed ${object.material.color}`,
        ),
      );
    }
    if (expectation.visible !== undefined) {
      checks.push(
        check(
          "graph",
          `visibility ${object.name}`,
          object.visible === expectation.visible ? "pass" : "fail",
          `committed ${object.visible ? "visible" : "hidden"}`,
        ),
      );
    }
  }
  return checks;
}

/**
 * Layer 2 — the live renderer. `nodes === null` means no renderer is
 * attached (tests, SSR, a scene that has not mounted), which is a
 * skip, not a pass.
 */
export function verifyRenderer(
  expectations: readonly SpatialObjectExpectation[],
  nodes: readonly LiveSceneNode[] | null,
): SpatialVerificationCheck[] {
  if (nodes === null || nodes.length === 0) {
    return [
      check("renderer", "live scene", "skipped", "no renderer is attached in this context"),
    ];
  }
  const oncreen = new Map(nodes.map((node) => [node.name, node]));
  const checks: SpatialVerificationCheck[] = [];
  for (const expectation of expectations) {
    const node = oncreen.get(`spatial:${expectation.id}`);
    if (!node) {
      checks.push(
        check("renderer", `mesh ${expectation.id}`, "fail", "the live scene has no mesh for this object"),
      );
      continue;
    }
    checks.push(check("renderer", `mesh ${expectation.id}`, "pass", `rendered as ${node.name}`));

    if (expectation.localPosition) {
      const delta = distance(tuple(node.localPosition), expectation.localPosition);
      checks.push(
        check(
          "renderer",
          `mesh position ${expectation.id}`,
          delta <= POSITION_TOLERANCE * 2 ? "pass" : "fail",
          `live (${round(tuple(node.localPosition))}) vs committed (${round(expectation.localPosition)})`,
        ),
      );
    }
    if (expectation.color) {
      checks.push(
        check(
          "renderer",
          `mesh material ${expectation.id}`,
          node.color?.toLowerCase() === expectation.color.toLowerCase() ? "pass" : "fail",
          `live colour ${node.color ?? "unknown"}`,
        ),
      );
    }
    if (expectation.visible !== undefined) {
      checks.push(
        check(
          "renderer",
          `mesh visibility ${expectation.id}`,
          node.visible === expectation.visible ? "pass" : "fail",
          `live ${node.visible ? "visible" : "hidden"}`,
        ),
      );
    }
  }
  return checks;
}

/** Layer 3 — the camera the applier believes it moved. */
export function verifyCamera(
  pose: SpatialCameraPose | null | undefined,
  camera: LiveCameraState | null,
): SpatialVerificationCheck[] {
  if (!pose) return [check("camera", "camera pose", "skipped", "no camera move was requested")];
  if (!camera) {
    return [check("camera", "camera pose", "skipped", "the renderer has no camera attached")];
  }
  const delta = Math.hypot(
    camera.position[0] - pose.position.x,
    camera.position[1] - pose.position.y,
    camera.position[2] - pose.position.z,
  );
  const tolerance = Math.max(1.2, pose.distance * 0.3);
  const checks: SpatialVerificationCheck[] = [
    check(
      "camera",
      "camera position",
      delta <= tolerance ? "pass" : "fail",
      `live distance to the requested pose ${delta.toFixed(2)} (tolerance ${tolerance.toFixed(2)})`,
    ),
  ];

  const toTarget: [number, number, number] = [
    pose.target.x - camera.position[0],
    pose.target.y - camera.position[1],
    pose.target.z - camera.position[2],
  ];
  const targetDistance = Math.hypot(...toTarget);
  if (targetDistance > 0.001) {
    const dot =
      (toTarget[0] * camera.direction[0] + toTarget[1] * camera.direction[1] + toTarget[2] * camera.direction[2]) /
      targetDistance;
    const angle = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
    const halfFov = camera.fov / 2;
    checks.push(
      check(
        "framing",
        "target inside the field of view",
        angle <= halfFov * 0.95 ? "pass" : "fail",
        `target is ${angle.toFixed(1)}° from the view axis, half-FOV is ${halfFov.toFixed(1)}°`,
      ),
    );
  } else {
    checks.push(check("framing", "target inside the field of view", "fail", "the camera is on top of its target"));
  }
  return checks;
}

export function summarize(
  checks: readonly SpatialVerificationCheck[],
  options: { screenshot?: SpatialVerificationSummary["screenshot"] } = {},
): SpatialVerificationSummary {
  const layers: Record<SpatialVerificationLayer, SpatialVerificationSummary["layers"][SpatialVerificationLayer]> = {
    graph: "skipped",
    renderer: "skipped",
    camera: "skipped",
    framing: "skipped",
    screenshot: "skipped",
  };
  for (const layer of Object.keys(layers) as SpatialVerificationLayer[]) {
    const forLayer = checks.filter((entry) => entry.layer === layer);
    if (forLayer.length === 0) continue;
    layers[layer] = forLayer.some((entry) => entry.status === "fail")
      ? "fail"
      : forLayer.every((entry) => entry.status === "skipped")
        ? "skipped"
        : "pass";
  }
  layers.screenshot = "skipped";
  return {
    ok: !checks.some((entry) => entry.status === "fail"),
    layers,
    checks: [...checks],
    screenshot: options.screenshot ?? "not-captured",
    checkedAt: Date.now(),
  };
}

/** Compose the full report for one committed batch. */
export function verifyObjects(
  snapshot: SpatialSceneSnapshot,
  expectations: readonly SpatialObjectExpectation[],
  nodes: readonly LiveSceneNode[] | null,
): SpatialVerificationCheck[] {
  return [...verifyGraph(snapshot, expectations), ...verifyRenderer(expectations, nodes)];
}

export function objectExpectation(object: SpatialObject): SpatialObjectExpectation {
  return {
    id: object.id,
    name: object.name,
    localPosition: object.transform.position,
    color: object.material.color,
    visible: object.visible,
  };
}

/** One-line, chat-safe description of a verification result. */
export function describeVerification(report: SpatialVerificationSummary): string {
  const parts = (["graph", "renderer", "camera", "framing", "screenshot"] as const)
    .filter((layer) => report.layers[layer] !== "skipped")
    .map((layer) => `${layer} ${report.layers[layer]}`);
  const skipped = (["graph", "renderer", "camera", "framing", "screenshot"] as const).filter(
    (layer) => report.layers[layer] === "skipped",
  );
  const head = parts.length > 0 ? `verification: ${parts.join(", ")}` : "verification: graph only";
  return skipped.length > 0 ? `${head} (${skipped.join(", ")} not measurable here)` : head;
}

function round(vector: SpatialVec3): string {
  return `${vector.x.toFixed(2)}, ${vector.y.toFixed(2)}, ${vector.z.toFixed(2)}`;
}

export function isColour(value: string | undefined): boolean {
  return typeof value === "string" && COLOUR_PATTERN.test(value);
}
