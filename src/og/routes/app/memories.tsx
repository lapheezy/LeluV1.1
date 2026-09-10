import { createFileRoute } from "@og/compat/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useState } from "react";
import { toast } from "sonner";
import { listMemories, updateMemory, deleteMemory } from "@og/lib/memories.functions";
import { Pin, PinOff, Archive, Trash2, Search } from "lucide-react";

export const Route = createFileRoute("/app/memories")({ component: MemoryGarden });

const CATEGORIES = [
  "all", "identity", "preferences", "goals", "projects", "relationships",
  "skills", "ideas", "events", "growth", "general",
];

function MemoryGarden() {
  const qc = useQueryClient();
  const listFn = useServerFn(listMemories);
  const updateFn = useServerFn(updateMemory);
  const deleteFn = useServerFn(deleteMemory);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);

  const memQuery = useQuery({
    queryKey: ["memories", { search, category, showArchived }],
    queryFn: () =>
      listFn({
        data: {
          search: search || undefined,
          category: category === "all" ? undefined : category,
          archived: showArchived ? true : false,
        },
      }),
  });

  async function patch(id: string, p: Record<string, unknown>) {
    try {
      await updateFn({ data: { id, ...p } });
      qc.invalidateQueries({ queryKey: ["memories"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
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

  const rows = memQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl">Memory Garden</h1>
        <p className="text-foreground/60 text-sm mt-1">Everything Lélu remembers about you. You own all of it.</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories…"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-card/50 border border-border/40 text-sm outline-none focus:border-foreground/40"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-2 rounded-md bg-card/50 border border-border/40 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-foreground/60">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Archived
        </label>
      </div>

      <div className="space-y-2">
        {memQuery.isLoading && <div className="text-foreground/50 text-sm">Loading…</div>}
        {!memQuery.isLoading && rows.length === 0 && (
          <div className="text-foreground/50 text-sm py-10 text-center border border-dashed border-border/40 rounded-lg">
            Nothing here yet. As Lélu learns about you she'll plant memories here.
          </div>
        )}
        {rows.map((m) => (
          <div key={m.id} className="rounded-lg border border-border/40 bg-card/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-foreground/40">
                  <span>{m.category}</span>
                  <span>·</span>
                  <span>{m.key}</span>
                  <span>·</span>
                  <span>importance {m.importance}</span>
                </div>
                {m.title && <div className="font-display text-lg mt-1">{m.title}</div>}
                <div className="text-sm text-foreground/80 mt-1 whitespace-pre-wrap">{m.value}</div>
                {m.summary && <div className="text-xs text-foreground/50 mt-1 italic">{m.summary}</div>}
                <div className="text-[10px] text-foreground/40 mt-2">
                  updated {new Date(m.updated_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  title={m.pinned ? "Unpin" : "Pin"}
                  onClick={() => patch(m.id, { pinned: !m.pinned })}
                  className="p-2 rounded hover:bg-foreground/10 text-foreground/60 hover:text-foreground"
                >
                  {m.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                </button>
                <button
                  title={m.archived ? "Unarchive" : "Archive"}
                  onClick={() => patch(m.id, { archived: !m.archived })}
                  className="p-2 rounded hover:bg-foreground/10 text-foreground/60 hover:text-foreground"
                >
                  <Archive className="size-4" />
                </button>
                <button
                  title="Delete"
                  onClick={() => remove(m.id)}
                  className="p-2 rounded hover:bg-destructive/20 text-foreground/60 hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}