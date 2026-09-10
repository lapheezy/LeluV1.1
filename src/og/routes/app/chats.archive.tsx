import { createFileRoute, Link } from "@og/compat/router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { listConversationSummaries } from "@og/lib/conversation-admin.functions";

export const Route = createFileRoute("/app/chats/archive")({ component: ArchivePage });

function ArchivePage() {
  const fn = useServerFn(listConversationSummaries);
  const q = useQuery({ queryKey: ["chat-summaries"], queryFn: () => fn() });

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl">Preserved summaries</h1>
          <p className="text-foreground/60 text-sm mt-1">
            What remains when a conversation is removed. Nothing important is lost.
          </p>
        </div>
        <Link to="/app/chats" className="text-sm underline text-foreground/70">← Back to conversations</Link>
      </header>

      <div className="space-y-3">
        {q.isLoading && <div className="text-foreground/50 text-sm">Loading…</div>}
        {q.data && q.data.length === 0 && (
          <div className="text-foreground/50 text-sm py-10 text-center border border-dashed border-border/40 rounded-lg">
            No preserved summaries yet.
          </div>
        )}
        {(q.data ?? []).map((s) => (
          <article key={s.id} className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-medium">{s.original_title || "Untitled"}</h2>
              <span className="text-[11px] text-foreground/40">
                {s.message_count} msgs · {new Date(s.updated_at).toLocaleDateString()} · {s.preserved_reason}
              </span>
            </div>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">{s.summary}</p>
            {Array.isArray(s.topics) && s.topics.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {s.topics.map((t: string) => (
                  <span key={t} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-foreground/10 text-foreground/60">{t}</span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
