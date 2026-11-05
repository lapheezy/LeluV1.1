/**
 * ==========================================================
 * LÉLU — PROPOSAL EVIDENCE
 *
 * What a self-development proposal's last real run did, shown
 * the same way in the Updates panel and in Self Development:
 * lifecycle state, why it is blocked and what unblocks it, and
 * the measured execution record (agent, files, checks, diff,
 * rollback). Everything rendered here comes from the
 * ImprovementQueue record the loop wrote — nothing is derived
 * from button presses.
 * ==========================================================
 */

import { useState, type CSSProperties } from "react";
import {
  IMPROVEMENT_STATUS_LABELS,
  type ImprovementProposal,
  type ProposalExecution,
} from "../../../core/selfdev/ImprovementQueue";

const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 10.5,
};

export const ACTION_REQUIREMENTS = {
  develop: "Generates the change with LÉLU's engineering agent and checks it in an isolated project copy. Needs autonomy L3.",
  apply: "Writes the reviewed change to the real project, re-checks it there, and rolls back on failure. Needs autonomy L5 and a signed-in identity.",
  record: "Records the result only. The real project is not changed.",
} as const;

export function statusLabel(proposal: ImprovementProposal): string {
  return IMPROVEMENT_STATUS_LABELS[proposal.status] ?? proposal.status;
}

function CheckRow({ check }: { check: ProposalExecution["checks"][number] }) {
  const color = check.ok === null ? "rgba(148,163,184,0.7)" : check.ok ? "#34d399" : "#f87171";
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline" }} data-lelu-check={check.name}>
      <span style={{ color, fontWeight: 700, minWidth: 14 }}>{check.ok === null ? "–" : check.ok ? "✓" : "✗"}</span>
      <span style={{ color: "rgba(226,232,240,0.85)", minWidth: 70 }}>{check.name}</span>
      <span style={{ color: "rgba(203,228,255,0.6)", overflowWrap: "anywhere" }}>{check.detail}</span>
    </div>
  );
}

export function ProposalBlocked({ proposal, onRetry }: { proposal: ImprovementProposal; onRetry?: () => void }) {
  if (proposal.status !== "Blocked" || !proposal.blocked) return null;
  const block = proposal.blocked;
  return (
    <div
      data-lelu-blocked
      style={{
        margin: "8px 0",
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(251,191,36,0.4)",
        background: "rgba(251,191,36,0.08)",
        fontSize: 11.5,
        lineHeight: 1.5,
        color: "rgba(254,243,199,0.92)",
        textAlign: "left",
      }}
    >
      <div><strong>Blocked ({block.action}):</strong> {block.reason}</div>
      {block.requiredAutonomy !== undefined ? <div><strong>Requires:</strong> autonomy level {block.requiredAutonomy}</div> : null}
      <div><strong>To unblock:</strong> {block.unblock}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            marginTop: 6,
            padding: "4px 12px",
            borderRadius: 999,
            border: "1px solid rgba(251,191,36,0.6)",
            background: "rgba(251,191,36,0.15)",
            color: "#fcd34d",
            fontSize: 11,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          RETRY {block.action === "apply" ? "APPLY" : "DEVELOPMENT"}
        </button>
      ) : null}
    </div>
  );
}

export default function ProposalEvidence({ proposal }: { proposal: ImprovementProposal }) {
  const [showDiff, setShowDiff] = useState(false);
  const execution = proposal.lastExecution;
  if (!execution) return null;
  return (
    <div
      data-lelu-execution={execution.executionId}
      style={{
        margin: "8px 0",
        padding: "8px 10px",
        borderRadius: 10,
        border: "1px solid rgba(125,211,252,0.22)",
        background: "rgba(2,6,23,0.45)",
        fontSize: 11,
        lineHeight: 1.5,
        color: "rgba(203,228,255,0.75)",
        textAlign: "left",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      <div style={mono}>
        {execution.kind} · {execution.executionId}
        {execution.outcome ? ` · ${IMPROVEMENT_STATUS_LABELS[execution.outcome] ?? execution.outcome}` : " · running"}
      </div>
      {execution.agent ? <div><strong>Agent:</strong> <span style={mono}>{execution.agent}</span></div> : null}
      {execution.workspaceId ? <div><strong>Workspace copy:</strong> <span style={mono}>{execution.workspaceId}</span></div> : null}
      {execution.plan ? <div><strong>Plan:</strong> {execution.plan}</div> : null}
      {execution.filesInspected.length ? (
        <div><strong>Inspected:</strong> <span style={mono}>{execution.filesInspected.join(", ")}</span></div>
      ) : null}
      {execution.filesChanged.length ? (
        <div><strong>Changed:</strong> <span style={mono}>{execution.filesChanged.join(", ")}</span></div>
      ) : null}
      {execution.checks.map((check, index) => (
        <CheckRow key={`${check.name}-${index}`} check={check} />
      ))}
      {execution.rollback ? (
        <div style={{ color: execution.rollback.ok ? "#fcd34d" : "#f87171" }}>
          <strong>Rollback:</strong>{" "}
          {execution.rollback.ok ? `restored ${execution.rollback.restored.join(", ") || "(nothing to restore)"}` : `FAILED — ${execution.rollback.error}`}
        </div>
      ) : null}
      {execution.error ? <div style={{ color: "#fca5a5" }}><strong>Result:</strong> {execution.error}</div> : null}
      {execution.diff ? (
        <>
          <button
            type="button"
            onClick={() => setShowDiff((open) => !open)}
            style={{
              alignSelf: "flex-start",
              marginTop: 4,
              padding: "3px 10px",
              borderRadius: 999,
              border: "1px solid rgba(125,211,252,0.35)",
              background: "transparent",
              color: "#7dd3fc",
              fontSize: 10.5,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            {showDiff ? "Hide diff" : `Review diff (${execution.filesChanged.length} file(s))`}
          </button>
          {showDiff ? (
            <pre
              data-lelu-diff
              style={{
                ...mono,
                margin: 0,
                maxHeight: 320,
                overflow: "auto",
                padding: 8,
                borderRadius: 8,
                background: "rgba(0,0,0,0.45)",
                whiteSpace: "pre",
              }}
            >
              {execution.diff.split("\n").map((line, index) => (
                <span
                  key={index}
                  style={{
                    display: "block",
                    color: line.startsWith("+") ? "#86efac" : line.startsWith("-") ? "#fca5a5" : line.startsWith("@@") ? "#93c5fd" : "rgba(203,228,255,0.7)",
                  }}
                >
                  {line || " "}
                </span>
              ))}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
