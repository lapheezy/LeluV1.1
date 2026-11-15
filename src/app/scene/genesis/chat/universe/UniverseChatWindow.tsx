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
import Model3DView from "../Model3DView";

/** A file attached in this window; a 3D file keeps its bytes so the reply can open it in three.js. */
interface PendingAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  preview: string;
  dataUrl?: string;
}
import { buildStage, contentMessages } from "../stage/conversationModel";
import { specOf, useWorks } from "../stage/works";
import type { DeckSpec } from "../../../../../core/studio/StudioTypes";
import { artifactKey, environmentOf, recommendEnvironment } from "../../../../../core/interface/Environments";
import { parseWorkspaceCommand } from "../../../../../core/interface/WorkspaceSteward";
import StudioStore from "../../../../../core/studio/StudioStore";

const AUTO_OFF_KEY = "lelu.autoEnvironments.off";
function autoEnvironmentsOff(): boolean {
  try { return window.localStorage.getItem(AUTO_OFF_KEY) === "1"; } catch { return false; }
}
function setAutoEnvironmentsOff(off: boolean): void {
  try { if (off) window.localStorage.setItem(AUTO_OFF_KEY, "1"); else window.localStorage.removeItem(AUTO_OFF_KEY); } catch { /* best-effort */ }
}
import StageSwitcher from "../stage/StageSwitcher";
import CinematicStage from "../stage/CinematicStage";
import GalleryStage from "../stage/GalleryStage";
import PresentStage from "../stage/PresentStage";
import "../stage/stage.css";

const BoardStage = lazy(() => import("../stage/BoardStage"));
// The making/finding environments and their Studio wiring: one lazy chunk.
const EnvironmentStage = lazy(() => import("../stage/EnvironmentStages"));
const ScenesPanel = lazy(() => import("../stage/EnvironmentStages").then((m) => ({ default: m.ScenesPanel })));
const VisualsPanel = lazy(() => import("../stage/EnvironmentStages").then((m) => ({ default: m.VisualsPanel })));
const DeckExport = lazy(() => import("../stage/EnvironmentStages").then((m) => ({ default: m.DeckExport })));
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
  const [spatialTab, setSpatialTab] = useState<"scenes" | "ideas">("scenes");
  // A deck built in this conversation is what Present plays.
  const conversationWorks = useWorks(conversationId);
  const deckWork = conversationWorks.find((w) => w.kind === "deck");
  const deck = deckWork ? (specOf(deckWork) as DeckSpec) : null;
  // Files attached here ride with the message into the thread.
  const [attached, setAttached] = useState<PendingAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const moduleId = chatWindowId(conversationId);
  const presentation = genesis.state.modules[moduleId]?.presentation ?? "inline";
  const threadRef = useRef<HTMLDivElement>(null);
  const messageCount = conversation?.messages.length ?? 0;
  const lastText = conversation?.messages[messageCount - 1]?.text ?? "";
  const model = useMemo(
    () => buildStage(conversation?.title ?? "", contentMessages(conversation?.messages ?? [])),
    // Rebuilt when the conversation grows or its last (streaming) message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversation?.title, messageCount, lastText],
  );

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messageCount, conversation?.processing, stage]);

  /*
   * LÉLU arranges the environment for the work, when a turn finishes:
   * what was asked and what was made decide (Environments.recommendEnvironment,
   * rules — no model call). Only from plain Chat, never over a stage the
   * person chose; explicit layout commands already staged themselves.
   */
  const [autoNote, setAutoNote] = useState<{ stage: StageMode; reason: string } | null>(null);
  // Keyed on the reply itself arriving (a finished assistant message), not on
  // a processing flag: direct-command turns never set one. Replies that were
  // already here when the window opened are history, not new work.
  const lastMsg = conversation?.messages[conversation.messages.length - 1];
  const seenReply = useRef<string | null>(lastMsg?.id ?? null);
  const lastStatus = lastMsg?.activity?.status;
  useEffect(() => {
    if (!conversation || !lastMsg || lastMsg.role !== "assistant" || lastMsg.id === seenReply.current) return;
    if (lastStatus === "running" || conversation.processing) return;
    seenReply.current = lastMsg.id;
    if (lastMsg.provider === "lelu-environment" || lastMsg.provider === "lelu-trail") return;
    if (WorkspaceStewardStore.stageOf(conversation.id) !== "conversation") return;
    if (autoEnvironmentsOff()) return;
    const msgs = conversation.messages;
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUser || parseWorkspaceCommand(lastUser.text)) return;
    const studio = StudioStore.getInstance();
    const made = (lastMsg.activity?.artifacts ?? []).map((a) => {
      const art = studio.get(a.artifactId);
      const medium = art ? (studio.latest(art).spec as { medium?: string }).medium : undefined;
      return artifactKey({ kind: art?.kind ?? a.kind, medium });
    });
    const asked = lastUser.text.replace(/^\/(research|chart|scene|film|diagram|art|data|sketch|collection)\b/, (_m, c: string) => ({ research: "research", chart: "chart of", scene: "3d scene", film: "film", diagram: "diagram", art: "artwork", data: "data on", sketch: "sketch", collection: "fashion collection" })[c] ?? c);
    // Research briefs are documents, but the work was research: the request leads there.
    const rec = /^\/research\b/.test(lastUser.text) ? recommendEnvironment(asked) : recommendEnvironment(asked, made);
    if (!rec || rec.stage === "conversation") return;
    WorkspaceStewardStore.setStage(conversation.id, rec.stage);
    if (environmentOf(rec.stage).layout === "fullscreen") WorkspaceStewardStore.setMode("fullscreen", chatWindowId(conversation.id));
    WorkspaceStewardStore.record({ by: "lelu", what: `environment → ${rec.stage}`, reasons: [`opened ${environmentOf(rec.stage).label} because ${rec.reason} (no model call)`] });
    setAutoNote(rec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMsg?.id, lastStatus, conversation?.processing]);

  if (!conversation) {
    return (
      <div className="lst-root" data-stage="conversation">
        <p className="lcu-empty">The conversation was deleted, so its window has nothing to show.</p>
        <button type="button" className="lst-chip" onClick={onClose}>Close window</button>
      </div>
    );
  }

  const attach = async (list: FileList | null) => {
    if (!list?.length) return;
    const next: PendingAttachment[] = [];
    for (const file of [...list].slice(0, 4)) {
      let dataUrl: string | undefined;
      if (/\.(glb|gltf|stl|obj)$/i.test(file.name) && file.size <= 24 * 1024 * 1024) {
        try {
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
            reader.readAsDataURL(file);
          });
        } catch {
          dataUrl = undefined;
        }
      }
      next.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, preview: "", ...(dataUrl ? { dataUrl } : {}) });
    }
    setAttached((current) => [...current, ...next].slice(-4));
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = () => {
    const text = draft.trim();
    if (!text && attached.length === 0) return;
    if (conversation.id !== MultiChatStore.getInstance().getActiveId()) genesis.switchConversation(conversation.id);
    window.dispatchEvent(new CustomEvent(UNIVERSE_SEND_EVENT, { detail: { text, conversationId: conversation.id, files: attached } }));
    setDraft("");
    setAttached([]);
  };
  const setStage = (next: StageMode) => {
    genesis.raiseModule(moduleId);
    WorkspaceStewardStore.setStage(conversation.id, next);
    if (environmentOf(next).layout === "fullscreen") WorkspaceStewardStore.setMode("fullscreen", moduleId);
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
      {attached.length ? (
        <div className="lcu-attached" aria-label="Attachments">
          {attached.map((file) => (
            <span key={file.id} className="lcu-attached-file" title={file.name}>
              {file.name}
              <button type="button" className="lcu-icon sm" aria-label={`Remove ${file.name}`} onClick={() => setAttached((current) => current.filter((item) => item.id !== file.id))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" className="lcu-icon" aria-label="Attach a file" onClick={() => fileRef.current?.click()}>+</button>
      <input ref={fileRef} type="file" multiple accept="image/*,video/*,.txt,.md,.json,.csv,.pdf,.glb,.gltf,.stl,.obj" hidden onChange={(event) => void attach(event.target.files)} />
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
      <button type="submit" className="lcu-send" disabled={!draft.trim() && attached.length === 0} aria-label={`Send to ${conversation.title}`}>
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
              {/* A 3D file the user attached to this message, opened in the thread. */}
              {m.role === "user" && m.models?.length ? (
                <div className="lelu-cc-models">
                  {m.models.map((model) => <Model3DView key={`${m.id}-${model.name}`} model={model} />)}
                </div>
              ) : null}
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
      body = (
        <div className="lst-stack">
          <Suspense fallback={null}><VisualsPanel conversationId={conversation.id} model={model} /></Suspense>
          <GalleryStage model={model} thread={thread} />
        </div>
      );
      break;
    case "present":
      body = (
        <div className="lst-stack">
          <Suspense fallback={null}><DeckExport conversationId={conversation.id} model={model} /></Suspense>
          <PresentStage model={model} deck={deck} onExit={() => setStage("conversation")} />
        </div>
      );
      break;
    case "research":
    case "document":
    case "diagram":
    case "data":
    case "code":
    case "film":
    case "voice":
    case "studio":
      body = (
        <Suspense fallback={<StageLoading label={stage} />}>
          <EnvironmentStage stage={stage} conversationId={conversation.id} model={model} messages={conversation.messages} setStage={setStage} />
        </Suspense>
      );
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
        <div className="lst-stack" data-spatial-tab={spatialTab}>
          <div className="lst-subtabs" role="tablist" aria-label="3D">
            <button type="button" role="tab" aria-selected={spatialTab === "scenes"} data-on={spatialTab === "scenes"} onClick={() => setSpatialTab("scenes")}>Scenes &amp; models</button>
            <button type="button" role="tab" aria-selected={spatialTab === "ideas"} data-on={spatialTab === "ideas"} onClick={() => setSpatialTab("ideas")}>Ideas in space</button>
          </div>
          <Suspense fallback={<StageLoading label="3D environment" />}>
            {spatialTab === "ideas" ? <SpatialStage model={model} /> : <ScenesPanel conversationId={conversation.id} model={model} />}
          </Suspense>
        </div>
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
      {autoNote && autoNote.stage === stage ? (
        <div className="lst-autonote" role="status" data-lelu-auto-environment={autoNote.stage}>
          <span>✦ LÉLU opened <strong>{environmentOf(autoNote.stage).label}</strong> — {autoNote.reason}.</span>
          <button type="button" onClick={() => { setAutoNote(null); setStage("conversation"); }}>Back to chat</button>
          <button type="button" onClick={() => { setAutoNote(null); setAutoEnvironmentsOff(true); }}>Don't switch automatically</button>
          <button type="button" aria-label="Dismiss" onClick={() => setAutoNote(null)}>×</button>
        </div>
      ) : null}
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
