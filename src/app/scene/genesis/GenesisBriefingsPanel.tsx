/**
 * ==========================================================
 * LÉLU — BRIEFINGS PANEL
 *
 * The read side of core/proactive/BriefingStore: the things
 * LÉLU has told you that were not replies to anything.
 *
 * It exists because a briefing used to be an assistant
 * ChatMessage, which gave it no read state, no way to dismiss
 * it, and no history separate from the conversation it landed
 * in. This is deliberately compact — a title, one or two
 * sentences, where it came from — not a log viewer. The
 * underlying work is reachable through "Open", which goes to
 * the conversation the work is being done in.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import BriefingStore, { type Briefing, type BriefingPriority } from "../../../core/proactive/BriefingStore";
import MultiChatStore from "../../../core/multichat/MultiChatStore";
import ProjectStore from "../../../core/projects/ProjectStore";
import { useGenesis } from "./GenesisCore";

const PRIORITY_COLOR: Record<BriefingPriority, string> = {
  P0: "#f87171",
  P1: "#fbbf24",
  P2: "#67e8f9",
  P3: "rgba(148, 163, 184, 0.8)",
};

const CATEGORY_LABEL: Record<Briefing["category"], string> = {
  "work-completed": "Finished",
  "work-stopped": "Stopped",
  learning: "Learned",
  system: "System",
};

function when(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

interface Props {
  onClose: () => void;
}

export default function GenesisBriefingsPanel({ onClose }: Props) {
  const store = useMemo(() => BriefingStore.getInstance(), []);
  const { switchConversation, openPanel } = useGenesis();
  const [briefings, setBriefings] = useState<Briefing[]>(() => store.list());
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => store.subscribe(setBriefings), [store]);

  const visible = briefings.filter((briefing) => showDismissed || !briefing.dismissedAt);
  const unread = briefings.filter((briefing) => !briefing.readAt && !briefing.dismissedAt).length;

  /** Go to the work itself, not to a description of it. */
  const open = useCallback(
    (briefing: Briefing) => {
      store.markRead(briefing.id);
      if (!briefing.conversationId) return;
      if (!MultiChatStore.getInstance().get(briefing.conversationId)) return;
      switchConversation(briefing.conversationId);
      openPanel("chat");
    },
    [store, switchConversation, openPanel],
  );

  return (
    <GenesisWindowFrame title={`Briefings${unread > 0 ? ` · ${unread} unread` : ""}`} onClose={onClose}>
      <div data-lelu-briefings style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => store.markAllRead()}
            disabled={unread === 0}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.03)",
              color: "white",
              borderRadius: 999,
              padding: "4px 12px",
              fontSize: 11,
              cursor: unread === 0 ? "default" : "pointer",
              opacity: unread === 0 ? 0.45 : 1,
              fontFamily: "inherit",
            }}
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={() => setShowDismissed((current) => !current)}
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background: showDismissed ? "rgba(34, 211, 238, 0.14)" : "rgba(255,255,255,0.03)",
              color: "white",
              borderRadius: 999,
              padding: "4px 12px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {showDismissed ? "Hiding nothing" : "Show dismissed"}
          </button>
        </div>

        {visible.length === 0 ? (
          <div style={{ padding: "18px 4px", fontSize: 12, opacity: 0.6, lineHeight: 1.5 }}>
            Nothing to report. Briefings appear when autonomous work finishes or stops — not on a
            schedule, and not because the app opened.
          </div>
        ) : null}

        {visible.map((briefing) => {
          const project = briefing.relatedProjectId
            ? ProjectStore.getInstance().get(briefing.relatedProjectId)
            : undefined;
          const hasConversation =
            Boolean(briefing.conversationId) &&
            Boolean(MultiChatStore.getInstance().get(briefing.conversationId!));

          return (
            <div
              key={briefing.id}
              data-lelu-briefing
              data-lelu-briefing-unread={!briefing.readAt && !briefing.dismissedAt ? "true" : "false"}
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                borderLeft: `2px solid ${PRIORITY_COLOR[briefing.priority]}`,
                borderRadius: 12,
                padding: "10px 12px",
                background: briefing.readAt ? "rgba(255,255,255,0.02)" : "rgba(34, 211, 238, 0.06)",
                opacity: briefing.dismissedAt ? 0.55 : 1,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{briefing.title}</span>
                <span style={{ fontSize: 10, color: PRIORITY_COLOR[briefing.priority], letterSpacing: "0.06em" }}>
                  {briefing.priority} · {CATEGORY_LABEL[briefing.category]}
                </span>
                <span style={{ fontSize: 10, opacity: 0.55, marginLeft: "auto" }}>{when(briefing.createdAt)}</span>
              </div>

              <div style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.45 }}>{briefing.summary}</div>

              {briefing.reason ? (
                <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.4 }}>{briefing.reason}</div>
              ) : null}

              {project ? (
                <div style={{ fontSize: 11, opacity: 0.6 }}>Project · {project.name}</div>
              ) : null}

              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {hasConversation ? (
                  <button
                    type="button"
                    onClick={() => open(briefing)}
                    style={{
                      border: "1px solid rgba(103, 232, 249, 0.3)",
                      background: "rgba(34, 211, 238, 0.12)",
                      color: "white",
                      borderRadius: 999,
                      padding: "3px 11px",
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Open
                  </button>
                ) : null}
                {!briefing.readAt ? (
                  <button
                    type="button"
                    onClick={() => store.markRead(briefing.id)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "transparent",
                      color: "rgba(226,232,240,0.8)",
                      borderRadius: 999,
                      padding: "3px 11px",
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Mark read
                  </button>
                ) : null}
                {!briefing.dismissedAt ? (
                  <button
                    type="button"
                    onClick={() => store.dismiss(briefing.id)}
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "rgba(226,232,240,0.6)",
                      borderRadius: 999,
                      padding: "3px 11px",
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </GenesisWindowFrame>
  );
}
