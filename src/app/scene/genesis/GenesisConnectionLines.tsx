/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS CONNECTION LINES
 *
 * The luminous energy beams of the workspace preview: the Core
 * connects to Creation Studio (violet), Research Lab (blue)
 * and Genesis Vault (emerald). Each beam is a soft outer glow
 * stroke plus a bright inner stroke, gently pulsing, with a
 * signal dot that travels the line — information visibly
 * moving between the core and its destinations.
 *
 * Beyond the main beams, a second family of FINE
 * INTERCONNECTIONS threads the outer nodes together — thin
 * hairline arcs between Creation ↔ Research, Creation ↔ Vault
 * and Research ↔ Vault, faint and slow so they read as a
 * subtle constellation web behind the bright core routes.
 *
 * Pure SVG/CSS — no canvas, no dependency. Coordinates are
 * viewport percentages (0..100) so the beams stay glued to
 * the node anchors at every screen size.
 * ==========================================================
 */

interface Point {
  x: number;
  y: number;
}

interface GenesisConnectionLinesProps {
  core: Point;
  creation: Point;
  research: Point;
  vault: Point;
  /** True while the system is busy → beams brighten. */
  active: boolean;
}

interface Beam {
  from: Point;
  to: Point;
  color: string;
  label: string;
  duration: number;
}

/**
 * Slight perpendicular offset in viewport-% space so the fine thread runs
 * alongside its main beam instead of painting over it.
 */
function offsetPoint(from: Point, to: Point, amount: number): { from: Point; to: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  return {
    from: { x: from.x + nx * amount, y: from.y + ny * amount },
    to: { x: to.x + nx * amount, y: to.y + ny * amount },
  };
}

export default function GenesisConnectionLines({
  core,
  creation,
  research,
  vault,
  active,
}: GenesisConnectionLinesProps) {
  const beams: Beam[] = [
    { from: core, to: creation, color: "#c084fc", label: "creation-beam", duration: 4.2 },
    { from: core, to: research, color: "#38bdf8", label: "research-beam", duration: 5.1 },
    { from: core, to: vault, color: "#34d399", label: "vault-beam", duration: 6.3 },
  ];

  // Fine interconnections between the OUTER nodes — faint hairline arcs that
  // web the destinations together beneath the bright core routes.
  const threads: Beam[] = [
    { from: creation, to: research, color: "#7dd3fc", label: "creation-research-thread", duration: 8.4 },
    { from: creation, to: vault, color: "#c084fc", label: "creation-vault-thread", duration: 9.2 },
    { from: research, to: vault, color: "#38bdf8", label: "research-vault-thread", duration: 7.6 },
  ];

  return (
    <svg
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
        overflow: "visible",
      }}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {beams.map((beam) => {
        const d = `M ${beam.from.x} ${beam.from.y} L ${beam.to.x} ${beam.to.y}`;
        const left = offsetPoint(beam.from, beam.to, -1.3);
        const right = offsetPoint(beam.from, beam.to, 1.3);
        return (
          <g key={beam.label} className="genesis-beam-pulse" style={{ animation: `genesis-beam-pulse ${3 + beam.duration}s ease-in-out infinite` }}>
            {/* fine hairline satellites — the beam's own fine interconnections */}
            <line
              x1={left.from.x}
              y1={left.from.y}
              x2={left.to.x}
              y2={left.to.y}
              stroke={beam.color}
              strokeWidth={0.18}
              strokeOpacity={active ? 0.22 : 0.1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={right.from.x}
              y1={right.from.y}
              x2={right.to.x}
              y2={right.to.y}
              stroke={beam.color}
              strokeWidth={0.18}
              strokeOpacity={active ? 0.22 : 0.1}
              vectorEffect="non-scaling-stroke"
            />
            {/* soft outer glow */}
            <line
              x1={beam.from.x}
              y1={beam.from.y}
              x2={beam.to.x}
              y2={beam.to.y}
              stroke={beam.color}
              strokeWidth={2.4}
              strokeOpacity={active ? 0.1 : 0.06}
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 3px ${beam.color})` }}
            />
            {/* bright core beam */}
            <line
              x1={beam.from.x}
              y1={beam.from.y}
              x2={beam.to.x}
              y2={beam.to.y}
              stroke={beam.color}
              strokeWidth={0.7}
              strokeOpacity={active ? 0.85 : 0.5}
              vectorEffect="non-scaling-stroke"
              style={{ filter: `drop-shadow(0 0 2px ${beam.color})` }}
            />
            {/* traveling signal */}
            <circle r={1.4} fill={beam.color} opacity={0.95} style={{ filter: `drop-shadow(0 0 2px ${beam.color})` }}>
              <animateMotion
                dur={`${beam.duration}s`}
                repeatCount="indefinite"
                path={d}
              />
            </circle>
            <circle r={3.2} fill="none" stroke={beam.color} strokeWidth={0.4} opacity={0.4} vectorEffect="non-scaling-stroke">
              <animateMotion
                dur={`${beam.duration}s`}
                repeatCount="indefinite"
                path={d}
              />
            </circle>
          </g>
        );
      })}

      {/* Fine interconnections between the outer nodes — a faint constellation
          web that forms the diamond's outer edges beneath the bright routes. */}
      {threads.map((thread) => {
        const d = `M ${thread.from.x} ${thread.from.y} L ${thread.to.x} ${thread.to.y}`;
        return (
          <g key={thread.label}>
            <line
              x1={thread.from.x}
              y1={thread.from.y}
              x2={thread.to.x}
              y2={thread.to.y}
              stroke={thread.color}
              strokeWidth={0.22}
              strokeOpacity={active ? 0.3 : 0.14}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="0.7 1.6"
              style={{ filter: `drop-shadow(0 0 1px ${thread.color})` }}
            />
            {/* slow spark drifting the fine thread */}
            <circle r={0.8} fill={thread.color} opacity={active ? 0.7 : 0.35}>
              <animateMotion
                dur={`${thread.duration}s`}
                repeatCount="indefinite"
                path={d}
              />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
