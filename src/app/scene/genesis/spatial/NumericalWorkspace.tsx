/**
 * LÉLU — Spatial Studio · Numerical intelligence workspace.
 *
 * Reads the reconstruction's numerical record itself: voxel planes from the
 * stored .lnre (GET /api/asre/jobs/<id>/slice) coloured by evidence class,
 * confidence, or boundary/interior; the confidence history across views
 * (lineage); and the snapshot provenance of the reconstruction.
 */
import { useEffect, useRef, useState } from "react";
import AsreClient, { type SliceCell } from "../../../../core/asre/AsreClient";
import type { AsreJobView, EvidenceBreakdown } from "../../../../core/asre/contracts";
import { useJobPoll } from "./ReconstructWorkspace";
import { EVIDENCE_COLOURS, ErrorLine, EvidenceBar, Field, Section, input, text } from "./spatialUi";

type Mode = "evidence" | "confidence" | "boundary";

function SliceCanvas({ size, cells, mode }: { size: [number, number]; cells: SliceCell[]; mode: Mode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = Math.max(2, Math.floor(320 / Math.max(size[0], size[1])));
    c.width = size[0] * k;
    c.height = size[1] * k;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0b0716";
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,0.04)";
    for (let i = 0; i <= size[0]; i += 8) g.strokeRect(i * k, 0, 0.5, c.height);
    for (const cell of cells) {
      if (mode === "evidence") {
        g.globalAlpha = 0.35 + 0.65 * cell.confidence;
        g.fillStyle = EVIDENCE_COLOURS[cell.cls];
      } else if (mode === "confidence") {
        g.globalAlpha = 1;
        const v = Math.round(40 + 215 * cell.confidence);
        g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 30)})`;
      } else {
        g.globalAlpha = 1;
        g.fillStyle = cell.boundary ? "#22d3ee" : "#334155";
      }
      // v grows upward in the grid; canvas y grows downward
      g.fillRect(cell.u * k, (size[1] - 1 - cell.v) * k, k, k);
    }
    g.globalAlpha = 1;
  }, [size, cells, mode]);
  return <canvas ref={ref} data-spatial-slice style={{ width: "100%", maxWidth: 420, imageRendering: "pixelated", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)" }} />;
}

export default function NumericalWorkspace({ selectedJob }: { selectedJob: string | null }) {
  const [job, setJob] = useState<AsreJobView | null>(null);
  const [axis, setAxis] = useState<"x" | "y" | "z">("z");
  const [index, setIndex] = useState(32);
  const [mode, setMode] = useState<Mode>("evidence");
  const [slice, setSlice] = useState<{ size: [number, number]; depth: number; cells: SliceCell[]; counts: EvidenceBreakdown } | null>(null);
  const [lineage, setLineage] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  useJobPoll(selectedJob, setJob);

  const ready = job?.state === "succeeded" && job.result;
  useEffect(() => {
    if (!ready || !selectedJob) return;
    let alive = true;
    AsreClient.slice(selectedJob, axis, index)
      .then((s) => alive && (setSlice(s), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [ready, selectedJob, axis, index]);
  useEffect(() => {
    if (!ready || !selectedJob) return;
    AsreClient.lineage(selectedJob).then((r) => setLineage(r.lineage)).catch((e) => setError(e.message));
  }, [ready, selectedJob]);

  if (!selectedJob || !job) return <Section title="Numerical record"><p style={{ margin: 0, color: text.dim, fontSize: 12 }}>Select a reconstruction job in the Reconstruct tab.</p></Section>;
  if (!ready) return <Section title="Numerical record"><p style={{ margin: 0, color: text.dim, fontSize: 12 }}>Job {job.id} is {job.state}; its numerical record exists once it has succeeded.</p></Section>;
  const r = job.result!;
  const depth = slice?.depth ?? r.grid.dims[axis === "x" ? 0 : axis === "y" ? 1 : 2];
  return (
    <div data-spatial-workspace="numerical" style={{ display: "grid", gridTemplateColumns: "minmax(300px, 440px) 1fr", gap: 10 }}>
      <Section title="Voxel inspection" aside={`${r.grid.dims.join("×")} lattice · ${(r.grid.resolution * 1000).toFixed(1)} mm cells`} id="voxels">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 6 }}>
          <Field label="axis">
            <select data-spatial-axis style={input} value={axis} onChange={(e) => setAxis(e.target.value as never)}>
              <option value="x">x (side cut)</option>
              <option value="y">y (horizontal cut)</option>
              <option value="z">z (front cut)</option>
            </select>
          </Field>
          <Field label="colour">
            <select data-spatial-mode style={input} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="evidence">evidence class</option>
              <option value="confidence">confidence</option>
              <option value="boundary">boundary / interior</option>
            </select>
          </Field>
          <Field label={`plane ${index} of ${depth - 1}`}>
            <input data-spatial-index type="range" min={0} max={depth - 1} value={Math.min(index, depth - 1)} onChange={(e) => setIndex(Number(e.target.value))} />
          </Field>
        </div>
        {slice ? <SliceCanvas size={slice.size} cells={slice.cells} mode={mode} /> : null}
        {slice ? <EvidenceBar evidence={slice.counts} caption={`· ${slice.cells.filter((c) => c.boundary).length} boundary / ${slice.cells.filter((c) => !c.boundary).length} interior in this plane`} /> : null}
        <ErrorLine error={error} />
      </Section>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <Section title="Volume" id="volume">
          <p style={{ margin: 0, fontSize: 12, color: text.body }}>
            {r.grid.cells.toLocaleString()} occupied cells: {r.grid.boundary.toLocaleString()} boundary, {r.grid.interior.toLocaleString()} interior ({((100 * r.grid.interior) / Math.max(1, r.grid.cells)).toFixed(0)}%). Mean fused confidence {r.grid.meanConfidence.toFixed(3)}.
          </p>
          <EvidenceBar evidence={r.evidence} />
        </Section>
        <Section title="Confidence history" aside="one row per view" id="lineage">
          <table style={{ fontSize: 12, color: text.body }}>
            <thead>
              <tr style={{ color: text.dim, textAlign: "left" }}>
                <th>job</th>
                <th>views</th>
                <th>cells</th>
                <th>mean conf.</th>
                <th>observed</th>
                <th>generated</th>
                <th>change</th>
              </tr>
            </thead>
            <tbody>
              {lineage.map((l) => {
                const ev = l.evidence as EvidenceBreakdown | null;
                const ob = l.observation as { newCells: number; carved: number; contradictions: number } | null;
                return (
                  <tr key={String(l.id)} data-spatial-lineage={String(l.id)}>
                    <td>{String(l.id)}</td>
                    <td>{(l.views as string[]).join("+")}</td>
                    <td>{Number(l.cells ?? 0).toLocaleString()}</td>
                    <td>{l.meanConfidence == null ? "—" : Number(l.meanConfidence).toFixed(3)}</td>
                    <td>{ev ? ev.OBSERVED.toLocaleString() : "—"}</td>
                    <td>{ev ? ev.GENERATED.toLocaleString() : "—"}</td>
                    <td>{ob ? `+${ob.newCells} / carved ${ob.carved} / ${ob.contradictions} contradictions` : "initial"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        <Section title="Provenance" aside={`${r.snapshots.length} snapshots`} id="provenance">
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: text.body }}>
            {r.observations.map((o) => (
              <li key={o.id}>
                <b>{o.provenance}</b> · {o.id} · {o.modality} · prior {o.confidence} · <span style={{ color: text.dim }}>{o.source.slice(0, 80)}</span>
              </li>
            ))}
          </ul>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: text.dim }}>
            {r.snapshots.map((s) => (
              <li key={s.id}>
                {s.label} — {s.cells.toLocaleString()} cells · {s.hash.slice(0, 12)}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </div>
  );
}
