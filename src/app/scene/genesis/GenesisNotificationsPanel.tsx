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
  type ImprovementProposal,
  type ImprovementStatus,
} from "../../../core/selfdev/ImprovementQueue";
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
  Integrated: "rgba(52, 211, 153, 0.6)",
  Rejected: "rgba(248, 113, 113, 0.6)",
  "Rolled Back": "rgba(248, 113, 113, 0.4)",
};

interface Props {
  onClose: () => void;
}

export default function GenesisNotificationsPanel({ onClose }: Props) {
  const queue = useMemo(() => ImprovementQueue.getInstance(), []);
  const [proposals, setProposals] = useState<ImprovementProposal[]>(() => queue.list());
  const [filter, setFilter] = useState<"all" | "active" | "approval">("active");

  useEffect(() => {
    const unsub = queue.subscribe(() => setProposals(queue.list()));
    return unsub;
  }, [queue]);

  const filtered = useMemo(() => {
    if (filter === "approval") return proposals.filter((p) => p.status === "Approved" || p.status === "Ready");
    if (filter === "active") return proposals.filter((p) => !["Integrated", "Rejected", "Rolled Back"].includes(p.status));
    return proposals;
  }, [proposals, filter]);

  const handleApprove = useCallback(
    (id: string) => {
      queue.setStatus(id, "Approved");
      const proposal = queue.get(id);
      if (proposal) {
        // Emit real approval event → feeds into SelfDevelopmentLoop
        AgentEventBus.getInstance().emit({
          type: "cognitive_sync",
          taskId: id,
          source: "improvement-approved",
          detail: proposal.title,
        });
        // Start development in the sandbox
        SelfDevelopmentLoop.getInstance().approve(id);
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
              ? proposals.filter((p) => !["Integrated", "Rejected", "Rolled Back"].includes(p.status)).length
              : f === "approval"
                ? proposals.filter((p) => p.status === "Approved" || p.status === "Ready").length
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
                <span style={{ color: STATUS_COLORS[proposal.status] }}>{proposal.status}</span>
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

              {/* Actions */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {proposal.status === "Proposed" || proposal.status === "Detected" || proposal.status === "Analyzing" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleApprove(proposal.id)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: "1px solid rgba(52, 211, 153, 0.5)",
                        background: "rgba(52, 211, 153, 0.12)",
                        color: "#34d399",
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      APPROVE
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(proposal.id)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: "1px solid rgba(248, 113, 113, 0.35)",
                        background: "rgba(248, 113, 113, 0.08)",
                        color: "rgba(248, 113, 113, 0.85)",
                        fontSize: 11,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      REJECT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDefer(proposal.id)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "transparent",
                        color: "rgba(203, 228, 255, 0.5)",
                        fontSize: 11,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      DEFER
                    </button>
                  </>
                ) : proposal.status === "Approved" || proposal.status === "In Development" || proposal.status === "Testing" ? (
                  <div style={{ fontSize: 11, color: "rgba(167, 139, 250, 0.7)", fontStyle: "italic" }}>
                    In progress — {proposal.status.toLowerCase()}
                  </div>
                ) : proposal.status === "Ready" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleApprove(proposal.id)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: "1px solid #34d399",
                        background: "rgba(52, 211, 153, 0.18)",
                        color: "#34d399",
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      INTEGRATE
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(proposal.id)}
                      style={{
                        padding: "5px 14px",
                        borderRadius: 999,
                        border: "1px solid rgba(248, 113, 113, 0.35)",
                        background: "rgba(248, 113, 113, 0.08)",
                        color: "rgba(248, 113, 113, 0.85)",
                        fontSize: 11,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      REJECT
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: "rgba(148, 163, 184, 0.5)", fontStyle: "italic" }}>
                    {proposal.status}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </GenesisWindowFrame>
  );
}