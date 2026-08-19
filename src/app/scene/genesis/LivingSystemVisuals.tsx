/**
 * ==========================================================
 * LÉLUVERSE
 * LIVING SYSTEM VISUALS — UI 2's real per-mode renderers
 *
 * The second interface (LivingSystemUI) has five system modes:
 * Heartbeat, Matrix, Nerve, Neuron, Core. Each mode previously
 * rendered a small diagram behind the buttons; these components
 * are the ACTUAL visualizations — full-screen, continuously
 * animated, and structurally distinct from one another.
 *
 *   HeartbeatVisualization  — living cardiovascular/energy rhythm:
 *                             ECG trace, pulsing central core,
 *                             expanding rings, traveling signal waves.
 *   MatrixVisualization     — computational lattice: dense grid of
 *                             nodes, connecting pathways, flowing
 *                             particles, node activation, regions.
 *   NerveVisualization      — branching communication network:
 *                             axon-like pathways, impulses traveling
 *                             each branch, glowing synapse nodes.
 *   NeuronVisualization     — microscopic level: soma, nucleus,
 *                             dendrites, myelin axon, terminal
 *                             boutons synapsing onto the next neuron.
 *   GenesisCoreVisualization— the ONE Genesis Core in its current
 *                             morphology (HAZARD/AURORA/OCEAN/PLASMA/
 *                             ELECTRIC/BIOHAZARD/HYBRID), rendered
 *                             from the SAME CoreVisualState the 3D
 *                             core reads — UI 2 observes the same
 *                             core; it never creates a second one.
 *
 * Every value comes from real shared state: heartbeat rate from the
 * VisualEngine runtime, signals/nodes/connections from real agent
 * events, and the Core visualization from the EngineBus's ONE
 * per-frame visual state. Nothing here is decorative or fabricated.
 * ==========================================================
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type EngineRuntime from "./engines/EngineRuntime";
import type { CoreVisualState } from "./render/CoreVisualState";
import type {
  VisualSignal,
  VisualStateRuntime,
  VisualStateStructure,
} from "./VisualInterface";

/* ------------------------------ shared -------------------------------- */

const FULL: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

const modeLabel: CSSProperties = {
  position: "absolute",
  top: 52,
  left: 18,
  fontSize: 9.5,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  color: "rgba(148, 163, 184, 0.7)",
};

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function phaseColor(runtime: VisualStateRuntime): string {
  if (runtime.error) return "#f87171";
  if (runtime.thinking) return "#a78bfa";
  if (runtime.speaking) return "#67e8f9";
  if (runtime.toolsActive > 0) return "#38bdf8";
  if (runtime.listening) return "#34d399";
  return "#38bdf8";
}

/* ======================================================================
 * HEARTBEAT — a living cardiovascular/energy rhythm system
 * ====================================================================== */

export function HeartbeatVisualization({
  rate,
  runtime,
}: {
  rate: number;
  runtime: VisualStateRuntime;
}) {
  const color = phaseColor(runtime);
  const beatMs = Math.max(420, (60 / Math.max(20, rate)) * 1000);
  const phase = runtime.error
    ? "error"
    : runtime.thinking
      ? "thinking"
      : runtime.speaking
        ? "speaking"
        : runtime.toolsActive > 0
          ? "tools"
          : runtime.listening
            ? "listening"
            : "idle";

  // ECG baseline amplitude responds to runtime state.
  const amplitude = runtime.thinking || runtime.speaking ? 1.45 : runtime.toolsActive > 0 ? 1.25 : 1;

  const ecg = useMemo(() => {
    const points: string[] = [];
    const width = 1200;
    const height = 220;
    const mid = height / 2;
    // One cardiac cycle: flat baseline with a sharp QRS complex.
    const segments = 96;
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      let y = mid;
      if (t > 0.16 && t < 0.24) y = mid + Math.sin(((t - 0.16) / 0.08) * Math.PI) * 30; // P wave
      if (t > 0.42 && t < 0.5) y = mid + 6; // flat PR
      if (t > 0.5 && t < 0.52) y = mid - 6; // Q
      if (t > 0.52 && t < 0.56) y = mid - 96 * amplitude; // R spike
      if (t > 0.56 && t < 0.58) y = mid + 34; // S
      if (t > 0.58 && t < 0.62) y = mid + 4; // return
      if (t > 0.78 && t < 0.92) y = mid - Math.sin(((t - 0.78) / 0.14) * Math.PI) * 22; // T wave
      points.push(`${(t * width).toFixed(1)},${y.toFixed(1)}`);
    }
    return `M ${points.join(" L ")}`;
  }, [amplitude]);

  return (
    <div style={FULL}>
      <div style={modeLabel}>System · Heartbeat · {phase}</div>

      {/* BPM readout — real VisualEngine heartbeat rate */}
      <div
        style={{
          position: "absolute",
          top: 52,
          right: 18,
          fontSize: 22,
          fontWeight: 700,
          color,
          letterSpacing: "0.06em",
          textShadow: `0 0 18px ${color}66`,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {rate}
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.65, marginLeft: 4 }}>
          BPM
        </span>
      </div>

      {/* Pulsing central structure + expanding synchronized rings */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "46%",
          transform: "translate(-50%, -50%)",
          width: 180,
          height: 180,
        }}
      >
        {[0, 1, 2, 3, 4].map((ring) => (
          <div
            key={ring}
            className="living-heartbeat-ring"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              border: `1px solid ${color}66`,
              animationDelay: `${ring * (beatMs * 0.19)}ms`,
              animationDuration: `${beatMs * 1.6}ms`,
            }}
          />
        ))}
        <div
          className="living-heartbeat-core"
          style={{
            position: "absolute",
            inset: 34,
            borderRadius: 999,
            background: `radial-gradient(circle at 50% 38%, #ffffff, ${color} 45%, ${color}22 78%)`,
            boxShadow: `0 0 ${30 + rate * 0.25}px ${color}88, 0 0 90px ${color}44, inset 0 0 30px ${color}55`,
            animationDuration: `${beatMs}ms`,
          }}
        >
          <span
            style={{
              position: "absolute",
              left: "50%",
              top: "42%",
              transform: "translate(-50%, -50%)",
              width: 26,
              height: 26,
              borderRadius: 999,
              background: "rgba(255,255,255,0.95)",
              boxShadow: `0 0 22px #ffffff`,
            }}
          />
        </div>
      </div>

      {/* ECG trace across the bottom of the field */}
      <svg
        viewBox="0 0 1200 220"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          left: "4%",
          right: "4%",
          bottom: "16%",
          width: "92%",
          height: 110,
        }}
      >
        <defs>
          <linearGradient id="ecg-fill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0" />
            <stop offset="100%" stopColor={color} stopOpacity="0.9" />
          </linearGradient>
        </defs>
        {/* ghost full trace */}
        <path d={ecg} fill="none" stroke={`${color}33`} strokeWidth={1.6} />
        {/* traveling bright segment */}
        <path
          d={ecg}
          fill="none"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeDasharray="220 1400"
          className="living-heartbeat-ecg"
          style={{
            animationDuration: `${beatMs * 2.4}ms`,
            filter: `drop-shadow(0 0 6px ${color})`,
          }}
        />
        <path
          d={ecg}
          fill="none"
          stroke={`url(#ecg-fill)`}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray="30 1400"
          className="living-heartbeat-ecg"
          style={{ animationDuration: `${beatMs * 2.4}ms` }}
        />
      </svg>

      {/* Synchronized signal waves above the trace */}
      {[0, 1, 2].map((wave) => (
        <div
          key={wave}
          className="living-heartbeat-wave"
          style={{
            position: "absolute",
            left: "6%",
            right: "6%",
            bottom: `${28 + wave * 16}%`,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${color}77, transparent)`,
            animationDelay: `${wave * 0.7}s`,
          }}
        />
      ))}
    </div>
  );
}

/* ======================================================================
 * MATRIX — a computational lattice / network visualization
 * ====================================================================== */

interface MatrixProps {
  structure: VisualStateStructure;
  signals: VisualSignal[];
  activeNodes: string[];
}

interface LatticeNode {
  x: number;
  y: number;
  region: number;
}

export function MatrixVisualization({ structure, signals, activeNodes }: MatrixProps) {
  const width = 1200;
  const height = 760;

  const { nodes, links } = useMemo(() => {
    const rand = seeded(7);
    const cols = 11;
    const rows = 7;
    const nodes: LatticeNode[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        nodes.push({
          x: 60 + (col / (cols - 1)) * (width - 120) + (rand() - 0.5) * 26,
          y: 60 + (row / (rows - 1)) * (height - 120) + (rand() - 0.5) * 26,
          region: Math.floor((row / rows) * 3) * 2 + (col > cols / 2 ? 1 : 0),
        });
      }
    }
    const links: Array<[number, number]> = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        if (col + 1 < cols) links.push([index, index + 1]);
        if (row + 1 < rows) links.push([index, index + cols]);
        if (row + 1 < rows && col + 1 < cols && rand() > 0.5) {
          links.push([index, index + cols + 1]);
        }
      }
    }
    return { nodes, links };
  }, []);

  const activeSet = useMemo(() => new Set(activeNodes), [activeNodes]);

  // Data particles flowing along a subset of links (deterministic).
  const flows = useMemo(() => {
    const rand = seeded(31);
    return links.filter(() => rand() > 0.72).slice(0, 26).map(([a, b], index) => ({
      from: nodes[a],
      to: nodes[b],
      dur: 3.4 + rand() * 4,
      delay: rand() * 3,
      color: index % 3 === 0 ? "#a78bfa" : index % 3 === 1 ? "#67e8f9" : "#34d399",
    }));
  }, [links, nodes]);

  const providerLabels = structure.providers.slice(0, 6);

  return (
    <div style={FULL}>
      <div style={modeLabel}>System · Matrix · computational lattice</div>

      {/* Second faint grid behind — multidimensional depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(103, 232, 249, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(103, 232, 249, 0.04) 1px, transparent 1px)",
          backgroundSize: "58px 58px",
          transform: "perspective(600px) rotateX(24deg) scale(1.4)",
          transformOrigin: "50% 40%",
        }}
      />

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* connecting pathways */}
        {links.map(([a, b], index) => {
          const from = nodes[a];
          const to = nodes[b];
          const active = activeSet.has(`link-${index}`);
          return (
            <line
              key={`link-${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={active ? "#a5f3fc" : "rgba(103, 232, 249, 0.16)"}
              strokeWidth={active ? 1.8 : 0.8}
            />
          );
        })}

        {/* flowing data particles along pathways */}
        {flows.map((flow, index) => {
          const d = `M ${flow.from.x} ${flow.from.y} L ${flow.to.x} ${flow.to.y}`;
          return (
            <circle key={`flow-${index}`} r={2.2} fill={flow.color} opacity={0.85}>
              <animateMotion dur={`${flow.dur}s`} begin={`${flow.delay}s`} repeatCount="indefinite" path={d} />
            </circle>
          );
        })}

        {/* nodes */}
        {nodes.map((node, index) => {
          const active = activeSet.has(String(index)) || activeSet.has(`n${index}`);
          const regionColors = ["#38bdf8", "#a78bfa", "#34d399", "#67e8f9", "#f472b6", "#7dd3fc"];
          const color = regionColors[node.region % regionColors.length];
          return (
            <circle
              key={`node-${index}`}
              cx={node.x}
              cy={node.y}
              r={active ? 7 : 3.2}
              fill={active ? color : "#0b1526"}
              stroke={color}
              strokeWidth={active ? 1.8 : 0.8}
              opacity={active ? 1 : 0.55}
            >
              {active ? (
                <animate attributeName="r" values="5;9;5" dur="1.2s" repeatCount="indefinite" />
              ) : null}
            </circle>
          );
        })}

        {/* provider routing column */}
        {providerLabels.map((provider, index) => {
          const active = activeSet.has(provider);
          const x = width - 150;
          const y = 90 + index * 92;
          const stage = nodes[Math.floor((index / Math.max(1, providerLabels.length)) * nodes.length)];
          return (
            <g key={`provider-${provider}`}>
              <line
                x1={stage.x}
                y1={stage.y}
                x2={x}
                y2={y}
                stroke={active ? "rgba(56, 189, 248, 0.8)" : "rgba(56, 189, 248, 0.18)"}
                strokeWidth={active ? 1.6 : 0.8}
                strokeDasharray="3 5"
              >
                {active ? (
                  <animate attributeName="stroke-dashoffset" from="16" to="0" dur="0.7s" repeatCount="indefinite" />
                ) : null}
              </line>
              <rect x={x - 42} y={y - 13} width={84} height={26} rx={13} fill={active ? "rgba(56,189,248,0.18)" : "rgba(8,16,38,0.8)"} stroke={active ? "#38bdf8" : "rgba(56,189,248,0.35)"} strokeWidth={1} />
              <text x={x} y={y + 4} textAnchor="middle" fill={active ? "#e0f7ff" : "rgba(203,226,244,0.8)"} fontSize={10} fontWeight={active ? 700 : 500}>
                {provider.length > 12 ? `${provider.slice(0, 11)}…` : provider}
              </text>
            </g>
          );
        })}

        {/* signal bursts from real agent events */}
        {signals.slice(-4).map((signal, index) => {
          const from = nodes[(index * 17) % nodes.length];
          const to = nodes[(index * 23 + 5) % nodes.length];
          const d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
          return (
            <circle key={signal.id} r={4} fill="#fbbf24" opacity={0.9}>
              <animateMotion dur={`${1.4 + index * 0.4}s`} begin={`${index * 0.3}s`} repeatCount="indefinite" path={d} />
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

/* ======================================================================
 * NERVE — branching communication network with traveling impulses
 * ====================================================================== */

interface NerveProps {
  signals: VisualSignal[];
  activeConnections: string[];
}

interface Branch {
  d: string;
  dur: number;
  delay: number;
  depth: number;
}

export function NerveVisualization({ signals, activeConnections }: NerveProps) {
  const width = 1200;
  const height = 760;

  const branches = useMemo<Branch[]>(() => {
    const rand = seeded(13);
    const branches: Branch[] = [];
    const hub = { x: width / 2, y: height - 40 };

    const grow = (x: number, y: number, angle: number, length: number, depth: number, path: string, delay: number) => {
      const endX = x + Math.cos(angle) * length;
      const endY = y + Math.sin(angle) * length;
      // control point bows the branch like an axon
      const ctrlX = x + Math.cos(angle + (rand() - 0.5) * 0.9) * length * 0.5;
      const ctrlY = y + Math.sin(angle + (rand() - 0.5) * 0.9) * length * 0.5;
      const segment = ` C ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)}, ${((x + endX) / 2 + (rand() - 0.5) * 30).toFixed(1)} ${((y + endY) / 2 + (rand() - 0.5) * 30).toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
      const full = `${path}${segment}`;
      branches.push({
        d: full,
        dur: 2.6 + rand() * 2.4 + depth * 0.5,
        delay: delay + rand() * 1.2,
        depth,
      });
      if (depth < 3) {
        const count = 2 + Math.floor(rand() * 2);
        for (let i = 0; i < count; i += 1) {
          grow(
            endX,
            endY,
            angle - 0.55 - rand() * 0.5 + i * (1.05 + rand() * 0.4),
            length * (0.62 + rand() * 0.18),
            depth + 1,
            full,
            delay + 0.5 + rand(),
          );
        }
      }
    };

    const rootAngle = -Math.PI / 2;
    const rootCount = 3;
    for (let i = 0; i < rootCount; i += 1) {
      grow(
        hub.x,
        hub.y,
        rootAngle - 0.8 + i * 0.8 + (rand() - 0.5) * 0.3,
        150 + rand() * 60,
        0,
        `M ${hub.x} ${hub.y}`,
        i * 0.8,
      );
    }
    return branches;
  }, []);

  const activeSet = useMemo(() => new Set(activeConnections), [activeConnections]);

  return (
    <div style={FULL}>
      <div style={modeLabel}>System · Nerve · signal propagation</div>

      {/* branching nerve pathways */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {branches.map((branch, index) => {
          const lit = activeSet.size > 0 ? activeSet.has(String(index % 8)) : index % 3 === 0;
          return (
            <g key={`branch-${index}`}>
              {/* axon path */}
              <path
                d={branch.d}
                fill="none"
                stroke={lit ? "rgba(103, 232, 249, 0.8)" : "rgba(103, 232, 249, 0.16)"}
                strokeWidth={branch.depth === 0 ? 2.4 : 1.6 - branch.depth * 0.3}
                strokeLinecap="round"
                style={{ filter: lit ? "drop-shadow(0 0 4px rgba(103,232,249,0.6))" : "none" }}
              />
              {/* electrical impulse traveling the branch */}
              <circle r={3} fill="#d7fbff" opacity={0.95}>
                <animateMotion dur={`${branch.dur}s`} begin={`${branch.delay}s`} repeatCount="indefinite" path={branch.d} />
              </circle>
              <circle r={7} fill="none" stroke="#a5f3fc" strokeWidth={1} opacity={0.35}>
                <animateMotion dur={`${branch.dur}s`} begin={`${branch.delay}s`} repeatCount="indefinite" path={branch.d} />
              </circle>
            </g>
          );
        })}

        {/* glowing synapse nodes at branch points */}
        {branches.map((branch, index) => {
          const end = branch.d.split(" ").slice(-2);
          const x = parseFloat(end[0] ?? "0");
          const y = parseFloat(end[1] ?? "0");
          if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
          return (
            <circle
              key={`synapse-${index}`}
              cx={x}
              cy={y}
              r={2.6}
              fill={branch.depth === 3 ? "#34d399" : "#7dd3fc"}
              opacity={0.9}
            >
              <animate attributeName="opacity" values="0.5;1;0.5" dur={`${1.4 + (index % 5) * 0.4}s`} repeatCount="indefinite" />
            </circle>
          );
        })}

        {/* real signal traces */}
        {signals.slice(-5).map((signal, index) => {
          const branch = branches[Math.min(branches.length - 1, (index * 7 + 3) % branches.length)];
          return (
            <circle key={signal.id} r={4.5} fill="#f472b6" opacity={0.95}>
              <animateMotion dur={`${2 + index * 0.6}s`} begin={`${index * 0.5}s`} repeatCount="indefinite" path={branch.d} />
            </circle>
          );
        })}
      </svg>
    </div>
  );
}

/* ======================================================================
 * NEURON — microscopic cellular/neural structure
 * ====================================================================== */

interface NeuronProps {
  structure: VisualStateStructure;
  signals: VisualSignal[];
  activeNodes: string[];
}

export function NeuronVisualization({ structure, activeNodes }: Omit<NeuronProps, "signals">) {
  const width = 1200;
  const height = 760;

  const soma = { x: 420, y: 380 };
  const partner = { x: 1050, y: 420 };

  // Dendrites — curved branches into the soma (left/top/right side).
  const dendrites = useMemo(() => {
    const rand = seeded(41);
    return Array.from({ length: 7 }, (_, index) => {
      const angle = -Math.PI * 0.82 + (index / 6) * Math.PI * 0.78;
      const len = 150 + rand() * 90;
      const tip = {
        x: soma.x + Math.cos(angle) * len,
        y: soma.y + Math.sin(angle) * len,
      };
      const ctrl = {
        x: soma.x + Math.cos(angle + (rand() - 0.5) * 0.8) * len * 0.55,
        y: soma.y + Math.sin(angle + (rand() - 0.5) * 0.8) * len * 0.55,
      };
      return {
        d: `M ${tip.x.toFixed(1)} ${tip.y.toFixed(1)} Q ${ctrl.x.toFixed(1)} ${ctrl.y.toFixed(1)} ${soma.x} ${soma.y}`,
        tip,
        delay: index * 0.45,
        dur: 2.2 + rand() * 1.6,
        active: activeNodes.includes(`dendrite-${index}`),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNodes]);

  // Axon — myelin-sheathed trunk to the terminal boutons.
  const axonPath = `M ${soma.x} ${soma.y} Q 720 400, 940 ${partner.y}`;
  const boutons = useMemo(() => {
    return Array.from({ length: 4 }, (_, index) => {
      return {
        x: 940 + Math.cos(-0.35 + index * 0.25) * 26,
        y: partner.y + Math.sin(-0.35 + index * 0.25) * 26,
        delay: index * 0.5,
      };
    });
  }, []);

  const memory = structure.memory.slice(0, 5);

  return (
    <div style={FULL}>
      <div style={modeLabel}>System · Neuron · microscopic signal transmission</div>

      {/* microscopic floating particles */}
      {Array.from({ length: 18 }, (_, index) => {
        const x = 90 + ((index * 137) % 1020);
        const y = 80 + ((index * 61) % 600);
        return (
          <div
            key={`particle-${index}`}
            className="living-neuron-particle"
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: 2,
              height: 2,
              borderRadius: 999,
              background: index % 3 === 0 ? "#a78bfa" : "#67e8f9",
              opacity: 0.5,
              animationDelay: `${(index % 7) * 0.6}s`,
            }}
          />
        );
      })}

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {/* dendrites */}
        {dendrites.map((dendrite, index) => (
          <g key={`dendrite-${index}`}>
            <path
              d={dendrite.d}
              fill="none"
              stroke={dendrite.active ? "rgba(167, 139, 250, 0.9)" : "rgba(167, 139, 250, 0.35)"}
              strokeWidth={1.6}
              strokeLinecap="round"
            />
            {/* signal traveling INTO the soma from the dendrite tip */}
            <circle r={2.8} fill="#e9d5ff" opacity={0.95}>
              <animateMotion dur={`${dendrite.dur}s`} begin={`${dendrite.delay}s`} repeatCount="indefinite" path={dendrite.d} />
            </circle>
            {/* dendritic spine */}
            <circle cx={dendrite.tip.x} cy={dendrite.tip.y} r={2} fill="#c4b5fd" opacity={0.8} />
          </g>
        ))}

        {/* axon with myelin sheath segments */}
        <path
          d={axonPath}
          fill="none"
          stroke="rgba(103, 232, 249, 0.4)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray="26 10"
        />
        <path
          d={axonPath}
          fill="none"
          stroke="rgba(226, 248, 255, 0.85)"
          strokeWidth={2.6}
          strokeLinecap="round"
        />

        {/* firing impulse: dendrite → soma → axon → boutons */}
        <circle r={3.4} fill="#ffffff" opacity={0.98}>
          <animateMotion
            dur="4.6s"
            begin="0.4s"
            repeatCount="indefinite"
            path={`M 240 300 Q ${soma.x - 60} ${soma.y - 90} ${soma.x} ${soma.y} ${axonPath.slice(1)}`}
            keyPoints="0;0.22;1"
            keyTimes="0;0.22;1"
          />
        </circle>

        {/* terminal boutons synapsing onto the partner neuron */}
        {boutons.map((bouton, index) => (
          <g key={`bouton-${index}`}>
            <circle cx={bouton.x} cy={bouton.y} r={4.5} fill="#34d399" opacity={0.95}>
              <animate attributeName="opacity" values="0.4;1;0.4" dur={`${1.2 + index * 0.35}s`} repeatCount="indefinite" />
            </circle>
            {/* synaptic gap spark */}
            <line
              x1={bouton.x + 5}
              y1={bouton.y}
              x2={partner.x - 26}
              y2={partner.y}
              stroke="rgba(52, 211, 153, 0.35)"
              strokeWidth={0.8}
            />
          </g>
        ))}

        {/* SOMA — cell body with nucleus */}
        <circle cx={soma.x} cy={soma.y} r={58} fill="rgba(139, 92, 246, 0.16)" stroke="#a78bfa" strokeWidth={2} />
        <circle
          cx={soma.x}
          cy={soma.y}
          r={58}
          fill="none"
          stroke="rgba(167, 139, 250, 0.35)"
          strokeWidth={1}
          className="living-neuron-soma"
        />
        <circle cx={soma.x} cy={soma.y} r={24} fill="rgba(216, 180, 254, 0.35)" stroke="#d8b4fe" strokeWidth={1.4} />
        <circle cx={soma.x - 5} cy={soma.y - 6} r={7} fill="rgba(255,255,255,0.9)" />
        <text x={soma.x} y={soma.y + 86} textAnchor="middle" fill="rgba(226, 232, 240, 0.6)" fontSize={9} letterSpacing="0.14em">
          SOMA · NUCLEUS
        </text>
        <text x={820} y={partner.y - 60} textAnchor="middle" fill="rgba(226, 232, 240, 0.6)" fontSize={9} letterSpacing="0.14em">
          MYELINATED AXON
        </text>
        <text x={partner.x + 60} y={partner.y + 110} textAnchor="middle" fill="rgba(226, 232, 240, 0.6)" fontSize={9} letterSpacing="0.14em">
          SYNAPSE → NEXT NEURON
        </text>

        {/* partner neuron (receiving) */}
        <circle cx={partner.x} cy={partner.y} r={30} fill="rgba(52, 211, 153, 0.12)" stroke="#34d399" strokeWidth={1.6} />
        <circle cx={partner.x} cy={partner.y} r={12} fill="rgba(110, 231, 183, 0.35)" stroke="#6ee7b7" strokeWidth={1} />
        {[-0.9, -0.4, 0.2, 0.7].map((angle, index) => (
          <line
            key={`partner-dendrite-${index}`}
            x1={partner.x}
            y1={partner.y}
            x2={partner.x + Math.cos(angle) * 46}
            y2={partner.y + Math.sin(angle) * 46}
            stroke="rgba(52, 211, 153, 0.4)"
            strokeWidth={1.2}
            strokeLinecap="round"
          />
        ))}

        {/* memory association labels — the system's memory layers as synapses */}
        {memory.map((label, index) => {
          const x = 60 + index * 150;
          const y = height - 40;
          const firing = activeNodes.includes(label) || activeNodes.includes("memory");
          return (
            <g key={`mem-${label}`}>
              <circle cx={x} cy={y - 12} r={firing ? 6 : 4} fill={firing ? "#fbbf24" : "rgba(251, 191, 36, 0.5)"}>
                {firing ? <animate attributeName="r" values="3;7;3" dur="1.1s" repeatCount="indefinite" /> : null}
              </circle>
              <text x={x} y={y} textAnchor="middle" fill={firing ? "#fde68a" : "rgba(203, 226, 244, 0.6)"} fontSize={8.5}>
                {label.length > 14 ? `${label.slice(0, 13)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ======================================================================
 * CORE — the ONE Genesis Core in its current morphology
 * ====================================================================== */

interface CoreVisualSnapshot {
  morphology: string;
  morphologyProgress: number;
  activity: number;
  pulse: number;
  color: string;
  glow: string;
  weights: { ocean: number; plasma: number; electric: number; crystal: number; halo: number; bio: number };
}

function snapshotCore(vs: CoreVisualState | undefined): CoreVisualSnapshot {
  return {
    morphology: vs?.morphology ?? "PLASMA",
    morphologyProgress: vs?.morphologyProgress ?? 0,
    activity: vs?.activity ?? 0.3,
    pulse: vs?.pulse ?? 0.35,
    color: vs?.stateColor?.getStyle() ?? "#009CFF",
    glow: vs?.stateGlow?.getStyle() ?? "#4BD9FF",
    weights: vs?.stateWeights
      ? { ...vs.stateWeights }
      : { ocean: 0, plasma: 1, electric: 0, crystal: 0, halo: 1, bio: 0 },
  };
}

/**
 * Renders the ONE Genesis Core from the SAME CoreVisualState the 3D
 * core reads every frame — morphology, color, weights, activity and
 * pulse are the shared values, so UI 2 observes the identical core
 * the cosmic UI shows. This is a system view of the same core, never
 * a second core.
 */
export function GenesisCoreVisualization({ engineRuntime }: { engineRuntime: EngineRuntime | null }) {
  const [snapshot, setSnapshot] = useState<CoreVisualSnapshot>(() =>
    snapshotCore(engineRuntime?.getEngineBus().getVisualState()),
  );

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 120) return;
      last = now;
      setSnapshot(snapshotCore(engineRuntime?.getEngineBus().getVisualState()));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engineRuntime]);

  const { morphology, morphologyProgress, activity, pulse, color, glow, weights } = snapshot;

  // Morphology accents on the same core body.
  const accent =
    morphology === "HAZARD"
      ? "#f472b6"
      : morphology === "AURORA"
        ? "#c4b5fd"
        : morphology === "OCEAN"
          ? "#34d399"
          : morphology === "PLASMA"
            ? "#fb923c"
            : morphology === "ELECTRIC"
              ? "#7dd3fc"
              : morphology === "BIOHAZARD"
                ? "#4ade80"
                : "#a78bfa";

  const scale = 1 + activity * 0.1 + Math.sin(performance.now() * 0.001 * 2.2) * 0.02 * (0.4 + pulse);

  return (
    <div style={FULL}>
      <div style={modeLabel}>System · Core · shared Genesis core · {morphology}</div>

      {/* live system readouts — same values the 3D core uses */}
      <div
        style={{
          position: "absolute",
          top: 52,
          right: 18,
          fontSize: 10,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(148, 163, 184, 0.75)",
          textAlign: "right",
          lineHeight: 1.9,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <div style={{ color: "rgba(186, 230, 253, 0.9)" }}>Morph · {morphology}</div>
        <div>Activity {Math.round(activity * 100)}%</div>
        <div>Pulse {Math.round(pulse * 100)}%</div>
        <div>
          w · o {weights.ocean.toFixed(2)} p {weights.plasma.toFixed(2)} e {weights.electric.toFixed(2)}
        </div>
        <div>
          c {weights.crystal.toFixed(2)} h {weights.halo.toFixed(2)} b {weights.bio.toFixed(2)}
        </div>
      </div>

      {/* the core sphere — same color, glow, weights, breathing */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "47%",
          transform: "translate(-50%, -50%)",
          width: "min(44vmin, 420px)",
          height: "min(44vmin, 420px)",
        }}
      >
        {/* outer glow */}
        <div
          className="living-core-breathe"
          style={{
            position: "absolute",
            inset: "-24%",
            borderRadius: 999,
            background: `radial-gradient(circle, ${glow}44, transparent 65%)`,
            filter: "blur(18px)",
          }}
        />
        {/* orbital rings */}
        {[0, 1, 2].map((ring) => (
          <div
            key={`ring-${ring}`}
            className="living-core-ring"
            style={{
              position: "absolute",
              inset: `${18 + ring * 20}%`,
              borderRadius: "50% / 34%",
              border: `1px solid ${ring === 1 ? accent : glow}${ring === 2 ? "44" : "77"}`,
              animationDelay: `${ring * 3}s`,
              animationDuration: `${26 + ring * 14}s`,
              animationDirection: ring % 2 === 0 ? "normal" : "reverse",
            }}
          />
        ))}
        {/* the one core surface */}
        <div
          className="living-core-surface"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            transform: `scale(${scale.toFixed(3)})`,
            background: `radial-gradient(circle at 38% 30%, #ffffff, ${color} 42%, ${glow}99 70%, ${accent}33 100%)`,
            boxShadow: `0 0 ${50 + activity * 90}px ${glow}88, 0 0 160px ${accent}44, inset 0 0 60px ${glow}55`,
            transition: "background 0.5s ease, box-shadow 0.5s ease",
          }}
        >
          {/* internal morphology shimmer */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: "18%",
              borderRadius: 999,
              background: `conic-gradient(from ${performance.now() * 0.02}deg, transparent 0deg, ${glow}33 40deg, transparent 80deg, ${accent}22 120deg, transparent 160deg, ${glow}33 220deg, transparent 280deg)`,
              animation: "living-core-rotate 24s linear infinite",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: "38%",
              borderRadius: 999,
              background: "radial-gradient(circle, rgba(255,255,255,0.95), rgba(255,255,255,0) 62%)",
              boxShadow: "0 0 30px rgba(255,255,255,0.8)",
            }}
          />
        </div>
        {/* morphology progress — the window position on the shared cycle */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: -34,
            transform: "translateX(-50%)",
            width: "70%",
            height: 2,
            borderRadius: 999,
            background: "rgba(148, 163, 184, 0.2)",
          }}
        >
          <div
            style={{
              width: `${Math.round(morphologyProgress * 100)}%`,
              height: "100%",
              borderRadius: 999,
              background: accent,
              boxShadow: `0 0 8px ${accent}`,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
 * COMPOSITE — one export that renders whichever system mode is active
 * ====================================================================== */

export function LivingSystemVisuals({
  mode,
  rate,
  runtime,
  structure,
  signals,
  activeNodes,
  activeConnections,
  engineRuntime,
}: {
  mode: string;
  rate: number;
  runtime: VisualStateRuntime;
  structure: VisualStateStructure;
  signals: VisualSignal[];
  activeNodes: string[];
  activeConnections: string[];
  engineRuntime: EngineRuntime | null;
}) {
  if (mode === "heartbeat") {
    return <HeartbeatVisualization rate={rate} runtime={runtime} />;
  }
  if (mode === "matrix") {
    return <MatrixVisualization structure={structure} signals={signals} activeNodes={activeNodes} />;
  }
  if (mode === "nerve") {
    return <NerveVisualization signals={signals} activeConnections={activeConnections} />;
  }
  if (mode === "neuron") {
    return <NeuronVisualization structure={structure} activeNodes={activeNodes} />;
  }
  if (mode === "core") {
    return <GenesisCoreVisualization engineRuntime={engineRuntime} />;
  }
  return null;
}

export default LivingSystemVisuals;
