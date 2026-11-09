/**
 * LÉLU — the artifacts a reply made, shown on the reply itself: what it
 * is, a preview, the files that passed verification (downloadable) and
 * those that did not (marked, never offered as ready).
 */

import { memo } from "react";
import { Boxes, Check, Download, ExternalLink, TriangleAlert } from "lucide-react";
import { useAtelierStore } from "../atelier/AtelierWindow";
import { openAtelier } from "../../../../core/atelier/AtelierTools";
import type { ActivityArtifact } from "../../../../core/multichat/TurnActivity";
import { artifactGist, firstChartSvg } from "../../../../core/studio/StudioPreview";
import type { ExportFormat } from "../../../../core/studio/StudioTypes";
import { KIND_ICON } from "./GenesisCreationStudio";
import { downloadBytes, formatBytes, KIND_LABEL, openArtifacts, useStudioStore } from "./useStudio";
import "./studio.css";

const ACTION: Record<ActivityArtifact["action"], string> = { created: "Created", revised: "Revised", exported: "Exported", restored: "Restored", opened: "Opened" };

function StudioArtifactCardsImpl({ artifacts }: { artifacts: ActivityArtifact[] }) {
  const store = useStudioStore();
  return (
    <div className="lst-chat-cards">
      {artifacts.map((card) => {
        if (card.kind === "design") return <DesignCard key={card.artifactId} card={card} />;
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
