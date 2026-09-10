import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

export const QUEUE_STATUSES = [
  "pending",
  "queued",
  "running",
  "waiting",
  "paused",
  "needs_user",
  "retrying",
  "completed",
  "failed",
  "archived",
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

const Status = z.enum(QUEUE_STATUSES);

export const enqueueTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().min(1),
        kind: z.string().min(1),
        agent: z.string().default("executive"),
        priority: z.number().int().min(1).max(10).default(5),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: z.any().optional(),
        conversation_id: z.string().uuid().optional(),
        parent_id: z.string().uuid().optional(),
        status: Status.default("pending"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tasks_queue")
      .insert({
        user_id: context.userId,
        title: data.title,
        kind: data.kind,
        agent: data.agent,
        priority: data.priority,
        payload: (data.payload ?? {}) as never,
        conversation_id: data.conversation_id ?? null,
        parent_id: data.parent_id ?? null,
        status: data.status,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const listQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: Status.optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("tasks_queue")
      .select("id, title, kind, agent, status, priority, payload, result, error, retries, conversation_id, parent_id, started_at, completed_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(data?.limit ?? 100);
    if (data?.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const updateQueueStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: Status,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result: z.any().optional(),
        error: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    type QueuePatch = {
      status: QueueStatus;
      result?: unknown;
      error?: string | null;
      started_at?: string;
      completed_at?: string;
    };
    const patch: QueuePatch = { status: data.status };
    if (data.result !== undefined) patch.result = data.result;
    if (data.error !== undefined) patch.error = data.error;
    if (data.status === "running") patch.started_at = new Date().toISOString();
    if (data.status === "completed" || data.status === "failed" || data.status === "archived")
      patch.completed_at = new Date().toISOString();
    const { error } = await context.supabase
      .from("tasks_queue")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const retryQueueTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("tasks_queue")
      .select("retries")
      .eq("id", data.id)
      .maybeSingle();
    const retries = (row?.retries ?? 0) + 1;
    const { error } = await context.supabase
      .from("tasks_queue")
      .update({ status: "retrying", retries, error: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true, retries };
  });

export const deleteQueueTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tasks_queue")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });