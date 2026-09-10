import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { toast } from "sonner";
import { listFiles, updateFile, deleteFile } from "@og/lib/files.functions";
import { Pin, PinOff, Archive, Trash2, FileText } from "lucide-react";

export function FilesPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listFiles);
  const updateFn = useServerFn(updateFile);
  const deleteFn = useServerFn(deleteFile);

  const q = useQuery({ queryKey: ["files"], queryFn: () => listFn() });

  async function patch(id: string, p: Record<string, unknown>) {
    try { await updateFn({ data: { id, ...p } }); qc.invalidateQueries({ queryKey: ["files"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this file?")) return;
    try { await deleteFn({ data: { id } }); qc.invalidateQueries({ queryKey: ["files"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  const rows = q.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-3 py-2 text-[10px] uppercase tracking-[0.3em] text-foreground/50">
        {rows.length} file{rows.length === 1 ? "" : "s"}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {q.isLoading && <div className="text-xs text-foreground/50">Loading…</div>}
        {!q.isLoading && rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 py-8 text-center text-xs text-foreground/50">
            No files yet. Lélu will save documents she creates here.
          </div>
        )}
        {rows.map((f) => (
          <div key={f.id} className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-2">
            <FileText className="size-4 shrink-0 text-foreground/50" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{f.title ?? "(untitled)"}</div>
              <div className="text-[10px] uppercase tracking-[0.24em] text-foreground/40">
                {f.kind} · {new Date(f.updated_at).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button title={f.pinned ? "Unpin" : "Pin"} onClick={() => patch(f.id, { pinned: !f.pinned })}
                className="rounded p-1.5 text-foreground/60 hover:bg-white/10 hover:text-foreground">
                {f.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </button>
              <button title="Archive" onClick={() => patch(f.id, { archived: true })}
                className="rounded p-1.5 text-foreground/60 hover:bg-white/10 hover:text-foreground">
                <Archive className="size-3.5" />
              </button>
              <button title="Delete" onClick={() => remove(f.id)}
                className="rounded p-1.5 text-foreground/60 hover:bg-destructive/25 hover:text-destructive">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}