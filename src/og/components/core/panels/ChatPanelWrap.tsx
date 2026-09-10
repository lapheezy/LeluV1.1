import { useEffect, useState } from "react";
import { ChatPanel } from "@og/components/universe/ChatPanel";
import { createConversation } from "@og/lib/conversations.functions";

export function ChatPanelWrap({ initialThreadId }: { initialThreadId?: string }) {
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);

  useEffect(() => {
    if (threadId) return;
    let cancel = false;
    createConversation({ data: {} })
      .then((c) => { if (!cancel) setThreadId(c.id); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [threadId]);

  if (!threadId) {
    return (
      <div className="grid h-full place-items-center text-[11px] uppercase tracking-[0.3em] text-foreground/50">
        opening a thread…
      </div>
    );
  }
  return (
    <div className="h-full w-full overflow-hidden">
      <ChatPanel key={threadId} threadId={threadId} />
    </div>
  );
}