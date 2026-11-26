/**
 * ==========================================================
 * LÉLU — THE NEURAL MAP, STANDALONE (M17.2)
 *
 * The first independent Neural Map interface. It is registered in the
 * interface catalog ("neural-map"), so it is launched from the Infinite
 * Library, by deep link (?interface=neural-map&entity=…), by LÉLU's
 * interface.open tool, or as a region of a composition — and it reads
 * the SAME index as every embedded view. Operations it offers run the
 * existing tools; their results come back through the authorities.
 *
 *   left    find: text, type and authority filters, counts
 *   centre  the focused entity's neighbourhood, one ring per relation
 *           (follow any node; back walks the trail)
 *   right   the entity itself (EntityPanel, shared with the inspector)
 *
 * Deferred (not in this WP): other visual styles of the map — 3D, force
 * layouts, whole-graph overviews. This view is deliberately local:
 * the neighbourhood of one entity at a time.
 * ==========================================================
 */

import { useState, type CSSProperties } from "react";
import { neuralMap } from "../../../../core/neural/NeuralMap";
import { COSMOS_CORE_NID, RELATION_WORDS, type NeuralEntity, type NeuralRelationType } from "../../../../core/neural/NeuralMapTypes";
import { NeuralView } from "./neuralView";
import { useNeuralRelations, useNeuralVersion, useNeuralView } from "./useNeural";
import EntityPanel from "./EntityPanel";
import "./neural.css";
import "../cosmosLanguage/neuralLanguage.css";
import { neuralGeometry, neuralLinkPath } from "./neuralLanguage";
import { useCosmosLanguage } from "../cosmosLanguage/useCosmosLanguage";
import type { CompositionSpec } from "../../../../core/interface/CosmosLanguages";

const TYPE_COLOR: Record<NeuralEntity["type"], string> = {
  "cosmos-core": "#7dd3fc",
  galaxy: "#a78bfa",
  planet: "#818cf8",
  room: "#f0abfc",
  object: "#fbbf24",
  group: "#fcd34d",
  "placed-record": "#34d399",
  "room-object": "#c084fc",
  capability: "#94a3b8",
  interface: "#38bdf8",
  composition: "#60a5fa",
  record: "#64748b",
  conversation: "#f472b6",
  artifact: "#2dd4bf",
  project: "#fb923c",
  file: "#a3e635",
  folder: "#84cc16",
  app: "#e879f9",
};

const TYPES = Object.keys(TYPE_COLOR) as NeuralEntity["type"][];

const CAP: Record<string, number> = { list: 26, grid: 24, matrix: 24, vertical: 28, columns: 28, radar: 28, cluster: 28, ring: 28 };

/** One related entity, drawn in the composition's node language. */
function NodeMark({ kind, x, y, color, label }: { kind: string; x: number; y: number; color: string; label: string }) {
  switch (kind) {
    case "text":
      return <rect x={x - 5} y={y - 5} width={10} height={10} fill={color} />;
    case "square":
      return <rect x={x - 10} y={y - 10} width={20} height={20} fill={color} className="nm-mark" />;
    case "serif":
      return <circle cx={x} cy={y} r={6} fill="none" stroke={color} strokeWidth={1.5} className="nm-mark" />;
    case "block":
      return (
        <g className="nm-mark">
          <rect x={x - 11} y={y - 7} width={26} height={22} className="nm-block-shadow" />
          <rect x={x - 14} y={y - 10} width={26} height={22} fill={color} className="nm-block" />
        </g>
      );
    case "seal":
      return (
        <g className="nm-mark">
          <rect x={x - 11} y={y - 11} width={22} height={22} rx={3} className="nm-seal" />
          <text x={x} y={y + 4} textAnchor="middle" className="nm-seal-text">{label.slice(0, 1)}</text>
        </g>
      );
    case "reticle":
      return (
        <g className="nm-mark" stroke={color} fill="none">
          <circle cx={x} cy={y} r={9} strokeWidth={1.2} />
          <path d={`M${x - 14},${y} h8 M${x + 6},${y} h8 M${x},${y - 14} v8 M${x},${y + 6} v8`} strokeWidth={1.2} />
        </g>
      );
    case "lamp":
      return (
        <g className="nm-mark">
          <circle cx={x} cy={y} r={11} className="nm-lamp-bezel" />
          <circle cx={x} cy={y} r={7} fill={color} className="nm-lamp" />
        </g>
      );
    case "blob": {
      const d = `M${x - 12},${y} C${x - 12},${y - 10} ${x - 2},${y - 13} ${x + 6},${y - 10} C${x + 14},${y - 7} ${x + 13},${y + 6} ${x + 6},${y + 10} C${x - 2},${y + 14} ${x - 12},${y + 9} ${x - 12},${y}Z`;
      return <path d={d} fill={color} fillOpacity={0.8} className="nm-mark" />;
    }
    default:
      return <circle cx={x} cy={y} r={11} fill={color} fillOpacity={0.85} />;
  }
}

function Neighbourhood({ focus, composition }: { focus: string; composition: CompositionSpec }) {
  const relations = useNeuralRelations(focus);
  const entity = neuralMap().get(focus);
  const layout = composition.neural.layout;
  const visible = relations.filter((n) => n.relation.type !== "operated-by").slice(0, CAP[layout] ?? 28);
  const size = 520;
  const c = size / 2;
  const geo = neuralGeometry(layout, visible.length, size, visible.map((n) => n.direction));
  const nodeKind = composition.neural.node;
  const glass = composition.id === "glass";
  const focusColor = entity ? TYPE_COLOR[entity.type] : "#475569";
  return (
    <svg
      className="nm-graph"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Neighbourhood of ${entity?.label ?? focus}`}
      data-neural-graph={focus}
      data-neural-layout={layout}
      data-neural-node={nodeKind}
      data-neural-link={composition.neural.link}
    >
      {geo.guides.map((g, i) =>
        g.kind === "ring" ? (
          <circle key={i} cx={c} cy={c} r={g.r} className="nm-guide" fill="none" />
        ) : g.kind === "hline" ? (
          <line key={i} x1={0} x2={size} y1={g.y} y2={g.y} className="nm-guide" />
        ) : (
          <line key={i} x1={g.x} x2={g.x} y1={0} y2={size} className="nm-guide" />
        ),
      )}
      {visible.map((n, i) => {
        const { x, y } = geo.nodes[i];
        const other = n.direction === "out" ? n.relation.to : n.relation.from;
        const color = n.entity ? TYPE_COLOR[n.entity.type] : "#475569";
        const label = (n.entity?.label ?? other).slice(0, 22);
        const word = RELATION_WORDS[n.relation.type as NeuralRelationType][n.direction];
        const lx = geo.label === "right" ? x + 12 : geo.label === "left" ? x - 16 : x;
        const ly = geo.label === "below" ? y + 26 : y + 4;
        const anchor = geo.label === "right" ? "start" : geo.label === "left" ? "end" : "middle";
        return (
          <g key={n.relation.id} className="nm-node" data-to={other} onClick={() => NeuralView.focus(other)} style={{ cursor: "pointer" }}>
            {glass ? (
              <line x1={c} y1={c} x2={x} y2={y} stroke={color} strokeOpacity={0.45} strokeWidth={1.4} strokeDasharray={n.direction === "in" ? "4 4" : undefined} />
            ) : (
              <path
                d={neuralLinkPath(composition.neural.link, geo.focus, { x, y })}
                className="nm-link"
                data-direction={n.direction}
                stroke={color}
                fill="none"
                strokeDasharray={n.direction === "in" || composition.neural.link === "dashed" ? "4 4" : undefined}
              />
            )}
            {/* The ring keeps its mid-link words; denser layouts print the
                relation under the node instead, where it cannot collide. */}
            {glass ? (
              <text x={(geo.focus.x + x) / 2} y={(geo.focus.y + y) / 2 - 4} textAnchor="middle" className="nm-edge-label">
                {word}
              </text>
            ) : geo.label === "right" ? null : (
              <text x={lx} y={geo.label === "below" ? ly + 11 : ly + 12} textAnchor={anchor} className="nm-edge-label">
                {word}
              </text>
            )}
            <NodeMark kind={nodeKind} x={x} y={y} color={color} label={label} />
            <text x={lx} y={ly} textAnchor={anchor} className="nm-node-label">
              {geo.label === "right" ? `${word} · ${label}` : label}
            </text>
          </g>
        );
      })}
      {glass ? (
        <circle cx={c} cy={c} r={30} fill={focusColor} />
      ) : (
        <g className="nm-focus-mark" data-focus-kind={nodeKind}>
          {nodeKind === "text" || nodeKind === "square" || nodeKind === "block" || nodeKind === "seal" || nodeKind === "lamp" ? (
            <rect x={geo.focus.x - 18} y={geo.focus.y - 18} width={36} height={36} rx={nodeKind === "seal" ? 4 : nodeKind === "lamp" ? 18 : 0} fill={focusColor} className="nm-focus-shape" />
          ) : nodeKind === "reticle" ? (
            <g stroke={focusColor} fill="none" className="nm-focus-shape">
              <circle cx={geo.focus.x} cy={geo.focus.y} r={24} strokeWidth={2} />
              <circle cx={geo.focus.x} cy={geo.focus.y} r={6} fill={focusColor} />
            </g>
          ) : (
            <circle cx={geo.focus.x} cy={geo.focus.y} r={nodeKind === "serif" ? 22 : 28} fill={focusColor} className="nm-focus-shape" />
          )}
        </g>
      )}
      <text
        x={glass ? c : geo.label === "right" ? geo.focus.x + 26 : geo.focus.x}
        y={glass ? c + 50 : geo.label === "right" ? geo.focus.y + 5 : geo.focus.y + 40}
        textAnchor={glass ? "middle" : geo.label === "right" ? "start" : geo.label === "left" ? "end" : "middle"}
        className="nm-node-label nm-focus-label"
      >
        {entity?.label ?? focus}
      </text>
      {relations.length > visible.length ? (
        <text x={c} y={size - 8} textAnchor="middle" className="nm-edge-label">
          +{relations.length - visible.length} more (incl. operations) in the panel
        </text>
      ) : null}
    </svg>
  );
}

/** The map's own name, as each composition would print it. */
function mapTitle(composition: string, focusLabel: string): string {
  switch (composition) {
    case "console":
      return `neural-map --focus "${focusLabel}"`;
    case "grid":
      return "Neural Map — Index";
    case "editorial":
      return "The Neural Map: An Atlas";
    case "slab":
      return "NEURAL MAP!";
    case "scroll":
      return "神経 · Neural Map";
    case "hud":
      return "NEURAL MAP // SCAN";
    case "bezel":
      return "NEURAL MAP · CONSOLE 1";
    case "organic":
      return "The Neural Garden";
    default:
      return "Neural Map";
  }
}

export default function NeuralMapView({ embedded = false }: { embedded?: boolean }) {
  const view = useNeuralView();
  const version = useNeuralVersion();
  // The active layout's language: the map is laid out and drawn in it.
  const cosmos = useCosmosLanguage();
  const [text, setText] = useState("");
  const [type, setType] = useState<NeuralEntity["type"] | "">("");
  const map = neuralMap();
  const focus = view.standalone.focus ?? COSMOS_CORE_NID;
  // The index is mutable and cheap to read; useNeuralVersion() re-renders on
  // every update, so these are simply read on render.
  void version;
  const stats = map.stats();
  const entityLabel = map.get(focus)?.label ?? focus;
  const last = map.updateStats().at(-1);
  const hits = map.search({ text: text || undefined, types: type ? [type] : undefined, limit: 200 }).filter((e) => type || e.authority !== "referenced");

  const style: CSSProperties | undefined = embedded ? { position: "absolute", inset: 0 } : undefined;
  return (
    <div className="nm-standalone" data-neural-map-view data-embedded={embedded ? "true" : "false"} data-layer={view.standalone.layer ?? "base"} data-from={view.standalone.from ?? ""} data-cl-neural={cosmos.composition.id} style={style} role="region" aria-label="Neural Map">
      <header className="nm-top">
        <strong data-cl-map-title>{mapTitle(cosmos.composition.id, entityLabel)}</strong>
        <small data-neural-stats>
          {stats.entities} entities · {stats.relations} relations · {Object.keys(stats.byAuthority).length} authorities
          {last ? ` · last update ${last.authority} ${last.ms} ms` : ""}
        </small>
        <span className="nm-top-actions">
          <button type="button" disabled={view.standalone.history.length === 0} onClick={() => NeuralView.back()} aria-label="Back to the previous entity">
            ← Back
          </button>
          <button type="button" onClick={() => NeuralView.focus(COSMOS_CORE_NID)}>
            Cosmos core
          </button>
          {embedded ? null : (
            <button type="button" data-close-neural-map onClick={() => NeuralView.closeStandalone()} aria-label="Close the Neural Map and return">
              ✕ Return
            </button>
          )}
        </span>
      </header>
      <div className="nm-body">
        <aside className="nm-find">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find anything in the map" aria-label="Find in the Neural Map" />
          <select value={type} onChange={(e) => setType(e.target.value as NeuralEntity["type"] | "")} aria-label="Filter by type">
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <ul className="nm-hits" data-neural-hits={hits.length}>
            {hits.map((e) => (
              <li key={e.id}>
                <button type="button" data-hit={e.id} data-on={e.id === focus ? "true" : "false"} onClick={() => NeuralView.focus(e.id)}>
                  <i style={{ background: TYPE_COLOR[e.type] }} />
                  <span>{e.label}</span>
                  <small>
                    {e.type}
                    {e.state !== "active" ? ` · ${e.state}` : ""}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <main className="nm-centre">
          <Neighbourhood focus={focus} composition={cosmos.composition} />
        </main>
        <section className="nm-side">
          <EntityPanel id={focus} onFollow={(id) => NeuralView.focus(id)} />
        </section>
      </div>
    </div>
  );
}
