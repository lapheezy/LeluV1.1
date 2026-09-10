import { createFileRoute, Link, useNavigate } from "@og/compat/router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { listUniverses } from "@og/lib/universes.functions";
import { listAllConversations, createConversation } from "@og/lib/conversations.functions";
import { listMemories } from "@og/lib/memories.functions";
import { Orbit, MessageSquare, Library, Plus } from "lucide-react";

export const Route = createFileRoute("/app/")({ component: AppHome });

function AppHome() {
  const navigate = useNavigate();
  const universesFn = useServerFn(listUniverses);
  const chatsFn = useServerFn(listAllConversations);
  const memsFn = useServerFn(listMemories);
  const newChat = useServerFn(createConversation);

  const universes = useQuery({ queryKey: ["universes"], queryFn: () => universesFn() });
  const chats = useQuery({ queryKey: ["chats"], queryFn: () => chatsFn() });
  const mems = useQuery({ queryKey: ["memories", "recent"], queryFn: () => memsFn({ data: { archived: false } }) });

  const recentChats = (chats.data ?? []).slice(0, 5);
  const pinnedMems = (mems.data ?? []).filter((m) => m.pinned).slice(0, 5);
  const recentMems = (mems.data ?? []).slice(0, 6);

  return (
    <div className="space-y-10">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-4xl">Welcome back.</h1>
          <p className="text-foreground/60 text-sm mt-1">A quiet view of what's alive.</p>
        </div>
        <button
          onClick={async () => {
            const c = await newChat({ data: {} });
            navigate({ to: "/chat/$threadId", params: { threadId: c.id } });
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-sm hover:opacity-90"
        >
          <Plus className="size-4" /> New conversation
        </button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={Orbit} label="Universes" value={universes.data?.length ?? 0} to="/app/universes" />
        <StatCard icon={MessageSquare} label="Conversations" value={chats.data?.length ?? 0} to="/app/chats" />
        <StatCard icon={Library} label="Memories" value={mems.data?.length ?? 0} to="/app/memories" />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Recent conversations" link="/app/chats">
          {recentChats.length === 0 && <Empty>No conversations yet.</Empty>}
          {recentChats.map((c) => (
            <Link
              key={c.id}
              to="/chat/$threadId"
              params={{ threadId: c.id }}
              className="block py-2 border-b border-border/30 last:border-0 hover:text-foreground text-foreground/80"
            >
              <div className="text-sm">{c.title || "Untitled"}</div>
              <div className="text-[11px] text-foreground/40">{new Date(c.updated_at).toLocaleString()}</div>
            </Link>
          ))}
        </Panel>
        <Panel title="Pinned memories" link="/app/memories">
          {pinnedMems.length === 0 && recentMems.length === 0 && <Empty>No memories yet.</Empty>}
          {(pinnedMems.length > 0 ? pinnedMems : recentMems).map((m) => (
            <div key={m.id} className="py-2 border-b border-border/30 last:border-0">
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">{m.category}</div>
              <div className="text-sm">{m.title || m.key}</div>
              <div className="text-xs text-foreground/60 line-clamp-2">{m.summary || m.value}</div>
            </div>
          ))}
        </Panel>
      </section>

      <section>
        <Panel title="Your universes" link="/app/universes">
          {(universes.data ?? []).length === 0 && (
            <Empty>
              No universes yet. Ask Lélu: <em className="text-foreground/80">"create a universe for Sapiolingo Fashion"</em>.
            </Empty>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(universes.data ?? []).map((u) => (
              <Link
                key={u.id}
                to="/app/universes/$id"
                params={{ id: u.id }}
                className="block p-4 rounded-lg border border-border/40 bg-card/40 hover:bg-card/60 transition"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block size-2 rounded-full" style={{ background: u.color || "oklch(0.8 0.13 75)" }} />
                  <div className="font-display text-lg">{u.name}</div>
                </div>
                {u.description && <p className="text-xs text-foreground/60 mt-1 line-clamp-2">{u.description}</p>}
              </Link>
            ))}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, to }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; to: string }) {
  return (
    <Link to={to} className="block p-5 rounded-xl border border-border/40 bg-card/40 hover:bg-card/60 transition">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.25em] text-foreground/50">{label}</span>
        <Icon className="size-4 text-foreground/40" />
      </div>
      <div className="font-display text-4xl mt-3">{value}</div>
    </Link>
  );
}

function Panel({ title, link, children }: { title: string; link?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/30 p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-xl">{title}</h2>
        {link && (
          <Link to={link} className="text-[10px] uppercase tracking-[0.25em] text-foreground/50 hover:text-foreground">
            view all
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-foreground/50 py-4">{children}</div>;
}