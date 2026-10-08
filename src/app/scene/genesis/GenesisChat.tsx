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
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

import AIService from "../../../core/AIService";
import Orchestrator from "../../../core/orchestrator/Orchestrator";
import AgentEventBus from "../../../core/agent/AgentEvents";
import GenesisExecutionTimeline from "./GenesisExecutionTimeline";
import GenesisChatSurface, { type ChatSurface } from "./GenesisChatSurface";
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
import { markPerf } from "../../../core/perf/StartupTelemetry";
import { cleanAssistantText } from "../../../core/router/ToolMarkup";

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
  /** Real visual environments LÉLU opened in this exchange (search/browser). */
  surfaces?: ChatSurface[];
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/* ----------------------------------------------------------
 * Floating text language — no container, no border, no bubble.
 * Readability comes from layered text shadows over the cosmos.
 * ---------------------------------------------------------- */

const dialogueTextBase: CSSProperties = {
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: 1.55,
  letterSpacing: "0.015em",
  textAlign: "center",
  fontWeight: 400,
};

const userTextStyle: CSSProperties = {
  ...dialogueTextBase,
  fontSize: "clamp(14px, 1.5vw + 9px, 17px)",
  color: "rgba(199, 228, 250, 0.94)",
  textShadow:
    "0 0 14px rgba(2, 6, 23, 0.6), 0 1px 2px rgba(2, 6, 23, 0.92)",
};

const assistantTextStyle: CSSProperties = {
  ...dialogueTextBase,
  fontSize: "clamp(15px, 1.7vw + 10px, 19px)",
  color: "#f4fcff",
  textShadow:
    "0 0 22px rgba(103, 232, 249, 0.42), 0 0 46px rgba(56, 189, 248, 0.24), 0 1px 3px rgba(2, 6, 23, 0.95)",
};

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

const titleBtn: CSSProperties = {
  width: 28, height: 28, borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(212,169,78,0.8)",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  cursor: "pointer", fontSize: 13, lineHeight: 1, flexShrink: 0,
};

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
 * Fast streaming — reveals the full text instantly.
 * ---------------------------------------------------------- */

function useTypewriter(text: string, _fast: boolean): number {
  const total = text.length;
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (text.length <= 80) {
      setCount(text.length);
    } else {
      const batch = Math.min(text.length, Math.ceil(text.length * 0.7));
      setCount(batch);
      const id = setTimeout(() => {
        setCount(text.length);
      }, 16);
      return () => clearTimeout(id);
    }
  }, [text, total]);

  return count;
}

function Caret() {
  return (
    <motion.span
      aria-hidden
      animate={{ opacity: [1, 0, 1] }}
      transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
      style={{ display: "inline-block", marginLeft: 2, opacity: 0.9 }}
    >
      ▍
    </motion.span>
  );
}

interface AssistantLineProps {
  text: string;
  fast: boolean;
  onDone: () => void;
}

function AssistantLine({ text, fast, onDone }: AssistantLineProps) {
  const visibleText = cleanAssistantText(text);
  const count = useTypewriter(visibleText, fast);
  const total = visibleText.length;
  const doneRef = useRef(false);
  const seenTextRef = useRef(visibleText);

  useEffect(() => {
    if (visibleText !== seenTextRef.current) {
      seenTextRef.current = visibleText;
      doneRef.current = false;
    }
    if (count >= total && total > 0 && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [count, total, onDone, visibleText]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={assistantTextStyle}
    >
      {visibleText.slice(0, count)}
      {count < total ? <Caret /> : null}
    </motion.div>
  );
}

function ThinkingDots() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.9 }}
      transition={{ duration: 0.3 }}
      style={{ ...assistantTextStyle, fontSize: "clamp(15px, 1.7vw + 10px, 19px)" }}
    >
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          aria-hidden
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ repeat: Infinity, duration: 1.1, delay: index * 0.18 }}
          style={{ display: "inline-block", marginRight: 8 }}
        >
          ·
        </motion.span>
      ))}
    </motion.div>
  );
}

/* ----------------------------------------------------------
 * The dialogue layer itself.
 * ---------------------------------------------------------- */

export default function GenesisChat({ onExit }: { onExit?: () => void }) {
  const { state, openPanel, addMessage, setDialogue, notify, crossChatContext } = useGenesis();
  const voiceView = useVoice();

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<ProactiveQuestion | null>(null);
  const [exchange, setExchange] = useState<Exchange | null>(null);
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
      const image = event.image;
      artifactImagesRef.current = [...artifactImagesRef.current, image];
      setExchange((current) =>
        current
          ? { ...current, images: [...new Set([...(current.images ?? []), image])] }
          : current,
      );
    });
  }, []);

  // Live visual environments: when LÉLU's execution really produces a
  // search result set or opens the browser, the ACTUAL result attaches
  // to this exchange as an inline surface
  useEffect(() => {
    const seen = new Set<string>();
    return AgentEventBus.getInstance().subscribe((event) => {
      let surface: ChatSurface | null = null;
      let key = "";
      if (event.type === "tool_result" && event.tool === "research" && (event.results?.length ?? 0) > 0) {
        key = `research:${event.taskId}`;
        surface = {
          kind: "search",
          label: event.result ?? `web search`,
          items: event.results ?? [],
        };
      } else if (event.type === "tool_result" && event.tool === "browser") {
        key = `browser-read:${event.taskId}`;
        surface = {
          kind: "browser",
          url: event.results?.[0]?.url ?? "",
          title: event.results?.[0]?.title,
          excerpt: event.result,
          status: "read",
        };
      } else if (event.type === "browser_opened") {
        key = `browser:${event.url}`;
        surface = {
          kind: "browser",
          url: event.url,
          status: "opened",
        };
      }
      if (!surface || seen.has(key)) return;
      seen.add(key);
      surfacesRef.current = [...surfacesRef.current, surface];
      setExchange((current) =>
        current
          ? { ...current, surfaces: [...surfacesRef.current] }
          : current,
      );
    });
  }, []);

  const [fading, setFading] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<ProcessedMedia[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const exchangeRef = useRef<Exchange | null>(null);
  const surfacesRef = useRef<ChatSurface[]>([]);
  const mountedAtRef = useRef(Date.now());
  const timersRef = useRef<number[]>([]);

  // Composer auto-grows with typed content
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    exchangeRef.current = exchange;
  }, [exchange]);

  // Proactive question guard
  const presentedQuestionIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const presented = (presentedQuestionIdsRef.current ??= new Set<string>());
    return proactive.subscribeQuestions((question) => {
      if (!question || presented.has(question.id)) {
        return;
      }
      if (question.status === "pending") {
        presented.add(question.id);
      }
      setActiveQuestion(question);
    });
  }, []);

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

  // On entering dialogue mode
  useEffect(() => {
    mountedAtRef.current = Date.now();
    setDialogue("listening");
    inputRef.current?.focus();

    voiceEngineRef.current.unlockAudio();

    function handleDocumentKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        exit();
        return;
      }
      if (document.activeElement !== inputRef.current && event.key.length === 1) {
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleDocumentKey, true);

    const messages = state.messages;
    let lastAssistant: GenesisMessage | undefined;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant" && messages[index].text.trim()) {
        lastAssistant = messages[index];
        break;
      }
    }

    if (lastAssistant) {
      let userText = "";
      const assistantIndex = messages.indexOf(lastAssistant);
      for (let index = assistantIndex - 1; index >= 0; index -= 1) {
        if (messages[index].role === "user") {
          userText = messages[index].text;
          break;
        }
      }
      setExchange({
        id: `replay-${lastAssistant.id}`,
        user: userText,
        assistant: cleanAssistantText(lastAssistant.text),
        fast: true,
      });
    }

    return () => {
      window.removeEventListener("keydown", handleDocumentKey, true);
      clearTimers();
      setDialogue("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exit]);

  // LÉLU finished typing: hold, then fade
  const handleTyped = useCallback(() => {
    const current = exchangeRef.current;
    if (!current) {
      return;
    }
    const exchangeId = current.id;
    clearTimers();
    setDialogue("complete");

    const hold = Math.min(16000, 4200 + current.assistant.length * 26);
    const holdId = window.setTimeout(() => {
      setFading(true);
      const fadeId = window.setTimeout(() => {
        setFading(false);
        if (exchangeRef.current?.id === exchangeId) {
          setDialogue("listening");
        }
        setExchange((existing) => (existing && existing.id === exchangeId ? null : existing));
      }, 900);
      timersRef.current.push(fadeId);
    }, hold);
    timersRef.current.push(holdId);
  }, [clearTimers, setDialogue]);

  // Voice conversation flows through the SAME scene text
  useEffect(() => {
    const turn = voiceView.turn;
    if (!turn) {
      return;
    }
    const id = `voice-${turn.id}`;
    const fast = prefersReducedMotion();
    setDialogue(turn.response ? "responding" : "processing");
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
  }, [setDialogue, voiceView.turn]);

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

  const send = useCallback(async (): Promise<void> => {
    const typed = input.trim();
    const media = pendingMedia;
    const files = pendingFiles;
    if ((!typed && media.length === 0 && files.length === 0) || isSending) {
      return;
    }

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
    clearTimers();
    setInput("");
    setPendingMedia([]);
    setPendingFiles([]);
    setFading(false);
    setIsSending(true);

    // INTERRUPT: stop any current speech immediately
    try { voiceEngineRef.current.cancelSpeech(); } catch { /* best-effort */ }

    artifactImagesRef.current = [];
    surfacesRef.current = [];
    setExchange({ id: exchangeId, user: display, assistant: "", fast: false, surfaces: [] });
    setDialogue("processing");

    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      text: display,
      timestamp: Date.now(),
      source: "local",
    });

    try {
      ExplorationController.getInstance().parseCommand(display);
    } catch {
      // contained
    }

    try {
      let context = "";
      try {
        context = crossChatContext(prompt || "");
      } catch {
        context = "";
      }

      // STREAMING VOICE: LÉLU begins speaking WHILE the response streams.
      const unsubscribeStream = ai.subscribeStream((event) => {
        try {
          voiceEngineRef.current.feedStreamingSpeech(event.text);
        } catch {
          // contained
        }
        const streamed = event.text;
        if (!streamed) return;
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
          const response = await ai.chat(prompt, media, context);
          assistantText = typeof response.text === "string" ? response.text : "";
        } else {
          const result = await Orchestrator.getInstance().process(prompt, undefined, context);
          assistantText = typeof result?.response === "string" ? result.response : "";
        }
      } finally {
        unsubscribeStream();
      }

      if (!assistantText) {
        const note = "⚠️ I couldn't generate a response — please try again.";
        notify("Lélu Error", "The assistant returned an empty response.");
        setExchange((current) =>
          current
            ? { ...current, assistant: note, fast: true, images: artifactImagesRef.current, surfaces: surfacesRef.current }
            : current,
        );
        setDialogue("listening");
        return;
      }

      setExchange({
        id: exchangeId,
        user: display,
        assistant: cleanAssistantText(assistantText),
        fast: prefersReducedMotion(),
        images: artifactImagesRef.current,
        surfaces: surfacesRef.current,
      });
      setDialogue("responding");

      try {
        voiceEngineRef.current.finishStreamingSpeech(assistantText);
      } catch {
        // contained
      }
    } catch (error) {
      try { voiceEngineRef.current.cancelSpeech(); } catch { /* best-effort */ }
      const messageText = error instanceof Error ? error.message : String(error);
      notify("Lélu Error", messageText);
      setExchange((current) =>
        current
          ? { ...current, assistant: `⚠️ ${messageText.slice(0, 200)}`, fast: true, images: artifactImagesRef.current, surfaces: surfacesRef.current }
          : current,
      );
      setDialogue("listening");
    } finally {
      setIsSending(false);
    }
  }, [addMessage, clearTimers, input, isSending, notify, pendingMedia, pendingFiles, setDialogue, crossChatContext]);


  const liveEcho =
    !isSending && input.length > 0
      ? input
      : "";

  const voiceEcho =
    voiceView.state.active && voiceView.state.phase === "listening" && voiceView.interim
      ? voiceView.interim
      : "";

  /* ----- Chat window state (movable, resizable, minimizable) ----- */
  const [chatPos, setChatPos] = useState({ x: -1, y: -1 }); // -1 = centered
  const [chatSize, setChatSize] = useState<"compact" | "medium" | "large">("medium");
  const [chatCorner, setChatCorner] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0, height: 480 });
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches,
  );
  const [mobileHeight, setMobileHeight] = useState<number | null>(null);
  const mobileResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
      if (!event.matches) {
        setMobileHeight(null);
      }
    };
    setIsMobileViewport(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleViewportChange);
    return () => mediaQuery.removeEventListener("change", handleViewportChange);
  }, []);

  /**
   * ORIENTATION SURVIVAL.
   *
   * `chatPos` is an absolute pixel position and `mobileHeight` an
   * absolute pixel height. Rotating the device swaps the viewport
   * dimensions but left both untouched, so a chat parked at x=600 in
   * landscape sat entirely outside a 400px-wide portrait viewport — it
   * "disappeared". Nothing was unmounted and no state was lost; it was
   * simply positioned off-screen with no way back.
   *
   * Re-clamp into the new viewport on every resize/orientation change.
   * Conversation, input and cognition state are untouched: this only
   * moves the window back into view.
   */
  useEffect(() => {
    const clampToViewport = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      setChatPos((current) => {
        if (current.x < 0 && current.y < 0) return current; // centered
        const floatW = Math.min(width - 16, 400);
        const maxX = Math.max(8, width - floatW - 8);
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
    };

    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    window.addEventListener("orientationchange", clampToViewport);
    // iOS reports the real usable area here when the URL bar/keyboard move.
    const visual = window.visualViewport;
    visual?.addEventListener("resize", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      window.removeEventListener("orientationchange", clampToViewport);
      visual?.removeEventListener("resize", clampToViewport);
    };
  }, []);

  /* ----- Auto-scroll: follow LELU's response, allow manual scroll-up ----- */
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const lastExchangeIdRef = useRef("");

  useEffect(() => {
    if (exchange && exchange.id !== lastExchangeIdRef.current) {
      lastExchangeIdRef.current = exchange.id;
      userScrolledRef.current = false;
    }
  }, [exchange]);

  useEffect(() => {
    if (!userScrolledRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [exchange?.assistant]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledRef.current = fromBottom > 60;
  }

  function jumpToLatest() {
    userScrolledRef.current = false;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if ((e.target as HTMLElement).closest("button,input,textarea")) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging.current = true;
    const frame = e.currentTarget.parentElement?.getBoundingClientRect();
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
    const width = window.innerWidth;
    const height = window.innerHeight;

    if (isMobileViewport) {
      // On mobile: freely repositionable but stays fully on screen
      const floatW = Math.min(width - 16, 400);
      const maxX = Math.max(8, width - floatW - 8);
      const maxY = Math.max(8, height - MOBILE_PILL_RESERVE - 400);
      setChatPos({
        x: Math.max(8, Math.min(maxX, dragStart.current.posX + dx)),
        y: Math.max(8, Math.min(maxY, dragStart.current.posY + dy)),
      });
      return;
    }

    const maxY = Math.max(8, height - dragStart.current.height - 8);
    setChatPos({
      x: Math.max(8, Math.min(width - 120, dragStart.current.posX + dx)),
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

  const sizeStyles: Record<string, CSSProperties> = {
    compact: { width: "min(88vw, 380px)", maxHeight: "min(50vh, 360px)" },
    medium:  { width: "min(92vw, 560px)", maxHeight: "min(62vh, 480px)" },
    large:   { width: "min(96vw, 720px)", maxHeight: "min(78vh, 620px)" },
  };

  // Minimized bubble
  if (chatMinimized) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: "fixed", zIndex: 25, bottom: 32, right: 24,
          pointerEvents: "auto",
          background: "rgba(8,16,38,0.82)", backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)", borderRadius: 999,
          padding: "10px 18px", display: "flex", gap: 10, alignItems: "center",
          border: "1px solid rgba(103,232,249,0.25)", cursor: "pointer",
          boxShadow: "0 8px 32px rgba(2,6,23,0.5)",
        }}
        onClick={() => setChatMinimized(false)}
      >
        <span style={{ fontSize: 16 }}>◎</span>
        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 500 }}>
          LÉLU{state.speaking ? " ●" : state.thinking ? " ···" : ""}
        </span>
      </motion.div>
    );
  }

  const isCentered = chatPos.x === -1;
  const isFloatingMobile = isMobileViewport && chatPos.x >= 0;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 800;
  const mobileSheetHeight = mobileHeight ?? Math.min(viewportHeight * 0.82, 720);
  const mobileFloatWidth = Math.min(viewportWidth - 16, 400);

  const windowStyle: CSSProperties = {
    position: "fixed",
    zIndex: 21,
    pointerEvents: "auto",
    ...(isMobileViewport
      ? isFloatingMobile
        ? {
            left: chatPos.x,
            top: chatPos.y,
            right: "auto",
            bottom: "auto",
            width: mobileFloatWidth,
            height: mobileSheetHeight,
            maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px)",
          }
        : {
            // MOBILE: fullscreen by default — the chat IS the app on mobile
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            width: "100%",
            height: "100dvh",
            maxHeight: "100dvh",
            borderRadius: 0,
          }
      : chatCorner
        ? { right: 16, bottom: 16, top: "auto", left: "auto", transform: "none" }
        : isCentered
          ? { left: "50%", top: "50%", transform: "translate(-50%,-45%)" }
          : { left: chatPos.x, top: chatPos.y }),
    ...(isMobileViewport ? {} : sizeStyles[chatSize]),
    display: "flex", flexDirection: "column",
    background: "rgba(6,14,32,0.94)",
    backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
    borderRadius: isMobileViewport && !isFloatingMobile ? 0 : "18px",
    border: isMobileViewport && !isFloatingMobile ? "none" : "1px solid rgba(103,232,249,0.2)",
    boxShadow: isMobileViewport && !isFloatingMobile ? "none" : "0 12px 48px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
    overflow: "hidden",
    overscrollBehavior: "contain",
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={windowStyle}
    >
      {/* Phone-only resize handle — only when floating (not fullscreen) */}
      {isMobileViewport && isFloatingMobile ? (
        <div
          onPointerDown={handleMobileResizeDown}
          onPointerMove={handleMobileResizeMove}
          onPointerUp={handleMobileResizeUp}
          onPointerCancel={handleMobileResizeUp}
          role="separator"
          aria-label="Resize chat"
          style={{
            height: 24,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "none",
            cursor: "ns-resize",
          }}
        >
          <span style={{ width: 42, height: 4, borderRadius: 99, background: "rgba(148,163,184,0.42)" }} />
        </div>
      ) : null}

      {/* Title bar */}
      <div
        onPointerDown={isMobileViewport && !isFloatingMobile ? undefined : handlePointerDown}
        onPointerMove={isMobileViewport && !isFloatingMobile ? undefined : handlePointerMove}
        onPointerUp={isMobileViewport && !isFloatingMobile ? undefined : handlePointerUp}
        onPointerCancel={isMobileViewport && !isFloatingMobile ? undefined : handlePointerUp}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "10px 14px", borderBottom: "1px solid rgba(103,232,249,0.12)",
          cursor: isMobileViewport && !isFloatingMobile ? "default" : "grab",
          flexShrink: 0,
          background: "rgba(103,232,249,0.04)",
          touchAction: isMobileViewport && !isFloatingMobile ? "auto" : "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          paddingTop: isMobileViewport && !isFloatingMobile
            ? `calc(env(safe-area-inset-top, 0px) + 10px)`
            : "10px",
        }}
      >
        {isMobileViewport ? (
          <button
            onClick={() => setChatPos({ x: -1, y: -1 })}
            disabled={!isFloatingMobile}
            title="Dock to bottom"
            aria-label="Dock chat to bottom"
            style={{ ...titleBtn, opacity: isFloatingMobile ? 1 : 0.35, cursor: isFloatingMobile ? "pointer" : "default" }}
          >
            ⇩
          </button>
        ) : (
          <>
            <button onClick={() => setChatSize(s => s === "compact" ? "medium" : s === "medium" ? "large" : "compact")}
              title="Resize" style={titleBtn}>⤢</button>
            <button onClick={() => setChatCorner(!chatCorner)}
              title={chatCorner ? "Float" : "Snap to corner"} style={titleBtn}>{chatCorner ? "⊡" : "⊟"}</button>
          </>
        )}
        <span style={{ flex: 1, textAlign: "center", fontSize: 11, color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>
          LÉLU · {state.speaking ? "speaking" : state.thinking ? "thinking" : "chat"}
        </span>
        <button
          onClick={() => window.dispatchEvent(new Event("genesis-lelu-menu-toggle"))}
          title="LÉLU menu — tools and live surfaces"
          aria-label="Open LÉLU menu"
          style={{ ...titleBtn, fontSize: 13 }}
        >
          ☰
        </button>
        <button onClick={() => { if (onExit) onExit(); else openPanel("none"); }} title="Close" style={{...titleBtn, color: "rgba(248,113,113,0.7)" }}>✕</button>
      </div>

      {/* Messages scroll area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto", overflowX: "hidden",
          padding: isMobileViewport && !isFloatingMobile
            ? `16px 18px calc(env(safe-area-inset-bottom, 0px) + 16px)`
            : "16px 18px",
          position: "relative",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(148, 163, 184, 0.35) transparent",
        }}
        data-lelu-dialogue-scroll
      >
        <div style={{
          display: "flex", flexDirection: "column", gap: 10,
          minHeight: "100%", justifyContent: exchange ? "flex-start" : "center",
        }}>
          <AnimatePresence>
            {liveEcho || voiceEcho ? (
              <motion.div
                key={liveEcho ? "echo" : "voice-echo"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22 }}
                style={userTextStyle}
              >
                {liveEcho || voiceEcho}
                <Caret />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {exchange ? (
              <motion.div
                key={exchange.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: fading ? 0 : 1, y: fading ? -10 : 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: fading ? 0.8 : 0.35 }}
              >
                {exchange.user ? (
                  <div style={userTextStyle}>{exchange.user}</div>
                ) : null}

                <div style={{ height: 8 }} />

                {exchange.assistant ? (
                  <AssistantLine
                    text={exchange.assistant}
                    fast={exchange.fast}
                    onDone={handleTyped}
                  />
                ) : (
                  <ThinkingDots />
                )}

                {exchange.images && exchange.images.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginTop: 12,
                      maxWidth: "min(300px, 100%)",
                    }}
                  >
                    {exchange.images.map((src, index) => (
                      <img
                        key={`${exchange.id}-${index}`}
                        src={src}
                        alt="Lélu render"
                        style={{
                          width: "100%",
                          borderRadius: 12,
                          border: "1px solid rgba(212,169,78,0.35)",
                          boxShadow: "0 10px 28px rgba(0,0,0,0.5)",
                          display: "block",
                        }}
                      />
                    ))}
                    <div style={{ fontSize: 11, opacity: 0.55, color: "#d4a94e" }}>
                      rendered by Lélu — saved to the Render gallery
                    </div>
                  </div>
                ) : null}

                {exchange.surfaces && exchange.surfaces.length > 0 ? (
                  <GenesisChatSurface surfaces={exchange.surfaces} />
                ) : null}
              </motion.div>
            ) : !liveEcho && !voiceEcho ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                style={{ ...userTextStyle, fontSize: "clamp(13px, 1.4vw + 8px, 15px)", color: "rgba(148,163,184,0.55)" }}
              >
                Type a message or speak to Lélu…
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Jump-to-latest button */}
        {userScrolledRef.current && exchange ? (
          <div style={{
            position: "sticky", bottom: 0, textAlign: "center", paddingBottom: 4,
          }}>
            <button
              onClick={jumpToLatest}
              style={{
                ...titleBtn, width: "auto", padding: "4px 12px", fontSize: 11,
                color: "rgba(103,232,249,0.8)", borderRadius: 999,
              }}
            >
              ↓ latest
            </button>
          </div>
        ) : null}
      </div>

      {/* Proactive question */}
      {activeQuestion ? (
        <div
          data-lelu-proactive-question
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "8px 12px",
            borderTop: "1px solid rgba(251, 191, 36, 0.18)",
            background: "rgba(251, 191, 36, 0.06)",
            color: "rgba(254, 243, 199, 0.92)",
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <span aria-hidden style={{ color: "rgba(251, 191, 36, 0.9)", flexShrink: 0 }}>?</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: "block", fontWeight: 600 }}>{activeQuestion.question}</strong>
            <span style={{ display: "block", marginTop: 2, color: "rgba(226, 232, 240, 0.62)" }}>
              {activeQuestion.reason}
            </span>
          </span>
          <button
            type="button"
            onClick={() => proactive.dismissQuestion(activeQuestion.id)}
            aria-label="Dismiss proactive question"
            title="Dismiss"
            style={{
              ...titleBtn,
              width: 24,
              height: 24,
              fontSize: 11,
              color: "rgba(226, 232, 240, 0.65)",
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Live execution timeline */}
      <GenesisExecutionTimeline />

      {/* Composer */}
      <div data-lelu-composer style={{
        flexShrink: 0,
        padding: isMobileViewport && !isFloatingMobile
          ? `10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px)`
          : "10px 14px",
        borderTop: "1px solid rgba(103,232,249,0.12)",
      }}>
        {pendingMedia.length > 0 || pendingFiles.length > 0 ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              overflowX: "auto",
              padding: "0 2px 8px",
              scrollbarWidth: "none",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {pendingMedia.map((media, index) => (
              <div
                key={`${media.kind}-${index}`}
                style={{
                  position: "relative",
                  width: 46,
                  height: 46,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid rgba(103, 232, 249, 0.35)",
                  boxShadow: "0 2px 10px rgba(2, 6, 23, 0.5)",
                  background: "rgba(8, 16, 38, 0.7)",
                  flexShrink: 0,
                }}
              >
                <img
                  src={media.dataUrl}
                  alt={media.kind === "video" ? "Video frame" : "Attached image"}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() =>
                    setPendingMedia((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  style={{
                    position: "absolute",
                    top: 1,
                    right: 1,
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    border: "none",
                    background: "rgba(2, 6, 23, 0.72)",
                    color: "rgba(248, 113, 113, 0.95)",
                    fontSize: 10,
                    lineHeight: 1,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            {pendingFiles.map((file) => (
              <div
                key={file.id}
                className="lelu-tab-cloud"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 10,
                  padding: "4px 8px 4px 10px",
                  fontSize: 11,
                  flexShrink: 0,
                  maxWidth: 180,
                }}
              >
                <span aria-hidden>📄</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file.name}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    setPendingFiles((current) => current.filter((item) => item.id !== file.id))
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "rgba(248, 113, 113, 0.9)",
                    fontSize: 11,
                    cursor: "pointer",
                    padding: 0,
                    fontFamily: "inherit",
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div
          className="lelu-tab-bar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 8px",
            borderRadius: 999,
          }}
        >
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => setMediaOpen((current) => !current)}
            title="Attach camera, gallery, video or files"
            aria-label="Attach media or files"
            aria-expanded={mediaOpen}
            className={mediaOpen ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px",
              color: "rgba(242, 230, 255, 0.95)",
              fontSize: 12, letterSpacing: "0.02em",
              cursor: "pointer", whiteSpace: "nowrap",
              borderRadius: 999, flexShrink: 0,
            }}
          >
            📷 Media
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => {
              const value = event.target.value;
              setInput(value);
              setDialogue(value.trim().length > 0 ? "typing" : "listening");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            autoFocus
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck={false}
            placeholder="Type instructions for Lélu…"
            aria-label="Message Lélu — type instructions for any attachments"
            rows={1}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              padding: "9px 4px",
              background: "transparent",
              color: "rgba(245, 240, 255, 0.97)",
              fontSize: 13.5,
              outline: "none",
              boxShadow: "none",
              fontFamily: "inherit",
              resize: "none",
              maxHeight: 120,
            }}
          />
          {/* INTERRUPT button */}
          {voiceView.state.phase === "speaking" && (
            <button
              type="button"
              onClick={() => voiceEngineRef.current.cancelSpeech()}
              title="Stop Lélu speaking"
              aria-label="Interrupt Lélu's speech"
              className="lelu-tab-cloud lelu-tab-cloud-active"
              style={{
                width: 34, height: 34, borderRadius: 999, flexShrink: 0,
                cursor: "pointer", display: "inline-flex", alignItems: "center",
                justifyContent: "center", fontSize: 13, fontFamily: "inherit",
                padding: 0, border: "none",
                background: "rgba(248, 113, 113, 0.22)", color: "#f87171",
              }}
            >
              ■
            </button>
          )}
          <button
            type="button"
            onClick={() => void voiceView.engine.toggle()}
            disabled={isSending}
            title={voiceView.state.active ? "Stop listening" : "Voice input"}
            aria-label={voiceView.state.active ? "Stop listening" : "Voice input"}
            className={voiceView.state.active ? "lelu-tab-cloud lelu-tab-cloud-active" : "lelu-tab-cloud"}
            style={{
              width: 34, height: 34, borderRadius: 999, flexShrink: 0,
              cursor: isSending ? "default" : "pointer",
              opacity: isSending ? 0.45 : 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontFamily: "inherit", padding: 0, border: "none",
              background: voiceView.state.active ? "rgba(167, 139, 250, 0.25)" : "transparent",
              color: voiceView.state.active ? "#a78bfa" : "rgba(203, 228, 255, 0.65)",
            }}
          >
            {voiceView.state.active ? (voiceView.state.phase === "listening" ? "🎙" : "◌") : "🎤"}
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={isSending || (!input.trim() && pendingMedia.length === 0 && pendingFiles.length === 0)}
            title={isSending ? "Sending…" : "Send to Lélu"}
            aria-label="Send message"
            className="lelu-tab-cloud lelu-tab-cloud-active"
            style={{
              width: 38, height: 38, borderRadius: 999, flexShrink: 0,
              cursor:
                isSending || (!input.trim() && pendingMedia.length === 0 && pendingFiles.length === 0)
                  ? "default" : "pointer",
              opacity:
                isSending || (!input.trim() && pendingMedia.length === 0 && pendingFiles.length === 0)
                  ? 0.45 : 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 15, fontFamily: "inherit",
            }}
          >
            {isSending ? "◌" : "➤"}
          </button>
        </div>
      </div>

      {/* Hidden file inputs */}
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

      {/* Media popover */}
      {mediaOpen ? (
        <div
          data-lelu-media-popover
          className="lelu-tab-bar"
          style={{
            position: "fixed",
            left: "50%",
            bottom: isMobileViewport && !isFloatingMobile
              ? `calc(clamp(120px, 20vh, 200px) + env(safe-area-inset-bottom, 0px))`
              : `calc(clamp(268px, 33vh, 336px) + ${MOBILE_PILL_RESERVE}px + env(safe-area-inset-bottom, 0px))`,
            transform: "translateX(-50%)",
            zIndex: 28,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 6,
            padding: 6,
            borderRadius: 16,
            maxWidth: "calc(100vw - 16px)",
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => { cameraInputRef.current?.click(); setMediaOpen(false); }}
            title="Take a photo"
            aria-label="Take a photo"
            className="lelu-tab-cloud"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", color: "rgba(242, 230, 255, 0.95)",
              fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", borderRadius: 12,
            }}
          >
            📷 Camera
          </button>
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => { imageInputRef.current?.click(); setMediaOpen(false); }}
            title="Choose an image"
            aria-label="Choose an image"
            className="lelu-tab-cloud"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", color: "rgba(242, 230, 255, 0.95)",
              fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", borderRadius: 12,
            }}
          >
            🖼 Gallery
          </button>
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => { videoInputRef.current?.click(); setMediaOpen(false); }}
            title="Record or choose a video"
            aria-label="Record or choose a video"
            className="lelu-tab-cloud"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", color: "rgba(242, 230, 255, 0.95)",
              fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", borderRadius: 12,
            }}
          >
            🎬 Video
          </button>
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => { fileInputRef.current?.click(); setMediaOpen(false); }}
            title="Attach files"
            aria-label="Attach files"
            className="lelu-tab-cloud"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 14px", color: "rgba(242, 230, 255, 0.95)",
              fontSize: 12, cursor: "pointer", whiteSpace: "nowrap", borderRadius: 12,
            }}
          >
            📄 Files
          </button>
        </div>
      ) : null}
    </motion.div>
  );
}
