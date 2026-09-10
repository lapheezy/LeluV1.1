import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useMemo, useState } from "react";
import { listMemoryEvents } from "@og/lib/memory-events.functions";
import { cn } from "@og/lib/utils";

const KINDS = ["all", "created", "updated", "merged", "deleted", "recalled"] as const;

const KIND_STYLE: Record<string, string> = {
  created: "bg-emerald-500/15 text-emerald-200",
  updated: "bg-sky-500/15 text-sky-200",
  merged: "bg-violet-500/15 text-violet-200",
  deleted: "bg-red-500/15 text-red-200",
  recalled: "bg-amber-500/15 text-amber-200",
};

export function MemoryLogPanel() {
  const listFn = useServerFn(listMemoryEvents);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["memory-events", kind],
    queryFn: () =>
      listFn({ data: kind === "all" ? undefined : { kind } }),
    refetchInterval: 6000,
  });

  const filtered = useMemo(() => {
    const rows = q.data ?? [];
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.reason ?? "").toLowerCase().includes(s) ||
      JSON.stringify(r.detail ?? {}).toLowerCase().includes(s),
    );
  }, [q.data, search]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 p-3 space-y-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reason or detail…"
          className="w-full rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-white/25"
        />
        <div className="flex items-center gap-2 overflow-x-auto">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "shrink-0 rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.24em]",
                kind === k ? "bg-white/10 text-foreground" : "text-foreground/50 hover:text-foreground",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {q.isLoading && <div className="text-[11px] text-foreground/40">loading…</div>}
        {!q.isLoading && filtered.length === 0 && (
          <div className="text-[11px] text-foreground/40">No memory events yet.</div>
        )}
        <ul className="space-y-1.5">
          {filtered.map((row) => (
            <li key={row.id} className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded-full px-1.5 text-[9px] uppercase tracking-[0.2em]",
                  KIND_STYLE[row.kind] ?? "bg-white/10 text-foreground/80",
                )}>
                  {row.kind}
                </span>
                {row.memory_id && (
                  <span className="text-foreground/40 font-mono text-[10px]">
                    {row.memory_id.slice(0, 8)}
                  </span>
                )}
                <span className="ml-auto text-foreground/30">
                  {new Date(row.created_at).toLocaleString()}
                </span>
              </div>
              {row.reason && (
                <div className="mt-0.5 text-foreground/70">{row.reason}</div>
              )}
              {row.detail && Object.keys(row.detail as object).length > 0 && (
                <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-foreground/40">
                  {JSON.stringify(row.detail, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}