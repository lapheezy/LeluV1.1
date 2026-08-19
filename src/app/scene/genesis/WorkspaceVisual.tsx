/**
 * ==========================================================
 * LÉLUVERSE
 * WORKSPACE VISUAL RENDERER
 *
 * Contextual LÉLU surfaces, not generic cards. Every view kind
 * gets the surface that fits the content — charts as integrated
 * data visualizations, architecture as node/connection graphs,
 * memory as flowing cognition, browser as an embedded surface,
 * video/image as media canvases, code as a code surface — all
 * sharing one LÉLU visual language (same type scale, spacing,
 * borders, depth, and ambient glow) so the workspace feels like
 * LÉLU is creating surfaces inside her environment.
 *
 * Structured VisualSpecs (data, not HTML) drive every surface,
 * so editing the model just re-renders.
 * ==========================================================
 */

import { memo, type CSSProperties } from "react";
import type { VisualSpec } from "../../../core/workspace/VisualSpec";
import type { WorkspaceViewState } from "../../../core/workspace/WorkspaceEngine";

/* ------------------------------------------------------------
 * Shared LÉLU surface language.
 * ---------------------------------------------------------- */

export interface SurfaceAccent {
  color: string;
  glow: string;
  label: string;
}

export const SURFACE_ACCENTS: Record<string, SurfaceAccent> = {
  diagram: { color: "#67e8f9", glow: "rgba(103, 232, 249, 0.35)", label: "Architecture" },
  chart: { color: "#38bdf8", glow: "rgba(56, 189, 248, 0.35)", label: "Data" },
  table: { color: "#7dd3fc", glow: "rgba(125, 211, 252, 0.3)", label: "Data" },
  timeline: { color: "#a78bfa", glow: "rgba(167, 139, 250, 0.35)", label: "Timeline" },
  wireframe: { color: "#f472b6", glow: "rgba(244, 114, 182, 0.32)", label: "Design" },
  design: { color: "#f472b6", glow: "rgba(244, 114, 182, 0.32)", label: "Design" },
  file: { color: "#34d399", glow: "rgba(52, 211, 153, 0.32)", label: "Code" },
  browser: { color: "#38bdf8", glow: "rgba(56, 189, 248, 0.35)", label: "Browser" },
  video: { color: "#f472b6", glow: "rgba(244, 114, 182, 0.35)", label: "Media" },
  image: { color: "#c084fc", glow: "rgba(192, 132, 252, 0.32)", label: "Canvas" },
  memory: { color: "#fbbf24", glow: "rgba(251, 191, 36, 0.32)", label: "Memory" },
  cognition: { color: "#a78bfa", glow: "rgba(167, 139, 250, 0.35)", label: "Cognition" },
  providers: { color: "#34d399", glow: "rgba(52, 211, 153, 0.35)", label: "Status" },
  genesis: { color: "#67e8f9", glow: "rgba(103, 232, 249, 0.4)", label: "Genesis" },
  activity: { color: "#94a3b8", glow: "rgba(148, 163, 184, 0.3)", label: "Activity" },
};

export function surfaceAccent(kind: string): SurfaceAccent {
  return SURFACE_ACCENTS[kind] ?? SURFACE_ACCENTS.activity;
}

const canvas: CSSProperties = {
  width: "100%",
  height: "100%",
  overflow: "auto",
  padding: 14,
  boxSizing: "border-box",
  background:
    "radial-gradient(120% 90% at 50% 0%, rgba(103, 232, 249, 0.05), rgba(2, 6, 23, 0.0) 60%)",
};

function eyebrow(accent: SurfaceAccent): CSSProperties {
  return {
    fontSize: 9.5,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: accent.color,
    opacity: 0.9,
    marginBottom: 8,
  };
}

function captionStyle(): CSSProperties {
  return {
    fontSize: 11,
    color: "rgba(148, 163, 184, 0.75)",
    marginTop: 10,
    lineHeight: 1.5,
  };
}

/* ------------------------------ node graph ------------------------------ */

function NodeGraph({ spec, viewState }: { spec: VisualSpec; viewState?: WorkspaceViewState }) {
  const accent = surfaceAccent(spec.kind);
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  const highlighted = new Set(viewState?.highlighted ?? []);
  const traced = new Set(viewState?.traced ?? []);
  const selected = new Set(viewState?.selected ?? []);

  return (
    <div style={canvas}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ width: "100%", height: "100%", minHeight: 280, transform: `translate(${viewState?.pan.x ?? 0}px, ${viewState?.pan.y ?? 0}px) scale(${viewState?.zoom ?? 1})`, transformOrigin: "center", transition: "transform 0.3s ease" }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", minHeight: 280, display: "block" }}
        >
          <defs>
            <filter id={`surface-glow-${spec.kind}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="0.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map((edge, index) => {
            const from = nodes.find((node) => node.id === edge.from);
            const to = nodes.find((node) => node.id === edge.to);
            if (!from || !to) {
              return null;
            }
            const x1 = from.x ?? 50;
            const y1 = from.y ?? 50;
            const x2 = to.x ?? 60;
            const y2 = to.y ?? 50;
            const mx = (x1 + x2) / 2;
            const isTraced = traced.has(from.id) && traced.has(to.id);
            return (
              <g key={`edge-${index}`}>
                <path
                  d={`M ${x1} ${y1} Q ${mx} ${Math.max(y1, y2) + 6}, ${x2} ${y2}`}
                  fill="none"
                  stroke={isTraced ? accent.color : "rgba(103, 232, 249, 0.28)"}
                  strokeWidth={isTraced ? 0.8 : 0.45}
                  strokeDasharray={isTraced ? "1.2 0.6" : edge.label ? "0" : "0.6 0.9"}
                >
                  {isTraced ? (
                    <animate attributeName="stroke-dashoffset" from="9" to="0" dur="0.8s" repeatCount="indefinite" />
                  ) : null}
                </path>
                {edge.label ? (
                  <text
                    x={mx}
                    y={(y1 + y2) / 2 - 1.5}
                    fill={isTraced ? accent.color : "rgba(148, 163, 184, 0.9)"}
                    fontSize={2.3}
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {nodes.map((node) => {
            const isHighlighted = highlighted.has(node.id);
            const isSelected = selected.has(node.id);
            const nodeColor = node.color ?? accent.color;
            return (
              <g key={node.id}>
                <circle
                  cx={node.x ?? 50}
                  cy={node.y ?? 50}
                  r={(node.id === "lelu" || node.kind === "core" ? 5.5 : 6.5) * (isHighlighted ? 1.35 : 1)}
                  fill={isHighlighted ? `${nodeColor}3d` : `${nodeColor}1f`}
                  stroke={isHighlighted || isSelected ? nodeColor : nodeColor}
                  strokeWidth={isHighlighted || isSelected ? 1.1 : 0.55}
                  filter={isHighlighted ? `url(#surface-glow-${spec.kind})` : undefined}
                >
                  {isHighlighted ? (
                    <animate attributeName="r" values={`${((node.id === "lelu" || node.kind === "core" ? 5.5 : 6.5) * 1.2).toFixed(2)};${((node.id === "lelu" || node.kind === "core" ? 5.5 : 6.5) * 1.4).toFixed(2)};${((node.id === "lelu" || node.kind === "core" ? 5.5 : 6.5) * 1.2).toFixed(2)}`} dur="1.6s" repeatCount="indefinite" />
                  ) : null}
                </circle>
                <text
                  x={node.x ?? 50}
                  y={(node.y ?? 50) + 12}
                  fill={isHighlighted ? "#ffffff" : "rgba(228, 244, 255, 0.95)"}
                  fontSize={isHighlighted || viewState?.expanded ? 2.9 : 2.5}
                  textAnchor="middle"
                  style={{ fontWeight: isHighlighted ? 700 : 600 }}
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {spec.caption ? <div style={captionStyle()}>{spec.caption}</div> : null}
    </div>
  );
}

/* ------------------------------ data surface ---------------------------- */

function Chart({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  const series = spec.series ?? [];
  const max = Math.max(1, ...series.map((point) => point.value));

  return (
    <div style={canvas}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: "72%", minHeight: 180, padding: "0 4px" }}>
        {series.map((point, index) => {
          const height = Math.max(3, (point.value / max) * 100);
          return (
            <div
              key={`point-${index}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 6 }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 56,
                  height: `${height}%`,
                  minHeight: 3,
                  borderRadius: "6px 6px 2px 2px",
                  background: `linear-gradient(180deg, ${point.color ?? accent.color}, ${point.color ?? accent.color}44)`,
                  boxShadow: `0 0 16px ${point.color ?? accent.color}33`,
                  transition: "height 0.5s ease",
                }}
              />
              <div style={{ fontSize: 10.5, color: "rgba(228, 244, 255, 0.9)", textAlign: "center", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {point.label}
              </div>
            </div>
          );
        })}
      </div>
      {spec.caption ? <div style={captionStyle()}>{spec.caption}</div> : null}
    </div>
  );
}

function Table({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  const columns = spec.columns ?? [];
  const rows = spec.rows ?? [];
  return (
    <div style={canvas}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      {rows.length === 0 ? (
        <div style={{ color: "rgba(148, 163, 184, 0.7)", fontSize: 12, padding: 12 }}>
          {spec.caption ?? "No data yet."}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "rgba(228, 244, 255, 0.92)" }}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ textAlign: "left", padding: "6px 10px", borderBottom: `1px solid ${accent.color}33`, color: accent.color, fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`row-${index}`}>
                {columns.map((column) => (
                  <td key={column.key} style={{ padding: "6px 10px", borderBottom: "1px solid rgba(148, 163, 184, 0.12)", verticalAlign: "top" }}>
                    {row[column.key] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > 0 && spec.caption ? <div style={captionStyle()}>{spec.caption}</div> : null}
    </div>
  );
}

/* ---------------------------- timeline surface --------------------------- */

const TIMELINE_COLORS: Record<string, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  error: "#f87171",
  running: "#38bdf8",
  idle: "#94a3b8",
};

function Timeline({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  const events = spec.timeline ?? [];
  return (
    <div style={canvas}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {events.map((event, index) => {
          const color = TIMELINE_COLORS[event.status ?? "idle"] ?? "#94a3b8";
          return (
            <div key={`event-${index}`} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
                <div style={{ width: 10, height: 10, borderRadius: 999, background: color, boxShadow: `0 0 10px ${color}66`, marginTop: 5 }} />
                {index < events.length - 1 ? <div style={{ width: 2, flex: 1, background: "rgba(148, 163, 184, 0.2)" }} /> : null}
              </div>
              <div style={{ paddingBottom: 13, flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, color, letterSpacing: "0.04em" }}>{event.time}</div>
                <div style={{ fontSize: 12.5, color: "rgba(228, 244, 255, 0.94)", marginTop: 2, wordBreak: "break-word" }}>{event.label}</div>
                {event.detail ? <div style={{ fontSize: 11, color: "rgba(148, 163, 184, 0.8)", marginTop: 2 }}>{event.detail}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {spec.caption ? <div style={captionStyle()}>{spec.caption}</div> : null}
    </div>
  );
}

/* ----------------------------- wireframe surface ------------------------- */

const BOX_COLORS: Record<string, string> = {
  nav: "#38bdf8",
  sidebar: "#a78bfa",
  header: "#67e8f9",
  panel: "#34d399",
  card: "#fbbf24",
  button: "#f472b6",
  title: "#94a3b8",
  text: "#94a3b8",
  chart: "#38bdf8",
  input: "#fbbf24",
  row: "#67e8f9",
  column: "#a78bfa",
};

function Wireframe({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  const boxes = spec.boxes ?? [];
  return (
    <div style={{ ...canvas, background: "radial-gradient(120% 90% at 50% 0%, rgba(244, 114, 182, 0.06), rgba(2, 6, 23, 0) 60%)" }}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 260 }}>
        {boxes.map((box) => {
          const color = BOX_COLORS[box.type] ?? "#94a3b8";
          return (
            <div
              key={box.id}
              style={{
                position: "absolute",
                left: `${box.x ?? 0}%`,
                top: `${box.y ?? 0}%`,
                width: `${box.w ?? 10}%`,
                height: `${box.h ?? 6}%`,
                border: `1px dashed ${color}88`,
                background: `${color}14`,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color,
                fontSize: 8.5,
                letterSpacing: "0.05em",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {box.label}
            </div>
          );
        })}
      </div>
      {spec.caption ? <div style={captionStyle()}>{spec.caption}</div> : null}
    </div>
  );
}

/* ------------------------------ code surface ----------------------------- */

function FileView({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  return (
    <div style={{ ...canvas, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", background: "radial-gradient(120% 90% at 50% 0%, rgba(52, 211, 153, 0.05), rgba(2, 6, 23, 0) 60%)" }}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: "rgba(203, 226, 244, 0.92)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {spec.text ?? spec.caption ?? ""}
      </pre>
    </div>
  );
}

/* ----------------------------- browser surface --------------------------- */

function BrowserView({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  return (
    <div style={{ ...canvas, padding: 8, display: "flex", flexDirection: "column" }}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", background: "white", minHeight: 200 }}>
        {spec.url ? (
          <iframe src={spec.url} title={spec.title} style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
        ) : (
          <div style={{ padding: 16, color: "#334155", fontSize: 13 }}>
            {spec.caption ?? "No page loaded."}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ media surfaces --------------------------- */

function toEmbedUrl(url: string): string | null {
  const watch = url.match(/youtube\.com\/watch\?v=([\w-]+)/);
  if (watch) {
    return `https://www.youtube-nocookie.com/embed/${watch[1]}`;
  }
  const short = url.match(/youtu\.be\/([\w-]+)/);
  if (short) {
    return `https://www.youtube-nocookie.com/embed/${short[1]}`;
  }
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) {
    return `https://player.vimeo.com/video/${vimeo[1]}`;
  }
  return null;
}

function VideoSurface({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  const embed = spec.url ? toEmbedUrl(spec.url) : null;
  return (
    <div style={{ ...canvas, padding: 8, display: "flex", flexDirection: "column", background: "radial-gradient(120% 90% at 50% 0%, rgba(244, 114, 182, 0.07), rgba(2, 6, 23, 0) 60%)" }}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", background: "rgba(2, 6, 23, 0.6)", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {embed ? (
          <iframe src={embed} title={spec.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
        ) : spec.url && /\.(mp4|webm|ogg|mov)/i.test(spec.url) ? (
          <video src={spec.url} controls style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <div style={{ padding: 16, color: "rgba(228, 244, 255, 0.75)", fontSize: 12.5, textAlign: "center", lineHeight: 1.6 }}>
            {spec.caption ?? "No video loaded — ask Lélu to find one and it will appear here."}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageSurface({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent(spec.kind);
  const source = spec.url ?? (spec.text?.startsWith("data:") ? spec.text : null);
  return (
    <div style={{ ...canvas, padding: 8, display: "flex", flexDirection: "column", background: "radial-gradient(120% 90% at 50% 0%, rgba(192, 132, 252, 0.07), rgba(2, 6, 23, 0) 60%)" }}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ flex: 1, borderRadius: 10, overflow: "hidden", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2, 6, 23, 0.4)" }}>
        {source ? (
          <img src={source} alt={spec.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }} />
        ) : (
          <div style={{ padding: 16, color: "rgba(228, 244, 255, 0.75)", fontSize: 12.5, textAlign: "center", lineHeight: 1.6 }}>
            {spec.caption ?? "No image loaded — attach one in chat or ask Lélu to find it."}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------- provider status surface --------------------- */

const STATUS_COLORS: Record<string, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  error: "#f87171",
  idle: "#94a3b8",
};

function ProvidersSurface({ spec }: { spec: VisualSpec }) {
  const accent = surfaceAccent("providers");
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  return (
    <div style={canvas}>
      <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {nodes.filter((node) => node.kind === "provider").map((node) => {
          const edge = edges.find((item) => item.to === node.id);
          const status = node.color ? Object.entries(STATUS_COLORS).find(([, value]) => value === node.color)?.[0] : "idle";
          return (
            <div
              key={node.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "rgba(8, 16, 38, 0.5)",
                border: `1px solid ${node.color ?? accent.color}44`,
                borderRadius: 10,
                padding: "8px 12px",
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: 999, background: node.color ?? accent.color, boxShadow: `0 0 10px ${node.color ?? accent.color}88`, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 12.5, color: "rgba(228, 244, 255, 0.94)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {node.label}
              </span>
              {edge?.label ? (
                <span style={{ fontSize: 10.5, color: "rgba(148, 163, 184, 0.85)", whiteSpace: "nowrap" }}>
                  {edge.label}
                </span>
              ) : null}
              <span style={{ fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: node.color ?? accent.color, flexShrink: 0 }}>
                {status === "ok" ? "operational" : status === "warn" ? "unverified" : status === "error" ? "cooldown" : "idle"}
              </span>
            </div>
          );
        })}
      </div>
      {spec.caption ? <div style={captionStyle()}>{spec.caption}</div> : null}
    </div>
  );
}

/* --------------------------------- main ---------------------------------- */

export interface WorkspaceVisualProps {
  spec: VisualSpec;
  viewState?: WorkspaceViewState;
}

export default memo(function WorkspaceVisual({ spec, viewState }: WorkspaceVisualProps) {
  switch (spec.kind) {
    case "diagram":
      return <NodeGraph spec={spec} viewState={viewState} />;
    case "chart":
      return <Chart spec={spec} />;
    case "table":
      return <Table spec={spec} />;
    case "timeline":
      return <Timeline spec={spec} />;
    case "wireframe":
    case "design":
      return <Wireframe spec={spec} />;
    case "file":
      return <FileView spec={spec} />;
    case "browser":
      return <BrowserView spec={spec} />;
    case "video":
      return <VideoSurface spec={spec} />;
    case "image":
      return <ImageSurface spec={spec} />;
    case "providers":
      return <ProvidersSurface spec={spec} />;
    default: {
      const accent = surfaceAccent(spec.kind);
      if (spec.nodes?.length) {
        return <NodeGraph spec={spec} viewState={viewState} />;
      }
      if (spec.series?.length) {
        return <Chart spec={spec} />;
      }
      if (spec.rows?.length) {
        return <Table spec={spec} />;
      }
      return (
        <div style={canvas}>
          <div style={eyebrow(accent)}>{accent.label} · {spec.title}</div>
          <div style={{ color: "rgba(148, 163, 184, 0.7)", fontSize: 12 }}>
            {spec.caption ?? spec.text ?? "No content yet."}
          </div>
        </div>
      );
    }
  }
});
