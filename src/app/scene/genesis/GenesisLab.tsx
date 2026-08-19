/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS v2 — THE EVOLVED GENESIS WORLD
 *
 * PAGE 3 of the three-workspace application. Genesis v2 is a
 * full-page, cinematic cosmic world — a SIBLING of the v1
 * workspace, never an overlay. The scene follows Reference 1:
 *
 *                     GENESIS CORE
 *                Consciousness Engine
 *                       / | \
 *          CREATION STUDIO  RESEARCH LAB
 *                        |
 *                  GENESIS VAULT
 *
 * The ONE Genesis Core is the central object — a single living
 * body that continuously MORPHS through its seven evolution
 * forms (HAZARD → AURORA → OCEAN → PLASMA → ELECTRIC →
 * BIOHAZARD → HYBRID). Creation Studio (left), Research Lab
 * (right) and Genesis Vault (below) orbit it, joined by energy
 * beams. The cosmic/nebula environment fills the workspace.
 *
 * There is exactly ONE tab in the whole workspace: CORE
 * EVOLUTION. It is the tab that changes the Core through all
 * of its versions (Reference 2) — it never shows information
 * panels. There are no other tabs: no chat, no history, no
 * workspaces, no reasoning, no info panels on the modules.
 * Clicking a module in the scene only focuses it (a marker),
 * the world stays cinematic.
 *
 * The world itself is a real WebGL scene — GenesisV2Scene3D
 * (three.js / react-three-fiber, the same rendering technology
 * the v1 world uses). The ONE Core is the shared shader surface
 * (GenesisCoreMaterial) driven every frame by the EngineBus;
 * the three modules are luminous wireframe satellites with
 * orbit rings and particle halos; energy beams carry travelling
 * pulses from the Core to each module. Nothing here is CSS
 * circles stacked into fake 3D.
 *
 * The chrome is COLLAPSED by default — opening Genesis v2 shows
 * ONLY the immersive scene. A compact glass pill (bottom-right)
 * opens the minimal controls: the Core Evolution tab and the
 * explicit Genesis v1 exit. Minimizing the controls NEVER
 * leaves the workspace; the only way back to Genesis v1 is the
 * Genesis v1 tab.
 *
 * Scene isolation: GenesisScene's router mounts EXACTLY ONE
 * workspace at a time. This component (and everything inside
 * it, including the 3D canvas) unmounts completely when the
 * v2 workspace closes — nothing v2 ever leaks into v1.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGenesis } from "./GenesisCore";
import type EngineRuntime from "./engines/EngineRuntime";
import type { CoreVisualState } from "./render/CoreVisualState";
import {
  MORPH_ACCENTS,
  MORPH_DESCRIPTIONS,
  MORPH_ORDER,
  isMorphName,
  morphStateColor,
  type MorphName,
} from "./render/CoreMorphology";
import GenesisNavIcon, { type GenesisNavIconName } from "./GenesisNavIcons";
import GenesisV2Scene3D, { type V2NodeId } from "./GenesisV2Scene3D";

/* ------------------------------- palette ------------------------------- */

const TEXT = "#e8ecf7";
const MUTED = "rgba(148, 163, 184, 0.72)";
const CYAN = "#67e8f9";
const GREEN = "#4ade80";
const VIOLET = "#a78bfa";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const LABEL: CSSProperties = {
  fontSize: 10,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: MUTED,
};

const WAVE_COLORS = ["#67e8f9", "#fde047", "#f472b6", "#34d399"];

/* --------------------------- v2 destinations --------------------------- */

/* The ONE tab of Genesis v2: Core Evolution. It changes the Core through
   all seven evolution forms — never an information panel. */
type V2Dest = "core" | "studio" | "lab" | "vault" | "morph";

const CORE_EVOLUTION = { id: "morph" as V2Dest, label: "Core Evolution", accent: VIOLET };

/* --------------------------- small helpers ----------------------------- */

function useViewport() {
  const [size, setSize] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1440,
    height: typeof window !== "undefined" ? window.innerHeight : 900,
  }));

  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return size;
}

function StatusDot({ color, glow = true }: { color: string; glow?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: 999,
        background: color,
        boxShadow: glow ? `0 0 8px ${color}` : "none",
        flexShrink: 0,
      }}
    />
  );
}

/* --------------------------- live core snapshot ------------------------ */

interface CoreSnapshot {
  morphology: string;
  progress: number;
  color: string;
  glow: string;
  pulse: number;
  activity: number;
  weights: { ocean: number; plasma: number; electric: number; crystal: number; halo: number; bio: number };
}

function snapshotFromVisual(vs: CoreVisualState | undefined): CoreSnapshot {
  return {
    morphology: vs?.morphology ?? "PLASMA",
    progress: vs?.morphologyProgress ?? 0,
    color: vs?.stateColor?.getStyle() ?? "#009CFF",
    glow: vs?.stateGlow?.getStyle() ?? "#4BD9FF",
    pulse: vs?.pulse ?? 0.35,
    activity: vs?.activity ?? 0.3,
    weights: vs?.stateWeights
      ? {
          ocean: vs.stateWeights.ocean,
          plasma: vs.stateWeights.plasma,
          electric: vs.stateWeights.electric,
          crystal: vs.stateWeights.crystal,
          halo: vs.stateWeights.halo,
          bio: vs.stateWeights.bio,
        }
      : { ocean: 0, plasma: 1, electric: 0, crystal: 0, halo: 1, bio: 0 },
  };
}

/**
 * Samples the ONE Core's actual per-frame visual state (~10 fps) — the
 * same object the 3D core reads — so the v2 world's core is the real
 * shared core, never a mockup. Colors, glow, pulse and morphology all
 * come from the EngineBus; the v2 world only dresses the view.
 */
function useLiveCoreSnapshot(engineRuntime: EngineRuntime | null): CoreSnapshot {
  const [snapshot, setSnapshot] = useState<CoreSnapshot>(() =>
    snapshotFromVisual(engineRuntime?.getEngineBus().getVisualState()),
  );

  useEffect(() => {
    let raf = 0;
    let frame = 0;
    let lastKey = "";
    const tick = () => {
      frame += 1;
      if (frame % 6 === 0) {
        const next = snapshotFromVisual(engineRuntime?.getEngineBus().getVisualState());
        const key = `${next.morphology}|${next.color}|${next.glow}|${next.pulse.toFixed(2)}|${next.activity.toFixed(2)}`;
        if (key !== lastKey) {
          lastKey = key;
          setSnapshot(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineRuntime]);

  return snapshot;
}

/* ------------------------------ core glyph ----------------------------- */

/* ------------------------ morph detail systems ------------------------- */

/**
 * The seven evolution forms each carry their own living internal
 * system, so the evolution strip reads as one graphic sequence — never
 * seven recolored orbs. Every system is drawn inside the same
 * body-sized plane (SVG for precise vector geometry, layered gradients
 * for energy) and is purely decorative: pointer-events none, opt-out
 * via prefers-reduced-motion.
 */

/** HAZARD — unstable storm: jagged red filaments whip across the body. */
function MorphFilaments({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  const filaments = [
    "50,2 38,20 56,30 42,46 60,58 46,76 54,98",
    "26,4 18,18 32,28 24,42 38,54 28,68 34,96",
    "74,4 66,16 80,26 70,40 82,52 72,66 78,96",
  ];
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0 }}>
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {filaments.map((points, index) => (
          <polyline
            key={index}
            points={points}
            fill="none"
            stroke={index === 1 ? glow : color}
            strokeWidth={index === 1 ? 1.5 : 2.3}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="genesis-morph-filament"
            style={{
              filter: `drop-shadow(0 0 3px ${color})`,
              opacity: 0.9,
              animation: animated
                ? `genesis-morph-filament-drift ${2.4 + index * 0.7}s ease-in-out ${index * 0.5}s infinite`
                : undefined,
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/** AURORA — flowing light veils: translucent ribbons orbit the body. */
function MorphVeils({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  const veil = `conic-gradient(from 0deg, transparent 0deg, ${glow}55 34deg, transparent 84deg, ${color}4d 132deg, transparent 196deg, ${glow}4d 252deg, transparent 322deg)`;
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0 }}>
      <div
        className="genesis-morph-veil"
        aria-hidden
        style={{
          position: "absolute",
          inset: -22,
          borderRadius: 999,
          background: veil,
          opacity: 0.85,
          animation: animated ? "genesis-morph-veil-spin 9s linear infinite" : undefined,
        }}
      />
      <div
        className="genesis-morph-veil"
        aria-hidden
        style={{
          position: "absolute",
          inset: -12,
          borderRadius: 999,
          background: veil,
          opacity: 0.55,
          animation: animated ? "genesis-morph-veil-spin 14s linear infinite reverse" : undefined,
        }}
      />
    </div>
  );
}

/** OCEAN — fluid currents: bright bands sweep across the surface. */
function MorphWaves({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  const bands = [
    { top: "16%", height: 4, delay: "0s", dur: 2.4 },
    { top: "38%", height: 7, delay: "0.5s", dur: 3.0 },
    { top: "58%", height: 5, delay: "0.2s", dur: 2.7 },
    { top: "76%", height: 3, delay: "0.8s", dur: 3.4 },
  ];
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0, borderRadius: 999, overflow: "hidden" }}>
      {bands.map((band, index) => (
        <div
          key={index}
          className="genesis-morph-wave"
          aria-hidden
          style={{
            position: "absolute",
            left: "-36%",
            right: "-36%",
            top: band.top,
            height: band.height,
            borderRadius: 999,
            background: `repeating-linear-gradient(90deg, ${glow}dd 0 5px, transparent 5px 11px, ${color}aa 11px 17px, transparent 17px 26px)`,
            boxShadow: `0 0 6px ${glow}66`,
            opacity: 0.8,
            animation: animated
              ? `genesis-morph-wave-flow ${band.dur}s ease-in-out ${band.delay} infinite`
              : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** PLASMA — hot luminous boil: energy cells swell and pop. */
function MorphCells({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  const cells = [
    { x: 30, y: 28, s: 15, d: 0 },
    { x: 66, y: 22, s: 12, d: 0.6 },
    { x: 62, y: 62, s: 17, d: 1.1 },
    { x: 26, y: 66, s: 12, d: 1.6 },
    { x: 46, y: 46, s: 9, d: 0.3 },
    { x: 78, y: 44, s: 8, d: 2.0 },
  ];
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0 }}>
      {cells.map((cell, index) => (
        <span
          key={index}
          className="genesis-morph-cell"
          aria-hidden
          style={{
            position: "absolute",
            left: `${cell.x}%`,
            top: `${cell.y}%`,
            width: cell.s,
            height: cell.s,
            marginLeft: -cell.s / 2,
            marginTop: -cell.s / 2,
            borderRadius: 999,
            background: `radial-gradient(circle at 42% 36%, #ffffffcc, ${glow} 46%, ${color}88 100%)`,
            boxShadow: `0 0 ${cell.s / 2}px ${glow}88, inset 0 0 2px rgba(255,255,255,0.7)`,
            animation: animated
              ? `genesis-morph-cell-boil ${1.9 + (index % 3) * 0.5}s ease-in-out ${cell.d}s infinite`
              : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** ELECTRIC — branching energy: arcs flash and sparks travel outward. */
function MorphArcs({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  const branches = [
    "50,52 42,34 55,24 48,4",
    "50,52 62,42 56,26 70,12",
    "50,52 34,44 40,28 28,14",
    "50,52 50,64 40,80 50,98",
    "50,52 64,60 58,76 70,88",
    "50,52 36,56 34,70 22,76",
  ];
  const sparks = [
    { x: 46, y: 8, d: 0 },
    { x: 68, y: 16, d: 0.7 },
    { x: 30, y: 18, d: 1.3 },
    { x: 50, y: 94, d: 0.4 },
    { x: 68, y: 84, d: 1.8 },
  ];
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0 }}>
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {branches.map((points, index) => (
          <polyline
            key={index}
            points={points}
            fill="none"
            stroke={index % 2 === 0 ? color : "#ffffff"}
            strokeWidth={index % 2 === 0 ? 1.8 : 1}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="genesis-morph-arc"
            style={{
              filter: `drop-shadow(0 0 3px ${color})`,
              animation: animated
                ? `genesis-morph-arc-flash ${1.1 + (index % 4) * 0.35}s ease-in-out ${index * 0.18}s infinite`
                : undefined,
            }}
          />
        ))}
      </svg>
      {sparks.map((spark, index) => (
        <span
          key={index}
          className="genesis-morph-arc"
          aria-hidden
          style={{
            position: "absolute",
            left: `${spark.x}%`,
            top: `${spark.y}%`,
            width: 3,
            height: 3,
            marginLeft: -1.5,
            marginTop: -1.5,
            borderRadius: 999,
            background: "#ffffff",
            boxShadow: `0 0 5px ${glow}`,
            animation: animated
              ? `genesis-morph-arc-flash ${1.5 + index * 0.3}s ease-in-out ${spark.d}s infinite`
              : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** BIOHAZARD — organic cellular membrane: the living lattice pulses. */
function MorphMembrane({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0 }}>
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <pattern id="genesis-bio-hex" width="26" height="22.5" patternUnits="userSpaceOnUse">
            <path
              d="M13 0 L26 7.5 L26 22.5 L13 30 L0 22.5 L0 7.5 Z"
              fill="none"
              stroke={color}
              strokeWidth="1.1"
            />
          </pattern>
        </defs>
        <rect
          x="-13"
          y="-7.5"
          width="130"
          height="120"
          fill="url(#genesis-bio-hex)"
          className="genesis-morph-membrane"
          style={{
            animation: animated ? "genesis-morph-membrane-pulse 3.2s ease-in-out infinite" : undefined,
          }}
        />
      </svg>
      {/* organic veins threading the membrane */}
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <path
          d="M12 18 Q 30 10 46 22 T 82 14"
          fill="none"
          stroke={glow}
          strokeWidth="1.3"
          className="genesis-morph-membrane"
          style={{
            filter: `drop-shadow(0 0 2px ${glow})`,
            animation: animated ? "genesis-morph-membrane-pulse 2.4s ease-in-out 0.4s infinite" : undefined,
          }}
        />
        <path
          d="M14 84 Q 36 76 52 86 T 86 78"
          fill="none"
          stroke={glow}
          strokeWidth="1.1"
          className="genesis-morph-membrane"
          style={{
            filter: `drop-shadow(0 0 2px ${glow})`,
            animation: animated ? "genesis-morph-membrane-pulse 2.9s ease-in-out 0.9s infinite" : undefined,
          }}
        />
      </svg>
    </div>
  );
}

/** HYBRID — every system layered inside the one body at once. */
function MorphHybrid({ color, glow, animated }: { color: string; glow: string; animated: boolean }) {
  const cells = [
    { x: 32, y: 32, s: 9, d: 0 },
    { x: 66, y: 58, s: 11, d: 0.8 },
  ];
  return (
    <div className="genesis-morph-detail" style={{ position: "absolute", inset: 0 }}>
      <div
        className="genesis-morph-veil"
        aria-hidden
        style={{
          position: "absolute",
          inset: -18,
          borderRadius: 999,
          background: `conic-gradient(from 0deg, transparent 0deg, ${glow}4d 40deg, transparent 100deg, #a78bfa55 150deg, transparent 220deg, #4ade804d 280deg, transparent 340deg)`,
          opacity: 0.8,
          animation: animated ? "genesis-morph-veil-spin 10s linear infinite" : undefined,
        }}
      />
      <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.85 }}>
        {["50,54 40,36 54,26 46,6", "50,54 64,44 58,28 72,14"].map((points, index) => (
          <polyline
            key={index}
            points={points}
            fill="none"
            stroke={index === 0 ? "#59d7ff" : "#ffffff"}
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="genesis-morph-arc"
            style={{
              animation: animated
                ? `genesis-morph-arc-flash ${1.4 + index * 0.4}s ease-in-out ${index * 0.3}s infinite`
                : undefined,
            }}
          />
        ))}
      </svg>
      {cells.map((cell, index) => (
        <span
          key={index}
          className="genesis-morph-cell"
          aria-hidden
          style={{
            position: "absolute",
            left: `${cell.x}%`,
            top: `${cell.y}%`,
            width: cell.s,
            height: cell.s,
            marginLeft: -cell.s / 2,
            marginTop: -cell.s / 2,
            borderRadius: 999,
            background: `radial-gradient(circle at 42% 36%, #ffffffcc, ${glow} 46%, ${color}88 100%)`,
            boxShadow: `0 0 ${cell.s / 2}px ${glow}88`,
            animation: animated
              ? `genesis-morph-cell-boil ${2 + index * 0.5}s ease-in-out ${cell.d}s infinite`
              : undefined,
          }}
        />
      ))}
    </div>
  );
}

/**
 * A single Core form — the same living body in one of its evolution
 * states. Layered energy: morphing aurora halo, organic body surface
 * with a rotating conic energy sweep, the form's own internal system
 * (SVG filaments/arcs/membrane or flowing gradient veils/currents),
 * white-hot nucleus, wireframe shell, two tilted orbital rings and
 * twinkling energy motes. Each glyph is a faithful mini-preview of
 * what the ONE Core looks like in that form (the exact state color
 * derivation the live core uses).
 */
function CoreGlyph({
  color,
  glow,
  size = 72,
  animated = true,
  live = false,
  label,
  morph,
}: {
  color: string;
  glow: string;
  size?: number;
  animated?: boolean;
  live?: boolean;
  label?: string;
  morph?: MorphName;
}) {
  const core = color;
  const halo = glow ?? color;
  const particles = [
    { angle: 0.4, r: 0.46, d: 0 },
    { angle: 1.9, r: 0.42, d: 0.9 },
    { angle: 3.4, r: 0.5, d: 1.6 },
    { angle: 4.9, r: 0.44, d: 2.3 },
    { angle: 2.8, r: 0.36, d: 3.1 },
  ];

  return (
    <div
      className={live ? "genesis-lab-core-live" : undefined}
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        filter: `drop-shadow(0 0 ${Math.round(size / 5)}px ${halo}aa)`,
      }}
    >
      {/* morphing aurora halo — the body's atmosphere, never a flat disc */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: -Math.round(size * 0.16),
          borderRadius: 999,
          background: `radial-gradient(circle, ${halo}55, ${halo}1c 55%, transparent 74%)`,
          animation: animated ? "genesis-lab-aurora 9s ease-in-out infinite" : undefined,
        }}
      />
      {/* the ONE core body — organic silhouette + rotating energy sweep */}
      <div
        aria-hidden
        className="genesis-v2-core-body"
        style={{
          position: "absolute",
          width: Math.round(size * 0.5),
          height: Math.round(size * 0.5),
          borderRadius: 999,
          background: `radial-gradient(circle at 50% 32%, #ffffff, ${core} 48%, ${core}33 82%, transparent 100%)`,
          boxShadow: `0 0 ${Math.round(size / 3)}px ${halo}bb, inset 0 0 ${Math.round(size / 6)}px ${halo}88, inset 0 0 2px rgba(255,255,255,0.85)`,
          overflow: "hidden",
        }}
      >
        <div
          aria-hidden
          className="genesis-lab-surface-spin"
          style={{
            position: "absolute",
            inset: -10,
            borderRadius: 999,
            background: `conic-gradient(from 0deg, transparent 0deg, ${halo}59 42deg, transparent 92deg, ${core}44 148deg, transparent 210deg, ${halo}44 268deg, transparent 330deg)`,
            animation: animated ? "genesis-lab-surface-spin 6s linear infinite" : undefined,
          }}
        />
      </div>
      {/* the form's own living internal system — every evolution stage
          has its own geometry (storm filaments, aurora veils, ocean
          currents, plasma cells, electric arcs, bio membrane, hybrid),
          never a recolored orb */}
      {morph ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            width: Math.round(size * 0.5),
            height: Math.round(size * 0.5),
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          {morph === "HAZARD" ? (
            <MorphFilaments color={core} glow={halo} animated={animated} />
          ) : morph === "AURORA" ? (
            <MorphVeils color={core} glow={halo} animated={animated} />
          ) : morph === "OCEAN" ? (
            <MorphWaves color={core} glow={halo} animated={animated} />
          ) : morph === "PLASMA" ? (
            <MorphCells color={core} glow={halo} animated={animated} />
          ) : morph === "ELECTRIC" ? (
            <MorphArcs color={core} glow={halo} animated={animated} />
          ) : morph === "BIOHAZARD" ? (
            <MorphMembrane color={core} glow={halo} animated={animated} />
          ) : (
            <MorphHybrid color={core} glow={halo} animated={animated} />
          )}
        </div>
      ) : null}
      {/* white-hot nucleus — the bright central energy source */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: Math.round(size * 0.15),
          height: Math.round(size * 0.15),
          borderRadius: 999,
          background: "radial-gradient(circle, #ffffff, rgba(255,255,255,0.5) 55%, transparent 78%)",
          boxShadow: `0 0 ${Math.round(size / 5)}px #ffffff, 0 0 ${Math.round(size / 9)}px ${halo}`,
          filter: "blur(0.3px)",
        }}
      />
      {/* fine wireframe shell — internal geometric structure */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: Math.round(size * 0.64),
          height: Math.round(size * 0.64),
          borderRadius: 999,
          border: `1px dashed ${halo}66`,
          animation: animated ? "genesis-lab-orbital-rev 14s linear infinite" : undefined,
        }}
      />
      {/* orbital rings (same ONE core, orbiting geometry) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: Math.round(size * 0.9),
          height: Math.round(size * 0.9),
          borderRadius: 999,
          border: `1px solid ${halo}55`,
          transform: "rotateX(70deg)",
          animation: animated ? "genesis-lab-orbital 8s linear infinite" : undefined,
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          width: Math.round(size * 0.68),
          height: Math.round(size * 0.68),
          borderRadius: 999,
          border: `1px solid ${halo}40`,
          transform: "rotateX(70deg) rotateZ(42deg)",
          animation: animated ? "genesis-lab-orbital-rev 11s linear infinite" : undefined,
        }}
      />
      {/* energy motes orbiting the same core */}
      {animated
        ? particles.map((particle, index) => {
            const x = Math.round(size * 0.5 + Math.cos(particle.angle) * size * particle.r);
            const y = Math.round(size * 0.5 + Math.sin(particle.angle) * size * particle.r * 0.62);
            return (
              <span
                key={index}
                aria-hidden
                style={{
                  position: "absolute",
                  left: x - 1.5,
                  top: y - 1.5,
                  width: 3,
                  height: 3,
                  borderRadius: 999,
                  background: index % 2 === 0 ? "#ffffff" : halo,
                  boxShadow: `0 0 6px ${halo}`,
                  animation: `genesis-lab-twinkle ${2.2 + particle.d}s ease-in-out ${particle.d}s infinite`,
                }}
              />
            );
          })
        : null}
      {label ? (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginTop: 8,
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: MUTED,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------- comparison art --------------------------- */

/**
 * The reference-1 hierarchy anchored under the Core inside the scene:
 * GENESIS CORE → Consciousness Engine → multicolor waveform → Coherence.
 */
function CoreLabelBlock({
  live,
  morphology,
  request,
  transforming,
  progress,
  coherence,
  cycle,
  activity,
}: {
  live: CoreSnapshot;
  morphology: string;
  request: string | null;
  transforming: boolean;
  progress: number;
  coherence: number;
  cycle: number;
  activity: number;
}) {
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

  const accent = isMorphName(morphology) ? MORPH_ACCENTS[morphology] : CYAN;
  const statusText = transforming && request
    ? `EVOLVING → ${request} · ${Math.round(progress * 100)}%`
    : request
      ? `HOLDING · ${request}`
      : `AUTO EVOLUTION · CYCLE ${cycle}`;
  const statusColor = transforming ? CYAN : request ? GREEN : VIOLET;

  return (
    <div style={{ textAlign: "center", marginTop: 18, userSelect: "none", width: "max-content", maxWidth: "88vw" }}>
      <div
        style={{
          fontSize: "clamp(15px, 1.5vw + 7px, 21px)",
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "#ffffff",
          textShadow: `0 0 14px ${accent}aa, 0 0 40px ${accent}66, 0 0 80px rgba(217, 70, 239, 0.35)`,
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

      {/* multicolor heartbeat waveform */}
      <div
        aria-hidden
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2.5,
          height: 24,
          marginTop: 11,
          justifyContent: "center",
          filter: `brightness(${0.75 + activity * 0.6})`,
        }}
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
              opacity: 0.75 + live.pulse * 0.25,
            }}
          />
        ))}
      </div>

      {/* coherence */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          marginTop: 9,
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
        Coherence {coherence}%
      </div>

      {/* live evolution status */}
      <div
        style={{
          marginTop: 7,
          fontSize: "clamp(9px, 0.8vw + 4px, 10.5px)",
          color: statusColor,
          letterSpacing: "0.16em",
          fontFamily: MONO,
          textShadow: `0 0 10px ${statusColor}66`,
          whiteSpace: "nowrap",
        }}
      >
        {statusText}
      </div>
    </div>
  );
}

/* ---------------------------------- rail -------------------------------- */

type RailItem =
  | { key: string; dest: V2Dest; icon: GenesisNavIconName; label: string }
  | { key: string; divider: true }
  | { key: string; panel: "none"; icon: GenesisNavIconName; label: string };

const RAIL_ITEMS: RailItem[] = [
  /* The ONE tab of Genesis v2 — Core Evolution changes the Core through
     every version. Everything else in the world is scene-only. */
  { key: "morph", dest: "morph", icon: "lab", label: "Core Evolution" },
  { key: "divider-1", divider: true },
  /* The ONLY exit from Genesis v2 — an explicit Genesis v1 tab. Genesis
     v2 is its own workspace; it returns to v1 only when this tab is
     pressed. */
  { key: "leave-v1", panel: "none", icon: "orbit", label: "Genesis v1" },
];

function V2Rail({
  dest,
  onSelect,
  onLeave,
  compact,
}: {
  dest: V2Dest;
  onSelect: (d: V2Dest) => void;
  onLeave: () => void;
  compact: boolean;
}) {
  const width = compact ? 56 : 80;
  const buttonSize = compact ? 34 : 42;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width,
        zIndex: 5,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        padding: "16px 0 12px",
        boxSizing: "border-box",
        background:
          "linear-gradient(180deg, rgba(4, 9, 28, 0.78), rgba(4, 9, 28, 0.6) 55%, rgba(12, 6, 34, 0.66))",
        borderRight: "1px solid rgba(148, 163, 184, 0.14)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "0 0 34px rgba(2, 6, 23, 0.55), inset -1px 0 0 rgba(125, 211, 252, 0.06)",
      }}
    >
      {RAIL_ITEMS.map((item) => {
        if ("divider" in item) {
          return <div key={item.key} style={{ width: 34, height: 1, background: "rgba(255,255,255,0.1)", margin: "6px 0" }} />;
        }
        const active = "dest" in item && item.dest === dest;
        const accent = "dest" in item ? CORE_EVOLUTION.accent : VIOLET;
        return (
          <button
            key={item.key}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={() => ("dest" in item ? onSelect(item.dest) : onLeave())}
            style={{
              position: "relative",
              width: buttonSize,
              height: buttonSize,
              flexShrink: 0,
              border: active ? `1px solid ${accent}88` : "1px solid transparent",
              borderRadius: compact ? 10 : 13,
              background: active ? `${accent}22` : "transparent",
              color: active ? "#e9d5ff" : "rgba(214, 228, 244, 0.78)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.18s ease, border-color 0.18s ease, color 0.18s ease",
              filter: active ? `drop-shadow(0 0 6px ${accent}cc)` : "none",
            }}
          >
            {active ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: -18,
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: 2,
                  height: 18,
                  borderRadius: 2,
                  background: accent,
                  boxShadow: `0 0 8px ${accent}`,
                }}
              />
            ) : null}
            <GenesisNavIcon name={item.icon} size={compact ? 15 : 18} />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------- scene pill ---------------------------- */

/**
 * The single always-available affordance in Genesis v2: a compact glass
 * pill pinned to the bottom-right corner. It opens / minimizes the
 * workspace controls (rail · mobile bar). It never leaves the
 * workspace — Genesis v2 stays mounted no matter how much the user
 * collapses the UI.
 */
function V2ScenePill({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? "Minimize Genesis v2 controls" : "Open Genesis v2 controls"}
      aria-label={open ? "Minimize Genesis v2 controls" : "Open Genesis v2 controls"}
      style={{
        position: "absolute",
        right: 14,
        bottom: 14,
        zIndex: 7,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 13px",
        borderRadius: 999,
        border: open
          ? "1px solid rgba(232, 121, 249, 0.4)"
          : "1px solid rgba(148, 210, 255, 0.26)",
        background: open
          ? "linear-gradient(120deg, rgba(30, 14, 58, 0.62), rgba(16, 20, 48, 0.52))"
          : "linear-gradient(120deg, rgba(8, 16, 40, 0.6), rgba(16, 20, 48, 0.5))",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        color: "white",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        cursor: "pointer",
        pointerEvents: "auto",
        userSelect: "none",
        WebkitUserSelect: "none",
        boxShadow: "0 8px 26px rgba(2, 6, 23, 0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <span
        aria-hidden
        className="genesis-status-glow"
        style={{ width: 6, height: 6, borderRadius: 999, background: "#4ade80", color: "#4ade80" }}
      />
      <span>Genesis v2</span>
      <span aria-hidden style={{ opacity: 0.7, fontSize: 9, letterSpacing: 0 }}>
        {open ? "▾" : "⌃"}
      </span>
    </button>
  );
}

/* ---------------------------- destination panels ------------------------ */

function DestinationPanel({
  title,
  subtitle,
  accent,
  onClose,
  mobile,
  wide = false,
  children,
}: {
  title: string;
  subtitle: string;
  accent: string;
  onClose: () => void;
  mobile: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: mobile ? 0 : 20, y: mobile ? 24 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: mobile ? 0 : 20, y: mobile ? 24 : 0 }}
      transition={{ duration: 0.24 }}
      style={{
        position: mobile ? "fixed" : "absolute",
        left: mobile ? 10 : undefined,
        right: mobile ? 10 : 22,
        top: mobile ? undefined : "50%",
        bottom: mobile ? 10 : undefined,
        transform: mobile ? undefined : "translateY(-50%)",
        width: mobile ? "auto" : wide ? "min(560px, calc(100vw - 140px))" : "min(400px, calc(100vw - 140px))",
        maxHeight: mobile ? "min(58vh, 520px)" : "min(78vh, 640px)",
        display: "flex",
        flexDirection: "column",
        borderRadius: 20,
        border: `1px solid ${accent}44`,
        background: "linear-gradient(160deg, rgba(14, 10, 34, 0.8), rgba(6, 12, 30, 0.74))",
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        boxShadow:
          "0 24px 70px rgba(2, 6, 23, 0.6), 0 0 40px rgba(139, 92, 246, 0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
        zIndex: 8,
        pointerEvents: "auto",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "14px 16px 12px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14.5,
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: accent,
              textShadow: `0 0 16px ${accent}66`,
            }}
          >
            {title}
          </div>
          <div style={{ ...LABEL, letterSpacing: "0.08em", marginTop: 3, color: "rgba(148,163,184,0.6)" }}>
            {subtitle}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          title="Back to Genesis Core"
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: 999,
            border: "1px solid rgba(148, 163, 184, 0.25)",
            background: "rgba(255,255,255,0.05)",
            color: TEXT,
            cursor: "pointer",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ padding: "14px 16px 18px", overflowY: "auto", overflowX: "hidden", flex: 1 }}>{children}</div>
    </motion.div>
  );
}

/* ----------------------------- main component --------------------------- */

export default function GenesisLab({ onClose }: { onClose: () => void }) {
  const { state, universe, engineRuntime } = useGenesis();
  const { width } = useViewport();

  const mobile = width < 720;
  const tablet = width < 1024 && !mobile;

  const engineBus = engineRuntime?.getEngineBus() ?? null;
  const live = useLiveCoreSnapshot(engineRuntime);

  const morphology = universe.morphology ?? "PLASMA";
  const request = universe.coreTransform?.request ?? null;
  const progress = universe.coreTransform?.progress ?? 0;
  const transforming = universe.coreTransform?.transforming ?? false;

  const [dest, setDest] = useState<V2Dest>("core");
  /* Chrome is COLLAPSED by default - the immersive scene alone is the
     workspace. No rail, no tabs until the user opens the controls (the
     compact Genesis v2 pill) or presses the Core. Minimizing the
     controls NEVER leaves the workspace - the only exit back to Genesis
     v1 is the explicit Genesis v1 tab. */
  const [chromeOpen, setChromeOpen] = useState(false);

  const evolutionPct = Math.round(Math.max(0, Math.min(1, universe.evolutionSystem.stage)) * 100);
  const cycle = Math.floor(universe.age);
  const pulsePct = Math.round(universe.pulse.heartbeat * 100);
  const coherence = Math.min(
    99.9,
    88 + universe.stability * 7 + universe.consciousness * 4 + universe.evolutionSystem.formChange * 2,
  ).toFixed(1);

  const activity = Math.max(
    0.12,
    state.thinking ? 0.95 : state.speaking ? 0.8 : state.listening ? 0.6 : state.dialogue === "typing" ? 0.5 : 0.3,
  );

  function applyEnvironment(name: string) {
    if (!isMorphName(name)) return;
    engineBus?.setMorphRequest(name);
  }

  function selectDest(next: V2Dest) {
    setDest(next);
  }

  /* The scene's focused module follows the active destination. The ONE
     tab (Core Evolution) keeps the Core focused in the world. */
  const sceneFocus: V2NodeId =
    dest === "studio" || dest === "lab" || dest === "vault" ? dest : "core";

  /* Pressing the Genesis Core opens the Core Evolution tab (the ONE
     control of the workspace) - the Core is the thing that changes, so
     pressing it opens its version picker. Pressing a module only
     focuses it in the scene - modules never open information panels. */
  function handleSceneSelect(id: V2NodeId) {
    if (id === "core") {
      setDest("morph");
    } else {
      setDest(id);
    }
  }

  return (
    <motion.div
      data-workspace="genesis-v2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: "fixed",
        inset: 0,
        /* Scene separation is pure mounting — no z-index. isolation
           merely keeps this scene's internal z-indexes inside its own
           stacking context; it does not stack this scene over anything. */
        isolation: "isolate",
        overflow: "hidden",
        background: "#060818",
        color: TEXT,
        pointerEvents: "auto",
        animation: "lelu-environment-enter 0.38s ease",
      }}
    >
      {/* left navigation rail (desktop/tablet) - only while the controls
          are open; the immersive scene owns the viewport by default. It
          holds exactly two actions: the ONE Core Evolution tab and the
          explicit Genesis v1 exit. */}
      {chromeOpen && !mobile ? <V2Rail dest={dest} onSelect={selectDest} onLeave={onClose} compact={tablet} /> : null}

      {/* the cinematic Genesis v2 scene — the COMPLETE immersive 3D
          workspace. ONE Core (the shared shader surface), the three
          modules, energy beams, nebula cosmos and star field all live
          inside GenesisV2Scene3D, which mounts only while this workspace
          owns the viewport. The reference hierarchy (GENESIS CORE →
          Consciousness Engine → waveform → Coherence) is anchored under
          the Core inside the scene. */}
      <GenesisV2Scene3D
        activity={activity}
        focused={sceneFocus}
        onSelect={handleSceneSelect}
        coreLabel={
          <CoreLabelBlock
            live={live}
            morphology={morphology}
            request={request}
            transforming={transforming}
            progress={progress}
            coherence={Number(coherence)}
            cycle={cycle}
            activity={activity}
          />
        }
      />

      {/* The ONE tab of Genesis v2 — Core Evolution. All seven versions
          of the ONE Core in a row; picking one morphs the shared body.
          No information tabs exist in this workspace. */}
      <AnimatePresence>
        {dest === "morph" ? (
          <DestinationPanel
            key="morph"
            title="Core Evolution"
            subtitle="One Core · seven forms — the same body evolves"
            accent={VIOLET}
            onClose={() => selectDest("core")}
            mobile={mobile}
            wide
          >
            <CoreMorphPanel
              morphology={morphology}
              request={request}
              transforming={transforming}
              onSelectEnv={applyEnvironment}
            />
            <div
              style={{
                ...LABEL,
                letterSpacing: "0.06em",
                marginTop: 12,
                color: "rgba(148,163,184,0.5)",
              }}
            >
              Evolution {evolutionPct}% · cycle {cycle} · pulse {pulsePct}% — the Core morphs live in the world behind
              this panel.
            </div>
          </DestinationPanel>
        ) : null}
      </AnimatePresence>

      {/* mobile controls — the same two actions as the rail, in a slim
          bottom bar so phones can reach them while chrome is open */}
      {chromeOpen && mobile ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "clamp(14px, 3vh, 26px)",
            transform: "translateX(-50%)",
            zIndex: 7,
            display: "flex",
            gap: 8,
            padding: 6,
            borderRadius: 999,
            maxWidth: "min(94vw, 420px)",
            background: "rgba(4, 10, 30, 0.55)",
            border: "1px solid rgba(148, 163, 184, 0.16)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            boxShadow: "0 12px 40px rgba(2, 6, 23, 0.5)",
            pointerEvents: "auto",
          }}
        >
          <button
            type="button"
            onClick={() => selectDest("morph")}
            title="Core Evolution"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              border: dest === "morph" ? `1px solid ${VIOLET}88` : "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 999,
              background: dest === "morph" ? `${VIOLET}1f` : "rgba(8, 16, 38, 0.55)",
              color: dest === "morph" ? "#e9d5ff" : "rgba(203, 226, 244, 0.85)",
              padding: "9px 14px",
              fontSize: 11.5,
              fontWeight: dest === "morph" ? 700 : 500,
              letterSpacing: "0.05em",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.2s ease, border-color 0.2s ease",
            }}
          >
            <GenesisNavIcon name="lab" size={14} />
            Core Evolution
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Return to Genesis v1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              border: "1px solid rgba(232, 121, 249, 0.55)",
              borderRadius: 999,
              background: "rgba(30, 14, 58, 0.6)",
              color: "#f3e8ff",
              padding: "9px 14px",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.05em",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "background 0.2s ease, border-color 0.2s ease",
              boxShadow: "0 0 18px rgba(168, 85, 247, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            ◂ Genesis v1
          </button>
        </div>
      ) : null}

      {/* the single always-available affordance - a compact Genesis v2
          pill. Click it to open the controls; click again to minimize
          them. It never exits the workspace. */}
      <V2ScenePill open={chromeOpen} onToggle={() => setChromeOpen((open) => !open)} />
    </motion.div>
  );
}

/* ------------------------------ core morph panel ------------------------ */

/**
 * THE one core control - the Core Evolution tab. A horizontal strip of
 * all seven versions of the ONE Core (HAZARD → AURORA → OCEAN → PLASMA
 * → ELECTRIC → BIOHAZARD → HYBRID) joined by energy lines, each node a
 * live mini core. Clicking a version morphs the shared Core. No
 * information tabs: this tab only changes the core.
 */
function CoreMorphPanel({
  morphology,
  request,
  transforming,
  onSelectEnv,
}: {
  morphology: string;
  request: string | null;
  transforming: boolean;
  onSelectEnv: (name: string) => void;
}) {
  return (
    <div>
      {/* the evolution strip — all seven versions in order, joined by
          travelling energy lines exactly like the reference series */}
      <div
        className="genesis-morph-banner"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          overflowX: "auto",
          overflowY: "hidden",
          padding: "10px 2px 14px",
          marginTop: 6,
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(148, 163, 184, 0.3) transparent",
        }}
      >
        {MORPH_ORDER.map((name, index) => {
          const accent = MORPH_ACCENTS[name];
          const isCurrent = morphology === name;
          const isTarget = request === name;
          const active = isCurrent || isTarget;
          return (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => onSelectEnv(name)}
                title={MORPH_DESCRIPTIONS[name]}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  flexShrink: 0,
                  width: 118,
                  boxSizing: "border-box",
                  padding: "14px 8px 12px",
                  borderRadius: 18,
                  cursor: "pointer",
                  border: isCurrent
                    ? `1.5px solid ${accent}`
                    : isTarget
                      ? `1px solid ${accent}88`
                      : "1px solid rgba(148, 163, 184, 0.18)",
                  background: isCurrent
                    ? `linear-gradient(170deg, ${accent}26, rgba(8, 12, 24, 0.72))`
                    : "rgba(255, 255, 255, 0.03)",
                  boxShadow: isCurrent
                    ? `0 0 30px ${accent}2e, inset 0 1px 0 rgba(255,255,255,0.06)`
                    : isTarget
                      ? `0 0 16px ${accent}1f`
                      : "none",
                  transition:
                    "border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease",
                }}
              >
                <CoreGlyph
                  color={morphStateColor(name)}
                  glow={accent}
                  size={64}
                  animated={active}
                  morph={name}
                />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    color: active ? accent : TEXT,
                    fontFamily: MONO,
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    ...LABEL,
                    fontSize: 8,
                    color: isCurrent
                      ? GREEN
                      : isTarget
                        ? accent
                        : "rgba(148, 163, 184, 0.55)",
                  }}
                >
                  {transforming && isTarget
                    ? "EVOLVING..."
                    : isCurrent
                      ? "CURRENT"
                      : isTarget
                        ? "TARGET"
                        : "READY"}
                </span>
              </button>

              {/* travelling energy line to the next version */}
              {index < MORPH_ORDER.length - 1 ? (
                <div
                  aria-hidden
                  className="genesis-evolve-shimmer"
                  style={{
                    position: "relative",
                    width: 36,
                    height: 2,
                    flexShrink: 0,
                    overflow: "hidden",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, transparent, ${MORPH_ACCENTS[MORPH_ORDER[index + 1]]}55, transparent)`,
                    boxShadow: `0 0 8px ${accent}44`,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* live status line */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
          fontSize: 11,
          fontFamily: MONO,
          letterSpacing: "0.08em",
          color: MUTED,
        }}
      >
        <StatusDot color={transforming ? CYAN : isMorphName(morphology) ? MORPH_ACCENTS[morphology] : VIOLET} />
        <span>
          {transforming && request
            ? `EVOLVING → ${request}`
            : isMorphName(morphology)
              ? `CURRENT FORM · ${morphology}`
              : "AUTO EVOLUTION ACTIVE"}
        </span>
      </div>
    </div>
  );
}
