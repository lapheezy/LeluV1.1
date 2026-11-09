/**
 * LÉLU — an Atelier project as a Cosmos window (`atelier:<id>`).
 *
 * The directions side by side (identity, architecture, evidence level,
 * cost, mass, complexity, safety review), each with its orthographic
 * drawing; the chosen one in detail with its 3D model (the exported
 * glTF), exploded view, BOM and its verified files. Every image here is
 * a file the Atelier wrote and read back.
 */

import { lazy, Suspense, useMemo, useState, useSyncExternalStore, useCallback } from "react";
import { Check, Download, ShieldAlert, TriangleAlert } from "lucide-react";
import GenesisWindowFrame from "../GenesisWindowFrame";
import AtelierStore, { assess } from "../../../../core/atelier/AtelierStore";
import { writeAtelierFile, type AtelierFormat } from "../../../../core/atelier/AtelierFiles";
import type { AtelierProject, DesignDirection } from "../../../../core/atelier/AtelierTypes";
import { downloadBytes, formatBytes } from "../studio/useStudio";
import "./atelier.css";

const AtelierModelView = lazy(() => import("./AtelierModelView"));

export function useAtelierStore(): AtelierStore {
  const store = AtelierStore.getInstance();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snap = useCallback(() => store.getVersion(), [store]);
  useSyncExternalStore(subscribe, snap, snap);
  return store;
}

const svgUrl = (bytes: Uint8Array) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(bytes))}`;

function drawing(p: AtelierProject, d: DesignDirection, version: number, format: AtelierFormat, level: string): string {
  return svgUrl(writeAtelierFile(d, format, { project: p.title, version, level }).bytes);
}

export default function AtelierWindow({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const store = useAtelierStore();
  const p = store.get(projectId);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<"3d" | "exploded" | "orthographic" | "wiring" | "workflow">("3d");
  const version = p ? store.latest(p) : undefined;
  const d = p && version ? store.direction(p, focus ?? version.selected ?? undefined) : undefined;
  const assessed = useMemo(() => (p && version ? version.directions.map((x) => ({ d: x, a: assess(p, x) })) : []), [p, version]);
  const gltf = useMemo(() => (p && d && version ? writeAtelierFile(d, "gltf", { project: p.title, version: version.version, level: "" }).bytes : null), [p, d, version]);

  if (!p || !version) {
    return <GenesisWindowFrame eyebrow="Atelier" title="This project is gone" onClose={onClose}><p className="lat-empty">It was deleted.</p></GenesisWindowFrame>;
  }
  const current = d ? assessed.find((x) => x.d.id === d.id) : undefined;
  const exportsHere = (p.exports ?? []).filter((e) => d && e.directionId === d.id && e.version === version.version);

  return (
    <GenesisWindowFrame eyebrow={`Atelier · design v${version.version}`} title={p.title} onClose={onClose} overflow="hidden" extraActions={<span className="lat-badge">{version.directions.length} directions</span>}>
      <div className="lat-window" data-lelu-atelier-project={p.id}>
        <p className="lat-brief">{p.brief}</p>
        {p.inputs.length ? (
          <div className="lat-inputs">
            {p.inputs.map((i) => <span key={i.id} className={i.inspected ? "ok" : "bad"} title={i.findings || "not inspected"}>{i.inspected ? <Check size={12} aria-hidden /> : <TriangleAlert size={12} aria-hidden />} {i.name}{i.inspected ? ` · ${i.method}` : " · not inspected"}</span>)}
            <span className="muted">{p.sources.filter((s) => !s.inaccessible).length} sources{p.sources.some((s) => s.inaccessible) ? ` · ${p.sources.filter((s) => s.inaccessible).length} inaccessible` : ""}</span>
          </div>
        ) : null}

        {assessed.length === 0 ? <p className="lat-empty">No design directions yet — ask LÉLU to develop them.</p> : (
          <div className="lat-directions">
            {assessed.map(({ d: x, a }) => (
              <article key={x.id} className={`lat-dir${d?.id === x.id ? " is-focus" : ""}${version.selected === x.id ? " is-selected" : ""}`} data-lelu-atelier-direction={x.id}>
                <header>
                  <strong>{x.id} · {x.name}</strong>
                  {version.selected === x.id ? <span className="lat-badge sel">selected</span> : null}
                </header>
                <p className="identity">{x.identity}</p>
                <img src={drawing(p, x, version.version, "svg-orthographic", a.level)} alt={`Orthographic drawing of ${x.name}`} />
                <p className="arch">{x.architecture}</p>
                <dl>
                  <div><dt>Cost</dt><dd>{a.bom.totalCost} {p.currency}{a.bom.uncosted.length ? ` + ${a.bom.uncosted.length} unpriced` : ""}</dd></div>
                  <div><dt>Mass</dt><dd>{a.bom.totalMass} g</dd></div>
                  <div><dt>Parts</dt><dd>{x.components.length}</dd></div>
                  <div><dt>Complexity</dt><dd>{x.complexity.score}/5</dd></div>
                </dl>
                <span className={`lat-level lvl-${a.level}`}>{a.level}</span>
                {a.interferences.length ? <p className="warn"><TriangleAlert size={12} aria-hidden /> {a.interferences.length} interference(s): {a.interferences.map((h) => `${h.a}/${h.b}`).join(", ")}</p> : null}
                {a.safety.length ? <p className="warn"><ShieldAlert size={12} aria-hidden /> qualified review: {a.safety.map((s) => s.domain).join(", ")}</p> : null}
                <div className="row">
                  <button type="button" className="lst-btn ghost" onClick={() => setFocus(x.id)}>Inspect</button>
                  {version.selected !== x.id ? <button type="button" className="lst-btn" onClick={() => store.select(p.id, x.id)}>Select</button> : null}
                </div>
              </article>
            ))}
          </div>
        )}

        {d && current ? (
          <section className="lat-detail" aria-label={`${d.id} in detail`}>
            <div className="lat-tabs" role="tablist">
              {(["3d", "exploded", "orthographic", "wiring", "workflow"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={view === t} className={view === t ? "on" : ""} onClick={() => setView(t)}>{t === "3d" ? "3D model" : t}</button>
              ))}
            </div>
            <div className="lat-view">
              {view === "3d" && gltf ? <Suspense fallback={<p className="lat-empty">Loading the 3D view…</p>}><AtelierModelView gltf={gltf} label={d.name} /></Suspense> : null}
              {view !== "3d" ? <img src={drawing(p, d, version.version, `svg-${view}` as AtelierFormat, current.a.level)} alt={`${view} of ${d.name}`} /> : null}
            </div>
            <table className="lat-bom">
              <thead><tr><th>ID</th><th>Part</th><th>Material</th><th>Size</th><th>Qty</th><th>Cost</th><th>Mass</th></tr></thead>
              <tbody>{current.a.bom.rows.map((r) => <tr key={r.id}><td>{r.id}</td><td>{r.name}</td><td>{r.material}</td><td>{r.size}</td><td>{r.quantity}</td><td>{r.lineCost ?? "—"}</td><td>{r.mass ?? "?"}</td></tr>)}</tbody>
            </table>
            <p className="lat-why">Evidence: <b>{current.a.level}</b> — {current.a.why.join("; ")}.</p>
            {exportsHere.length ? (
              <div className="lat-files">
                {exportsHere.map((e) => (
                  <button key={e.filename} type="button" className={`lst-file ${e.ok ? "ok" : "bad"}`} disabled={!e.ok} data-verified={e.ok} onClick={() => { const f = store.fileOf(p.id, e.filename); if (f) downloadBytes(f.bytes, f.filename); }} title={e.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` ${c.detail}` : ""}`).join("\n")}>
                    {e.ok ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />} {e.filename} <span>{formatBytes(e.size)}</span> {e.ok ? <Download size={13} aria-hidden /> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="row">
                <button type="button" className="lst-btn" onClick={() => store.exportFiles(p.id, d.id, ["stl", "obj", "gltf", "dxf", "svg-orthographic", "svg-exploded"])}>Export design files</button>
              </div>
            )}
          </section>
        ) : null}

        <details className="lat-history">
          <summary>History ({p.versions.length} versions)</summary>
          <ol>{[...p.versions].reverse().map((v) => <li key={v.version}>v{v.version} · {new Date(v.at).toLocaleString()} · {v.note}{v.changed?.length ? ` (changed ${v.changed.join(", ")})` : ""}</li>)}</ol>
        </details>
      </div>
    </GenesisWindowFrame>
  );
}
