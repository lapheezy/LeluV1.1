/**
 * LÉLU — the artifacts a reply made, shown on the reply itself: what it
 * is, a preview, the files that passed verification (downloadable) and
 * those that did not (marked, never offered as ready).
 */

import { lazy, memo, Suspense, useState } from "react";
import { Boxes, Check, Download, ExternalLink, Maximize2, Minimize2, TriangleAlert } from "lucide-react";
import { useAtelierStore } from "../atelier/AtelierWindow";
import { openAtelier } from "../../../../core/atelier/AtelierTools";
import type { ActivityArtifact } from "../../../../core/multichat/TurnActivity";
import { artifactGist, firstChartSvg } from "../../../../core/studio/StudioPreview";
import type { ExportFormat } from "../../../../core/studio/StudioTypes";
import { KIND_ICON } from "./GenesisCreationStudio";
import { downloadBytes, formatBytes, KIND_LABEL, openArtifacts, useStudioStore } from "./useStudio";
// The inline editors load when a card actually embeds one: a static import put
// Excalidraw (~1.1 MB) on the path of every chat window that shows a card.
const VisualViewer = lazy(() => import("./VisualViewer"));
const DrawingEditor = lazy(() => import("./DrawingEditor"));
import EmbedBoundary from "./EmbedBoundary";
import "./studio.css";

const ACTION: Record<ActivityArtifact["action"], string> = { created: "Created", revised: "Revised", exported: "Exported", restored: "Restored", opened: "Opened" };

function StudioArtifactCardsImpl({ artifacts }: { artifacts: ActivityArtifact[] }) {
  const store = useStudioStore();
  return (
    <div className="lst-chat-cards">
      {artifacts.map((card) => {
        if (card.kind === "design") return <DesignCard key={card.artifactId} card={card} />;
        // A visual artifact is shown HERE, in the reply that made it: the same
        // live viewer (chart, Mermaid, three.js, film) the Studio window uses,
        // with Expand growing it in place instead of sending the user away.
        if (card.kind === "visual" || card.kind === "drawing") return <VisualCard key={card.artifactId} card={card} />;
        const live = store.get(card.artifactId);
        const rev = live ? store.revision(live, card.rev) : undefined;
        const Icon = KIND_ICON[card.kind as keyof typeof KIND_ICON];
        const svg = rev ? firstChartSvg(rev.spec) : null;
        return (
          <section key={card.artifactId} className="lst-chat-card" data-lelu-chat-artifact={card.artifactId} aria-label={`${KIND_LABEL[card.kind as keyof typeof KIND_LABEL]} ${card.title}`}>
            <header>
              <Icon size={16} aria-hidden />
              <span className="title"><strong>{card.title}</strong><em>{ACTION[card.action]} · {KIND_LABEL[card.kind as keyof typeof KIND_LABEL]} · revision {card.rev}</em></span>
              {live ? <button type="button" className="lst-btn ghost" onClick={() => openArtifacts([card.artifactId])}><ExternalLink size={13} aria-hidden /> Open</button> : null}
            </header>
            {svg ? <div className="lst-thumb" dangerouslySetInnerHTML={{ __html: svg }} /> : null}
            {rev ? <p className="lst-gist">{artifactGist(rev.spec)}</p> : <p className="lst-gist">Not on this device.</p>}
            {card.exports.length ? (
              <div className="lst-chat-files">
                {card.exports.map((e) => (
                  <button
                    key={e.format}
                    type="button"
                    className={`lst-file ${e.ok ? "ok" : "bad"}`}
                    disabled={!e.ok || !live}
                    data-verified={e.ok}
                    title={e.ok ? "Re-opened and verified after writing" : "This file failed verification and is not offered"}
                    onClick={async () => {
                      const bytes = await store.fileOf(card.artifactId, card.rev, e.format as ExportFormat);
                      if (bytes) downloadBytes(bytes, e.filename, e.format as ExportFormat);
                    }}
                  >
                    {e.ok ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
                    {e.filename} <span>{formatBytes(e.size)}</span>
                    {e.ok ? <Download size={13} aria-hidden /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * A visual artifact embedded in its own reply: the real, interactive preview
 * (chart iframe · Mermaid SVG · live three.js · on-device film) plus the
 * verified files. Expand grows the same component in place — the message, its
 * revision and its exports never leave the thread.
 */
function VisualCard({ card }: { card: ActivityArtifact }) {
  const store = useStudioStore();
  const live = store.get(card.artifactId);
  const rev = live ? store.revision(live, card.rev) : undefined;
  const spec = rev?.spec;
  const [expanded, setExpanded] = useState(false);
  const Icon = KIND_ICON[card.kind as keyof typeof KIND_ICON];
  // Only a visual or a drawing has an inline viewer; a document/deck/workbook
  // keeps its card and its files.
  const embedded = spec && (spec.kind === "visual" || spec.kind === "drawing") ? spec : undefined;
  const medium = embedded ? (embedded.kind === "visual" ? embedded.medium : "drawing") : null;
  return (
    <section
      className={`lst-chat-card lst-chat-card-visual${expanded ? " is-expanded" : ""}`}
      data-lelu-chat-artifact={card.artifactId}
      data-lelu-chat-embed={medium ?? "none"}
      aria-label={`${KIND_LABEL[card.kind as keyof typeof KIND_LABEL]} ${card.title}`}
    >
      <header>
        <Icon size={16} aria-hidden />
        <span className="title"><strong>{card.title}</strong><em>{ACTION[card.action]} · {KIND_LABEL[card.kind as keyof typeof KIND_LABEL]} · revision {card.rev}</em></span>
        {live && rev ? (
          <button type="button" className="lst-btn ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-lelu-chat-expand>
            {expanded ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />} {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
        {live ? <button type="button" className="lst-btn ghost" onClick={() => openArtifacts([card.artifactId])}><ExternalLink size={13} aria-hidden /> Large view</button> : null}
      </header>
      {live && embedded ? (
        <div className="lst-chat-embed">
          <EmbedBoundary label={embedded.kind === "drawing" ? "drawing editor" : `${embedded.medium} viewer`}>
          <Suspense fallback={<p className="lst-note" role="status">Opening…</p>}>
            {embedded.kind === "drawing"
              // Excalidraw itself, editable in the thread: the user draws here, it
              // saves to this artifact, and Expand gives it the height it needs.
              ? <DrawingEditor artifactId={card.artifactId} spec={embedded} readOnly={false} />
              : <VisualViewer artifact={live} rev={card.rev} spec={embedded} />}
          </Suspense>
          </EmbedBoundary>
        </div>
      ) : (
        <p className="lst-gist">Not on this device — this reply was recorded elsewhere.</p>
      )}
      {card.exports.length ? (
        <div className="lst-chat-files">
          {card.exports.map((e) => (
            <button
              key={e.format}
              type="button"
              className={`lst-file ${e.ok ? "ok" : "bad"}`}
              disabled={!e.ok || !live}
              data-verified={e.ok}
              title={e.ok ? "Re-opened and verified after writing" : "This file failed verification and is not offered"}
              onClick={async () => {
                const bytes = await store.fileOf(card.artifactId, card.rev, e.format as ExportFormat);
                if (bytes) downloadBytes(bytes, e.filename, e.format as ExportFormat);
              }}
            >
              {e.ok ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
              {e.filename} <span>{formatBytes(e.size)}</span>
              {e.ok ? <Download size={13} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** An Atelier project on the reply: what changed, its files (verified ones downloadable). */
function DesignCard({ card }: { card: ActivityArtifact }) {
  const atelier = useAtelierStore();
  const p = atelier.get(card.artifactId);
  const v = p ? atelier.latest(p) : undefined;
  return (
    <section className="lst-chat-card" data-lelu-chat-artifact={card.artifactId} aria-label={`Design project ${card.title}`}>
      <header>
        <Boxes size={16} aria-hidden />
        <span className="title"><strong>{card.title}</strong><em>{ACTION[card.action]} · Atelier design · v{card.rev}{v ? ` · ${v.directions.length} direction${v.directions.length === 1 ? "" : "s"}` : ""}</em></span>
        {p ? <button type="button" className="lst-btn ghost" onClick={() => openAtelier(card.artifactId)}><ExternalLink size={13} aria-hidden /> Open</button> : null}
      </header>
      {v?.directions.length ? <p className="lst-gist">{v.directions.map((d) => `${d.id} ${d.name}`).join(" · ")}</p> : null}
      {card.exports.length ? (
        <div className="lst-chat-files">
          {card.exports.map((e) => (
            <button key={e.filename} type="button" className={`lst-file ${e.ok ? "ok" : "bad"}`} disabled={!e.ok || !p} data-verified={e.ok}
              onClick={() => { const f = atelier.fileOf(card.artifactId, e.filename); if (f) downloadBytes(f.bytes, f.filename); }}>
              {e.ok ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />} {e.filename} <span>{formatBytes(e.size)}</span> {e.ok ? <Download size={13} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const StudioArtifactCards = memo(StudioArtifactCardsImpl);
export default StudioArtifactCards;
