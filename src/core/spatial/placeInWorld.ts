/**
 * ==========================================================
 * LÉLU — PLACE IN WORLD
 *
 * One action, used by every surface, for turning something the user is
 * looking at into an object in the ONE spatial scene.
 *
 * It is deliberately thin: it goes through SpatialIntentBus, which means the
 * tier guard authorizes it, the graph commits it atomically, verification
 * re-reads the scene, and the reveal request is raised for the new object.
 * There is no second scene, no preview scene and no local copy of an object:
 * what is placed here is a real node the renderer already knows how to draw.
 * ==========================================================
 */

import SpatialIntentBus from "./SpatialIntentBus";
import type { SpatialPrimitiveKind } from "./SpatialTypes";

export interface PlaceInWorldInput {
  /** Shown in the scene and used to de-duplicate repeated placements. */
  name: string;
  kind?: SpatialPrimitiveKind;
  /** #rrggbb, normally the surface's accent. */
  color?: string;
  scale?: number;
  position?: { x?: number; y?: number; z?: number };
}

export interface PlaceInWorldOutcome {
  ok: boolean;
  /** The bus's own sentence, or its refusal. */
  message: string;
  objectName?: string;
  revision: number;
}

export async function placeInWorld(input: PlaceInWorldInput): Promise<PlaceInWorldOutcome> {
  const result = await SpatialIntentBus.getInstance().apply({
    op: "object.create",
    kind: input.kind ?? "box",
    name: input.name,
    color: input.color,
    scale: input.scale,
    position: input.position,
  });
  return {
    ok: result.ok,
    message: result.message,
    objectName: result.objectName,
    revision: result.revision,
  };
}
