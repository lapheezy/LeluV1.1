/**
 * ==========================================================
 * LÉLU — CREATIVE OBJECTS IN THE COSMOS
 *
 * The bridge between the creative object store and the Cosmos
 * spatial store. It does NOT add a second object store or a
 * second scene manager: a creative object is placed through
 * SpatialObjects (the existing "position and pointer" store),
 * and the pointer's record is the creative object itself, which
 * CosmosInspector reads from the creative store.
 *
 * Taking an object out of the cosmos removes the placement, not
 * the object: the record, its geometry, materials and history
 * stay in CreativeObjects.
 * ==========================================================
 */

import CreativeObjects from "../couture/objects";
import { creativePositionToScene } from "../couture/sceneTransform";
import SpatialObjects from "./SpatialObjects";

export interface PlacementResult {
  ok: boolean;
  message: string;
  objectId?: string;
  spatialObjectId?: string;
}

export default class CreativeObjectBridge {
  /**
   * Place a creative object in a Cosmos room. Idempotent by record: placing
   * the same object twice updates its placement instead of stacking copies.
   */
  static place(objectId: string, options: { roomId?: string; position?: [number, number, number]; store?: CreativeObjects } = {}): PlacementResult {
    const store = options.store ?? CreativeObjects.getInstance();
    const object = store.get(objectId);
    if (!object) return { ok: false, message: `no creative object ${objectId}` };
    const roomId = options.roomId ?? object.roomId ?? "cosmos-core";
    // The creative store is millimetres, z-up; the Cosmos placement is metres,
    // y-up. Convert once, here, so neither side guesses the other's units.
    const creativePosition = options.position ?? object.transform.position;
    const spatialPosition = creativePositionToScene(creativePosition);
    const placed = store.placeInCosmos(objectId, { roomId, position: creativePosition });
    if (!placed) return { ok: false, message: `could not place ${objectId}` };

    const spatial = SpatialObjects.getInstance().place({
      kind: "object",
      title: object.name,
      link: { kind: "creative", id: object.id },
      roomId,
      position: spatialPosition,
    });
    if (!spatial.ok) return { ok: false, message: `placement refused: ${spatial.error}` };

    return {
      ok: true,
      message: `${object.name} is in ${roomId} as ${spatial.object.id}${spatial.duplicate ? " (placement updated)" : ""}; geometry, components and history unchanged`,
      objectId: object.id,
      spatialObjectId: spatial.object.id,
    };
  }

  /** Take it out of the cosmos without destroying it. */
  static remove(objectId: string, options: { store?: CreativeObjects } = {}): PlacementResult {
    const store = options.store ?? CreativeObjects.getInstance();
    const object = store.get(objectId);
    if (!object) return { ok: false, message: `no creative object ${objectId}` };
    const spatial = SpatialObjects.getInstance().find({ kind: "creative", id: objectId });
    if (spatial) SpatialObjects.getInstance().remove(spatial.id);
    store.removeFromCosmos(objectId);
    return { ok: true, message: `${object.name} left the cosmos and is back in ${object.workspaceId}; the object itself is kept (${object.parts.length} parts, revision ${object.revision})` };
  }

  /** What is currently floating in a room, read from the creative store. */
  static listing(roomId?: string, options: { store?: CreativeObjects } = {}): Array<{ objectId: string; name: string; kind: string; components: number; triangles: number; position: [number, number, number] }> {
    const store = options.store ?? CreativeObjects.getInstance();
    return store
      .list({ location: "cosmos", ...(roomId ? { roomId } : {}) })
      .map((o) => ({
        objectId: o.id,
        name: o.name,
        kind: o.kind,
        components: o.components.length,
        triangles: o.parts.reduce((n, p) => n + Math.floor(p.mesh.indices.length / 3), 0),
        position: o.transform.position,
      }));
  }
}
