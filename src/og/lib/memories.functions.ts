import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";
import {
  MEMORY_ITEM_COLUMNS,
  matchesSearch,
  toMemoryItemPatch,
  toOgMemory,
  type OgMemoryRow,
} from "@og/lib/memory-mapping";

// memory_items ids are LÉLU-generated strings; the migrated legacy rows happen
// to be uuids, but native memories are not, so ids are validated as non-empty
// text rather than uuid.
const MemoryId = z.string().min(1);

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
  .handler(async ({ data, context }): Promise<OgMemoryRow[]> => {
    let q = context.supabase
      .from("memory_items")
      .select(MEMORY_ITEM_COLUMNS)
      .order("importance", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(500);
    if (data?.category) q = q.eq("category", data.category);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // pinned/archived/search live in the context jsonb and across several
    // columns, so they are applied after mapping rather than as PostgREST
    // filters — bounded by the limit above.
    let mapped = (rows ?? []).map((row) => toOgMemory(row as Record<string, unknown>));
    if (data?.archived === true) mapped = mapped.filter((row) => row.archived);
    else if (data?.archived === false) mapped = mapped.filter((row) => !row.archived);
    if (data?.search) mapped = mapped.filter((row) => matchesSearch(row, data.search as string));
    return mapped.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  });

export const updateMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: MemoryId,
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
    // Read the current context so a pin does not discard the brain's own keys.
    const { data: current, error: readError } = await context.supabase
      .from("memory_items")
      .select("context")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("Memory not found");

    const { error } = await context.supabase
      .from("memory_items")
      .update(toMemoryItemPatch(patch, (current as { context?: unknown }).context))
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: MemoryId }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("memory_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const attachMemoryToUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ memory_id: MemoryId, universe_id: z.string().uuid() }).parse(input),
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
    z.object({ memory_id: MemoryId, universe_id: z.string().uuid() }).parse(input),
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
