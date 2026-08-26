/**
 * ==========================================================
 * LÉLUVERSE — COSMOS SCALE HUD
 *
 * A compact DOM overlay for the v1 cosmos camera showing the
 * CURRENT spatial scale — derived from the real camera distance
 * by the 3D probe (GenesisCameraController), never guessed —
 * with quick-nav buttons that fly the same camera through the
 * physical cosmos:
 *
 *   PLANET → SOLAR SYSTEM → STELLAR SPACE → GALAXY
 *
 * Every button dispatches through `flyCosmosScale` (the same
 * `planet-navigate` event chat/voice use), so the HUD, chat and
 * voice all drive the one real camera. Mounted only in the v1
 * workspace, beside the planet explorer HUD.
 * ==========================================================
 */

import { useEffect, useState } from "react";

import {
  cosmosScaleStore,
  flyCosmosScale,
  SCALE_ORDER,
  SCALE_PRESETS,
  type SpatialScale,
} from "./cosmos/CosmosScales";

const hudButtonStyle: React.CSSProperties = {
  flex: 1,
  background: "rgba(125,211,252,0.1)",
  color: "#cfeefc",
  border: "1px solid rgba(125,211,252,0.3)",
  borderRadius: 6,
  padding: "5px 8px",
  cursor: "pointer",
  fontSize: 10,
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

export function CosmosScaleHUD() {
  const [scale, setScale] = useState<SpatialScale>(() => cosmosScaleStore.get());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    return cosmosScaleStore.subscribe((next) => setScale(next));
  }, []);

  const preset = SCALE_PRESETS[scale];

  return (
    <div
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 18,
        fontFamily: "system-ui, sans-serif",
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Cosmic scale · click to expand"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(8,16,32,0.82)",
          color: "#9be8ff",
          border: "1px solid rgba(125,211,252,0.25)",
          borderRadius: 999,
          padding: "6px 12px",
          cursor: "pointer",
          fontSize: 11,
          letterSpacing: "0.08em",
          fontFamily: "inherit",
          backdropFilter: "blur(8px)",
          userSelect: "none",
        }}
      >
        <span style={{ opacity: 0.7 }}>🌌</span>
        {preset.label}
        <span style={{ opacity: 0.75, color: "#e6f4ff" }}>· {preset.description}</span>
      </button>

      {open && (
        <div
          style={{
            background: "rgba(8,16,32,0.92)",
            border: "1px solid rgba(125,211,252,0.2)",
            borderRadius: 10,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            backdropFilter: "blur(12px)",
            minWidth: 190,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 2 }}>
            {SCALE_ORDER.map((s, i) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: 9,
                    letterSpacing: "0.05em",
                    color: s === scale ? "#9be8ff" : "rgba(148,163,184,0.45)",
                    fontWeight: s === scale ? 700 : 400,
                  }}
                >
                  {SCALE_PRESETS[s].label}
                </span>
                {i < SCALE_ORDER.length - 1 && (
                  <span style={{ color: "rgba(148,163,184,0.3)", margin: "0 3px" }}>›</span>
                )}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {SCALE_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  flyCosmosScale(s);
                  setOpen(false);
                }}
                style={{
                  ...hudButtonStyle,
                  background:
                    s === scale ? "rgba(125,211,252,0.22)" : "rgba(125,211,252,0.1)",
                }}
              >
                {s === "planet" ? "🪐" : s === "solar" ? "☀️" : s === "stellar" ? "✨" : "🌌"}{" "}
                {SCALE_PRESETS[s].label}
              </button>
            ))}
          </div>
          <div style={{ color: "rgba(148,163,184,0.45)", fontSize: 9 }}>
            Try “show me the solar system” or “take me to the galaxy” in chat
          </div>
        </div>
      )}
    </div>
  );
}
