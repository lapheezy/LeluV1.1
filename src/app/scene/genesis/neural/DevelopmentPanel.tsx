/**
 * V2's development panel (WP14/15/17): what the diagnosis found in her real
 * architecture, society and usage; the last bounded development cycle stage
 * by stage; her proposals in the ImprovementQueue with the executive's
 * acknowledgment; and the owner's decision buttons. Research goes through
 * the repository workforce and shows exactly what came back.
 */

import { useEffect, useState } from "react";
import NeuralMapSteward, { diagnose, type Finding } from "../../../../core/selfdev/NeuralMapSteward";
import ImprovementQueue from "../../../../core/selfdev/ImprovementQueue";

export default function DevelopmentPanel({ onSelect }: { onSelect: (id: string) => void }) {
  const steward = NeuralMapSteward.getInstance();
  const [, set] = useState(0);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("graph visualization webgl");
  useEffect(() => {
    const bump = () => set((n) => n + 1);
    const offs = [steward.subscribe(bump), ImprovementQueue.getInstance().subscribe(bump)];
    void steward.gather().then((d) => setFindings(diagnose(d)));
    return () => offs.forEach((o) => o());
  }, [steward]);
  const last = steward.lastCycle();
  const mine = steward.proposals();
  const research = steward.researchLog()[0];

  return (
    <div className="dev" data-development-panel>
      <h3>Development</h3>
      <p className="mv-kind">Diagnosis of her real architecture, society and usage → proposals → the Architect executive → your decision.</p>
      <div className="aw-controls">
        <button type="button" data-dev-cycle disabled={busy !== null} onClick={async () => { setBusy("cycle"); await steward.cycle("owner"); setBusy(null); }}>
          {busy === "cycle" ? "Running…" : "Run a development cycle now"}
        </button>
      </div>
      {last ? (
        <ol className="dev-stages" data-dev-stages={last.stages.length}>
          {last.stages.map((s) => (
            <li key={s.stage} data-stage-status={s.status}>
              <b>{s.stage}</b> <small>{s.status} · {s.ms} ms</small>
              <div>{s.detail}</div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mv-hint">No cycle has run yet. It runs on her cognitive heartbeat at most every 6 hours, or now.</p>
      )}
      <h4>Her proposals ({mine.length})</h4>
      {mine.map((p) => (
        <article key={p.id} className="dev-prop" data-proposal={p.id} data-status={p.status}>
          <b>{p.title}</b> <small>[{p.status}]</small>
          <p>{p.evidence.split("\n")[0]}</p>
          <p className="dev-ack">
            {p.acknowledged ? `Acknowledged by ${p.acknowledged.executive}: ${p.acknowledged.guidance.slice(0, 140)}` : "Not acknowledged yet."}
            {p.lastOwnerAction ? ` · Your decision: ${p.lastOwnerAction.action}` : ""}
          </p>
          <div className="aw-controls">
            {(["approve", "reject", "defer", "request-changes"] as const).map((a) => (
              <button key={a} type="button" data-decide={a} onClick={() => steward.decide(p.id, a)}>{a}</button>
            ))}
          </div>
        </article>
      ))}
      <h4>Findings now ({findings?.length ?? "…"})</h4>
      <ul className="dev-findings">
        {(findings ?? []).slice(0, 12).map((f) => (
          <li key={f.id} data-finding={f.kind}>
            <button type="button" onClick={() => f.subject.startsWith("subsystem:") && onSelect(f.subject)}>
              <b>{f.title}</b> <small>({f.kind}, severity {f.severity})</small>
            </button>
            <div>{f.evidence}</div>
          </li>
        ))}
      </ul>
      <h4>Research (repository workforce)</h4>
      <span className="mv-row">
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Research query" />
        <button type="button" data-dev-research disabled={busy !== null} onClick={async () => { setBusy("research"); await steward.research(query); setBusy(null); }}>
          {busy === "research" ? "Searching…" : "Research"}
        </button>
      </span>
      {research ? (
        <div className="dev-research" data-research-candidates={research.candidates.length}>
          <small>{new Date(research.at).toLocaleString()} · “{research.query}”</small>
          <ul>
            {research.candidates.map((c) => (
              <li key={c.name}>{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name}</a> : c.name}{c.stars !== undefined ? ` ★${c.stars}` : ""}{c.license ? ` · ${c.license}` : ""}</li>
            ))}
            {research.errors.map((e) => <li key={e} className="aw-err">✗ {e}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
