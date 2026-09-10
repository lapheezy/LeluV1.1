import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

export const listUniverses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("universes")
      .select("id, name, description, color, icon, position, archived, updated_at")
      .order("archived", { ascending: true })
      .order("position", { ascending: true })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("universes")
      .insert({
        user_id: context.userId,
        name: data.name,
        description: data.description ?? null,
        color: data.color ?? null,
        icon: data.icon ?? null,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().optional(),
        description: z.string().optional(),
        color: z.string().optional(),
        icon: z.string().optional(),
        archived: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("universes").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUniverse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("universes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getUniverseDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const id = data.id;
    const [u, convos, tasks, notes, goals, events, reminders, files, memLinks] = await Promise.all([
      sb.from("universes").select("*").eq("id", id).maybeSingle(),
      sb.from("conversations").select("id,title,updated_at,archived,pinned").eq("universe_id", id).order("updated_at", { ascending: false }),
      sb.from("tasks").select("id,title,done,due_at,updated_at").eq("universe_id", id).order("updated_at", { ascending: false }),
      sb.from("notes").select("id,title,updated_at").eq("universe_id", id).order("updated_at", { ascending: false }),
      sb.from("goals").select("id,title,progress,status,target_date").eq("universe_id", id).order("updated_at", { ascending: false }),
      sb.from("events").select("id,title,starts_at,location").eq("universe_id", id).order("starts_at", { ascending: false }),
      sb.from("reminders").select("id,title,remind_at,delivered_at").eq("universe_id", id).order("remind_at", { ascending: false }),
      sb.from("files").select("id,kind,title,updated_at,pinned").eq("universe_id", id).order("updated_at", { ascending: false }),
      sb.from("memory_universes").select("memory_id").eq("universe_id", id),
    ]);
    let memories: { id: string; category: string; key: string; title: string | null; value: string; importance: number; updated_at: string }[] = [];
    const memIds = (memLinks.data ?? []).map((r) => r.memory_id);
    if (memIds.length > 0) {
      const { data: mems } = await sb
        .from("memories")
        .select("id,category,key,title,value,importance,updated_at")
        .in("id", memIds)
        .order("importance", { ascending: false })
        .order("updated_at", { ascending: false });
      memories = mems ?? [];
    }
    return {
      universe: u.data,
      conversations: convos.data ?? [],
      tasks: tasks.data ?? [],
      notes: notes.data ?? [],
      goals: goals.data ?? [],
      events: events.data ?? [],
      reminders: reminders.data ?? [],
      files: files.data ?? [],
      memories,
    };
  });