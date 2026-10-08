import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Square, Volume2, MessageSquare, AlertTriangle } from "lucide-react";
import { useWindows } from "../WindowManager";
import { useProcessing } from "../ProcessingProvider";
import { useVoice, voiceRoundTrip, speak, type VoiceState } from "@og/lib/voice-engine";
import { createConversation } from "@og/lib/conversations.functions";
import { cn } from "@og/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRecognitionClass(): any {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

const STATE_LABELS: Record<VoiceState, string> = {
  idle: "Ready",
  listening: "Listening",
  processing: "Processing",
  speaking: "Speaking",
  error: "Error",
};

const STATE_DOT: Record<VoiceState, string> = {
  idle: "bg-foreground/30",
  listening: "bg-emerald-400 animate-pulse",
  processing: "bg-amber-300 animate-pulse",
  speaking: "bg-sky-300 animate-pulse",
  error: "bg-red-400",
};

export function VoicePanel() {
  const proc = useProcessing();
  const openWin = useWindows((s) => s.open);
  const v = useVoice();
  const [supported] = useState(() => !!getRecognitionClass());
  const [hasMic, setHasMic] = useState<boolean>(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const audioRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const listenTaskRef = useRef<string | null>(null);
  const shouldRestartRef = useRef(false);
  const busyRef = useRef(false);
  const wantsListenRef = useRef(false);

  // Probe available input devices — flip UI to a clear message if none exist,
  // and re-check when devices are added/removed (headset plugged in, etc.).
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    let cancel = false;
    const check = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancel) return;
        setHasMic(devices.some((d) => d.kind === "audioinput"));
      } catch {
        /* ignore */
      }
    };
    void check();
    navigator.mediaDevices.addEventListener?.("devicechange", check);
    return () => {
      cancel = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", check);
    };
  }, []);

  const teardownAudio = useCallback(() => {
    if (audioRef.current) {
      cancelAnimationFrame(audioRef.current.raf);
      audioRef.current.stream.getTracks().forEach((t) => t.stop());
      audioRef.current.ctx.close().catch(() => {});
      audioRef.current = null;
    }
    useVoice.getState().setLevel(0);
  }, []);

  const stopRecognition = useCallback(() => {
    shouldRestartRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    recRef.current = null;
    if (listenTaskRef.current) { proc.end(listenTaskRef.current); listenTaskRef.current = null; }
  }, [proc]);

  useEffect(() => {
    return () => {
      stopRecognition();
      teardownAudio();
      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    };
  }, [stopRecognition, teardownAudio]);

  async function ensureThread(): Promise<string> {
    const existing = useVoice.getState().threadId
      ?? (typeof window !== "undefined" ? window.localStorage.getItem("lelu:voice:thread") : null);
    if (existing) {
      useVoice.getState().setThreadId(existing);
      return existing;
    }
    const c = await createConversation({ data: { title: "Voice session" } });
    if (typeof window !== "undefined") window.localStorage.setItem("lelu:voice:thread", c.id);
    useVoice.getState().setThreadId(c.id);
    return c.id;
  }

  const handleFinalTranscript = useCallback(async (text: string) => {
    if (!text.trim() || busyRef.current) return;
    busyRef.current = true;
    const store = useVoice.getState();
    store.pushTranscript({ id: crypto.randomUUID(), text, role: "user", at: Date.now() });
    store.setState("processing");
    // Pause auto-restart so we don't listen while we speak
    shouldRestartRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }

    const procId = proc.start({ kind: "thinking", label: text.slice(0, 40) });
    try {
      const threadId = await ensureThread();
      const reply = await voiceRoundTrip({ threadId, text });
      proc.end(procId);
      if (!reply) {
        store.setState("idle");
        busyRef.current = false;
        if (wantsListenRef.current) { try { recRef.current?.start(); shouldRestartRef.current = true; } catch { /* ignore */ } }
        return;
      }
      store.pushTranscript({ id: crypto.randomUUID(), text: reply, role: "assistant", at: Date.now() });
      store.setState("speaking");
      const speakId = proc.start({ kind: "speaking", label: reply.slice(0, 40) });
      await speak(reply);
      proc.end(speakId);
      store.setState("idle");
      busyRef.current = false;
      // Auto-resume listening if the user hadn't stopped explicitly.
      if (wantsListenRef.current && recRef.current) {
        shouldRestartRef.current = true;
        try { recRef.current.start(); store.setState("listening"); } catch { /* already running */ }
      }
    } catch (err) {
      proc.end(procId);
      const msg = err instanceof Error ? err.message : String(err);
      store.setState("error", `Network hiccup: ${msg}. Transcript kept — send in chat?`);
      busyRef.current = false;
    }
  }, [proc]);

  async function start() {
    const Rec = getRecognitionClass();
    if (!Rec) { v.setState("error", "Speech recognition not supported in this browser."); return; }

    // getUserMedia MUST run inside the same user-gesture stack as this click.
    // Do it first — iOS Safari drops gesture context after the first await,
    // so any permissions.query() beforehand would kill the prompt.
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? "";
      const map: Record<string, string> = {
        NotAllowedError: "Microphone permission denied.",
        SecurityError: "Microphone permission denied.",
        NotFoundError: "No microphone found.",
        NotReadableError: "Microphone is busy in another app.",
        OverconstrainedError: "No microphone matches these constraints.",
        AbortError: "Microphone request was cancelled — try again.",
        TypeError: "Microphone unavailable — this page must be served over HTTPS.",
      };
      const detail = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.warn("[voice] getUserMedia failed:", name, detail);
      v.setState("error", map[name] ?? `Couldn't access the microphone (${name || "unknown"}).`);
      return;
    }

    // Audio meter
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      audioRef.current = { ctx, stream, raf: 0 };
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) { const s = (x - 128) / 128; sum += s * s; }
        useVoice.getState().setLevel(Math.sqrt(sum / buf.length));
        if (audioRef.current) audioRef.current.raf = requestAnimationFrame(tick);
      };
      audioRef.current.raf = requestAnimationFrame(tick);
    } catch { /* meter is optional */ }

    const rec = new Rec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ev = e as any;
      let final = "";
      let inter = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else inter += r[0].transcript;
      }
      useVoice.getState().setInterim(inter);
      if (final.trim()) {
        useVoice.getState().setInterim("");
        void handleFinalTranscript(final.trim());
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (ev: any) => {
      const errName = ev?.error ?? "unknown";
      if (errName === "not-allowed" || errName === "service-not-allowed") {
        shouldRestartRef.current = false;
        useVoice.getState().setState("error", "Microphone permission denied.");
      } else if (errName === "no-speech" || errName === "aborted") {
        // benign; keep listening
        return;
      } else {
        useVoice.getState().setState("error", `Recognition error: ${errName}`);
      }
    };
    rec.onend = () => {
      const state = useVoice.getState().state;
      if (shouldRestartRef.current && state !== "error" && state !== "speaking") {
        try { rec.start(); return; } catch { /* fall through */ }
      }
      if (state === "listening") useVoice.getState().setState("idle");
    };

    shouldRestartRef.current = true;
    wantsListenRef.current = true;
    try { rec.start(); } catch { /* already started */ }
    recRef.current = rec;
    listenTaskRef.current = proc.start({ kind: "listening", label: "microphone" });
    v.setState("listening");
  }

  function stop() {
    wantsListenRef.current = false;
    stopRecognition();
    teardownAudio();
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    v.setState("idle");
    v.setInterim("");
  }

  function fallbackToChat() {
    stop();
    const last = v.history.find((h) => h.role === "user")?.text ?? "";
    if (typeof window !== "undefined" && last) {
      // Stash the transcript so chat can pick it up as a draft
      const tid = useVoice.getState().threadId;
      if (tid) window.localStorage.setItem(`lelu.draft.${tid}`, last);
    }
    openWin({ id: "chat", key: "chat", title: "Chat" });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 p-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (v.state === "listening" ? stop() : start())}
            disabled={!supported || v.state === "processing" || v.state === "speaking"}
            className={cn(
              "grid h-12 w-12 place-items-center rounded-full transition disabled:opacity-40",
              v.state === "listening"
                ? "bg-red-500/30 text-red-100 hover:bg-red-500/40"
                : "bg-white/10 text-foreground hover:bg-white/15",
            )}
            title={v.state === "listening" ? "Stop" : "Start listening"}
          >
            {v.state === "listening"
              ? <Square className="size-5" />
              : supported ? <Mic className="size-5" /> : <MicOff className="size-5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-foreground/60">
              <span className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT[v.state])} />
              {!supported
                ? "Not supported"
                : !hasMic
                  ? "No microphone"
                  : STATE_LABELS[v.state]}
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full bg-emerald-300/70 transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.round(v.level * 240))}%` }}
              />
            </div>
            {v.interim && <div className="mt-2 truncate text-xs text-foreground/60">{v.interim}…</div>}
          </div>
        </div>
        {v.state === "error" && v.errorMessage && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-100">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div className="flex-1">
              <div>{v.errorMessage}</div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { v.setState("idle"); }}
                  className="rounded bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] hover:bg-white/20"
                >
                  Retry
                </button>
                <button
                  onClick={fallbackToChat}
                  className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] hover:bg-white/20"
                >
                  <MessageSquare className="size-3" /> Continue in chat
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.3em] text-foreground/50">Voice history</div>
          <button
            onClick={fallbackToChat}
            className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-foreground/60 hover:bg-white/5 hover:text-foreground"
          >
            <MessageSquare className="size-3" /> Open chat
          </button>
        </div>
        {v.history.length === 0 && <div className="text-xs text-foreground/40">Nothing captured yet.</div>}
        <ul className="space-y-1.5">
          {v.history.map((r) => (
            <li key={r.id} className={cn(
              "rounded-md border border-white/10 p-2 text-sm",
              r.role === "user" ? "bg-white/[0.03]" : "bg-sun/5 border-sun/20",
            )}>
              <div className="flex items-start gap-2">
                <span className="flex-1 whitespace-pre-wrap">{r.text}</span>
                <button
                  title="Speak"
                  onClick={() => { void speak(r.text); }}
                  className="rounded p-1 text-foreground/50 hover:bg-white/10 hover:text-foreground"
                >
                  <Volume2 className="size-3.5" />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-foreground/40">
                <span>{r.role === "user" ? "You" : "Lélu"}</span>
                <span>·</span>
                <span>{new Date(r.at).toLocaleTimeString()}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}