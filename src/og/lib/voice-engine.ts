import { create } from "zustand";
import AIService from "../../core/AIService";

export type VoiceState =
  | "idle"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export type VoiceTranscript = {
  id: string;
  text: string;
  role: "user" | "assistant";
  at: number;
};

type State = {
  state: VoiceState;
  errorMessage: string | null;
  level: number;
  interim: string;
  history: VoiceTranscript[];
  supported: boolean;
  threadId: string | null;
  setState: (s: VoiceState, err?: string | null) => void;
  setLevel: (v: number) => void;
  setInterim: (v: string) => void;
  pushTranscript: (t: VoiceTranscript) => void;
  setThreadId: (id: string | null) => void;
};

export const useVoice = create<State>((set) => ({
  state: "idle",
  errorMessage: null,
  level: 0,
  interim: "",
  history: [],
  supported: true,
  threadId: null,
  setState: (s, err = null) =>
    set({ state: s, errorMessage: s === "error" ? err : null }),
  setLevel: (level) => set({ level }),
  setInterim: (interim) => set({ interim }),
  pushTranscript: (t) =>
    set((prev) => ({ history: [t, ...prev.history].slice(0, 200) })),
  setThreadId: (threadId) => set({ threadId }),
}));

/**
 * Speak to LÉLU and get her answer back.
 *
 * The OG original POSTed to /api/chat — that deployment's server route, which
 * owned the model call and streamed AI-SDK events back. Two things are wrong
 * with keeping it: the route no longer exists, and it was a SECOND path to a
 * model. Brief §14 is explicit that voice and typed chat must not maintain
 * separate cognition, and §4 forbids parallel chat engines.
 *
 * So voice now goes exactly where typing goes: AIService.chat(). Streaming is
 * preserved through subscribeStream(), so the caller's onDelta still fires as
 * text arrives and the panel behaves as it did. The only difference between
 * speaking and typing is the modality, which is what §14 asks for.
 *
 * It also no longer requires a Supabase session. The session was needed to
 * authorize the old server route; cognition runs in-process, so voice works
 * signed out and without Supabase like the rest of LÉLU.
 */
export async function voiceRoundTrip(opts: {
  threadId: string;
  text: string;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const ai = AIService.getInstance();

  let streamed = "";
  const unsubscribe = ai.subscribeStream(({ text }) => {
    if (opts.signal?.aborted) return;
    // AIService streams the whole text so far; onDelta wants the new part.
    if (typeof text === "string" && text.length > streamed.length) {
      const delta = text.slice(streamed.length);
      streamed = text;
      opts.onDelta?.(delta);
    }
  });

  try {
    const response = await ai.chat(opts.text);
    const full = (response?.text ?? "").trim();
    // A turn that never streamed still has to reach the caller intact.
    if (full && !streamed) opts.onDelta?.(full);
    return full;
  } finally {
    unsubscribe();
  }
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    try {
      window.speechSynthesis.cancel();
    } catch { /* ignore */ }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    u.lang = navigator.language || "en-US";
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}