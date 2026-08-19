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

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE = 4;

export default function GenesisNotificationCenter() {
  const { state, dismissNotification } = useGenesis();

  const visible = state.notifications.slice(-MAX_VISIBLE);

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        alignItems: "flex-end",
        pointerEvents: "none",
        zIndex: 40,
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
