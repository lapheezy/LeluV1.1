/**
 * ==========================================================
 * LÉLU
 * IMPROVEMENT PRIORITIZER — why one improvement over another
 *
 * A deterministic, explainable scoring model. Every factor is
 * derived from REAL state (proposal kind, complexity, risk,
 * evidence source, autonomy, capability dependencies, current
 * workload) and contributes a documented weight to a 0-100
 * score. The result includes a per-factor breakdown and a
 * one-line explanation, so LÉLU can justify a choice instead of
 * producing an opaque ranking.
 * ==========================================================
 */

import type { ImprovementProposal } from "./ImprovementQueue";
import ArchitectureMap from "./ArchitectureMap";
import CapabilityRegistry from "./CapabilityRegistry";
import AutonomyGate from "../cognition/AutonomyGate";

export type PriorityLevel = "low" | "medium" | "high" | "critical";

export interface PriorityFactor {
  label: string;
  value: string;
  weight: number;
  contribution: number;
}

export interface PriorityScore {
  score: number;
  level: PriorityLevel;
  factors: PriorityFactor[];
  explanation: string;
}

interface ScoredProposal {
  proposal: ImprovementProposal;
  priority: PriorityScore;
}

export default class ImprovementPrioritizer {
  private static instance: ImprovementPrioritizer | null = null;

  private constructor() {}

  public static getInstance(): ImprovementPrioritizer {
    if (!ImprovementPrioritizer.instance) {
      ImprovementPrioritizer.instance = new ImprovementPrioritizer();
    }
    return ImprovementPrioritizer.instance;
  }

  /** Score a single proposal against real state. */
  public prioritize(proposal: ImprovementProposal): PriorityScore {
    const factors: PriorityFactor[] = [];

    /* Impact — derived from the proposal kind (0-30). */
    const impactByKind: Record<string, number> = {
      Bug: 30,
      "New Capability": 26,
      Limitation: 22,
      Optimization: 18,
      Opportunity: 16,
      Experiment: 12,
    };
    const impact = impactByKind[proposal.kind] ?? 14;
    factors.push({ label: "Impact", value: proposal.kind, weight: 30, contribution: impact });

    /* Difficulty — lower difficulty scores higher (0-15). */
    const difficulty = proposal.complexity === "low" ? 15 : proposal.complexity === "medium" ? 9 : 4;
    factors.push({ label: "Difficulty", value: proposal.complexity, weight: 15, contribution: difficulty });

    /* Risk — lower risk scores higher (0-15). */
    const riskText = proposal.risk.toLowerCase();
    const riskScore = /low|none|minimal/.test(riskText) ? 15 : /high|severe/.test(riskText) ? 4 : 9;
    factors.push({ label: "Risk", value: proposal.risk.slice(0, 40), weight: 15, contribution: riskScore });

    /* Confidence — evidence source (0-15). */
    const evidence = proposal.evidence.toLowerCase();
    const confidence = /user|diagnostic|capabilityregistry|agentstore|architecture/.test(evidence) ? 14 : 7;
    factors.push({ label: "Confidence", value: proposal.evidence.slice(0, 40), weight: 15, contribution: confidence });

    /* Dependency importance — does this unblock other capabilities? (0-15). */
    let dependencyScore = 4;
    try {
      if (proposal.capabilityId) {
        const dependents = ArchitectureMap.getInstance().dependentsOf(proposal.capabilityId).length;
        dependencyScore = Math.min(15, 4 + dependents * 3);
      }
    } catch {
      dependencyScore = 4;
    }
    factors.push({ label: "Dependency value", value: proposal.capabilityId ?? "general", weight: 15, contribution: dependencyScore });

    /* Feasibility — is it executable in the available runtime? (0-10). */
    const requiresProvider = proposal.requiredTools.some((tool) => tool === "cloud" || tool === "provider");
    const feasibility = requiresProvider ? 3 : 10;
    factors.push({
      label: "Feasibility",
      value: requiresProvider ? "needs external provider" : "runs in the sandbox",
      weight: 10,
      contribution: feasibility,
    });

    const score = Math.round(factors.reduce((total, factor) => total + factor.contribution, 0));
    const level: PriorityLevel = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 40 ? "medium" : "low";

    const top = [...factors].sort((a, b) => b.contribution - a.contribution)[0];
    return {
      score,
      level,
      factors,
      explanation: `${proposal.title} scores ${score}/100 (${level}). Strongest signal: ${top.label} (${top.value}). ${
        requiresProvider ? "It needs an external provider, which caps feasibility." : "It can run fully inside the sandbox."
      }`,
    };
  }

  /** Rank a set of proposals. */
  public rank(proposals: ImprovementProposal[]): ScoredProposal[] {
    return proposals
      .map((proposal) => ({ proposal, priority: this.prioritize(proposal) }))
      .sort((a, b) => b.priority.score - a.priority.score);
  }

  /** The single most valuable open proposal. */
  public topPick(proposals: ImprovementProposal[]): ScoredProposal | null {
    return this.rank(proposals)[0] ?? null;
  }

  /** Quick capability-gap ranking signal for the engine's proactive scan. */
  public capabilityGapScore(capabilityId: string): number {
    try {
      const capability = CapabilityRegistry.getInstance().get(capabilityId);
      if (!capability) {
        return 0;
      }
      const dependents = ArchitectureMap.getInstance().dependentsOf(capabilityId).length;
      const statusWeight = capability.status === "planned" ? 6 : capability.status === "partial" ? 4 : 2;
      return Math.min(15, statusWeight + dependents * 3);
    } catch {
      return 0;
    }
  }

  /** Whether the autonomy gate currently permits the work a proposal implies. */
  public autonomyVerdict(proposal: ImprovementProposal): { allowed: boolean; level: number; label: string } {
    const gate = AutonomyGate.getInstance();
    // Editing/running in the sandbox = level 2; workspace commands = level 3.
    const needsWorkspace = /workspace|typecheck|build|test/.test(proposal.testPlan.toLowerCase());
    const required = needsWorkspace ? 3 : 2;
    return { allowed: gate.can(required), level: required, label: gate.describe(required) };
  }
}
