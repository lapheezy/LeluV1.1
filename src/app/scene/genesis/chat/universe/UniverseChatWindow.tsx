/**
 * LÉLU — one Chat Universe conversation, as a module window body.
 *
 * The Universe lists the chats; opening one opens `chat:<id>` in the ONE
 * window host (GenesisModuleHost). Chrome, drag, resize, z-order, tabs and
 * layout are the Workspace Steward's — this file is the content:
 *
 *   the stage bar       how this conversation is staged: Chat, Cinematic,
 *                       Board, Gallery, Present, 3D (WorkspaceStewardStore,
 *                       the same state LÉLU's workspace.stage tool sets)
 *   the live turn       the same activity card the chat panel shows
 *   the stage           every stage reads the SAME stored messages through
 *                       chat/stage/conversationModel — never a copy
 *   the composer        the same send path (`lelu-universe-send`) GenesisChat
 *                       already listens to, so streaming, tools, queueing,
 *                       steering and persistence are the ones that work
 *
 * Board (React Flow) and 3D (react-three-fiber) are lazy chunks: a person
 * who never opens them never downloads them.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { chatWindowId, useGenesis } from "../../GenesisCore";
import MultiChatStore from "../../../../../core/multichat/MultiChatStore";
import { hasVisibleActivity } from "../../../../../core/multichat/TurnActivity";
import WorkspaceStewardStore from "../../../../../core/interface/WorkspaceStewardStore";
import type { StageMode } from "../../../../../core/interface/WorkspaceSteward";
import ChatActivityCard from "../ChatActivity";
import ChatMarkdown from "../ChatMarkdown";
import StudioArtifactCards from "../../studio/StudioArtifactCards";
import { currentActivity, subscribeActivity } from "../activityRecorder";
import GenesisExecutionTimeline from "../../GenesisExecutionTimeline";
import { UNIVERSE_SEND_EVENT } from "./ChatUniverse";
import { buildStage } from "../stage/conversationModel";
import StageSwitcher from "../stage/StageSwitcher";
import CinematicStage from "../stage/CinematicStage";
import GalleryStage from "../stage/GalleryStage";
import PresentStage from "../stage/PresentStage";
import "../stage/stage.css";

const BoardStage = lazy(() => import("../stage/BoardStage"));
const SpatialStage = lazy(() => import("../stage/SpatialStage"));

/** The turn running in this chat, from the same record the chat panel shows. */
function useLiveActivity(conversationId: string) {
  const subscribe = useCallback((cb: () => void) => subscribeActivity(cb), []);
  const snapshot = useCallback(() => currentActivity(conversationId), [conversationId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function useStage(conversationId: string): StageMode {
  const snapshot = useCallback(() => WorkspaceStewardStore.stageOf(conversationId), [conversationId]);
  return useSyncExternalStore(WorkspaceStewardStore.subscribe, snapshot, snapshot);
}

function StageLoading({ label }: { label: string }) {
  return <div className="lst-loading" role="status">Composing the {label}…</div>;
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
  const stage = useStage(conversationId);
  const [draft, setDraft] = useState("");
  const [controlsOpen, setControlsOpen] = useState(false);
  const moduleId = chatWindowId(conversationId);
  const presentation = genesis.state.modules[moduleId]?.presentation ?? "inline";
  const threadRef = useRef<HTMLDivElement>(null);
  const messageCount = conversation?.messages.length ?? 0;
  const lastText = conversation?.messages[messageCount - 1]?.text ?? "";
  const model = useMemo(
    () => buildStage(conversation?.title ?? "", conversation?.messages ?? []),
    // Rebuilt when the conversation grows or its last (streaming) message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation?.title, messageCount, lastText],
  );

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messageCount, conversation?.processing, stage]);

  if (!conversation) {
    return (
      <div className="lst-root" data-stage="conversation">
        <p className="lcu-empty">The conversation was deleted, so its window has nothing to show.</p>
        <button type="button" className="lst-chip" onClick={onClose}>Close window</button>
      </div>
    );
  }

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (conversation.id !== MultiChatStore.getInstance().getActiveId()) genesis.switchConversation(conversation.id);
    window.dispatchEvent(new CustomEvent(UNIVERSE_SEND_EVENT, { detail: { text, conversationId: conversation.id } }));
    setDraft("");
  };
  const setStage = (next: StageMode) => {
    genesis.raiseModule(moduleId);
    WorkspaceStewardStore.setStage(conversation.id, next);
    if (next === "present" || next === "spatial" || next === "cinematic") WorkspaceStewardStore.setMode("fullscreen", moduleId);
    else if (WorkspaceStewardStore.get().mode === "fullscreen") WorkspaceStewardStore.setMode("auto", moduleId);
    WorkspaceStewardStore.record({ by: "user", what: `stage → ${next}`, reasons: [`${conversation.title} staged as ${next}`] });
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

  const composer = (
    <form
      className="lcu-win-composer lst-composer"
      data-stage-composer={stage}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        rows={1}
        value={draft}
        placeholder={stage === "conversation" ? "Message LÉLU…" : "Message LÉLU — try “tile my windows”"}
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
  );

  const thread = (
    <div
      className="lcu-thread lst-thread"
      ref={threadRef}
      data-lelu-universe-thread
      data-streaming={conversation.processing ? "true" : "false"}
    >
      {conversation.messages.length === 0 ? <p className="lcu-empty">Say something to start this chat.</p> : null}
      <AnimatePresence initial={false}>
        {conversation.messages.slice(-60).map((m) => (
          <motion.div
            key={m.id}
            className="lcu-msg"
            data-role={m.role}
            layout="position"
            initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            {m.role === "assistant" ? <span className="lcu-msg-orb" aria-hidden="true" /> : null}
            <div className="lcu-bubble">
              {/* LÉLU writes markdown; the same renderer as the classic chat transcript. */}
              {m.role === "assistant" ? <ChatMarkdown text={m.text} /> : <p>{m.text}</p>}
              {/* Documents, decks, spreadsheets and designs this reply made, with their verified files. */}
              {m.role === "assistant" && m.activity?.artifacts?.length ? <StudioArtifactCards artifacts={m.activity.artifacts} /> : null}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {conversation.processing ? (
        <div className="lcu-typing" data-lelu-universe-typing role="status" aria-live="polite">
          <span /><span /><span />
        </div>
      ) : null}
    </div>
  );

  let body: React.ReactNode;
  switch (stage) {
    case "cinematic":
      body = <CinematicStage model={model} processing={conversation.processing} />;
      break;
    case "gallery":
      body = <GalleryStage model={model} thread={thread} />;
      break;
    case "present":
      body = <PresentStage model={model} onExit={() => setStage("conversation")} />;
      break;
    case "board":
      body = (
        <Suspense fallback={<StageLoading label="research board" />}>
          <BoardStage conversationId={conversation.id} model={model} />
        </Suspense>
      );
      break;
    case "spatial":
      body = (
        <Suspense fallback={<StageLoading label="3D environment" />}>
          <SpatialStage model={model} />
        </Suspense>
      );
      break;
    default:
      body = thread;
  }

  return (
    <div className="lcu-win-body lst-root" data-lelu-universe-window={conversation.id} data-stage={stage}>
      <div className="lst-bar">
        <StageSwitcher stage={stage} onChange={setStage} counts={{ media: model.media.length, sections: model.sections.length }} />
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
            ⚙
          </button>
        </span>
      </div>
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
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stage}
          className="lst-stage"
          initial={{ opacity: 0, scale: 0.985, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.01, filter: "blur(6px)" }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
      {stage === "present" ? null : composer}
    </div>
  );
}
