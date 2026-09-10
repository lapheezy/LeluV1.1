import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

const Kind = z.enum(["created", "updated", "merged", "deleted", "recalled"]);

export const listMemoryEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: Kind.optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("memory_events")
      .select("id, memory_id, kind, reason, conversation_id, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(data?.limit ?? 200);
    if (data?.kind) q = q.eq("kind", data.kind);
    if (data?.search && data.search.trim()) {
      const s = `%${data.search.trim()}%`;
      q = q.or(`reason.ilike.${s},detail::text.ilike.${s}`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordMemoryEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        memory_id: z.string().uuid().nullable().optional(),
        kind: Kind,
        reason: z.string().optional(),
        conversation_id: z.string().uuid().optional(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detail: z.any().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("memory_events").insert({
      user_id: context.userId,
      memory_id: data.memory_id ?? null,
      kind: data.kind,
      reason: data.reason ?? null,
      conversation_id: data.conversation_id ?? null,
      detail: (data.detail ?? {}) as never,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });