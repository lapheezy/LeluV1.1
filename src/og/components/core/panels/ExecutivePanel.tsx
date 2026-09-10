import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { listQueue, updateQueueStatus, retryQueueTask, deleteQueueTask } from "@og/lib/queue.functions";
import { RotateCw, Check, Pause, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@og/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-foreground/20 text-foreground/70",
  queued: "bg-foreground/20 text-foreground/70",
  running: "bg-amber-400/25 text-amber-200",
  waiting: "bg-sky-400/20 text-sky-200",
  paused: "bg-foreground/15 text-foreground/60",
  needs_user: "bg-fuchsia-400/25 text-fuchsia-200",
  retrying: "bg-amber-400/20 text-amber-200",
  completed: "bg-emerald-400/20 text-emerald-200",
  failed: "bg-red-500/25 text-red-200",
  archived: "bg-foreground/10 text-foreground/40",
};

export function ExecutivePanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listQueue);
  const setFn = useServerFn(updateQueueStatus);
  const retryFn = useServerFn(retryQueueTask);
  const delFn = useServerFn(deleteQueueTask);

  const q = useQuery({ queryKey: ["queue"], queryFn: () => listFn({ data: undefined }), refetchInterval: 3000 });
  const rows = q.data ?? [];

  const active = rows.filter((r) => ["pending", "queued", "running", "waiting", "retrying", "needs_user"].includes(r.status));
  const done = rows.filter((r) => r.status === "completed");
  const failed = rows.filter((r) => r.status === "failed");

  async function set(id: string, status: "completed" | "paused" | "queued") {
    try { await setFn({ data: { id, status } }); qc.invalidateQueries({ queryKey: ["queue"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }
  async function retry(id: string) {
    try { await retryFn({ data: { id } }); qc.invalidateQueries({ queryKey: ["queue"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }
  async function remove(id: string) {
    try { await delFn({ data: { id } }); qc.invalidateQueries({ queryKey: ["queue"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-3">
      <Column title="Active objectives" items={active} render={(r) => (
        <Row row={r} onDone={() => set(r.id, "completed")} onPause={() => set(r.id, "paused")} onRetry={() => retry(r.id)} onDel={() => remove(r.id)} />
      )} />
      <Column title="Completed" items={done.slice(0, 40)} render={(r) => <Row row={r} />} />
      <Column title="Needs attention" items={failed.slice(0, 40)} render={(r) => (
        <Row row={r} onRetry={() => retry(r.id)} onDel={() => remove(r.id)} />
      )} />
    </div>
  );
}

type QRow = Awaited<ReturnType<typeof listQueue>>[number];

function Column({ title, items, render }: { title: string; items: QRow[]; render: (r: QRow) => React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h4 className="text-[10px] uppercase tracking-[0.3em] text-foreground/60">{title}</h4>
        <span className="text-[10px] text-foreground/40">{items.length}</span>
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {items.length === 0 && <div className="rounded-md border border-dashed border-white/10 py-6 text-center text-[11px] text-foreground/40">nothing here</div>}
        {items.map((r) => <div key={r.id}>{render(r)}</div>)}
      </div>
    </section>
  );
}

function Row({ row, onDone, onPause, onRetry, onDel }: {
  row: QRow;
  onDone?: () => void; onPause?: () => void; onRetry?: () => void; onDel?: () => void;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
      <div className="flex items-center gap-2">
        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.22em]", STATUS_COLOR[row.status] ?? "")}>{row.status}</span>
        <span className="text-[10px] text-foreground/50">P{row.priority}</span>
        <span className="ml-auto text-[10px] text-foreground/40">{row.agent}</span>
      </div>
      <div className="mt-1 text-xs text-foreground/85 line-clamp-2">{row.title}</div>
      {row.error && <div className="mt-1 text-[10px] text-red-300 line-clamp-2">{row.error}</div>}
      <div className="mt-1.5 flex items-center gap-1">
        {onDone && <IconBtn title="Complete" onClick={onDone}><Check className="size-3" /></IconBtn>}
        {onPause && <IconBtn title="Pause" onClick={onPause}><Pause className="size-3" /></IconBtn>}
        {onRetry && <IconBtn title="Retry" onClick={onRetry}><RotateCw className="size-3" /></IconBtn>}
        {onDel && <IconBtn title="Delete" onClick={onDel}><Trash2 className="size-3" /></IconBtn>}
      </div>
    </div>
  );
}
function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded text-foreground/60 hover:bg-white/10 hover:text-foreground">
      {children}
    </button>
  );
}