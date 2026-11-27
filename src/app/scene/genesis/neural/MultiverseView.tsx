/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP MULTIVERSE (one map, three aspects)
 *
 * Draws a whole aspect (V1 index · V2 cognitive architecture · V3 agent
 * society) in any of the twelve shared layouts. The graph comes from
 * the aspect derivations (core/neural/multiverse/Aspects), which read
 * the authorities; this file only lays it out, draws it and lets the
 * user select, filter and save views.
 *
 * Evidence is visible: inferred edges are dashed, classified ones dotted,
 * and every node's panel says where it came from and what is unknown.
 * ==========================================================
 */

import { useEffect, useMemo, useState } from "react";
import { neuralMap } from "../../../../core/neural/NeuralMap";
import { v1Graph, v2Graph, v3Graph } from "../../../../core/neural/multiverse/Aspects";
import { LAYOUTS, layout as runLayout, type LayoutResult } from "../../../../core/neural/multiverse/Layouts";
import type { AspectId, MvGraph, MvNode } from "../../../../core/neural/multiverse/MultiverseTypes";
import { savedViews, type ViewSettings } from "../../../../core/neural/multiverse/SavedViews";
import AgentStore from "../../../../core/agents/AgentStore";
import { EXECUTIVES } from "../../../../core/executive/ExecutiveBoard";
import type { LeluAgent } from "../../../../core/agents/AgentTypes";
import { NeuralView } from "./neuralView";
import { useNeuralVersion } from "./useNeural";

const PALETTE = ["#7dd3fc", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#fb923c", "#60a5fa", "#e879f9", "#a3e635", "#f87171", "#2dd4bf", "#c084fc", "#facc15", "#94a3b8"];
const THEMES: Record<ViewSettings["theme"], { bg: string; ink: string; guide: string }> = {
  cosmos: { bg: "radial-gradient(circle at 50% 45%, #111640 0%, #05060f 75%)", ink: "#e2e8f0", guide: "rgba(148,163,184,0.18)" },
  paper: { bg: "#f6f1e7", ink: "#1f2937", guide: "rgba(31,41,55,0.15)" },
  infrared: { bg: "radial-gradient(circle at 50% 45%, #2a0a12 0%, #090205 75%)", ink: "#fde2e4", guide: "rgba(251,113,133,0.2)" },
};

function useAgents(): LeluAgent[] {
  const [agents, setAgents] = useState<LeluAgent[]>(() => AgentStore.getInstance().list());
  useEffect(() => AgentStore.getInstance().subscribe((list) => setAgents(list)), []);
  return agents;
}

function aspectGraph(aspect: AspectId, agents: LeluAgent[]): MvGraph {
  if (aspect === "v2") return v2Graph();
  if (aspect === "v3") return v3Graph(EXECUTIVES, agents);
  return v1Graph(neuralMap());
}

function edgePath(kind: LayoutResult["edges"], a: { x: number; y: number }, b: { x: number; y: number }, c: number): string {
  if (kind === "chord") return `M${a.x},${a.y} Q${c},${c} ${b.x},${b.y}`;
  if (kind === "curve") {
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15;
    const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
    return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  }
  return `M${a.x},${a.y} L${b.x},${b.y}`;
}

function NodeDetail({ node, graph, onSelect }: { node: MvNode; graph: MvGraph; onSelect: (id: string) => void }) {
  const links = graph.edges.filter((e) => e.from === node.id || e.to === node.id);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (
    <div className="mv-detail" data-mv-detail={node.id}>
      <h3>{node.label}</h3>
      <p className="mv-kind">
        {node.kind} · <span data-evidence={node.evidence}>{node.evidence}</span> · {node.source.authority}
      </p>
      <dl>
        {Object.entries(node.facts).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>
      <h4>{links.length} relations</h4>
      <ul>
        {links.slice(0, 60).map((e) => {
          const other = e.from === node.id ? e.to : e.from;
          return (
            <li key={e.id}>
              <button type="button" onClick={() => onSelect(other)}>
                {e.from === node.id ? e.kind : `← ${e.kind}`} · {byId.get(other)?.label ?? other}
                {e.weight ? ` ×${e.weight}` : ""} <small>({e.evidence})</small>
              </button>
            </li>
          );
        })}
      </ul>
      {graph.aspect === "v1" ? (
        <button type="button" className="mv-open" onClick={() => NeuralView.focus(node.id)}>
          Open its neighbourhood
        </button>
      ) : null}
    </div>
  );
}

export default function MultiverseView({ settings, onChange }: { settings: ViewSettings; onChange: (patch: Partial<ViewSettings>) => void }) {
  const version = useNeuralVersion();
  const agents = useAgents();
  const [views, setViews] = useState(() => savedViews().list());
  useEffect(() => savedViews().subscribe(setViews), []);
  const [name, setName] = useState("");

  const graph = useMemo(() => {
    void version; // V1 re-derives when the index changes
    const g = aspectGraph(settings.aspect, agents);
    const q = settings.query.trim().toLowerCase();
    const hidden = new Set(settings.hiddenGroups);
    const nodes = g.nodes.filter((n) => !hidden.has(n.group) && (!q || n.label.toLowerCase().includes(q) || n.kind.includes(q)));
    const ids = new Set(nodes.map((n) => n.id));
    return { ...g, nodes, edges: g.edges.filter((e) => ids.has(e.from) && ids.has(e.to)), allGroups: [...new Set(g.nodes.map((n) => n.group))].sort() };
  }, [settings.aspect, settings.query, settings.hiddenGroups, agents, version]);

  const layoutId = settings.layout === "neighbourhood" ? "core-orbit" : settings.layout;
  const placed = useMemo(() => runLayout(layoutId, graph, 1000), [layoutId, graph]);
  const colour = useMemo(() => new Map(graph.allGroups.map((g, i) => [g, PALETTE[i % PALETTE.length]])), [graph.allGroups]);
  const selected = graph.nodes.find((n) => n.id === settings.focus) ?? null;
  const theme = THEMES[settings.theme];
  const canvasW = layoutId === "infinite-canvas" ? Math.max(1000, 40 + graph.allGroups.length * 180) : 1000;
  const canvasH = layoutId === "infinite-canvas" ? Math.max(1000, 120 + Math.max(0, ...placed.guides.map((g) => (g.kind === "box" ? g.h : 0)))) : 1000;
  const order = [...graph.nodes].sort((a, b) => (placed.positions[a.id]?.z ?? 0) - (placed.positions[b.id]?.z ?? 0));
  const zs = graph.nodes.map((n) => placed.positions[n.id]?.z ?? 0);
  const zMin = Math.min(0, ...zs);
  const zMax = Math.max(0, ...zs);
  const neighbours = new Set(selected ? graph.edges.flatMap((e) => (e.from === selected.id ? [e.to] : e.to === selected.id ? [e.from] : [])) : []);

  return (
    <div className="mv" data-mv-aspect={settings.aspect} data-mv-layout={layoutId} data-mv-theme={settings.theme} data-mv-nodes={graph.nodes.length} data-mv-edges={graph.edges.length}>
      <aside className="mv-controls" aria-label="Layout and view controls">
        <label>
          Layout
          <select value={layoutId} onChange={(e) => onChange({ layout: e.target.value as ViewSettings["layout"] })} aria-label="Shared layout">
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <small className="mv-blurb">{LAYOUTS.find((l) => l.id === layoutId)?.blurb}</small>
        <input value={settings.query} onChange={(e) => onChange({ query: e.target.value })} placeholder="Filter nodes" aria-label="Filter nodes" />
        <label>
          Labels
          <select value={settings.labels} onChange={(e) => onChange({ labels: e.target.value as ViewSettings["labels"] })}>
            <option value="focus">Selection</option>
            <option value="all">All</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>
          Theme
          <select value={settings.theme} onChange={(e) => onChange({ theme: e.target.value as ViewSettings["theme"] })}>
            <option value="cosmos">Cosmos</option>
            <option value="paper">Paper</option>
            <option value="infrared">Infrared</option>
          </select>
        </label>
        <label>
          Node scale
          <input type="range" min={0.5} max={2} step={0.1} value={settings.density} onChange={(e) => onChange({ density: Number(e.target.value) })} />
        </label>
        <fieldset className="mv-groups">
          <legend>Groups</legend>
          {graph.allGroups.map((g) => (
            <label key={g}>
              <input
                type="checkbox"
                checked={!settings.hiddenGroups.includes(g)}
                onChange={(e) => onChange({ hiddenGroups: e.target.checked ? settings.hiddenGroups.filter((x) => x !== g) : [...settings.hiddenGroups, g] })}
              />
              <i style={{ background: colour.get(g) }} /> {g}
            </label>
          ))}
        </fieldset>
        <fieldset className="mv-views">
          <legend>Saved views</legend>
          <span className="mv-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="Name this view" />
            <button type="button" data-mv-save onClick={() => (savedViews().save(name, settings), setName(""))}>
              Save
            </button>
          </span>
          <ul>
            {views.map((v) => (
              <li key={v.id} data-mv-view={v.id}>
                <button type="button" title="Restore" onClick={() => onChange(savedViews().restore(v.id) ?? {})}>
                  {v.favorite ? "★ " : ""}
                  {v.name}
                </button>
                <button type="button" aria-label="Favourite" onClick={() => savedViews().toggleFavorite(v.id)}>
                  ☆
                </button>
                <button type="button" aria-label="Duplicate" onClick={() => savedViews().duplicate(v.id)}>
                  ⧉
                </button>
                <button
                  type="button"
                  aria-label="Rename"
                  onClick={() => {
                    const n = typeof window !== "undefined" ? window.prompt("Rename view", v.name) : null;
                    if (n) savedViews().rename(v.id, n);
                  }}
                >
                  ✎
                </button>
                <button type="button" aria-label="Delete" onClick={() => savedViews().remove(v.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
        {graph.gaps.length ? (
          <div className="mv-gaps" data-mv-gaps>
            <strong>Not shown</strong>
            <ul>
              {graph.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
      <main className="mv-stage" style={{ background: theme.bg, color: theme.ink }}>
        <svg viewBox={`0 0 ${canvasW} ${canvasH}`} className="mv-svg" role="img" aria-label={`${settings.aspect.toUpperCase()} in ${layoutId}`} data-motion={settings.motion ? "on" : "off"}>
          {placed.guides.map((g, i) =>
            g.kind === "ring" ? (
              <g key={i}>
                <circle cx={g.cx} cy={g.cy} r={g.r} fill="none" stroke={theme.guide} />
                {g.label ? (
                  <text x={g.cx} y={g.cy - g.r - 6} textAnchor="middle" className="mv-guide-label" fill={theme.ink}>
                    {g.label}
                  </text>
                ) : null}
              </g>
            ) : g.kind === "box" ? (
              <g key={i}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={10} fill="none" stroke={theme.guide} />
                <text x={g.x + 10} y={g.y + 22} className="mv-guide-label" fill={theme.ink}>
                  {g.label}
                </text>
              </g>
            ) : g.kind === "hline" ? (
              <g key={i}>
                <line x1={0} x2={canvasW} y1={g.y} y2={g.y} stroke={theme.guide} />
                <text x={8} y={g.y - 6} className="mv-guide-label" fill={theme.ink}>
                  {g.label}
                </text>
              </g>
            ) : (
              <line key={i} x1={g.x} x2={g.x} y1={0} y2={canvasH} stroke={theme.guide} />
            ),
          )}
          <g className="mv-edges">
            {graph.edges.map((e) => {
              const a = placed.positions[e.from];
              const b = placed.positions[e.to];
              if (!a || !b) return null;
              const lit = selected && (e.from === selected.id || e.to === selected.id);
              return (
                <path
                  key={e.id}
                  d={edgePath(placed.edges, a, b, 500)}
                  fill="none"
                  stroke={lit ? "#fde68a" : colour.get(graph.nodes.find((n) => n.id === e.from)?.group ?? "") ?? theme.guide}
                  strokeOpacity={selected ? (lit ? 0.9 : 0.06) : 0.28}
                  strokeWidth={Math.min(4, 0.6 + Math.log2(1 + (e.weight ?? 1)) * 0.6)}
                  strokeDasharray={e.evidence === "inferred" ? "5 4" : e.evidence === "classified" ? "1 4" : undefined}
                  data-evidence={e.evidence}
                />
              );
            })}
          </g>
          <g className="mv-nodes">
            {order.map((n) => {
              const p = placed.positions[n.id];
              if (!p) return null;
              const depth = zMax > zMin ? (p.z - zMin) / (zMax - zMin) : 1;
              const r = (4 + Math.min(12, Math.log2(1 + (n.weight ?? 0)) * 1.2)) * settings.density * (layoutId === "holographic-spatial" ? 0.6 + depth * 0.6 : 1);
              const on = selected?.id === n.id;
              const near = neighbours.has(n.id);
              const showLabel = settings.labels === "all" || (settings.labels === "focus" && (on || near || n.kind === "function" || n.kind === "executive"));
              return (
                <g key={n.id} className="mv-node" data-mv-node={n.id} data-on={on ? "true" : "false"} onClick={() => onChange({ focus: on ? null : n.id })} style={{ cursor: "pointer" }}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={r}
                    fill={colour.get(n.group)}
                    fillOpacity={selected && !on && !near ? 0.25 : layoutId === "holographic-spatial" ? 0.35 + depth * 0.6 : 0.9}
                    stroke={on ? "#fde68a" : n.evidence === "classified" ? theme.ink : "none"}
                    strokeWidth={on ? 3 : 1}
                    strokeDasharray={n.evidence === "classified" ? "2 2" : undefined}
                  />
                  {showLabel && settings.labels !== "none" ? (
                    <text x={p.x} y={p.y - r - 4} textAnchor="middle" className="mv-label" fill={theme.ink}>
                      {n.label.slice(0, 28)}
                    </text>
                  ) : null}
                  <title>
                    {n.label} — {n.kind} ({n.evidence})
                  </title>
                </g>
              );
            })}
          </g>
        </svg>
        <p className="mv-legend">
          {graph.nodes.length} nodes · {graph.edges.length} relations · solid = declared/measured · dashed = inferred · dotted = classified
        </p>
      </main>
      <section className="mv-side">
        {selected ? <NodeDetail node={selected} graph={graph} onSelect={(id) => onChange({ focus: id })} /> : <p className="mv-hint">Select a node to inspect it, its evidence and its relations.</p>}
      </section>
    </div>
  );
}
