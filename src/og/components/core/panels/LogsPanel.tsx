import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useMemo, useState } from "react";
import { listSystemEvents } from "@og/lib/system.functions";
import { useProcessing } from "../ProcessingProvider";
import { cn } from "@og/lib/utils";

const SEVERITIES = ["all", "info", "warn", "error", "fatal"] as const;

/** Kinds treated as operational (Processing tab). Chain-of-thought never lands here. */
const OPERATIONAL_PREFIXES = [
  "chat.",
  "tool:",
  "memory.",
  "api.",
  "search.",
  "workflow.",
  "model.",
  "browser.",
  "token.",
];

function isOperational(kind: string) {
  return OPERATIONAL_PREFIXES.some((p) => kind.startsWith(p));
}

export function LogsPanel() {
  const listFn = useServerFn(listSystemEvents);
  const [tab, setTab] = useState<"processing" | "system">("processing");
  const [sev, setSev] = useState<(typeof SEVERITIES)[number]>("all");
  const q = useQuery({
    queryKey: ["logs", sev],
    queryFn: () => listFn({ data: sev === "all" ? undefined : { severity: sev } }),
    refetchInterval: 4000,
  });
  const tasks = useProcessing((s) => s.tasks);
  const history = useProcessing((s) => s.history);

  const rows = q.data ?? [];
  const opRows = useMemo(() => rows.filter((r) => isOperational(r.kind)), [rows]);
  const sysRows = useMemo(() => rows.filter((r) => !isOperational(r.kind)), [rows]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
        {(["processing", "system"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.24em]",
              tab === t ? "bg-white/10 text-foreground" : "text-foreground/50 hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 overflow-x-auto">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => setSev(s)}
              className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[9px] uppercase tracking-[0.24em]",
                sev === s ? "bg-white/10 text-foreground" : "text-foreground/50 hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-3">
        {tab === "processing" ? (
          <>
            <section>
              <div className="mb-1 text-[9px] uppercase tracking-[0.32em] text-foreground/45">Live processing</div>
              {tasks.length === 0 && <div className="text-[11px] text-foreground/40">idle</div>}
              <ul className="space-y-1">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs">
                    <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
                    <span className="text-foreground/80">{t.kind}</span>
                    {t.label && <span className="text-foreground/50 truncate">· {t.label}</span>}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <div className="mb-1 text-[9px] uppercase tracking-[0.32em] text-foreground/45">Recent tasks</div>
              <ul className="space-y-1">
                {history.slice(0, 20).map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-[11px] text-foreground/60">
                    <span className="size-1.5 rounded-full bg-emerald-300/70" />
                    <span>{t.kind}</span>
                    {t.label && <span className="opacity-70">· {t.label}</span>}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <div className="mb-1 text-[9px] uppercase tracking-[0.32em] text-foreground/45">Operations</div>
              {q.isLoading && <div className="text-[11px] text-foreground/40">loading…</div>}
              {!q.isLoading && opRows.length === 0 && (
                <div className="text-[11px] text-foreground/40">No operational events yet.</div>
              )}
              <ul className="space-y-1">
                {opRows.map((row) => (
                  <EventRow key={row.id} row={row} />
                ))}
              </ul>
            </section>
          </>
        ) : (
          <section>
            <div className="mb-1 text-[9px] uppercase tracking-[0.32em] text-foreground/45">System events</div>
            {q.isLoading && <div className="text-[11px] text-foreground/40">loading…</div>}
            {!q.isLoading && sysRows.length === 0 && (
              <div className="text-[11px] text-foreground/40">Nothing to report.</div>
            )}
            <ul className="space-y-1">
              {sysRows.map((row) => (
                <EventRow key={row.id} row={row} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

type Row = {
  id: string;
  kind: string;
  severity: string;
  source: string | null;
  message: string | null;
  created_at: string;
};

function EventRow({ row }: { row: Row }) {
  return (
    <li className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-[11px]">
      <div className="flex items-center gap-2">
        <span className={cn(
          "rounded-full px-1.5 text-[9px] uppercase tracking-[0.2em]",
          row.severity === "info" && "bg-sky-500/15 text-sky-200",
          row.severity === "warn" && "bg-amber-500/15 text-amber-200",
          row.severity === "error" && "bg-red-500/15 text-red-200",
          row.severity === "fatal" && "bg-red-600/25 text-red-100",
        )}>{row.severity}</span>
        <span className="text-foreground/80">{row.kind}</span>
        {row.source && <span className="text-foreground/40">· {row.source}</span>}
        <span className="ml-auto text-foreground/30">{new Date(row.created_at).toLocaleTimeString()}</span>
      </div>
      {row.message && <div className="mt-0.5 text-foreground/60 break-words">{row.message}</div>}
    </li>
  );
}