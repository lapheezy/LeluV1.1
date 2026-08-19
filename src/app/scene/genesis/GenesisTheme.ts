/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS THEME
 *
 * Phase 6 — not a new design language, a name for the one
 * that already existed. Every value below was copied verbatim
 * out of GenesisInterface.tsx / GenesisReasoningPanel.tsx
 * (glass panels, cyan accents, 24px/16px radii, the same
 * uppercase 11px letter-spaced label pattern). New Phase 6
 * components (GenesisCommandPalette, GenesisNotificationCenter,
 * GenesisDiagnosticsPanel) import from here instead of
 * re-typing the same rgba() strings a fourth and fifth time,
 * so a future palette change happens in one place.
 *
 * Deliberately just string/number constants — no CSS-in-JS
 * runtime, no new dependency, works with the exact inline
 * `style={{...}}` convention the rest of Genesis already uses.
 * ==========================================================
 */

export const genesisTheme = {
  glass: {
    panel: "linear-gradient(135deg, rgba(2, 8, 23, 0.92), rgba(30, 41, 59, 0.68))",
    panelAlt: "linear-gradient(135deg, rgba(2, 8, 23, 0.92), rgba(14, 116, 144, 0.65))",
    chip: "rgba(2, 6, 23, 0.8)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderSoft: "1px solid rgba(255,255,255,0.12)",
    borderAccent: "1px solid rgba(125, 211, 252, 0.4)",
    // Kept for any caller still reading the old single-layer shadow directly.
    shadow: "0 24px 70px rgba(0, 153, 255, 0.28)",
    blur: "blur(24px)",
    blurSoft: "blur(16px)",
  },
  /**
   * Phase 12 — floating-window depth.
   *
   * A single boxShadow reads as "panel with a shadow," not as
   * "pane suspended above a lit environment." Real elevation needs at
   * least two layers: a tight, dark contact shadow close to the edge
   * (grounds the window) plus a soft, wide glow tinted by the
   * environment (sells the suspension in Genesis). Three named
   * elevations cover today's needs: `float` for ordinary panels,
   * `focus` for the surface currently receiving input (chat), and
   * `chrome` for the always-on dock/status chip, which should sit
   * closer to the "desktop" and feel less detached.
   */
  elevation: {
    chrome: {
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.32), 0 2px 6px rgba(0, 0, 0, 0.24)",
      backdropFilter: "blur(16px)",
    },
    float: {
      boxShadow:
        "0 2px 8px rgba(0, 0, 0, 0.4), 0 24px 60px rgba(0, 153, 255, 0.22), inset 0 1px 0 rgba(255,255,255,0.06)",
      backdropFilter: "blur(24px)",
    },
    focus: {
      boxShadow:
        "0 4px 14px rgba(0, 0, 0, 0.45), 0 32px 80px rgba(0, 153, 255, 0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
      backdropFilter: "blur(28px)",
    },
  },
  radius: {
    lg: 24,
    md: 16,
    pill: 999,
  },
  text: {
    label: {
      fontSize: 11,
      opacity: 0.68,
      textTransform: "uppercase" as const,
      letterSpacing: "0.16em",
    },
    eyebrow: {
      fontSize: 12,
      opacity: 0.75,
      textTransform: "uppercase" as const,
      letterSpacing: "0.24em",
    },
  },
  status: {
    ok: "rgba(74, 222, 128, 0.9)",
    warn: "rgba(250, 204, 21, 0.9)",
    error: "rgba(248, 113, 113, 0.9)",
    idle: "rgba(148, 163, 184, 0.8)",
    accent: "rgba(34, 211, 238, 0.9)",
  },
  closeButton: {
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    color: "white",
    padding: "10px 16px",
    // Phase 13 — touch target: 40px min height keeps every header
    // button (close, Clear, etc.) comfortably inside the ~44px
    // reachable-tap-area guidance instead of the old 6px-padding
    // button, which measured under 30px tall on a phone.
    minHeight: 40,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
} as const;

export default genesisTheme;
