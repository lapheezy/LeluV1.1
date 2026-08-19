/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS REASONING PANEL
 *
 * Makes the Reasoning + Planning pipeline stages inspectable.
 *
 * Reads state.cognition.reasoning / state.cognition.plan,
 * which CognitiveCore now records on every request that
 * produced them (see core/cognition/CognitiveCore.ts,
 * brain/CognitionRuntime.ts#think, core/AIService.ts#chat).
 *
 * Deliberately untyped against ReasoningResult/Plan directly
 * (same "unknown" convention GenesisCognitionState already
 * uses for agents/workspaces/nodes) so this DOM/UI layer
 * doesn't pull the AI-core type graph into the Genesis
 * scene subtree — it narrows defensively at render time.
 * ==========================================================
 */

import { useMemo } from "react";
import { useGenesis } from "./GenesisCore";
import GenesisWindowFrame from "./GenesisWindowFrame";

interface Hypothesis {
  id: string;
  statement: string;
  confidence: number;
  evidence: string[];
}

interface ReasoningResultShape {
  selected: Hypothesis | null;
  hypotheses: Hypothesis[];
  explanation: string;
}

interface PlanStepShape {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed";
}

interface PlanShape {
  id: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed";
  steps: PlanStepShape[];
}

const STATUS_COLOR: Record<string, string> = {
  pending: "rgba(148, 163, 184, 0.8)",
  running: "rgba(250, 204, 21, 0.9)",
  completed: "rgba(74, 222, 128, 0.9)",
  failed: "rgba(248, 113, 113, 0.9)",
};

function ConfidenceBar({ value, active }: { value: number; active: boolean }) {
  return (
    <div
      style={{
        height: 4,
        borderRadius: 999,
        background: "rgba(255,255,255,0.1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`,
          background: active
            ? "linear-gradient(90deg, #22d3ee, #38bdf8)"
            : "rgba(255,255,255,0.28)",
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

interface GenesisReasoningPanelProps {
  onClose: () => void;
}

export default function GenesisReasoningPanel({ onClose }: GenesisReasoningPanelProps) {
  const { state } = useGenesis();

  const reasoning = state.cognition?.reasoning as ReasoningResultShape | null | undefined;
  const plan = state.cognition?.plan as PlanShape | null | undefined;

  const sortedHypotheses = useMemo(() => {
    if (!reasoning?.hypotheses) {
      return [];
    }
    return [...reasoning.hypotheses].sort((a, b) => b.confidence - a.confidence);
  }, [reasoning]);

  const isActive = Boolean(reasoning?.selected) || Boolean(plan && plan.status === "running");

  return (
    <GenesisWindowFrame
      title="Reasoning & Planning"
      onClose={onClose}
      width="min(92vw, 500px)"
      active={isActive}
    >
      {/* ================= REASONING ================= */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.68, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.16em" }}>
          Reasoning
        </div>

        {reasoning?.selected ? (
          <>
            <div style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 10 }}>{reasoning.explanation}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sortedHypotheses.map((hypothesis) => {
                const active = hypothesis.id === reasoning.selected?.id;
                return (
                  <div key={hypothesis.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        opacity: active ? 1 : 0.65,
                        marginBottom: 3,
                      }}
                    >
                      <span>{hypothesis.statement}</span>
                      <span style={{ marginLeft: 8, whiteSpace: "nowrap" }}>
                        {Math.round(hypothesis.confidence * 100)}%
                      </span>
                    </div>
                    <ConfidenceBar value={hypothesis.confidence} active={active} />
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            No reasoning recorded yet — send a message and Lélu's chosen strategy will appear here.
          </div>
        )}
      </div>

      {/* ================= PLANNING ================= */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 11, opacity: 0.68, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.16em" }}>
          Active plan
        </div>

        {plan && plan.steps.length > 0 ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, overflowWrap: "anywhere" }}>{plan.goal}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {plan.steps.map((step, index) => (
                <div key={step.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12 }}>
                  <span
                    style={{
                      marginTop: 4,
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      flexShrink: 0,
                      background: STATUS_COLOR[step.status] ?? STATUS_COLOR.pending,
                      boxShadow: step.status === "running" ? `0 0 8px ${STATUS_COLOR.running}` : "none",
                    }}
                  />
                  <span style={{ opacity: step.status === "completed" ? 0.6 : 0.92 }}>
                    {index + 1}. {step.title}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            No multi-step plan active. Prompts written as a sequence of steps will show a breakdown here.
          </div>
        )}
      </div>
    </GenesisWindowFrame>
  );
}
