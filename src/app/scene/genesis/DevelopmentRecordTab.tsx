/**
 * Development record — what LÉLU studied, what she concluded, what she
 * proposed, and where each proposal stands with the owner. Read-only over
 * the existing stores (see core/selfdev/DevelopmentRecord); the only writes
 * are the owner's own decisions at the two gates:
 *
 *   Gate 1  approve (SelfDevelopmentLoop.approve) or reject a proposal
 *   Gate 2  accept, or return with feedback, an implemented change
 */
import { useEffect, useMemo, useState } from "react";
import StudyObjectives from "../../../core/cognition/StudyObjectives";
import ImprovementQueue from "../../../core/selfdev/ImprovementQueue";
import SelfDevelopmentLoop from "../../../core/selfdev/SelfDevelopmentLoop";
import SelfStudyEngine from "../../../core/cognition/SelfStudyEngine";
import UsageBudgetGate from "../../../core/observability/UsageBudgetGate";
import { buildDevelopmentRecord, type DevelopmentEntry } from "../../../core/selfdev/DevelopmentRecord";

const card = { padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", fontSize: 12.5, display: "grid", gap: 6 } as const;
const label = { fontSize: 10, opacity: 0.55, textTransform: "uppercase" as const, letterSpacing: "0.08em" };
const button = { padding: "5px 11px", borderRadius: 8, border: "1px solid rgba(125,211,252,0.4)", background: "rgba(125,211,252,0.12)", color: "inherit", cursor: "pointer", fontSize: 12 } as const;
const quiet = { ...button, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.1)" } as const;

const STAGE_COLOR: Record<DevelopmentEntry["stage"], string> = {
  "concluded-no-change": "rgba(148,163,184,0.8)",
  held: "#fbbf24",
  "awaiting-approval": "#67e8f9",
  "in-development": "#a78bfa",
  "needs-decision": "#f87171",
  "awaiting-acceptance": "#67e8f9",
  accepted: "#4ade80",
  returned: "#fbbf24",
  rejected: "rgba(148,163,184,0.8)",
};

function Entry({ entry, onChanged }: { entry: DevelopmentEntry; onChanged: () => void }) {
  const [feedback, setFeedback] = useState("");
  const [open, setOpen] = useState(false);
  const proposal = entry.proposal;
  const checks = proposal?.implementation?.checks ?? [];

  return (
    <div style={card} data-testid="development-entry" data-stage={entry.stage}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ color: STAGE_COLOR[entry.stage] }}>{entry.stageLabel}</strong>
        <span style={{ opacity: 0.55 }}>
          {entry.conclusion.category} · cycle {entry.conclusion.cycle} · {entry.conclusion.synthesizedBy}
        </span>
      </div>
      {proposal ? <div style={{ fontWeight: 600 }}>{proposal.title}</div> : null}
      <div><span style={label}>Studied</span><br />{entry.question}</div>
      <div><span style={label}>Why</span><br />{entry.why}</div>
      <div><span style={label}>Learned</span><br />{entry.conclusion.learned}</div>
      {entry.conclusion.change ? (
        <div>
          <span style={label}>Proposed change</span><br />{entry.conclusion.change}
          {entry.conclusion.expectedBenefit ? <><br /><span style={{ opacity: 0.7 }}>Benefit: {entry.conclusion.expectedBenefit}</span></> : null}
          {entry.conclusion.risks ? <><br /><span style={{ opacity: 0.7 }}>Risks: {entry.conclusion.risks}</span></> : null}
          {entry.conclusion.verification ? <><br /><span style={{ opacity: 0.7 }}>Verified by: {entry.conclusion.verification}</span></> : null}
        </div>
      ) : null}
      {proposal?.implementation ? (
        <div>
          <span style={label}>Implementation</span><br />
          {proposal.implementation.filesChanged.length} file(s) changed
          {proposal.implementation.agent ? ` by ${proposal.implementation.agent}` : ""} ·{" "}
          {checks.filter((check) => check.ok === true).length}/{checks.length} check(s) passed
          {proposal.implementation.error ? <><br /><span style={{ color: "#f87171" }}>{proposal.implementation.error}</span></> : null}
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {checks.map((check) => (
              <li key={check.name}>{check.ok === true ? "✓" : check.ok === false ? "✗" : "–"} {check.name}: {check.detail.slice(0, 160)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {proposal?.ownerDecision?.note ? <div><span style={label}>Your feedback</span><br />{proposal.ownerDecision.note}</div> : null}
      {proposal?.feedbackHistory?.length ? (
        <div data-testid="development-feedback-history">
          <span style={label}>Earlier feedback this implementation addresses</span>
          <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {proposal.feedbackHistory.map((item) => <li key={item.at}>{item.note ?? "(no note)"}</li>)}
          </ul>
        </div>
      ) : null}

      <button type="button" onClick={() => setOpen((value) => !value)} style={{ ...button, justifySelf: "start", background: "transparent" }}>
        {open ? "Hide evidence" : "Show evidence"}{proposal?.implementation?.diff ? " and diff" : ""}
      </button>
      {open ? (
        <div style={{ display: "grid", gap: 6 }}>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11, opacity: 0.8 }}>{entry.evidence.join("\n")}</pre>
          {proposal?.implementation?.diff ? (
            <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 11, maxHeight: 320, overflow: "auto", background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 8 }}>
              {proposal.implementation.diff}
            </pre>
          ) : null}
        </div>
      ) : null}

      {proposal && entry.stage === "awaiting-approval" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={button} onClick={() => { SelfDevelopmentLoop.getInstance().approve(proposal.id); onChanged(); }}>
            Approve (Gate 1)
          </button>
          <button type="button" style={quiet} onClick={() => { ImprovementQueue.getInstance().setStatus(proposal.id, "Rejected"); onChanged(); }}>
            Reject
          </button>
        </div>
      ) : null}
      {proposal && (entry.stage === "awaiting-acceptance" || entry.stage === "returned") ? (
        <div style={{ display: "grid", gap: 6 }}>
          <textarea
            aria-label="Feedback"
            placeholder="Feedback (required to return it)"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            rows={2}
            style={{ padding: 6, borderRadius: 8, background: "rgba(0,0,0,0.3)", color: "inherit", border: "1px solid rgba(255,255,255,0.14)", fontSize: 16 }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" style={button} onClick={() => { ImprovementQueue.getInstance().recordOwnerDecision(proposal.id, "accepted", feedback); setFeedback(""); onChanged(); }}>
              Accept (Gate 2)
            </button>
            <button
              type="button"
              style={quiet}
              disabled={feedback.trim().length === 0}
              onClick={() => { ImprovementQueue.getInstance().recordOwnerDecision(proposal.id, "returned", feedback); setFeedback(""); onChanged(); }}
            >
              Return with feedback
            </button>
            {entry.stage === "returned" ? (
              <button
                type="button"
                style={button}
                title="Her development loop builds a new implementation in an isolated copy, with your feedback in its brief. It then waits for your acceptance again."
                onClick={() => { void SelfDevelopmentLoop.getInstance().retry(proposal.id).then(onChanged); onChanged(); }}
              >
                Develop again with your feedback
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function DevelopmentRecordTab() {
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((value) => value + 1);
  useEffect(() => ImprovementQueue.getInstance().subscribe(() => refresh()), []);
  useEffect(() => SelfStudyEngine.getInstance().subscribe(() => refresh()), []);

  const entries = useMemo(
    () => buildDevelopmentRecord(StudyObjectives.getInstance().list(), ImprovementQueue.getInstance().list()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  const study = SelfStudyEngine.getInstance().getCognitiveState();
  const allowance = UsageBudgetGate.getInstance().backgroundAllowance();

  return (
    <div data-testid="development-record" style={{ display: "grid", gap: 10 }}>
      <div style={card}>
        <span style={label}>Current learning objective</span>
        <div>{study.focus ? study.focus.question : "No study has run yet in this session."}</div>
        {study.focus ? <div style={{ opacity: 0.7 }}>{study.focus.whySelected}</div> : null}
        <div style={{ opacity: 0.7 }}>
          Background model allowance: {allowance.usedToday}/{allowance.cap} used today
          {allowance.blockedBy ? ` · ${allowance.blockedBy === "paused" ? "paused" : allowance.blockedBy === "cap" ? "used up" : "next call later today"}` : ""}.
        </div>
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No study has reached a conclusion yet.</div>
      ) : (
        entries.map((entry) => <Entry key={entry.objectiveId} entry={entry} onChanged={refresh} />)
      )}
    </div>
  );
}
