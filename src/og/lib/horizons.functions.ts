import { createServerFn } from "@og/compat/server-fn";
import { requireSupabaseAuth } from "@og/integrations/supabase/auth-middleware";
import { CONVERSATION_COLUMNS, toOgConversation } from "@og/lib/conversation-mapping";

export type HorizonItem = {
  kind: "conversation" | "reminder" | "task" | "note" | "goal" | "event";
  id: string;
  title: string;
  when: string; // ISO timestamp used for recency / glow
  meta?: string | null;
};

/**
 * Returns every "light" in the user's sky: conversations and the live items
 * they've created with Lélu. Sorted by recency. The UI uses these to render
 * stars (most recent = brightest).
 */
export const listHorizons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const [convos, reminders, tasks, notes, goals, events] = await Promise.all([
      // `archived` lives inside conversations.metadata, so it cannot be a
      // PostgREST filter; the flag is applied after mapping below.
      sb.from("conversations").select(CONVERSATION_COLUMNS).order("updated_at", { ascending: false }).limit(60),
      sb.from("reminders").select("id,title,remind_at,delivered_at").order("remind_at", { ascending: false }).limit(40),
      sb.from("tasks").select("id,title,done,updated_at").order("updated_at", { ascending: false }).limit(40),
      sb.from("notes").select("id,title,updated_at").order("updated_at", { ascending: false }).limit(40),
      sb.from("goals").select("id,title,progress,status,updated_at").order("updated_at", { ascending: false }).limit(40),
      sb.from("events").select("id,title,starts_at,location").order("starts_at", { ascending: false }).limit(40),
    ]);

    const items: HorizonItem[] = [];
    for (const row of convos.data ?? []) {
      const r = toOgConversation(row as Record<string, unknown>);
      if (r.archived) continue;
      items.push({ kind: "conversation", id: r.id, title: r.title, when: r.updated_at });
    }
    for (const r of reminders.data ?? []) items.push({ kind: "reminder", id: r.id, title: r.title, when: r.remind_at, meta: r.delivered_at ? "delivered" : "scheduled" });
    for (const r of tasks.data ?? []) items.push({ kind: "task", id: r.id, title: r.title, when: r.updated_at, meta: r.done ? "done" : null });
    for (const r of notes.data ?? []) items.push({ kind: "note", id: r.id, title: r.title, when: r.updated_at });
    for (const r of goals.data ?? []) items.push({ kind: "goal", id: r.id, title: r.title, when: r.updated_at, meta: `${r.progress}% · ${r.status}` });
    for (const r of events.data ?? []) items.push({ kind: "event", id: r.id, title: r.title, when: r.starts_at, meta: r.location });

    items.sort((a, b) => +new Date(b.when) - +new Date(a.when));
    return items;
  });