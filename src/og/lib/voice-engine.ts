import { create } from "zustand";
import { supabase } from "@og/integrations/supabase/client";

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
 * POST a transcript to /api/chat, parse the AI-SDK data stream, and return
 * the assistant's concatenated text. Falls back to a friendly error if the
 * network drops.
 */
export async function voiceRoundTrip(opts: {
  threadId: string;
  text: string;
  onDelta?: (chunk: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const clientId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const messages = [
    {
      id: clientId,
      role: "user",
      parts: [{ type: "text", text: opts.text }],
    },
  ];

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages,
      conversationId: opts.threadId,
      clientId,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`chat ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // AI-SDK stream is newline-delimited JSON events (data-stream v2)
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
        if (ev.type === "text-delta" && typeof ev.delta === "string") {
          full += ev.delta;
          opts.onDelta?.(ev.delta);
        } else if (ev.type === "text" && typeof ev.text === "string") {
          full += ev.text;
          opts.onDelta?.(ev.text);
        }
      } catch {
        // ignore non-JSON keepalives
      }
    }
  }
  return full.trim();
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