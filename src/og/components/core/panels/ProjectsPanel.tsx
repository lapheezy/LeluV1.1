import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useState } from "react";
import { toast } from "sonner";
import { listUniverses, createUniverse, getUniverseDetail, updateUniverse } from "@og/lib/universes.functions";
import { Archive, Orbit, Plus } from "lucide-react";
import { cn } from "@og/lib/utils";

export function ProjectsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUniverses);
  const createFn = useServerFn(createUniverse);
  const updateFn = useServerFn(updateUniverse);
  const detailFn = useServerFn(getUniverseDetail);

  const q = useQuery({ queryKey: ["universes"], queryFn: () => listFn() });
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["universe", selected],
    queryFn: () => detailFn({ data: { id: selected! } }),
    enabled: !!selected,
  });

  const createM = useMutation({
    mutationFn: async (name: string) => createFn({ data: { name } }),
    onSuccess: (row) => { qc.invalidateQueries({ queryKey: ["universes"] }); setSelected(row.id); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 border-r border-white/10 bg-black/10 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[9px] uppercase tracking-[0.3em] text-foreground/50">Projects</div>
          <button
            onClick={() => {
              const name = prompt("New project name?");
              if (name?.trim()) createM.mutate(name.trim());
            }}
            className="grid h-6 w-6 place-items-center rounded text-foreground/70 hover:bg-white/10">
            <Plus className="size-3.5" />
          </button>
        </div>
        <nav className="space-y-0.5">
          {(q.data ?? []).map((u) => (
            <button key={u.id} onClick={() => setSelected(u.id)}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                selected === u.id ? "bg-white/10 text-foreground" : "text-foreground/70 hover:bg-white/5",
                u.archived && "opacity-50",
              )}>
              <Orbit className="size-3.5" />
              <span className="truncate">{u.name}</span>
            </button>
          ))}
          {(q.data ?? []).length === 0 && !q.isLoading && (
            <div className="rounded-md border border-dashed border-white/10 p-3 text-[11px] text-foreground/50">
              No projects yet.
            </div>
          )}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-4">
        {!selected && <div className="text-xs text-foreground/50">Select or create a project.</div>}
        {selected && detail.data?.universe && (
          <div className="space-y-4">
            <header className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-lg font-medium truncate">{detail.data.universe.name}</div>
                {detail.data.universe.description && (
                  <div className="text-xs text-foreground/60">{detail.data.universe.description}</div>
                )}
              </div>
              <button
                onClick={async () => {
                  await updateFn({ data: { id: selected, archived: !detail.data!.universe!.archived } });
                  qc.invalidateQueries({ queryKey: ["universes"] });
                  qc.invalidateQueries({ queryKey: ["universe", selected] });
                }}
                className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.24em] hover:bg-white/10">
                <Archive className="size-3" /> {detail.data.universe.archived ? "Unarchive" : "Archive"}
              </button>
            </header>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Section title="Notes" empty="No notes." items={detail.data.notes.map((n) => ({ id: n.id, primary: n.title ?? "(untitled)", meta: new Date(n.updated_at).toLocaleDateString() }))} />
              <Section title="Files" empty="No files." items={detail.data.files.map((f) => ({ id: f.id, primary: f.title ?? f.kind, meta: f.kind }))} />
              <Section title="Conversations" empty="No conversations." items={detail.data.conversations.map((c) => ({ id: c.id, primary: c.title ?? "Untitled", meta: new Date(c.updated_at).toLocaleDateString() }))} />
              <Section title="Tasks" empty="No tasks." items={detail.data.tasks.map((t) => ({ id: t.id, primary: t.title, meta: t.done ? "done" : "open" }))} />
              <Section title="Goals" empty="No goals." items={detail.data.goals.map((g) => ({ id: g.id, primary: g.title, meta: `${g.progress ?? 0}%` }))} />
              <Section title="Memories" empty="No linked memories." items={detail.data.memories.map((m) => ({ id: m.id, primary: m.title ?? m.key, meta: m.category }))} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, items, empty }: { title: string; empty: string; items: { id: string; primary: string; meta?: string }[] }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <h4 className="mb-2 text-[10px] uppercase tracking-[0.3em] text-foreground/60">{title}</h4>
      {items.length === 0 ? (
        <div className="text-[11px] text-foreground/40">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 8).map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate">{i.primary}</span>
              {i.meta && <span className="text-[10px] text-foreground/40">{i.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}