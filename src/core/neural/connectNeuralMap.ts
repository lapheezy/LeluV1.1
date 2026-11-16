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
  artifactsPartition,
  conversationsPartition,
  projectsPartition,
  sandboxPartition,
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

  // WP02: the authorities behind Chat Universe, Creation Studio, Projects
  // and the Code workspace. Imported on demand so the entry chunk does not
  // grow; each partition appears a tick after boot and then stays live.
  let stopped = false;
  void connectInterfaceAuthorities(map, stops, () => stopped);

  connected = () => {
    stopped = true;
    for (const stop of stops) stop();
    if (toolTimer) clearTimeout(toolTimer);
    connected = null;
  };
  return connected;
}

async function connectInterfaceAuthorities(map: ReturnType<typeof neuralMap>, stops: Array<() => void>, isStopped: () => boolean): Promise<void> {
  const [{ default: MultiChatStore }, { default: StudioStore }, { default: ProjectStore }, { default: SandboxFS }] = await Promise.all([
    import("../multichat/MultiChatStore"),
    import("../studio/StudioStore"),
    import("../projects/ProjectStore"),
    import("../engineering/SandboxFS"),
  ]);
  if (isStopped()) return;

  // Chats stream token by token: re-derive only when what the map shows
  // (titles, membership, links, counts) changes — never per token.
  const chats = MultiChatStore.getInstance();
  const chatSig = () =>
    chats
      .listAll()
      .map((c) => `${c.id}|${c.title}|${c.archived}|${c.pinned}|${c.projectId}|${c.linkedIds.join(",")}|${c.messages.length}|${c.topic}|${c.tags.join(",")}`)
      .join("\n");
  let lastChats = "";
  const syncChats = () => {
    const sig = chatSig();
    if (sig === lastChats) return;
    lastChats = sig;
    map.setPartition(conversationsPartition(chats.listAll()));
  };
  syncChats();
  stops.push(chats.subscribe(syncChats));

  const studio = StudioStore.getInstance();
  const syncStudio = () => map.setPartition(artifactsPartition(studio.list()));
  syncStudio();
  stops.push(studio.subscribe(syncStudio));

  const projects = ProjectStore.getInstance();
  const syncProjects = () => map.setPartition(projectsPartition(projects.list()));
  syncProjects();
  stops.push(projects.subscribe(syncProjects));

  const sandbox = SandboxFS.getInstance();
  const syncSandbox = () => map.setPartition(sandboxPartition(sandbox.list()));
  syncSandbox();
  stops.push(sandbox.subscribe(syncSandbox));
}
