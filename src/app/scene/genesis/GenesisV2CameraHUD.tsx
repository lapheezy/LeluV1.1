/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS V2 — CAMERA CONTROL HUD
 *
 * A clean, collapsible camera control layer for the explorable
 * Gen V2 world — visible controls for users who don't discover
 * gestures naturally, without permanently covering the scene.
 *
 *   RESET      → return to the default composition
 *   LÉLU       → fly to LÉLU
 *   CORE       → fly to the Genesis Core
 *   ORBIT/FLY  → switch camera mode (seamless, no snap)
 *   ZOOM − / + → dolly in/out
 *   FULLSCREEN → Gen V2 becomes the primary viewport
 *
 * Every button drives the REAL camera through the intent bus —
 * the same bus agent activity and chat commands use.
 * ==========================================================
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { genesisCameraIntentBus, requestV2Fullscreen } from "./GenesisCameraIntent";
import type { GenesisV2FocusTarget } from "./GenesisCameraIntent";

type HudMode = "orbit" | "fly";

const BTN: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  height: 34,
  minWidth: 34,
  padding: "0 10px",
  borderRadius: 10,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  background: "rgba(8, 16, 38, 0.6)",
  color: "rgba(214, 228, 244, 0.9)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  cursor: "pointer",
  whiteSpace: "nowrap",
  userSelect: "none",
  WebkitUserSelect: "none",
  WebkitTapHighlightColor: "transparent",
  transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
};

const ICON_BTN: CSSProperties = { ...BTN, padding: 0 };

export default function GenesisV2CameraHUD({ mobile = false }: { mobile?: boolean }) {
  const [mode, setMode] = useState<HudMode>("orbit");
  const [collapsed, setCollapsed] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The unified interface (dock/chat) stays mounted above the v2 scene.
     On desktop it is an 80px left rail — clear it. On mobile it is a
     bottom bar — sit above it. */
  const hudLeft = mobile ? 12 : 96;
  const hudBottom: number | string = mobile ? "calc(env(safe-area-inset-bottom, 0px) + 78px)" : 14;

  // Auto-collapse on idle (touch devices) so the environment stays
  // visually dominant; the compact chip stays available to reopen.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isTouch = window.matchMedia?.("(pointer: coarse)").matches;
    if (!isTouch) return;
    const timer = setTimeout(() => setCollapsed(true), 6500);
    idleTimer.current = timer;
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  function poke(): void {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
      idleTimer.current = setTimeout(() => setCollapsed(true), 6500);
    }
  }

  function emit(intent: Parameters<typeof genesisCameraIntentBus.emit>[0]): void {
    genesisCameraIntentBus.emit(intent);
    poke();
  }

  function focus(target: GenesisV2FocusTarget): void {
    emit({ type: "focus", target });
  }

  function toggleMode(): void {
    const next: HudMode = mode === "orbit" ? "fly" : "orbit";
    setMode(next);
    window.dispatchEvent(new CustomEvent("genesis-v2-camera-mode", { detail: { mode: next } }));
    poke();
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => {
          setCollapsed(false);
          poke();
        }}
        title="Camera controls"
        aria-label="Open camera controls"
        style={{
          position: "absolute",
          left: hudLeft,
          bottom: hudBottom,
          zIndex: 7,
          width: 38,
          height: 38,
          borderRadius: 999,
          border: "1px solid rgba(125, 211, 252, 0.4)",
          background: "linear-gradient(120deg, rgba(8, 16, 40, 0.7), rgba(16, 20, 48, 0.6))",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          color: "#7dd3fc",
          fontSize: 15,
          cursor: "pointer",
          boxShadow: "0 8px 26px rgba(2, 6, 23, 0.5)",
        }}
      >
        ◉
      </button>
    );
  }

  return (
    <div
      onPointerDown={poke}
      style={{
        position: "absolute",
        left: hudLeft,
        bottom: hudBottom,
        zIndex: 7,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "auto",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 6,
          borderRadius: 14,
          border: "1px solid rgba(148, 163, 184, 0.18)",
          background: "rgba(4, 10, 30, 0.62)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 12px 40px rgba(2, 6, 23, 0.5)",
          maxWidth: "min(94vw, 430px)",
          flexWrap: "wrap",
        }}
      >
        <button type="button" style={BTN} onClick={() => emit({ type: "reset" })} title="Reset camera" aria-label="Reset camera">
          ⟲ <span style={{ display: "inline" }}>Reset</span>
        </button>
        <button type="button" style={BTN} onClick={() => focus("lelu")} title="Focus LÉLU" aria-label="Focus LÉLU">
          ◉ <span>LÉLU</span>
        </button>
        <button type="button" style={BTN} onClick={() => focus("core")} title="Focus the Core" aria-label="Focus the Core">
          ⬡ <span>Core</span>
        </button>
        <button
          type="button"
          style={{ ...BTN, borderColor: mode === "fly" ? "rgba(232, 121, 249, 0.55)" : undefined, color: mode === "fly" ? "#f0abfc" : undefined }}
          onClick={toggleMode}
          title="Toggle orbit / free-fly camera"
          aria-label="Toggle orbit or free-fly camera"
        >
          {mode === "fly" ? "✈ Free Fly" : "◍ Orbit"}
        </button>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" style={ICON_BTN} onClick={() => emit({ type: "zoom-out" })} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <button type="button" style={ICON_BTN} onClick={() => emit({ type: "zoom-in" })} title="Zoom in" aria-label="Zoom in">
            +
          </button>
        </div>
        <button type="button" style={ICON_BTN} onClick={() => requestV2Fullscreen()} title="Fullscreen" aria-label="Fullscreen">
          ⛶
        </button>
        <button
          type="button"
          style={ICON_BTN}
          onClick={() => setCollapsed(true)}
          title="Minimize camera controls"
          aria-label="Minimize camera controls"
        >
          ▾
        </button>
      </div>
      <div
        style={{
          alignSelf: "flex-start",
          fontSize: 9.5,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(148, 163, 184, 0.55)",
          paddingLeft: 4,
          textShadow: "0 1px 4px rgba(0,0,0,0.6)",
        }}
      >
        {mode === "fly" ? "Drag look · WASD move · Q/E up/down · pinch zoom" : "Drag orbit · 2-finger pan · pinch zoom"}
      </div>
    </div>
  );
}
