import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { listQueue } from "@og/lib/queue.functions";
import { Bot } from "lucide-react";

export function AgentsPanel() {
  const listFn = useServerFn(listQueue);
  const q = useQuery({ queryKey: ["queue", "agents"], queryFn: () => listFn({ data: undefined }), refetchInterval: 4000 });
  const rows = q.data ?? [];
  const byAgent = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byAgent.get(r.agent) ?? [];
    list.push(r);
    byAgent.set(r.agent, list);
  }
  const agents = Array.from(byAgent.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="grid h-full grid-cols-1 gap-3 overflow-y-auto p-3 md:grid-cols-2">
      {agents.length === 0 && (
        <div className="col-span-full rounded-lg border border-dashed border-white/10 py-10 text-center text-xs text-foreground/50">
          No agents have been dispatched yet.
        </div>
      )}
      {agents.map(([name, list]) => {
        const active = list.filter((r) => ["running", "queued", "pending", "retrying", "waiting"].includes(r.status)).length;
        return (
          <section key={name} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <header className="mb-2 flex items-center gap-2">
              <Bot className="size-4 text-foreground/60" />
              <span className="text-sm font-medium">{name}</span>
              <span className="ml-auto text-[10px] uppercase tracking-[0.24em] text-foreground/40">
                {active} active · {list.length} total
              </span>
            </header>
            <ul className="space-y-1">
              {list.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-1 text-xs">
                  <span className="text-foreground/50">{r.status}</span>
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}