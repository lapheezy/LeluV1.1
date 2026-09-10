import { createFileRoute } from "@og/compat/router";
import { useEffect, useState } from "react";
import {
  listQueue,
  retryQueueTask,
  updateQueueStatus,
  deleteQueueTask,
  QUEUE_STATUSES,
  type QueueStatus,
} from "@og/lib/queue.functions";
import { listSystemEvents } from "@og/lib/system.functions";
import { ListChecks, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/app/queue")({ component: QueuePage });

type QueueRow = Awaited<ReturnType<typeof listQueue>>[number];
type EventRow = Awaited<ReturnType<typeof listSystemEvents>>[number];

function QueuePage() {
  const [filter, setFilter] = useState<QueueStatus | "all">("all");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    const [q, e] = await Promise.all([
      listQueue({ data: filter === "all" ? undefined : { status: filter } }),
      listSystemEvents({ data: { limit: 50 } }),
    ]);
    setRows(q);
    setEvents(e);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Action queue</h1>
          <p className="text-foreground/60 text-sm mt-1">
            Every action Lélu takes is tracked here. Nothing is lost.
          </p>
        </div>
        <button
          onClick={refresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/40 px-2.5 py-1.5 text-xs uppercase tracking-[0.2em] text-foreground/70 hover:bg-foreground/5"
        >
          <RefreshCw className="size-3" />
          refresh
        </button>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="all" />
        {QUEUE_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={filter === s}
            onClick={() => setFilter(s)}
            label={s.replace("_", " ")}
          />
        ))}
      </div>

      <section className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-foreground/50">loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-foreground/50">
            <ListChecks className="mx-auto size-6 text-foreground/30 mb-2" />
            no actions for this filter
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((r) => (
              <QueueItem
                key={r.id}
                row={r}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg">Recent system events</h2>
        <div className="rounded-xl border border-border/40 bg-card/30 overflow-hidden">
          {events.length === 0 ? (
            <div className="p-6 text-center text-xs text-foreground/50">no events</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {events.map((e) => (
                <li key={e.id} className="px-3 py-2 text-xs flex items-center gap-2">
                  <SeverityDot severity={e.severity} />
                  <span className="text-foreground/50 w-32 shrink-0 truncate">{e.kind}</span>
                  <span className="flex-1 truncate text-foreground/80">{e.message ?? "—"}</span>
                  <time className="text-foreground/40 shrink-0">
                    {new Date(e.created_at).toLocaleTimeString()}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition ${
        active
          ? "border-sun/60 bg-sun/15 text-foreground"
          : "border-border/40 text-foreground/55 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function QueueItem({ row, onChanged }: { row: QueueRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="px-3 py-3 flex items-start gap-3">
      <StatusBadge status={row.status as QueueStatus} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground truncate">{row.title}</span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/40">
            {row.agent}
          </span>
        </div>
        {row.error && (
          <p className="text-xs text-destructive/80 mt-0.5 truncate">{row.error}</p>
        )}
        <p className="text-[10px] text-foreground/40 mt-0.5">
          {new Date(row.updated_at).toLocaleString()}
          {row.retries > 0 && ` · retries ${row.retries}`}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {row.status === "failed" && (
          <button
            disabled={busy}
            onClick={() =>
              act(() => retryQueueTask({ data: { id: row.id } }))
            }
            className="text-[10px] uppercase tracking-[0.2em] text-foreground/60 hover:text-foreground px-2 py-1"
          >
            retry
          </button>
        )}
        {row.status !== "archived" && row.status !== "completed" && (
          <button
            disabled={busy}
            onClick={() =>
              act(() =>
                updateQueueStatus({ data: { id: row.id, status: "archived" } }),
              )
            }
            className="text-[10px] uppercase tracking-[0.2em] text-foreground/40 hover:text-foreground px-2 py-1"
          >
            archive
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => act(() => deleteQueueTask({ data: { id: row.id } }))}
          className="text-[10px] uppercase tracking-[0.2em] text-destructive/60 hover:text-destructive px-2 py-1"
        >
          delete
        </button>
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: QueueStatus }) {
  const color =
    status === "completed"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
      : status === "failed"
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : status === "running" || status === "retrying"
          ? "bg-sun/15 text-sun border-sun/30"
          : status === "needs_user" || status === "waiting" || status === "paused"
            ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
            : "bg-foreground/10 text-foreground/60 border-border/40";
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] ${color}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "fatal"
      ? "bg-destructive"
      : severity === "error"
        ? "bg-destructive/80"
        : severity === "warn"
          ? "bg-amber-400"
          : "bg-foreground/40";
  return <span className={`size-1.5 rounded-full shrink-0 ${color}`} />;
}