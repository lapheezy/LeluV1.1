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

function Neighbourhood({ focus }: { focus: string }) {
  const relations = useNeuralRelations(focus);
  const entity = neuralMap().get(focus);
  const visible = relations.filter((n) => n.relation.type !== "operated-by").slice(0, 28);
  const size = 520;
  const c = size / 2;
  const r = 190;
  return (
    <svg className="nm-graph" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Neighbourhood of ${entity?.label ?? focus}`} data-neural-graph={focus}>
      {visible.map((n, i) => {
        const a = (i / Math.max(1, visible.length)) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        const other = n.direction === "out" ? n.relation.to : n.relation.from;
        const color = n.entity ? TYPE_COLOR[n.entity.type] : "#475569";
        return (
          <g key={n.relation.id} className="nm-node" data-to={other} onClick={() => NeuralView.focus(other)} style={{ cursor: "pointer" }}>
            <line x1={c} y1={c} x2={x} y2={y} stroke={color} strokeOpacity={0.45} strokeWidth={1.4} strokeDasharray={n.direction === "in" ? "4 4" : undefined} />
            <text x={(c + x) / 2} y={(c + y) / 2 - 4} textAnchor="middle" className="nm-edge-label">
              {RELATION_WORDS[n.relation.type as NeuralRelationType][n.direction]}
            </text>
            <circle cx={x} cy={y} r={11} fill={color} fillOpacity={0.85} />
            <text x={x} y={y + 26} textAnchor="middle" className="nm-node-label">
              {(n.entity?.label ?? other).slice(0, 22)}
            </text>
          </g>
        );
      })}
      <circle cx={c} cy={c} r={30} fill={entity ? TYPE_COLOR[entity.type] : "#475569"} />
      <text x={c} y={c + 50} textAnchor="middle" className="nm-node-label nm-focus-label">
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

export default function NeuralMapView({ embedded = false }: { embedded?: boolean }) {
  const view = useNeuralView();
  const version = useNeuralVersion();
  const [text, setText] = useState("");
  const [type, setType] = useState<NeuralEntity["type"] | "">("");
  const map = neuralMap();
  const focus = view.standalone.focus ?? COSMOS_CORE_NID;
  // The index is mutable and cheap to read; useNeuralVersion() re-renders on
  // every update, so these are simply read on render.
  void version;
  const stats = map.stats();
  const last = map.updateStats().at(-1);
  const hits = map.search({ text: text || undefined, types: type ? [type] : undefined, limit: 200 }).filter((e) => type || e.authority !== "referenced");

  const style: CSSProperties | undefined = embedded ? { position: "absolute", inset: 0 } : undefined;
  return (
    <div className="nm-standalone" data-neural-map-view data-embedded={embedded ? "true" : "false"} data-layer={view.standalone.layer ?? "base"} data-from={view.standalone.from ?? ""} style={style} role="region" aria-label="Neural Map">
      <header className="nm-top">
        <strong>Neural Map</strong>
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
          <Neighbourhood focus={focus} />
        </main>
        <section className="nm-side">
          <EntityPanel id={focus} onFollow={(id) => NeuralView.focus(id)} />
        </section>
      </div>
    </div>
  );
}
