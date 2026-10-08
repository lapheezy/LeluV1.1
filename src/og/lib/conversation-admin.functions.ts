import { createServerFn } from "@og/compat/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";

/** Mark that a conversation failed to open (called by chat route on crash). */
export const reportConversationCrash = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid(), reason: z.string().optional() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: row } = await sb
      .from("conversations")
      .select("crash_count")
      .eq("id", data.id)
      .maybeSingle();
    const next = (row?.crash_count ?? 0) + 1;
    await sb
      .from("conversations")
      .update({
        crash_count: next,
        last_crash_at: new Date().toISOString(),
        recovery_state: next >= 3 ? "needs_recovery" : "unstable",
      })
      .eq("id", data.id);
    await sb.from("system_events").insert({
      user_id: context.userId,
      conversation_id: data.id,
      kind: "conversation.crash",
      severity: "error",
      source: "chat",
      message: data.reason ?? "conversation failed to open",
    });
    return { ok: true, crash_count: next };
  });

/**
 * Attempt to recover a corrupted conversation by trimming malformed messages.
 * Returns the recovered message count and resets the recovery state.
 */
export const recoverConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: msgs, error } = await sb
      .from("messages")
      .select("id, role, parts, created_at")
      .eq("conversation_id", data.id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // A message is "valid" if parts is an array with at least one text part.
    const bad: string[] = [];
    for (const m of msgs ?? []) {
      const parts = m.parts as unknown;
      const ok =
        Array.isArray(parts) &&
        parts.some(
          (p) => p && typeof p === "object" && (p as { type?: string }).type === "text",
        );
      if (!ok) bad.push(m.id);
    }
    if (bad.length) {
      await sb.from("messages").delete().in("id", bad);
    }
    await sb
      .from("conversations")
      .update({ recovery_state: "healthy", crash_count: 0, last_crash_at: null })
      .eq("id", data.id);
    return { ok: true, removed: bad.length, kept: (msgs?.length ?? 0) - bad.length };
  });

/**
 * Preserve a conversation: write a summary + topics + universe link into
 * conversation_summaries so the content survives any later cleanup.
 * Uses a naive extractive summary (first/last user turns + assistant gist) —
 * no AI call required, so it always works even if the model is down.
 */
export const preserveConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) =>
    z.object({ id: z.string().uuid(), reason: z.string().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const { data: convo } = await sb
      .from("conversations")
      .select("id, title, universe_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!convo) throw new Error("Conversation not found");

    const { data: msgs } = await sb
      .from("messages")
      .select("role, parts, created_at")
      .eq("conversation_id", data.id)
      .order("created_at", { ascending: true });

    const flatten = (parts: unknown): string => {
      if (!Array.isArray(parts)) return "";
      return parts
        .map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? (p as { text?: string }).text ?? "" : ""))
        .join(" ")
        .trim();
    };
    const lines = (msgs ?? []).map((m) => ({ role: m.role, text: flatten(m.parts) })).filter((m) => m.text);
    const userLines = lines.filter((l) => l.role === "user").map((l) => l.text);
    const assistantLines = lines.filter((l) => l.role === "assistant").map((l) => l.text);

    const head = userLines.slice(0, 2).join(" • ");
    const tailUser = userLines.slice(-2).join(" • ");
    const tailAssistant = assistantLines.slice(-1).join(" ");
    const summary = [head, tailUser, tailAssistant].filter(Boolean).join("\n\n").slice(0, 4000) || convo.title || "(empty conversation)";

    // Cheap topic extraction: words >4 chars, frequency top 8.
    const freq = new Map<string, number>();
    for (const l of lines) {
      for (const raw of l.text.toLowerCase().split(/[^a-z0-9'-]+/)) {
        if (raw.length < 5) continue;
        freq.set(raw, (freq.get(raw) ?? 0) + 1);
      }
    }
    const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);

    const { data: row, error } = await sb
      .from("conversation_summaries")
      .insert({
        user_id: context.userId,
        conversation_id: convo.id,
        original_title: convo.title,
        summary,
        topics,
        message_count: lines.length,
        universe_id: convo.universe_id ?? null,
        preserved_reason: data.reason ?? "manual",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, summary_id: row.id, topics, message_count: lines.length };
  });

/**
 * Safe delete: preserve summary first, then delete the conversation row
 * (messages cascade). Returns the saved summary id so the UI can show
 * "preserved as summary".
 */
export const safeDeleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Inline preservation (don't recurse server fns).
    const sb = context.supabase;
    const { data: convo } = await sb
      .from("conversations")
      .select("id, title, universe_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!convo) return { ok: true, summary_id: null };
    const { data: msgs } = await sb
      .from("messages")
      .select("role, parts")
      .eq("conversation_id", data.id)
      .order("created_at", { ascending: true });
    const texts = (msgs ?? []).map((m) => {
      const parts = m.parts as unknown;
      const t = Array.isArray(parts)
        ? parts.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? (p as { text?: string }).text ?? "" : "")).join(" ")
        : "";
      return `${m.role}: ${t}`.trim();
    });
    const summary = texts.slice(0, 6).concat(texts.slice(-4)).join("\n").slice(0, 4000) || convo.title || "(empty)";
    const { data: sumRow } = await sb
      .from("conversation_summaries")
      .insert({
        user_id: context.userId,
        conversation_id: convo.id,
        original_title: convo.title,
        summary,
        message_count: texts.length,
        universe_id: convo.universe_id ?? null,
        preserved_reason: "pre-delete",
      })
      .select("id")
      .single();
    const { error: delErr } = await sb.from("conversations").delete().eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true, summary_id: sumRow?.id ?? null };
  });

/** Semantic-ish search across conversation titles, message text, and preserved summaries. */
export const searchConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).default(8) }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const q = data.query.trim();
    const like = `%${q}%`;

    // 1. Title matches.
    const { data: byTitle } = await sb
      .from("conversations")
      .select("id, title, updated_at, archived, recovery_state")
      .ilike("title", like)
      .order("updated_at", { ascending: false })
      .limit(data.limit);

    // 2. Preserved summary matches.
    const { data: bySummary } = await sb
      .from("conversation_summaries")
      .select("id, conversation_id, original_title, summary, topics, updated_at")
      .or(`summary.ilike.${like},original_title.ilike.${like}`)
      .order("updated_at", { ascending: false })
      .limit(data.limit);

    // 3. Message body matches — scan recent messages and substring-match flattened text.
    const { data: recent } = await sb
      .from("messages")
      .select("conversation_id, parts")
      .order("created_at", { ascending: false })
      .limit(500);
    const lower = q.toLowerCase();
    const ids = new Set<string>();
    for (const m of recent ?? []) {
      const parts = m.parts as unknown;
      const text = Array.isArray(parts)
        ? parts.map((p) => (p && typeof p === "object" && (p as { type?: string }).type === "text" ? (p as { text?: string }).text ?? "" : "")).join(" ")
        : "";
      if (text.toLowerCase().includes(lower)) ids.add(m.conversation_id);
    }
    const convoIdsFromMsgs = [...ids].slice(0, data.limit);

    let convosFromMsgs: { id: string; title: string; updated_at: string }[] = [];
    if (convoIdsFromMsgs.length) {
      const { data: conv } = await sb
        .from("conversations")
        .select("id, title, updated_at")
        .in("id", convoIdsFromMsgs);
      convosFromMsgs = conv ?? [];
    }

    return {
      titleMatches: byTitle ?? [],
      messageMatches: convosFromMsgs,
      summaryMatches: bySummary ?? [],
    };
  });

export const listConversationSummaries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversation_summaries")
      .select("id, conversation_id, original_title, summary, topics, message_count, updated_at, preserved_reason")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });