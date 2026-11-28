/**
 * A Neural Map inside a conversation thread (Mission 44.9).
 *
 * The SAME live aspects the standalone map reads (liveAspectGraph), drawn
 * either in 2D (a shared layout, SVG with pan + zoom) or in genuine WebGL 3D
 * (the existing Architecture3DView: orbit, zoom, pan). Aspect, view,
 * highlighted nodes and the selected node live on the thread object, so the
 * map reopens exactly as it was left and LÉLU can read what is selected.
 *
 * When the object is collapsed or scrolled out of view its WebGL context is
 * released (the canvas unmounts); its state stays on the object.
 */

import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { liveAspectGraph } from "../../../../../core/neural/multiverse/liveAspects";
import { LAYOUTS, layout as runLayout, type LayoutId } from "../../../../../core/neural/multiverse/Layouts";
import { ARCH_VIEWS, GENERIC_3D_VIEWS, type ArchViewId } from "../../../../../core/neural/multiverse/Architecture3D";
import { ASPECTS, type AspectId, type MvNode } from "../../../../../core/neural/multiverse/MultiverseTypes";
import AgentStore from "../../../../../core/agents/AgentStore";
import { update, type ThreadObject } from "../../../../../core/thread/ThreadObjects";

/** True inside the Freestyle variant: maps draw with no backdrop of their own. */
export const FreeformMaps = createContext(false);

const Architecture3DView = lazy(() => import("../../neural/Architecture3DView"));
const PALETTE = ["#7dd3fc", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#fb923c", "#60a5fa", "#e879f9", "#a3e635", "#f87171", "#2dd4bf", "#c084fc", "#facc15", "#94a3b8"];

function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, visible];
}

export function viewsFor(aspect: AspectId, dim: "2d" | "3d"): Array<{ id: string; label: string }> {
  if (dim === "2d") return LAYOUTS.map((l) => ({ id: l.id, label: l.label }));
  return aspect === "v2" ? [...ARCH_VIEWS, ...GENERIC_3D_VIEWS] : GENERIC_3D_VIEWS;
}

export default function ThreadMap({ object, compact }: { object: ThreadObject; compact: boolean }) {
  const map = object.map!;
  const [agents, setAgents] = useState(() => AgentStore.getInstance().list());
  useEffect(() => AgentStore.getInstance().subscribe(setAgents), []);
  const graph = useMemo(() => liveAspectGraph(map.aspect, agents), [map.aspect, agents]);
  const groups = useMemo(() => [...new Set(graph.nodes.map((n) => n.group))].sort(), [graph]);
  const colour = useMemo(() => new Map(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]])), [groups]);
  const highlight = useMemo(() => new Set(map.highlight), [map.highlight]);
  const selected = graph.nodes.find((n) => n.id === map.selected) ?? null;
  const [ref, visible] = useVisible<HTMLDivElement>();
  const set = (patch: Partial<typeof map>) => update(object.id, { map: { ...map, ...patch } });
  const views = viewsFor(map.aspect, map.dim);
  const freeform = useContext(FreeformMaps);

  return (
    <div className="tm" ref={ref} data-thread-map={map.aspect} data-map-dim={map.dim} data-map-view={map.view} data-map-nodes={graph.nodes.length} data-map-highlight={map.highlight.length} data-map-selected={map.selected ?? ""}>
      <div className="tm-bar">
        {(Object.keys(ASPECTS) as AspectId[]).map((a) => (
          <button key={a} type="button" data-on={map.aspect === a ? "true" : "false"} title={ASPECTS[a].title} onClick={() => set({ aspect: a, view: map.dim === "3d" ? (a === "v2" ? "connectome-tractography" : "galaxy-3d") : map.view, highlight: [], selected: null })}>
            {ASPECTS[a].label}
          </button>
        ))}
        <button type="button" data-dim-toggle onClick={() => set(map.dim === "2d" ? { dim: "3d", view: map.aspect === "v2" ? "connectome-tractography" : "galaxy-3d" } : { dim: "2d", view: "force-directed" })}>
          {map.dim === "2d" ? "3D" : "2D"}
        </button>
        <select value={map.view} onChange={(e) => set({ view: e.target.value })} aria-label="Map view">
          {views.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      <div className="tm-body">
        {map.dim === "3d" ? (
          visible && !object.style.collapsed ? (
            <Suspense fallback={<p className="tm-hint">Loading 3D…</p>}>
              <Architecture3DView key={freeform ? "free" : "framed"} graph={graph} view={map.view as ArchViewId} selected={map.selected} onSelect={(id) => set({ selected: id })} colour={colour} motion={!map.selected} highlight={highlight} compact transparent={freeform} />
            </Suspense>
          ) : (
            <p className="tm-hint" data-webgl-released>3D paused while out of view (its WebGL context is released).</p>
          )
        ) : (
          <Map2D graph={graph} layoutId={map.view as LayoutId} colour={colour} highlight={highlight} selected={map.selected} onSelect={(id) => set({ selected: id })} />
        )}
        {selected && !compact ? <NodeCard node={selected} graph={graph} onClose={() => set({ selected: null })} /> : null}
      </div>
    </div>
  );
}

function Map2D({ graph, layoutId, colour, highlight, selected, onSelect }: { graph: ReturnType<typeof liveAspectGraph>; layoutId: LayoutId; colour: Map<string, string>; highlight: Set<string>; selected: string | null; onSelect: (id: string | null) => void }) {
  const id = LAYOUTS.some((l) => l.id === layoutId) ? layoutId : "force-directed";
  const placed = useMemo(() => runLayout(id, graph, 1000), [id, graph]);
  // Fit the view to the nodes actually placed (layouts may use only part of the box).
  const fit = useMemo(() => {
    const ps = Object.values(placed.positions);
    if (!ps.length) return { x: 0, y: 0, s: 1000 };
    const xs = ps.map((p) => p.x);
    const ys = ps.map((p) => p.y);
    const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + 40, minY = Math.min(...ys) - 50, maxY = Math.max(...ys) + 30;
    return { x: minX, y: minY, s: Math.max(maxX - minX, maxY - minY, 120) };
  }, [placed]);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  // Labels and nodes keep an on-screen size whatever the map's scale or the pane's size.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [px, setPx] = useState(400);
  useEffect(() => {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;
    // Watch the HTML container and read the svg's real CSS box: a ResizeObserver on an <svg> reports its
    // drawing's geometry, not its box on the page, so labels were sized for the wrong pane (measured:
    // 214×88 px pane, labels sized for ~335 px; giant labels in a large pane).
    const measure = () => {
      const next = Math.max(60, Math.min(svg.clientWidth, svg.clientHeight) || 400);
      setPx((cur) => (Math.abs(cur - next) > 1 ? next : cur));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    // And a cheap check (two reads, every 400 ms): a pane that grows by an ancestor's layout change was not
    // always reported (measured: grew 214×88 → 751×422, labels stayed sized for the small pane).
    const tick = window.setInterval(measure, 400);
    measure();
    return () => {
      ro.disconnect();
      window.clearInterval(tick);
    };
  }, []);
  const unit = fit.s / view.k / px; // viewBox units per screen pixel
  const focus = selected ?? null;
  const near = new Set(focus ? graph.edges.flatMap((e) => (e.from === focus ? [e.to] : e.to === focus ? [e.from] : [])) : []);
  return (
    <svg
      ref={svgRef}
      className="tm-svg"
      viewBox={`${fit.x - view.x} ${fit.y - view.y} ${fit.s / view.k} ${fit.s / view.k}`}
      style={{ ["--ls" as string]: `${unit * 12}px` }}
      onWheel={(e) => setView((v) => ({ ...v, k: Math.min(6, Math.max(0.5, v.k * (e.deltaY < 0 ? 1.15 : 0.87))) }))}
      onPointerDown={(e) => {
        if ((e.target as Element).closest("[data-tm-node]")) return;
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x) * (fit.s / 400 / v.k), y: d.vy + (e.clientY - d.y) * (fit.s / 400 / v.k) }));
      }}
      onPointerUp={() => (drag.current = null)}
      data-pan-zoom={`${Math.round(view.x)},${Math.round(view.y)},${view.k.toFixed(2)}`}
    >
      {graph.edges.map((e) => {
        const a = placed.positions[e.from];
        const b = placed.positions[e.to];
        if (!a || !b) return null;
        const lit = focus && (e.from === focus || e.to === focus);
        return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lit ? "#fde68a" : "#94a3b8"} strokeOpacity={lit ? 0.9 : 0.3} strokeWidth={unit * (lit ? 2 : 1)} />;
      })}
      {graph.nodes.map((n) => {
        const p = placed.positions[n.id];
        if (!p) return null;
        const hl = highlight.has(n.id);
        const on = n.id === focus;
        const r = unit * (4 + Math.min(6, Math.log2(1 + (n.weight ?? 0)) * 0.7));
        return (
          <g key={n.id} data-tm-node={n.id} data-highlighted={hl ? "true" : "false"} onClick={() => onSelect(on ? null : n.id)} style={{ cursor: "pointer" }}>
            {hl ? <circle cx={p.x} cy={p.y} r={r * 1.9} fill="none" stroke="#fbbf24" strokeWidth={r / 3} className="tm-pulse" /> : null}
            <circle cx={p.x} cy={p.y} r={r} fill={colour.get(n.group)} fillOpacity={focus && !on && !near.has(n.id) && !hl ? 0.3 : 0.95} stroke={on ? "#fff" : "none"} strokeWidth={2} />
            {hl || on || n.kind === "function" || n.kind === "executive" ? (
              <text x={p.x} y={p.y - r - 5} textAnchor="middle" className="tm-label" style={{ fontSize: unit * 12, strokeWidth: unit * 4 }}>
                {n.label.slice(0, 26)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function NodeCard({ node, graph, onClose }: { node: MvNode; graph: ReturnType<typeof liveAspectGraph>; onClose: () => void }) {
  const rel = graph.edges.filter((e) => e.from === node.id || e.to === node.id);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <aside className="tm-card" data-tm-card={node.id}>
      <header>
        <b>{node.label}</b>
        <button type="button" aria-label="Close details" onClick={onClose}>
          ✕
        </button>
      </header>
      <small>
        {node.kind} · {node.evidence} · {node.source.authority}
      </small>
      <dl>
        {Object.entries(node.facts)
          .slice(0, 6)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{String(v)}</dd>
            </div>
          ))}
      </dl>
      <small>
        {rel.length} relations: {rel.slice(0, 5).map((e) => `${e.kind} ${byId.get(e.from === node.id ? e.to : e.from)?.label ?? "?"}`).join(" · ")}
      </small>
    </aside>
  );
}
