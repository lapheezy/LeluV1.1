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
import { CircularControl, type RadialMenuDefinition } from "../../../core/interaction";

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

  /*
   * UI Universe has one circular control: hold it and Render, Sketch and
   * Avatar are a ring. The three mode chips are gone, so the studio has no
   * second row of tabs above the work.
   */
  const modeMenu: RadialMenuDefinition = {
    id: "ui-universe-mode",
    label: "UI Universe mode",
    items: MODES.map((item) => ({
      id: item.key,
      label: item.label,
      hint: item.hint,
      active: mode === item.key,
      icon: <span aria-hidden style={{ fontSize: 17 }}>{item.glyph}</span>,
      onSelect: () => setMode(item.key),
      testId: `studio-mode-${item.key}`,
    })),
  };

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
            gap: 10,
            flexWrap: "wrap",
            padding: "0 0 18px",
            flexShrink: 0,
          }}
        >
          <CircularControl
            label={`UI Universe mode — ${active.label}`}
            icon={<span aria-hidden style={{ fontSize: 17 }}>{active.glyph}</span>}
            menu={modeMenu}
            size={44}
            tone="accent"
            caption={active.label}
            testId="studio-mode-control"
          />
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
