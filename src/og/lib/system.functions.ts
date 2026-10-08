import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

const Severity = z.enum(["info", "warn", "error", "fatal"]);

export const logSystemEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.string().min(1),
        severity: Severity.default("info"),
        source: z.string().optional(),
        message: z.string().optional(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        detail: z.any().optional(),
        conversation_id: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("system_events").insert({
      user_id: context.userId,
      kind: data.kind,
      severity: data.severity,
      source: data.source ?? null,
      message: data.message ?? null,
      detail: (data.detail ?? {}) as never,
      conversation_id: data.conversation_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listSystemEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        severity: Severity.optional(),
        limit: z.number().int().min(1).max(200).default(100),
      })
      .optional()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("system_events")
      .select("id, kind, severity, source, message, detail, conversation_id, created_at")
      .order("created_at", { ascending: false })
      .limit(data?.limit ?? 100);
    if (data?.severity) q = q.eq("severity", data.severity);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });