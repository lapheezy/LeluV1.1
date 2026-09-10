import { createFileRoute } from "@og/compat/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useState } from "react";
import { toast } from "sonner";
import { listFiles, getFile, updateFile, deleteFile } from "@og/lib/files.functions";
import { Trash2, FileText, Download } from "lucide-react";

export const Route = createFileRoute("/app/files")({ component: FilesPage });

function FilesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFiles);
  const getFn = useServerFn(getFile);
  const updateFn = useServerFn(updateFile);
  const deleteFn = useServerFn(deleteFile);

  const files = useQuery({ queryKey: ["files"], queryFn: () => listFn() });
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useQuery({
    queryKey: ["file", activeId],
    queryFn: () => (activeId ? getFn({ data: { id: activeId } }) : Promise.resolve(null)),
    enabled: !!activeId,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  async function save() {
    if (!activeId) return;
    try {
      await updateFn({ data: { id: activeId, body: draft } });
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["file", activeId] });
      qc.invalidateQueries({ queryKey: ["files"] });
      toast.success("Saved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this file?")) return;
    await deleteFn({ data: { id } });
    if (activeId === id) setActiveId(null);
    qc.invalidateQueries({ queryKey: ["files"] });
  }

  function download() {
    if (!active.data) return;
    const blob = new Blob([active.data.body], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.data.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
      <aside className="space-y-2">
        <h2 className="font-display text-2xl mb-3">Files</h2>
        {(files.data ?? []).length === 0 && (
          <div className="text-sm text-foreground/50">No files yet. Lélu creates notes, reports, and briefs as you work.</div>
        )}
        {(files.data ?? []).map((f) => (
          <button
            key={f.id}
            onClick={() => { setActiveId(f.id); setEditing(false); }}
            className={`w-full text-left p-3 rounded-md border transition ${activeId === f.id ? "bg-card/60 border-foreground/30" : "bg-card/30 border-border/40 hover:bg-card/50"}`}
          >
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-foreground/50" />
              <div className="text-sm truncate">{f.title}</div>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-foreground/40 mt-1">{f.kind}</div>
          </button>
        ))}
      </aside>

      <main className="rounded-xl border border-border/40 bg-card/30 p-6 min-h-[60vh]">
        {!activeId && <div className="text-foreground/50 text-sm">Select a file.</div>}
        {activeId && active.isLoading && <div className="text-foreground/50 text-sm">Loading…</div>}
        {active.data && (
          <>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h1 className="font-display text-3xl">{active.data.title}</h1>
                <div className="text-[10px] uppercase tracking-[0.25em] text-foreground/40 mt-1">
                  {active.data.kind} · updated {new Date(active.data.updated_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={download} className="text-xs px-3 py-1.5 rounded border border-border/40 hover:bg-foreground/10 inline-flex items-center gap-1">
                  <Download className="size-3.5" /> Export
                </button>
                {!editing ? (
                  <button onClick={() => { setDraft(active.data!.body); setEditing(true); }} className="text-xs px-3 py-1.5 rounded bg-foreground text-background">Edit</button>
                ) : (
                  <>
                    <button onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded border border-border/40">Cancel</button>
                    <button onClick={save} className="text-xs px-3 py-1.5 rounded bg-foreground text-background">Save</button>
                  </>
                )}
                <button onClick={() => remove(active.data!.id)} className="p-1.5 rounded text-foreground/50 hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full min-h-[60vh] bg-background/40 border border-border/40 rounded p-4 font-mono text-sm outline-none"
              />
            ) : (
              <pre className="whitespace-pre-wrap text-sm text-foreground/85 font-sans leading-relaxed">{active.data.body}</pre>
            )}
          </>
        )}
      </main>
    </div>
  );
}