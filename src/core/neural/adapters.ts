/**
 * ==========================================================
 * LÉLU — NEURAL MAP ADAPTERS (Mission 17.2)
 *
 * One pure function per authority: its own state in, a partition of the
 * Neural Map out. No adapter reads another authority, writes anything,
 * or invents an entity its authority does not hold. Relations are read
 * from the authority's data (parent fields, structured provenance refs,
 * room ids, record links) — never from the wording of a label, and
 * never from spatial closeness.
 * ==========================================================
 */

import type { CosmosObject, CosmosObjectState } from "../cosmos/objects/CosmosObjectTypes";
import type { NavNode } from "../cosmos/CosmosNavigation";
import type { SpatialObject as PlacedRecord } from "../cosmos/SpatialObjects";
import type { SpatialSceneSnapshot } from "../spatial/SpatialTypes";
import type { ToolDefinition } from "../tools/ToolRegistry";
import type { InterfaceEntry } from "../interface/InterfaceCatalog";
import type { InterfaceComposition } from "../interface/interfaceComposition";
import type { ChatConversation } from "../multichat/MultiChatStore";
import type { StudioArtifact } from "../studio/StudioStore";
import type { LeluProject } from "../projects/ProjectStore";
import type { SandboxNode } from "../engineering/SandboxFS";
import {
  COSMOS_CORE_NID,
  NID,
  ROOM_NID,
  relation,
  type NeuralEntity,
  type NeuralPartition,
  type NeuralProvenanceStep,
  type NeuralRelation,
  type NeuralRelationType,
} from "./NeuralMapTypes";

/** Operations an object accepts, by the tools that already exist for it. */
export const OBJECT_OPERATIONS = [
  "cosmos.object.select",
  "cosmos.object.transform",
  "cosmos.object.position",
  "cosmos.object.animate",
  "cosmos.object.integrate",
  "cosmos.object.extract",
  "cosmos.object.isolate",
  "cosmos.object.duplicate",
  "cosmos.object.group",
  "cosmos.object.remove",
] as const;
export const TRASHED_OPERATIONS = ["cosmos.object.restore"] as const;
export const ROOM_OPERATIONS = ["cosmos.workspace"] as const;

/* ------------------------------------------------------------------ */
/* Cosmos objects (CosmosObjectStore)                                  */
/* ------------------------------------------------------------------ */

/**
 * The object an older provenance entry names in its text. Objects saved
 * before M17.2 carry no structured `ref`; their entries were written by
 * the store itself in a fixed form ("from obj_…", "out of obj_…", "into
 * obj_…"), so this reads that form and nothing looser.
 */
function legacyRef(detail: string): string | undefined {
  return /^(?:from|out of|into) (obj[_-][A-Za-z0-9_-]+)/.exec(detail)?.[1];
}

function provenanceOf(object: CosmosObject): NeuralProvenanceStep[] {
  return object.provenance.map((step) => {
    const ref = step.ref ?? legacyRef(step.detail);
    return { at: step.at, action: step.action, detail: step.detail, ...(ref ? { ref: NID.object(ref) } : {}) };
  });
}

function objectEntity(object: CosmosObject, trashed: boolean): NeuralEntity {
  return {
    id: NID.object(object.id),
    type: "object",
    label: object.name,
    authority: "cosmos.objects",
    sourceId: object.id,
    state: trashed ? "trashed" : object.locked ? "locked" : object.visible ? "active" : "hidden",
    spatial: {
      position: [...object.frame.position],
      rotation: [...object.frame.rotation],
      scale: object.frame.scale,
      space: object.parent ? NID.object(object.parent) : COSMOS_CORE_NID,
    },
    provenance: provenanceOf(object),
    operations: trashed ? [...TRASHED_OPERATIONS] : [...OBJECT_OPERATIONS],
    facts: { domain: object.domain, builder: object.builder, parts: object.partCount, place: object.place, motion: object.motion.kind },
    updatedAt: object.updatedAt,
  };
}

export function cosmosObjectsPartition(state: Pick<CosmosObjectState, "objects" | "trash" | "groups">): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  const known = new Set([...state.objects, ...state.trash].map((o) => o.id));
  const rel = (from: string, type: NeuralRelationType, to: string) => relations.push(relation(from, type, to, "cosmos.objects"));

  const add = (object: CosmosObject, trashed: boolean) => {
    const id = NID.object(object.id);
    entities.push(objectEntity(object, trashed));
    if (!trashed) {
      if (object.parent && known.has(object.parent)) rel(id, "attached-to", NID.object(object.parent));
      else if (object.place === "cosmos" || object.place === "gallery") rel(id, "located-in", COSMOS_CORE_NID);
      if (object.group && state.groups[object.group]) rel(id, "member-of", NID.group(object.group));
    }
    // Lineage, from structured provenance. A relation is only drawn to an
    // object the store still knows (live or in the trash) — never an orphan.
    const lineage = new Map<NeuralRelationType, string>();
    for (const step of object.provenance) {
      const ref = step.ref ?? legacyRef(step.detail);
      if (!ref || !known.has(ref)) continue;
      if (step.action === "duplicated") lineage.set("derived-from", ref);
      if (step.action === "extracted") lineage.set("extracted-from", ref);
    }
    for (const [type, ref] of lineage) {
      // Re-attached to the same parent since? Then it is attached, not extracted.
      if (type === "extracted-from" && object.parent === ref) continue;
      rel(id, type, NID.object(ref));
    }
    if (object.source?.artifactId) rel(id, "created-from", NID.record("artifact", object.source.artifactId));
  };

  for (const object of state.objects) add(object, false);
  for (const object of state.trash) add(object, true);

  for (const group of Object.values(state.groups)) {
    entities.push({
      id: NID.group(group.id),
      type: "group",
      label: group.name,
      authority: "cosmos.objects",
      sourceId: group.id,
      state: "active",
      provenance: [{ at: group.createdAt, action: "grouped", detail: `${group.members.length} object(s)` }],
      operations: ["cosmos.object.ungroup"],
      facts: { members: group.members.length },
      updatedAt: group.createdAt,
    });
  }

  // Records an object was made from: referenced, owned elsewhere.
  for (const r of relations) {
    if (r.type === "created-from" && !entities.some((e) => e.id === r.to)) {
      const artifactId = r.to.slice("record:artifact:".length);
      entities.push(referencedRecord("artifact", artifactId, `Artifact ${artifactId}`, "cosmos.objects"));
    }
  }
  return { authority: "cosmos.objects", entities, relations };
}

function referencedRecord(kind: string, id: string, label: string, by: NeuralEntity["authority"]): NeuralEntity {
  return {
    id: NID.record(kind, id),
    type: "record",
    label,
    authority: "referenced",
    sourceId: id,
    state: "referenced",
    provenance: [],
    operations: [],
    facts: { kind, referencedBy: by },
    updatedAt: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Cosmos places (CosmosNavigation)                                    */
/* ------------------------------------------------------------------ */

export function navigationPartition(nodes: NavNode[], archived: NavNode[] = []): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  const all = [...nodes, ...archived];
  const ids = new Set(all.map((n) => n.id));
  for (const node of all) {
    const id = NID.place(node.id);
    const type = node.level === "core" ? "cosmos-core" : node.level;
    entities.push({
      id,
      type,
      label: node.label,
      authority: "cosmos.navigation",
      sourceId: node.id,
      state: node.archived ? "archived" : "active",
      spatial: { position: [...node.position], ...(node.parentId ? { space: NID.place(node.parentId) } : {}) },
      provenance: [{ at: node.createdAt, action: node.origin === "system" ? "mirrored" : "created", detail: `by ${node.origin}` }],
      operations: node.level === "room" ? [...ROOM_OPERATIONS] : ["cosmos.workspace", "cosmos.map"],
      facts: { level: node.level, origin: node.origin, visits: node.visits, removable: node.removable },
      updatedAt: node.lastVisited ?? node.createdAt,
    });
    if (node.parentId && ids.has(node.parentId)) relations.push(relation(id, "part-of", NID.place(node.parentId), "cosmos.navigation"));
    // A "cosmos" ref is the map pointing at itself (the core): not a relationship.
    if (node.ref && node.ref.kind !== "cosmos") {
      const recordId = NID.record(node.ref.kind, node.ref.id);
      relations.push(relation(id, "references", recordId, "cosmos.navigation"));
      entities.push(referencedRecord(node.ref.kind, node.ref.id, `${node.ref.kind} ${node.label}`, "cosmos.navigation"));
    }
  }
  return { authority: "cosmos.navigation", entities: dedupe(entities), relations };
}

/* ------------------------------------------------------------------ */
/* Records placed in rooms (SpatialObjects)                            */
/* ------------------------------------------------------------------ */

export function placementsPartition(placed: PlacedRecord[]): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  for (const p of placed) {
    const id = NID.placement(p.id);
    entities.push({
      id,
      type: "placed-record",
      label: p.title,
      authority: "cosmos.placements",
      sourceId: p.id,
      state: "active",
      spatial: { position: [...p.position], space: NID.place(p.roomId) },
      provenance: [{ at: p.createdAt, action: "placed", detail: `${p.kind} in ${p.roomId}` }],
      operations: ["cosmos.inspect", "cosmos.workspace"],
      facts: { kind: p.kind, pinned: p.pinned },
      updatedAt: p.updatedAt,
    });
    relations.push(relation(id, "located-in", NID.place(p.roomId), "cosmos.placements"));
    relations.push(relation(id, "references", NID.record(p.link.kind, p.link.id), "cosmos.placements"));
    entities.push(referencedRecord(p.link.kind, p.link.id, p.title, "cosmos.placements"));
  }
  return { authority: "cosmos.placements", entities: dedupe(entities), relations };
}

/* ------------------------------------------------------------------ */
/* LÉLU's Room: authored objects (SpatialSceneGraph)                   */
/* ------------------------------------------------------------------ */

const v3 = (v: { x: number; y: number; z: number }): [number, number, number] => [v.x, v.y, v.z];

const ROOM_KIND: Record<string, NeuralRelationType> = { connected: "connected-to", orbits: "orbits", contains: "contains", aligned: "aligned-with" };

export function roomScenePartition(snapshot: Pick<SpatialSceneSnapshot, "objects" | "relationships">): NeuralPartition {
  const entities: NeuralEntity[] = snapshot.objects.map((o): NeuralEntity => ({
    id: NID.roomObject(o.id),
    type: "room-object",
    label: o.name,
    authority: "room.scene",
    sourceId: o.id,
    state: o.visible ? "active" : "hidden",
    spatial: { position: v3(o.transform.position), rotation: v3(o.transform.rotation), scale: o.transform.scale.x, space: ROOM_NID },
    provenance: [{ at: o.createdAt, action: "authored", detail: `${o.provenance} by ${o.createdBy}` }],
    operations: ["spatial.scene"],
    facts: { kind: o.kind, provenance: o.provenance },
    updatedAt: o.updatedAt,
  }));
  const ids = new Set(snapshot.objects.map((o) => o.id));
  const relations = snapshot.objects.map((o) => relation(NID.roomObject(o.id), "located-in", ROOM_NID, "room.scene"));
  for (const r of snapshot.relationships) {
    if (!ids.has(r.from) || !ids.has(r.to)) continue;
    relations.push(relation(NID.roomObject(r.from), ROOM_KIND[r.kind] ?? "connected-to", NID.roomObject(r.to), "room.scene"));
  }
  return { authority: "room.scene", entities, relations };
}

/* ------------------------------------------------------------------ */
/* Capabilities (ToolRegistry) and interfaces                          */
/* ------------------------------------------------------------------ */

/** The Cosmos-facing tools as capabilities. Which entity each operates is on the entity (`operations`). */
/** The tools an indexed entity can list as an operation (WP02 adds the other interfaces' authorities). */
export const CAPABILITY_TOOLS = /^(cosmos\.|interface\.(list|open|compose)$|neural\.|spatial\.|chats\.(list|read|link|merge)$|studio\.(open|read|list|export|restore|compare|revise)$|project\.manage$|sandbox\.(read|write)$|engineering\.remote$)/;

export function capabilitiesPartition(tools: ToolDefinition[]): NeuralPartition {
  const wanted = tools.filter((t) => CAPABILITY_TOOLS.test(t.id));
  const entities: NeuralEntity[] = wanted.map((t) => ({
    id: NID.capability(t.id),
    type: "capability",
    label: t.name,
    authority: "tools",
    sourceId: t.id,
    state: t.available ? "active" : "hidden",
    provenance: [],
    operations: [],
    facts: { category: t.category, risk: t.riskLevel, permissions: t.permissions.join("+") },
    updatedAt: 0,
  }));
  return { authority: "tools", entities, relations: [] };
}

export function interfacesPartition(catalog: readonly InterfaceEntry[], compositions: InterfaceComposition[]): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  for (const i of catalog) {
    entities.push({
      id: NID.interface(i.id),
      type: "interface",
      label: i.name,
      authority: "interfaces",
      sourceId: i.id,
      state: "active",
      provenance: [{ at: 0, action: "catalogued", detail: i.source }],
      operations: ["interface.open", "interface.compose"],
      facts: { category: i.category, webgl: i.webgl },
      updatedAt: 0,
    });
  }
  // The Cosmos interface presents the Cosmos core.
  if (catalog.some((i) => i.id === "cosmos")) relations.push(relation(NID.interface("cosmos"), "presents", COSMOS_CORE_NID, "interfaces"));
  for (const c of compositions) {
    const id = NID.composition(c.id);
    entities.push({
      id,
      type: "composition",
      label: c.name,
      authority: "interfaces",
      sourceId: c.id,
      state: "active",
      provenance: c.lineage.map((l) => ({ at: c.createdAt, action: l.how, detail: l.name, ref: NID.composition(l.id) })),
      operations: ["interface.open", "interface.compose"],
      facts: { regions: c.regions.length, flow: c.flow, builtIn: c.builtIn },
      updatedAt: c.updatedAt,
    });
    for (const iid of new Set(c.regions.map((r) => r.interfaceId))) relations.push(relation(id, "presents", NID.interface(iid), "interfaces"));
    if (c.parentId && compositions.some((x) => x.id === c.parentId)) relations.push(relation(id, "derived-from", NID.composition(c.parentId), "interfaces"));
  }
  return { authority: "interfaces", entities, relations };
}

/* ------------------------------------------------------------------ */
/* WP02 — the authorities behind the other interfaces                  */
/* ------------------------------------------------------------------ */

/** Conversations (MultiChatStore) — what Chat Universe shows. */
export function conversationsPartition(conversations: ChatConversation[]): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  const ids = new Set(conversations.map((c) => c.id));
  for (const c of conversations) {
    const id = NID.conversation(c.id);
    // Merged chats carry each message's origin: that is real lineage.
    const origins = [...new Set(c.messages.map((m) => m.origin?.conversationId).filter((o): o is string => !!o && o !== c.id))];
    entities.push({
      id,
      type: "conversation",
      label: c.title || "Untitled chat",
      authority: "chats",
      sourceId: c.id,
      state: c.archived ? "archived" : "active",
      provenance: [
        { at: c.createdAt, action: "started", detail: `${c.messages.length} message(s)` },
        ...origins.map((o) => ({ at: c.createdAt, action: "merged", detail: `messages from ${o}`, ref: NID.conversation(o) })),
      ],
      operations: ["chats.read", "chats.link"],
      facts: { messages: c.messages.length, pinned: c.pinned, topic: c.topic || "—", tags: c.tags.join(", ") || "—" },
      updatedAt: c.updatedAt,
    });
    for (const o of origins) if (ids.has(o)) relations.push(relation(id, "created-from", NID.conversation(o), "chats"));
    for (const l of c.linkedIds) if (ids.has(l) && l !== c.id) relations.push(relation(id, "connected-to", NID.conversation(l), "chats"));
    if (c.projectId) {
      relations.push(relation(id, "part-of", NID.project(c.projectId), "chats"));
      entities.push(referencedRecord("project", c.projectId, `Project ${c.projectId}`, "chats"));
    }
  }
  return { authority: "chats", entities: dedupe(entities), relations: dedupeRelations(relations) };
}

/** Artifacts (StudioStore) — what Creation Studio and the Creative Kit make. */
export function artifactsPartition(artifacts: StudioArtifact[]): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  for (const a of artifacts) {
    const id = NID.artifact(a.id);
    const latest = a.revisions.at(-1);
    entities.push({
      id,
      type: "artifact",
      label: a.title,
      authority: "studio",
      sourceId: a.id,
      state: "active",
      provenance: [
        ...a.revisions.map((r) => ({ at: r.at, action: r.rev === 1 ? "created" : "revised", detail: `r${r.rev} by ${r.by}${r.note ? ` — ${r.note}` : ""}` })),
        ...a.exports.slice(-6).map((e) => ({ at: e.at, action: "exported", detail: `r${e.rev} ${e.filename} ${e.ok ? "verified" : "failed"}` })),
      ].sort((x, y) => x.at - y.at),
      operations: ["studio.open", "studio.read"],
      facts: { kind: a.kind, revisions: latest?.rev ?? 0, exports: a.exports.length, ...(a.original ? { imported: a.original.name } : {}) },
      updatedAt: a.updatedAt,
    });
    if (a.conversationId) {
      relations.push(relation(id, "created-from", NID.conversation(a.conversationId), "studio"));
      entities.push(referencedRecord("conversation", a.conversationId, `Chat ${a.conversationId}`, "studio"));
    }
  }
  return { authority: "studio", entities: dedupe(entities), relations };
}

/** Projects (ProjectStore) — the Files / projects workspace. */
export function projectsPartition(projects: LeluProject[]): NeuralPartition {
  const entities: NeuralEntity[] = projects.map((p) => ({
    id: NID.project(p.id),
    type: "project",
    label: p.name,
    authority: "projects",
    sourceId: p.id,
    state: p.status === "archived" ? "archived" : "active",
    provenance: [
      { at: p.createdAt, action: "created", detail: p.description || p.name },
      ...p.items.slice(-10).map((i) => ({ at: i.createdAt, action: `added ${i.kind}`, detail: i.title })),
    ],
    operations: ["project.manage"],
    facts: { status: p.status, items: p.items.length, agents: p.agentIds.length, ...(p.objective ? { objective: p.objective } : {}), ...(p.location ? { subsystem: p.location } : {}) },
    updatedAt: p.updatedAt,
  }));
  return { authority: "projects", entities, relations: [] };
}

/** The engineering sandbox's files (SandboxFS) — the Code workspace. */
export function sandboxPartition(nodes: SandboxNode[]): NeuralPartition {
  const entities: NeuralEntity[] = [];
  const relations: NeuralRelation[] = [];
  const paths = new Set(nodes.map((n) => n.path));
  for (const n of nodes) {
    const id = NID.sandbox(n.path);
    const name = n.path.split("/").filter(Boolean).at(-1) ?? n.path;
    entities.push({
      id,
      type: n.type === "dir" ? "folder" : "file",
      label: name,
      authority: "sandbox",
      sourceId: n.path,
      state: "active",
      provenance: [],
      operations: n.type === "file" ? ["sandbox.read", "sandbox.write"] : [],
      facts: { path: n.path },
      updatedAt: 0,
    });
    const parent = n.path.split("/").filter(Boolean).slice(0, -1).join("/");
    if (parent && paths.has(parent)) relations.push(relation(id, "part-of", NID.sandbox(parent), "sandbox"));
  }
  return { authority: "sandbox", entities, relations };
}

/**
 * The Home (its own catalog, app/scene/genesis/home/homeCatalog.ts): the
 * Home itself, every app it lists, and the interfaces it offers as
 * destinations. `aliases` names an app that IS an interface (the
 * "LÉLU's Room" app is the lelu-room interface) — a fact of the catalog.
 */
export function homePartition(
  apps: Array<{ id: string; label: string; hint: string; group: string; operations?: string[] }>,
  interfaceIds: readonly string[],
  aliases: Record<string, string> = {},
): NeuralPartition {
  const home = NID.app("home");
  const entities: NeuralEntity[] = [
    {
      id: home,
      type: "app",
      label: "Home",
      authority: "home",
      sourceId: "home",
      state: "active",
      provenance: [],
      operations: ["interface.list", "interface.open"],
      facts: { apps: apps.length, destinations: interfaceIds.length },
      updatedAt: 0,
    },
  ];
  const relations: NeuralRelation[] = [];
  for (const a of apps) {
    const id = NID.app(a.id);
    entities.push({ id, type: "app", label: a.label, authority: "home", sourceId: a.id, state: "active", provenance: [], operations: [...(a.operations ?? [])], facts: { group: a.group, hint: a.hint }, updatedAt: 0 });
    relations.push(relation(home, "presents", id, "home"));
    // The tools this app runs its work through (stated by the app's own entry).
    for (const tool of a.operations ?? []) relations.push(relation(id, "operated-by", NID.capability(tool), "home"));
    const alias = aliases[a.id];
    if (alias && interfaceIds.includes(alias)) relations.push(relation(id, "presents", NID.interface(alias), "home"));
  }
  for (const i of interfaceIds) relations.push(relation(home, "presents", NID.interface(i), "home"));
  return { authority: "home", entities, relations };
}

function dedupeRelations(relations: NeuralRelation[]): NeuralRelation[] {
  return [...new Map(relations.map((r) => [r.id, r])).values()];
}

function dedupe(entities: NeuralEntity[]): NeuralEntity[] {
  const seen = new Map<string, NeuralEntity>();
  for (const e of entities) if (!seen.has(e.id)) seen.set(e.id, e);
  return [...seen.values()];
}
