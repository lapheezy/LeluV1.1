import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";
import type { Json } from "@og/integrations/supabase/types";

/**
 * The OG memory log was written against a `memory_events` table that does not
 * exist in this project. The real event log is `system_events`
 * (kind, severity, source, message, detail, conversation_id), which the rest of
 * the runtime already writes. Memory events are namespaced `memory.<kind>`
 * there, so the OG log panel reads one event store rather than a private one.
 */
const Kind = z.enum(["created", "updated", "merged", "deleted", "recalled"]);

const KIND_PREFIX = "memory.";

export interface MemoryEventRow {
  id: string;
  memory_id: string | null;
  kind: string;
  reason: string | null;
  conversation_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

function toMemoryEvent(row: Record<string, unknown>): MemoryEventRow {
  const detail =
    row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : {};
  const kind = String(row.kind ?? "");
  const memoryId = detail.memory_id ?? detail.memoryId;
  return {
    id: String(row.id ?? ""),
    memory_id: typeof memoryId === "string" && memoryId.length > 0 ? memoryId : null,
    kind: kind.startsWith(KIND_PREFIX) ? kind.slice(KIND_PREFIX.length) : kind,
    reason: typeof row.message === "string" && row.message.length > 0 ? row.message : null,
    conversation_id: typeof row.conversation_id === "string" ? row.conversation_id : null,
    detail,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

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
  .handler(async ({ data, context }): Promise<MemoryEventRow[]> => {
    let q = context.supabase
      .from("system_events")
      .select("id, kind, severity, source, message, detail, conversation_id, created_at")
      .like("kind", `${KIND_PREFIX}%`)
      .order("created_at", { ascending: false })
      .limit(data?.limit ?? 200);
    if (data?.kind) q = q.eq("kind", `${KIND_PREFIX}${data.kind}`);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    let mapped = (rows ?? []).map((row) => toMemoryEvent(row as Record<string, unknown>));
    const needle = data?.search?.trim().toLowerCase();
    if (needle) {
      mapped = mapped.filter(
        (row) =>
          (row.reason ?? "").toLowerCase().includes(needle) ||
          JSON.stringify(row.detail).toLowerCase().includes(needle),
      );
    }
    return mapped;
  });

export const recordMemoryEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        memory_id: z.string().min(1).nullable().optional(),
        kind: Kind,
        reason: z.string().optional(),
        conversation_id: z.string().min(1).optional(),
        detail: z.unknown().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const detail =
      data.detail && typeof data.detail === "object" && !Array.isArray(data.detail)
        ? { ...(data.detail as Record<string, unknown>) }
        : {};
    if (data.memory_id) detail.memory_id = data.memory_id;

    const { error } = await context.supabase.from("system_events").insert({
      user_id: context.userId,
      kind: `${KIND_PREFIX}${data.kind}`,
      severity: data.kind === "deleted" ? "warn" : "info",
      source: "memory",
      message: data.reason ?? null,
      detail: detail as Json,
      conversation_id: data.conversation_id ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
