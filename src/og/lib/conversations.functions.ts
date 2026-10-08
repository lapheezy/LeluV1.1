import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";
import {
  CONVERSATION_COLUMNS,
  toConversationPatch,
  toOgConversation,
  toOgMessageParts,
  type OgConversationRow,
} from "@og/lib/conversation-mapping";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;
export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: JsonValue;
};

// Canonical conversation ids are LÉLU-generated strings. The migrated rows
// happen to be uuids, but a conversation LÉLU starts is not, so ids are
// validated as non-empty text rather than uuid — the uuid rule here rejected
// every conversation created after the migration.
const ConversationId = z.string().min(1);

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OgConversationRow[]> => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => toOgConversation(row as Record<string, unknown>));
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ title: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<OgConversationRow> => {
    // The canonical table has no id default — v1.1 supplies its own ids — so
    // one is minted here rather than relying on the database.
    const now = new Date().toISOString();
    const { data: row, error } = await context.supabase
      .from("conversations")
      .insert({
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        user_id: context.userId,
        title: data.title ?? "A new horizon",
        metadata: {},
        created_at: now,
        updated_at: now,
      })
      .select(CONVERSATION_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return toOgConversation(row as Record<string, unknown>);
  });

export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: ConversationId }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("id, role, text, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const out: StoredMessage[] = (rows ?? []).map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        role: String(row.role ?? "user") as StoredMessage["role"],
        parts: toOgMessageParts(row),
      };
    });
    return out;
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: ConversationId }).parse(input))
  .handler(async ({ data, context }) => {
    // Messages carry no cascade from the canonical conversation, so they are
    // removed first; leaving them would strand 900+ rows no UI can reach.
    const { error: messageError } = await context.supabase
      .from("messages")
      .delete()
      .eq("conversation_id", data.id);
    if (messageError) throw new Error(messageError.message);
    const { error } = await context.supabase
      .from("conversations")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: ConversationId,
        title: z.string().optional(),
        archived: z.boolean().optional(),
        pinned: z.boolean().optional(),
        universe_id: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    // Read the current metadata first so a pin does not discard the brain's
    // own keys (tags, topic, unread, processing, linkedIds).
    const { data: current, error: readError } = await context.supabase
      .from("conversations")
      .select("metadata")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("Conversation not found");

    const { error } = await context.supabase
      .from("conversations")
      .update(toConversationPatch(patch, (current as { metadata?: unknown }).metadata))
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAllConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OgConversationRow[]> => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    // pinned/archived live in the metadata jsonb, so the pinned-first order
    // is applied after mapping rather than as a PostgREST sort.
    return (data ?? [])
      .map((row) => toOgConversation(row as Record<string, unknown>))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  });

/**
 * Auto-archive conversations that look abandoned:
 *   - never had a message AND older than 24h, OR
 *   - untouched for 30+ days.
 * Pinned conversations are always spared.
 */
export const archiveStaleConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: rows } = await sb
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (!rows?.length) return { archived: 0 };

    const candidates = rows
      .map((row) => toOgConversation(row as Record<string, unknown>))
      .filter((row) => !row.archived && !row.pinned);
    if (candidates.length === 0) return { archived: 0 };

    const ids = candidates.map((row) => row.id);
    const { data: msgs } = await sb
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", ids);
    const withMessages = new Set(
      (msgs ?? []).map((m) => String((m as { conversation_id?: unknown }).conversation_id ?? "")),
    );

    const toArchive = candidates.filter((row) => {
      const empty = !withMessages.has(row.id);
      const isOldEmpty = empty && (row.created_at || row.updated_at) < dayAgo;
      const isStale = row.updated_at < monthAgo;
      return isOldEmpty || isStale;
    });
    if (toArchive.length === 0) return { archived: 0 };

    // archived lives inside metadata, so each row is patched against its own
    // metadata; a bulk `update({archived:true})` would erase the rest of it.
    for (const row of toArchive) {
      const { data: current } = await sb
        .from("conversations")
        .select("metadata")
        .eq("id", row.id)
        .maybeSingle();
      const { error } = await sb
        .from("conversations")
        .update(
          toConversationPatch({ archived: true }, (current as { metadata?: unknown } | null)?.metadata),
        )
        .eq("id", row.id);
      if (error) throw new Error(error.message);
    }
    return { archived: toArchive.length };
  });
