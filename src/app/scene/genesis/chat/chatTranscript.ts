/**
 * ==========================================================
 * LÉLU — CHAT TRANSCRIPT (pure)
 *
 * What the conversation surface shows, decided without React.
 *
 * The transcript is the active conversation's stored messages —
 * the same `state.messages` GenesisBridge upserts streamed
 * replies into — so history, streaming and replay all come from
 * the one existing store. The live turn only adds what the store
 * does not hold: a reply still arriving, the "thinking" moment
 * before the first word, and a failure the user can retry.
 * ==========================================================
 */

import type { ChatActivity } from "../../../../core/multichat/TurnActivity";

export interface TranscriptMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  /** What LÉLU did for this reply, recorded from real events and stored with it. */
  activity?: ChatActivity;
  /** The chat this message came from, when it was carried into a merged chat. */
  origin?: { conversationId: string; title: string };
}

/** The live turn, as GenesisChat tracks it. */
export interface LiveTurn {
  id: string;
  user: string;
  assistant: string;
  /** The stored user message this turn wrote, when known. */
  userMessageId?: string;
  /** Rebuilt from history — nothing is in flight. */
  settled?: boolean;
  error?: ChatFailure;
  /** The live turn's activity, until it is stored on the reply. */
  activity?: ChatActivity;
}

export interface ChatFailure {
  title: string;
  detail: string;
  /** What to send again, if retrying makes sense. */
  retryText?: string;
}

/** How far back the surface renders before asking to show more. */
export const TRANSCRIPT_PAGE = 40;

/**
 * Is this text something to show a person?
 *
 * A reply that came back as the literal string "undefined" (or "null",
 * or a stringified object) is a bug upstream, not something LÉLU said.
 * It is never painted as speech.
 */
export function isDisplayableText(text: unknown): text is string {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !/^(undefined|null|nan|\[object object\])$/i.test(trimmed);
}

export type TailItem =
  | { kind: "streaming"; text: string }
  | { kind: "thinking" }
  | { kind: "failure"; failure: ChatFailure };

export interface Transcript {
  /** Messages to render, oldest first, already windowed. */
  messages: TranscriptMessage[];
  /** How many older messages are hidden above. */
  hiddenBefore: number;
  /** Id of the latest user message — "the question on screen". */
  latestUserId: string | null;
  /** What the live turn adds after the stored messages. */
  tail: TailItem[];
  /** A stored reply that is still being streamed into (shown with a caret). */
  streamingId: string | null;
  /** The live turn's stored reply, once it exists — where its activity shows. */
  liveReplyId: string | null;
}

/**
 * Build what the conversation surface shows.
 *
 * The live turn adds a "streaming" bubble only while its reply is not
 * yet in the store (the store catches up a frame later, and a reply
 * shown twice would read as LÉLU repeating herself); "thinking" only
 * while a turn is really in flight and nothing has arrived; and a
 * failure, which is never stored, always.
 */
export function buildTranscript(
  all: TranscriptMessage[],
  live: LiveTurn | null,
  inFlight: boolean,
  limit: number,
): Transcript {
  const displayable = all.filter((message) => isDisplayableText(message.text));
  const start = Math.max(0, displayable.length - Math.max(1, limit));
  const messages = displayable.slice(start);
  let latestUserId: string | null = null;
  for (let index = displayable.length - 1; index >= 0; index -= 1) {
    if (displayable[index].role === "user") {
      latestUserId = displayable[index].id;
      break;
    }
  }

  const tail: TailItem[] = [];
  let streamingId: string | null = null;
  let liveReplyId: string | null = null;
  if (live && !live.settled) {
    // Where the live turn's question sits in the store. By id when the
    // turn wrote it; otherwise (voice) the latest matching user line.
    let anchor = live.userMessageId ? displayable.findIndex((message) => message.id === live.userMessageId) : -1;
    if (anchor < 0 && live.user) {
      for (let index = displayable.length - 1; index >= 0; index -= 1) {
        if (displayable[index].role === "user" && displayable[index].text.trim() === live.user.trim()) {
          anchor = index;
          break;
        }
      }
    }
    const replyStored = anchor >= 0 && displayable.slice(anchor + 1).some((message) => message.role === "assistant");
    if (replyStored) liveReplyId = displayable.slice(anchor + 1).find((message) => message.role === "assistant")?.id ?? null;
    // Streamed partials are upserted into the store as they arrive, so the
    // growing reply is usually already a stored message.
    if (replyStored && inFlight && !live.error) {
      const last = displayable[displayable.length - 1];
      if (last.role === "assistant") streamingId = last.id;
    }
    if (!replyStored && isDisplayableText(live.assistant)) {
      tail.push({ kind: "streaming", text: live.assistant });
    } else if (!replyStored && !live.error && inFlight) {
      tail.push({ kind: "thinking" });
    }
    if (live.error) tail.push({ kind: "failure", failure: live.error });
  }

  return { messages, hiddenBefore: start, latestUserId, tail, streamingId, liveReplyId };
}

/**
 * Turn an error into something LÉLU can say.
 *
 * Raw messages ("undefined", "TypeError: Failed to fetch", a provider's
 * JSON) are diagnostics, not conversation. The detail keeps the useful
 * part in plain words; nothing here invents a cause the error did not
 * state.
 */
export function describeFailure(error: unknown, retryText?: string): ChatFailure {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const message = isDisplayableText(raw) ? raw.trim() : "";
  const lower = message.toLowerCase();
  let detail: string;
  if (!message) {
    detail = "Something went wrong before I could answer, and it didn't say what.";
  } else if (/empty response|no response|returned nothing/.test(lower)) {
    detail = "The model answered with nothing, so there was nothing to show.";
  } else if (/timed? ?out|timeout|deadline/.test(lower)) {
    detail = "The service stopped responding before the answer was ready.";
  } else if (/failed to fetch|network|offline|econn|socket|dns/.test(lower)) {
    detail = "I couldn't reach the network to finish this.";
  } else if (/401|403|unauthori[sz]ed|forbidden|api key|credential/.test(lower)) {
    detail = "A provider refused the request — its credentials may need attention.";
  } else if (/429|rate limit|quota|too many requests/.test(lower)) {
    detail = "A provider is rate-limiting me right now.";
  } else if (/5\d\d|server error|unavailable|overloaded/.test(lower)) {
    detail = "A provider had a server problem while answering.";
  } else {
    detail = message.length > 220 ? `${message.slice(0, 217)}…` : message;
  }
  return { title: "LÉLU couldn't complete that", detail, retryText: isDisplayableText(retryText) ? retryText : undefined };
}

/** Is the scroll position close enough to the bottom to keep following? */
export function isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 80): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
