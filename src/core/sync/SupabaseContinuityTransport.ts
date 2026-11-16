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
import type {
  ContinuityAuthority,
  ContinuityOutboxOperation,
  ContinuityPullResult,
  ContinuityPushResult,
  ContinuityRecord,
  ContinuityTransport,
} from "./ContinuityTypes";

type Row = Record<string, any>;

const DOC_FORMAT = "lelu.continuity.doc.v1";

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

  private session(): { client: SupabaseClient; userId: string } | null {
    return SupabasePersistence.getInstance().continuitySession();
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
        const result = await this.upsertRow(
          session,
          "conversations",
          conversation.id,
          conversationRow(conversation, session.userId),
          operation,
        );
        if (result.status !== "applied") return result;
        const messages = messageRows(conversation, session.userId);
        if (messages.length > 0) {
          const { error } = await session.client
            .from("messages")
            .upsert(messages, { onConflict: "id,user_id" });
          if (error) {
            return { status: "retry_required", reason: `messages: ${error.message}`, retryAfterMs: 2_000 };
          }
        }
        return result;
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
      return {
        status: "retry_required",
        reason: error instanceof Error ? error.message : String(error),
        retryAfterMs: 2_000,
      };
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
          cloudRevision: String(row.updated_at),
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
          cloudRevision: String(row.updated_at),
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
          cloudRevision: String(row.updated_at),
        })),
      };
    }
    const key = DOC_KEYS[authority];
    if (!key) return { records: [] };
    const { data, error } = await session.client
      .from("user_preferences")
      .select("value, updated_at")
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
        cloudRevision: String(data.updated_at),
      })),
    };
  }

  private async upsertRow(
    session: { client: SupabaseClient; userId: string },
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
    if (readError) {
      return { status: "retry_required", reason: `${table}: ${readError.message}`, retryAfterMs: 2_000 };
    }

    if (existing) {
      if (operation.expectedCloudRevision === null || String(existing.updated_at) !== operation.expectedCloudRevision) {
        return {
          status: "conflict",
          cloudRevision: String(existing.updated_at),
          // Fetch the full cloud value only on an actual conflict; a normal
          // conversation update must not pay for a second message read.
          remote: await this.remoteRecord(session, table, existing),
          reason: "The cloud row changed after this device's last synchronized revision.",
        };
      }
      if (operation.type === "delete") {
        const { error } = await session.client
          .from(table)
          .delete()
          .eq("id", id)
          .eq("user_id", session.userId)
          .eq("updated_at", existing.updated_at);
        if (error) return { status: "retry_required", reason: `${table}: ${error.message}`, retryAfterMs: 2_000 };
        return { status: "applied", cloudRevision: String(existing.updated_at) };
      }
      const { data, error } = await session.client
        .from(table)
        .update(row)
        .eq("id", id)
        .eq("user_id", session.userId)
        .eq("updated_at", existing.updated_at)
        .select("updated_at")
        .maybeSingle();
      if (error) return { status: "retry_required", reason: `${table}: ${error.message}`, retryAfterMs: 2_000 };
      if (!data) {
        return {
          status: "conflict",
          cloudRevision: null,
          remote: null,
          reason: "The conditional update matched no row; another device changed it.",
        };
      }
      return { status: "applied", cloudRevision: String(data.updated_at) };
    }

    if (operation.expectedCloudRevision !== null) {
      return {
        status: "conflict",
        cloudRevision: null,
        remote: null,
        reason: "The expected cloud row no longer exists.",
      };
    }
    if (operation.type === "delete") return { status: "applied", cloudRevision: operation.expectedCloudRevision ?? "deleted" };

    const { data, error } = await session.client
      .from(table)
      .insert(row)
      .select("updated_at")
      .maybeSingle();
    if (error) {
      // A duplicate id is a conflict, not an instruction to overwrite.
      if (error.code === "23505") {
        return {
          status: "conflict",
          cloudRevision: null,
          remote: null,
          reason: "The cloud already has a row with this id.",
        };
      }
      return { status: "retry_required", reason: `${table}: ${error.message}`, retryAfterMs: 2_000 };
    }
    return { status: "applied", cloudRevision: String(data?.updated_at ?? row.updated_at) };
  }

  private async remoteRecord(
    session: { client: SupabaseClient; userId: string },
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
      cloudRevision: String(row.updated_at),
    };
  }

  private async pushDocument(
    session: { client: SupabaseClient; userId: string },
    operation: ContinuityOutboxOperation,
  ): Promise<ContinuityPushResult> {
    const key = DOC_KEYS[operation.authority];
    if (!key) return { status: "retry_required", reason: "No document key." };
    const { data, error } = await session.client
      .from("user_preferences")
      .select("value, updated_at")
      .eq("user_id", session.userId)
      .eq("preference_key", key)
      .maybeSingle();
    if (error) return { status: "retry_required", reason: `user_preferences: ${error.message}`, retryAfterMs: 2_000 };

    const existing = data?.value && typeof data.value === "object"
      ? data.value as Partial<DocumentValue>
      : null;
    const existingRecords = existing?.format === DOC_FORMAT && Array.isArray(existing.records)
      ? existing.records
      : [];
    const remoteRecord = existingRecords.find((record) => record.id === operation.recordId) ?? null;
    const remoteRevision = data?.updated_at ? String(data.updated_at) : null;

    if (data && (operation.expectedCloudRevision === null || remoteRevision !== operation.expectedCloudRevision)) {
      return {
        status: "conflict",
        cloudRevision: remoteRevision,
        remote: remoteRecord,
        reason: "The cloud document changed after this device's last synchronized revision.",
      };
    }
    if (!data && operation.expectedCloudRevision !== null) {
      return {
        status: "conflict",
        cloudRevision: null,
        remote: null,
        reason: "The expected cloud document no longer exists.",
      };
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
      const { data: updated, error: updateError } = await session.client
        .from("user_preferences")
        .update({ value, updated_at: updatedAt })
        .eq("user_id", session.userId)
        .eq("preference_key", key)
        .eq("updated_at", data.updated_at)
        .select("updated_at")
        .maybeSingle();
      if (updateError) return { status: "retry_required", reason: `user_preferences: ${updateError.message}`, retryAfterMs: 2_000 };
      if (!updated) return { status: "conflict", cloudRevision: null, remote: null, reason: "The conditional document update matched no row." };
      return { status: "applied", cloudRevision: String(updated.updated_at) };
    }
    const { data: inserted, error: insertError } = await session.client
      .from("user_preferences")
      .insert({ user_id: session.userId, preference_key: key, value, updated_at: updatedAt })
      .select("updated_at")
      .maybeSingle();
    if (insertError) {
      if (insertError.code === "23505") {
        return { status: "conflict", cloudRevision: null, remote: null, reason: "The cloud document already exists." };
      }
      return { status: "retry_required", reason: `user_preferences: ${insertError.message}`, retryAfterMs: 2_000 };
    }
    return { status: "applied", cloudRevision: String(inserted?.updated_at ?? updatedAt) };
  }
}

export { DOC_KEYS as CONTINUITY_DOC_KEYS };
export type { DocumentValue as ContinuityDocumentValue, SpatialObject as SyncedSpatialObject, NavNode as SyncedNavNode, PersistedKnowledgeGraphEnvelope };
