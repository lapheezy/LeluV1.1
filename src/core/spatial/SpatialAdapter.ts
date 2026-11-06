/**
 * ==========================================================
 * LÉLU — SPATIAL ADAPTER (read-only world discovery)
 *
 * Phase 2.2 · Gate B/C. Connects the world that ALREADY exists
 * inside Genesis to the spatial core without taking it over:
 *
 *   authored  — objects LÉLU created (SpatialSceneGraph)
 *   cosmos    — CosmosEntityRegistry entities (tabs, panels, agents)
 *   world     — WorldRegistry destinations (UI/workspace waypoints)
 *   scene     — live three.js nodes (Core, planets, avatar, …)
 *
 * Read-only means read-only: this class never writes to Genesis,
 * Cosmos, the world registry or the three.js objects, and it
 * never registers foreign entities as spatial objects. Identity
 * is namespaced (`cosmos:…`, `world:…`, `scene:…`, or a spatial
 * object id), so the same world entity cannot appear twice and
 * an authored mesh is never reported a second time as a scene
 * node.
 *
 * A scene entity that was registered but is no longer in the
 * live scene is reported `stale`, never silently dropped.
 * ==========================================================
 */

import CosmosEntityRegistry from "../cosmos/CosmosEntityRegistry";
import WorldRegistry, { type WorldDestination } from "../../app/scene/genesis/WorldRegistry";
import SpatialSceneGraph from "./SpatialSceneGraph";
import SpatialObjectRegistry from "./SpatialObjectRegistry";
import { getLiveSceneProvider, type LiveSceneNode } from "./SpatialLiveScene";
import type { SpatialObject, SpatialVec3 } from "./SpatialTypes";

export type SpatialEntitySource = "authored" | "cosmos" | "world" | "scene";

export interface SpatialEntityRef {
  /** Namespaced, stable reference — what chat and the camera resolve. */
  ref: string;
  /** Underlying id (spatial object id, cosmos id, world key, node name). */
  id: string;
  name: string;
  source: SpatialEntitySource;
  kind: string;
  /** World-space position when the source knows one. */
  position: SpatialVec3 | null;
  /** Node radius when known, used for geometry-aware framing. */
  radius: number | null;
  /** True when the entity exists in the live renderer or an authoritative store. */
  live: boolean;
  /** True when it was registered but is missing from the live scene now. */
  stale: boolean;
  active?: boolean;
  meta?: Record<string, unknown>;
}

export interface SpatialAdapterStats {
  authored: number;
  cosmos: number;
  world: number;
  scene: number;
  stale: number;
  rendererAttached: boolean;
}

interface AdapterDeps {
  graph: SpatialSceneGraph;
  registry: SpatialObjectRegistry;
  cosmos: CosmosEntityRegistry;
  world: WorldRegistry;
  liveNodes: () => LiveSceneNode[];
}

const AUTHORED_PREFIX = "spatial:";

function defaultDeps(): AdapterDeps {
  return {
    graph: SpatialSceneGraph.getInstance(),
    registry: SpatialObjectRegistry.getInstance(),
    cosmos: CosmosEntityRegistry.getInstance(),
    world: WorldRegistry.getInstance(),
    liveNodes: () => getLiveSceneProvider()?.listNodes() ?? [],
  };
}

function toVec3(node: LiveSceneNode): SpatialVec3 {
  return { x: node.worldPosition[0], y: node.worldPosition[1], z: node.worldPosition[2] };
}

function primitiveRadius(object: SpatialObject): number {
  const scale = Math.max(object.transform.scale.x, object.transform.scale.y, object.transform.scale.z);
  switch (object.kind) {
    case "sphere":
      return 0.6 * scale;
    case "box":
      return 0.87 * scale;
    case "cylinder":
    case "cone":
      return 0.62 * scale;
    case "torus":
      return 0.68 * scale;
    default:
      return 0.99 * scale;
  }
}

export default class SpatialAdapter {
  private static instance: SpatialAdapter | null = null;
  private readonly deps: AdapterDeps;

  constructor(deps: Partial<AdapterDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  public static getInstance(): SpatialAdapter {
    if (!SpatialAdapter.instance) SpatialAdapter.instance = new SpatialAdapter();
    return SpatialAdapter.instance;
  }

  /** Every entity the spatial core can see, deterministically ordered. */
  public list(): SpatialEntityRef[] {
    const live = this.deps.liveNodes();
    const liveById = new Map(live.map((node) => [node.name, node]));

    const authored = this.deps.graph.snapshot().objects.map((object): SpatialEntityRef => {
      const node = liveById.get(`${AUTHORED_PREFIX}${object.id}`);
      return {
        ref: object.id,
        id: object.id,
        name: object.name,
        source: "authored",
        kind: object.kind,
        position: node ? toVec3(node) : object.transform.position,
        radius: primitiveRadius(object),
        live: node ? true : live.length === 0 ? true : false,
        stale: live.length > 0 && !node,
        meta: {
          revision: this.deps.graph.getRevision(),
          provenance: object.provenance,
          color: object.material.color,
        },
      };
    });

    const cosmos = this.deps.cosmos.getAll().map((entity): SpatialEntityRef => {
      const node = liveById.get(entity.label) ?? liveById.get(`cosmos:${entity.id}`);
      return {
        ref: `cosmos:${entity.id}`,
        id: entity.id,
        name: entity.label,
        source: "cosmos",
        kind: entity.kind,
        position: node ? toVec3(node) : { x: entity.position[0], y: entity.position[1], z: entity.position[2] },
        radius: 0.45 * (entity.scale ?? 1),
        live: true,
        stale: false,
        active: entity.active,
        meta: { sourceId: entity.sourceId, color: entity.color, lastVisited: entity.lastVisited },
      };
    });

    const world = this.deps.world.debug().destinations.map(
      (destination: WorldDestination): SpatialEntityRef => {
        const node = liveById.get(destination.label) ?? liveById.get(destination.key);
        return {
          ref: `world:${destination.key}`,
          id: destination.key,
          name: destination.label,
          source: "world",
          kind: destination.kind,
          position: node ? toVec3(node) : null,
          radius: 0.6,
          live: true,
          stale: node === undefined && live.length > 0,
          meta: { weight: destination.weight, scale: destination.scale, ...destination.meta },
        };
      },
    );

    const scene = live
      .filter((node) => !node.name.startsWith(AUTHORED_PREFIX))
      .map(
        (node): SpatialEntityRef => ({
          ref: `scene:${node.name}`,
          id: node.name,
          name: node.label ?? node.name,
          source: "scene",
          kind: node.geometry ?? "node",
          position: toVec3(node),
          radius: node.radius ?? 1,
          live: true,
          stale: false,
          meta: { color: node.color, parent: node.parentName ?? null },
        }),
      );

    return [...authored, ...cosmos, ...world, ...scene];
  }

  public stats(): SpatialAdapterStats {
    const all = this.list();
    return {
      authored: all.filter((entity) => entity.source === "authored").length,
      cosmos: all.filter((entity) => entity.source === "cosmos").length,
      world: all.filter((entity) => entity.source === "world").length,
      scene: all.filter((entity) => entity.source === "scene").length,
      stale: all.filter((entity) => entity.stale).length,
      rendererAttached: this.deps.liveNodes().length > 0,
    };
  }

  /**
   * Resolve one reference to exactly one entity.
   *
   * Order: namespaced ref → spatial object id/name → cosmos id → live
   * scene name → world key. A partial match is accepted only when it
   * is unambiguous, so "station" cannot silently pick one of three.
   */
  public resolve(reference: string): SpatialEntityRef | null {
    const raw = reference.trim();
    if (!raw) return null;
    const all = this.list();
    const lower = raw.toLowerCase();

    const namespaced = all.find((entity) => entity.ref.toLowerCase() === lower);
    if (namespaced) return namespaced;

    const authored = all.filter((entity) => entity.source === "authored");
    const byObject = this.deps.registry.resolve(raw);
    if (byObject) return authored.find((entity) => entity.id === byObject.id) ?? null;

    const bySceneName = all.find((entity) => entity.id.toLowerCase() === lower);
    if (bySceneName) return bySceneName;

    const exact = all.filter(
      (entity) =>
        entity.name.toLowerCase() === lower ||
        entity.name.toLowerCase().replace(/^(the|my|a|an)\s+/, "") === lower,
    );
    if (exact.length === 1) return exact[0];

    const partial = all.filter((entity) => entity.name.toLowerCase().includes(lower));
    if (partial.length === 1) return partial[0];
    return null;
  }

  /** Candidate names for a refusal — never a guessed match. */
  public candidates(reference: string): string[] {
    const lower = reference.trim().toLowerCase();
    if (!lower) return this.list().slice(0, 8).map((entity) => entity.name);
    return this.list()
      .filter((entity) => entity.name.toLowerCase().includes(lower))
      .slice(0, 8)
      .map((entity) => entity.name);
  }

  public inspect(reference: string): SpatialEntityRef | null {
    const entity = this.resolve(reference);
    if (!entity) return null;
    if (entity.source !== "authored") {
      const node = this.deps.liveNodes().find((candidate) => candidate.name === `scene:${entity.id}`);
      return {
        ...entity,
        meta: {
          ...entity.meta,
          rendered: node ? true : entity.live,
          worldPosition: entity.position
            ? [entity.position.x, entity.position.y, entity.position.z]
            : null,
        },
      };
    }
    const object = this.deps.registry.get(entity.id);
    return object ? { ...entity, meta: { ...entity.meta, object } } : entity;
  }

  /** True when the id belongs to an object LÉLU authored (not Genesis). */
  public isAuthored(id: string): boolean {
    return this.deps.registry.get(id) !== undefined;
  }

  /** Live renderer node for an authored object, if it is mounted. */
  public liveNodeFor(id: string): LiveSceneNode | null {
    return this.deps.liveNodes().find((node) => node.name === `${AUTHORED_PREFIX}${id}`) ?? null;
  }

  /** Test seam. */
  public static resetForTests(): void {
    SpatialAdapter.instance = null;
  }
}

