/**
 * LÉLU — Spatial Studio · Reconstruction workspace.
 *
 * Every control calls the real ASRE service: images go to
 * POST /api/asre/reconstruct, progress is the job's own step list polled
 * from the server (never a timer), hypotheses/coverage/evidence come from
 * the job result, and a further view starts a real incremental observe job.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AsreClient, { type AsreStatus } from "../../../../core/asre/AsreClient";
import type { AsreJobView } from "../../../../core/asre/contracts";
import { Btn, ErrorLine, EvidenceBar, Field, Section, fileToBase64, input, ms, text, type RenderTarget } from "./spatialUi";
import SpatialViewer from "./SpatialViewer";

const VIEWS = ["front", "right", "left", "back"] as const;
const ACTIVE = new Set(["queued", "running"]);

export function useJobPoll(id: string | null, onUpdate: (j: AsreJobView) => void) {
  const cb = useRef(onUpdate);
  cb.current = onUpdate;
  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { job } = await AsreClient.job(id);
        if (!alive) return;
        cb.current(job);
        if (ACTIVE.has(job.state)) timer = setTimeout(tick, 400);
      } catch {
        if (alive) timer = setTimeout(tick, 1500);
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);
}

export default function ReconstructWorkspace({ selectedJob, onSelectJob, onRender }: { selectedJob: string | null; onSelectJob: (id: string) => void; onRender: (t: RenderTarget) => void }) {
  const [status, setStatus] = useState<AsreStatus | null>(null);
  const [jobs, setJobs] = useState<AsreJobView[]>([]);
  const [job, setJob] = useState<AsreJobView | null>(null);
  const [files, setFiles] = useState<Array<{ view: string; file: File }>>([]);
  const [engine, setEngine] = useState("auto");
  const [resolution, setResolution] = useState(64);
  const [height, setHeight] = useState(1);
  const [addView, setAddView] = useState<{ view: string; file: File | null }>({ view: "right", file: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => AsreClient.jobs().then((r) => setJobs(r.jobs)).catch((e) => setError(String(e.message ?? e))), []);
  useEffect(() => {
    AsreClient.status().then(setStatus).catch((e) => setError(`ASRE service unreachable: ${e.message ?? e}`));
    void refresh();
  }, [refresh]);
  useJobPoll(selectedJob, (j) => {
    setJob(j);
    if (!ACTIVE.has(j.state)) void refresh();
  });

  const run = async (fn: () => Promise<{ job: AsreJobView }>) => {
    setBusy(true);
    setError(null);
    try {
      const { job: j } = await fn();
      setJob(j);
      onSelectJob(j.id);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => AsreClient.reconstruct({ images: await Promise.all(files.map(async (f) => ({ view: f.view, imageBase64: await fileToBase64(f.file) }))), engine, resolution, heightMeters: height }));

  const result = job?.result ?? null;
  return (
    <div data-spatial-workspace="reconstruct" style={{ display: "grid", gridTemplateColumns: "minmax(260px, 340px) 1fr", gap: 10, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <Section title="Input" aside={status ? `engines: silhouette${status.engines.triposr ? " · TripoSR" : ""}${status.blender ? " · Blender" : ""}` : "…"} id="input">
          {VIEWS.map((v) => (
            <Field key={v} label={`${v} view (PNG with transparency or a plain background)`}>
              <input
                data-spatial-input={v}
                type="file"
                accept="image/png"
                style={input}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFiles((prev) => [...prev.filter((x) => x.view !== v), ...(f ? [{ view: v, file: f }] : [])].sort((a, b) => VIEWS.indexOf(a.view as never) - VIEWS.indexOf(b.view as never)));
                }}
              />
            </Field>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <Field label="engine">
              <select data-spatial-engine style={input} value={engine} onChange={(e) => setEngine(e.target.value)}>
                <option value="auto">auto</option>
                <option value="silhouette">silhouette (TS, instant)</option>
                <option value="triposr" disabled={!status?.engines.triposr}>TripoSR (CPU, ~1 min)</option>
              </select>
            </Field>
            <Field label="cells tall">
              <input style={input} type="number" min={32} max={96} value={resolution} onChange={(e) => setResolution(Number(e.target.value))} />
            </Field>
            <Field label="assumed height m">
              <input style={input} type="number" min={0.05} step={0.1} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </Field>
          </div>
          <Btn kind="primary" data="reconstruct" disabled={!files.length || busy} onClick={start}>
            Reconstruct {files.length ? `(${files.map((f) => f.view).join(" + ")})` : ""}
          </Btn>
          <p style={{ margin: 0, fontSize: 11, color: text.dim }}>Runs locally on this machine's CPU. {status?.spend}</p>
          <ErrorLine error={error} />
        </Section>
        <Section title="Jobs" aside={`${jobs.length}`} id="jobs">
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 220, overflow: "auto" }}>
            {jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                data-spatial-job={j.id}
                onClick={() => onSelectJob(j.id)}
                style={{ textAlign: "left", fontSize: 11, padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.07)", background: j.id === selectedJob ? "rgba(167,139,250,0.15)" : "transparent", color: text.body, cursor: "pointer", fontFamily: "inherit" }}
              >
                {j.kind === "observe" ? "↳ " : ""}
                {j.id} · {j.engine} · {j.input.images.map((i) => i.view).join("+")} · <b style={{ color: j.state === "succeeded" ? text.good : j.state === "failed" ? text.bad : text.warn }}>{j.state}</b>
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {!job ? (
          <Section title="Reconstruction">
            <p style={{ margin: 0, color: text.dim, fontSize: 12 }}>Choose one or more views and start a reconstruction, or pick a job.</p>
          </Section>
        ) : (
          <>
            <Section title={`Job ${job.id}`} aside={`${job.engine} · ${job.state} · ${(job.progress * 100).toFixed(0)}%`} id="job">
              <div data-spatial-progress={job.progress} style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
                <div style={{ width: `${job.progress * 100}%`, height: "100%", borderRadius: 3, background: job.state === "failed" ? text.bad : "#a78bfa" }} />
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: text.body, textAlign: "left" }}>
                {job.steps.map((s, i) => (
                  <li key={i} data-spatial-step={s.step} data-state={s.state}>
                    {s.step} — <b style={{ color: s.state === "done" ? text.good : s.state === "failed" ? text.bad : s.state === "running" ? text.warn : text.dim }}>{s.state}</b> {ms(s.ms)} {s.note ? <span style={{ color: text.dim }}>· {s.note.slice(0, 160)}</span> : null}
                  </li>
                ))}
              </ol>
              <ErrorLine error={job.error} />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ACTIVE.has(job.state) ? (
                  <Btn kind="danger" data="cancel" onClick={() => run(() => AsreClient.cancel(job.id))}>
                    Cancel
                  </Btn>
                ) : null}
                {["failed", "cancelled", "interrupted"].includes(job.state) ? (
                  <Btn data="retry" onClick={() => run(() => AsreClient.retry(job.id))}>
                    Retry
                  </Btn>
                ) : null}
                {result ? (
                  <Btn kind="primary" data="open-render" onClick={() => onRender({ url: AsreClient.assetUrl(result.files.glb), label: `reconstruction ${job.id}`, forgeJobId: result.forgeJobId ?? null, evidence: result.evidence })}>
                    Open in Render
                  </Btn>
                ) : null}
                {result?.forgeJobId ? <span style={{ fontSize: 11, color: text.dim, alignSelf: "center" }}>in the Forge as {result.forgeJobId}</span> : null}
              </div>
            </Section>
            {result ? (
              <>
                <Section title="Evidence" aside={`${result.grid.cells.toLocaleString()} cells · mean confidence ${result.grid.meanConfidence.toFixed(2)}`} id="evidence">
                  <EvidenceBar evidence={result.evidence} />
                  <p style={{ margin: 0, fontSize: 12, color: text.body }} data-spatial-evidence-text>
                    {result.evidenceText}
                  </p>
                </Section>
                <Section title="Competing hypotheses" aside={`${(result.disagreementFraction * 100).toFixed(0)}% of cells claimed by only one`} id="hypotheses">
                  <table style={{ fontSize: 12, color: text.body, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ color: text.dim, textAlign: "left" }}>
                        <th>#</th>
                        <th>hypothesis</th>
                        <th>agreement (mean IoU)</th>
                        <th>cells</th>
                        <th>evidence</th>
                        <th>mesh</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {result.hypotheses.map((h) => (
                        <tr key={h.id} data-spatial-hypothesis={h.id} data-selected={h.selected ? "true" : "false"}>
                          <td>{h.rank}</td>
                          <td title={h.method}>
                            {h.selected ? "★ " : ""}
                            {h.label}
                          </td>
                          <td>{h.agreement.toFixed(3)}</td>
                          <td>{h.cells.toLocaleString()}</td>
                          <td>{h.evidence}</td>
                          <td>{h.meshValid ? `valid · ${h.triangles.toLocaleString()} tris` : "invalid"}</td>
                          <td>{h.glb ? <Btn data={`view-hypothesis-${h.id}`} onClick={() => onRender({ url: AsreClient.assetUrl(h.glb!), label: `hypothesis ${h.label} (${job.id})` })}>view</Btn> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ margin: 0, fontSize: 11, color: text.dim }}>★ selected: the hypothesis the others agree with most. Pairwise IoU: {Object.entries(result.pairwiseIou).map(([k, v]) => `${k.replace("|", "↔")} ${v.toFixed(2)}`).join(" · ")}</p>
                </Section>
                <Section title="What would help most" id="next-view">
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: text.body, textAlign: "left" }}>
                    {result.coverage.requests.slice(0, 3).map((r) => (
                      <li key={r.view}>
                        the <b>{r.view}</b> view — {r.reason}
                      </li>
                    ))}
                  </ol>
                  {job.engine === "silhouette" && job.state === "succeeded" ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "end", flexWrap: "wrap" }}>
                      <Field label="add a view">
                        <select style={input} value={addView.view} onChange={(e) => setAddView((a) => ({ ...a, view: e.target.value }))}>
                          {VIEWS.filter((v) => !job.input.images.some((i) => i.view === v)).map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </Field>
                      <input data-spatial-observe-file type="file" accept="image/png" style={input} onChange={(e) => setAddView((a) => ({ ...a, file: e.target.files?.[0] ?? null }))} />
                      <Btn kind="primary" data="observe" disabled={!addView.file || busy} onClick={() => run(async () => AsreClient.observe(job.id, addView.view, await fileToBase64(addView.file!)))}>
                        Refine with this view
                      </Btn>
                    </div>
                  ) : null}
                  {job.observation ? (
                    <p style={{ margin: 0, fontSize: 12, color: text.body }} data-spatial-observation>
                      The {job.observation.view} view added {job.observation.newCells.toLocaleString()} cells, reinforced {job.observation.reinforcedCells.toLocaleString()}, carved {job.observation.carved.toLocaleString()}, and kept {job.observation.contradictions.toLocaleString()} contradiction(s) on record; mean confidence {job.observation.meanConfidenceBefore.toFixed(2)} → {job.observation.meanConfidenceAfter.toFixed(2)}; untouched regions verified: {String(job.observation.unaffectedVerified)}.
                    </p>
                  ) : null}
                </Section>
                <Section title="Geometry preview" aside={`${result.mesh.triangles.toLocaleString()} triangles · ${result.mesh.meshValid ? "passes Forge inspection" : "FAILS inspection"}`} id="preview">
                  <SpatialViewer url={AsreClient.assetUrl(result.files.glb)} height={300} />
                </Section>
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
