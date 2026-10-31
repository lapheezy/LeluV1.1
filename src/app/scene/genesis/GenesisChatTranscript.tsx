/** @jsxRuntime automatic @jsxImportSource react */
/**
 * ==========================================================
 * LÉLUVERSE — CHAT TRANSCRIPT
 *
 * The scroll-back history of the ACTIVE conversation, drawn
 * above GenesisChat's live exchange. Before this, the chat
 * showed one exchange at a time and faded it out, so nothing
 * LÉLU had said stayed on screen.
 *
 * Reads only GenesisCore's `state.messages` (the active
 * MultiChat conversation) — no second message store. Each row
 * is memoized, so streaming into the live exchange below does
 * not re-render the history.
 * ==========================================================
 */

import { memo, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import type { GenesisMessage } from "./GenesisCore";
import GenesisChatSurface, { type ChatSurface } from "./GenesisChatSurface";
import { cleanAssistantText } from "../../../core/router/ToolMarkup";

/** Images/surfaces a past exchange produced. They are not part of the
 *  message record, so GenesisChat keeps them and anchors them by time. */
export interface ExchangeExtras {
  startedAt: number;
  images: string[];
  surfaces: ChatSurface[];
}

export const userBubbleStyle: CSSProperties = {
  alignSelf: "flex-end",
  maxWidth: "min(84%, 560px)",
  padding: "9px 14px",
  borderRadius: "18px 18px 6px 18px",
  background: "rgba(103, 232, 249, 0.1)",
  border: "1px solid rgba(103, 232, 249, 0.2)",
  color: "rgba(214, 236, 252, 0.96)",
  fontSize: "clamp(14px, 1.2vw + 9px, 16px)",
  lineHeight: 1.5,
  textAlign: "left",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

export const assistantBlockStyle: CSSProperties = {
  alignSelf: "stretch",
  color: "#f4fcff",
  fontSize: "clamp(14.5px, 1.3vw + 9.5px, 16.5px)",
  lineHeight: 1.6,
  textAlign: "left",
  overflowWrap: "anywhere",
  textShadow: "0 0 18px rgba(103, 232, 249, 0.22), 0 1px 2px rgba(2, 6, 23, 0.9)",
};

/**
 * Messages that belong in the scroll-back: everything older than the
 * live exchange (which GenesisChat renders itself, with its streaming
 * text, images and surfaces), so no turn is drawn twice.
 */
export function transcriptMessages(
  messages: readonly GenesisMessage[],
  liveExchangeStartedAt: number | null,
): GenesisMessage[] {
  return messages.filter(
    (message) =>
      message.text.trim().length > 0 &&
      (liveExchangeStartedAt === null || message.timestamp < liveExchangeStartedAt),
  );
}

/** Attach each past exchange's extras to the first assistant reply at or after it started. */
export function anchorExtras(
  messages: readonly GenesisMessage[],
  extras: readonly ExchangeExtras[],
): Map<string, ExchangeExtras> {
  const anchored = new Map<string, ExchangeExtras>();
  for (const extra of extras) {
    const reply = messages.find(
      (message) => message.role === "assistant" && message.timestamp >= extra.startedAt && !anchored.has(message.id),
    );
    if (reply) anchored.set(reply.id, extra);
  }
  return anchored;
}

const TranscriptRow = memo(function TranscriptRow({
  message,
  extras,
}: {
  message: GenesisMessage;
  extras?: ExchangeExtras;
}) {
  if (message.role === "user") {
    return (
      <div data-lelu-message="user" style={userBubbleStyle}>
        {message.text}
      </div>
    );
  }
  return (
    <div data-lelu-message="assistant" className="lelu-markdown" style={assistantBlockStyle}>
      <ReactMarkdown>{cleanAssistantText(message.text)}</ReactMarkdown>
      {extras && extras.images.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {extras.images.map((src, index) => (
            <img
              key={`${message.id}-img-${index}`}
              src={src}
              alt="Lélu render"
              loading="lazy"
              style={{
                width: "min(220px, 100%)",
                borderRadius: 12,
                border: "1px solid rgba(212,169,78,0.35)",
                display: "block",
              }}
            />
          ))}
        </div>
      ) : null}
      {extras && extras.surfaces.length > 0 ? <GenesisChatSurface surfaces={extras.surfaces} /> : null}
    </div>
  );
});

export default memo(function GenesisChatTranscript({
  messages,
  liveExchangeStartedAt,
  extras,
}: {
  messages: readonly GenesisMessage[];
  liveExchangeStartedAt: number | null;
  extras: readonly ExchangeExtras[];
}) {
  const visible = transcriptMessages(messages, liveExchangeStartedAt);
  if (visible.length === 0) return null;
  const anchored = anchorExtras(visible, extras);
  return (
    <div
      data-lelu-transcript
      role="log"
      aria-label="Conversation history"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      {visible.map((message) => (
        <TranscriptRow key={message.id} message={message} extras={anchored.get(message.id)} />
      ))}
    </div>
  );
});
