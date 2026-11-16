/**
 * ==========================================================
 * LÉLU — CONNECTING THE NEURAL MAP TO ITS AUTHORITIES (M17.2)
 *
 * Subscribes the shared Neural Map index to each authority's OWN
 * change notifications (no polling, no second event bus) and, on a
 * change, recomputes only that authority's partition through its pure
 * adapter. Idempotent: connecting twice keeps one set of subscriptions,
 * and a reload re-derives the same canonical ids from the same
 * persisted sources — so nothing is duplicated.
 *
 * Tools register in bursts at boot, so the capability partition is
 * coalesced to one rebuild per burst; every other authority updates
 * synchronously, so a view reading the map right after an operation
 * sees its result.
 * ==========================================================
 */

import CosmosObjectStore from "../cosmos/objects/CosmosObjectStore";
import CosmosNavigation from "../cosmos/CosmosNavigation";
import SpatialObjects from "../cosmos/SpatialObjects";
import SpatialSceneGraph from "../spatial/SpatialSceneGraph";
import ToolRegistry from "../tools/ToolRegistry";
import { INTERFACES } from "../interface/InterfaceCatalog";
import InterfaceCompositionStore from "../interface/InterfaceCompositionStore";
import {
  capabilitiesPartition,
  cosmosObjectsPartition,
  interfacesPartition,
  navigationPartition,
  placementsPartition,
  roomScenePartition,
} from "./adapters";
import { neuralMap } from "./NeuralMap";

let connected: (() => void) | null = null;

export function isNeuralMapConnected(): boolean {
  return connected !== null;
}

export function connectNeuralMap(): () => void {
  if (connected) return connected;
  const map = neuralMap();
  const stops: Array<() => void> = [];

  const objects = CosmosObjectStore.getInstance();
  const syncObjects = () => {
    const s = objects.getState();
    map.setPartition(cosmosObjectsPartition({ objects: s.objects, trash: s.trash, groups: s.groups }));
  };
  // CosmosObjectStore.subscribe calls back immediately with the current state.
  stops.push(objects.subscribe(syncObjects));

  const nav = CosmosNavigation.getInstance();
  const syncNav = () => map.setPartition(navigationPartition(nav.getState().nodes, nav.archivedRooms()));
  syncNav();
  stops.push(nav.subscribe(syncNav));

  const placed = SpatialObjects.getInstance();
  const syncPlaced = () => map.setPartition(placementsPartition(placed.list()));
  syncPlaced();
  stops.push(placed.subscribe(syncPlaced));

  const scene = SpatialSceneGraph.getInstance();
  const syncScene = () => map.setPartition(roomScenePartition(scene.snapshot()));
  syncScene();
  stops.push(scene.subscribe(syncScene));

  const syncInterfaces = () => map.setPartition(interfacesPartition(INTERFACES, InterfaceCompositionStore.list()));
  syncInterfaces();
  // Moving through an open composition changes the store's revision but
  // not its structure: re-derive only when the compositions themselves change.
  const compositionsSig = () => InterfaceCompositionStore.list().map((c) => `${c.id}@${c.version}:${c.updatedAt}`).join("|") + `#${InterfaceCompositionStore.getState().trash.length}`;
  let lastCompositions = compositionsSig();
  stops.push(
    InterfaceCompositionStore.subscribe(() => {
      const sig = compositionsSig();
      if (sig === lastCompositions) return;
      lastCompositions = sig;
      syncInterfaces();
    }),
  );

  const registry = ToolRegistry.getInstance();
  let toolTimer: ReturnType<typeof setTimeout> | null = null;
  const syncTools = () => map.setPartition(capabilitiesPartition(registry.all()));
  syncTools();
  stops.push(
    registry.subscribe(() => {
      if (toolTimer) return;
      toolTimer = setTimeout(() => {
        toolTimer = null;
        syncTools();
      }, 50);
    }),
  );

  connected = () => {
    for (const stop of stops) stop();
    if (toolTimer) clearTimeout(toolTimer);
    connected = null;
  };
  return connected;
}
