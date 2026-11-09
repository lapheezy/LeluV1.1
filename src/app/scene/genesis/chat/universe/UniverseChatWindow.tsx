/**
 * LÉLU — one Chat Universe conversation, as a module window body.
 *
 * The Universe lists the chats; opening one opens `chat:<id>` in the ONE
 * window host (GenesisModuleHost). Chrome, drag, resize, z-order, minimize
 * chips and saved geometry are therefore the shared module window's — this
 * file is only the content that host chrome wraps:
 *
 *   GenesisWindowFrame  the same frame every panel uses (inside a module
 *                       window it renders as the body heading, so there is
 *                       exactly one title bar per window)
 *   the live turn       the same activity card the chat panel shows
 *   the transcript      the conversation's own stored messages
 *   the composer        the same send path (`lelu-universe-send`) GenesisChat
 *                       already listens to, so streaming, tools, queueing,
 *                       steering and persistence are the ones that work
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { chatWindowId, useGenesis } from "../../GenesisCore";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import { hasVisibleActivity } from "../../../../../core/multichat/TurnActivity";
import ChatActivityCard from "../ChatActivity";
import ChatMarkdown from "../ChatMarkdown";
import StudioArtifactCards from "../../studio/StudioArtifactCards";
import { currentActivity, subscribeActivity } from "../activityRecorder";
import GenesisWindowFrame from "../../GenesisWindowFrame";
import GenesisExecutionTimeline from "../../GenesisExecutionTimeline";
import { UNIVERSE_SEND_EVENT } from "./ChatUniverse";

/** The turn running in this chat, from the same record the chat panel shows. */
function useLiveActivity(conversationId: string) {
  const subscribe = useCallback((cb: () => void) => subscribeActivity(cb), []);
  const snapshot = useCallback(() => currentActivity(conversationId), [conversationId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export default function UniverseChatWindow({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const genesis = useGenesis();
  const { conversations } = genesis.state;
  const conversation = useMemo(
    () => conversations.find((c) => c.id === conversationId) ?? null,
    [conversations, conversationId],
  );
  const liveActivity = useLiveActivity(conversationId);
  const [draft, setDraft] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const moduleId = chatWindowId(conversationId);
  const presentation = genesis.state.modules[moduleId]?.presentation ?? "inline";
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [conversation?.messages.length, conversation?.processing]);

  if (!conversation) {
    return (
      <GenesisWindowFrame eyebrow="Chat Universe" title="This chat is gone" onClose={onClose}>
        <p className="lcu-empty">The conversation was deleted, so its window has nothing to show.</p>
      </GenesisWindowFrame>
    );
  }

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (conversation.id !== MultiChatStore.getInstance().getActiveId()) genesis.switchConversation(conversation.id);
    window.dispatchEvent(new CustomEvent(UNIVERSE_SEND_EVENT, { detail: { text, conversationId: conversation.id } }));
    setDraft("");
  };

  const action = (label: string, run: () => void, pressed?: boolean) => (
    <button
      type="button"
      role="menuitem"
      className="lcu-win-action"
      aria-pressed={pressed}
      onClick={() => {
        setControlsOpen(false);
        run();
      }}
    >
      {label}
    </button>
  );

  return (
    <GenesisWindowFrame
      eyebrow="Chat Universe"
      title={conversation.title}
      onClose={onClose}
      active={conversation.processing}
      overflow="hidden"
      extraActions={
        <span className="lcu-win-head-actions">
          {conversation.processing ? <span className="lcu-live">Active</span> : null}
          <button
            type="button"
            className="lcu-win-controls-toggle"
            aria-label="Chat controls"
            aria-haspopup="menu"
            aria-expanded={controlsOpen}
            onClick={() => setControlsOpen((open) => !open)}
          >
            ⚙ Controls
          </button>
        </span>
      }
    >
      <div className="lcu-win-body" data-lelu-universe-window={conversation.id}>
        <div className="lcu-win-controls" data-open={controlsOpen ? "true" : "false"}>
          <div className="lcu-win-controls-row" role="menu" aria-label={`${conversation.title} controls`}>
            {action(conversation.pinned ? "Unpin conversation" : "Pin conversation", () => MultiChatStore.getInstance().pin(conversation.id), conversation.pinned)}
            {action("Minimize", () => genesis.minimizeModule(moduleId))}
            {action(presentation === "expanded" ? "Restore window" : "Maximize", () => genesis.setModulePresentation(moduleId, presentation === "expanded" ? "inline" : "expanded"))}
            {action("Chat settings", () => genesis.openPanel("settings"))}
            {action("Close window", onClose)}
          </div>
        </div>
        {/* A consent point must be decidable where the person is looking. The
            card lives in GenesisExecutionTimeline, but the chat panel is
            mounted hidden behind this window and draws nothing — so the same
            card, reading the same bus and the same durable ApprovalGate, is
            rendered here. It is inert (renders nothing) without a request. */}
        <GenesisExecutionTimeline key={conversation.id} conversationId={conversation.id} approvalsOnly />
        {hasVisibleActivity(liveActivity) ? (
          <div className="lcu-activity">
            <ChatActivityCard activity={liveActivity!} />
            {/* What the running turn has made so far — inside this conversation. */}
            {conversation.processing && liveActivity?.artifacts?.length ? <StudioArtifactCards artifacts={liveActivity.artifacts} /> : null}
          </div>
        ) : null}
        <div
          className="lcu-thread"
          ref={threadRef}
          data-lelu-universe-thread
          data-streaming={conversation.processing ? "true" : "false"}
        >
          {conversation.messages.length === 0 ? <p className="lcu-empty">Say something to start this chat.</p> : null}
          {conversation.messages.slice(-60).map((m) => (
            <div key={m.id} className="lcu-msg" data-role={m.role}>
              {m.role === "assistant" ? <span className="lcu-msg-orb" aria-hidden="true" /> : null}
              <div className="lcu-bubble">
                {/* LÉLU writes markdown; the same renderer as the classic chat transcript. */}
                {m.role === "assistant" ? <ChatMarkdown text={m.text} /> : <p>{m.text}</p>}
                {/* Documents, decks, spreadsheets and designs this reply made, with their verified files. */}
                {m.role === "assistant" && m.activity?.artifacts?.length ? <StudioArtifactCards artifacts={m.activity.artifacts} /> : null}
              </div>
            </div>
          ))}
          {conversation.processing ? (
            <div className="lcu-typing" data-lelu-universe-typing role="status" aria-live="polite">
              <span /><span /><span />
            </div>
          ) : null}
        </div>
        <form
          className="lcu-win-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <textarea
            rows={1}
            value={draft}
            placeholder="Message LÉLU…"
            aria-label={`Message ${conversation.title}`}
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className="lcu-send" disabled={!draft.trim()} aria-label={`Send to ${conversation.title}`}>
            Send
          </button>
        </form>
      </div>
    </GenesisWindowFrame>
  );
}
