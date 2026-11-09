/**
 * ==========================================================
 * LÉLU — ACQUISITION TYPES
 *
 * The vocabulary shared by the repository acquisition engine,
 * the Repo Executive, the Repo Executor and the pipeline.
 *
 * Nothing here is a claim: a stage is recorded only after the
 * operation that satisfies it returned a real result.
 * ==========================================================
 */

/** The repository-to-capability pipeline, in order. */
export const PIPELINE_STAGES = [
  "discover",
  "research",
  "acquire",
  "inspect",
  "adapt",
  "connect",
  "test",
  "approve",
  "integrate",
  "register",
  "use",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

export type LicenseRisk = "permissive" | "weak-copyleft" | "copyleft" | "unknown";

export function licenseRisk(spdx: string): LicenseRisk {
  const id = spdx.toUpperCase();
  if (["MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "ISC", "UNLICENSE", "0BSD", "CC0-1.0"].includes(id)) {
    return "permissive";
  }
  if (["MPL-2.0", "LGPL-2.1", "LGPL-3.0", "EPL-2.0"].includes(id)) return "weak-copyleft";
  if (["GPL-2.0", "GPL-3.0", "AGPL-3.0"].includes(id)) return "copyleft";
  return "unknown";
}

/** What the license obliges an integrator to do. */
export function licenseObligations(spdx: string): string[] {
  switch (licenseRisk(spdx)) {
    case "permissive":
      return ["Keep the copyright notice and license text with the adapted source.", "State what was changed."];
    case "weak-copyleft":
      return ["File-level copyleft: modified files stay under the same license.", "Ship the license text."];
    case "copyleft":
      return [
        "Derivative distribution must be under the same license.",
        "Network use may trigger source disclosure (AGPL) — review before shipping.",
      ];
    default:
      return ["No recognised license: treat as all rights reserved until clarified."];
  }
}

export interface AcquisitionLicense {
  spdx: string;
  name: string;
  path: string | null;
  /** The first lines of the detected license file, for attribution. */
  excerpt: string;
}

export interface AcquisitionVersion {
  version: string;
  commit: string;
  createdAt: number;
  note: string;
}

export interface AcquisitionSource {
  kind: "github" | "git" | "archive";
  identifier: string;
  url: string;
  host: string;
}

/** The runtime's record of one acquired repository. */
export interface AcquisitionRecord {
  id: string;
  name: string;
  source: AcquisitionSource;
  ref: string;
  commit: string;
  license: AcquisitionLicense;
  sizeBytes: number;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
  status: string;
  versions: AcquisitionVersion[];
  capability: string | null;
  notes: string[];
  /** sha256 of the record body at write time (tamper evidence). */
  fingerprint: string;
}

export interface AcquisitionLogEntry {
  at: number;
  action: string;
  ok: boolean;
  detail: string;
  durationMs?: number;
  exitCode?: number;
}

export interface RepositoryCandidate {
  id: string;
  source: "github" | "gitlab" | "codeberg" | "archive";
  identifier: string;
  url: string;
  description: string;
  stars: number;
  forks: number;
  language: string;
  topics: string[];
  license: string;
  defaultBranch: string;
  updatedAt: string;
  archived: boolean;
  openIssues: number;
}

export interface RepositoryFileEntry {
  path: string;
  type?: "file" | "dir";
  size?: number;
}

export interface RepositoryCommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface ResearchFindings {
  candidateId: string;
  identifier: string;
  /**
   * Where the evidence came from: the live registry API, or a real
   * clone when the API was unavailable. Never a guess.
   */
  provenance?: "github-api" | "acquired-repository";
  summary: string;
  /** Capability signals found in the manifest, README and tree. */
  capabilities: string[];
  /** Declared dependencies, deduplicated and bounded. */
  dependencies: string[];
  buildSystem: string;
  entryPoints: string[];
  license: {
    spdx: string;
    name: string;
    risk: LicenseRisk;
    obligations: string[];
  };
  maintenance: {
    lastCommit: string;
    lastCommitAt: string;
    commitsLast90Days: number;
    archived: boolean;
    stars: number;
    openIssues: number;
  };
  security: {
    /** Real observations, never a score. */
    observations: string[];
    riskLevel: "low" | "medium" | "high";
  };
  compatibility: {
    runtime: "browser" | "node" | "isomorphic" | "unknown";
    languages: string[];
    /** 0..1, from the rules in RepoExecutive.evaluate(). */
    score: number;
    reasons: string[];
  };
  researchedAt: number;
}

export interface CapabilityGap {
  capabilityId: string;
  name: string;
  status: string;
  reason: string;
}

export interface AcquisitionProposal {
  candidate: RepositoryCandidate;
  findings: ResearchFindings;
  /** 0..100 — the executive's own ranking, with every input recorded. */
  priority: number;
  reasons: string[];
  risks: string[];
  requestedCapability: string;
  recommendedIntegration: string;
}

export type AssignmentStatus =
  | "assigned"
  | "running"
  | "blocked"
  | "delivered"
  | "failed"
  | "cancelled";

export interface AcquisitionAssignment {
  id: string;
  createdAt: number;
  updatedAt: number;
  objective: string;
  requestedCapability: string;
  proposal: AcquisitionProposal;
  /** Which executive galaxy owns this work. */
  executive: "architect" | "engineering";
  /** Who assigned it: "repo-executive", a user, or an executive id. */
  assignedBy: string;
  status: AssignmentStatus;
  acquisitionId?: string;
  failure?: string;
}

export interface AdaptationEvidence {
  acquisitionId: string;
  capability: string;
  /** Files copied into the adaptation inside the acquisition. */
  extracted: string[];
  /** Files the executor wrote (adapter, attribution, manifest). */
  written: string[];
  /** Why this component was chosen — measured from the real source. */
  rationale: string[];
  branch: string | null;
  /** Commit of the adaptation inside the acquisition workspace. */
  commit: string | null;
  /** Upstream commit that was actually read and adapted. */
  sourceCommit: string;
  license: string;
}

export interface TestEvidence {
  command: string;
  exitCode: number;
  ok: boolean;
  durationMs: number;
  outputTail: string;
  ranAt: number;
}

export interface CapabilityRecord {
  id: string;
  name: string;
  description: string;
  source: {
    identifier: string;
    url: string;
    commit: string;
    acquiredAt: number;
  };
  license: {
    spdx: string;
    obligations: string[];
    attributionPath: string;
  };
  adaptedFrom: string[];
  registeredTools: string[];
  tests: TestEvidence[];
  approvedBy: string;
  approvalBasis: string;
  registeredAt: number;
  acquisitionId: string;
}

export interface PipelineEvent {
  stage: PipelineStage;
  at: number;
  ok: boolean;
  detail: string;
}

export interface PipelineRun {
  id: string;
  objective: string;
  stage: PipelineStage;
  startedAt: number;
  updatedAt: number;
  assignmentId: string | null;
  acquisitionId: string | null;
  events: PipelineEvent[];
  capability: CapabilityRecord | null;
  failure: string | null;
  /** True only when every stage through "use" has real evidence. */
  complete: boolean;
}

export const MAX_PIPELINE_EVENTS = 240;
