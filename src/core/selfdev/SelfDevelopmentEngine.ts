/**
 * ==========================================================
 * LÉLU
 * SELF-DEVELOPMENT ENGINE — the orchestration layer
 *
 *   OBSERVE   → SelfDiagnostics (real system state)
 *   UNDERSTAND→ ArchitectureMap + CapabilityRegistry
 *   IDENTIFY  → opportunity detector (bugs, limitations,
 *               optimizations, new capabilities, experiments)
 *   PLAN      → proposals into the ImprovementQueue
 *
 * Autonomous scope: the engine OBSERVES and PROPOSES (levels
 * 0-1). Implementation happens in the sandbox (level 2) only
 * when a proposal is approved. It never writes production.
 * ==========================================================
 */

import SelfDiagnostics, { type DiagnosticReport } from "./SelfDiagnostics";
import CapabilityRegistry from "./CapabilityRegistry";
import ImprovementQueue from "./ImprovementQueue";
import ArchitectureMap from "./ArchitectureMap";
import WorkQueue from "../cognition/WorkQueue";
import AgentStore from "../agents/AgentStore";
import ImprovementPrioritizer, { type PriorityScore } from "./ImprovementPrioritizer";
import EngineeringMemory from "./EngineeringMemory";

export interface PrioritizedProposal {
  id: string;
  title: string;
  priority: PriorityScore;
}

export interface DevelopmentCycleResult {
  updatedAt: number;
  diagnostics: DiagnosticReport;
  proposals: string[];
  cycle: number;
}

const MAX_PROPOSALS_PER_CYCLE = 3;

export default class SelfDevelopmentEngine {
  private static instance: SelfDevelopmentEngine | null = null;
  private cycleCount = 0;
  private lastResult: DevelopmentCycleResult | null = null;
  private lastTopProposalId: string | null = null;

  private constructor() {}

  public static getInstance(): SelfDevelopmentEngine {
    if (!SelfDevelopmentEngine.instance) {
      SelfDevelopmentEngine.instance = new SelfDevelopmentEngine();
    }
    return SelfDevelopmentEngine.instance;
  }

  public getLastResult(): DevelopmentCycleResult | null {
    return this.lastResult;
  }

  /** Run diagnostics + opportunity detection once. */
  public async runCycle(): Promise<DevelopmentCycleResult> {
    this.cycleCount += 1;
    const diagnostics = await SelfDiagnostics.getInstance().run();
    const proposals = this.detectOpportunities(diagnostics);

    const result: DevelopmentCycleResult = {
      updatedAt: Date.now(),
      diagnostics,
      proposals,
      cycle: this.cycleCount,
    };
    this.lastResult = result;
    return result;
  }

  /** Called from the cognitive loop — a lighter, non-reporting scan. */
  public async proactiveScan(): Promise<string[]> {
    const diagnostics = await SelfDiagnostics.getInstance().run();
    const proposals = this.detectOpportunities(diagnostics);
    this.recordTopPriority();
    return proposals;
  }

  /** Rank the open proposals and persist the top pick to engineering
      memory (only when it changes), so proactive cognition leaves an
      auditable trail of WHY a proposal is the next thing to work on. */
  public recordTopPriority(): PrioritizedProposal | null {
    const queue = ImprovementQueue.getInstance();
    const open = queue.open();
    const top = ImprovementPrioritizer.getInstance().topPick(open);
    if (!top) {
      return null;
    }
    if (top.proposal.id !== this.lastTopProposalId) {
      this.lastTopProposalId = top.proposal.id;
      EngineeringMemory.getInstance().record({
        kind: "lesson",
        topic: "prioritization",
        summary: `Top improvement: ${top.proposal.title} (${top.priority.score}/100 ${top.priority.level}) — ${top.priority.explanation}`,
        outcome: "neutral",
        improvementId: top.proposal.id,
      });
    }
    return { id: top.proposal.id, title: top.proposal.title, priority: top.priority };
  }

  /**
   * Opportunity detection over REAL state. Proposals are only created
   * when there is no open proposal covering the same ground, and the
   * cycle caps additions so the queue can't be flooded.
   */
  private detectOpportunities(diagnostics: DiagnosticReport): string[] {
    const queue = ImprovementQueue.getInstance();
    const registry = CapabilityRegistry.getInstance();
    const created: string[] = [];
    const max = MAX_PROPOSALS_PER_CYCLE;

    /* 1. Diagnostics errors → Bug proposals. */
    const errors = diagnostics.findings.filter((finding) => finding.severity === "error");
    for (const finding of errors.slice(0, max)) {
      const title = `Fix: ${finding.message.slice(0, 60)}`;
      if (queue.hasOpenSimilar(title)) {
        continue;
      }
      queue.add({
        title,
        kind: "Bug",
        problem: finding.message,
        observation: "Detected by self-diagnostics.",
        evidence: finding.evidence,
        proposedSolution: "Investigate the subsystem, reproduce, and fix inside the sandbox working copy.",
        expectedBenefit: "Removes the failing check from diagnostics.",
        dependencies: [],
        risk: "Low — sandbox-first.",
        requiredTools: ["sandbox"],
        requiredAgents: ["Engineering Agent"],
        complexity: "medium",
        version: "1.0",
        testPlan: "Re-run diagnostics and confirm the finding clears.",
      });
      created.push(finding.message.slice(0, 70));
    }

    /* 2. Planned capabilities → New Capability proposals. */
    const planned = registry.lacking();
    for (const capability of planned.slice(0, max)) {
      const title = `Build capability: ${capability.name}`;
      if (queue.hasOpenSimilar(title)) {
        continue;
      }
      queue.add({
        title,
        kind: "New Capability",
        problem: `Capability “${capability.name}” is ${capability.status} (${capability.description}).`,
        observation: "Capability registry scan.",
        evidence: `CapabilityRegistry.byStatus(${capability.status})`,
        proposedSolution: "Design the missing pieces, implement in the sandbox, test, then propose integration.",
        expectedBenefit: capability.description,
        dependencies: capability.dependencies,
        risk: "Depends on provider keys for provider-dependent capabilities.",
        requiredTools: capability.requiredTools,
        requiredAgents: capability.requiredAgents,
        complexity: "high",
        capabilityId: capability.id,
        version: "1.0",
        testPlan: "Extend the self-test suite with tests for the new capability.",
      });
      created.push(`planned: ${capability.name}`);
    }

    /* 3. Partial capabilities → complete-the-gap proposals. */
    const partial = registry.partial().filter((capability) => capability.id !== "ui-evolution");
    for (const capability of partial.slice(0, max)) {
      const title = `Complete capability: ${capability.name}`;
      if (queue.hasOpenSimilar(title)) {
        continue;
      }
      queue.add({
        title,
        kind: "Limitation",
        problem: `Capability “${capability.name}” is partial: ${capability.limitations.join("; ") || "incomplete"}.`,
        observation: "Capability registry scan.",
        evidence: `CapabilityRegistry.byStatus(partial)`,
        proposedSolution: "Close the most impactful limitation inside the sandbox, measure before/after.",
        expectedBenefit: "Moves the capability toward available.",
        dependencies: capability.dependencies,
        risk: capability.limitations.join("; "),
        requiredTools: capability.requiredTools,
        requiredAgents: capability.requiredAgents,
        complexity: "medium",
        capabilityId: capability.id,
        version: "1.0",
        testPlan: "Run the self-test suite + a before/after evaluation.",
      });
      created.push(`partial: ${capability.name}`);
    }

    /* 4. Agent repetition → workflow opportunity (evidence: multiple
       runnable agents + repeated executions). */
    try {
      const agents = AgentStore.getInstance().list().filter((agent) => agent.status !== "archived");
      const executions = agents.reduce((count, agent) => count + agent.executions.length, 0);
      if (agents.length >= 2 && executions >= 3) {
        const title = "Add reusable agent workflows";
        if (!queue.hasOpenSimilar(title)) {
          queue.add({
            title,
            kind: "Opportunity",
            problem: `${agents.length} agent(s) with ${executions} recorded executions — repeated sequences are not reusable.`,
            observation: "Agent execution history scan.",
            evidence: `AgentStore: ${agents.length} agents, ${executions} executions`,
            proposedSolution: "Design a workflow model (ordered steps + tool calls) agents can run and reuse.",
            expectedBenefit: "Recurring pipelines become one step.",
            dependencies: ["agents"],
            risk: "Workflow/tool contract design.",
            requiredTools: ["sandbox"],
            requiredAgents: ["Engineering Agent"],
            complexity: "high",
            capabilityId: "workflows",
            version: "1.0",
            testPlan: "Define a 3-step workflow, run it, verify order and captured results.",
          });
          created.push("workflow opportunity");
        }
      }
    } catch {
      // agent store scan is best-effort
    }

    /* 5. Blocked queue + stuck projects → REVIEW opportunity. */
    try {
      const blocked = WorkQueue.getInstance()
        .list()
        .filter((item) => item.category === "BLOCKED" && item.status === "open").length;
      if (blocked >= 2) {
        const title = `Resolve ${blocked} blocked work items`;
        if (!queue.hasOpenSimilar(title)) {
          queue.add({
            title,
            kind: "Opportunity",
            problem: `${blocked} work items are blocked and waiting.`,
            observation: "WorkQueue scan.",
            evidence: `WorkQueue BLOCKED: ${blocked}`,
            proposedSolution: "Review each blocked item; unblock, reprioritize, or drop.",
            expectedBenefit: "A cleaner queue and clearer next actions.",
            dependencies: [],
            risk: "None.",
            requiredTools: [],
            requiredAgents: [],
            complexity: "low",
            version: "1.0",
            testPlan: "Verify the blocked count drops after review.",
          });
          created.push("blocked-item review");
        }
      }
    } catch {
      // best-effort
    }

    /* 6. Architecture duplication heuristic → Optimization proposal. */
    try {
      const map = ArchitectureMap.getInstance();
      const creative = map.get("creative");
      const filesOverlap =
        creative && creative.files.some((file) => file.includes("Sketch") || file.includes("Render"));
      if (filesOverlap) {
        const title = "Unify sketch/render asset handling";
        if (!queue.hasOpenSimilar(title)) {
          queue.add({
            title,
            kind: "Optimization",
            problem: "Sketch and Render manage assets separately; agents cannot reuse one asset pipeline.",
            observation: "Architecture map inspection.",
            evidence: "Subsystem 'creative' spans SketchDocument, RenderStore, VideoProject",
            proposedSolution: "Introduce a shared asset model + project attachment used by both systems.",
            expectedBenefit: "One pipeline for agents and workflows.",
            dependencies: ["creative", "projects"],
            risk: "Migration of existing records.",
            requiredTools: ["sandbox"],
            requiredAgents: ["Engineering Agent"],
            complexity: "medium",
            capabilityId: "creative-tools",
            version: "1.0",
            testPlan: "Create a sketch + render, attach both through the shared pipeline, verify project context.",
          });
          created.push("shared asset pipeline");
        }
      }
    } catch {
      // best-effort
    }

    return created;
  }
}
