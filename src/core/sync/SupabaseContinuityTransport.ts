/**
 * ==========================================================
 * LÉLU — SUPABASE CONTINUITY TRANSPORT (OPTIONAL)
 *
 * This adapter is only constructed by the runtime; it opens no
 * connection of its own and returns `authentication_required`
 * until the existing SupabasePersistence session is connected.
 *
 * Tables that already exist keep their existing cloud
 * representation. Authorities that had no cloud table before use
 * a single per-user document in the existing `user_preferences`
 * table, never a new table or a second database.
 *
 * Every update is conditional on the `updated_at` value the client
 * actually observed. If the condition does not match, the write is
 * refused and returned as a conflict for explicit resolution.
 * ==========================================================
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import SupabasePersistence, { MESSAGE_TEXT_LIMIT } from "../persistence/SupabasePersistence";
import type { LeluProject } from "../projects/ProjectStore";
import type { ChatConversation, ChatMessage } from "../multichat/MultiChatStore";
import type { KnowledgeEntry } from "../cognition/KnowledgeLibrary";
import type { SpatialObject } from "../cosmos/SpatialObjects";
import type { NavNode } from "../cosmos/CosmosNavigation";
import type { PersistedKnowledgeGraphEnvelope } from "../cognition/KnowledgeGraph";
import {
  continuityContentHash,
  type ContinuityAuthority,
  type ContinuityOutboxOperation,
  type ContinuityPullResult,
  type ContinuityPushResult,
  type ContinuityRecord,
  type ContinuityTransport,
} from "./ContinuityTypes";

type Row = Record<string, any>;

type ContinuitySession = { client: SupabaseClient; userId: string };
type SessionProvider = () => ContinuitySession | null;

const DOC_FORMAT = "lelu.continuity.doc.v1";
const REVISION_PREFIX = "rev:";
const TIMESTAMP_PREFIX = "ts:";

const DOC_KEYS: Partial<Record<ContinuityAuthority, string>> = {
  knowledgeGraph: "lelu_sync_knowledge_graph",
  spatialObjects: "lelu_sync_spatial_objects",
  cosmosNavigation: "lelu_sync_cosmos_rooms",
};

interface DocumentValue {
  format: typeof DOC_FORMAT;
  updatedAt: number;
  records: ContinuityRecord[];
}

function iso(value: number): string {
  return new Date(value || Date.now()).toISOString();
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.parse(String(value)) || Date.now();
}

/**
 * A strict revision token. `continuity_revision` is written only by the
 * database trigger in migration 20261123094156 (applied to production as that version); `updated_at` is retained as a
 * compatibility fallback for a project that has not applied that migration.
 */
function cloudRevisionOf(row: Row): string {
  if (row?.continuity_revision != null && Number.isFinite(Number(row.continuity_revision))) {
    return `${REVISION_PREFIX}${Number(row.continuity_revision)}`;
  }
  return `${TIMESTAMP_PREFIX}${String(row?.updated_at ?? "")}`;
}

function hasStrictRevision(row: Row | null | undefined): boolean {
  return Boolean(row && row.continuity_revision != null && Number.isFinite(Number(row.continuity_revision)));
}

/** M14.4 stored plain `updated_at` strings, so they remain valid bases. */
function expectedMatches(expected: string | null, row: Row): boolean {
  if (!expected) return false;
  if (expected === cloudRevisionOf(row)) return true;
  if (expected === `${TIMESTAMP_PREFIX}${String(row.updated_at ?? "")}`) return true;
  if (!expected.startsWith(REVISION_PREFIX) && !expected.startsWith(TIMESTAMP_PREFIX)) {
    return expected === String(row.updated_at ?? "");
  }
  return false;
}

function recordHash(record: ContinuityRecord): string {
  // The row mapper materializes optional project arrays that a locally
  // created project does not carry. They are representation defaults, not
  // content, so both sides compare without them.
  let data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const copy = { ...(data as Row) };
    for (const key of ["actionableTasks", "executionPlan"]) {
      if (Array.isArray(copy[key]) && copy[key].length === 0) delete copy[key];
    }
    data = copy;
  }
  return continuityContentHash(data, record.deleted === true);
}

function failure(error: unknown, label: string): Extract<ContinuityPushResult, { status: "authentication_required" | "cloud_unavailable" | "retry_required" }> {
  const value = error as { message?: string; code?: string; status?: number } | null;
  const message = value?.message ?? String(error);
  const status = value?.status;
  const code = value?.code ?? "";
  if (status === 401 || status === 403 || code === "PGRST301" || code === "42501" || /jwt|not authenticated|permission denied/i.test(message)) {
    return { status: "authentication_required", reason: `${label}: ${message}` };
  }
  if (/failed to fetch|network|timeout|abort/i.test(message)) {
    return { status: "cloud_unavailable", reason: `${label}: ${message}` };
  }
  return { status: "retry_required", reason: `${label}: ${message}`, retryAfterMs: 2_000 };
}

/** `updated_at` must advance even on a project without the revision column. */
function nextTimestamp(previous: unknown): string {
  const parsed = typeof previous === "string" || typeof previous === "number" ? Date.parse(String(previous)) : NaN;
  return new Date(Math.max(Date.now(), Number.isFinite(parsed) ? parsed + 1 : 0)).toISOString();
}

function projectRow(project: LeluProject, userId: string): Row {
  return {
    id: project.id,
    user_id: userId,
    name: project.name,
    description: project.description,
    status: project.status,
    agent_ids: project.agentIds,
    items: project.items,
    queries: project.queries ?? [],
    schedule: project.schedule ?? null,
    metadata: {
      originalRequest: project.originalRequest ?? null,
      objective: project.objective ?? null,
      context: project.context ?? null,
      actionableTasks: project.actionableTasks ?? [],
      priority: project.priority ?? null,
      location: project.location ?? null,
      executionPlan: project.executionPlan ?? [],
    },
    created_at: iso(project.createdAt),
    // This is the revision the conditional update compares.
    updated_at: iso(project.updatedAt),
  };
}

function projectFromRow(row: Row): LeluProject {
  const metadata = row.metadata ?? {};
  return {
    id: String(row.id),
    name: String(row.name ?? "Untitled"),
    description: String(row.description ?? ""),
    status: row.status ?? "active",
    agentIds: Array.isArray(row.agent_ids) ? row.agent_ids : [],
    items: Array.isArray(row.items) ? row.items : [],
    queries: Array.isArray(row.queries) ? row.queries : [],
    ...(row.schedule ? { schedule: row.schedule } : {}),
    ...(metadata.originalRequest != null ? { originalRequest: metadata.originalRequest } : {}),
    ...(metadata.objective != null ? { objective: metadata.objective } : {}),
    ...(metadata.context != null ? { context: metadata.context } : {}),
    ...(Array.isArray(metadata.actionableTasks) ? { actionableTasks: metadata.actionableTasks } : {}),
    ...(metadata.priority != null ? { priority: metadata.priority } : {}),
    ...(metadata.location != null ? { location: metadata.location } : {}),
    ...(Array.isArray(metadata.executionPlan) ? { executionPlan: metadata.executionPlan } : {}),
    createdAt: number(row.created_at),
    updatedAt: number(row.updated_at),
  } as LeluProject;
}

function conversationRow(conversation: ChatConversation, userId: string): Row {
  return {
    id: conversation.id,
    user_id: userId,
    title: conversation.title,
    project_id: conversation.projectId,
    metadata: {
      pinned: conversation.pinned,
      archived: conversation.archived,
      linkedIds: conversation.linkedIds,
      tags: conversation.tags,
      topic: conversation.topic,
      unread: conversation.unread,
      processing: conversation.processing,
    },
    created_at: iso(conversation.createdAt),
    updated_at: iso(conversation.updatedAt),
  };
}

function messageRows(conversation: ChatConversation, userId: string): Row[] {
  return conversation.messages.map((message) => {
    const truncated = message.text.length > MESSAGE_TEXT_LIMIT;
    return {
      id: message.id,
      user_id: userId,
      conversation_id: conversation.id,
      role: message.role,
      text: truncated ? message.text.slice(0, MESSAGE_TEXT_LIMIT) : message.text,
      provider: message.provider ?? null,
      confidence: message.confidence ?? null,
      metadata: {
        source: message.source,
        reasoning: message.reasoning,
        plan: message.plan,
        ...(truncated ? { truncated: true, originalLength: message.text.length } : {}),
      },
      created_at: iso(message.timestamp),
    };
  });
}

function messageFromRow(row: Row): ChatMessage {
  return {
    id: String(row.id),
    role: row.role,
    text: String(row.text ?? ""),
    timestamp: number(row.created_at),
    source: row.provider ? "ai" : "local",
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    ...(row.metadata?.reasoning ? { reasoning: row.metadata.reasoning } : {}),
    ...(row.metadata?.plan ? { plan: row.metadata.plan } : {}),
  };
}

function conversationFromRow(row: Row, messages: Row[]): ChatConversation {
  const metadata = row.metadata ?? {};
  return {
    id: String(row.id),
    title: String(row.title ?? "New chat"),
    messages: messages
      .filter((message) => message.conversation_id === row.id)
      .map(messageFromRow)
      .sort((a, b) => a.timestamp - b.timestamp),
    createdAt: number(row.created_at),
    updatedAt: number(row.updated_at),
    pinned: Boolean(metadata.pinned),
    archived: Boolean(metadata.archived),
    linkedIds: Array.isArray(metadata.linkedIds) ? metadata.linkedIds : [],
    projectId: row.project_id ?? null,
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    topic: metadata.topic ?? "",
    unread: Number(metadata.unread ?? 0),
    processing: Boolean(metadata.processing),
  };
}

function knowledgeRow(entry: KnowledgeEntry, userId: string): Row {
  return {
    id: entry.id,
    user_id: userId,
    title: entry.title,
    domain: entry.domain,
    detail: entry.detail.slice(0, 4000),
    source: entry.source ?? null,
    metadata: { status: entry.status },
    created_at: iso(entry.updatedAt),
    updated_at: iso(entry.updatedAt),
  };
}

function knowledgeFromRow(row: Row): KnowledgeEntry {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    domain: row.domain,
    detail: String(row.detail ?? ""),
    status: row.metadata?.status ?? "learned",
    ...(row.source ? { source: row.source } : {}),
    updatedAt: number(row.updated_at),
  } as KnowledgeEntry;
}

export default class SupabaseContinuityTransport implements ContinuityTransport {
  public readonly kind = "supabase" as const;

  /**
   * The provider seam lets the real-cloud harness use an independently
   * authenticated client without fabricating a SupabasePersistence session.
   * Production uses the singleton session.
   */
  constructor(
    private readonly sessionProvider: SessionProvider = () => SupabasePersistence.getInstance().continuitySession(),
  ) {}

  private session(): ContinuitySession | null {
    return this.sessionProvider();
  }

  public availability(): "ready" | "authentication_required" | "cloud_unavailable" {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    if (nav?.onLine === false) return "cloud_unavailable";
    return this.session() ? "ready" : "authentication_required";
  }

  public async push(operation: ContinuityOutboxOperation): Promise<ContinuityPushResult> {
    const session = this.session();
    if (!session) return { status: "authentication_required", reason: "No authenticated Supabase session." };
    try {
      if (operation.authority === "projects") {
        const project = operation.payload.data as LeluProject;
        return await this.upsertRow(session, "projects", project.id, projectRow(project, session.userId), operation);
      }
      if (operation.authority === "conversations") {
        const conversation = operation.payload.data as ChatConversation;
        return await this.upsertRow(
          session,
          "conversations",
          conversation.id,
          conversationRow(conversation, session.userId),
          operation,
        );
      }
      if (operation.authority === "knowledge") {
        const entry = operation.payload.data as KnowledgeEntry;
        return await this.upsertRow(session, "knowledge_items", entry.id, knowledgeRow(entry, session.userId), operation);
      }
      if (DOC_KEYS[operation.authority]) {
        return await this.pushDocument(session, operation);
      }
      return { status: "retry_required", reason: `No Supabase continuity mapping for ${operation.authority}.` };
    } catch (error) {
      return failure(error, operation.authority);
    }
  }

  public async pull(authority: ContinuityAuthority): Promise<ContinuityPullResult> {
    const session = this.session();
    if (!session) return { records: [] };
    if (authority === "projects") {
      const { data, error } = await session.client.from("projects").select("*").eq("user_id", session.userId);
      if (error) throw error;
      return {
        records: (data ?? []).map((row) => ({
          id: String(row.id),
          updatedAt: number(row.updated_at),
          data: projectFromRow(row),
          cloudRevision: cloudRevisionOf(row),
        })),
      };
    }
    if (authority === "conversations") {
      const [{ data: rows, error }, { data: messages, error: messageError }] = await Promise.all([
        session.client.from("conversations").select("*").eq("user_id", session.userId),
        session.client.from("messages").select("*").eq("user_id", session.userId),
      ]);
      if (error) throw error;
      if (messageError) throw messageError;
      return {
        records: (rows ?? []).map((row) => ({
          id: String(row.id),
          updatedAt: number(row.updated_at),
          data: conversationFromRow(row, messages ?? []),
          cloudRevision: cloudRevisionOf(row),
        })),
      };
    }
    if (authority === "knowledge") {
      const { data, error } = await session.client.from("knowledge_items").select("*").eq("user_id", session.userId);
      if (error) throw error;
      return {
        records: (data ?? []).map((row) => ({
          id: String(row.id),
          updatedAt: number(row.updated_at),
          data: knowledgeFromRow(row),
          cloudRevision: cloudRevisionOf(row),
        })),
      };
    }
    const key = DOC_KEYS[authority];
    if (!key) return { records: [] };
    const { data, error } = await session.client
      .from("user_preferences")
      .select("*")
      .eq("user_id", session.userId)
      .eq("preference_key", key)
      .maybeSingle();
    if (error) throw error;
    if (!data?.value || typeof data.value !== "object") return { records: [] };
    const document = data.value as Partial<DocumentValue>;
    if (document.format !== DOC_FORMAT || !Array.isArray(document.records)) return { records: [] };
    return {
      records: document.records.map((record) => ({
        ...record,
        cloudRevision: cloudRevisionOf(data),
      })),
    };
  }

  private conditional(query: any, existing: Row): any {
    if (hasStrictRevision(existing)) {
      return query.eq("continuity_revision", Number(existing.continuity_revision));
    }
    return query.eq("updated_at", existing.updated_at);
  }

  private revisionSelect(existing: Row): string {
    return hasStrictRevision(existing)
      ? "continuity_revision, updated_at"
      : "updated_at";
  }

  private async syncMessages(
    session: ContinuitySession,
    conversation: ChatConversation,
    ignoreDuplicates = false,
  ): Promise<{ message: string } | null> {
    const messages = messageRows(conversation, session.userId);
    if (messages.length === 0) return null;
    const { error } = await session.client
      .from("messages")
      .upsert(messages, {
        onConflict: "id,user_id",
        ...(ignoreDuplicates ? { ignoreDuplicates: true } : {}),
      });
    return error ? { message: error.message } : null;
  }

  private async upsertRow(
    session: ContinuitySession,
    table: string,
    id: string,
    row: Row,
    operation: ContinuityOutboxOperation,
  ): Promise<ContinuityPushResult> {
    const { data: existing, error: readError } = await session.client
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("user_id", session.userId)
      .maybeSingle();
    if (readError) return failure(readError, table);

    const localHash = recordHash(operation.payload);

    if (existing) {
      const remote = await this.remoteRecord(session, table, existing);
      const remoteHash = recordHash(remote);

      if (operation.type === "delete") {
        if (!expectedMatches(operation.expectedCloudRevision, existing)) {
          return {
            status: "conflict",
            cloudRevision: cloudRevisionOf(existing),
            remote,
            reason: "The cloud row changed after this device's last synchronized revision.",
          };
        }
        const query = this.conditional(
          session.client.from(table).delete().eq("id", id).eq("user_id", session.userId),
          existing,
        );
        const { data: deleted, error } = await query.select("id");
        if (error) return failure(error, table);
        if (!Array.isArray(deleted) || deleted.length === 0) {
          return {
            status: "conflict",
            cloudRevision: cloudRevisionOf(existing),
            remote,
            reason: "The conditional delete matched no row; another device changed it.",
          };
        }
        return { status: "applied", cloudRevision: `deleted:${cloudRevisionOf(existing)}` };
      }

      // A repeated delivery of an already-applied operation is successful,
      // not a conflict. This is the real lost-acknowledgement case: an
      // insert leaves `expected === null`, and an update leaves the old
      // base revision even though the new content is already in the row.
      if (remoteHash === localHash) {
        if (table === "conversations") {
          const messageError = await this.syncMessages(session, operation.payload.data as ChatConversation, true);
          if (messageError) return failure(messageError, "messages");
        }
        return { status: "applied", cloudRevision: cloudRevisionOf(existing) };
      }

      if (!expectedMatches(operation.expectedCloudRevision, existing)) {
        return {
          status: "conflict",
          cloudRevision: cloudRevisionOf(existing),
          remote,
          reason: "The cloud row changed after this device's last synchronized revision.",
        };
      }

      const update = { ...row };
      delete update.continuity_revision;
      if (!hasStrictRevision(existing)) update.updated_at = nextTimestamp(existing.updated_at);
      const query = this.conditional(
        session.client.from(table).update(update).eq("id", id).eq("user_id", session.userId),
        existing,
      );
      const { data, error } = await query.select(this.revisionSelect(existing)).maybeSingle();
      if (error) return failure(error, table);
      if (!data) {
        return {
          status: "conflict",
          cloudRevision: cloudRevisionOf(existing),
          remote,
          reason: "The conditional update matched no row; another device changed it.",
        };
      }
      if (table === "conversations") {
        const messageError = await this.syncMessages(session, operation.payload.data as ChatConversation);
        if (messageError) return failure(messageError, "messages");
      }
      return { status: "applied", cloudRevision: cloudRevisionOf(data) };
    }

    if (operation.type === "delete") return { status: "applied", cloudRevision: "deleted" };
    if (operation.expectedCloudRevision !== null) {
      return {
        status: "conflict",
        cloudRevision: null,
        remote: null,
        reason: "The expected cloud row no longer exists.",
      };
    }

    const insert = { ...row };
    delete insert.continuity_revision;
    const { data, error } = await session.client
      .from(table)
      .insert(insert)
      .select("*")
      .maybeSingle();
    if (error) {
      // A duplicate id after a lost insert acknowledgement is idempotent
      // when the cloud content matches this exact payload.
      if (error.code === "23505") {
        const { data: raced } = await session.client
          .from(table)
          .select("*")
          .eq("id", id)
          .eq("user_id", session.userId)
          .maybeSingle();
        if (raced) {
          const remote = await this.remoteRecord(session, table, raced);
          if (recordHash(remote) === localHash) {
            if (table === "conversations") {
              const messageError = await this.syncMessages(session, operation.payload.data as ChatConversation, true);
              if (messageError) return failure(messageError, "messages");
            }
            return { status: "applied", cloudRevision: cloudRevisionOf(raced) };
          }
        }
        return {
          status: "conflict",
          cloudRevision: raced ? cloudRevisionOf(raced) : null,
          remote: raced ? await this.remoteRecord(session, table, raced) : null,
          reason: "The cloud already has a different row with this id.",
        };
      }
      return failure(error, table);
    }
    if (table === "conversations") {
      const messageError = await this.syncMessages(session, operation.payload.data as ChatConversation);
      if (messageError) return failure(messageError, "messages");
    }
    return { status: "applied", cloudRevision: cloudRevisionOf(data ?? row) };
  }

  private async remoteRecord(
    session: ContinuitySession,
    table: string,
    row: Row,
  ): Promise<ContinuityRecord & { cloudRevision: string }> {
    let data: ContinuityRecord["data"];
    if (table === "projects") data = projectFromRow(row);
    else if (table === "knowledge_items") data = knowledgeFromRow(row);
    else if (table === "conversations") {
      const { data: messages } = await session.client
        .from("messages")
        .select("*")
        .eq("user_id", session.userId)
        .eq("conversation_id", row.id);
      data = conversationFromRow(row, messages ?? []);
    } else data = row;
    return {
      id: String(row.id),
      updatedAt: number(row.updated_at),
      data,
      cloudRevision: cloudRevisionOf(row),
    };
  }

  private async pushDocument(
    session: ContinuitySession,
    operation: ContinuityOutboxOperation,
  ): Promise<ContinuityPushResult> {
    const key = DOC_KEYS[operation.authority];
    if (!key) return { status: "retry_required", reason: "No document key." };
    const { data, error } = await session.client
      .from("user_preferences")
      .select("*")
      .eq("user_id", session.userId)
      .eq("preference_key", key)
      .maybeSingle();
    if (error) return failure(error, "user_preferences");

    const existing = data?.value && typeof data.value === "object"
      ? data.value as Partial<DocumentValue>
      : null;
    const existingRecords = existing?.format === DOC_FORMAT && Array.isArray(existing.records)
      ? existing.records
      : [];
    const remoteRecord = existingRecords.find((record) => record.id === operation.recordId) ?? null;
    const localHash = recordHash(operation.payload);
    const remoteHash = remoteRecord ? recordHash(remoteRecord) : null;
    const alreadyApplied = Boolean(remoteRecord && remoteHash === localHash);

    if (data && alreadyApplied) {
      return { status: "applied", cloudRevision: cloudRevisionOf(data) };
    }

    if (!data) {
      if (operation.type === "delete") return { status: "applied", cloudRevision: "deleted" };
      if (operation.expectedCloudRevision !== null) {
        return {
          status: "conflict",
          cloudRevision: null,
          remote: null,
          reason: "The expected cloud document no longer exists.",
        };
      }
    } else if (!expectedMatches(operation.expectedCloudRevision, data)) {
      // A document can change because a different record in the same
      // authority was written. If this exact record is untouched, the
      // update can safely rebase onto the current document revision.
      if (operation.type === "delete" && !remoteRecord) {
        return { status: "applied", cloudRevision: cloudRevisionOf(data) };
      }
      if (remoteRecord && remoteHash !== localHash) {
        // The document moved because another record changed, while this
        // record is still exactly the base this device last synchronized.
        // Rebase is safe; only a changed same-record target is a conflict.
        const targetUnchanged = operation.baseRecordHash !== null && remoteHash === operation.baseRecordHash;
        if (!targetUnchanged) {
          return {
            status: "conflict",
            cloudRevision: cloudRevisionOf(data),
            remote: remoteRecord,
            reason: "The cloud record changed after this device's last synchronized revision.",
          };
        }
      }
    }

    const nextRecords = existingRecords.filter((record) => record.id !== operation.recordId);
    if (operation.type !== "delete") nextRecords.push(operation.payload);
    else nextRecords.push({ ...operation.payload, deleted: true });
    const value: DocumentValue = {
      format: DOC_FORMAT,
      updatedAt: Date.now(),
      records: nextRecords,
    };
    const updatedAt = new Date().toISOString();
    if (data) {
      const update: Row = { value };
      if (!hasStrictRevision(data)) update.updated_at = nextTimestamp(data.updated_at);
      const query = this.conditional(
        session.client
          .from("user_preferences")
          .update(update)
          .eq("user_id", session.userId)
          .eq("preference_key", key),
        data,
      );
      const { data: updated, error: updateError } = await query
        .select(this.revisionSelect(data))
        .maybeSingle();
      if (updateError) return failure(updateError, "user_preferences");
      if (!updated) {
        return {
          status: "conflict",
          cloudRevision: cloudRevisionOf(data),
          remote: remoteRecord,
          reason: "The conditional document update matched no row.",
        };
      }
      return { status: "applied", cloudRevision: cloudRevisionOf(updated) };
    }

    const { data: inserted, error: insertError } = await session.client
      .from("user_preferences")
      .insert({ user_id: session.userId, preference_key: key, value, updated_at: updatedAt })
      .select("*")
      .maybeSingle();
    if (insertError) {
      if (insertError.code === "23505") {
        const { data: raced } = await session.client
          .from("user_preferences")
          .select("*")
          .eq("user_id", session.userId)
          .eq("preference_key", key)
          .maybeSingle();
        const racedRecords = raced?.value?.format === DOC_FORMAT && Array.isArray(raced.value.records)
          ? raced.value.records as ContinuityRecord[]
          : [];
        const racedRecord = racedRecords.find((record) => record.id === operation.recordId) ?? null;
        if (racedRecord && recordHash(racedRecord) === localHash) {
          return { status: "applied", cloudRevision: cloudRevisionOf(raced) };
        }
        return {
          status: "conflict",
          cloudRevision: raced ? cloudRevisionOf(raced) : null,
          remote: racedRecord,
          reason: "The cloud document already exists with a different revision.",
        };
      }
      return failure(insertError, "user_preferences");
    }
    return { status: "applied", cloudRevision: cloudRevisionOf(inserted ?? { updated_at: updatedAt }) };
  }
}

export { DOC_KEYS as CONTINUITY_DOC_KEYS };
export type { DocumentValue as ContinuityDocumentValue, SpatialObject as SyncedSpatialObject, NavNode as SyncedNavNode, PersistedKnowledgeGraphEnvelope };
