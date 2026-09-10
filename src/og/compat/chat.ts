/**
 * ==========================================================
 * LÉLU — OG CHAT COMPATIBILITY LAYER
 *
 * "OG UX + current LÉLU brain" — this is the join.
 *
 * The OG chat UI is written against the Vercel AI SDK's
 * useChat(), which POSTs to a server route that owns the model
 * call. v1.1 already has exactly one chat runtime,
 * AIService.chat(), and the brief is explicit that a second one
 * must not appear (§4: no parallel chat engines; §15: v1.1's
 * provider registry stays authoritative).
 *
 * So the transport is not reimplemented — it is removed. This
 * module presents the same useChat() contract the OG components
 * consume (messages, sendMessage, status, error) and fulfils it
 * by calling AIService, streaming through subscribeStream() so
 * the OG typing behaviour is preserved rather than faked.
 *
 * Consequences, all of them intended:
 *   - The OG chat inherits v1.1's provider fallback chain,
 *     cognition, memory and tools for free.
 *   - Voice and typed chat share one brain (§14) because
 *     AIService is what v1.1's voice path already calls.
 *   - No /api/chat route is needed, so the OG chat works inside
 *     Capacitor on Android, where no server exists.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AIService from "../../core/AIService";

/** The AI SDK message shape the OG components render. */
export interface UIMessagePart {
  type: "text";
  text: string;
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: UIMessagePart[];
}

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

/** Read the text out of a UIMessage regardless of how it was built. */
export function messageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function textMessage(role: UIMessage["role"], text: string, id?: string): UIMessage {
  return {
    id: id ?? `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    parts: [{ type: "text", text }],
  };
}

/**
 * Kept so OG call sites construct unchanged. The options carried routing and
 * auth for the old server route; none of that applies now that the turn is
 * served in-process, so they are accepted and ignored rather than silently
 * pretending to configure something.
 */
export interface ChatTransportOptions {
  api?: string;
  prepareSendMessagesRequest?: (args: {
    messages: UIMessage[];
    body?: Record<string, unknown>;
  }) => Promise<{ body?: unknown; headers?: Record<string, string> }>;
  [key: string]: unknown;
}

export class DefaultChatTransport<_T = UIMessage> {
  constructor(_options?: ChatTransportOptions) {}
}

export interface UseChatOptions {
  id?: string;
  messages?: UIMessage[];
  transport?: unknown;
  onError?: (error: Error) => void;
  onFinish?: (message: UIMessage) => void;
}

export interface UseChatResult {
  messages: UIMessage[];
  sendMessage: (input: { text: string }) => Promise<void>;
  status: ChatStatus;
  error: Error | undefined;
  setMessages: (messages: UIMessage[]) => void;
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const { id, messages: initialMessages, onError, onFinish } = options;

  const [messages, setMessages] = useState<UIMessage[]>(initialMessages ?? []);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<Error | undefined>(undefined);

  const ai = useMemo(() => AIService.getInstance(), []);

  // Re-seed when the caller switches thread, matching useChat({ id }).
  const seededFor = useRef<string | undefined>(id);
  useEffect(() => {
    if (seededFor.current === id) return;
    seededFor.current = id;
    setMessages(initialMessages ?? []);
    setStatus("ready");
    setError(undefined);
  }, [id, initialMessages]);

  /**
   * The id AIService streams under. Chunks arrive before chat() resolves, so
   * the placeholder assistant message is patched in place as they land —
   * which is what gives the OG UI its progressive reveal.
   */
  const streamingIdRef = useRef<string | null>(null);

  useEffect(() => {
    return ai.subscribeStream(({ id: streamId, text }) => {
      const target = streamingIdRef.current;
      if (!target) return;
      setStatus("streaming");
      setMessages((prev) =>
        prev.map((message) =>
          message.id === target
            ? { ...message, parts: [{ type: "text" as const, text }] }
            : message,
        ),
      );
      void streamId;
    });
  }, [ai]);

  const sendMessage = useCallback(
    async ({ text }: { text: string }) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setError(undefined);
      setStatus("submitted");

      const placeholder = textMessage("assistant", "");
      streamingIdRef.current = placeholder.id;
      setMessages((prev) => [...prev, textMessage("user", trimmed), placeholder]);

      try {
        const response = await ai.chat(trimmed);
        const finalText = response?.text ?? "";
        const finished: UIMessage = {
          id: placeholder.id,
          role: "assistant",
          parts: [{ type: "text", text: finalText }],
        };
        setMessages((prev) =>
          prev.map((message) => (message.id === placeholder.id ? finished : message)),
        );
        setStatus("ready");
        onFinish?.(finished);
      } catch (caught) {
        const err = caught instanceof Error ? caught : new Error(String(caught));
        // Drop the empty placeholder — an errored turn produced no message,
        // and leaving a blank bubble would misrepresent what happened.
        setMessages((prev) => prev.filter((message) => message.id !== placeholder.id));
        setStatus("error");
        setError(err);
        onError?.(err);
      } finally {
        streamingIdRef.current = null;
      }
    },
    [ai, onError, onFinish],
  );

  return { messages, sendMessage, status, error, setMessages };
}
