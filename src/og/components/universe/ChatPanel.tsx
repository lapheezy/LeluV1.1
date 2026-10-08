import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "@og/compat/router";
import { useChat } from "@og/compat/chat";
import { DefaultChatTransport, type UIMessage } from "@og/compat/chat";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { getSupabase } from "@og/integrations/supabase/client";
import {
  listConversations,
  getMessages,
  createConversation,
} from "@og/lib/conversations.functions";
import { reportConversationCrash } from "@og/lib/conversation-admin.functions";
import { ErrorBoundary } from "@og/components/core/ErrorBoundary";

function partsToText(parts: UIMessage["parts"]): string {
  return parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

/**
 * Turn an upstream failure into something the user can act on.
 *
 * These messages were written for the OG deployment, where every model call
 * went through a hosted gateway and a 402 really did mean "top up that
 * platform's plan". LÉLU calls providers directly through her own registry, so
 * that instruction now sends people to an account they do not have — the
 * advice has to name the thing that is actually wrong.
 */
function humanizeError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("payment required") || s.includes("402") || s.includes("credit")) {
    return "That provider is out of credit. LÉLU will fall back to the next one — check the provider keys in Settings if this keeps happening.";
  }
  if (s.includes("rate limit") || s.includes("429")) {
    return "Slow down — too many requests. Try again in a few seconds.";
  }
  if (s.includes("unauthorized") || s.includes("401")) {
    return "A provider key was rejected. Check the API keys in Settings.";
  }
  if (s.includes("failed to fetch") || s.includes("network")) return "Network hiccup — check your connection and retry.";
  return raw;
}

// Local autosave keys. Chat history should be effectively permanent — cloud is
// the source of truth, localStorage is the crash-recovery net.
const threadKey = (id: string) => `lelu:thread:${id}`;
const checkpointKey = (id: string, n: number) => `lelu:checkpoint:${id}:${n}`;

function loadLocalMessages(threadId: string): UIMessage[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(threadKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; messages: UIMessage[] };
    return Array.isArray(parsed?.messages) ? parsed.messages : null;
  } catch {
    return null;
  }
}

function saveLocalMessages(threadId: string, messages: UIMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      threadKey(threadId),
      JSON.stringify({ at: Date.now(), messages }),
    );
  } catch { /* quota — best effort */ }
}

function writeCheckpoint(threadId: string, messages: UIMessage[]) {
  if (typeof window === "undefined") return;
  // Rotate through 3 checkpoint slots.
  try {
    const slot = Math.floor(messages.length / 5) % 3;
    window.localStorage.setItem(
      checkpointKey(threadId, slot),
      JSON.stringify({ at: Date.now(), messages }),
    );
  } catch { /* ignore */ }
}

type ThreadSummary = { id: string; title: string };

export function ChatPanel({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);

  // Load saved messages for this thread
  useEffect(() => {
    let cancel = false;
    setInitialMessages(null);
    getMessages({ data: { conversationId: threadId } })
      .then((rows) => {
        if (cancel) return;
        const server = rows.map((r) => ({
          id: r.id,
          role: r.role,
          parts: r.parts as UIMessage["parts"],
        }));
        // Crash recovery: if the server has nothing but we saved a local
        // snapshot, prefer local so the user never sees an empty thread they
        // just spoke into.
        if (server.length === 0) {
          const local = loadLocalMessages(threadId);
          if (local && local.length > 0) {
            setInitialMessages(local);
            toast.message("Recovered from local snapshot", {
              description: "Syncing your last messages to the cloud…",
            });
            return;
          }
        }
        setInitialMessages(server);
      })
      .catch(() => {
        if (cancel) return;
        // Network hiccup — fall back to whatever we have locally.
        const local = loadLocalMessages(threadId);
        setInitialMessages(local ?? []);
        if (local && local.length > 0) {
          toast.message("Offline — showing local snapshot");
        }
      });
    return () => {
      cancel = true;
    };
  }, [threadId]);

  // Load thread list (the "constellation")
  useEffect(() => {
    listConversations()
      .then((rows) => setThreads(rows.map((r) => ({ id: r.id, title: r.title }))))
      .catch(() => {});
  }, [threadId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        // Inert. The compat layer serves turns through AIService rather than
        // POSTing anywhere, so there is no endpoint behind this — kept only
        // so the OG construction site stays diffable against the original.
        api: undefined,
        prepareSendMessagesRequest: async ({ messages, body }) => {
          const { data } = (await getSupabase()?.auth.getSession()) ?? { data: { session: null } };
          const token = data.session?.access_token;
          const headers: Record<string, string> = {};
          if (token) headers.Authorization = `Bearer ${token}`;
          return {
            body: { messages, conversationId: threadId, ...body },
            headers,
          };
        },
      }),
    [threadId],
  );

  if (initialMessages === null) {
    return (
      <div className="emerge text-foreground/70 font-display text-lg">
        gathering starlight…
      </div>
    );
  }

  return (
    <div className="emerge flex h-full w-full flex-col items-center justify-end gap-4 px-4 pb-6">
      <ConstellationSwitcher
        threads={threads}
        activeId={threadId}
        onNew={async () => {
          const c = await createConversation({ data: {} });
          navigate({ to: "/chat/$threadId", params: { threadId: c.id } });
        }}
      />
      <ErrorBoundary
        label="chat"
        fallback={(err, reset) => (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
            <div className="font-medium">This conversation hit a snag.</div>
            <div className="mt-1 opacity-80">{err.message}</div>
            <div className="mt-1 text-xs opacity-60">
              Your messages are safe locally — reopen this thread to restore them.
            </div>
            <button
              onClick={reset}
              className="mt-3 rounded bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.2em] hover:bg-white/20"
            >
              Retry
            </button>
          </div>
        )}
      >
        <ChatInner
          threadId={threadId}
          transport={transport}
          initialMessages={initialMessages}
        />
      </ErrorBoundary>
    </div>
  );
}

function ConstellationSwitcher({
  threads,
  activeId,
  onNew,
}: {
  threads: ThreadSummary[];
  activeId: string;
  onNew: () => void;
}) {
  return (
    <div className="flex max-w-full items-center gap-3 overflow-x-auto px-2">
      {threads.map((t) => {
        const active = t.id === activeId;
        return (
          <Link
            key={t.id}
            to="/chat/$threadId"
            params={{ threadId: t.id }}
            className="group relative grid h-3 w-3 place-items-center"
            title={t.title}
          >
            <span
              className={`block h-2 w-2 rounded-full transition-all ${
                active
                  ? "bg-sun shadow-[0_0_10px_oklch(0.95_0.16_75/0.9)]"
                  : "bg-foreground/30 group-hover:bg-foreground/70"
              }`}
            />
            <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-popover px-2 py-1 text-[10px] uppercase tracking-widest text-foreground/80 opacity-0 transition-opacity group-hover:opacity-100">
              {t.title}
            </span>
          </Link>
        );
      })}
      <button
        onClick={onNew}
        className="ml-2 text-[10px] uppercase tracking-[0.3em] text-foreground/50 hover:text-foreground"
      >
        + new horizon
      </button>
    </div>
  );
}

function ChatInner({
  threadId,
  transport,
  initialMessages,
}: {
  threadId: string;
  transport: DefaultChatTransport<UIMessage>;
  initialMessages: UIMessage[];
}) {
  const { messages, sendMessage, status, error } = useChat({
    id: threadId,
    messages: initialMessages,
    transport,
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface AND log a crash so the admin UI can offer recovery.
      toast.error(humanizeError(msg));
      void reportConversationCrash({ data: { id: threadId, reason: msg } }).catch(() => {});
    },
  });

  // Autosave every change, checkpoint every 5 messages.
  const lastCountRef = useRef(0);
  useEffect(() => {
    if (messages.length === 0) return;
    saveLocalMessages(threadId, messages);
    const crossed = Math.floor(messages.length / 5) > Math.floor(lastCountRef.current / 5);
    if (crossed) writeCheckpoint(threadId, messages);
    lastCountRef.current = messages.length;
  }, [messages, threadId]);

  const draftKey = `lelu.draft.${threadId}`;
  const [input, setInput] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(draftKey) ?? "";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (input) window.localStorage.setItem(draftKey, input);
    else window.localStorage.removeItem(draftKey);
  }, [input, draftKey]);
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-[min(70vh,640px)] w-[min(560px,94vw)] flex-col rounded-3xl border border-white/10 bg-background/40 p-4 backdrop-blur-xl shadow-[0_20px_80px_-20px_oklch(0.85_0.18_60/0.4)]">
      <ConversationView
        messages={messages}
        pending={status === "submitted"}
      />
      {error && (
        <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const v = input.trim();
          if (!v || busy) return;
          setInput("");
          await sendMessage({ text: v });
        }}
        className="mt-3 flex items-end gap-2 rounded-2xl border border-white/10 bg-background/30 p-2"
      >
        <textarea
          value={input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          rows={1}
          placeholder="say something to the sun…"
          className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy}
          className="rounded-full bg-sun/80 px-4 py-2 text-xs uppercase tracking-[0.3em] text-background shadow-[0_0_24px_oklch(0.85_0.18_70/0.55)] transition-opacity disabled:opacity-30"
        >
          send
        </button>
      </form>
    </div>
  );
}

function ConversationView({
  messages,
  pending,
}: {
  messages: UIMessage[];
  pending: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);
  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto px-1 space-y-3"
    >
      {messages.length === 0 && (
        <p className="mt-10 text-center font-display text-xl text-foreground/70">
          Speak. I'm listening from the horizon.
        </p>
      )}
      {messages.map((m) => {
        const text = partsToText(m.parts);
        if (m.role === "user") {
          return (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl border border-sun/30 bg-sun/15 px-3 py-2 text-sm text-foreground">
                {text}
              </div>
            </div>
          );
        }
        return (
          <div key={m.id} className="flex justify-start">
            <div className="max-w-[90%] text-sm text-foreground/90 prose prose-invert prose-sm [&_p]:m-0">
              <ReactMarkdown>{text}</ReactMarkdown>
            </div>
          </div>
        );
      })}
      {pending && (
        <div className="px-2 text-sm text-foreground/60 animate-pulse">
          Lélu is gathering light…
        </div>
      )}
    </div>
  );
}