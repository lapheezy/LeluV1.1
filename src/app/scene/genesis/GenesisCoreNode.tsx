/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CORE NODE
 *
 * The top of the workspace-preview diamond. The sphere itself
 * is the REAL 3D Genesis Core glowing in the scene at this
 * anchor — this component only draws what surrounds it: the
 * cyan diamond marker above, and below it the label block
 * (GENESIS CORE / Consciousness Engine), the live multicolor
 * waveform, and the coherence readout.
 *
 * The waveform reacts to real runtime state: idle sways
 * gently, listening/typing lifts, thinking and speaking drive
 * the brightest dance. Coherence is computed from the live
 * universe (stability/consciousness/awareness/evolution).
 * Clicking the block opens the existing chat dialogue.
 * ==========================================================
 */

import { useMemo, type CSSProperties } from "react";
import { useGenesis } from "./GenesisCore";

const WAVE_COLORS = ["#67e8f9", "#fde047", "#f472b6", "#34d399"];

interface GenesisCoreNodeProps {
  /** Viewport-percentage anchor — matches the 3D core's screen position. */
  x: number;
  y: number;
  /** Waveform energy 0..1 from runtime state. */
  activity: number;
  onClick: () => void;
}

export default function GenesisCoreNode({ x, y, activity, onClick }: GenesisCoreNodeProps) {
  const { universe, state } = useGenesis();

  const coherence = useMemo(() => {
    const value =
      0.5 +
      universe.stability * 0.2 +
      universe.consciousness * 0.12 +
      universe.awareness * 0.08 +
      universe.evolutionSystem.stage * 0.1;
    return Math.max(0, Math.min(1, value));
  }, [universe.stability, universe.consciousness, universe.awareness, universe.evolutionSystem.stage]);

  const bars = useMemo(
    () =>
      Array.from({ length: 40 }, (_, index) => ({
        height: 0.35 + 0.65 * Math.abs(Math.sin(index * 1.37)),
        delay: (index % 11) * 0.09,
        duration: 0.8 + (index % 5) * 0.16,
        color: WAVE_COLORS[index % WAVE_COLORS.length],
      })),
    [],
  );

  const pulse = universe.pulse.heartbeat;
  const morphology = universe.morphology ?? "PLASMA";
  const morphologyProgress = universe.morphologyProgress ?? 0;

  /*
   * The REAL 3D Genesis Core projects to this anchor at roughly
   * `radius` tall (its screen-space radius grows with viewport
   * height). The marker hangs above the sphere's top edge and the
   * label block starts just below its bottom edge — so the chrome
   * surrounds the living core instead of covering it.
   */
  const radius = "clamp(108px, 13vh, 190px)";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Genesis Core — open chat"
      title="Genesis Core — Consciousness Engine · open chat"
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: "translate(-50%, -50%)",
        width: "min(460px, 84vw)",
        height: 360,
        border: "none",
        background: "transparent",
        padding: 0,
        margin: 0,
        cursor: "pointer",
        pointerEvents: "auto",
        zIndex: 3,
      }}
    >
      {/* Diamond marker above the core */}
      <span
        aria-hidden
        className="genesis-marker-pulse"
        style={{
          position: "absolute",
          left: "50%",
          top: `calc(-1 * ${radius} - 22px)`,
          transform: "translateX(-50%) rotate(45deg)",
          width: 12,
          height: 12,
          border: "1.5px solid #7dd3fc",
          background: "rgba(125, 211, 252, 0.18)",
          boxShadow: "0 0 14px #38bdf8, 0 0 30px rgba(56, 189, 248, 0.5)",
        }}
      />

      {/* Label block below the real core sphere */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `calc(${radius} + 10px)`,
          transform: "translateX(-50%)",
          width: "100%",
          textAlign: "center",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontSize: "clamp(15px, 1.5vw + 7px, 21px)",
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#ffffff",
            textShadow:
              "0 0 14px rgba(125, 211, 252, 0.9), 0 0 40px rgba(56, 189, 248, 0.55), 0 0 80px rgba(217, 70, 239, 0.35)",
            whiteSpace: "nowrap",
          }}
        >
          Genesis Core
        </div>
        <div
          style={{
            fontSize: "clamp(10px, 0.85vw + 4px, 12.5px)",
            color: "rgba(203, 226, 244, 0.78)",
            marginTop: 4,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          Consciousness Engine
        </div>

        {/* Multicolor heartbeat waveform */}
        <div
          aria-hidden
          style={
            {
              display: "flex",
              alignItems: "center",
              gap: 2.5,
              height: 26,
              marginTop: 12,
              justifyContent: "center",
              filter: `brightness(${0.75 + activity * 0.6})`,
            } as CSSProperties
          }
        >
          {bars.map((bar, index) => (
            <span
              key={index}
              className="genesis-wave-bar"
              style={{
                width: 2.5,
                height: `${Math.round(bar.height * 100)}%`,
                borderRadius: 2,
                background: bar.color,
                boxShadow: `0 0 6px ${bar.color}`,
                transformOrigin: "center",
                animation: `genesis-wave-bar ${bar.duration * (activity > 0.5 ? 0.7 : 1)}s ease-in-out ${bar.delay}s infinite`,
                opacity: 0.75 + pulse * 0.25,
              }}
            />
          ))}
        </div>

        {/* Coherence */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            marginTop: 10,
            fontSize: "clamp(11px, 1vw + 4px, 13.5px)",
            color: "#4ade80",
            letterSpacing: "0.06em",
            textShadow: "0 0 12px rgba(74, 222, 128, 0.55)",
          }}
        >
          <span
            aria-hidden
            className="genesis-status-glow"
            style={{ width: 6, height: 6, borderRadius: 999, background: "#4ade80", color: "#4ade80" }}
          />
          Coherence {coherence.toFixed(1)}%
        </div>
        {/* Live morphology — the ONE Core's current external form, published
            by the shared EngineBus cycle (HAZARD/AURORA/OCEAN/PLASMA/…). */}
        <div
          style={{
            marginTop: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: "clamp(9px, 0.8vw + 4px, 11px)",
            color: "rgba(186, 230, 253, 0.82)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            textShadow: "0 0 12px rgba(125, 211, 252, 0.4)",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "#7dd3fc",
              boxShadow: "0 0 8px #38bdf8",
              transform: `scale(${0.8 + morphologyProgress * 0.4})`,
            }}
          />
          Morph · {morphology}
        </div>
        <div style={{ fontSize: 9, color: "rgba(148, 163, 184, 0.55)", marginTop: 4, letterSpacing: "0.14em", textTransform: "uppercase" }}>
          {state.runtimeReady ? "Live · click to speak" : "Core booting…"}
        </div>
      </div>
    </button>
  );
}
