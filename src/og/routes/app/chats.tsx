import { createFileRoute, Link } from "@og/compat/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@og/compat/server-fn";
import { useState } from "react";
import { toast } from "sonner";
import { listAllConversations, updateConversation } from "@og/lib/conversations.functions";
import {
  safeDeleteConversation,
  recoverConversation,
  preserveConversation,
  searchConversations,
} from "@og/lib/conversation-admin.functions";
import { listUniverses } from "@og/lib/universes.functions";
import { Pin, PinOff, Archive, Trash2, Pencil, LifeBuoy, FileText, Search } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@og/components/ui/alert-dialog";

export const Route = createFileRoute("/app/chats")({ component: ChatsPage });

type DeepResults = Awaited<ReturnType<typeof searchConversations>>;

function ChatsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllConversations);
  const updateFn = useServerFn(updateConversation);
  const safeDeleteFn = useServerFn(safeDeleteConversation);
  const recoverFn = useServerFn(recoverConversation);
  const preserveFn = useServerFn(preserveConversation);
  const searchFn = useServerFn(searchConversations);
  const universesFn = useServerFn(listUniverses);

  const chats = useQuery({ queryKey: ["chats"], queryFn: () => listFn() });
  const universes = useQuery({ queryKey: ["universes"], queryFn: () => universesFn() });

  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [deepQuery, setDeepQuery] = useState("");
  const [deepResults, setDeepResults] = useState<DeepResults | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function patch(id: string, p: Record<string, unknown>) {
    try {
      await updateFn({ data: { id, ...p } });
      qc.invalidateQueries({ queryKey: ["chats"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  }

  async function confirmDelete(id: string) {
    try {
      const res = await safeDeleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success(res.summary_id ? "Removed — summary preserved." : "Conversation removed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete.");
    } finally {
      setConfirmDeleteId(null);
    }
  }

  async function recover(id: string) {
    try {
      const r = await recoverFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["chats"] });
      toast.success(`Recovered. Removed ${r.removed} corrupted, kept ${r.kept}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recovery failed.");
    }
  }

  async function preserve(id: string) {
    try {
      const r = await preserveFn({ data: { id, reason: "manual" } });
      toast.success(`Preserved (${r.message_count} msgs, ${r.topics.length} topics).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Preserve failed.");
    }
  }

  async function runDeepSearch() {
    const q = deepQuery.trim();
    if (!q) return;
    try {
      const r = await searchFn({ data: { query: q, limit: 10 } });
      setDeepResults(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed.");
    }
  }

  const rows = (chats.data ?? [])
    .filter((c) => (showArchived ? c.archived : !c.archived))
    .filter((c) => !search.trim() || (c.title ?? "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl">Conversations</h1>
        <p className="text-foreground/60 text-sm mt-1">
          Rename, pin, archive, recover, preserve, delete — they're yours.{" "}
          <Link to="/app/chats/archive" className="underline">View preserved summaries →</Link>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by title…"
          className="flex-1 min-w-[240px] px-3 py-2 rounded-md bg-card/50 border border-border/40 text-sm"
        />
        <label className="flex items-center gap-2 text-sm text-foreground/60">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Archived
        </label>
      </div>

      <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-foreground/50">
          <Search className="size-3.5" /> Deep search (titles + messages + preserved summaries)
        </div>
        <div className="flex gap-2">
          <input
            value={deepQuery}
            onChange={(e) => setDeepQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runDeepSearch(); }}
            placeholder="e.g. the conversation about the Sapiolingo launch"
            className="flex-1 px-3 py-2 rounded-md bg-background border border-border/40 text-sm"
          />
          <button onClick={runDeepSearch} className="px-3 py-2 rounded-md bg-foreground/10 hover:bg-foreground/20 text-sm">Find</button>
        </div>
        {deepResults && (
          <div className="space-y-2 text-sm">
            {deepResults.titleMatches.length === 0 && deepResults.messageMatches.length === 0 && deepResults.summaryMatches.length === 0 && (
              <div className="text-foreground/50">No matches.</div>
            )}
            {deepResults.titleMatches.map((c) => (
              <Link key={`t-${c.id}`} to="/chat/$threadId" params={{ threadId: c.id }} className="block rounded border border-border/30 p-2 hover:bg-foreground/5">
                <span className="text-foreground/50 text-xs mr-2">title</span> {c.title}
              </Link>
            ))}
            {deepResults.messageMatches.map((c) => (
              <Link key={`m-${c.id}`} to="/chat/$threadId" params={{ threadId: c.id }} className="block rounded border border-border/30 p-2 hover:bg-foreground/5">
                <span className="text-foreground/50 text-xs mr-2">in messages</span> {c.title}
              </Link>
            ))}
            {deepResults.summaryMatches.map((s) => (
              <div key={`s-${s.id}`} className="rounded border border-border/30 p-2">
                <div className="text-foreground/50 text-xs">preserved · {s.original_title}</div>
                <div className="text-foreground/80 text-sm line-clamp-3">{s.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="text-foreground/50 text-sm py-10 text-center border border-dashed border-border/40 rounded-lg">
            {showArchived ? "Nothing archived." : "No conversations yet."}
          </div>
        )}
        {rows.map((c) => {
          const universeName = universes.data?.find((u) => u.id === c.universe_id)?.name;
          const recoveryState = (c as { recovery_state?: string }).recovery_state;
          const unstable = recoveryState && recoveryState !== "healthy";
          return (
            <div key={c.id} className={`rounded-lg border ${unstable ? "border-destructive/50" : "border-border/40"} bg-card/30 p-3 flex items-center gap-3`}>
              <div className="min-w-0 flex-1">
                {editing === c.id ? (
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={async () => {
                      setEditing(null);
                      if (editTitle && editTitle !== c.title) await patch(c.id, { title: editTitle });
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    className="w-full px-2 py-1 rounded bg-background border border-border/40 text-sm"
                  />
                ) : (
                  <Link to="/chat/$threadId" params={{ threadId: c.id }} className="text-sm hover:text-foreground text-foreground/80">
                    {c.pinned && <span className="text-foreground/40 mr-1">📌</span>}
                    {c.title || "Untitled"}
                    {unstable && <span className="ml-2 text-[10px] uppercase tracking-wider text-destructive">needs recovery</span>}
                  </Link>
                )}
                <div className="text-[11px] text-foreground/40 flex items-center gap-2 mt-0.5">
                  <span>{new Date(c.updated_at).toLocaleString()}</span>
                  {universeName && <span>· {universeName}</span>}
                </div>
              </div>
              <select
                value={c.universe_id ?? ""}
                onChange={(e) => patch(c.id, { universe_id: e.target.value || null })}
                className="px-2 py-1 rounded bg-background/50 border border-border/40 text-xs text-foreground/70"
                title="Assign to universe"
              >
                <option value="">(no universe)</option>
                {(universes.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <button title="Rename" onClick={() => { setEditing(c.id); setEditTitle(c.title || ""); }} className="p-2 rounded hover:bg-foreground/10 text-foreground/60">
                  <Pencil className="size-4" />
                </button>
                <button title={c.pinned ? "Unpin" : "Pin"} onClick={() => patch(c.id, { pinned: !c.pinned })} className="p-2 rounded hover:bg-foreground/10 text-foreground/60">
                  {c.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                </button>
                <button title={c.archived ? "Unarchive" : "Archive"} onClick={() => patch(c.id, { archived: !c.archived })} className="p-2 rounded hover:bg-foreground/10 text-foreground/60">
                  <Archive className="size-4" />
                </button>
                <button title="Preserve as summary" onClick={() => preserve(c.id)} className="p-2 rounded hover:bg-foreground/10 text-foreground/60">
                  <FileText className="size-4" />
                </button>
                <button title="Recover (repair corrupted messages)" onClick={() => recover(c.id)} className="p-2 rounded hover:bg-foreground/10 text-foreground/60">
                  <LifeBuoy className="size-4" />
                </button>
                <button title="Delete (preserves summary first)" onClick={() => setConfirmDeleteId(c.id)} className="p-2 rounded hover:bg-destructive/20 text-foreground/60 hover:text-destructive">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              A summary — including topics, message count, and project link — will be preserved first.
              The conversation itself and its messages will then be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDeleteId && confirmDelete(confirmDeleteId)}>
              Preserve & delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
