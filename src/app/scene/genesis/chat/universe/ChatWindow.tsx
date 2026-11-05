/**
 * LÉLU — a conversation as a managed window (module `chat:<conversationId>`).
 *
 * The frame (drag, resize, raise, minimise, expand, close, viewport bounds)
 * is GenesisModuleHost's — the one window system. This file is only:
 *   ChatWindowBody        — a VIEW of an existing MultiChatStore conversation
 *                           (never creates one), its live activity, an input
 *   ChatWindowPersistence — layout save/restore (geometry only, no transcript)
 *
 * Sending goes through GenesisChat's single send path (`lelu-universe-send`)
 * after the conversation is made active, so there is one writer per chat.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowRight } from "lucide-react";
import { CHAT_WINDOW_PREFIX, useGenesis } from "../../GenesisCore";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import { hasVisibleActivity } from "../../../../../core/multichat/TurnActivity";
import ChatActivityCard from "../ChatActivity";
import { currentActivity, subscribeActivity } from "../activityRecorder";
import { relativeTime } from "./universeModel";
import { loadChatWindows, saveChatWindows, snapshotFromModules } from "./chatWindowLayout";

export const chatWindowId = (conversationId: string) => `${CHAT_WINDOW_PREFIX}${conversationId}`;

export function ChatWindowBody({ conversationId }: { conversationId: string }) {
  const genesis = useGenesis();
  const conversation = genesis.state.conversations.find((c) => c.id === conversationId) ?? null;
  const subscribe = useCallback((cb: () => void) => subscribeActivity(cb), []);
  const snapshot = useCallback(() => currentActivity(conversationId), [conversationId]);
  const activity = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [conversation?.messages.length, conversation?.processing]);

  if (!conversation) return <p className="lcw-empty">This chat no longer exists.</p>;

  // Interacting with a window makes its chat the universal composer's target.
  const target = () => {
    if (MultiChatStore.getInstance().getActiveId() !== conversationId) genesis.switchConversation(conversationId);
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    target();
    window.dispatchEvent(new CustomEvent("lelu-universe-send", { detail: { text, conversationId } }));
    setDraft("");
  };

  return (
    <div className="lcw" data-lelu-chat-window={conversationId} onPointerDown={target}>
      {hasVisibleActivity(activity) ? (
        <div className="lcw-activity"><ChatActivityCard activity={activity!} /></div>
      ) : null}
      <div className="lcw-thread" ref={threadRef} data-streaming={conversation.processing ? "true" : "false"}>
        {conversation.messages.length === 0 ? <p className="lcw-empty">Say something to start this chat.</p> : null}
        {conversation.messages.slice(-80).map((m) => (
          <div key={m.id} className="lcw-msg" data-role={m.role}>
            <p>{m.text}</p>
            <time>{relativeTime(m.timestamp)}</time>
          </div>
        ))}
        {conversation.processing ? <div className="lcw-typing" role="status" aria-live="polite"><span /><span /><span /></div> : null}
      </div>
      <form className="lcw-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          rows={1}
          value={draft}
          placeholder={`Message ${conversation.title}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          enterKeyHint="send"
          aria-label={`Message ${conversation.title}`}
        />
        <button type="submit" disabled={!draft.trim()} aria-label={`Send to ${conversation.title}`}><ArrowRight size={17} /></button>
      </form>
    </div>
  );
}

/**
 * Restores the saved chat windows once on boot, then saves their layout
 * whenever GenesisCore's module state for `chat:*` changes.
 */
export function ChatWindowPersistence() {
  const genesis = useGenesis();
  const { modules, conversations } = genesis.state;
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || conversations.length === 0) return;
    restored.current = true;
    const saved = loadChatWindows();
    const known = new Set(conversations.map((c) => c.id));
    const ids = Object.keys(saved.windows).filter((id) => known.has(id));
    // Lowest first so the saved top window ends on top.
    ids.sort((a, b) => (saved.windows[a].zIndex ?? 0) - (saved.windows[b].zIndex ?? 0));
    for (const id of ids) {
      const layout = saved.windows[id];
      const moduleId = chatWindowId(id);
      genesis.openModule(moduleId);
      if (layout.position) genesis.moveModule(moduleId, layout.position);
      if (layout.size) genesis.resizeModule(moduleId, layout.size);
      if (layout.presentation === "minimized") genesis.minimizeModule(moduleId);
      else if (layout.presentation === "expanded") genesis.expandModule(moduleId);
      else genesis.raiseModule?.(moduleId);
    }
    if (saved.active && known.has(saved.active)) genesis.switchConversation(saved.active);
  }, [conversations, genesis]);

  const key = JSON.stringify(snapshotFromModules(modules, CHAT_WINDOW_PREFIX));
  useEffect(() => {
    if (!restored.current) return;
    saveChatWindows(JSON.parse(key));
  }, [key]);

  return null;
}
