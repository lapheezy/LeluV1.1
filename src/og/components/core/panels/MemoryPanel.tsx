import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pin, PinOff, Archive, Trash2, Search } from "lucide-react";
import { listMemories, updateMemory, deleteMemory } from "@og/lib/memories.functions";
import { useProcessing } from "../ProcessingProvider";
import { cn } from "@og/lib/utils";

const CATEGORIES = [
  "all", "identity", "preferences", "goals", "projects", "relationships",
  "skills", "ideas", "events", "growth", "general",
];

type Tab = "timeline" | "pinned" | "recent" | "long_term" | "conversation" | "categories" | "archived";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline",     label: "Timeline" },
  { id: "pinned",       label: "Pinned" },
  { id: "recent",       label: "Recent" },
  { id: "long_term",    label: "Long-term" },
  { id: "conversation", label: "Conversation" },
  { id: "categories",   label: "Categories" },
  { id: "archived",     label: "Archived" },
];

export function MemoryPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMemories);
  const updateFn = useServerFn(updateMemory);
  const deleteFn = useServerFn(deleteMemory);
  const proc = useProcessing();

  const [tab, setTab] = useState<Tab>("timeline");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");

  const archived = tab === "archived";

  const memQuery = useQuery({
    queryKey: ["memories", { search, category, archived }],
    queryFn: async () => {
      const taskId = proc.start({ kind: "reading_memory", label: "loading memories" });
      try {
        return await listFn({
          data: {
            search: search || undefined,
            category: category === "all" ? undefined : category,
            archived,
          },
        });
      } finally { proc.end(taskId); }
    },
  });

  useEffect(() => {
    if (tab === "categories") return;
    if (tab === "archived") return;
  }, [tab]);

  async function patch(id: string, p: Record<string, unknown>) {
    const taskId = proc.start({ kind: "writing_memory", label: "updating memory" });
    try {
      await updateFn({ data: { id, ...p } });
      qc.invalidateQueries({ queryKey: ["memories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    } finally { proc.end(taskId); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this memory permanently?")) return;
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["memories"] });
      toast.success("Memory removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  let rows = memQuery.data ?? [];
  if (tab === "pinned") rows = rows.filter((r) => r.pinned);
  else if (tab === "recent") rows = [...rows].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at)).slice(0, 40);
  else if (tab === "long_term") rows = rows.filter((r) => (r.importance ?? 0) >= 4);
  else if (tab === "conversation") rows = rows.filter((r) => r.source_conversation_id);

  return (
    <div className="flex h-full">
      <aside className="hidden w-48 shrink-0 border-r border-white/10 bg-black/10 p-3 md:block">
        <div className="mb-3 text-[9px] uppercase tracking-[0.32em] text-foreground/50">Views</div>
        <nav className="flex flex-col gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-2 py-1.5 text-left text-xs transition",
                tab === t.id ? "bg-white/10 text-foreground" : "text-foreground/60 hover:bg-white/5 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 md:hidden overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] transition",
                tab === t.id ? "bg-white/10 text-foreground" : "text-foreground/50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <div className="relative flex-1 min-w-0">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-foreground/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-white/10 bg-black/20 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-foreground/40"
            />
          </div>
          {tab === "categories" && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-xs"
            >
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {memQuery.isLoading && <div className="text-xs text-foreground/50">Loading…</div>}
          {!memQuery.isLoading && rows.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/10 py-8 text-center text-xs text-foreground/50">
              Nothing here yet.
            </div>
          )}
          {rows.map((m) => (
            <div key={m.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1 text-[9px] uppercase tracking-[0.22em] text-foreground/40">
                    <span>{m.category}</span><span>·</span><span className="truncate">{m.key}</span>
                    <span>·</span><span>importance {m.importance}</span>
                    {m.pinned && <><span>·</span><span className="text-amber-300">pinned</span></>}
                  </div>
                  {m.title && <div className="mt-1 text-sm font-medium">{m.title}</div>}
                  <div className="mt-1 whitespace-pre-wrap text-xs text-foreground/80">{m.value}</div>
                  {m.summary && <div className="mt-1 text-[11px] italic text-foreground/50">{m.summary}</div>}
                  <div className="mt-2 text-[9px] text-foreground/40">
                    updated {new Date(m.updated_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button title={m.pinned ? "Unpin" : "Pin"} onClick={() => patch(m.id, { pinned: !m.pinned })}
                    className="rounded p-1.5 text-foreground/60 hover:bg-white/10 hover:text-foreground">
                    {m.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                  </button>
                  <button title={m.archived ? "Unarchive" : "Archive"} onClick={() => patch(m.id, { archived: !m.archived })}
                    className="rounded p-1.5 text-foreground/60 hover:bg-white/10 hover:text-foreground">
                    <Archive className="size-3.5" />
                  </button>
                  <button title="Delete" onClick={() => remove(m.id)}
                    className="rounded p-1.5 text-foreground/60 hover:bg-destructive/25 hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}