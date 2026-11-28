/**
 * The Diagnostics surface in a conversation (v3 §18): a live view over a stored run.
 *
 * - Run identity: suite, device, viewport, build, time.
 * - Counts per status and a verdict per group (VERIFIED only when every check that ran passed).
 * - Every check with its evidence, its reason and the safe next action (read-only, reversible, needs
 *   approval, outside this environment).
 * - Drill-down to the object a check is about; a rerun with a before/after comparison; earlier runs.
 *
 * It streams: the store fires an event as each check finishes, and this redraws. It is a thread
 * object, so it can be moved, collapsed, pinned beside the chat and restored like any other.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DIAGNOSTICS_EVENT, getRun, runDiagnostics, runs, summarize, verdict, type CheckStatus, type DiagnosticCheck, type DiagnosticRun } from "../../../../../core/diagnostics/Diagnostics";
import { registerDiagnosticSuites } from "../../../../../core/diagnostics/suites";
import { update, type ThreadObject } from "../../../../../core/thread/ThreadObjects";

let tick = 0;
function subscribe(fn: () => void): () => void {
  const on = () => {
    tick++;
    fn();
  };
  window.addEventListener(DIAGNOSTICS_EVENT, on);
  return () => window.removeEventListener(DIAGNOSTICS_EVENT, on);
}
const version = () => tick;

const LABEL: Record<CheckStatus, string> = { PASS: "PASS", FAIL: "FAIL", PARTIAL: "PARTIAL", BLOCKED: "BLOCKED", NOT_RUN: "NOT RUN" };
const ORDER: Record<CheckStatus, number> = { FAIL: 0, PARTIAL: 1, BLOCKED: 2, NOT_RUN: 3, PASS: 4 };
const NEXT: Record<NonNullable<DiagnosticCheck["next"]>["kind"], string> = { "read-only": "read-only", reversible: "reversible", "needs-approval": "needs approval", "outside-environment": "outside this environment" };

function drill(check: DiagnosticCheck): void {
  const t = check.target;
  if (!t) return;
  const el = t.kind === "thread-object" ? document.querySelector<HTMLElement>(`[data-thread-object="${CSS.escape(t.ref)}"]`) : t.kind === "selector" ? document.querySelector<HTMLElement>(t.ref) : null;
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.dataset.diagFlash = "true";
  setTimeout(() => delete el.dataset.diagFlash, 1800);
}

export default function DiagnosticsObject({ object }: { object: ThreadObject }) {
  useSyncExternalStore(subscribe, version, version);
  const runId = object.diagnostics?.runId ?? "";
  const run: DiagnosticRun | undefined = getRun(runId);
  const history = runs(object.conversationId);
  const before = run?.rerunOf ? getRun(run.rerunOf) : undefined;
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => registerDiagnosticSuites(), []);

  const groups = useMemo(() => {
    const by = new Map<string, DiagnosticCheck[]>();
    for (const c of run?.checks ?? []) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()];
  }, [run?.checks.length, run]);

  if (!run) return <p className="dg-empty">This run is no longer stored on this device.</p>;
  const counts = summarize(run);
  const shown = [...run.checks].filter((c) => !onlyIssues || c.status !== "PASS").sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const prev = new Map((before?.checks ?? []).map((c) => [c.id, c.status]));
  const changed = before ? run.checks.filter((c) => prev.has(c.id) && prev.get(c.id) !== c.status) : [];

  const rerun = async () => {
    setBusy(true);
    try {
      await runDiagnostics(run.suite, object.conversationId, {
        rerunOf: run.id,
        ready: async (r) => {
          update(object.id, { diagnostics: { runId: r.id, suite: run.suite } });
          await new Promise((done) => setTimeout(done, 600));
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dg" data-diagnostics-run={run.id} data-run-status={run.status}>
      <div className="dg-id">
        <b>{run.suite}</b> · {run.environment.device} · {run.environment.viewport} · build {run.environment.build} · {new Date(run.startedAt).toLocaleTimeString()}
        {run.status === "running" ? <span className="dg-running"> · running, {run.checks.length} checks so far…</span> : run.finishedAt ? <> · {Math.round((run.finishedAt - run.startedAt) / 100) / 10} s</> : null}
      </div>
      <div className="dg-counts">
        {(Object.keys(LABEL) as CheckStatus[]).map((s) => (
          <span key={s} className="dg-chip" data-status={s}>
            {LABEL[s]} {counts[s]}
          </span>
        ))}
      </div>
      <div className="dg-groups">
        {groups.map(([g, cs]) => (
          <span key={g} className="dg-group" data-verdict={verdict(cs)}>
            {g}: {verdict(cs)}
          </span>
        ))}
      </div>
      {before ? (
        <div className="dg-compare" data-diagnostics-compare>
          Before → after ({before.id}): {summarize(before).PASS} → {counts.PASS} pass, {summarize(before).FAIL} → {counts.FAIL} fail
          {changed.length ? <ul>{changed.map((c) => <li key={c.id}>{c.title}: {prev.get(c.id)} → {c.status}</li>)}</ul> : <span> · no check changed status</span>}
        </div>
      ) : null}
      <div className="dg-bar">
        <label>
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only what did not pass
        </label>
        <button type="button" onClick={() => void rerun()} disabled={busy || run.status === "running"} data-diagnostics-rerun>
          {busy || run.status === "running" ? "Running…" : "Rerun"}
        </button>
        {history.length > 1 ? (
          <select aria-label="Earlier runs" value={run.id} onChange={(e) => update(object.id, { diagnostics: { runId: e.target.value, suite: getRun(e.target.value)?.suite ?? run.suite } })}>
            {history.map((r) => (
              <option key={r.id} value={r.id}>
                {new Date(r.startedAt).toLocaleTimeString()} · {r.suite} · {summarize(r).PASS}/{r.checks.length} pass
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <ol className="dg-checks">
        {shown.map((c) => (
          <li key={c.id} data-status={c.status} data-check={c.id}>
            <span className="dg-chip" data-status={c.status}>{LABEL[c.status]}</span>
            <span className="dg-title">{c.title}</span>
            <small className="dg-cat">{c.category}</small>
            {c.evidence ? <div className="dg-ev">{c.evidence}{c.metric ? ` (${c.metric.kind})` : ""}</div> : null}
            {c.reason ? <div className="dg-why">{c.reason}</div> : null}
            {c.next ? (
              <div className="dg-next">
                Next: {c.next.action} <em>({NEXT[c.next.kind]})</em>
              </div>
            ) : null}
            {c.target && c.target.kind !== "test" && c.target.kind !== "source" ? (
              <button type="button" className="dg-drill" onClick={() => drill(c)}>
                Show it
              </button>
            ) : null}
          </li>
        ))}
        {shown.length === 0 ? <li className="dg-allpass">Every check that ran passed.</li> : null}
      </ol>
    </div>
  );
}
