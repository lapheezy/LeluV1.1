/**
 * ==========================================================
 * LÉLU — NOTIFICATIONS / IMPROVEMENTS PANEL
 *
 * Surfaces the REAL ImprovementQueue proposals that LÉLU's
 * self-development loop generates. Every card shows the
 * evidence, proposed solution, risk, and requires explicit
 * user action (APPROVE / REJECT / DEFER). Decisions feed
 * back into the SelfDevelopmentLoop for real execution.
 * ==========================================================
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import ImprovementQueue, {
  PENDING_APPROVAL_STATUSES,
  RUNNING_STATUSES,
  type ImprovementProposal,
  type ImprovementStatus,
} from "../../../core/selfdev/ImprovementQueue";
import AutonomyGate from "../../../core/cognition/AutonomyGate";
import ProposalEvidence, { ACTION_REQUIREMENTS, ProposalBlocked, statusLabel } from "./ProposalEvidence";
import SelfDevelopmentLoop from "../../../core/selfdev/SelfDevelopmentLoop";
import AgentEventBus from "../../../core/agent/AgentEvents";

const STATUS_COLORS: Record<ImprovementStatus, string> = {
  Detected: "rgba(148, 163, 184, 0.7)",
  Analyzing: "#67e8f9",
  Proposed: "#a78bfa",
  Approved: "#fbbf24",
  "In Development": "#38bdf8",
  Testing: "#a78bfa",
  Evaluation: "#fbbf24",
  Ready: "#34d399",
  Applying: "#38bdf8",
  Integrated: "rgba(52, 211, 153, 0.6)",
  Recorded: "rgba(148, 163, 184, 0.8)",
  Failed: "#f87171",
  Blocked: "#fbbf24",
  Rejected: "rgba(248, 113, 113, 0.6)",
  "Rolled Back": "rgba(248, 113, 113, 0.4)",
};

interface Props {
  onClose: () => void;
}

/** Finished one way or another: not "active". */
const DONE_STATUSES: ImprovementStatus[] = ["Integrated", "Recorded", "Rejected", "Rolled Back"];

/** Waiting on the owner: approval, review of a ready change, or an unblock. */
function needsOwner(proposal: ImprovementProposal): boolean {
  return PENDING_APPROVAL_STATUSES.includes(proposal.status) || proposal.status === "Ready" || proposal.status === "Blocked";
}

function ActionButton({ tone, onClick, title, children }: { tone: string; onClick: () => void; title?: string; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: "5px 14px",
        borderRadius: 999,
        border: `1px solid ${tone}`,
        background: "rgba(255,255,255,0.04)",
        color: tone,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** The permission an action needs, shown beside it, with the current level. */
function Requirement({ text, level }: { text: string; level: number }) {
  const current = AutonomyGate.getInstance().getLevel();
  return (
    <div data-lelu-requirement style={{ flexBasis: "100%", fontSize: 10.5, lineHeight: 1.45, color: current >= level ? "rgba(148,163,184,0.7)" : "rgba(251,191,36,0.85)", textAlign: "left" }}>
      {text} Current autonomy: L{current}{current >= level ? "." : ` — below L${level}; it will stop as Blocked with the reason.`}
    </div>
  );
}

export default function GenesisNotificationsPanel({ onClose }: Props) {
  const queue = useMemo(() => ImprovementQueue.getInstance(), []);
  const loop = useMemo(() => SelfDevelopmentLoop.getInstance(), []);
  const [proposals, setProposals] = useState<ImprovementProposal[]>(() => queue.list());
  const [filter, setFilter] = useState<"all" | "active" | "approval">("active");

  useEffect(() => {
    const unsub = queue.subscribe(() => setProposals(queue.list()));
    return unsub;
  }, [queue]);

  const filtered = useMemo(() => {
    if (filter === "approval") return proposals.filter(needsOwner);
    if (filter === "active") return proposals.filter((p) => !DONE_STATUSES.includes(p.status));
    return proposals;
  }, [proposals, filter]);

  const handleApprove = useCallback(
    (id: string) => {
      const proposal = queue.get(id);
      // The loop owns the transition: it queues PENDING work and starts
      // its first development run, and refuses anything else.
      if (proposal && SelfDevelopmentLoop.getInstance().approve(id)) {
        AgentEventBus.getInstance().emit({
          type: "cognitive_sync",
          taskId: id,
          source: "improvement-approved",
          detail: proposal.title,
        });
      }
    },
    [queue],
  );

  const handleReject = useCallback(
    (id: string) => {
      queue.setStatus(id, "Rejected");
      const proposal = queue.get(id);
      if (proposal) {
        AgentEventBus.getInstance().emit({
          type: "cognitive_sync",
          taskId: id,
          source: "improvement-rejected",
          detail: proposal.title,
        });
      }
    },
    [queue],
  );

  const handleDefer = useCallback((id: string) => {
    const proposal = queue.get(id);
    if (proposal && proposal.status !== "Detected" && proposal.status !== "Analyzing") {
      queue.setStatus(id, "Proposed");
    }
  }, [queue]);

  return (
    <GenesisWindowFrame title="LÉLU Updates" onClose={onClose}>
      {/* ── Filter tabs ── */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["active", "approval", "all"] as const).map((f) => {
          const count =
            f === "active"
              ? proposals.filter((p) => !DONE_STATUSES.includes(p.status)).length
              : f === "approval"
                ? proposals.filter(needsOwner).length
                : proposals.length;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                border: filter === f ? "1px solid rgba(167, 139, 250, 0.45)" : "1px solid rgba(255,255,255,0.08)",
                background: filter === f ? "rgba(167, 139, 250, 0.18)" : "transparent",
                color: filter === f ? "#d4c8ff" : "rgba(203, 228, 255, 0.55)",
                fontSize: 11.5,
                fontFamily: "inherit",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {f === "active" ? "Active" : f === "approval" ? "Awaiting" : "All"}
              {count > 0 && (
                <span
                  style={{
                    minWidth: 16,
                    height: 16,
                    borderRadius: 999,
                    background: f === "approval" ? "#fbbf24" : "rgba(167,139,250,0.35)",
                    color: f === "approval" ? "#020617" : undefined,
                    fontSize: 9,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "32px 16px",
            color: "rgba(203, 228, 255, 0.4)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {filter === "approval"
            ? "No proposals are waiting for your approval."
            : filter === "active"
              ? "No active improvements right now. LÉLU will surface proposals here when she discovers opportunities."
              : "Your improvement queue is empty."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((proposal) => (
            <div
              key={proposal.id}
              style={{
                padding: "14px 16px",
                borderRadius: 12,
                background: "rgba(8, 16, 38, 0.5)",
                border: `1px solid ${STATUS_COLORS[proposal.status]}${Math.round(0.35 * 255).toString(16).padStart(2, "0")}`,
                backdropFilter: "blur(12px)",
              }}
            >
              {/* Status + Kind */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                <span style={{ color: STATUS_COLORS[proposal.status] }} data-lelu-status={proposal.status}>{statusLabel(proposal)}</span>
                <span style={{ color: "rgba(148, 163, 184, 0.6)" }}>{proposal.kind}</span>
              </div>

              {/* Title */}
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "rgba(242, 230, 255, 0.95)",
                  marginBottom: 8,
                  lineHeight: 1.4,
                }}
              >
                {proposal.title}
              </div>

              {/* Problem → Proposed */}
              <div style={{ fontSize: 12, color: "rgba(203, 228, 255, 0.6)", lineHeight: 1.55, marginBottom: 8 }}>
                <strong style={{ color: "rgba(167, 139, 250, 0.85)" }}>Problem:</strong>{" "}
                {proposal.problem}
              </div>
              <div style={{ fontSize: 12, color: "rgba(203, 228, 255, 0.6)", lineHeight: 1.55, marginBottom: 8 }}>
                <strong style={{ color: "rgba(52, 211, 153, 0.85)" }}>Proposed:</strong>{" "}
                {proposal.proposedSolution}
              </div>

              {/* Evidence + Risk */}
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 10,
                  fontSize: 11,
                  lineHeight: 1.45,
                }}
              >
                <div style={{ flex: 1 }}>
                  <span style={{ color: "rgba(148, 163, 184, 0.7)", fontWeight: 600 }}>Evidence: </span>
                  <span style={{ color: "rgba(148, 163, 184, 0.5)" }}>{proposal.evidence}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ color: proposal.risk.toLowerCase().includes("none") ? "rgba(52, 211, 153, 0.8)" : "rgba(248, 191, 36, 0.8)", fontWeight: 600 }}>
                    Risk:{" "}
                  </span>
                  <span style={{ color: "rgba(148, 163, 184, 0.5)" }}>{proposal.risk}</span>
                </div>
              </div>

              {/* Expected benefit */}
              <div style={{ fontSize: 11, color: "rgba(148, 163, 184, 0.5)", marginBottom: 10, lineHeight: 1.45 }}>
                <span style={{ fontWeight: 600 }}>Expected: </span>
                {proposal.expectedBenefit}
              </div>

              <ProposalBlocked proposal={proposal} onRetry={() => void loop.retry(proposal.id)} />
              <ProposalEvidence proposal={proposal} />

              {/* Actions — each beside what it does and needs */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {PENDING_APPROVAL_STATUSES.includes(proposal.status) ? (
                  <>
                    <ActionButton tone="#34d399" onClick={() => handleApprove(proposal.id)} title={ACTION_REQUIREMENTS.develop}>APPROVE</ActionButton>
                    <ActionButton tone="#f87171" onClick={() => handleReject(proposal.id)}>REJECT</ActionButton>
                    <ActionButton tone="rgba(148,163,184,0.8)" onClick={() => handleDefer(proposal.id)}>DEFER</ActionButton>
                    <Requirement text={`Approve → ${ACTION_REQUIREMENTS.develop}`} level={3} />
                  </>
                ) : proposal.status === "Approved" || RUNNING_STATUSES.includes(proposal.status) ? (
                  <div style={{ fontSize: 11, color: "rgba(167, 139, 250, 0.8)", fontStyle: "italic" }}>
                    {statusLabel(proposal)} — live progress is in the activity timeline
                  </div>
                ) : proposal.status === "Ready" ? (
                  <>
                    <ActionButton tone="#34d399" onClick={() => void loop.applyCandidate(proposal.id, { approved: true })} title={ACTION_REQUIREMENTS.apply}>APPLY TO PROJECT</ActionButton>
                    <ActionButton tone="rgba(148,163,184,0.85)" onClick={() => void loop.integrate(proposal.id)} title={ACTION_REQUIREMENTS.record}>RECORD ONLY</ActionButton>
                    <ActionButton tone="#f87171" onClick={() => handleReject(proposal.id)}>REJECT</ActionButton>
                    <Requirement text={`Apply → ${ACTION_REQUIREMENTS.apply}`} level={5} />
                  </>
                ) : proposal.status === "Failed" ? (
                  <>
                    <ActionButton tone="#38bdf8" onClick={() => void loop.retry(proposal.id)} title={ACTION_REQUIREMENTS.develop}>DEVELOP AGAIN</ActionButton>
                    <ActionButton tone="#f87171" onClick={() => handleReject(proposal.id)}>REJECT</ActionButton>
                  </>
                ) : proposal.status === "Blocked" ? null : (
                  <div style={{ fontSize: 11, color: "rgba(148, 163, 184, 0.6)", fontStyle: "italic" }}>{statusLabel(proposal)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GenesisWindowFrame>
  );
}