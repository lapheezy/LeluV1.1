/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP CONTRACT (Mission 17.2)
 *
 * The Neural Map is LÉLU's shared structural layer: what exists, what
 * it is part of, where it came from, what can operate on it. It is an
 * INDEX over the authorities that already own each thing — never a
 * second store of them:
 *
 *   CosmosObjectStore   3D objects, assemblies, groups, trash
 *   CosmosNavigation    the Cosmos core, galaxies, planets, rooms
 *   SpatialObjects      real records placed in rooms (pointers)
 *   SpatialSceneGraph   authored objects in LÉLU's Room
 *   ToolRegistry        the capabilities that operate on them
 *   InterfaceCatalog /  the interfaces and compositions that
 *   CompositionStore    present them
 *
 * Every entity names its authority and the id it has there, so any
 * view can go back to the source of truth. Writes go through the
 * existing tools (ToolDispatcher), never through the map.
 *
 * Spatial and semantic are kept apart on purpose: `spatial` says where
 * a thing is drawn; relations say what it means. Being close in space
 * creates no relation.
 * ==========================================================
 */

export type NeuralAuthority =
  | "cosmos.objects"
  | "cosmos.navigation"
  | "cosmos.placements"
  | "room.scene"
  | "tools"
  | "interfaces"
  /** WP02: the authorities behind the other interfaces. */
  | "chats"
  | "studio"
  | "projects"
  | "sandbox"
  | "home"
  /** A record another authority POINTS at (a project, a conversation…). */
  | "referenced";

export type NeuralEntityType =
  | "cosmos-core"
  | "galaxy"
  | "planet"
  | "room"
  | "object"
  | "group"
  | "placed-record"
  | "room-object"
  | "capability"
  | "interface"
  | "composition"
  | "record"
  /* WP02 */
  | "conversation"
  | "artifact"
  | "project"
  | "file"
  | "folder"
  | "app";

/**
 * Relationship vocabulary. Every relation is directed (from → to) and
 * read as a sentence: "<from> <type> <to>". The existing graphs had no
 * shared vocabulary (KnowledgeGraph: free strings; SpatialSceneGraph:
 * connected/orbits/contains/aligned); those Room kinds map onto
 * `connected-to`, `orbits`, `contains`, `aligned-with`.
 */
export type NeuralRelationType =
  | "contains"
  | "part-of"
  | "attached-to"
  | "located-in"
  | "member-of"
  | "derived-from"
  | "extracted-from"
  | "created-from"
  | "references"
  | "operated-by"
  | "presents"
  | "connected-to"
  | "orbits"
  | "aligned-with";

export const NEURAL_RELATION_TYPES: readonly NeuralRelationType[] = [
  "contains",
  "part-of",
  "attached-to",
  "located-in",
  "member-of",
  "derived-from",
  "extracted-from",
  "created-from",
  "references",
  "operated-by",
  "presents",
  "connected-to",
  "orbits",
  "aligned-with",
];

/** Lifecycle as the authority reports it — never inferred. */
export type NeuralState = "active" | "hidden" | "locked" | "trashed" | "archived" | "referenced";

export interface NeuralSpatial {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  /** The space it is drawn in (a canonical place id). */
  space?: string;
}

export interface NeuralProvenanceStep {
  at: number;
  action: string;
  detail: string;
  /** Canonical id of the other entity this step involved, when known. */
  ref?: string;
}

export interface NeuralEntity {
  /** Canonical id: `<namespace>:<authority id>`. Stable for the thing's life. */
  id: string;
  type: NeuralEntityType;
  label: string;
  authority: NeuralAuthority;
  /** The id the authority itself uses. */
  sourceId: string;
  state: NeuralState;
  spatial?: NeuralSpatial;
  provenance: NeuralProvenanceStep[];
  /** Tool ids that can act on it (resolved against the live ToolRegistry). */
  operations: string[];
  /** Small, display-only facts (domain, part count, kind…). */
  facts: Record<string, string | number | boolean>;
  updatedAt: number;
}

export interface NeuralRelation {
  /** `${from}|${type}|${to}` — so the same fact is never stored twice. */
  id: string;
  from: string;
  to: string;
  type: NeuralRelationType;
  /** Which authority states this relation. */
  authority: NeuralAuthority;
}

/** What one adapter contributes: everything its authority says, nothing else. */
export interface NeuralPartition {
  authority: NeuralAuthority;
  entities: NeuralEntity[];
  relations: NeuralRelation[];
}

export function relation(from: string, type: NeuralRelationType, to: string, authority: NeuralAuthority): NeuralRelation {
  return { id: `${from}|${type}|${to}`, from, to, type, authority };
}

/** Canonical ids. One function per namespace, so no caller hand-builds one. */
export const NID = {
  object: (id: string) => `cosmos.object:${id}`,
  group: (id: string) => `cosmos.group:${id}`,
  place: (id: string) => `cosmos.place:${id}`,
  placement: (id: string) => `cosmos.placement:${id}`,
  roomObject: (id: string) => `room.object:${id}`,
  capability: (toolId: string) => `capability:${toolId}`,
  interface: (id: string) => `interface:${id}`,
  composition: (id: string) => `composition:${id}`,
  record: (kind: string, id: string) => `record:${kind}:${id}`,
  /* WP02. Conversations, artifacts and projects keep the record id other
     authorities already point at (record:conversation:…, record:artifact:…,
     record:project:…): their owner now claims it, so a reference and the
     thing itself are ONE entity. */
  conversation: (id: string) => `record:conversation:${id}`,
  artifact: (id: string) => `record:artifact:${id}`,
  project: (id: string) => `record:project:${id}`,
  sandbox: (path: string) => `sandbox:${path}`,
  app: (id: string) => `app:${id}`,
} as const;

/** The Cosmos core's canonical id (CosmosNavigation's root). */
export const COSMOS_CORE_NID = NID.place("cosmos-core");
/** LÉLU's Room is the Genesis V2 interface; its authored objects live there. */
export const ROOM_NID = NID.interface("lelu-room");

/** Human words for a relation, for inspectors and tools. */
export const RELATION_WORDS: Record<NeuralRelationType, { out: string; in: string }> = {
  contains: { out: "contains", in: "is inside" },
  "part-of": { out: "is part of", in: "has part" },
  "attached-to": { out: "is attached to", in: "has attached" },
  "located-in": { out: "is located in", in: "holds" },
  "member-of": { out: "is in group", in: "groups" },
  "derived-from": { out: "was duplicated from", in: "was duplicated into" },
  "extracted-from": { out: "was extracted from", in: "had extracted" },
  "created-from": { out: "was created from", in: "created" },
  references: { out: "points at", in: "is pointed at by" },
  "operated-by": { out: "is operated by", in: "operates" },
  presents: { out: "presents", in: "is presented by" },
  "connected-to": { out: "is connected to", in: "is connected from" },
  orbits: { out: "orbits", in: "is orbited by" },
  "aligned-with": { out: "is aligned with", in: "is aligned with" },
};
