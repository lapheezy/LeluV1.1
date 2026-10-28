/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS NOTIFICATION CENTER
 *
 * Phase 6.
 *
 * `state.notifications` and `notify()` have existed since
 * before this pass (GenesisCore.tsx) and GenesisChat already
 * calls `notify("Lélu Error", ...)` on failure — but nothing
 * ever rendered the array. Notifications accumulated silently
 * and were invisible to the user. This component is the
 * missing read side, plus `dismissNotification()` (added this
 * pass) so the list doesn't grow forever.
 *
 * Auto-dismiss after 6s, manual dismiss on click, capped
 * stack so a burst of errors can't tile the whole screen —
 * "low cognitive load" per the brief, not a wall of toasts.
 * ==========================================================
 */

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import { layer } from "../../../core/ui/Layers";
import { useWorkspace } from "./useWorkspace";
import { useSurface } from "./surface/useSurface";
import NotificationProvider from "../../../core/notifications/NotificationProvider";

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;

/**
 * Height of the chat header band on a compact layout, plus a gap.
 *
 * Measured: the header occupies the top 49px and carries the LÉLU menu
 * control at its right edge.
 */
const COMPACT_HEADER_CLEARANCE = 64;

export default function GenesisNotificationCenter() {
  const { state, dismissNotification } = useGenesis();
  const workspace = useWorkspace();
  // A full-screen workspace on a phone is covered the same way: measured,
  // an "I read that" toast at the top lay over the Browser's title bar and
  // swallowed the tap on "◎ Chat".
  const surface = useSurface();
  const chatOwnsScreen = surface.chatOwnsScreen || surface.workspaceOwnsScreen;

  /*
   * While the conversation is the whole phone screen, nothing is thrown
   * over it: each notification goes to the Chats panel's NOTIFICATIONS
   * (the NotificationProvider history) instead of a toast across the
   * transcript. Ones that came from the provider are already there; the
   * direct notify() calls (errors, voice) are recorded there now.
   */
  useEffect(() => {
    if (!chatOwnsScreen || state.notifications.length === 0) return;
    const provider = NotificationProvider.getInstance();
    const recorded = new Set(provider.history().map((record) => record.id));
    for (const notification of state.notifications) {
      if (!recorded.has(notification.id)) {
        provider.notify({
          type: "info",
          title: notification.title,
          body: notification.description,
          silent: true,
          tag: `toast:${notification.id}`,
        });
      }
      dismissNotification(notification.id);
    }
  }, [chatOwnsScreen, state.notifications, dismissNotification]);

  if (chatOwnsScreen) return null;

  const visible = state.notifications.slice(-MAX_VISIBLE);

  return (
    <div
      data-lelu-notifications
      style={{
        position: "absolute",
        // On a phone this stack is 340px wide against a 390px viewport, so
        // at top:16 it ran straight through the chat header and swallowed
        // taps meant for the LÉLU menu control — measured with
        // elementFromPoint, which returned the "Lélu briefing" toast at the
        // control's own centre. A notification must never cover the
        // navigation it is announcing, so on compact widths it starts below
        // the header instead.
        top: workspace.compact ? COMPACT_HEADER_CLEARANCE : 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-end",
        pointerEvents: "none",
        // Was a bare 40, outside the hierarchy that decides what may cover
        // what. Transient cognition surfaces belong on the notification
        // layer, which sits above panels and below overlays and modals.
        zIndex: layer("notification"),
        maxWidth: "min(90vw, 340px)",
      }}
    >
      <AnimatePresence>
        {visible.map((notification) => (
          <GenesisToast
            key={notification.id}
            id={notification.id}
            title={notification.title}
            description={notification.description}
            onDismiss={dismissNotification}
          />
        ))}
      </AnimatePresence>
      {visible.length > 1 ? (
        <button
          type="button"
          onClick={() => visible.forEach((notification) => dismissNotification(notification.id))}
          style={{
            pointerEvents: "auto",
            border: "none",
            background: "transparent",
            color: "white",
            opacity: 0.6,
            fontSize: 11,
            padding: "2px 4px",
            cursor: "pointer",
          }}
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}

interface GenesisToastProps {
  id: string;
  title: string;
  description?: string;
  onDismiss: (id: string) => void;
}

function GenesisToast({ id, title, description, onDismiss }: GenesisToastProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [id, onDismiss]);

  const isError = /error|fail/i.test(title);

  return (
    <motion.button
      type="button"
      onClick={() => onDismiss(id)}
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      style={{
        pointerEvents: "auto",
        textAlign: "left",
        width: "100%",
        background: genesisTheme.glass.panel,
        border: isError ? "1px solid rgba(248, 113, 113, 0.45)" : genesisTheme.glass.borderAccent,
        borderRadius: genesisTheme.radius.md,
        padding: "10px 12px",
        color: "white",
        boxShadow: genesisTheme.glass.shadow,
        backdropFilter: genesisTheme.glass.blur,
        cursor: "pointer",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          marginBottom: description ? 4 : 0,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: isError ? genesisTheme.status.error : genesisTheme.status.accent,
            flexShrink: 0,
          }}
        />
        {title}
      </div>
      {description ? (
        <div style={{ fontSize: 12, opacity: 0.78, lineHeight: 1.4, overflowWrap: "anywhere" }}>
          {description}
        </div>
      ) : null}
    </motion.button>
  );
}
