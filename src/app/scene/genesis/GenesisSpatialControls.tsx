/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS SPATIAL CONTROLS
 *
 * The right-edge vertical stack from the reference: zoom in,
 * zoom out, and a target/crosshair reset. These drive the REAL
 * Three.js camera through genesisCameraIntentBus (consumed by
 * GenesisCameraController) — zooming actually moves the
 * OrbitControls along the view axis, reset returns to the
 * default composition.
 * ==========================================================
 */

import type { CSSProperties } from "react";
import { genesisCameraIntentBus } from "./GenesisCameraIntent";

const buttonBase: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 999,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  background: "rgba(6, 12, 32, 0.62)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  color: "rgba(214, 228, 244, 0.9)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  pointerEvents: "auto",
  boxShadow: "0 8px 24px rgba(2, 6, 23, 0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
  transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
  padding: 0,
};

export default function GenesisSpatialControls() {
  return (
    <div
      style={{
        position: "absolute",
        right: 18,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 3,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        pointerEvents: "none",
      }}
    >
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        style={buttonBase}
        onClick={() => genesisCameraIntentBus.emit({ type: "zoom-in" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        style={buttonBase}
        onClick={() => genesisCameraIntentBus.emit({ type: "zoom-out" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
          <path d="M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        aria-label="Reset view"
        title="Reset view"
        style={buttonBase}
        onClick={() => genesisCameraIntentBus.emit({ type: "reset" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18" />
        </svg>
      </button>
    </div>
  );
}
