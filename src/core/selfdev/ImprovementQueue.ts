/**
 * ==========================================================
 * LÉLU
 * IMPROVEMENT QUEUE — the persistent self-improvement pipeline
 *
 * Every proposal carries the full engineering record: problem,
 * observation, evidence, proposed solution, expected benefit,
 * dependencies, risk, required tools/agents, complexity, test
 * plan — and a status that moves through an explicit workflow:
 *
 *   Detected → Analyzing → Proposed → Approved → In Development
 *   → Testing → Evaluation → Ready → Integrated
 *   → Rejected | Rolled Back
 *
 * Proposals are created by the opportunity detector (from real
 * diagnostics and state) and by the user. Nothing here modifies
 * production — implementation happens in the sandbox first.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type OpportunityKind =
  | "Bug"
  | "Limitation"
  | "Optimization"
  | "New Capability"
  | "Experiment"
  | "Opportunity";

export type ImprovementStatus =
  | "Detected"
  | "Analyzing"
  | "Proposed"
  | "Approved"
  | "In Development"
  | "Testing"
  | "Evaluation"
  | "Ready"
  | "Integrated"
  | "Rejected"
  | "Rolled Back";

export const IMPROVEMENT_STATUSES: ImprovementStatus[] = [
  "Detected",
  "Analyzing",
  "Proposed",
  "Approved",
  "In Development",
  "Testing",
  "Evaluation",
  "Ready",
  "Integrated",
  "Rejected",
  "Rolled Back",
];

export interface ImprovementProposal {
  id: string;
  title: string;
  problem: string;
  observation: string;
  evidence: string;
  proposedSolution: string;
  expectedBenefit: string;
  dependencies: string[];
  risk: string;
  requiredTools: string[];
  requiredAgents: string[];
  complexity: "low" | "medium" | "high";
  kind: OpportunityKind;
  status: ImprovementStatus;
  /** Which capability id this proposal targets, if any. */
  capabilityId?: string;
  version: string;
  testPlan: string;
  created: number;
  updated: number;
  /** Version-history id of the candidate snapshot, once developed. */
  candidateSnapshotId?: string;
  /** Rollback point (sandbox snapshot id) if this was rolled back. */
  rollbackSnapshotId?: string;
}

const KEY = "lelu.improvements.v1";

/** Seed proposals from the actual audit — real observations, not fiction. */
function seedProposals(): ImprovementProposal[] {
  const now = Date.now();
  const base = {
    observation: "Observed during the architecture audit.",
    evidence: "Architecture map + capability registry audit",
    status: "Proposed" as ImprovementStatus,
    version: "1.0",
    created: now,
    updated: now,
  };
  return [
    {
      ...base,
      id: "improve-shared-assets",
      title: "Unify sketch/render asset handling",
      kind: "Optimization",
      problem: "Sketch and Render manage assets with separate stores and formats.",
      proposedSolution: "Introduce a shared asset pipeline (common metadata, import/export, project attachment).",
      expectedBenefit: "One asset model; agents and workflows reuse the same tools.",
      dependencies: ["creative", "projects"],
      risk: "Migration of existing sketch/render records.",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: "medium",
      capabilityId: "creative-tools",
      testPlan: "Create a sketch and a render, attach both through the shared pipeline, verify project context lists both.",
    },
    {
      ...base,
      id: "improve-video-editing",
      title: "Add a video editing layer",
      kind: "Limitation",
      problem: "The video pipeline stops at projects/scenes/assets — there is no editing layer.",
      proposedSolution: "Add a timeline/sequence model (clip in/out points, ordering, transitions) on top of VideoProject.",
      expectedBenefit: "LÉLU can assemble sequences even before cloud generation exists.",
      dependencies: ["creative"],
      risk: "None (additive model).",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: "medium",
      capabilityId: "video",
      testPlan: "Create a project, add shots, build a timeline sequence, verify order and durations.",
    },
    {
      ...base,
      id: "improve-reusable-workflows",
      title: "Add reusable agent workflows",
      kind: "New Capability",
      problem: "Agents run one-off prompts; there is no saved, reusable sequence of steps.",
      proposedSolution: "A workflow model (ordered steps with tool calls + inputs) that any agent can run.",
      expectedBenefit: "Recurring pipelines become one click instead of repeated prompts.",
      dependencies: ["agents"],
      risk: "Workflow/tool contract design.",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: "high",
      capabilityId: "workflows",
      testPlan: "Define a 3-step workflow, run it through an agent, verify step order and result capture.",
    },
    {
      ...base,
      id: "experiment-memory-ranking",
      title: "Experiment: project-aware memory ranking",
      kind: "Experiment",
      problem: "Memory retrieval is global — it does not rank by the active project.",
      proposedSolution: "Bias memory retrieval by project relevance when project context exists.",
      expectedBenefit: "More relevant recalls during project work.",
      dependencies: ["memory", "projects"],
      risk: "May reduce general recall quality.",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: "medium",
      capabilityId: "memory",
      testPlan: "Seed memories for two projects, retrieve under each context, measure overlap.",
    },
    {
      ...base,
      id: "improve-regression-tests",
      title: "Automated regression testing for self-development",
      kind: "Opportunity",
      problem: "Self-tests exist but are only run on demand.",
      proposedSolution: "Run the self-test suite automatically after every improvement cycle and record results.",
      expectedBenefit: "Candidates can't be marked Ready on compiles alone.",
      dependencies: ["self-development"],
      risk: "None.",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: "low",
      capabilityId: "self-development",
      testPlan: "Trigger a fake cycle, verify the suite runs and results are recorded with the version.",
    },
    {
      ...base,
      id: "improve-avatar-cognition",
      title: "Connect avatar presence to cognition",
      kind: "Opportunity",
      problem: "Avatar presence states (listening/thinking/speaking/idle) are configured but not driven by live cognition.",
      proposedSolution: "Feed dialogue/thinking/speaking state into the avatar presence config automatically.",
      expectedBenefit: "The avatar feels alive and consistent with LÉLU's actual state.",
      dependencies: ["avatar", "cognition"],
      risk: "None (additive read).",
      requiredTools: ["sandbox"],
      requiredAgents: ["Engineering Agent"],
      complexity: "low",
      capabilityId: "avatar",
      testPlan: "Trigger thinking, verify the avatar presence state updates from the live signal.",
    },
  ];
}

export default class ImprovementQueue {
  private static instance: ImprovementQueue | null = null;
  private proposals: ImprovementProposal[];

  private constructor() {
    const stored = KvStore.getInstance().get<ImprovementProposal[]>(KEY);
    this.proposals = stored && stored.length > 0 ? stored : seedProposals();
    if (!stored || stored.length === 0) {
      this.persist();
    }
  }

  public static getInstance(): ImprovementQueue {
    if (!ImprovementQueue.instance) {
      ImprovementQueue.instance = new ImprovementQueue();
    }
    return ImprovementQueue.instance;
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.proposals);
    } catch {
      // best-effort
    }
  }

  public list(): ImprovementProposal[] {
    return [...this.proposals].sort((a, b) => b.updated - a.updated);
  }

  public get(id: string): ImprovementProposal | undefined {
    return this.proposals.find((proposal) => proposal.id === id);
  }

  public add(input: Omit<ImprovementProposal, "id" | "created" | "updated" | "status"> & { status?: ImprovementStatus }): ImprovementProposal {
    const created: ImprovementProposal = {
      ...input,
      id: crypto.randomUUID(),
      status: input.status ?? "Detected",
      created: Date.now(),
      updated: Date.now(),
    };
    this.proposals = [created, ...this.proposals];
    this.persist();
    return created;
  }

  public update(id: string, patch: Partial<ImprovementProposal>): void {
    this.proposals = this.proposals.map((proposal) =>
      proposal.id === id ? { ...proposal, ...patch, updated: Date.now() } : proposal,
    );
    this.persist();
  }

  public setStatus(id: string, status: ImprovementStatus): void {
    this.update(id, { status });
  }

  public remove(id: string): void {
    this.proposals = this.proposals.filter((proposal) => proposal.id !== id);
    this.persist();
  }

  public byStatus(status: ImprovementStatus): ImprovementProposal[] {
    return this.proposals.filter((proposal) => proposal.status === status);
  }

  public open(): ImprovementProposal[] {
    return this.proposals.filter((proposal) =>
      !["Integrated", "Rejected", "Rolled Back"].includes(proposal.status),
    );
  }

  /** Whether an open proposal already covers a similar title — used by
      the opportunity detector to avoid duplicates. */
  public hasOpenSimilar(title: string): boolean {
    const key = title.toLowerCase().slice(0, 28);
    return this.proposals.some(
      (proposal) =>
        !["Integrated", "Rejected", "Rolled Back"].includes(proposal.status) &&
        proposal.title.toLowerCase().includes(key),
    );
  }

  public statusCounts(): Record<ImprovementStatus, number> {
    const counts = Object.fromEntries(IMPROVEMENT_STATUSES.map((status) => [status, 0])) as Record<
      ImprovementStatus,
      number
    >;
    for (const proposal of this.proposals) {
      counts[proposal.status] += 1;
    }
    return counts;
  }
}
