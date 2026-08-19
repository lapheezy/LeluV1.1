/**
 * ==========================================================
 * LÉLUVERSE
 * VISUAL INTERFACE
 *
 * The second visual interface layer — LÉLU's computational/
 * biological environment. Four modes share ONE visual language
 * (the same stage chain, palette, geometry, and motion) so mode
 * transitions are continuous morphs, not theme swaps:
 *
 *   heartbeat — system pulse reacting to real runtime state
 *   matrix    — computational structure (provider routing, chains)
 *   nerve     — flowing signal network (information propagation)
 *   neuron    — organic cognition network (memory associations)
 *
 * Everything rendered here comes from REAL VisualEngine state:
 * signals were emitted by real agent events, active nodes are
 * real provider/memory/stage ids, the heartbeat rate is derived
 * from actual runtime flags. Nothing is decorative.
 *
 * The layer is always mounted behind the workspace/dialogue and
 * crossfades between modes in ~300ms — fast, not cinematic.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useVisual } from "../../../core/visual/useVisual";
import { COGNITION_STAGES } from "../../../core/visual/VisualEngine";

/* ------------------------------ shared state ----------------------------- */

export interface Point {
  x: number;
  y: number;
}

/** Stage positions per mode — the shared geometry that makes transitions continuous. */
export function stagePositions(mode: string, width: number, height: number): Map<string, Point> {
  const stages = COGNITION_STAGES;
  const map = new Map<string, Point>();
  const padding = 40;

  if (mode === "neuron") {
    // Organic ring.
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - padding;
    stages.forEach((stage, index) => {
      const angle = -Math.PI / 2 + (index / stages.length) * Math.PI * 2;
      map.set(stage.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });
    return map;
  }

  // Horizontal snake: rows of up to 4.
  const cols = Math.min(4, stages.length);
  const rows = Math.ceil(stages.length / cols);
  const cellW = (width - padding * 2) / (cols - 1 || 1);
  const cellH = (height - padding * 2) / (rows - 1 || 1);
  stages.forEach((stage, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    map.set(stage.id, {
      x: padding + col * cellW,
      y: padding + row * cellH,
    });
  });
  return map;
}



/* ------------------------------ heartbeat ------------------------------- */

function HeartbeatMode({ rate, runtime }: { rate: number; runtime: VisualStateRuntime }) {
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const intervalMs = Math.max(380, (60 / Math.max(20, rate)) * 1000);
    const id = window.setInterval(() => setBeat((value) => value + 1), intervalMs);
    return () => window.clearInterval(id);
  }, [rate]);

  const phase = runtime.thinking ? "thinking" : runtime.speaking ? "speaking" : runtime.toolsActive > 0 ? "tools" : runtime.listening ? "listening" : "idle";
  const color = runtime.error ? "#f87171" : phase === "thinking" ? "#a78bfa" : phase === "speaking" ? "#67e8f9" : phase === "tools" ? "#38bdf8" : "#34d399";
  const rings = [0, 1, 2, 3];

  return (
    <div style={modeCanvas}>
      <div style={modeEyebrow("System heartbeat")}>Heartbeat · {phase}{runtime.error ? " · error" : ""}</div>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        {rings.map((ring) => (
          <div
            key={`${beat}-${ring}`}
            style={{
              position: "absolute",
              width: 60,
              height: 60,
              borderRadius: 999,
              border: `1px solid ${color}66`,
              animation: `visual-ring 2.4s ease-out ${ring * 0.6}s infinite`,
            }}
          />
        ))}
        <div
          key={beat}
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            background: color,
            boxShadow: `0 0 24px ${color}, 0 0 60px ${color}66`,
          }}
        />
      </div>
      <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "14%", height: 70, pointerEvents: "none" }}>
        <svg width="100%" height="100%" viewBox="0 0 800 70" preserveAspectRatio="none">
          <path
            d="M 0 35 L 60 35 L 75 8 L 95 62 L 115 20 L 135 48 L 155 35 L 800 35"
            fill="none"
            stroke={`${color}55`}
            strokeWidth={2}
          />
          <path
            d="M 0 35 L 60 35 L 75 8 L 95 62 L 115 20 L 135 48 L 155 35 L 800 35"
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeDasharray="120 400"
          >
            <animate attributeName="stroke-dashoffset" from="520" to="0" dur={`${Math.max(1.2, 60 / Math.max(20, rate))}s`} repeatCount="indefinite" />
          </path>
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------- matrix --------------------------------- */

function MatrixMode({ structure, signals, activeNodes }: { structure: VisualStateStructure; signals: VisualSignal[]; activeNodes: string[] }) {
  const width = 1000;
  const height = 620;
  const stages = COGNITION_STAGES;
  const stagePos = useMemo(() => stagePositions("chain", width, height), [width, height]);
  const providers = structure.providers.slice(0, 8);

  const providerPos = (index: number): Point => ({
    x: width - 70,
    y: 90 + index * Math.max(60, (height - 140) / Math.max(1, providers.length)),
  });

  return (
    <div style={modeCanvas}>
      <div style={modeEyebrow("Computational structure")}>Matrix · routing & processing chains</div>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }}>
        {/* Processing chain */}
        {stages.map((stage, index) => {
          const p = stagePos.get(stage.id)!;
          const next = index < stages.length - 1 ? stagePos.get(stages[index + 1].id) : null;
          return (
            <g key={stage.id}>
              {next ? (
                <line x1={p.x} y1={p.y} x2={next.x} y2={next.y} stroke="rgba(103, 232, 249, 0.2)" strokeWidth={1} />
              ) : null}
              <circle cx={p.x} cy={p.y} r={activeNodes.includes(stage.id) ? 7 : 5} fill="#0b1526" stroke={activeNodes.includes(stage.id) ? "#67e8f9" : "rgba(103, 232, 249, 0.5)"} strokeWidth={1.2}>
                {activeNodes.includes(stage.id) ? <animate attributeName="r" values="5;8;5" dur="1.4s" repeatCount="indefinite" /> : null}
              </circle>
              <text x={p.x} y={p.y + 18} textAnchor="middle" fill="rgba(203, 226, 244, 0.85)" fontSize={11} fontWeight={600}>
                {stage.label}
              </text>
            </g>
          );
        })}

        {/* Provider routing column */}
        {providers.map((provider, index) => {
          const p = providerPos(index);
          const active = activeNodes.includes(provider);
          return (
            <g key={provider}>
              <line x1={p.x - 130} y1={p.y} x2={p.x} y2={p.y} stroke={active ? "rgba(56, 189, 248, 0.7)" : "rgba(56, 189, 248, 0.18)"} strokeWidth={active ? 1.6 : 1} strokeDasharray="3 4">
                {active ? <animate attributeName="stroke-dashoffset" from="14" to="0" dur="0.6s" repeatCount="indefinite" /> : null}
              </line>
              <rect x={p.x - 34} y={p.y - 12} width={68} height={24} rx={12} fill={active ? "rgba(56, 189, 248, 0.18)" : "rgba(8, 16, 38, 0.8)"} stroke={active ? "#38bdf8" : "rgba(56, 189, 248, 0.4)"} strokeWidth={1} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fill={active ? "#e0f7ff" : "rgba(203, 226, 244, 0.8)"} fontSize={10.5} fontWeight={active ? 700 : 500}>
                {provider.length > 12 ? `${provider.slice(0, 11)}…` : provider}
              </text>
            </g>
          );
        })}

        {/* Signals traveling the chain */}
        {signals.map((signal) => (
          <SignalDot key={signal.id} signal={signal} positions={stagePos} />
        ))}
      </svg>
    </div>
  );
}

/* -------------------------------- nerve --------------------------------- */

function NerveMode({ signals, activeConnections }: { signals: VisualSignal[]; activeConnections: string[] }) {
  const width = 1000;
  const height = 560;
  const stages = COGNITION_STAGES;
  const stagePos = useMemo(() => stagePositions("chain", width, height), [width, height]);
  const hub = { x: 40, y: height / 2 };

  return (
    <div style={modeCanvas}>
      <div style={modeEyebrow("Signal network")}>Nerve · information propagation</div>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }}>
        {/* Branching pathways from the input hub */}
        {stages.map((stage) => {
          const p = stagePos.get(stage.id)!;
          const active = activeConnections.includes(stage.id);
          const mx = (hub.x + p.x) / 2;
          const my = hub.y + (p.y - hub.y) * 0.3 - 24;
          return (
            <path
              key={`branch-${stage.id}`}
              d={`M ${hub.x} ${hub.y} C ${mx} ${my}, ${mx} ${my + 10}, ${p.x} ${p.y}`}
              fill="none"
              stroke={active ? "rgba(103, 232, 249, 0.75)" : "rgba(103, 232, 249, 0.16)"}
              strokeWidth={active ? 1.8 : 1}
              strokeDasharray="3 4"
            >
              {active ? <animate attributeName="stroke-dashoffset" from="14" to="0" dur="0.7s" repeatCount="indefinite" /> : null}
            </path>
          );
        })}
        {stages.map((stage) => {
          const p = stagePos.get(stage.id)!;
          return (
            <g key={stage.id}>
              <circle cx={p.x} cy={p.y} r={5} fill="#0b1526" stroke="rgba(103, 232, 249, 0.55)" strokeWidth={1.1} />
              <text x={p.x} y={p.y + 18} textAnchor="middle" fill="rgba(203, 226, 244, 0.85)" fontSize={11} fontWeight={600}>
                {stage.label}
              </text>
            </g>
          );
        })}
        {signals.map((signal) => (
          <SignalDot key={signal.id} signal={signal} positions={stagePos} />
        ))}
      </svg>
    </div>
  );
}

/* -------------------------------- neuron --------------------------------- */

function NeuronMode({ structure, signals, activeNodes }: { structure: VisualStateStructure; signals: VisualSignal[]; activeNodes: string[] }) {
  const width = 900;
  const height = 640;
  const stages = COGNITION_STAGES;
  const stagePos = useMemo(() => stagePositions("neuron", width, height), [width, height]);
  const memory = structure.memory.slice(0, 6);

  const memoryPos = (index: number, total: number): Point => {
    const angle = -Math.PI / 2 + ((index + 0.5) / total) * Math.PI * 2;
    return {
      x: width / 2 + Math.cos(angle) * Math.min(width, height) * 0.36,
      y: height / 2 + Math.sin(angle) * Math.min(width, height) * 0.36,
    };
  };

  return (
    <div style={modeCanvas}>
      <div style={modeEyebrow("Cognition network")}>Neuron · memory associations</div>
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }}>
        {/* Connection chords between cognition stages */}
        {stages.map((stage, index) =>
          stages.slice(index + 1).map((other) => {
            const a = stagePos.get(stage.id)!;
            const b = stagePos.get(other.id)!;
            return (
              <line key={`${stage.id}-${other.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(167, 139, 250, 0.1)" strokeWidth={0.8} />
            );
          }),
        )}
        {/* Memory association ring */}
        {memory.map((label, index) => {
          const p = memoryPos(index, memory.length);
          const active = activeNodes.includes(label) || activeNodes.includes("memory");
          const nearest = stages[Math.floor((index / Math.max(1, memory.length)) * stages.length)];
          const n = stagePos.get(nearest.id)!;
          return (
            <g key={`mem-${label}`}>
              <line x1={p.x} y1={p.y} x2={n.x} y2={n.y} stroke={active ? "rgba(251, 191, 36, 0.6)" : "rgba(251, 191, 36, 0.14)"} strokeWidth={active ? 1.5 : 1} strokeDasharray="3 4">
                {active ? <animate attributeName="stroke-dashoffset" from="14" to="0" dur="0.7s" repeatCount="indefinite" /> : null}
              </line>
              <circle cx={p.x} cy={p.y} r={active ? 7 : 5} fill="#0b1526" stroke={active ? "#fbbf24" : "rgba(251, 191, 36, 0.45)"} strokeWidth={1.2}>
                {active ? <animate attributeName="r" values="5;8;5" dur="1.2s" repeatCount="indefinite" /> : null}
              </circle>
              <text x={p.x} y={p.y + 17} textAnchor="middle" fill={active ? "#fde68a" : "rgba(203, 226, 244, 0.75)"} fontSize={9.5}>
                {label.length > 14 ? `${label.slice(0, 13)}…` : label}
              </text>
            </g>
          );
        })}
        {stages.map((stage) => {
          const p = stagePos.get(stage.id)!;
          const firing = activeNodes.includes(stage.id);
          return (
            <g key={stage.id}>
              <circle cx={p.x} cy={p.y} r={firing ? 8 : 6} fill="#0b1526" stroke={firing ? "#a78bfa" : "rgba(167, 139, 250, 0.5)"} strokeWidth={1.3}>
                {firing ? <animate attributeName="r" values="6;10;6" dur="1s" repeatCount="indefinite" /> : null}
              </circle>
              <text x={p.x} y={p.y + 19} textAnchor="middle" fill="rgba(203, 226, 244, 0.85)" fontSize={11} fontWeight={600}>
                {stage.label}
              </text>
            </g>
          );
        })}
        {signals.map((signal) => (
          <SignalDot key={signal.id} signal={signal} positions={stagePos} color="#a78bfa" />
        ))}
      </svg>
    </div>
  );
}

/* --------------------------- traveling signal dot ------------------------- */

interface SignalDotProps {
  signal: VisualSignal;
  positions: Map<string, Point>;
  color?: string;
}

function SignalDot({ signal, positions, color = "#67e8f9" }: SignalDotProps) {
  const now = useNow();
  const elapsed = now - signal.createdAt;
  const stepMs = 620;
  const stageIndex = Math.floor(elapsed / stepMs);
  if (stageIndex >= signal.path.length) {
    return null;
  }
  const from = positions.get(signal.path[Math.max(0, stageIndex - 1)]) ?? positions.get(signal.path[0]);
  const to = positions.get(signal.path[stageIndex]);
  if (!from || !to) {
    return null;
  }
  const t = Math.min(1, (elapsed % stepMs) / stepMs);
  const x = from.x + (to.x - from.x) * t;
  const y = from.y + (to.y - from.y) * t;
  return (
    <g>
      <circle cx={x} cy={y} r={4} fill={color} opacity={0.9}>
        <animate attributeName="opacity" values="1;0.3;1" dur="0.4s" repeatCount="indefinite" />
      </circle>
      <circle cx={x} cy={y} r={9} fill="none" stroke={color} strokeWidth={0.8} opacity={0.4} />
    </g>
  );
}

/* ------------------------------ rAF clock -------------------------------- */

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return now;
}

/* ------------------------------ the layer -------------------------------- */

export type VisualStateRuntime = { thinking: boolean; speaking: boolean; listening: boolean; toolsActive: number; error: boolean };
export type VisualStateStructure = { providers: string[]; memory: string[]; tools: string[] };
export type VisualSignal = { id: string; mode: string; path: string[]; label: string; createdAt: number };

export const MODE_LABELS: Record<string, string> = {
  core: "Core",
  heartbeat: "Heartbeat",
  matrix: "Matrix",
  nerve: "Nerve",
  neuron: "Neuron",
};

export const modeCanvas: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
};

export { SignalDot, HeartbeatMode, MatrixMode, NerveMode, NeuronMode, useNow };

function modeEyebrow(_label: string): CSSProperties {
  void _label;
  return {
    position: "absolute",
    top: 14,
    left: 18,
    fontSize: 9.5,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    color: "rgba(148, 163, 184, 0.75)",
    pointerEvents: "none",
  };
}

export default function VisualInterface() {
  const { state } = useVisual();
  const { mode, interfaceFocus, signals, activeNodes, activeConnections, heartbeatRate, runtime, structure } = state;

  // The layer sits behind the workspace/dialogue; its prominence follows
  // the Genesis/Visual interface switch. Core mode keeps a quiet ambient.
  const prominence = interfaceFocus === "visual" ? 1 : mode === "core" ? 0.18 : 0.4;

  const activeSignals = signals.filter((signal) => signal.mode === mode || signal.mode === "core");

  return (
    <div
      className="lelu-visual-interface"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 15,
        pointerEvents: "none",
        opacity: prominence,
        transition: "opacity 0.4s ease",
        background:
          "radial-gradient(120% 100% at 50% 0%, rgba(10, 16, 36, 0.55), rgba(2, 6, 23, 0.72) 70%)",
        overflow: "hidden",
      }}
    >
      {/* Mode layers crossfade — one shared visual language, fast morphs. */}
      <div style={{ ...modeCanvas, opacity: mode === "heartbeat" ? 1 : 0, transition: "opacity 0.3s ease" }}>
        <HeartbeatMode rate={heartbeatRate} runtime={runtime} />
      </div>
      <div style={{ ...modeCanvas, opacity: mode === "matrix" ? 1 : 0, transition: "opacity 0.3s ease" }}>
        <MatrixMode structure={structure} signals={activeSignals} activeNodes={activeNodes} />
      </div>
      <div style={{ ...modeCanvas, opacity: mode === "nerve" ? 1 : 0, transition: "opacity 0.3s ease" }}>
        <NerveMode signals={activeSignals} activeConnections={activeConnections} />
      </div>
      <div style={{ ...modeCanvas, opacity: mode === "neuron" ? 1 : 0, transition: "opacity 0.3s ease" }}>
        <NeuronMode structure={structure} signals={activeSignals} activeNodes={activeNodes} />
      </div>

      {/* Mode caption, bottom-right — always the same voice. */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: "clamp(96px, 12vh, 128px)",
          fontSize: 9.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(148, 163, 184, 0.6)",
          pointerEvents: "none",
        }}
      >
        Lélu · {MODE_LABELS[mode] ?? mode}
      </div>
    </div>
  );
}
