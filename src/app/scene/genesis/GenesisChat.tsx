/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CHAT — INVISIBLE ENVIRONMENTAL DIALOGUE
 *
 * The Genesis Core IS the chat. There is no panel, no input
 * box, no message bubbles, no window. Clicking the Core enters
 * dialogue mode: an invisible input is focused, the user's words
 * appear as text floating in the scene, and LÉLU's response is
 * typed progressively into the environment itself — the same
 * visual language as environmental dialogue appearing directly
 * in a scene rather than inside a conventional chat application.
 *
 * This is presentation only. The conversation flows through the
 * EXACT existing pipeline:
 *
 *   User (Enter)
 *     ↓
 *   AIService.chat()            ← the existing runtime
 *     ↓
 *   AIRuntime / providers / cognition / memory
 *     ↓
 *   response text                ← typed into the scene
 *     ↓
 *   addMessage (user) + bridge-emitted assistant message
 *                                 ← history/memory unchanged
 *
 * No second chatbot, no second memory, no second cognition
 * engine, no separate response handler.
 * ==========================================================
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";

import AIService from "../../../core/AIService";
import { useVoice } from "../../../core/voice/useVoice";
import {
  defaultMediaPrompt,
  mediaDisplayLabel,
  processImageFile,
  processVideoFile,
  type ProcessedMedia,
} from "../../../core/media/mediaProcessor";
import { useGenesis, type GenesisMessage } from "./GenesisCore";

const ai = AIService.getInstance();

/** One visible exchange: the user's line plus LÉLU's (possibly still being typed). */
interface Exchange {
  id: string;
  user: string;
  assistant: string;
  fast: boolean;
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

/* Chip layout shared by the Media tab and its popover options. The
   cotton-candy galaxy look (background, border, aura, stars) comes from
   the lelu-tab-cloud CSS class — inline styles only carry layout. */
const cloudChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 14px",
  color: "rgba(242, 230, 255, 0.95)",
  fontSize: 12,
  letterSpacing: "0.02em",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/* ------------------------------------------------------------------
 * Generic file attachments — anything that isn't an image/video rides
 * the SAME chat request as typed instructions: the file name/type/size
 * and (for small text files) a content preview are folded into the
 * prompt text, so LÉLU reads the attachment alongside what you typed.
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
 * Typewriter — reveals LÉLU's response progressively.
 * ---------------------------------------------------------- */

function useTypewriter(text: string, fast: boolean): number {
  const reduceMotion = prefersReducedMotion();
  const total = text.length;
  const [count, setCount] = useState(reduceMotion ? total : 0);

  useEffect(() => {
    if (reduceMotion) {
      setCount(total);
      return;
    }

    setCount(0);
    const tick = Math.max(1, Math.ceil(total / (fast ? 140 : 520)));
    const delay = fast ? 8 : total > 600 ? 14 : 22;

    const id = window.setInterval(() => {
      setCount((current) => {
        const next = current + tick;
        if (next >= total) {
          window.clearInterval(id);
          return total;
        }
        return next;
      });
    }, delay);

    return () => window.clearInterval(id);
  }, [text, total, fast, reduceMotion]);

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
  const count = useTypewriter(text, fast);
  const total = text.length;
  const doneRef = useRef(false);

  useEffect(() => {
    if (count >= total && total > 0 && !doneRef.current) {
      doneRef.current = true;
      onDone();
    }
  }, [count, total, onDone]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      style={assistantTextStyle}
    >
      {text.slice(0, count)}
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
  const { state, openPanel, addMessage, setDialogue, notify } = useGenesis();
  const voice = useVoice();

  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [fading, setFading] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<ProcessedMedia[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const exchangeRef = useRef<Exchange | null>(null);
  const mountedAtRef = useRef(Date.now());
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    exchangeRef.current = exchange;
  }, [exchange]);

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  }, []);

  const exit = useCallback(() => {
    clearTimers();
    setDialogue("idle");
    /* Inside Genesis v2 the caller supplies onExit so leaving chat stays in
       the v2 workspace; in v1 the original openPanel path is unchanged. */
    if (onExit) {
      onExit();
    } else {
      openPanel("none");
    }
  }, [clearTimers, onExit, openPanel, setDialogue]);

  /*
   * On entering dialogue mode (Core click / dock Chat): focus the invisible
   * input, restore the last exchange into the scene so the conversation
   * context is visible, and mark the Core as listening.
   */
  useEffect(() => {
    mountedAtRef.current = Date.now();
    setDialogue("listening");
    inputRef.current?.focus();

    // This tap activates the dialogue: unlock iOS's speechSynthesis audio
    // session inside the gesture so LÉLU's typed responses are spoken too.
    voice.engine.unlockAudio();

    // Safety net: while dialogue mode is live, Escape always exits, and any
    // keystroke re-focuses the invisible input if autofocus was blocked (so
    // typing never silently goes nowhere).
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
        assistant: lastAssistant.text,
        fast: true,
      });
    }

    return () => {
      window.removeEventListener("keydown", handleDocumentKey, true);
      clearTimers();
      setDialogue("idle");
    };
    // Replay only the messages that exist when dialogue mode opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exit]);

  /*
   * LÉLU finished typing: the Core returns to its resting "complete" pulse,
   * holds the words in the environment, then lets them fade naturally.
   */
  const handleTyped = useCallback(() => {
    const current = exchangeRef.current;
    if (!current) {
      return;
    }
    const exchangeId = current.id;
    setDialogue("complete");

    const hold = Math.min(16000, 4200 + current.assistant.length * 26);
    const holdId = window.setTimeout(() => {
      setFading(true);
      const fadeId = window.setTimeout(() => {
        setFading(false);
        // Only reset the phase if this exchange is still the one on screen
        // (a new typed or voice turn may have replaced it meanwhile).
        if (exchangeRef.current?.id === exchangeId) {
          setDialogue("listening");
        }
        setExchange((existing) => (existing && existing.id === exchangeId ? null : existing));
      }, 900);
      timersRef.current.push(fadeId);
    }, hold);
    timersRef.current.push(holdId);
  }, [setDialogue]);

  /*
   * Voice conversation flows through the SAME scene text: a committed
   * utterance becomes the user line, and LÉLU's spoken reply types out
   * into the environment while she speaks it. Driven by the one
   * VoiceEngine — voice keeps working even when this dialogue is closed.
   */
  useEffect(() => {
    const turn = voice.turn;
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
        assistant: turn.response,
        fast,
      };
    });
  }, [setDialogue, voice.turn]);

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

  /** Generic file attachments — folded into the prompt text (see send). */
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
            // binary or unreadable — no preview, name/type/size still go
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

    // What appears in the scene / history: the typed words plus short
    // labels for anything attached, so the exchange reads as one line.
    const displayParts: string[] = [];
    if (typed) displayParts.push(typed);
    if (media.length > 0) displayParts.push(mediaDisplayLabel(media));
    if (files.length > 0) displayParts.push(fileListLabel(files));
    const display = displayParts.join(" ");

    // What the model receives: the typed instructions are ALWAYS the
    // primary prompt (that's the point — you type instructions for the
    // attachments); media rides the same request, and file contents are
    // folded into the prompt as reference context.
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

    // User's line appears in the scene immediately; the same exchange then
    // receives LÉLU's typed response, so the words read as one conversation.
    setExchange({ id: exchangeId, user: display, assistant: "", fast: false });
    setDialogue("processing");

    // The EXISTING chat pipeline — one path, unchanged. Media rides along
    // on the same request; providers without vision ignore it.
    addMessage({
      id: crypto.randomUUID(),
      role: "user",
      text: display,
      timestamp: Date.now(),
      source: "local",
    });

    try {
      const response = await ai.chat(
        prompt,
        media.length > 0 ? media : undefined,
      );
      const assistantText = response.text;

      if (!assistantText) {
        notify("Lélu Error", "The assistant returned an empty response.");
        setDialogue("listening");
        return;
      }

      // LÉLU's reply is emitted through the existing AIService → bridge
      // message channel too, so history/memory persist exactly as before.
      setExchange({
        id: exchangeId,
        user: display,
        assistant: assistantText,
        fast: prefersReducedMotion(),
      });
      setDialogue("responding");

      // LÉLU SPEAKS her response aloud — automatically, through the one
      // existing TTS system, whether the message came by voice or by text.
      voice.engine.speakResponse(assistantText);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      notify("Lélu Error", messageText);
      setDialogue("listening");
    } finally {
      setIsSending(false);
    }
  }, [addMessage, clearTimers, input, isSending, notify, pendingMedia, pendingFiles, setDialogue, voice.engine]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    // Escape is handled globally (see handleDocumentKey) so it also works
    // when the invisible input is not the focused element.
    if (event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  }

  function handleOverlayClick(event: ReactMouseEvent<HTMLDivElement>) {
    // Clicks inside the conversation column keep focus (and allow scrolling
    // long responses); clicks on the composer or the media popover act on
    // the message itself. Any other click is "clicking away" → exit.
    const clicked = event.target as HTMLElement;
    if (
      clicked.closest("[data-lelu-dialogue-scroll]") ||
      clicked.closest("[data-lelu-composer]") ||
      clicked.closest("[data-lelu-media-popover]")
    ) {
      return;
    }
    // Grace period so the click that activated the Core never exits instantly.
    if (Date.now() - mountedAtRef.current < 400) {
      return;
    }
    exit();
  }

  const liveEcho =
    !isSending && input.length > 0
      ? input
      : "";

  // The user's spoken words echo into the scene live while she listens.
  // Gated to the listening phase: during LÉLU's own speech the recognition
  // hears her voice too, and that must never be shown as a user line.
  const voiceEcho =
    voice.state.active && voice.state.phase === "listening" && voice.interim
      ? voice.interim
      : "";

  return (
    <motion.div
      className="genesis-dialogue-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      onClick={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 21,
        pointerEvents: "auto",
        cursor: "default",
        background: "transparent",
      }}
    >
      {/*
       * VISIBLE COMPOSER — the dialogue's input bar. Media and file
       * attachments sit directly ABOVE the input, so you type the
       * instructions for them in the same bar; the Send button fires
       * the SAME chat pipeline (see send).
       */}
      <div
        data-lelu-composer
        style={{
          position: "fixed",
          left: "50%",
          bottom: "calc(clamp(148px, 19vh, 192px) + env(safe-area-inset-bottom, 0px))",
          transform: "translateX(-50%)",
          zIndex: 27,
          width: "min(94vw, 640px)",
          pointerEvents: "auto",
        }}
      >
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
            style={{ ...cloudChipStyle, borderRadius: 999, padding: "8px 12px", flexShrink: 0 }}
          >
            📷 Media
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => {
              const value = event.target.value;
              setInput(value);
              setDialogue(value.trim().length > 0 ? "typing" : "listening");
            }}
            onKeyDown={handleKeyDown}
            autoFocus
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck={false}
            enterKeyHint="send"
            placeholder="Type instructions for Lélu…"
            aria-label="Message Lélu — type instructions for any attachments"
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
            }}
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={isSending || (!input.trim() && pendingMedia.length === 0 && pendingFiles.length === 0)}
            title={isSending ? "Sending…" : "Send to Lélu"}
            aria-label="Send message"
            className="lelu-tab-cloud lelu-tab-cloud-active"
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              flexShrink: 0,
              cursor:
                isSending || (!input.trim() && pendingMedia.length === 0 && pendingFiles.length === 0)
                  ? "default"
                  : "pointer",
              opacity:
                isSending || (!input.trim() && pendingMedia.length === 0 && pendingFiles.length === 0)
                  ? 0.45
                  : 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontFamily: "inherit",
            }}
          >
            {isSending ? "◌" : "➤"}
          </button>
        </div>
      </div>

      {/*
       * Attachment sources — camera / gallery / video / files, all
       * hidden inputs driven from the Media popover. Selected media
       * rides the SAME chat request (see send), so providers with
       * vision analyze it and providers without simply ignore it.
       */}
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

      {/* One Media tab — camera, gallery, video and files live behind it. */}
      {mediaOpen ? (
        <div
          data-lelu-media-popover
          className="lelu-tab-bar"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(clamp(268px, 33vh, 336px) + env(safe-area-inset-bottom, 0px))",
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
            onClick={() => {
              cameraInputRef.current?.click();
              setMediaOpen(false);
            }}
            title="Take a photo with the camera"
            aria-label="Take a photo"
            className="lelu-tab-cloud"
            style={{ ...cloudChipStyle, borderRadius: 12 }}
          >
            📷 Camera
          </button>
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => {
              imageInputRef.current?.click();
              setMediaOpen(false);
            }}
            title="Choose an image from your library"
            aria-label="Choose an image"
            className="lelu-tab-cloud"
            style={{ ...cloudChipStyle, borderRadius: 12 }}
          >
            🖼 Gallery
          </button>
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => {
              videoInputRef.current?.click();
              setMediaOpen(false);
            }}
            title="Record or choose a video"
            aria-label="Record or choose a video"
            className="lelu-tab-cloud"
            style={{ ...cloudChipStyle, borderRadius: 12 }}
          >
            🎬 Video
          </button>
          <button
            type="button"
            disabled={mediaBusy || isSending}
            onClick={() => {
              fileInputRef.current?.click();
              setMediaOpen(false);
            }}
            title="Attach files (documents, code, text) — LÉLU reads the contents"
            aria-label="Attach files"
            className="lelu-tab-cloud"
            style={{ ...cloudChipStyle, borderRadius: 12 }}
          >
            📄 Files
          </button>
        </div>
      ) : null}

      {/* Floating environmental dialogue — no frame, no bubble. */}
      <div
        data-lelu-dialogue-scroll
        style={{
          position: "absolute",
          left: "50%",
          top: "clamp(76px, 23vh, 200px)",
          transform: "translateX(-50%)",
          width: "min(90vw, 620px)",
          maxHeight: "40vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(148, 163, 184, 0.35) transparent",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "4px 8px",
        }}
      >
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
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
