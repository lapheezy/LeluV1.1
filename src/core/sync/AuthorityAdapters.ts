/**
 * ==========================================================
 * LÉLU — CONTINUITY AUTHORITY ADAPTERS
 *
 * One thin adapter per existing authority. The adapter reads the
 * canonical records and applies a reconciled record back through the
 * authority's own merge/update path. It never keeps a copy.
 *
 * Authorities whose schema cannot be safely merged are explicit:
 * `merge` returns null and the conflict remains visible.
 * ==========================================================
 */

import ProjectStore, { type LeluProject } from "../projects/ProjectStore";
import MultiChatStore, { type ChatConversation, type ChatMessage } from "../multichat/MultiChatStore";
import KnowledgeLibrary, { type KnowledgeEntry } from "../cognition/KnowledgeLibrary";
import SpatialObjects, { type SpatialObject } from "../cosmos/SpatialObjects";
import CosmosNavigation, { type NavNode } from "../cosmos/CosmosNavigation";
import KnowledgeGraph, { type PersistedKnowledgeGraphEnvelope } from "../cognition/KnowledgeGraph";
import type {
  ContinuityAuthority,
  ContinuityRecord,
} from "./ContinuityTypes";

export interface ApplyOptions {
  force?: boolean;
}

export interface AuthorityAdapter {
  authority: ContinuityAuthority;
  label: string;
  read(): ContinuityRecord[];
  apply(record: ContinuityRecord, options?: ApplyOptions): void;
  /** Only return a merged record when the merge is semantically safe. */
  merge(local: ContinuityRecord, cloud: ContinuityRecord): ContinuityRecord | null;
}

function record(id: string, updatedAt: number, data: unknown, deleted?: boolean): ContinuityRecord {
  return { id, updatedAt, data, ...(deleted !== undefined ? { deleted } : {}) };
}

function asProject(value: unknown): LeluProject | null {
  if (!value || typeof value !== "object") return null;
  const project = value as Partial<LeluProject>;
  return project.id && project.name ? project as LeluProject : null;
}

function asConversation(value: unknown): ChatConversation | null {
  if (!value || typeof value !== "object") return null;
  const conversation = value as Partial<ChatConversation>;
  return conversation.id && Array.isArray(conversation.messages) ? conversation as ChatConversation : null;
}

function asKnowledge(value: unknown): KnowledgeEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Partial<KnowledgeEntry>;
  return entry.id && entry.title ? entry as KnowledgeEntry : null;
}

function asSpatial(value: unknown): SpatialObject | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Partial<SpatialObject>;
  return object.id && object.link && object.link.id ? object as SpatialObject : null;
}

function messageKey(message: ChatMessage): string {
  return `${message.id}\u0000${message.role}\u0000${message.timestamp}`;
}

/**
 * Messages are append-only records with stable ids. A concurrent
 * conversation edit is safe to merge by message identity, keeping the
 * later conversation metadata. This is the one automatic merge the
 * mission allows by default.
 */
export function mergeConversationRecords(
  local: ChatConversation,
  cloud: ChatConversation,
): ChatConversation {
  const byKey = new Map<string, ChatMessage>();
  for (const message of cloud.messages) byKey.set(messageKey(message), message);
  for (const message of local.messages) {
    const existing = byKey.get(messageKey(message));
    // The local copy is the fresher one for the same identity; a longer
    // streaming reply wins over a truncated equivalent.
    if (!existing || message.text.length >= existing.text.length) {
      byKey.set(messageKey(message), message);
    }
  }
  const newer = local.updatedAt >= cloud.updatedAt ? local : cloud;
  const older = local.updatedAt >= cloud.updatedAt ? cloud : local;
  return {
    ...older,
    ...newer,
    id: local.id,
    messages: [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp),
    createdAt: Math.min(local.createdAt, cloud.createdAt),
    updatedAt: Math.max(local.updatedAt, cloud.updatedAt),
  };
}

const projects: AuthorityAdapter = {
  authority: "projects",
  label: "Projects",
  read: () => ProjectStore.getInstance().list().map((project) =>
    record(project.id, project.updatedAt, project)),
  apply: (entry, options) => {
    const project = asProject(entry.data);
    if (!project) return;
    ProjectStore.getInstance().applyRemote(project, { force: options?.force });
  },
  // Two different project edits have no field-level authority. Preserve
  // both as a visible conflict rather than inventing a merge.
  merge: () => null,
};

const conversations: AuthorityAdapter = {
  authority: "conversations",
  label: "Conversations and messages",
  read: () => MultiChatStore.getInstance().listAll().map((conversation) =>
    record(conversation.id, conversation.updatedAt, conversation)),
  apply: (entry, options) => {
    const conversation = asConversation(entry.data);
    if (!conversation) return;
    MultiChatStore.getInstance().applyRemote(conversation, { force: options?.force });
  },
  merge: (local, cloud) => {
    const left = asConversation(local.data);
    const right = asConversation(cloud.data);
    if (!left || !right) return null;
    const merged = mergeConversationRecords(left, right);
    return record(merged.id, merged.updatedAt, merged);
  },
};

const knowledge: AuthorityAdapter = {
  authority: "knowledge",
  label: "Knowledge library",
  read: () => KnowledgeLibrary.getInstance().list().map((entry) =>
    record(entry.id, entry.updatedAt, entry)),
  apply: (entry, options) => {
    const item = asKnowledge(entry.data);
    if (!item) return;
    KnowledgeLibrary.getInstance().applyRemote(item, { force: options?.force });
  },
  // Knowledge entries have one canonical identity and free-text fields.
  // There is no field-level provenance that makes a blind field merge safe.
  merge: () => null,
};

const spatialObjects: AuthorityAdapter = {
  authority: "spatialObjects",
  label: "Cosmos spatial objects",
  read: () => SpatialObjects.getInstance().list().map((object) =>
    record(object.id, object.updatedAt, object)),
  apply: (entry, options) => {
    if (entry.deleted) {
      SpatialObjects.getInstance().remove(entry.id);
      return;
    }
    const object = asSpatial(entry.data);
    if (!object) return;
    SpatialObjects.getInstance().applyRemote(object, { force: options?.force });
  },
  // Two transforms of the same object are a real conflict. The scene keeps
  // both revisions in the conflict record until the user chooses.
  merge: () => null,
};

const cosmosNavigation: AuthorityAdapter = {
  authority: "cosmosNavigation",
  label: "Cosmos rooms and navigation",
  read: () => {
    const rooms = CosmosNavigation.getInstance().allRooms();
    const updatedAt = rooms.reduce((max, room) => Math.max(max, room.lastVisited ?? room.createdAt), 0);
    return [record("rooms", updatedAt, rooms.map((room) => ({ ...room, deleted: room.archived })))];
  },
  apply: (entry) => {
    if (!Array.isArray(entry.data)) return;
    const rooms = entry.data
      .filter((item): item is NavNode & { deleted?: boolean } => Boolean(item && typeof item === "object" && (item as NavNode).id))
      .map((item) => ({ ...item, archived: item.deleted === true || item.archived === true }));
    CosmosNavigation.getInstance().applyRemoteRooms(rooms);
  },
  // Room registrations are additive records with stable ids. Merging the
  // union is safe; a room's own metadata never resolves another room.
  merge: (local, cloud) => {
    if (!Array.isArray(local.data) || !Array.isArray(cloud.data)) return null;
    const byId = new Map<string, NavNode & { deleted?: boolean }>();
    for (const item of cloud.data as Array<NavNode & { deleted?: boolean }>) {
      if (item && item.id) byId.set(item.id, item);
    }
    for (const item of local.data as Array<NavNode & { deleted?: boolean }>) {
      if (item && item.id) byId.set(item.id, item);
    }
    const rooms = [...byId.values()];
    const updatedAt = Math.max(local.updatedAt, cloud.updatedAt);
    return record("rooms", updatedAt, rooms);
  },
};

const knowledgeGraph: AuthorityAdapter = {
  authority: "knowledgeGraph",
  label: "Local cognition knowledge graph",
  read: () => {
    const envelope = KnowledgeGraph.readPersistedEnvelope();
    if (!envelope) return [];
    return [record("graph", envelope.updatedAt, envelope)];
  },
  apply: (entry) => {
    if (!entry.data || typeof entry.data !== "object") return;
    KnowledgeGraph.applyPersistedEnvelope(entry.data as PersistedKnowledgeGraphEnvelope);
  },
  // Node/edge identity is stable, but two edits to the same node have no
  // field-level merge authority. Preserve the conflict; never replace the
  // graph wholesale just because one side's timestamp is later.
  merge: () => null,
};

export const AUTHORITY_ADAPTERS: readonly AuthorityAdapter[] = [
  projects,
  conversations,
  knowledge,
  knowledgeGraph,
  spatialObjects,
  cosmosNavigation,
];

export function adapterFor(authority: ContinuityAuthority): AuthorityAdapter {
  const adapter = AUTHORITY_ADAPTERS.find((item) => item.authority === authority);
  if (!adapter) throw new Error(`No continuity adapter for ${authority}`);
  return adapter;
}
