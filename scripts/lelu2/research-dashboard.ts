/**
 * LÉLU 2.1 — the journal as something a person can look at.
 *
 * The dashboard is generated from the persisted documents only. It has
 * no state of its own and no client-side JavaScript: opening it twice
 * shows the same thing, and what it shows is what is on disk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import type ResearchJournal from "../../src/core/cognition/research/journal";
import type ObservationLog from "../../src/core/cognition/research/observations";
import type ResearchStore from "../../src/core/cognition/research/store";
import CapabilityPipeline from "../../src/core/cognition/research/capabilities";
import ResearchAgenda from "../../src/core/cognition/research/agenda";
import { compareRenders, decodePng } from "../../src/core/cognition/research/visual";
import { PROJECT_ROOT } from "./research-fs";

const escape = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

export function renderDashboard(input: {
  journal: ResearchJournal;
  observations: ObservationLog;
  store: ResearchStore;
  researchDir: string;
}): string {
  const { journal, observations, store } = input;
  const entries = journal.all();
  const stats = journal.stats();
  const digest = observations.digest();
  const gaps = journal.gaps();
  const contradictions = journal.contradictions();
  const agenda = new ResearchAgenda();
  const proposals = agenda
    .rank([...agenda.fromGaps(gaps), ...agenda.fromFailures(observations.recurrences(), observations.all())])
    .slice(0, 6);
  const capabilities = new CapabilityPipeline(store).all();

  let visual: { a: string; b: string; iou: number; coverageA: number; coverageB: number; findings: Array<{ detail: string; severity: string; corroborateWith: string }> } | null = null;
  try {
    const load = (path: string) => decodePng(readFileSync(join(PROJECT_ROOT, path)), (bytes) => new Uint8Array(inflateSync(bytes)));
    const left = "artifacts/lelu2/hair/voxel/lelu2-voxel-head-front.png";
    const right = "artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png";
    const comparison = compareRenders(load(left), load(right), { a: left, b: right });
    visual = {
      a: "../hair/voxel/lelu2-voxel-head-front.png",
      b: "../hair/tubes-high/lelu2-tubes-high-head-front.png",
      iou: comparison.iou,
      coverageA: comparison.coverageA,
      coverageB: comparison.coverageB,
      findings: comparison.findings,
    };
  } catch {
    visual = null; // no renders on this checkout: the section is omitted, not faked
  }

  const byPackage = new Map<string, typeof entries>();
  for (const entry of entries) byPackage.set(entry.workPackage, [...(byPackage.get(entry.workPackage) ?? []), entry]);

  const entryCard = (entry: (typeof entries)[number]): string => `
    <article class="entry">
      <div class="entry-head">
        <code>${escape(entry.id)}</code>
        <span class="badge ${entry.status}">${escape(entry.status)}</span>
        <span class="conf" title="confidence">${percent(entry.confidence)}</span>
      </div>
      <h3>${escape(entry.question)}</h3>
      <p class="learned">${escape(entry.learned)}</p>
      <details>
        <summary>${entry.evidence.length} evidence item(s) · ${escape(entry.kind)}</summary>
        <p><strong>Observed.</strong> ${escape(entry.observed)}</p>
        <p><strong>Method.</strong> ${escape(entry.method)}</p>
        <p><strong>Results.</strong> ${escape(entry.results)}</p>
        <ul>${entry.evidence.map((item) => `<li><code>${escape(item.kind)}</code> ${escape(item.ref)}${item.note ? ` — ${escape(item.note)}` : ""}</li>`).join("")}</ul>
        <p><strong>Limitations.</strong> ${entry.limitations.map(escape).join("; ")}</p>
        <p><strong>Next.</strong> ${entry.nextQuestions.map(escape).join("; ")}</p>
      </details>
    </article>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LÉLU · research journal</title>
<style>
  :root { color-scheme: dark; --bg:#0b0d12; --panel:#141821; --line:#232a38; --ink:#e8edf7; --muted:#8f9bb3; --accent:#e46b9a; --ok:#4ec9a0; --warn:#e2b04a; --bad:#e2604a; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header { padding:36px clamp(16px,4vw,56px) 18px; border-bottom:1px solid var(--line); }
  h1 { margin:0 0 6px; font-size:clamp(26px,4vw,40px); letter-spacing:-0.02em; }
  h1 span { color:var(--accent); }
  .sub { color:var(--muted); max-width:70ch; }
  main { padding:24px clamp(16px,4vw,56px) 64px; display:grid; gap:28px; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:12px; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px 16px; }
  .stat b { display:block; font-size:26px; }
  .stat span { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:0.08em; }
  section h2 { font-size:15px; text-transform:uppercase; letter-spacing:0.12em; color:var(--muted); margin:0 0 12px; }
  .cards { display:grid; gap:12px; }
  .entry { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px 18px; }
  .entry h3 { margin:8px 0 6px; font-size:17px; }
  .entry p { margin:6px 0; }
  .learned { color:#cfd8e8; }
  .entry-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  code { font:12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color:#b7c3d8; }
  .badge { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; padding:2px 8px; border-radius:999px; border:1px solid var(--line); }
  .badge.verified { color:var(--ok); border-color:#2b6b58; }
  .badge.hypothesis { color:var(--warn); border-color:#6b5a2b; }
  .badge.rejected { color:var(--bad); border-color:#6b342b; }
  .badge.experiment, .badge.open { color:#8fb6e2; border-color:#2b4a6b; }
  .conf { margin-left:auto; color:var(--muted); font-variant-numeric:tabular-nums; }
  details summary { cursor:pointer; color:var(--muted); margin-top:8px; }
  ul { margin:6px 0; padding-left:20px; }
  .agenda { display:grid; gap:10px; }
  .proposal { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; }
  .bar { height:6px; border-radius:999px; background:#1d2431; margin-top:8px; overflow:hidden; }
  .bar i { display:block; height:100%; background:linear-gradient(90deg,var(--accent),#8f7ce0); }
  .meta { color:var(--muted); font-size:12px; }
  .grid2 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px; }
  figure { margin:0; background:var(--panel); border:1px solid var(--line); border-radius:14px; overflow:hidden; }
  figure img { width:100%; display:block; aspect-ratio:1/1; object-fit:cover; background:#000; }
  figcaption { padding:10px 12px; color:var(--muted); font-size:12px; }
  .finding { border-left:3px solid var(--warn); padding:6px 10px; margin:8px 0; background:#171c26; border-radius:0 8px 8px 0; }
  .finding.high { border-color:var(--bad); }
  .timeline { list-style:none; padding:0; margin:0; display:grid; gap:6px; }
  .timeline li { display:grid; grid-template-columns:64px 78px 1fr; gap:10px; font-size:13px; padding:6px 10px; background:var(--panel); border:1px solid var(--line); border-radius:10px; }
  .empty { color:var(--muted); font-style:italic; }
  footer { padding:0 clamp(16px,4vw,56px) 48px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>LÉLU <span>·</span> research journal</h1>
  <p class="sub">Every card below is a stored document under <code>research/</code>. Verified means a measurement, test or render supports it — not that a sentence sounded confident.</p>
</header>
<main>
  <div class="stats">
    <div class="stat"><b>${stats.entries}</b><span>entries</span></div>
    <div class="stat"><b>${stats.verified}</b><span>verified</span></div>
    <div class="stat"><b>${stats.hypotheses}</b><span>hypotheses</span></div>
    <div class="stat"><b>${stats.rejected}</b><span>rejected</span></div>
    <div class="stat"><b>${stats.measuredEvidence}</b><span>measured evidence</span></div>
    <div class="stat"><b>${percent(stats.averageConfidence)}</b><span>mean confidence</span></div>
    <div class="stat"><b>${digest.events}</b><span>observed events</span></div>
    <div class="stat"><b>${gaps.length}</b><span>open questions</span></div>
  </div>

  <section>
    <h2>What she asks next</h2>
    <div class="agenda">
      ${
        proposals.length === 0
          ? '<p class="empty">No open question yet.</p>'
          : proposals
              .map(
                (proposal) => `<div class="proposal">
        <div>${escape(proposal.question)}</div>
        <div class="meta">impact ${proposal.impact.toFixed(2)} · feasibility ${proposal.feasibility.toFixed(2)} · cost ${proposal.cost}/5 · relevance ${proposal.relevance.toFixed(2)} · ${escape(proposal.origin)}</div>
        <div class="bar"><i style="width:${Math.round(proposal.priority * 100)}%"></i></div>
        <div class="meta">${proposal.reasons.map(escape).join(" · ")}</div>
      </div>`,
              )
              .join("")
      }
    </div>
  </section>

  ${
    visual
      ? `<section>
    <h2>Visual evidence — the render, measured</h2>
    <div class="grid2">
      <figure><img src="${visual.a}" alt="voxel hair, front"><figcaption>voxel hair · coverage ${percent(visual.coverageA)}</figcaption></figure>
      <figure><img src="${visual.b}" alt="tube hair, front"><figcaption>tube hair · coverage ${percent(visual.coverageB)}</figcaption></figure>
    </div>
    <p class="meta">Silhouette IoU ${visual.iou.toFixed(3)}. Every finding names the measurement that can settle it.</p>
    ${visual.findings
      .map(
        (finding) =>
          `<div class="finding ${escape(finding.severity)}"><strong>${escape(finding.severity)}</strong> · ${escape(finding.detail)}<div class="meta">corroborate with ${escape(finding.corroborateWith)}</div></div>`,
      )
      .join("")}
  </section>`
      : ""
  }

  <section>
    <h2>Observations — this session</h2>
    <ul class="timeline">
      ${
        digest.timeline.length === 0
          ? '<li class="empty">No observation has been recorded yet.</li>'
          : digest.timeline
              .slice(-18)
              .map(
                (event) => `<li><span class="meta">${new Date(event.at).toISOString().slice(11, 19)}</span><span class="badge">${escape(event.workPackage)}</span><span>${escape(event.summary)}</span></li>`,
              )
              .join("")
      }
    </ul>
  </section>

  ${[...byPackage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([workPackage, group]) => `<section>
    <h2>${escape(workPackage)} · ${group.length} entr${group.length === 1 ? "y" : "ies"}</h2>
    <div class="cards">${group.map(entryCard).join("")}</div>
  </section>`,
    )
    .join("")}

  <section>
    <h2>Contradictions and refuted assumptions</h2>
    ${
      contradictions.length === 0
        ? '<p class="empty">No later entry has refuted an earlier one.</p>'
        : `<div class="cards">${contradictions
            .map(
              (item) => `<div class="entry"><div class="entry-head"><code>${escape(item.laterId)}</code><span>refutes</span><code>${escape(item.earlierId)}</code></div>
        <p>“${escape(item.assumption)}”</p><p class="meta">${escape(item.note)}${item.earlierStillClaims ? " · the earlier entry still claims it, which is the point: nothing was rewritten." : ""}</p></div>`,
            )
            .join("")}</div>`
    }
    ${
      journal.disprovenAssumptions().length > 0
        ? `<p class="meta">Refuted by their own results: ${journal
            .disprovenAssumptions()
            .map((item) => `“${escape(item.statement)}” (${escape(item.entryId)})`)
            .join("; ")}</p>`
        : ""
    }
  </section>

  <section>
    <h2>Capabilities</h2>
    ${
      capabilities.length === 0
        ? '<p class="empty">No discovery has been promoted to a capability yet.</p>'
        : `<div class="cards">${capabilities
            .map(
              (record) => `<div class="entry"><div class="entry-head"><code>${escape(record.id)}</code><span class="badge ${record.status === "verified" ? "verified" : "open"}">${escape(record.status)}</span></div>
        <h3>${escape(record.name)}</h3>
        <ul>${record.acceptance.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>
        <p class="meta">from ${escape(record.fromEntryId)} · <code>${escape(record.testCommand)}</code></p></div>`,
            )
            .join("")}</div>`
    }
  </section>
</main>
<footer>
  Generated from ${entries.length} entry documents and ${digest.events} observations · ${new Date().toISOString()} ·
  index rebuilt at generation time · no client-side state
</footer>
</body>
</html>`;
}
