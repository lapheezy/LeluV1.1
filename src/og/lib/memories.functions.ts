import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

export const listMemories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().optional(),
        category: z.string().optional(),
        archived: z.boolean().optional(),
      })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("memories")
      .select("id, category, key, title, summary, value, importance, tags, pinned, archived, last_referenced_at, created_at, updated_at, source_conversation_id")
      .order("pinned", { ascending: false })
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(500);
    if (data?.archived === false) q = q.eq("archived", false);
    else if (data?.archived === true) q = q.eq("archived", true);
    if (data?.category) q = q.eq("category", data.category);
    if (data?.search && data.search.trim()) {
      const s = `%${data.search.trim()}%`;
      q = q.or(`key.ilike.${s},value.ilike.${s},title.ilike.${s},summary.ilike.${s}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        title: z.string().nullable().optional(),
        summary: z.string().nullable().optional(),
        value: z.string().optional(),
        category: z.string().optional(),
        key: z.string().optional(),
        importance: z.number().int().min(1).max(5).optional(),
        tags: z.array(z.string()).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("memories").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("memories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const attachMemoryToUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ memory_id: z.string().uuid(), universe_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("memory_universes")
      .upsert({ memory_id: data.memory_id, universe_id: data.universe_id, user_id: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const detachMemoryFromUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ memory_id: z.string().uuid(), universe_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("memory_universes")
      .delete()
      .eq("memory_id", data.memory_id)
      .eq("universe_id", data.universe_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });