/**
 * LÉLU — one Creation Studio artifact as a Cosmos window (`artifact:<id>`).
 *
 * The preview is drawn from the selected revision's spec in a sandboxed
 * iframe. Exporting writes the real file, re-opens it and shows every
 * check; only a verified file offers a download. Old revisions can be
 * viewed, compared with the one before, and restored (as a new revision).
 */

import { lazy, Suspense, useMemo, useState } from "react";
import { Check, Download, FileSearch, History, RotateCcw, TriangleAlert } from "lucide-react";
import GenesisWindowFrame from "../GenesisWindowFrame";
import { previewHtml } from "../../../../core/studio/StudioPreview";
import type { ReadResult } from "../../../../core/studio/StudioReader";
import { FORMATS_BY_KIND, type ExportFormat } from "../../../../core/studio/StudioTypes";
import { downloadBytes, formatBytes, KIND_LABEL, useStudioStore } from "./useStudio";
import "./studio.css";

// Each editor (and its library) loads only when an artifact of its kind is opened.
const GraphEditor = lazy(() => import("./GraphEditor"));
const DrawingEditor = lazy(() => import("./DrawingEditor"));

export default function StudioArtifactWindow({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const store = useStudioStore();
  const artifact = store.get(artifactId);
  const [viewRev, setViewRev] = useState<number | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState<string[] | null>(null);
  const [reopened, setReopened] = useState<{ format: ExportFormat; read: ReadResult } | null>(null);

  const revision = artifact ? store.revision(artifact, viewRev ?? undefined) ?? store.latest(artifact) : undefined;
  const html = useMemo(() => (revision ? previewHtml(revision.spec) : ""), [revision]);

  if (!artifact || !revision) {
    return (
      <GenesisWindowFrame eyebrow="Creation Studio" title="This artifact is gone" onClose={onClose}>
        <p className="lst-empty">It was deleted, so this window has nothing to show.</p>
      </GenesisWindowFrame>
    );
  }
  const latest = store.latest(artifact);
  const exportsHere = artifact.exports.filter((e) => e.rev === revision.rev);
  const lastOf = (format: ExportFormat) => [...exportsHere].reverse().find((e) => e.format === format);

  const doExport = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    const r = await store.export(artifact.id, format, revision.rev);
    setBusy(null);
    if (!r.ok) setError(r.reason);
  };
  const download = async (format: ExportFormat, filename: string) => {
    const bytes = await store.fileOf(artifact.id, revision.rev, format);
    if (bytes) downloadBytes(bytes, filename, format);
    else setError(`The ${format.toUpperCase()} could not be produced again.`);
  };
  const reopen = async (format: ExportFormat) => {
    const read = await store.reopen(artifact.id, revision.rev, format);
    if (read) setReopened({ format, read });
  };

  return (
    <GenesisWindowFrame
      eyebrow={`Creation Studio · ${KIND_LABEL[artifact.kind]}`}
      title={artifact.title}
      onClose={onClose}
      overflow="hidden"
      extraActions={<span className="lst-rev-badge" data-lelu-studio-rev={revision.rev}>r{revision.rev}{revision.rev !== latest.rev ? ` of ${latest.rev}` : ""}</span>}
    >
      <div className="lst-window" data-lelu-studio-artifact={artifact.id}>
        <div className="lst-toolbar">
          <label className="lst-field">
            <History size={14} aria-hidden />
            <select aria-label="Revision" value={revision.rev} onChange={(e) => { setViewRev(Number(e.target.value)); setDiff(null); setReopened(null); }}>
              {[...artifact.revisions].reverse().map((r) => (
                <option key={r.rev} value={r.rev}>r{r.rev} · {r.note.slice(0, 40)}</option>
              ))}
            </select>
          </label>
          {revision.basedOn ? (
            <button type="button" className="lst-btn ghost" onClick={() => { const c = store.compare(artifact.id, revision.basedOn!, revision.rev); setDiff(c.ok ? c.changes : [c.reason]); }}>
              Compare with r{revision.basedOn}
            </button>
          ) : null}
          {revision.rev !== latest.rev ? (
            <button type="button" className="lst-btn ghost" onClick={() => { const r = store.restore(artifact.id, revision.rev); if (r.ok) setViewRev(null); }}>
              <RotateCcw size={13} aria-hidden /> Restore as r{latest.rev + 1}
            </button>
          ) : null}
          <span className="lst-spacer" />
          {FORMATS_BY_KIND[artifact.kind].map((format) => (
            <button key={format} type="button" className="lst-btn" disabled={busy !== null} onClick={() => void doExport(format)} data-lelu-studio-export={format}>
              {busy === format ? "…" : format.toUpperCase()}
            </button>
          ))}
        </div>

        {error ? <p className="lst-error" role="alert"><TriangleAlert size={14} aria-hidden /> {error}</p> : null}
        {diff ? (
          <div className="lst-diff" aria-label="Changes">
            {diff.length ? diff.map((d, i) => <div key={i} className={d.startsWith("+") ? "add" : d.startsWith("−") ? "del" : ""}>{d}</div>) : <div>No differences.</div>}
          </div>
        ) : null}

        {revision.spec.kind === "graph" || revision.spec.kind === "drawing" ? (
          <Suspense fallback={<p className="lst-note" role="status">Opening the {revision.spec.kind === "graph" ? "graph" : "drawing"} editor…</p>}>
            {/* "latest" keeps one editor across its own saves; an earlier revision opens read-only. */}
            {revision.spec.kind === "graph" ? (
              <GraphEditor key={viewRev ?? "latest"} artifactId={artifact.id} spec={revision.spec} readOnly={revision.rev !== latest.rev} />
            ) : (
              <DrawingEditor key={viewRev ?? "latest"} artifactId={artifact.id} spec={revision.spec} readOnly={revision.rev !== latest.rev} />
            )}
          </Suspense>
        ) : (
          <iframe className={`lst-preview kind-${artifact.kind}`} title={`Preview of ${artifact.title}`} sandbox="" srcDoc={html} />
        )}
        {"links" in revision.spec && revision.spec.links?.length ? <p className="lst-note">Linked to {revision.spec.links.join(", ")}</p> : null}

        {exportsHere.length || artifact.original ? (
          <div className="lst-exports" aria-label="Files">
            {FORMATS_BY_KIND[artifact.kind].map((f) => lastOf(f)).filter(Boolean).map((e) => (
              <div key={e!.format} className={`lst-export ${e!.ok ? "ok" : "bad"}`} data-lelu-studio-file={e!.filename} data-verified={e!.ok}>
                {e!.ok ? <Check size={14} aria-hidden /> : <TriangleAlert size={14} aria-hidden />}
                <span className="name">{e!.filename}</span>
                <span className="meta">{formatBytes(e!.size)} · {e!.ok ? "verified" : "failed verification"}</span>
                <button type="button" className="lst-btn ghost" onClick={() => void reopen(e!.format)} title="Open the written file again and show what it contains"><FileSearch size={13} aria-hidden /> Reopen</button>
                {e!.ok ? <button type="button" className="lst-btn" onClick={() => void download(e!.format, e!.filename)}><Download size={13} aria-hidden /> Download</button> : <span />}
                <details className="lst-checks">
                  <summary>checks</summary>
                  <ul>{e!.checks.map((c) => <li key={c.name} className={c.ok ? "ok" : "bad"}>{c.ok ? "✓" : "✗"} {c.name}{c.detail ? ` — ${c.detail}` : ""}</li>)}</ul>
                </details>
              </div>
            ))}
            {artifact.original ? (
              <div className="lst-export ok">
                <span className="name">{artifact.original.name}</span>
                <span className="meta">original as imported · {formatBytes(artifact.original.size)}</span>
                {store.original(artifact.id) ? <button type="button" className="lst-btn ghost" onClick={() => downloadBytes(store.original(artifact.id)!, artifact.original!.name, artifact.original!.format)}><Download size={13} aria-hidden /> Original</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {reopened ? (
          <div className="lst-reopen" aria-label="Re-opened file">
            <strong>Re-opened {reopened.format.toUpperCase()} from its bytes</strong>
            {reopened.read.ok ? (
              <>
                <span>
                  {[reopened.read.structure.slides !== undefined ? `${reopened.read.structure.slides} slides` : "", reopened.read.structure.pages !== undefined ? `${reopened.read.structure.pages} pages` : "", reopened.read.structure.sheets ? `sheets ${reopened.read.structure.sheets.join(", ")}` : "", `${reopened.read.structure.tables} tables`, `${reopened.read.structure.charts} charts${reopened.read.structure.chartKinds.length ? ` (${reopened.read.structure.chartKinds.join(", ")})` : ""}`, reopened.read.structure.formulas.length ? `${reopened.read.structure.formulas.length} formulas` : "", reopened.read.structure.notes.length ? `${reopened.read.structure.notes.length} speaker notes` : ""].filter(Boolean).join(" · ")}
                </span>
                <pre>{reopened.read.text.slice(0, 1200)}</pre>
              </>
            ) : <span className="bad">It did not open: {reopened.read.error}</span>}
            <button type="button" className="lst-btn ghost" onClick={() => setReopened(null)}>Close</button>
          </div>
        ) : null}
      </div>
    </GenesisWindowFrame>
  );
}
