/**
 * ==========================================================
 * LÉLU — BRIEFING / NOTIFICATIONS CONTROL
 *
 * ONE persistent way into the briefing, wherever LÉLU is.
 *
 * Before this there was a `notifications` dock tab and a toast
 * stack, and nothing that said "there is something for you"
 * from the chat itself. This is that control: one button, an
 * unread count that means something (announcements since you
 * last looked, plus proposals waiting on a decision), and it
 * opens the EXISTING notifications module — not a second
 * notification surface.
 *
 * It is a chat-header control and a dock control, so it is
 * reachable with or without the workspace rail expanded, on
 * laptop and phone alike.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useGenesis } from "./GenesisCore";
import ImprovementQueue from "../../../core/selfdev/ImprovementQueue";
import {
  markBriefingSeen,
  subscribeBriefing,
  unseenBriefingCount,
} from "../../../core/notifications/Briefing";

interface Props {
  /** Square size in px. Defaults to a 30px header control. */
  size?: number;
  style?: CSSProperties;
}

export default function GenesisBriefingButton({ size = 30, style }: Props) {
  const { state, openModule } = useGenesis();
  const queue = useMemo(() => ImprovementQueue.getInstance(), []);
  const [decisionCount, setDecisionCount] = useState(
    () => queue.byStatus("Approved").length + queue.byStatus("Ready").length,
  );
  // Re-read the seen watermark whenever it moves (the panel marks it).
  const [, setSeenVersion] = useState(0);

  useEffect(() => subscribeBriefing(() => setSeenVersion((v) => v + 1)), []);

  useEffect(() => {
    const update = () => {
      setDecisionCount(queue.byStatus("Approved").length + queue.byStatus("Ready").length);
    };
    update();
    return queue.subscribe(update);
  }, [queue]);

  const unread = unseenBriefingCount(state.notifications) + decisionCount;
  const isOpen = Boolean(state.modules?.notifications && state.modules.notifications.presentation !== "closed");

  return (
    <button
      type="button"
      data-lelu-briefing
      onClick={() => {
        // Opening is seeing: the badge clears for what is on screen now.
        markBriefingSeen();
        openModule("notifications");
      }}
      title={unread > 0 ? `Briefing — ${unread} new` : "Briefing & notifications"}
      aria-label={unread > 0 ? `Open briefing, ${unread} new` : "Open briefing and notifications"}
      aria-expanded={isOpen}
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 999,
        border: isOpen
          ? "1px solid rgba(167, 139, 250, 0.6)"
          : "1px solid rgba(148,163,184,0.18)",
        background: isOpen ? "rgba(167,139,250,0.18)" : "rgba(255,255,255,0.05)",
        color: unread > 0 ? "rgba(237, 233, 254, 0.98)" : "rgba(212, 228, 244, 0.8)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontFamily: "inherit",
        padding: 0,
        ...style,
      }}
    >
      <svg
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            minWidth: 15,
            height: 15,
            padding: "0 4px",
            borderRadius: 999,
            background: decisionCount > 0 ? "#fbbf24" : "#a78bfa",
            color: "#020617",
            fontSize: 9,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            lineHeight: 1,
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );
}
