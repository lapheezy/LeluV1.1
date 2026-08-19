/**
 * ==========================================================
 * LÉLUVERSE
 * VOICE CONTROL — THE MIC BUTTON
 *
 * A single, always-available glass control for continuous voice
 * conversation. It is NOT a chat box: just a small floating mic
 * glyph that lives above the scene and matches the dock's visual
 * language. Because the session belongs to the VoiceEngine
 * singleton, toggling it here keeps working no matter which LÉLU
 * section is open — voice runs in the background until the user
 * explicitly stops it.
 *
 * State language (same pulse family as the dock status dot):
 *   idle       → dim, still
 *   listening  → cyan, breathing
 *   processing → amber, fast pulse
 *   speaking   → green, bright pulse
 *   error      → red, with a caption that says exactly what to fix
 * ==========================================================
 */

import { motion } from "framer-motion";

import { useVoice, type VoiceErrorKind } from "../../../core/voice/useVoice";

const STATE_META: Record<
  string,
  { color: string; glow: string; title: string }
> = {
  idle: {
    color: "rgba(148, 163, 184, 0.85)",
    glow: "rgba(148, 163, 184, 0)",
    title: "Start voice conversation",
  },
  listening: {
    color: "#22d3ee",
    glow: "rgba(34, 211, 238, 0.55)",
    title: "Voice — listening",
  },
  processing: {
    color: "#fbbf24",
    glow: "rgba(251, 191, 36, 0.5)",
    title: "Voice — thinking",
  },
  speaking: {
    color: "#a7f3d0",
    glow: "rgba(167, 243, 208, 0.55)",
    title: "Voice — Lélu speaking",
  },
};

/** Error kinds that need the user (or host) to change something. */
const ACTIONABLE_ERRORS: VoiceErrorKind[] = [
  "permission",
  "insecure",
  "blocked-embed",
  "no-device",
  "service",
  "audio",
  "offline",
];

/** Short, distinct labels for every failure class. */
function errorLabel(kind: VoiceErrorKind | null): string {
  switch (kind) {
    case "permission":
      return "Mic permission denied";
    case "no-device":
      return "Mic unavailable";
    case "audio":
      return "Mic unavailable";
    case "unsupported":
      return "Recognition not supported";
    case "service":
      return "Recognition failed";
    case "blocked-embed":
      return "Mic blocked";
    case "insecure":
      return "Mic blocked";
    case "offline":
      return "Recognition offline";
    default:
      return "Recognition failed";
  }
}

export default function VoiceControl() {
  const voice = useVoice();

  const hasError = Boolean(voice.state.error);
  const actionable = hasError && voice.state.errorKind
    ? ACTIONABLE_ERRORS.includes(voice.state.errorKind)
    : false;

  const meta = actionable
    ? {
        color: "#f87171",
        glow: "rgba(248, 113, 113, 0.5)",
        title: "Voice needs attention",
      }
    : STATE_META[voice.state.phase] ?? STATE_META.idle;

  const active = voice.state.active;
  const pulsing = active && voice.state.phase !== "idle";
  const title = voice.state.error ?? meta.title;

  // Distinguish every voice state in the UI instead of collapsing
  // failures into "permission denied".
  const label = hasError
    ? errorLabel(voice.state.errorKind)
    : voice.state.phase === "listening"
      ? voice.interim
        ? "Listening · heard…"
        : "Listening"
      : voice.state.phase === "processing"
        ? "Thinking"
        : voice.state.phase === "speaking"
          ? "Speaking"
          : "Voice";

  return (
    <div
      style={{
        position: "fixed",
        bottom: "clamp(72px, 9vh, 96px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 26,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          background: "rgba(8, 16, 38, 0.66)",
          border: hasError
            ? "1px solid rgba(248, 113, 113, 0.4)"
            : "1px solid rgba(255,255,255,0.12)",
          borderRadius: 999,
          padding: "3px 10px",
          color: meta.color,
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
        }}
      >
        {label}
      </div>
      {hasError ? (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          style={{
            background: "rgba(8, 16, 38, 0.82)",
            border: "1px solid rgba(248, 113, 113, 0.42)",
            borderRadius: 10,
            padding: "7px 11px",
            maxWidth: "min(86vw, 340px)",
            color: "#fecaca",
            fontSize: 11,
            lineHeight: 1.45,
            textAlign: "center",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            boxShadow: "0 2px 12px rgba(2, 6, 23, 0.45)",
          }}
        >
          {voice.state.error}
        </motion.div>
      ) : null}

      <motion.button
        type="button"
        onClick={voice.toggle}
        title={title}
        aria-label={title}
        aria-pressed={active}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        whileTap={{ scale: 0.92 }}
        style={{
          pointerEvents: "auto",
          width: 46,
          height: 46,
          borderRadius: 999,
          border: hasError
            ? "1px solid rgba(248, 113, 113, 0.55)"
            : active
              ? `1px solid ${meta.color}66`
              : "1px solid rgba(255,255,255,0.16)",
          background: hasError
            ? "radial-gradient(circle at 50% 40%, rgba(248, 113, 113, 0.16), rgba(8, 16, 38, 0.72))"
            : active
              ? `radial-gradient(circle at 50% 40%, ${meta.color}2e, rgba(8, 16, 38, 0.72))`
              : "rgba(8, 16, 38, 0.66)",
          color: meta.color,
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          boxShadow: active
            ? `0 0 22px ${meta.glow}, 0 2px 10px rgba(2, 6, 23, 0.5)`
            : hasError
              ? "0 0 18px rgba(248, 113, 113, 0.28), 0 2px 10px rgba(2, 6, 23, 0.5)"
              : "0 2px 10px rgba(2, 6, 23, 0.4)",
          transition:
            "border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease",
        }}
      >
        <motion.span
          aria-hidden
          animate={
            pulsing
              ? { opacity: [1, 0.45, 1], scale: [1, 1.14, 1] }
              : { opacity: 1, scale: 1 }
          }
          transition={
            pulsing
              ? { repeat: Infinity, duration: 1.1, ease: "easeInOut" }
              : { duration: 0.2 }
          }
          style={{ display: "inline-block" }}
        >
          ◉
        </motion.span>
      </motion.button>
    </div>
  );
}
