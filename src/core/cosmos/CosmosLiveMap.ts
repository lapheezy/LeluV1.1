/**
 * ==========================================================
 * LÉLU — LIVE COSMOS MAP
 *
 * The cosmos map used to contain only what was registered by
 * hand. This module makes it reflect the ACTUAL LÉLUVERSE:
 * the executive galaxies and agent universes CosmosStore is
 * already drawing, the projects ProjectStore holds, the views
 * the workspace has open, and SHAMAN.
 *
 * Two rules make this safe to run over and over:
 *
 *   1. Every destination has a STABLE id, so repeated
 *      synchronization updates instead of duplicating.
 *   2. Only destinations this module owns (origin "system",
 *      not removable, id starting with "map-") are ever
 *      retired when their source disappears. A room the user
 *      or LÉLU made is never touched here.
 *
 * It does not duplicate live state: a destination carries a
 * `ref` to the real record and is re-read from the runtime on
 * each sync, so a renamed agent shows its new name without
 * losing the visits it accumulated.
 * ==========================================================
 */

import CosmosNavigation, {
  COSMOS_CORE_ID,
  childPosition,
  type NavDestination,
} from "./CosmosNavigation";

export interface LiveAgent {
  id: string;
  name: string;
  position: [number, number, number];
}

export interface LiveGalaxy {
  id: string;
  name: string;
  /** The executive type that owns it (governor, engineer, …). */
  execType: string;
  position: [number, number, number];
  agents: LiveAgent[];
}

export interface LiveProject {
  id: string;
  name: string;
  status: string;
}

export interface LiveView {
  id: string;
  title: string;
  kind: string;
}

export interface LiveCosmosSnapshot {
  galaxies: LiveGalaxy[];
  projects: LiveProject[];
  views: LiveView[];
  includeShaman: boolean;
}

/** Ids are derived from real records, so they are stable across syncs. */
export const MAP_ID = {
  galaxy: (execType: string) => `map-galaxy-${execType}`,
  agent: (agentId: string) => `map-agent-${agentId}`,
  project: (projectId: string) => `map-project-${projectId}`,
  view: (viewId: string) => `map-view-${viewId}`,
  shaman: "map-shaman",
  workspace: "map-env-workspace",
} as const;

/** Ids this module owns and may retire when their source is gone. */
export function isMapOwned(id: string): boolean {
  return id.startsWith("map-") && id !== MAP_ID.workspace;
}

function xyz(position: { x: number; y: number; z: number }): [number, number, number] {
  return [position.x, position.y, position.z];
}

/**
 * The destinations the live state implies. Pure, so it can be tested
 * against a snapshot without a browser or a running app.
 */
export function buildCosmosDestinations(snapshot: LiveCosmosSnapshot): NavDestination[] {
  const destinations: NavDestination[] = [];

  if (snapshot.includeShaman) {
    destinations.push({
      id: MAP_ID.shaman,
      level: "planet",
      label: "SHAMAN",
      parentId: COSMOS_CORE_ID,
      ref: { kind: "cosmos", id: "shaman" },
      opens: { module: "chat" },
      position: [0, 6, 0],
      origin: "system",
      removable: false,
    });
  }

  // The workspace itself is a destination: the open views hang under it,
  // so "where did that document go" is a place you can walk back to.
  destinations.push({
    id: MAP_ID.workspace,
    level: "planet",
    label: "Workspace",
    parentId: COSMOS_CORE_ID,
    opens: { module: "workspace" },
    origin: "system",
    removable: false,
  });

  for (const view of snapshot.views) {
    if (!view.id) continue;
    destinations.push({
      id: MAP_ID.view(view.id),
      level: "room",
      label: view.title || view.kind || "view",
      parentId: MAP_ID.workspace,
      ref: null,
      opens: { module: "workspace", view: view.id },
      origin: "system",
      // An open view is not a place the user made; it follows the view.
      removable: false,
    });
  }

  for (const galaxy of snapshot.galaxies) {
    if (!galaxy.execType) continue;
    destinations.push({
      id: MAP_ID.galaxy(galaxy.execType),
      level: "galaxy",
      label: galaxy.name,
      parentId: COSMOS_CORE_ID,
      ref: { kind: "cosmos", id: galaxy.id || `exec-${galaxy.execType}` },
      // The rendered galaxy is exactly where CosmosStore put it, so the
      // map and the 3D scene agree about where a galaxy is.
      position: galaxy.position,
      origin: "system",
      removable: false,
    });

    for (const agent of galaxy.agents) {
      if (!agent.id) continue;
      destinations.push({
        id: MAP_ID.agent(agent.id),
        level: "planet",
        label: agent.name || agent.id,
        parentId: MAP_ID.galaxy(galaxy.execType),
        ref: { kind: "agent", id: agent.id },
        opens: { module: "chat" },
        position: agent.position,
        origin: "system",
        removable: false,
      });
    }
  }

  snapshot.projects.forEach((project, index) => {
    if (!project.id) return;
    destinations.push({
      id: MAP_ID.project(project.id),
      level: "planet",
      label: project.name || project.id,
      parentId: COSMOS_CORE_ID,
      ref: { kind: "project", id: project.id },
      opens: { module: "workspace", projectId: project.id },
      position: childPosition([0, 0, 0], 6 + index),
      origin: "system",
      removable: false,
    });
  });

  return destinations;
}

/**
 * Read the snapshot from the real stores.
 *
 * CosmosStore lives in the app tree and touches `window`, so it is
 * imported lazily: the map works (and is tested) headlessly, and a store
 * that cannot load degrades to an empty part of the map rather than
 * taking the whole sync down.
 */
export async function readLiveCosmos(): Promise<LiveCosmosSnapshot> {
  const snapshot: LiveCosmosSnapshot = { galaxies: [], projects: [], views: [], includeShaman: false };

  try {
    const { default: CosmosStore } = await import("../../app/scene/genesis/cosmos/CosmosStore");
    const state = CosmosStore.getInstance().getState();
    snapshot.includeShaman = state.entities.some((entity) => entity.level === "shaman");
    snapshot.galaxies = state.executiveGalaxies.map((galaxy) => ({
      id: galaxy.id,
      name: galaxy.name,
      execType: galaxy.runtimeId,
      position: xyz(galaxy.position),
      agents: state.agentUniverses
        .filter((universe) => universe.parentId === galaxy.id)
        .map((universe) => ({
          id: universe.runtimeId,
          name: universe.name,
          position: xyz(universe.position),
        })),
    }));
  } catch {
    /* no cosmos store in this runtime — the rest of the map still syncs */
  }

  try {
    const { default: ProjectStore } = await import("../projects/ProjectStore");
    snapshot.projects = ProjectStore.getInstance()
      .list()
      .filter((project) => project.status !== "archived")
      .map((project) => ({ id: project.id, name: project.name, status: project.status }));
  } catch {
    /* projects unavailable */
  }

  try {
    const { default: WorkspaceEngine } = await import("../workspace/WorkspaceEngine");
    snapshot.views = WorkspaceEngine.getInstance()
      .getState()
      .views.map((view) => ({ id: view.id, title: view.title, kind: view.kind }));
  } catch {
    /* workspace unavailable */
  }

  return snapshot;
}

/**
 * Apply a snapshot: register everything live, then retire only this
 * module's destinations whose source has gone.
 *
 * Split out from the store read so the behaviour can be tested against a
 * snapshot, and so the rule (map-owned nodes only, archived not deleted)
 * lives in one place.
 */
export function applyCosmosSnapshot(snapshot: LiveCosmosSnapshot): { destinations: number; retired: number } {
  const destinations = buildCosmosDestinations(snapshot);
  const nav = CosmosNavigation.getInstance();
  nav.registerAll(destinations);

  const live = new Set(destinations.map((destination) => destination.id));
  let retired = 0;
  for (const node of nav.getState().nodes) {
    if (!isMapOwned(node.id)) continue;
    if (node.origin !== "system" || node.removable) continue;
    if (live.has(node.id)) continue;
    if (nav.retire(node.id)) retired += 1;
  }

  return { destinations: destinations.length, retired };
}

/**
 * Synchronize the navigation map with the live environment.
 *
 * Idempotent: calling it twice produces the same destinations, with the
 * same ids, and keeps every visit count. Destinations that vanished from
 * the runtime are retired (archived, reversible) — never deleted.
 */
export async function syncCosmosMap(): Promise<{
  ok: boolean;
  destinations: number;
  retired: number;
  error?: string;
}> {
  try {
    const snapshot = await readLiveCosmos();
    return { ok: true, ...applyCosmosSnapshot(snapshot) };
  } catch (error) {
    return {
      ok: false,
      destinations: 0,
      retired: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A compact, truthful description of the map as it stands. */
export function describeCosmosMap(): string {
  const nav = CosmosNavigation.getInstance();
  const state = nav.getState();
  const count = (level: string) => state.nodes.filter((node) => node.level === level).length;
  const current = nav.current();
  const path = nav
    .pathTo(current.id)
    .map((node) => node.label)
    .join(" › ");
  const rooms = nav
    .rooms()
    .filter((node) => node.origin !== "system")
    .slice(0, 20)
    .map((room) => `  ⬡ ${room.label} (${room.visits} visit${room.visits === 1 ? "" : "s"})`);

  return [
    `You are at ${path || current.label}.`,
    `${count("galaxy")} galaxies · ${count("planet")} planets · ${count("room")} rooms · ${count("core")} core.`,
    ...(rooms.length ? ["Rooms you or the user made:", ...rooms] : []),
    `Trail: ${state.trail.map((id) => nav.get(id)?.label ?? id).join(" → ") || "(just arrived)"}`,
  ].join("\n");
}
