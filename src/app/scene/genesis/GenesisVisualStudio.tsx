/**
 * ==========================================================
 * LÉLU — UNIFIED VISUAL STUDIO
 *
 * Render + Sketch + Avatar are modes of ONE studio, and each mode is the
 * existing, working workspace — not a second generation form:
 *
 *   Sketch  GenesisSketchPanel  real canvas, strokes, layers, export
 *   Render  GenesisRenderPanel  real offline render engines + saved outputs
 *   Avatar  GenesisAvatarPanel  real profile, procedural 3D and saved renders
 *
 * The three panels already share the window chrome through InModuleWindow,
 * so embedding them here does not create a window inside a window.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import { useGenesis } from "./GenesisCore";
import GenesisSketchPanel from "./GenesisSketchPanel";
import GenesisRenderPanel from "./GenesisRenderPanel";
import GenesisAvatarPanel from "./GenesisAvatarPanel";

export type StudioMode = "sketch" | "render" | "avatar";

interface Props {
  onClose: () => void;
  initialMode?: StudioMode;
}

/*
 * Genesis Studios is the ONE visual environment — sketch, render and
 * avatar are modes inside it. Commands request a mode here and open the
 * studio; no separate process or parallel studio is created.
 */
let requestedMode: StudioMode | null = null;

export function openStudioMode(mode: StudioMode): void {
  requestedMode = mode;
}

const tabChip = (active: boolean): React.CSSProperties => ({
  padding: "6px 15px",
  borderRadius: 999,
  border: active
    ? "1px solid rgba(167, 139, 250, 0.5)"
    : "1px solid rgba(255,255,255,0.08)",
  background: active ? "rgba(167, 139, 250, 0.15)" : "transparent",
  color: active ? "#d4c8ff" : "rgba(203, 228, 255, 0.55)",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});

const MODES: Array<{ key: StudioMode; glyph: string; label: string; hint: string }> = [
  { key: "render", glyph: "◍", label: "Render", hint: "Finished visuals and 3D" },
  { key: "sketch", glyph: "✎", label: "Sketch", hint: "Draw, layer and export" },
  { key: "avatar", glyph: "◉", label: "Avatar", hint: "Identity and presence" },
];

export default function GenesisVisualStudio({ onClose, initialMode = "render" }: Props) {
  const genesis = useGenesis();
  const [mode, setMode] = useState<StudioMode>(() => {
    const requested = requestedMode;
    requestedMode = null;
    return requested ?? initialMode;
  });

  const active = MODES.find((item) => item.key === mode) ?? MODES[0];

  // A canvas editor needs the phone's usable height. As an inline sheet the
  // Studio was only ~190px tall, so Sketch showed tabs and a clipped strip
  // rather than a canvas. On a phone the visual Studio owns the screen;
  // on desktop the normal floating window is unchanged.
  useEffect(() => {
    if (typeof window === "undefined" || window.innerWidth >= 720) return;
    genesis.setModulePresentation("visualstudio", "expanded");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · Studio"
      title="Visual Studio"
      onClose={onClose}
      width="min(97vw, 1240px)"
      maxHeight="min(94vh, 960px)"
      elevation="focus"
      overflow="hidden"
      zoomable={false}
    >
      <div data-lelu-visual-studio={mode} style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            padding: "0 0 12px",
            flexShrink: 0,
          }}
        >
          {MODES.map((item) => (
            <button
              key={item.key}
              type="button"
              data-studio-mode={item.key}
              data-on={mode === item.key ? "true" : "false"}
              aria-pressed={mode === item.key}
              onClick={() => setMode(item.key)}
              style={tabChip(mode === item.key)}
            >
              <span aria-hidden>{item.glyph}</span>
              {item.label}
            </button>
          ))}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(203,228,255,0.42)" }}>
            {active.hint}
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {mode === "sketch" ? <GenesisSketchPanel onClose={onClose} /> : null}
          {mode === "render" ? <GenesisRenderPanel onClose={onClose} /> : null}
          {mode === "avatar" ? <GenesisAvatarPanel onClose={onClose} /> : null}
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
