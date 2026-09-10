import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;
export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: JsonValue;
};

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ title: z.string().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("conversations")
      .insert({
        user_id: context.userId,
        title: data.title ?? "A new horizon",
      })
      .select("id, title, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ conversationId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("messages")
      .select("id, role, parts, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const out: StoredMessage[] = (rows ?? []).map((r) => ({
      id: r.id,
      role: r.role as StoredMessage["role"],
      parts: r.parts as JsonValue,
    }));
    return out;
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
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
        id: z.string().uuid(),
        title: z.string().optional(),
        archived: z.boolean().optional(),
        pinned: z.boolean().optional(),
        universe_id: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("conversations")
      .update(patch)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAllConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, updated_at, archived, pinned, universe_id")
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
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

    // Find candidates among non-archived, non-pinned convos.
    const { data: convos } = await sb
      .from("conversations")
      .select("id, updated_at, created_at")
      .eq("archived", false)
      .eq("pinned", false)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (!convos?.length) return { archived: 0 };

    const ids = convos.map((c) => c.id);
    const { data: msgs } = await sb
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", ids);
    const withMessages = new Set((msgs ?? []).map((m) => m.conversation_id));

    const toArchive: string[] = [];
    for (const c of convos) {
      const empty = !withMessages.has(c.id);
      const isOldEmpty = empty && (c.created_at ?? c.updated_at) < dayAgo;
      const isStale = c.updated_at < monthAgo;
      if (isOldEmpty || isStale) toArchive.push(c.id);
    }
    if (!toArchive.length) return { archived: 0 };

    const { error } = await sb
      .from("conversations")
      .update({ archived: true })
      .in("id", toArchive);
    if (error) throw new Error(error.message);
    return { archived: toArchive.length };
  });