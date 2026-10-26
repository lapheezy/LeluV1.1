/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CHAT — PERSISTENT CONVERSATION INTERFACE
 *
 * The primary chat surface of the unified LÉLU UI.
 * On mobile it fills the viewport as the main interaction
 * surface. On desktop it is a movable/resizable floating window.
 *
 * Conversation flows through the EXISTING pipeline:
 *   User (Enter)
 *     ↓
 *   AIService.chat()            ← the existing runtime
 *     ↓
 *   AIRuntime / providers / cognition / memory
 *     ↓
 *   response text                ← streamed into the UI
 *     ↓
 *   addMessage (user) + bridge-emitted assistant message
 *                                 ← history/memory unchanged
 * ==========================================================
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Command,
  Ellipsis,
  Expand,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  Menu,
  MessageCircle,
  Mic,
  Minimize2,
  PanelBottom,
  Plus,
  Search,
  Square,
  Video,
  X,
} from "lucide-react";

import AIService from "../../../core/AIService";
import Orchestrator from "../../../core/orchestrator/Orchestrator";
import AgentEventBus from "../../../core/agent/AgentEvents";
import GenesisExecutionTimeline from "./GenesisExecutionTimeline";
import { useVoice } from "../../../core/voice/useVoice";
import {
  defaultMediaPrompt,
  mediaDisplayLabel,
  processImageFile,
  processVideoFile,
  type ProcessedMedia,
} from "../../../core/media/mediaProcessor";
import { useGenesis, type GenesisMessage } from "./GenesisCore";
import ExplorationController from "./ExplorationController";
import ProactiveCore, { type ProactiveQuestion } from "../../../core/proactive/ProactiveCore";
import { openWorkstream } from "../../../core/proactive/Workstream";
import { markPerf } from "../../../core/perf/StartupTelemetry";
import { startTrace as latencyStart, mark as latencyMark, annotate as latencyAnnotate, traceError as latencyTraceError } from "../../../core/perf/LatencyProbe";
import { cleanAssistantText } from "../../../core/router/ToolMarkup";
import { useWorkspace } from "./useWorkspace";
import { layer } from "../../../core/ui/Layers";
import MultiChatStore from "../../../core/multichat/MultiChatStore";
import { bindMessage, claimTurn, ownerForTask, releaseTurn } from "../../../core/multichat/TurnOwnership";
import { finishActivity, hasVisibleActivity, type ChatActivity } from "../../../core/multichat/TurnActivity";
import { recordTurnActivity } from "./chat/activityRecorder";
import { notifyTurnOutcome } from "../../../core/notifications/NotificationRouting";
import ChatTranscript from "./chat/ChatTranscript";
import { describeFailure, isNearBottom, type ChatFailure } from "./chat/chatTranscript";
import { useDockInset } from "./chat/chatLayout";
import "./chat/cloudChat.css";

const ai = AIService.getInstance();
const proactive = ProactiveCore.getInstance();

/** One visible exchange: the user's line plus LÉLU's (possibly still being typed). */
interface Exchange {
  id: string;
  user: string;
  assistant: string;
  fast: boolean;
  /** Real images LÉLU produced for this exchange (render artifacts). */
  images?: string[];
  /**
   * What LÉLU is doing for this turn — searches, pages read, tools — built
   * from the turn's own events (chat/activityRecorder) while it runs.
   */
  activity?: ChatActivity;
  /**
   * This exchange was rebuilt from stored history, not asked just now.
   *
   * It matters for the empty-assistant case. A live exchange with no reply
   * yet shows the thinking dots, which is true — one is on its way. The
   * same shape replayed from a conversation whose last message was the
   * user's would show the same dots and mean something false: nothing is
   * being thought about, the reply simply never came.
   */
  settled?: boolean;
  /** The stored user message this turn wrote — anchors the turn in the transcript. */
  userMessageId?: string;
  /** Images the user attached to this turn (data URLs), shown with their message. */
  attachments?: string[];
  /** A failure LÉLU explains in the conversation instead of a raw error string. */
  error?: ChatFailure;
}

/**
 * Rebuild the visible exchange from a conversation's stored history.
 *
 * The last reply and the question that prompted it — or, when the last
 * thing said was the user's and no reply ever came, that line on its own,
 * marked settled so it does not pretend to still be thinking.
 *
 * Returns null for a conversation with nothing in it, which is the real
 * empty state and the one place the suggestion prompts belong.
 */
function replayExchange(messages: GenesisMessage[]): Exchange | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.text.trim()) continue;
    let user = "";
    for (let back = index - 1; back >= 0; back -= 1) {
      if (messages[back].role === "user") {
        user = messages[back].text;
        break;
      }
    }
    return {
      id: `replay-${message.id}`,
      user,
      assistant: cleanAssistantText(message.text),
      fast: true,
      settled: true,
    };
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user" && message.text.trim()) {
      return { id: `replay-${message.id}`, user: message.text, assistant: "", fast: true, settled: true };
    }
  }
  return null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ------------------------------------------------------------------
 * Generic file attachments
 * ------------------------------------------------------------------ */
interface PendingFile {
  id: string;
  name: string;
  type: string;
  size: number;
  preview: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


/* Height reserved for the fixed mobile LÉLU pill so the chat
 * composer is never covered by it. */
const MOBILE_PILL_RESERVE = 64;

function fileListLabel(files: PendingFile[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return `[File attached: ${files[0].name}]`;
  return `[${files.length} files attached]`;
}

function fileContextPrompt(files: PendingFile[]): string {
  if (files.length === 0) return "";
  const lines = files.map((file) => {
    const base = `- ${file.name} (${file.type || "file"}, ${formatFileSize(file.size)})`;
    return file.preview ? `${base}\n  content preview: ${file.preview}` : base;
  });
  return `Attached files for reference:\n${lines.join("\n")}`;
}

/* ----------------------------------------------------------
 * The dialogue layer itself.
 * ---------------------------------------------------------- */

export default function GenesisChat({ onExit }: { onExit?: () => void }) {
  const { state, openPanel, addMessage, upsertMessage, setDialogue, notify, crossChatContext, createConversation, minimize } = useGenesis();
  const voiceView = useVoice();
  const navigate = useNavigate();

  const [input, setInput] = useState("");

  /**
   * A SECOND SEND QUEUES. It is never dropped.
   *
   * This was a single `isSending` boolean that send() checked and
   * returned early on, so a message typed while a reply was streaming
   * was discarded: never answered, never in the conversation, with only
   * a disabled Send button to explain it. Orchestrator.process() already
   * refuses to make exactly that trade one layer down — it waits for the
   * in-flight request rather than returning a canned "I'm busy", because
   * "a stuck flag must never cost the user a turn". The UI was undoing
   * that above it.
   *
   * So turns now form a queue. `convTailsRef` holds the last turn per
   * promised; each new send awaits it and becomes the new tail. The
   * composer clears immediately, so the message is visibly accepted at
   * the moment it is sent, and is answered in order.
   *
   * The queue is deliberately GLOBAL rather than per conversation, and
   * that is not an oversight. A reply arrives through one global
   * subscription (AIService.subscribeMessages/subscribeStream) that
   * carries no conversation of its own; TurnOwnership attributes it to
   * whichever conversation currently holds the claim. Two turns in
   * flight at once therefore have no way to be told apart, and the
   * second one's claim would collect the first one's reply — the exact
   * "reply landed in the wrong chat" bug TurnOwnership exists to fix.
   * Running turns one at a time keeps attribution sound. Real
   * concurrency needs the reply channel to name its conversation first.
   *
   * What IS per conversation is the indicator: `sendingIn` records which
   * conversations have a turn outstanding, so looking at chat B does not
   * show chat A's spinner.
   */
  const [sendingIn, setSendingIn] = useState<readonly string[]>([]);
  /** Per-conversation tail of the turn queue. Different conversations run
   * concurrently; within one conversation turns stay in order. */
  const convTailsRef = useRef<Map<string, Promise<void>>>(new Map());
  /** Set when the user presses Stop — lets send() settle silently. */
  const cancelledRef = useRef(false);
  /** Text to send again from a failure's "Try again", read once by send(). */
  const retryRef = useRef<string | null>(null);
  const isSending = sendingIn.includes(state.activeConversationId);
  const [activeQuestion, setActiveQuestion] = useState<ProactiveQuestion | null>(null);
  /** What the user has typed in reply to the question on screen. */
  const [answerDraft, setAnswerDraft] = useState("");
  /** Which question the draft above was typed for. */
  const activeQuestionIdRef = useRef<string | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  /** Which conversation the visible exchange was built from. */
  const replayedForRef = useRef<string | null>(null);
  const artifactImagesRef = useRef<string[]>([]);

  // Stable ref for voice engine — avoids stale closure in send callback
  const voiceEngineRef = useRef(voiceView.engine);
  voiceEngineRef.current = voiceView.engine;

  // Real measurement: the chat surface is mounted and usable.
  useEffect(() => {
    markPerf("CHAT_READY");
  }, []);

  // Live artifact stream: when LÉLU's execution produces a real image
  useEffect(() => {
    return AgentEventBus.getInstance().subscribe((event) => {
      if (event.type !== "creative_artifact") return;
      // An image made for another conversation's turn is not this one's.
      const owner = ownerForTask(event.taskId);
      if (owner && owner !== MultiChatStore.getInstance().getActiveId()) return;
      const image = event.image;
      artifactImagesRef.current = [...artifactImagesRef.current, image];
      setExchange((current) =>
        current
          ? { ...current, images: [...new Set([...(current.images ?? []), image])] }
          : current,
      );
    });
  }, []);

  const [pendingMedia, setPendingMedia] = useState<ProcessedMedia[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  /** A chat menu is open — Escape closes it rather than leaving the chat. */
  const menusOpenRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const exchangeRef = useRef<Exchange | null>(null);
  /**
   * The turn in flight per conversation, so switching away and back shows
   * it still working — with its activity — instead of a settled replay.
   */
  const liveTurnsRef = useRef<Map<string, Exchange>>(new Map());
  /**
   * Messages sent INTO a running turn (AIService.steerTurn), per
   * conversation, oldest first. Any the turn never consumed are answered
   * as follow-up turns when it ends.
   */
  const steeredRef = useRef<Map<string, Array<{ text: string; userMessageId: string }>>>(new Map());
  /** A steered message being answered as its own turn, read once by send(). */
  const followUpRef = useRef<{ text: string; userMessageId: string; conversationId: string } | null>(null);
  const mountedAtRef = useRef(Date.now());
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    exchangeRef.current = exchange;
  }, [exchange]);

  // Proactive question surface.
  //
  // This used to return early whenever the store reported no active
  // question — including the moment one was dismissed, which is exactly
  // when the card needed to disappear. The card therefore stayed on
  // screen for the rest of the session and dismissing looked broken.
  // Now the store is the single source of truth in both directions: a
  // question shows the card, no question hides it.
  useEffect(() => {
    return proactive.subscribeQuestions((question) => {
      setActiveQuestion(question);
      // A draft belongs to the question it was typed for. Carrying it
      // over would submit an answer to the wrong question.
      setAnswerDraft((current) => (question?.id === activeQuestionIdRef.current ? current : ""));
      activeQuestionIdRef.current = question?.id ?? null;
    });
  }, []);

  /**
   * A question is asked IN its conversation. One that belongs to another
   * chat — or to none, a side question — waits in the Chats panel's
   * NOTIFICATIONS (core/notifications/NotificationRouting) and shows here
   * only once the user opens it from there.
   */
  const [openedQuestionId, setOpenedQuestionId] = useState<string | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ questionId?: string }>).detail?.questionId;
      if (id) setOpenedQuestionId(id);
    };
    window.addEventListener("lelu-open-question", open);
    return () => window.removeEventListener("lelu-open-question", open);
  }, []);
  const shownQuestion =
    activeQuestion &&
    (openedQuestionId === activeQuestion.id ||
      (activeQuestion.conversationId !== undefined && activeQuestion.conversationId === state.activeConversationId))
      ? activeQuestion
      : null;
  // Count the surface once it is really on screen, so "shown and ignored"
  // is a real signal the lifecycle can act on, not something inferred.
  const surfacedQuestionId = shownQuestion?.status === "pending" ? shownQuestion.id : null;
  useEffect(() => {
    if (surfacedQuestionId) proactive.markQuestionSurfaced(surfacedQuestionId);
  }, [surfacedQuestionId]);

  /** Open the question's project as a workstream and continue there. */
  /**
   * Record the user's own answer and let the work continue.
   *
   * The answer goes in verbatim — ProactiveCore persists it, updates
   * the question's lifecycle, and revives the objective that asked so
   * the existing runtime continues THAT objective rather than starting
   * something new. Nothing is composed on the user's behalf.
   */
  const answerQuestion = useCallback((question: ProactiveQuestion) => {
    const answer = answerDraft.trim();
    if (!answer) return;
    proactive.resolveQuestion(question.id, answer);
    setAnswerDraft("");
    setActiveQuestion(null);
  }, [answerDraft]);

  const exploreQuestion = useCallback((question: ProactiveQuestion) => {
    const projectId = question.relatedProjectId;
    if (!projectId) {
      // Nothing to open — treat engaging as answering it in place.
      proactive.resolveQuestion(question.id, "Explored in the global conversation.");
      return;
    }
    const context = openWorkstream(projectId, { question });
    if (!context) {
      proactive.dismissQuestion(question.id);
      return;
    }
    proactive.engageQuestion(question.id, context.conversation.id);
    notify(
      context.created ? `Opened ${context.conversation.title}` : `Back in ${context.conversation.title}`,
      "This topic continues here now.",
    );
  }, [notify]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const exit = useCallback(() => {
    clearTimers();
    setDialogue("idle");
    if (onExit) {
      onExit();
    } else {
      openPanel("none");
    }
  }, [clearTimers, onExit, openPanel, setDialogue]);

  // On entering dialogue mode — ONCE.
  //
  // This was keyed on `exit`, whose identity follows the Genesis context
  // value, which is rebuilt on every core state change. So it re-ran on
  // every message: it replaced the live turn with a settled replay (no
  // "thinking", no failure, no attachments) and bounced the dialogue
  // state through idle. The latest callbacks are read through refs.
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const setDialogueRef = useRef(setDialogue);
  setDialogueRef.current = setDialogue;
  useEffect(() => {
    mountedAtRef.current = Date.now();
    setDialogueRef.current("listening");
    inputRef.current?.focus();

    voiceEngineRef.current.unlockAudio();

    function handleDocumentKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (menusOpenRef.current) return;
        event.preventDefault();
        exitRef.current();
        return;
      }
      // Typing anywhere that is not already a text field goes to the
      // composer. A text field (the question's answer, a tab being
      // renamed) keeps its own keystrokes.
      const active = document.activeElement as HTMLElement | null;
      const editable = Boolean(active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable));
      if (!editable && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleDocumentKey, true);

    const replayed = replayExchange(state.messages);
    if (replayed) setExchange(replayed);
    replayedForRef.current = state.activeConversationId;

    return () => {
      window.removeEventListener("keydown", handleDocumentKey, true);
      clearTimers();
      setDialogueRef.current("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The view follows the ACTIVE WORKSPACE.
   *
   * Measured in a real browser: switch to a second chat, send a message,
   * wait for the reply to settle, switch back — and the first chat rendered
   * neither its own message nor the other's. Its messages were stored
   * correctly the whole time; nothing ever asked the view to show them.
   * The replay above runs on mount only, and the exchange it had been
   * showing is cleared by the fade timer a few seconds after a reply
   * settles, so by the time the user switched back there was nothing left
   * on screen and nothing to put back.
   *
   * Keyed on the active id, so switching tabs rebuilds the view from that
   * conversation's own history. A reply still streaming for the
   * conversation being viewed is left alone — it has not changed.
   */
  useEffect(() => {
    if (replayedForRef.current === state.activeConversationId) return;
    replayedForRef.current = state.activeConversationId;
    clearTimers();
    const liveTurn = liveTurnsRef.current.get(state.activeConversationId);
    if (liveTurn) {
      setExchange(liveTurn);
      setDialogue("processing");
      return;
    }
    setExchange(replayExchange(state.messages));
    setDialogue("listening");
  }, [state.activeConversationId, state.messages, clearTimers, setDialogue]);

  // LÉLU finished replying: mark the moment complete, then return to
  // listening. The conversation itself stays — it is the transcript now,
  // not a line that fades out of the sky.
  const handleTyped = useCallback(() => {
    const current = exchangeRef.current;
    if (!current) {
      return;
    }
    const exchangeId = current.id;
    clearTimers();
    setDialogue("complete");
    const holdId = window.setTimeout(() => {
      if (exchangeRef.current?.id === exchangeId) {
        setDialogue("listening");
      }
    }, Math.min(6000, 1800 + current.assistant.length * 8));
    timersRef.current.push(holdId);
  }, [clearTimers, setDialogue]);

  // A reply has settled once its turn is no longer in flight — once per
  // reply. (handleTyped's identity follows the context, so without the
  // id guard this would fire on every core state change.)
  const settledReplyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!exchange || exchange.settled || isSending || !exchange.assistant) return;
    if (settledReplyRef.current === exchange.id) return;
    settledReplyRef.current = exchange.id;
    handleTyped();
  }, [exchange, isSending, handleTyped]);

  // Voice conversation flows through the SAME scene text
  useEffect(() => {
    const turn = voiceView.turn;
    if (!turn) {
      return;
    }
    const id = `voice-${turn.id}`;
    const fast = prefersReducedMotion();
    setDialogueRef.current(turn.response ? "responding" : "processing");
    setExchange((current) => {
      if (current && current.id === id) {
        if (turn.response && current.assistant !== turn.response) {
          return { ...current, assistant: turn.response };
        }
        return current;
      }
      return {
        id,
        user: turn.user,
        assistant: turn.response ? cleanAssistantText(turn.response) : "",
        fast,
      };
    });
    // Keyed on the turn only: setDialogue's identity changes with every core
    // state change, and calling it from an effect keyed on itself loops.
  }, [voiceView.turn]);

  const attachMedia = useCallback(
    async (file: File | undefined, kind: "image" | "video") => {
      if (!file || mediaBusy) {
        return;
      }
      setMediaBusy(true);
      try {
        const processed =
          kind === "image"
            ? await processImageFile(file)
            : await processVideoFile(file);
        setPendingMedia((current) => [...current, processed].slice(-4));
        setDialogue("typing");
      } catch (error) {
        notify(
          "Lélu Error",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setMediaBusy(false);
        const inputElement =
          kind === "image" ? imageInputRef.current : videoInputRef.current;
        if (inputElement) {
          inputElement.value = "";
        }
      }
    },
    [mediaBusy, notify, setDialogue],
  );

  const attachFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0 || mediaBusy) {
        return;
      }
      setMediaBusy(true);
      try {
        const attached: PendingFile[] = [];
        for (const file of Array.from(list).slice(0, 4)) {
          let preview = "";
          try {
            const textLike =
              file.size < 512 * 1024 &&
              (/^text\/|json|javascript|typescript|xml|yaml|markdown|html|css|svg/.test(
                file.type,
              ) ||
                /\.(txt|md|json|js|ts|tsx|jsx|py|css|html|xml|yml|yaml|csv|log|env|gitignore)$/i.test(
                  file.name,
                ));
            if (textLike) {
              preview = (await file.text()).slice(0, 800);
            }
          } catch {
            // binary or unreadable
          }
          attached.push({
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type,
            size: file.size,
            preview,
          });
        }
        setPendingFiles((current) => [...current, ...attached].slice(-4));
        setDialogue("typing");
      } finally {
        setMediaBusy(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [mediaBusy, setDialogue],
  );

  const stopTurn = useCallback(() => {
    const conversationId = MultiChatStore.getInstance().getActiveId();
    cancelledRef.current = true;
    ai.cancelTurn(conversationId);
    try { voiceEngineRef.current.cancelSpeech(); } catch { /* best-effort */ }
  }, []);

  const send = useCallback(async (): Promise<void> => {
    // "Try again" resends the failed words without touching the draft.
    const retrying = retryRef.current;
    retryRef.current = null;
    // A message sent into a turn that finished before it could use it is
    // answered now; it is already in the conversation.
    const followUp = followUpRef.current;
    followUpRef.current = null;
    const reused = retrying !== null || followUp !== null;
    const typed = (followUp?.text ?? retrying ?? input).trim();
    const media = reused ? [] : pendingMedia;
    const files = reused ? [] : pendingFiles;
    if (!typed && media.length === 0 && files.length === 0) {
      return;
    }
    // T0: send pressed. Capture the traceId so downstream annotate() calls
    // can be pinned to this exact trace (guards against a concurrent trace
    // started by voice input in the same profiling window).
    const _latencyTraceId = latencyStart();
    // A message steered into a turn that is still settling a Stop must not
    // clear that Stop; it is restored on the steering path below.
    const stopPending = cancelledRef.current;
    cancelledRef.current = false;

    const displayParts: string[] = [];
    if (typed) displayParts.push(typed);
    if (media.length > 0) displayParts.push(mediaDisplayLabel(media));
    if (files.length > 0) displayParts.push(fileListLabel(files));
    const display = displayParts.join(" ");

    const promptParts: string[] = [];
    if (typed) promptParts.push(typed);
    else if (media.length > 0) promptParts.push(defaultMediaPrompt(media));
    const fileContext = fileContextPrompt(files);
    if (fileContext) promptParts.push(fileContext);
    const prompt = promptParts.join("\n\n");

    const exchangeId = crypto.randomUUID();
    // Correlate this UI exchange with the latency trace so both the
    // exchangeId (UI layer) and the streamId (AIService layer) appear in
    // the same trace record — linking the full pipeline without a second
    // request system.
    latencyAnnotate("exchangeId", exchangeId, _latencyTraceId);
    clearTimers();
    if (!reused) {
      setInput("");
      setPendingMedia([]);
      setPendingFiles([]);
    }
    const userMessageId = followUp?.userMessageId ?? crypto.randomUUID();
    const attachments = media.map((item) => item.dataUrl);

    // Which conversation this turn belongs to, read from the STORE rather
    // than from this component's mirror of it — a switch that did not come
    // from React leaves the mirror naming the previous one.
    const turnConversationId = followUp?.conversationId ?? MultiChatStore.getInstance().getActiveId();
    const userMessage: GenesisMessage = {
      id: userMessageId,
      role: "user",
      text: display,
      timestamp: Date.now(),
      source: "local",
    };

    // LIVE STEERING. While LÉLU is working on a turn in this conversation,
    // a plain message goes INTO that turn: the tool loop hands it to the
    // model before its next round ("focus on video generation"), so the
    // running work changes course instead of the message waiting behind
    // it. It is in the conversation at once, bound to this chat.
    if (
      !reused &&
      media.length === 0 &&
      files.length === 0 &&
      convTailsRef.current.has(turnConversationId) &&
      ai.steerTurn(turnConversationId, prompt)
    ) {
      const steered = steeredRef.current.get(turnConversationId) ?? [];
      steered.push({ text: prompt, userMessageId });
      steeredRef.current.set(turnConversationId, steered);
      cancelledRef.current = stopPending;
      bindMessage(userMessageId, turnConversationId);
      addMessage(userMessage);
      return;
    }

    // Take a place in this conversation's queue. Different conversations
    // proceed concurrently; within one conversation turns stay in order.
    // The composer was cleared above, so the message is visibly accepted
    // now and simply waits its turn rather than being thrown away.
    const previousTurn = convTailsRef.current.get(turnConversationId) ?? null;
    let finishTurn: () => void = () => {};
    const thisTurn = new Promise<void>((resolve) => { finishTurn = resolve; });
    convTailsRef.current.set(turnConversationId, thisTurn);
    setSendingIn((current) => [...current, turnConversationId]);
    // The message is in the conversation the moment it is sent, even when
    // it has to wait for the turn ahead of it — bound to its own chat, so
    // a switch while it waits cannot move it.
    if (!followUp) {
      bindMessage(userMessageId, turnConversationId);
      addMessage(userMessage);
    }
    if (previousTurn) {
      // A failed turn must not strand the one queued behind it.
      await previousTurn.catch(() => {});
    }

    // INTERRUPT: stop any current speech immediately
    try { voiceEngineRef.current.cancelSpeech(); } catch { /* best-effort */ }

    // Claiming the conversation is what keeps the reply here: the reply
    // comes back through a global subscription seconds later, and without
    // a claim it was written into whichever conversation was selected by
    // then. See core/multichat/TurnOwnership. It also routes the user's
    // own message, which since turns began queueing is no longer
    // necessarily written while this conversation is still the active
    // one — a queued turn can start after the user has moved on.
    claimTurn(turnConversationId);
    // This turn starts with no Stop pending from an earlier one.
    ai.beginTurn(turnConversationId);
    /** Is the conversation this turn was asked in still the one on screen? */
    const stillViewingTurn = () =>
      MultiChatStore.getInstance().getActiveId() === turnConversationId;

    artifactImagesRef.current = [];
    const liveTurn: Exchange = { id: exchangeId, user: display, assistant: "", fast: false, userMessageId, attachments };
    liveTurnsRef.current.set(turnConversationId, liveTurn);
    // Painting the exchange is only right while this conversation is the
    // one being looked at. A queued turn may start after a switch, and
    // showing its question under another conversation's heading is the
    // same mistake as delivering its reply there.
    if (stillViewingTurn()) {
      setExchange(liveTurn);
      setDialogue("processing");
    }

    // What LÉLU does for this turn, from its own events only — another
    // conversation's search never shows up here.
    const recording = recordTurnActivity(turnConversationId, (activity) => {
      const tracked = liveTurnsRef.current.get(turnConversationId);
      if (tracked?.id === exchangeId) liveTurnsRef.current.set(turnConversationId, { ...tracked, activity });
      if (!stillViewingTurn()) return;
      setExchange((current) => (current && current.id === exchangeId ? { ...current, activity } : current));
    });
    let turnFailed = false;

    try {
      ExplorationController.getInstance().parseCommand(display);
    } catch {
      // contained
    }

    try {
      let context = "";
      try {
        context = crossChatContext(prompt || "", turnConversationId);
      } catch {
        context = "";
      }

      // STREAMING VOICE: LÉLU begins speaking WHILE the response streams.
      const unsubscribeStream = ai.subscribeStream((event) => {
        // When conversationId is present, only process events for THIS
        // conversation so concurrent chats don't mix voice/UI streams.
        if (event.conversationId && event.conversationId !== turnConversationId) return;
        try {
          voiceEngineRef.current.feedStreamingSpeech(event.text);
        } catch {
          // contained
        }
        const streamed = event.text;
        if (!streamed) return;
        // Deltas belong to this turn's conversation, not to whatever is
        // selected when they arrive.
        if (!stillViewingTurn()) return;
        // T5 was marked in AIService.emitStream; T6 is when GenesisChat acts.
        latencyMark("T6");
        setExchange((current) =>
          current && streamed !== current.assistant
            ? { ...current, assistant: cleanAssistantText(streamed), fast: true }
            : current,
        );
      });
      try {
        voiceEngineRef.current.beginStreamingSpeech();
      } catch {
        // contained
      }

      let assistantText: string;
      try {
        if (media.length > 0) {
          const response = await ai.chat(prompt, media, context, { conversationId: turnConversationId });
          assistantText = typeof response.text === "string" ? response.text : "";
        } else {
          const result = await Orchestrator.getInstance().process(prompt, undefined, context, turnConversationId);
          assistantText = typeof result?.response === "string" ? result.response : "";
        }
      } finally {
        unsubscribeStream();
      }

      if (!assistantText) {
        // User pressed Stop — settle silently without an error message.
        if (cancelledRef.current) {
          if (stillViewingTurn()) {
            setExchange(null);
            setDialogue("listening");
          }
          return;
        }
        turnFailed = true;
        const failure = describeFailure("The assistant returned an empty response.", display);
        notify("Lélu Error", failure.detail);
        notifyTurnOutcome({ conversationId: turnConversationId, turnId: exchangeId, ok: false, text: failure.detail });
        if (!stillViewingTurn()) return;
        setExchange((current) =>
          current
            ? { ...current, error: failure, fast: true, images: artifactImagesRef.current, activity: finishActivity(recording.current(), true) }
            : current,
        );
        setDialogue("listening");
        return;
      }

      // Finished in a chat the user has left: a pointer in NOTIFICATIONS.
      notifyTurnOutcome({ conversationId: turnConversationId, turnId: exchangeId, ok: true, text: cleanAssistantText(assistantText) });

      // The reply is stored against its own conversation either way (the
      // turn's claim sees to that). Painting it into the scene is only
      // right while that conversation is the one being looked at —
      // otherwise a reply to chat A appears under chat B.
      if (stillViewingTurn()) {
        setExchange({
          id: exchangeId,
          user: display,
          assistant: cleanAssistantText(assistantText),
          fast: prefersReducedMotion(),
          images: artifactImagesRef.current,
          activity: finishActivity(recording.current()),
          userMessageId,
          attachments,
        });
        setDialogue("responding");
      }

      try {
        voiceEngineRef.current.finishStreamingSpeech(assistantText);
      } catch {
        // contained
      }
    } catch (error) {
      try { voiceEngineRef.current.cancelSpeech(); } catch { /* best-effort */ }
      // AbortError means the user pressed Stop — settle silently.
      const isAbort =
        cancelledRef.current ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError");
      if (isAbort) {
        if (stillViewingTurn()) {
          setExchange(null);
          setDialogue("listening");
        }
        return;
      }
      const messageText = error instanceof Error ? error.message : String(error);
      // Record in the latency trace — stage F (Subscription/exchange) because
      // this catch wraps the outer try that contains the Orchestrator call and
      // the stream subscription. AIService catches D-level errors before they
      // propagate here, so what reaches this catch is typically an F-level
      // failure (stream lifecycle, exchange state, subscription error).
      latencyTraceError("F=Subscription", messageText.slice(0, 120));
      turnFailed = true;
      // Said in LÉLU's words, never as a raw "undefined" or stack text.
      const failure = describeFailure(error, display);
      notify("Lélu Error", failure.detail);
      notifyTurnOutcome({ conversationId: turnConversationId, turnId: exchangeId, ok: false, text: failure.detail });
      if (stillViewingTurn()) {
        setExchange((current) =>
          current
            ? { ...current, error: failure, fast: true, images: artifactImagesRef.current, activity: finishActivity(recording.current(), true) }
            : current,
        );
        setDialogue("listening");
      }
    } finally {
      // The activity is kept with the reply it produced, so coming back to
      // this conversation later still shows what LÉLU did for it.
      const activity = finishActivity(recording.stop(), turnFailed);
      if (hasVisibleActivity(activity)) {
        try {
          const stored = MultiChatStore.getInstance().get(turnConversationId)?.messages ?? [];
          const anchor = stored.findIndex((message) => message.id === userMessageId);
          const reply = anchor >= 0 ? stored.slice(anchor + 1).find((message) => message.role === "assistant") : undefined;
          if (reply) {
            bindMessage(reply.id, turnConversationId);
            upsertMessage({ ...reply, activity });
          }
        } catch {
          // contained — the reply itself is already stored
        }
      }
      if (liveTurnsRef.current.get(turnConversationId)?.id === exchangeId) {
        liveTurnsRef.current.delete(turnConversationId);
      }
      releaseTurn(turnConversationId);
      // A finished turn is durable immediately. Streaming writes are
      // coalesced (see MultiChatStore.flush), which is right while
      // deltas are arriving and wrong the moment the reply is complete
      // — including when it completed by failing.
      MultiChatStore.getInstance().flush();

      // One entry per outstanding turn, so a conversation with two
      // queued turns keeps its indicator until both are done.
      setSendingIn((current) => {
        const at = current.indexOf(turnConversationId);
        return at < 0 ? current : [...current.slice(0, at), ...current.slice(at + 1)];
      });
      if (convTailsRef.current.get(turnConversationId) === thisTurn) {
        convTailsRef.current.delete(turnConversationId);
      }
      finishTurn();

      // Messages sent into this turn after its last tool round were never
      // seen by it. Each is answered now, as its own turn, in order.
      const leftovers = ai.takeSteering(turnConversationId);
      const steered = steeredRef.current.get(turnConversationId) ?? [];
      steeredRef.current.delete(turnConversationId);
      const unanswered = leftovers.length > 0 ? steered.slice(-leftovers.length) : [];
      for (const message of unanswered) {
        followUpRef.current = { ...message, conversationId: turnConversationId };
        void sendRef.current();
      }
    }
  }, [addMessage, upsertMessage, clearTimers, input, notify, pendingMedia, pendingFiles, setDialogue, crossChatContext]);


  const voiceEcho =
    voiceView.state.active && voiceView.state.phase === "listening" && voiceView.interim
      ? voiceView.interim
      : "";

  /* ----- Chat window state (movable, resizable, minimizable) ----- */
  const [chatPos, setChatPos] = useState({ x: -1, y: -1 }); // -1 = centered
  const [chatSize, setChatSize] = useState<"compact" | "medium" | "large">("medium");
  const [chatCorner, setChatCorner] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  /** Where the options menu opens: under its button, in viewport pixels. */
  const [optionsAnchor, setOptionsAnchor] = useState<{ top: number; right: number } | null>(null);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  menusOpenRef.current = optionsOpen || mediaOpen;
  const headerRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0, height: 480 });
  // Measured from the workspace container, not the window — inside the
  // Freebuff workspace those differ, which is what clipped panels.
  const workspace = useWorkspace();
  /**
   * One source of truth for "is there room for the desktop layout".
   *
   * This was a `matchMedia("(max-width: 720px)")` on the WINDOW, while
   * the dock used its own threshold on the same window and the module
   * host used a third. Inside the Freebuff workspace the window is wider
   * than the space available, so the chat laid itself out for desktop in
   * a container that could not fit it — and because each component chose
   * independently, the dock could disagree and put its controls in the
   * same place.
   *
   * Now it is the measured container, shared by everything.
   */
  // Same rule as chat/chatLayout chatFillsScreen(): narrow OR short (a
  // landscape phone) gets the full-screen sky.
  const isMobileViewport = workspace.width <= 720 || workspace.height <= 520;
  /** A left navigation rail (tablet/desktop dock) the full-screen sky must not sit under. */
  const dockInset = useDockInset(isMobileViewport && chatPos.x < 0);
  /** Short screens (a phone on its side) fold the question card to one line. */
  const shortScreen = workspace.visibleHeight < 560;
  const [questionOpen, setQuestionOpen] = useState(false);
  useEffect(() => {
    setQuestionOpen(false);
  }, [shownQuestion?.id]);
  const [mobileHeight, setMobileHeight] = useState<number | null>(null);
  const mobileResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  /**
   * The chat's real rendered width at the current size and workspace.
   *
   * Every clamp below uses this, so a dragged or centred window can never
   * leave its send control past the edge of the workspace.
   */
  const floatWidth = (() => {
    const cap = chatSize === "compact" ? 400 : chatSize === "large" ? 860 : 620;
    const available = Math.max(0, workspace.width - 16);
    return Math.min(available, isMobileViewport ? Math.min(available, 400) : cap);
  })();

  /**
   * Desktop height, in pixels, from the space actually visible below the
   * conversation tabs (which float at the top of the workspace).
   */
  const DESKTOP_TOP = 112;
  const floatHeight = (() => {
    const available = Math.max(320, workspace.visibleHeight - DESKTOP_TOP - 16);
    const cap = chatSize === "compact" ? 480 : chatSize === "large" ? 900 : 700;
    return Math.min(cap, available);
  })();

  useEffect(() => {
    // Leaving the compact layout releases the hand-set sheet height, so
    // the desktop layout is not stuck at a phone-sized height.
    if (!isMobileViewport) setMobileHeight(null);
  }, [isMobileViewport]);

  /**
   * ORIENTATION SURVIVAL.
   *
   * `chatPos` is an absolute pixel position and `mobileHeight` an
   * absolute pixel height. Rotating the device swaps the viewport
   * dimensions, so both are re-clamped into the new workspace on every
   * resize/orientation change. Conversation, input and cognition state
   * are untouched: this only moves the window back into view.
   */
  useEffect(() => {
    const width = workspace.width;
    const height = workspace.visibleHeight;

    setChatPos((current) => {
      if (current.x < 0 && current.y < 0) return current; // centered
      const maxX = Math.max(8, width - floatWidth - 8);
      const maxY = Math.max(8, height - 160);
      const x = Math.max(8, Math.min(maxX, current.x));
      const y = Math.max(8, Math.min(maxY, current.y));
      return x === current.x && y === current.y ? current : { x, y };
    });

    setMobileHeight((current) => {
      if (current === null) return current;
      const capped = Math.max(200, Math.min(height - 16, current));
      return capped === current ? current : capped;
    });
  }, [workspace.width, workspace.visibleHeight, floatWidth]);

  /* ----- Menus: close on outside press ----- */
  useEffect(() => {
    if (!optionsOpen && !mediaOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        optionsOpen &&
        headerRef.current && !headerRef.current.contains(target) &&
        !(optionsMenuRef.current && optionsMenuRef.current.contains(target))
      ) setOptionsOpen(false);
      if (mediaOpen && dockRef.current && !dockRef.current.contains(target)) setMediaOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The chat's own Escape handler sees the menu open and stands down.
      setOptionsOpen(false);
      setMediaOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [optionsOpen, mediaOpen]);

  /* ----- Scrolling: one surface, follows the reply, never yanks ----- */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Following the newest content. Off once the user scrolls up. */
  const followRef = useRef(true);
  /** When the user last wheeled, touched, keyed or grabbed the scrollbar. */
  const userScrollAtRef = useRef(0);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [unseenReply, setUnseenReply] = useState(false);

  const scrollToLatest = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    userScrollAtRef.current = 0;
    setAwayFromLatest(false);
    setUnseenReply(false);
    // Smooth only over a short distance: a long smooth scroll can be cut
    // short by layout changes on the way and stop far from the end.
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const glide = smooth && !prefersReducedMotion() && distance < el.clientHeight * 1.5;
    el.scrollTo({ top: el.scrollHeight, behavior: glide ? "smooth" : "auto" });
  }, []);

  // Growth of the thread (streamed words, a diagram finishing, an image
  // loading) keeps the view on the latest line only while the user is
  // following; otherwise it raises the "new response" affordance.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = scroller?.firstElementChild;
    if (!scroller || !content || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      if (followRef.current) scroller.scrollTop = scroller.scrollHeight;
      else setUnseenReply(true);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [chatMinimized]);

  // A new turn of the user's own, or another conversation: back to the latest.
  const lastExchangeIdRef = useRef("");
  useEffect(() => {
    if (exchange && !exchange.settled && exchange.id !== lastExchangeIdRef.current) {
      lastExchangeIdRef.current = exchange.id;
      scrollToLatest();
    }
  }, [exchange, scrollToLatest]);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => scrollToLatest());
    return () => window.cancelAnimationFrame(id);
  }, [state.activeConversationId, chatMinimized, scrollToLatest]);

  /**
   * Only the user can stop the view following. Content growing under the
   * view (a lazy image, a diagram finishing) also fires scroll events, and
   * reading those as "the user scrolled away" is what left the newest line
   * hidden. So a scroll counts as the user's only shortly after their own
   * wheel, touch, key or scrollbar press.
   */
  const markUserScroll = useCallback((event?: { target: EventTarget | null }) => {
    // A press on a control inside the conversation (jump, copy, retry) is
    // not the user scrolling.
    const target = event?.target as HTMLElement | null | undefined;
    if (target?.closest?.("button, a, input, textarea, [role='menu']")) return;
    userScrollAtRef.current = performance.now();
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight);
    const userDriven = performance.now() - userScrollAtRef.current < 1200;
    if (userDriven) {
      followRef.current = near;
      setAwayFromLatest(!near);
      if (near) setUnseenReply(false);
      return;
    }
    if (near) {
      followRef.current = true;
      setAwayFromLatest(false);
      setUnseenReply(false);
    } else if (followRef.current) {
      // Moved by layout, not by the user: stay with the newest line.
      el.scrollTop = el.scrollHeight;
    }
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest("button,input,textarea,[role='menu']")) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging.current = true;
    const frame = e.currentTarget.closest("[data-lelu-chat-window]")?.getBoundingClientRect();
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: chatPos.x < 0 ? frame?.left ?? 8 : chatPos.x,
      posY: chatPos.y < 0 ? frame?.top ?? 8 : chatPos.y,
      height: frame?.height ?? 480,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const width = workspace.width;
    const height = workspace.visibleHeight;

    if (isMobileViewport) {
      // On mobile: freely repositionable but stays fully on screen
      const maxX = Math.max(8, width - floatWidth - 8);
      const maxY = Math.max(8, height - MOBILE_PILL_RESERVE - 400);
      setChatPos({
        x: Math.max(8, Math.min(maxX, dragStart.current.posX + dx)),
        y: Math.max(8, Math.min(maxY, dragStart.current.posY + dy)),
      });
      return;
    }

    const maxY = Math.max(8, height - dragStart.current.height - 8);
    // Keep the WHOLE chat on screen, not just a corner of it, so the send
    // control can never be dragged out of reach.
    const maxX = Math.max(8, width - floatWidth - 8);
    setChatCorner(false);
    setChatPos({
      x: Math.max(8, Math.min(maxX, dragStart.current.posX + dx)),
      y: Math.max(8, Math.min(maxY, dragStart.current.posY + dy)),
    });
  }

  function handlePointerUp() { dragging.current = false; }

  function handleMobileResizeDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isMobileViewport) return;
    e.preventDefault();
    e.stopPropagation();
    const currentHeight = mobileHeight ?? Math.min(window.innerHeight * 0.72, 620);
    mobileResizeRef.current = { startY: e.clientY, startHeight: currentHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleMobileResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
    const resize = mobileResizeRef.current;
    if (!resize || !isMobileViewport) return;
    e.preventDefault();
    const nextHeight = resize.startHeight + resize.startY - e.clientY;
    setMobileHeight(Math.max(240, Math.min(window.innerHeight - 16, nextHeight)));
  }

  function handleMobileResizeUp(e: ReactPointerEvent<HTMLDivElement>) {
    mobileResizeRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  /* ----- Composer growth: up to a share of what is visible, then scroll ----- */
  const composerMax = Math.max(96, Math.min(220, Math.round(workspace.visibleHeight * 0.3)));
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, composerMax)}px`;
  }, [input, composerMax]);

  /* ----- Conversation content (memoised so typing does not re-render history) ----- */
  // Through a ref: `send` changes with every keystroke (it reads the
  // draft), and a changing callback would re-render the whole transcript.
  const sendRef = useRef(send);
  sendRef.current = send;
  const retry = useCallback((text: string) => {
    retryRef.current = text;
    void sendRef.current();
  }, []);

  // Search results and pages read now show in the turn's activity card
  // (chat/ChatActivity), attached to the reply they belong to.
  const liveExtras = useMemo(() => {
    const images = exchange?.images ?? [];
    if (images.length === 0) return null;
    return (
      <figure className="lelu-cc-renders" style={{ margin: "10px 0 0" }}>
        {images.map((src, index) => (
          <img key={`${exchange?.id}-${index}`} src={src} alt="Rendered by LÉLU" loading="lazy" decoding="async" />
        ))}
        <figcaption>Rendered by LÉLU — saved to the Render gallery</figcaption>
      </figure>
    );
  }, [exchange?.id, exchange?.images]);

  // Approvals for THIS conversation (and any no conversation owns). Tool
  // steps show per reply in the activity card instead of a global stream.
  const activity = useMemo(() => <GenesisExecutionTimeline conversationId={state.activeConversationId} approvalsOnly />, [state.activeConversationId]);

  const statusText = state.speaking
    ? "speaking"
    : state.thinking || isSending
      ? "thinking"
      : voiceView.state.active
        ? "listening to you"
        : "here with you";
  const orbState = state.speaking ? "speaking" : state.thinking || isSending ? "thinking" : "idle";
  const canSend = Boolean(input.trim()) || pendingMedia.length > 0 || pendingFiles.length > 0;
  const tabsShown = state.activePanel === "chat";

  const closeChat = () => {
    if (onExit) onExit();
    else openPanel("none");
  };

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      /* not available in this browser */
    }
  };

  const openCommandPalette = () => {
    // The palette owns its open state and listens for its own shortcut.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, metaKey: true, bubbles: true }));
  };

  const menuItem = (label: string, icon: ReactNode, onSelect: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="lelu-cc-menu-item"
      onClick={() => {
        setOptionsOpen(false);
        onSelect();
      }}
    >
      {icon}
      {label}
    </button>
  );

  // Minimized bubble
  if (chatMinimized) {
    return (
      <motion.button
        type="button"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        className="lelu-cc"
        style={{
          position: "fixed", zIndex: layer("navigation"),
          bottom: "calc(24px + env(safe-area-inset-bottom, 0px))", right: 24,
          pointerEvents: "auto",
          background: "linear-gradient(135deg, rgba(60,36,110,0.92), rgba(110,58,120,0.92))",
          borderRadius: 999,
          padding: "12px 20px", display: "flex", gap: 10, alignItems: "center",
          border: "1px solid rgba(255,228,248,0.25)", cursor: "pointer",
          boxShadow: "0 12px 40px rgba(10,4,30,0.5)",
          color: "#f7f1ff", font: "inherit",
        }}
        data-lelu-chat-bubble
        aria-label="Open chat"
        onClick={() => setChatMinimized(false)}
      >
        <span className="lelu-cc-orb" data-state={orbState} aria-hidden />
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.18em" }}>LÉLU</span>
      </motion.button>
    );
  }

  const isCentered = chatPos.x === -1;
  const isFloatingMobile = isMobileViewport && chatPos.x >= 0;
  const isFullMobile = isMobileViewport && !isFloatingMobile;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 800;
  const mobileSheetHeight = mobileHeight ?? Math.min(viewportHeight * 0.82, 720);
  const mobileFloatWidth = Math.min(viewportWidth - 16, 400);

  const windowStyle: CSSProperties = {
    position: "fixed",
    zIndex: layer("panel"),
    pointerEvents: "auto",
    ...(isMobileViewport
      ? isFloatingMobile
        ? {
            left: chatPos.x,
            top: chatPos.y,
            width: mobileFloatWidth,
            height: mobileSheetHeight,
            maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px)",
          }
        : {
            // MOBILE: the chat IS the app — the whole sky. While a keyboard
            // covers part of the screen, the sky shrinks to what is visible
            // so the composer rides above the keyboard instead of under it.
            left: dockInset,
            right: 0,
            top: 0,
            width: dockInset > 0 ? `calc(100% - ${dockInset}px)` : "100%",
            height: workspace.keyboardOpen ? workspace.visibleHeight : "100dvh",
            maxHeight: "100dvh",
          }
      : chatCorner
        ? { right: 16, bottom: 16, width: floatWidth, height: floatHeight }
        : isCentered
          ? {
              // Centred by MEASUREMENT, not by a transform: framer-motion
              // owns `transform` for its enter animation, and a translate
              // correction would be clobbered — leaving the left edge at
              // the centre and the send control off-screen.
              left: Math.max(8, Math.round((workspace.width - floatWidth) / 2)),
              top: Math.min(DESKTOP_TOP, Math.max(8, workspace.visibleHeight - floatHeight - 16)),
              width: floatWidth,
              height: floatHeight,
            }
          : { left: chatPos.x, top: chatPos.y, width: floatWidth, height: floatHeight }),
    display: "flex",
    flexDirection: "column",
    borderRadius: isFullMobile ? 0 : 30,
    border: isFullMobile ? "none" : "1px solid rgba(255, 228, 248, 0.16)",
    boxShadow: isFullMobile ? "none" : "0 30px 80px rgba(10, 4, 30, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.02) inset",
    overflow: "hidden",
    overscrollBehavior: "contain",
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="lelu-cc"
      style={windowStyle}
      data-lelu-chat-window
      role="region"
      aria-label="Conversation with LÉLU"
    >
      {/* The sky: CSS gradients and transforms only. */}
      <div className="lelu-cc-sky" aria-hidden>
        <div className="lelu-cc-clouds lelu-cc-clouds--far" />
        <div className="lelu-cc-clouds lelu-cc-clouds--mid" />
        <div className="lelu-cc-clouds lelu-cc-clouds--near" />
      </div>

      <div className="lelu-cc-shell">
        {/* Phone-only resize handle — only when floating (not fullscreen) */}
        {isFloatingMobile ? (
          <div
            onPointerDown={handleMobileResizeDown}
            onPointerMove={handleMobileResizeMove}
            onPointerUp={handleMobileResizeUp}
            onPointerCancel={handleMobileResizeUp}
            role="separator"
            aria-label="Resize chat"
            style={{ height: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none", cursor: "ns-resize" }}
          >
            <span style={{ width: 42, height: 4, borderRadius: 99, background: "rgba(255,228,248,0.35)" }} />
          </div>
        ) : null}

        {/* Header: who you are talking to, and ONE control group. */}
        <div
          ref={headerRef}
          className="lelu-cc-header"
          onPointerDown={isFullMobile ? undefined : handlePointerDown}
          onPointerMove={isFullMobile ? undefined : handlePointerMove}
          onPointerUp={isFullMobile ? undefined : handlePointerUp}
          onPointerCancel={isFullMobile ? undefined : handlePointerUp}
          style={{
            position: "relative",
            cursor: isFullMobile ? "default" : "grab",
            touchAction: isFullMobile ? "auto" : "none",
            paddingTop: isFullMobile ? "calc(env(safe-area-inset-top, 0px) + 10px)" : undefined,
          }}
        >
          <div className="lelu-cc-identity">
            <span className="lelu-cc-orb" data-state={orbState} aria-hidden />
            <span className="lelu-cc-name">LÉLU</span>
            <span className="lelu-cc-status" aria-live="polite">{statusText}</span>
          </div>
          <div className="lelu-cc-controls" role="toolbar" aria-label="Chat controls">
            <button
              type="button"
              className="lelu-cc-icon"
              aria-label="Chat options"
              aria-haspopup="menu"
              aria-expanded={optionsOpen}
              title="Chat options"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setOptionsAnchor({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
                setOptionsOpen((open) => !open);
              }}
            >
              <Ellipsis size={20} aria-hidden />
            </button>
            <button
              type="button"
              className="lelu-cc-icon"
              onClick={() => window.dispatchEvent(new Event("genesis-lelu-menu-toggle"))}
              title="LÉLU menu — tools and live surfaces"
              aria-label="Open LÉLU menu"
            >
              <Menu size={19} aria-hidden />
            </button>
            <button type="button" className="lelu-cc-icon lelu-cc-icon--danger" onClick={closeChat} title="Close" aria-label="Close chat">
              <X size={19} aria-hidden />
            </button>
          </div>

          {/* The menu is portalled onto the overlay layer: inside the chat
              window it would open UNDER the conversation tabs, which sit on
              a higher layer and would take its taps. */}
          {optionsOpen && optionsAnchor ? createPortal(
            <div className="lelu-cc" style={{ position: "fixed", inset: 0, zIndex: layer("overlay"), pointerEvents: "none" }}>
            <div
              ref={optionsMenuRef}
              className="lelu-cc-menu"
              role="menu"
              aria-label="Chat options"
              style={{ position: "fixed", top: optionsAnchor.top, right: optionsAnchor.right, pointerEvents: "auto" }}
            >
              {menuItem("New conversation", <Plus size={17} aria-hidden />, () => {
                createConversation();
                openPanel("chat");
              })}
              {menuItem("Search conversations", <Search size={17} aria-hidden />, () => window.dispatchEvent(new Event("lelu-multichat-search")))}
              <div className="lelu-cc-menu-sep" />
              {isMobileViewport ? (
                isFloatingMobile ? menuItem("Dock chat to bottom", <PanelBottom size={17} aria-hidden />, () => setChatPos({ x: -1, y: -1 })) : null
              ) : (
                <>
                  <div className="lelu-cc-menu-label">Window</div>
                  {menuItem(
                    `Size: ${chatSize === "compact" ? "compact → medium" : chatSize === "medium" ? "medium → large" : "large → compact"}`,
                    <Maximize2 size={17} aria-hidden />,
                    () => setChatSize((size) => (size === "compact" ? "medium" : size === "medium" ? "large" : "compact")),
                  )}
                  {menuItem(chatCorner ? "Float in the centre" : "Snap to corner", <PanelBottom size={17} aria-hidden />, () => {
                    setChatCorner((corner) => !corner);
                    setChatPos({ x: -1, y: -1 });
                  })}
                  {menuItem("Minimize chat", <Minimize2 size={17} aria-hidden />, () => setChatMinimized(true))}
                </>
              )}
              <div className="lelu-cc-menu-label">LÉLU</div>
              {menuItem("Command palette", <Command size={17} aria-hidden />, openCommandPalette)}
              {menuItem(document.fullscreenElement ? "Exit fullscreen" : "Fullscreen", <Expand size={17} aria-hidden />, toggleFullscreen)}
              {menuItem("OG Core", <LayoutGrid size={17} aria-hidden />, () => navigate("/og/core"))}
              {menuItem("OG Chat", <MessageCircle size={17} aria-hidden />, () => navigate("/og/chat"))}
              {menuItem("Minimize LÉLU", <Minimize2 size={17} aria-hidden />, minimize)}
            </div>
            </div>,
            document.body,
          ) : null}
        </div>

        {/* Room for the conversation tabs, which float over the top of the sky. */}
        {isFullMobile && tabsShown ? <div aria-hidden style={{ height: 52, flexShrink: 0 }} /> : null}

        {/* The one conversation scroll surface. */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={markUserScroll}
          onTouchStart={markUserScroll}
          onTouchMove={markUserScroll}
          onPointerDown={markUserScroll}
          onKeyDown={markUserScroll}
          tabIndex={0}
          className="lelu-cc-scroll"
          data-lelu-dialogue-scroll
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          aria-relevant="additions"
        >
          <ChatTranscript
            messages={state.messages}
            live={exchange}
            inFlight={isSending}
            liveExtras={liveExtras}
            activity={activity}
            speaking={voiceEcho}
            onRetry={retry}
          />
          {awayFromLatest ? (
            <button type="button" className="lelu-cc-jump" onClick={() => scrollToLatest(true)} aria-label="Jump to the latest message">
              <ArrowDown size={15} aria-hidden />
              {unseenReply ? "New response" : "Latest"}
            </button>
          ) : null}
        </div>

        {/* Proactive question — one line on short screens until opened. */}
        {shownQuestion && shortScreen && !questionOpen ? (
          <div
            data-lelu-proactive-question
            className="lelu-cc-question"
            style={{
              // Same layer and flow rules as the full card below.
              zIndex: layer("notification"),
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              padding: "6px 8px 6px 14px",
            }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ color: "rgba(255, 214, 150, 0.85)", marginRight: 6 }}>LÉLU asks:</span>
              {shownQuestion.question}
            </span>
            <button type="button" className="lelu-cc-chip lelu-cc-chip--primary" onClick={() => setQuestionOpen(true)} aria-label="Answer LÉLU's question">
              Answer
            </button>
            <button
              type="button"
              onClick={() => proactive.deferQuestion(shownQuestion.id)}
              aria-label="Defer proactive question"
              title="Not now — ask again only if something changes"
              className="lelu-cc-chip"
            >
              Later
            </button>
          </div>
        ) : shownQuestion ? (
          <div
            data-lelu-proactive-question
            className="lelu-cc-question"
            style={{
              // A transient cognition surface, on the notification layer and
              // explicitly BELOW the composer: a suggestion must never cover
              // the controls the user is typing into. It stays in the chat's
              // own flow (no absolute positioning), so it yields space
              // instead of taking it.
              zIndex: layer("notification"),
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255, 214, 150, 0.85)" }}>
                LÉLU is asking
              </span>
              {shownQuestion.relatedProjectId ? (
                <button
                  type="button"
                  onClick={() => exploreQuestion(shownQuestion)}
                  aria-label="Explore this in its own workstream"
                  title="Open this topic as its own conversation"
                  className="lelu-cc-chip"
                >
                  Explore
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => proactive.deferQuestion(shownQuestion.id)}
                aria-label="Defer proactive question"
                title="Not now — ask again only if something changes"
                className="lelu-cc-chip"
              >
                Later
              </button>
              <button
                type="button"
                onClick={() => proactive.dismissQuestion(shownQuestion.id)}
                aria-label="Dismiss proactive question"
                title="Dismiss"
                className="lelu-cc-icon"
                style={{ width: 34, height: 34, minWidth: 34 }}
              >
                <X size={15} aria-hidden />
              </button>
            </div>
            <strong style={{ display: "block", fontWeight: 600, overflowWrap: "anywhere" }}>{shownQuestion.question}</strong>
            <span className="lelu-cc-question-reason" style={{ color: "rgba(255, 240, 222, 0.66)", fontSize: 12.5 }}>
              {shownQuestion.reason}
            </span>
            {/* A REAL ANSWER: resolveQuestion(id, response) takes the user's
                own words, verbatim. */}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                answerQuestion(shownQuestion);
              }}
              style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}
            >
              <input
                data-lelu-question-answer
                value={answerDraft}
                onChange={(event) => setAnswerDraft(event.target.value)}
                placeholder="Answer…"
                aria-label="Answer LÉLU's question"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 38,
                  border: "1px solid rgba(255, 214, 150, 0.3)",
                  background: "rgba(20, 10, 30, 0.35)",
                  color: "rgba(255, 244, 222, 0.96)",
                  borderRadius: 999,
                  padding: "0 14px",
                  fontSize: 16,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                type="submit"
                data-lelu-question-submit
                disabled={answerDraft.trim().length === 0}
                aria-label="Send answer"
                className="lelu-cc-chip lelu-cc-chip--primary"
                style={{ minHeight: 38, opacity: answerDraft.trim().length === 0 ? 0.5 : 1 }}
              >
                Answer
              </button>
            </form>
          </div>
        ) : null}

        {/* The cloud composer: one bubble holding every input control. */}
        <div
          ref={dockRef}
          data-lelu-composer
          className="lelu-cc-dock"
          style={{
            paddingBottom: isFullMobile && !workspace.keyboardOpen
              ? "calc(env(safe-area-inset-bottom, 0px) + 12px)"
              : undefined,
          }}
        >
          {pendingMedia.length > 0 || pendingFiles.length > 0 ? (
            <div className="lelu-cc-pending" aria-label="Attachments">
              {pendingMedia.map((media, index) => (
                <div key={`${media.kind}-${index}`} className="lelu-cc-pending-item">
                  <img src={media.dataUrl} alt={media.kind === "video" ? "Video frame" : "Attached image"} />
                  <button
                    type="button"
                    className="lelu-cc-pending-remove"
                    aria-label="Remove attachment"
                    onClick={() => setPendingMedia((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              ))}
              {pendingFiles.map((file) => (
                <div key={file.id} className="lelu-cc-pending-item lelu-cc-pending-item--file">
                  <FileText size={15} aria-hidden />
                  <span>{file.name}</span>
                  <button
                    type="button"
                    className="lelu-cc-pending-remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => setPendingFiles((current) => current.filter((item) => item.id !== file.id))}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="lelu-cc-composer" style={{ ["--cc-composer-max" as string]: `${composerMax}px` } as CSSProperties}>
            <button
              type="button"
              disabled={mediaBusy}
              onClick={() => setMediaOpen((current) => !current)}
              title="Attach camera, gallery, video or files"
              aria-label="Attach media or files"
              aria-haspopup="menu"
              aria-expanded={mediaOpen}
              className="lelu-cc-icon"
            >
              <ImagePlus size={20} aria-hidden />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                // Only on a real change of phase: every setDialogue re-renders
                // the whole Genesis tree, which per keystroke is a lot of work.
                const phase = value.trim().length > 0 ? "typing" : "listening";
                if (state.dialogue !== phase) setDialogue(phase);
              }}
              onKeyDown={(event) => {
                // Enter sends, as it always has; Shift+Enter is a new line.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              autoFocus
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck={false}
              enterKeyHint="send"
              placeholder="Message LÉLU…"
              aria-label="Message Lélu — type instructions for any attachments"
              rows={1}
            />
            {/* STOP (cancel generation) — shown while a turn is in flight */}
            {isSending && (
              <button
                type="button"
                onClick={stopTurn}
                title="Stop — cancel this response"
                aria-label="Stop generation"
                data-lelu-stop-button
                className="lelu-cc-icon lelu-cc-stop"
              >
                <Square size={15} fill="currentColor" aria-hidden />
              </button>
            )}
            {/* INTERRUPT — stop Lélu speaking (voice only) */}
            {!isSending && voiceView.state.phase === "speaking" && (
              <button
                type="button"
                onClick={() => voiceEngineRef.current.cancelSpeech()}
                title="Stop Lélu speaking"
                aria-label="Interrupt Lélu's speech"
                className="lelu-cc-icon lelu-cc-stop"
              >
                <Square size={15} fill="currentColor" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => void voiceView.engine.toggle()}
              disabled={isSending}
              title={voiceView.state.active ? "Stop listening" : "Voice input"}
              aria-label={voiceView.state.active ? "Stop listening" : "Voice input"}
              aria-pressed={voiceView.state.active}
              data-active={voiceView.state.active ? "true" : "false"}
              className="lelu-cc-icon"
            >
              <Mic size={19} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => void send()}
              // Busy is not a reason to refuse: a send made during a reply
              // queues behind it (see sendingIn/convTailsRef above). Empty
              // is — there is nothing to send.
              disabled={!canSend}
              title={isSending ? "Lélu is still replying — this will be sent next" : "Send to Lélu"}
              // A machine-readable turn state for the browser verifications.
              data-lelu-sending={isSending ? "true" : "false"}
              aria-label="Send message"
              className="lelu-cc-icon lelu-cc-send"
            >
              <ArrowUp size={20} strokeWidth={2.4} aria-hidden />
            </button>
          </div>

          {/* Attachment choices, anchored to the composer they belong to. */}
          {mediaOpen ? (
            <div data-lelu-media-popover className="lelu-cc-attach-menu" role="menu" aria-label="Attach">
              <button type="button" role="menuitem" className="lelu-cc-menu-item" disabled={mediaBusy} onClick={() => { cameraInputRef.current?.click(); setMediaOpen(false); }} aria-label="Take a photo">
                <Camera size={17} aria-hidden /> Camera
              </button>
              <button type="button" role="menuitem" className="lelu-cc-menu-item" disabled={mediaBusy} onClick={() => { imageInputRef.current?.click(); setMediaOpen(false); }} aria-label="Choose an image">
                <ImageIcon size={17} aria-hidden /> Gallery
              </button>
              <button type="button" role="menuitem" className="lelu-cc-menu-item" disabled={mediaBusy} onClick={() => { videoInputRef.current?.click(); setMediaOpen(false); }} aria-label="Record or choose a video">
                <Video size={17} aria-hidden /> Video
              </button>
              <button type="button" role="menuitem" className="lelu-cc-menu-item" disabled={mediaBusy} onClick={() => { fileInputRef.current?.click(); setMediaOpen(false); }} aria-label="Attach files">
                <FileText size={17} aria-hidden /> Files
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Hidden file inputs (the image input stays first: verifications attach through it). */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple={false}
        onChange={(event) => void attachMedia(event.target.files?.[0], "image")}
        style={{ display: "none" }}
        aria-hidden
        tabIndex={-1}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={false}
        onChange={(event) => void attachMedia(event.target.files?.[0], "image")}
        style={{ display: "none" }}
        aria-hidden
        tabIndex={-1}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        capture="environment"
        multiple={false}
        onChange={(event) => void attachMedia(event.target.files?.[0], "video")}
        style={{ display: "none" }}
        aria-hidden
        tabIndex={-1}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(event) => void attachFiles(event.target.files)}
        style={{ display: "none" }}
        aria-hidden
        tabIndex={-1}
      />
    </motion.div>
  );
}
