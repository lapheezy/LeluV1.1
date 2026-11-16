/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL GRAPH
 *
 * Objects are not meshes to draw; they are entities LÉLU can
 * reason about. This module gives her the meaning layer over
 * the existing world engine (plugins/worldEngine.ts):
 *
 *   - every placement, avatar and world is an entity
 *   - a generated piece ("exoskeleton") is a container:
 *     parts are part-of it, it contains them
 *   - objects close together are `near`; stacked ones are
 *     `above`/`below`
 *   - declared links add meaning that geometry cannot see:
 *     connected-to, controls, depends-on, owned-by, linked-to
 *     (including between two WORLDS)
 *
 * Pure functions over plain data — no filesystem, no React,
 * no Three.js — so the graph the model queries is the same
 * graph the renderer draws, and every rule is unit-tested.
 *
 * Entity keys are always qualified by world
 * (`<worldId>:<entityId>`), because the same placement id can
 * legitimately exist in two worlds once objects are linked
 * rather than copied.
 * ==========================================================
 */

export type SpatialEntityKind =
  | "avatar"
  | "environment"
  | "object"
  | "window"
  | "machine"
  | "portal"
  | "agent"
  | "simulation";

export type RelationshipKind =
  | "part-of"
  | "contains"
  | "inside"
  | "attached-to"
  | "connected-to"
  | "near"
  | "above"
  | "below"
  | "controls"
  | "depends-on"
  | "owned-by"
  | "linked-to";

export const RELATIONSHIP_KINDS: readonly RelationshipKind[] = [
  "part-of",
  "contains",
  "inside",
  "attached-to",
  "connected-to",
  "near",
  "above",
  "below",
  "controls",
  "depends-on",
  "owned-by",
  "linked-to",
];

/** A relationship she declares rather than infers. Persisted by the world engine. */
export interface DeclaredLink {
  id: string;
  fromWorld: string;
  /** Entity id, or "*" for the world itself. */
  fromEntity: string;
  toWorld: string;
  /** Entity id, or "*" for the world itself. */
  toEntity: string;
  kind: RelationshipKind;
  note?: string;
  createdAt?: string;
}

export interface EntityInput {
  id: string;
  worldId: string;
  name: string;
  kind?: SpatialEntityKind;
  /** The generated piece this part belongs to (e.g. "exoskeleton"). */
  group?: string | null;
  /** [x, y, z] in world units. */
  position: [number, number, number];
  height?: number;
}

export interface GraphEntity {
  key: string;
  id: string;
  worldId: string;
  name: string;
  kind: SpatialEntityKind;
  /** A piece/container the renderer does not draw as one mesh. */
  synthetic: boolean;
  position?: [number, number, number];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: RelationshipKind;
  source: "structure" | "proximity" | "declared";
  note?: string;
}

export interface SpatialGraph {
  entities: Map<string, GraphEntity>;
  edges: GraphEdge[];
}

/** `<worldId>:<entityId>` — the only key format the graph accepts. */
export function entityKey(worldId: string, entityId: string): string {
  return `${worldId}:${entityId}`;
}

/** The entity key for a world itself, used when worlds are linked. */
export function worldKey(worldId: string): string {
  return entityKey(worldId, "*");
}

export function pieceKey(worldId: string, group: string): string {
  return entityKey(worldId, `piece:${group}`);
}

const dedupe = (edges: GraphEdge[]): GraphEdge[] => {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.from}|${e.to}|${e.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const horizontal = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/**
 * Build the graph from the world's real contents.
 *
 * `proximity` is how close two objects must be (on the floor plane) to count as
 * `near`; the default is a little under her body width, so furniture that is
 * genuinely beside each other links up without wiring the whole room together.
 */
export function buildSpatialGraph(input: {
  entities: EntityInput[];
  links?: DeclaredLink[];
  proximity?: number;
  vertical?: number;
}): SpatialGraph {
  const entities = new Map<string, GraphEntity>();
  const edges: GraphEdge[] = [];
  const proximity = input.proximity ?? 1.4;
  const vertical = input.vertical ?? 0.9;

  const add = (e: GraphEntity) => {
    if (!entities.has(e.key)) entities.set(e.key, e);
  };

  // Worlds are entities too, so "link Atelier to Laboratory" has both ends.
  for (const e of input.entities) {
    add({ key: worldKey(e.worldId), id: "*", worldId: e.worldId, name: e.worldId, kind: "environment", synthetic: true });
  }

  for (const e of input.entities) {
    add({
      key: entityKey(e.worldId, e.id),
      id: e.id,
      worldId: e.worldId,
      name: e.name,
      kind: e.kind ?? "object",
      synthetic: false,
      position: e.position,
    });
  }

  // Structure: parts of one generated piece are siblings through the piece.
  for (const e of input.entities) {
    if (!e.group) continue;
    const piece = pieceKey(e.worldId, e.group);
    add({ key: piece, id: `piece:${e.group}`, worldId: e.worldId, name: e.group, kind: "object", synthetic: true });
    const part = entityKey(e.worldId, e.id);
    edges.push({ from: part, to: piece, kind: "part-of", source: "structure" });
    edges.push({ from: piece, to: part, kind: "contains", source: "structure" });
  }

  // Proximity and vertical order, inferred from the placements themselves.
  for (let i = 0; i < input.entities.length; i++) {
    for (let j = i + 1; j < input.entities.length; j++) {
      const a = input.entities[i];
      const b = input.entities[j];
      if (a.worldId !== b.worldId) continue;
      // Siblings of one piece are still physically near each other; both
      // relationships are true and 
      // each one is separately filterable.
      const A = entityKey(a.worldId, a.id);
      const B = entityKey(b.worldId, b.id);
      const gap = horizontal(a.position, b.position);
      const dy = b.position[1] - a.position[1];
      if (Math.abs(dy) >= 0.3 && Math.abs(dy) <= 3 && gap <= vertical) {
        const [low, high] = dy > 0 ? [A, B] : [B, A];
        edges.push({ from: high, to: low, kind: "above", source: "proximity" });
        edges.push({ from: low, to: high, kind: "below", source: "proximity" });
        continue;
      }
      if (gap > 0 && gap <= proximity) {
        edges.push({ from: A, to: B, kind: "near", source: "proximity" });
        edges.push({ from: B, to: A, kind: "near", source: "proximity" });
      }
    }
  }

  // Declared links: meaning she was told, which geometry cannot infer.
  for (const link of input.links ?? []) {
    const from = link.fromEntity === "*" ? worldKey(link.fromWorld) : entityKey(link.fromWorld, link.fromEntity);
    const to = link.toEntity === "*" ? worldKey(link.toWorld) : entityKey(link.toWorld, link.toEntity);
    if (!entities.has(from) || !entities.has(to)) continue; // stale link: ignored, not fatal
    edges.push({ from, to, kind: link.kind, source: "declared", ...(link.note ? { note: link.note } : {}) });
  }

  return { entities, edges: dedupe(edges) };
}

/* ------------------------------------------------------------------ *
 * QUERYING
 * ------------------------------------------------------------------ */

export interface GraphQuery {
  /** Restrict to one world. */
  world?: string;
  /** Start entity id (in `world`, or a full `<world>:<entity>` key). */
  entity?: string;
  /** Restrict traversal to these relationship kinds. */
  kinds?: RelationshipKind[];
  /** How many hops (default 1). */
  depth?: number;
  /** Match entity names containing this text (case-insensitive). */
  name?: string;
  limit?: number;
}

export interface GraphHit {
  entity: GraphEntity;
  depth: number;
  /** Keys of the entities this hit was reached from. */
  via: string[];
  relation: RelationshipKind | null;
}

export interface GraphQueryResult {
  hits: GraphHit[];
  edges: GraphEdge[];
  truncated: boolean;
  /** Entity ids (unqualified) in `world` order, ready to highlight. */
  matchedEntityIds: string[];
  description: string;
}

function resolveStart(graph: SpatialGraph, query: GraphQuery): string[] {
  if (query.entity) {
    if (query.entity.includes(":")) return graph.entities.has(query.entity) ? [query.entity] : [];
    const world = query.world;
    if (world) {
      const key = entityKey(world, query.entity);
      return graph.entities.has(key) ? [key] : [];
    }
    // No world: accept an entity id only if it is unambiguous.
    const matches = [...graph.entities.values()].filter((e) => e.id === query.entity);
    return matches.length === 1 ? [matches[0].key] : [];
  }
  return [...graph.entities.values()]
    .filter((e) => (query.world ? e.worldId === query.world : true))
    .filter((e) => !e.synthetic || e.id === "*")
    .map((e) => e.key);
}

/**
 * Breadth-first traversal from an entity (or from a whole world).
 *
 * Returns the entities she reached, how far away they were and through which
 * relationship, so an answer can say *why* two things are connected instead of
 * just listing ids.
 */
export function queryGraph(graph: SpatialGraph, query: GraphQuery = {}): GraphQueryResult {
  const depthLimit = Math.max(0, Math.min(4, query.depth ?? 1));
  const kinds = query.kinds?.length ? new Set(query.kinds) : null;
  const name = query.name?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(200, query.limit ?? 50));

  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    if (kinds && !kinds.has(edge.kind)) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }

  const start = resolveStart(graph, query);
  const best = new Map<string, GraphHit>();
  const reachedEdges: GraphEdge[] = [];
  const seenEdge = new Set<string>();
  let frontier = start.filter((key) => graph.entities.has(key));

  for (const key of frontier) {
    const entity = graph.entities.get(key)!;
    best.set(key, { entity, depth: 0, via: [], relation: null });
  }

  for (let depth = 1; depth <= depthLimit && frontier.length; depth++) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const edge of adjacency.get(key) ?? []) {
        const id = `${edge.from}|${edge.to}|${edge.kind}`;
        if (!seenEdge.has(id)) {
          seenEdge.add(id);
          reachedEdges.push(edge);
        }
        const target = graph.entities.get(edge.to);
        if (!target) continue;
        if (!best.has(edge.to)) {
          best.set(edge.to, { entity: target, depth, via: [key], relation: edge.kind });
          next.push(edge.to);
        } else if (best.get(edge.to)!.depth === depth) {
          best.get(edge.to)!.via.push(key);
        }
      }
    }
    frontier = next;
  }

  const all = [...best.values()]
    .filter((hit) => {
      if (name && !hit.entity.name.toLowerCase().includes(name)) return false;
      if (hit.depth === 0) return true;
      // A hop through a container is meaningful, but its synthetic id is not
      // something the user asked to see.
      if (hit.entity.synthetic && hit.entity.id !== "*") return false;
      return true;
    })
    .sort((a, b) => a.depth - b.depth || a.entity.name.localeCompare(b.entity.name));

  const hits = all.slice(0, limit);
  const truncated = all.length > hits.length;
  const matchedEntityIds = [
    ...new Set(
      hits
        // The thing she asked about is the subject, not something to highlight;
        // a bare world/name query highlights everything it found.
        .filter((h) => (query.entity ? h.depth > 0 : true))
        .filter((h) => !h.entity.synthetic && h.entity.kind !== "environment")
        .map((h) => h.entity.id),
    ),
  ];

  return {
    hits,
    edges: reachedEdges,
    truncated,
    matchedEntityIds,
    description: describeGraphQuery(graph, query, { hits, truncated, matchedEntityIds }),
  };
}

/** One readable sentence she can say, and that a test can assert on. */
export function describeGraphQuery(
  graph: SpatialGraph,
  query: GraphQuery,
  result: Pick<GraphQueryResult, "hits" | "truncated" | "matchedEntityIds">,
): string {
  const startEntity = query.entity
    ? (query.entity.includes(":") ? graph.entities.get(query.entity) : graph.entities.get(entityKey(query.world ?? "", query.entity)))
    : null;
  const where = query.world ? ` in ${query.world}` : "";
  const neighbours = result.hits.filter((h) => h.depth > 0);
  if (!query.entity && !query.name) {
    if (!result.hits.length) return `Nothing matches${where}.`;
    const worlds = new Set(result.hits.map((h) => h.entity.worldId));
    return `${result.hits.length} entities across ${worlds.size} world${worlds.size === 1 ? "" : "s"}${where}${result.truncated ? " (truncated)" : ""}: ${result.hits
      .slice(0, 8)
      .map((h) => `${h.entity.name} [${h.entity.worldId}]`)
      .join(", ")}${result.hits.length > 8 ? ", …" : ""}.`;
  }
  if (!neighbours.length) {
    return query.entity
      ? `Nothing is connected to ${startEntity?.name ?? query.entity}${where}.`
      : `Nothing matches${where}${query.name ? ` "${query.name}"` : ""}.`;
  }
  const subject = startEntity?.name ?? query.name ?? query.entity ?? "the scene";
  const lines = neighbours.map(
    (h) => `${h.entity.name} [${h.entity.worldId}] — ${h.relation ?? "related"} (${h.depth} hop${h.depth === 1 ? "" : "s"})`,
  );
  return `${subject}${where}: ${lines.length ? lines.join("; ") : "no neighbours"}${result.truncated ? " (truncated)" : ""}.`;
}

/* ------------------------------------------------------------------ *
 * DECLARING LINKS
 * ------------------------------------------------------------------ */

/**
 * Why a link cannot be made, or null when it can.
 *
 * Kept as a reason string rather than throwing so the engine can turn it into
 * its own HTTP error and the tool can hand the model a sentence it can act on.
 */
export function linkProblem(
  input: Partial<DeclaredLink>,
  context: {
    worlds: Set<string>;
    /** entity ids present per world */
    entities: Map<string, Set<string>>;
    existing: DeclaredLink[];
  },
): string | null {
  const kind = input.kind as RelationshipKind | undefined;
  if (!kind || !RELATIONSHIP_KINDS.includes(kind)) return `kind must be one of ${RELATIONSHIP_KINDS.join(", ")}.`;
  if (!input.fromWorld || !context.worlds.has(input.fromWorld)) return `No world "${input.fromWorld ?? ""}".`;
  if (!input.toWorld || !context.worlds.has(input.toWorld)) return `No world "${input.toWorld ?? ""}".`;
  if (!input.fromEntity) return "fromEntity is required (use \"*\" for the world itself).";
  if (!input.toEntity) return "toEntity is required (use \"*\" for the world itself).";
  if (input.fromEntity !== "*" && !context.entities.get(input.fromWorld)?.has(input.fromEntity)) {
    return `No entity "${input.fromEntity}" in ${input.fromWorld}.`;
  }
  if (input.toEntity !== "*" && !context.entities.get(input.toWorld)?.has(input.toEntity)) {
    return `No entity "${input.toEntity}" in ${input.toWorld}.`;
  }
  if (input.fromWorld === input.toWorld && input.fromEntity === input.toEntity) {
    return "An entity cannot be linked to itself.";
  }
  if (input.fromEntity === "*" && input.toEntity === "*" && input.fromWorld === input.toWorld) {
    return "A world cannot be linked to itself.";
  }
  const duplicate = context.existing.find(
    (l) => l.fromWorld === input.fromWorld && l.fromEntity === input.fromEntity && l.toWorld === input.toWorld && l.toEntity === input.toEntity && l.kind === kind,
  );
  if (duplicate) return `That ${kind} link already exists (${duplicate.id}).`;
  return null;
}
