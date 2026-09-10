import { useState } from "react";
import { useServerFn } from "@og/compat/server-fn";
import { useProcessing } from "../ProcessingProvider";
import { Search, X } from "lucide-react";
import { runWebSearch } from "@og/lib/research.functions";

type Session = {
  id: string;
  query: string;
  startedAt: number;
  status: "running" | "done" | "error";
  taskId?: string;
  sources: { title: string; url: string }[];
  error?: string;
};

export function ResearchPanel() {
  const proc = useProcessing();
  const searchFn = useServerFn(runWebSearch);
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);

  async function launch() {
    const q = query.trim();
    if (!q) return;
    const id = crypto.randomUUID();
    const taskId = proc.start({ kind: "searching", label: q });
    setSessions((prev) => [{ id, query: q, startedAt: Date.now(), status: "running", taskId, sources: [] }, ...prev]);
    setQuery("");
    try {
      const data = await searchFn({ data: { query: q } });
      if (!data.ok) throw new Error(data.error);
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, status: "done", sources: data.sources } : s));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, status: "error", error: msg } : s));
    } finally {
      proc.end(taskId);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={(e) => { e.preventDefault(); launch(); }}
        className="flex items-center gap-2 border-b border-white/10 p-3">
        <Search className="size-4 text-foreground/50" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Research a topic…"
          className="flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-sm outline-none focus:border-foreground/40" />
        <button type="submit" disabled={!query.trim()}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-foreground hover:bg-white/15 disabled:opacity-40">
          Search
        </button>
      </form>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {sessions.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 py-8 text-center text-xs text-foreground/50">
            Start a research session. Multiple can run at once.
          </div>
        )}
        {sessions.map((s) => (
          <div key={s.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2">
              <span className={
                s.status === "running" ? "size-1.5 animate-pulse rounded-full bg-amber-300"
                : s.status === "error" ? "size-1.5 rounded-full bg-red-400"
                : "size-1.5 rounded-full bg-emerald-300"
              } />
              <div className="min-w-0 flex-1 truncate text-sm">{s.query}</div>
              <button onClick={() => setSessions((p) => p.filter((x) => x.id !== s.id))}
                className="rounded p-1 text-foreground/50 hover:bg-white/10 hover:text-foreground"><X className="size-3" /></button>
            </div>
            {s.status === "running" && <div className="mt-2 h-1 overflow-hidden rounded bg-white/5"><div className="h-full w-1/2 animate-pulse bg-amber-300/60" /></div>}
            {s.status === "error" && <div className="mt-2 text-[11px] text-red-300">{s.error}</div>}
            {s.sources.length > 0 && (
              <ul className="mt-2 space-y-1">
                {s.sources.slice(0, 8).map((src, i) => (
                  <li key={i} className="truncate text-[11px]">
                    <a href={src.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">{src.title || src.url}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}