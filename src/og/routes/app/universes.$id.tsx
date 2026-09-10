import { createFileRoute, Link } from "@og/compat/router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { getUniverseDetail } from "@og/lib/universes.functions";

export const Route = createFileRoute("/app/universes/$id")({ component: UniverseDetail });

function UniverseDetail() {
  const { id } = Route.useParams();
  const fn = useServerFn(getUniverseDetail);
  const q = useQuery({ queryKey: ["universe", id], queryFn: () => fn({ data: { id } }) });

  if (q.isLoading) return <div className="text-foreground/60">Loading…</div>;
  if (!q.data?.universe) return <div className="text-foreground/60">Not found.</div>;

  const u = q.data.universe;
  const sections: { title: string; items: { id: string; label: string; meta?: string; to?: { route: "chat"; id: string } }[] }[] = [
    {
      title: "Conversations",
      items: q.data.conversations.map((c) => ({ id: c.id, label: c.title || "Untitled", meta: new Date(c.updated_at).toLocaleString(), to: { route: "chat", id: c.id } })),
    },
    {
      title: "Goals",
      items: q.data.goals.map((g) => ({ id: g.id, label: g.title, meta: g.status ?? undefined })),
    },
    {
      title: "Tasks",
      items: q.data.tasks.map((t) => ({ id: t.id, label: t.title, meta: t.done ? "done" : t.due_at ? `due ${new Date(t.due_at).toLocaleDateString()}` : undefined })),
    },
    {
      title: "Notes",
      items: q.data.notes.map((n) => ({ id: n.id, label: n.title, meta: new Date(n.updated_at).toLocaleDateString() })),
    },
    {
      title: "Files",
      items: q.data.files.map((f) => ({ id: f.id, label: f.title, meta: f.kind })),
    },
    {
      title: "Events",
      items: q.data.events.map((e) => ({ id: e.id, label: e.title, meta: new Date(e.starts_at).toLocaleString() })),
    },
    {
      title: "Reminders",
      items: q.data.reminders.map((r) => ({ id: r.id, label: r.title, meta: new Date(r.remind_at).toLocaleString() })),
    },
    {
      title: "Memories",
      items: q.data.memories.map((m) => ({ id: m.id, label: m.title || m.key, meta: `${m.category} · importance ${m.importance}` })),
    },
  ];

  return (
    <div className="space-y-8">
      <header>
        <Link to="/app/universes" className="text-[10px] uppercase tracking-[0.3em] text-foreground/50 hover:text-foreground">
          ← all universes
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <span className="inline-block size-3 rounded-full" style={{ background: u.color || "oklch(0.8 0.13 75)" }} />
          <h1 className="font-display text-4xl">{u.name}</h1>
        </div>
        {u.description && <p className="text-foreground/60 text-sm mt-2 max-w-3xl">{u.description}</p>}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {sections.map((s) => (
          <div key={s.title} className="rounded-xl border border-border/40 bg-card/30 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-xl">{s.title}</h2>
              <span className="text-[10px] uppercase tracking-[0.25em] text-foreground/40">{s.items.length}</span>
            </div>
            {s.items.length === 0 ? (
              <div className="text-sm text-foreground/40 py-4">Nothing here yet.</div>
            ) : (
              <ul className="space-y-2">
                {s.items.slice(0, 12).map((it) => (
                  <li key={it.id} className="text-sm">
                    {it.to ? (
                      <Link to="/chat/$threadId" params={{ threadId: it.to.id }} className="hover:text-foreground text-foreground/80">
                        {it.label}
                      </Link>
                    ) : (
                      <span className="text-foreground/80">{it.label}</span>
                    )}
                    {it.meta && <span className="text-foreground/40 text-[11px] ml-2">{it.meta}</span>}
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