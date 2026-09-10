import { createFileRoute, Link } from "@og/compat/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useState } from "react";
import { toast } from "sonner";
import { listUniverses, createUniverse, deleteUniverse } from "@og/lib/universes.functions";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/app/universes")({ component: UniversesPage });

function UniversesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUniverses);
  const createFn = useServerFn(createUniverse);
  const deleteFn = useServerFn(deleteUniverse);
  const universes = useQuery({ queryKey: ["universes"], queryFn: () => listFn() });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  async function add() {
    if (!name.trim()) return;
    try {
      await createFn({ data: { name: name.trim(), description: desc.trim() || undefined } });
      setName("");
      setDesc("");
      qc.invalidateQueries({ queryKey: ["universes"] });
      toast.success("Universe created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this universe? Items inside will stay but lose their grouping.")) return;
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["universes"] });
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-4xl">Project Universes</h1>
        <p className="text-foreground/60 text-sm mt-1">Each universe holds its own goals, tasks, research, notes, and memories.</p>
      </header>

      <div className="rounded-xl border border-border/40 bg-card/30 p-5 space-y-3">
        <div className="font-display text-lg">New universe</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Sapiolingo Fashion)"
            className="flex-1 px-3 py-2 rounded-md bg-background/50 border border-border/40 text-sm outline-none"
          />
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="One-line intention (optional)"
            className="flex-1 px-3 py-2 rounded-md bg-background/50 border border-border/40 text-sm outline-none"
          />
          <button onClick={add} className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-foreground text-background text-sm">
            <Plus className="size-4" /> Create
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(universes.data ?? []).map((u) => (
          <div key={u.id} className="rounded-xl border border-border/40 bg-card/40 p-5 group">
            <div className="flex items-start justify-between">
              <Link to="/app/universes/$id" params={{ id: u.id }} className="block min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-block size-2 rounded-full" style={{ background: u.color || "oklch(0.8 0.13 75)" }} />
                  <div className="font-display text-xl">{u.name}</div>
                </div>
                {u.description && <p className="text-xs text-foreground/60 mt-2 line-clamp-3">{u.description}</p>}
                <div className="text-[10px] text-foreground/40 mt-3">updated {new Date(u.updated_at).toLocaleDateString()}</div>
              </Link>
              <button
                onClick={() => remove(u.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-foreground/50 hover:text-destructive hover:bg-destructive/10"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        ))}
        {(universes.data ?? []).length === 0 && !universes.isLoading && (
          <div className="col-span-full text-center text-sm text-foreground/50 py-10 border border-dashed border-border/40 rounded-lg">
            No universes yet. Create one above, or ask Lélu in chat.
          </div>
        )}
      </div>
    </div>
  );
}