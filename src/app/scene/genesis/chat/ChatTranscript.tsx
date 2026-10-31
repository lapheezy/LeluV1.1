/**
 * ==========================================================
 * LÉLU — CONVERSATION TRANSCRIPT
 *
 * Renders the active conversation as floating bubbles. Every
 * bubble is memoised on its own text, so a streaming reply
 * re-renders only the bubble it is growing, and history is
 * windowed (TRANSCRIPT_PAGE at a time) so a long conversation
 * never puts thousands of nodes on a phone.
 * ==========================================================
 */

import { Fragment, memo, useMemo, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import ChatMarkdown, { MessageCopy } from "./ChatMarkdown";
import ChatActivityCard from "./ChatActivity";
import { hasVisibleActivity } from "../../../../core/multichat/TurnActivity";
import {
  buildTranscript,
  TRANSCRIPT_PAGE,
  type ChatFailure,
  type LiveTurn,
  type TranscriptMessage,
} from "./chatTranscript";

/** "from “Research…”" — which chat a message in a merged chat came from. */
function OriginLabel({ title }: { title?: string }) {
  return title ? (
    <span className="lelu-cc-origin" data-lelu-origin={title}>
      from “{title}”
    </span>
  ) : null;
}

const UserBubble = memo(function UserBubble({
  text,
  latest,
  attachments,
  origin,
}: {
  text: string;
  latest: boolean;
  attachments?: string[];
  origin?: string;
}) {
  return (
    <article className="lelu-cc-msg lelu-cc-msg--user" aria-label="You said">
      <OriginLabel title={origin} />
      {/* data-lelu-exchange-user marks "the question on screen" — the latest
          one only, which is what the isolation check reads. */}
      <div className="lelu-cc-bubble--user" {...(latest ? { "data-lelu-exchange-user": "" } : {})}>
        <ChatMarkdown text={text} />
      </div>
      {attachments && attachments.length > 0 ? (
        <div className="lelu-cc-attachments">
          {attachments.map((src, index) => (
            <img key={index} src={src} alt={`Attachment ${index + 1}`} loading="lazy" decoding="async" />
          ))}
        </div>
      ) : null}
    </article>
  );
});

const AssistantBubble = memo(function AssistantBubble({
  text,
  streaming,
  latest,
  origin,
  children,
}: {
  text: string;
  streaming?: boolean;
  latest?: boolean;
  origin?: string;
  children?: ReactNode;
}) {
  return (
    <article
      className={`lelu-cc-msg lelu-cc-msg--assistant${latest ? " lelu-cc-msg--latest" : ""}`}
      aria-label="LÉLU said"
      aria-busy={streaming ? true : undefined}
      data-lelu-exchange-assistant=""
    >
      <div className="lelu-cc-speaker" aria-hidden>
        <span className="lelu-cc-orb" data-state={streaming ? "speaking" : "idle"} />
        LÉLU
      </div>
      <OriginLabel title={origin} />
      <div className="lelu-cc-bubble--assistant">
        <ChatMarkdown text={text} />
        {streaming ? <span className="lelu-cc-caret" aria-hidden /> : null}
        {children}
      </div>
      {!streaming ? (
        <div className="lelu-cc-msg-actions">
          <MessageCopy text={text} />
        </div>
      ) : null}
    </article>
  );
});

function Thinking() {
  return (
    <div className="lelu-cc-thinking" role="status" aria-live="polite">
      <span className="lelu-cc-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      LÉLU is thinking
    </div>
  );
}

function Failure({ failure, onRetry }: { failure: ChatFailure; onRetry?: (text: string) => void }) {
  return (
    <div className="lelu-cc-failure" role="alert">
      <strong>{failure.title}</strong>
      <p>{failure.detail}</p>
      {failure.retryText && onRetry ? (
        <button type="button" className="lelu-cc-chip lelu-cc-chip--primary" onClick={() => onRetry(failure.retryText!)}>
          <RotateCcw size={14} aria-hidden />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export interface ChatTranscriptProps {
  messages: TranscriptMessage[];
  live: (LiveTurn & { attachments?: string[] }) | null;
  inFlight: boolean;
  /** Visual results of the live turn (renders, search surfaces), shown with its reply. */
  liveExtras?: ReactNode;
  /** Live activity (operations), part of the conversation. */
  activity?: ReactNode;
  /** Voice interim transcript, shown as the user's line being spoken. */
  speaking?: string;
  onRetry?: (text: string) => void;
}

function ChatTranscriptImpl({ messages, live, inFlight, liveExtras, activity, speaking, onRetry }: ChatTranscriptProps) {
  const [limit, setLimit] = useState(TRANSCRIPT_PAGE);
  const transcript = useMemo(() => buildTranscript(messages, live, inFlight, limit), [messages, live, inFlight, limit]);
  const empty = transcript.messages.length === 0 && transcript.tail.length === 0 && !speaking;
  const lastIndex = transcript.messages.length - 1;
  // Extras belong with the live turn's reply: the last stored reply when it
  // has landed, otherwise the streaming bubble below.
  const streamingTail = transcript.tail.some((item) => item.kind === "streaming");
  const extrasOnLast = Boolean(liveExtras) && !streamingTail && lastIndex >= 0 && transcript.messages[lastIndex].role === "assistant";

  return (
    <div className="lelu-cc-thread">
      {transcript.hiddenBefore > 0 ? (
        <button type="button" className="lelu-cc-chip lelu-cc-earlier" onClick={() => setLimit((current) => current + TRANSCRIPT_PAGE)}>
          Show {Math.min(TRANSCRIPT_PAGE, transcript.hiddenBefore)} earlier message{transcript.hiddenBefore === 1 ? "" : "s"}
        </button>
      ) : null}

      {empty ? (
        <div className="lelu-cc-empty" data-lelu-keep-clear>
          <h2>What's on your mind?</h2>
          <p>Ask, explore, or speak — LÉLU is listening.</p>
        </div>
      ) : null}

      {transcript.messages.map((message, index) =>
        message.role === "user" ? (
          <UserBubble
            key={message.id}
            text={message.text}
            latest={message.id === transcript.latestUserId}
            attachments={live?.userMessageId === message.id ? live.attachments : undefined}
            origin={message.origin?.title}
          />
        ) : (
          <Fragment key={message.id}>
            {(() => {
              // The live turn's activity shows above its reply as it happens;
              // once stored on the reply it comes from the message itself.
              const activity = message.id === transcript.liveReplyId && live?.activity ? live.activity : message.activity;
              return hasVisibleActivity(activity) ? <ChatActivityCard activity={activity} /> : null;
            })()}
            <AssistantBubble text={message.text} latest={index === lastIndex} streaming={message.id === transcript.streamingId} origin={message.origin?.title}>
              {extrasOnLast && index === lastIndex ? liveExtras : null}
            </AssistantBubble>
          </Fragment>
        ),
      )}

      {speaking ? (
        <article className="lelu-cc-msg lelu-cc-msg--user" aria-label="You are saying">
          <div className="lelu-cc-bubble--user" style={{ opacity: 0.8 }}>
            {speaking}
            <span className="lelu-cc-caret" aria-hidden />
          </div>
        </article>
      ) : null}

      {/* Before the reply exists, the activity is the first thing she shows. */}
      {!transcript.liveReplyId && live && !live.settled && hasVisibleActivity(live.activity) ? <ChatActivityCard activity={live.activity} /> : null}

      {transcript.tail.map((item, index) => {
        if (item.kind === "streaming") {
          return (
            <AssistantBubble key="streaming" text={item.text} streaming={inFlight}>
              {liveExtras}
            </AssistantBubble>
          );
        }
        if (item.kind === "thinking") return <Thinking key="thinking" />;
        return <Failure key={`failure-${index}`} failure={item.failure} onRetry={onRetry} />;
      })}

      {/* Extras with no reply to sit under (e.g. a failed turn that still rendered). */}
      {liveExtras && !extrasOnLast && !streamingTail ? <div className="lelu-cc-msg">{liveExtras}</div> : null}

      {activity ? <div className="lelu-cc-activity">{activity}</div> : null}
    </div>
  );
}

const ChatTranscript = memo(ChatTranscriptImpl);
export default ChatTranscript;
