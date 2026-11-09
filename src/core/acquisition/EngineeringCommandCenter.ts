/**
 * ==========================================================
 * LÉLU — ENGINEERING COMMAND CENTER
 *
 * The executive state behind the command center panel and the
 * conversational acquisition path:
 *
 *   PREPARE  — the Repo Executive discovers and researches a real
 *              candidate (or grounds one named repository in a clone)
 *   REVIEW   — the Engineering Council convenes in parallel
 *   APPROVE  — a named operator authorizes registration
 *   EXECUTE  — the capability pipeline acquires, adapts, tests,
 *              commits, registers and uses the result
 *
 * Nothing here fabricates a stage. A prepared objective keeps the
 * proposal it actually received; an executed objective keeps the
 * pipeline run and the capability record it actually produced.
 * ==========================================================
 */

import AcquisitionRuntime from "./AcquisitionRuntime";
import AcquisitionStore from "./AcquisitionStore";
import ApprovalGate from "./ApprovalGate";
import CapabilityPipeline, { type PipelineResult } from "./CapabilityPipeline";
import EngineeringCouncil, { type CouncilReport } from "./EngineeringCouncil";
import RepoExecutive from "./RepoExecutive";
import type {
  AcquisitionProposal,
  PipelineRun,
  TestEvidence,
} from "./AcquisitionTypes";
import KvStore from "../storage/KvStore";

export interface PrepareOptions {
  /** Ground the preparation in one known repository (owner/name). */
  repository?: string;
  keywords?: string;
  language?: string;
  minStars?: number;
  limit?: number;
  requestedBy?: string;
  /** Also ask the existing agent roster for specialist second opinions. */
  delegateToAgents?: boolean;
}

export interface PreparedObjective {
  id: string;
  objective: string;
  proposal: AcquisitionProposal;
  alternatives: AcquisitionProposal[];
  council: CouncilReport | null;
  preparedAt: number;
  requestedBy: string;
  requestedCapability: string;
}

export interface CommandSnapshot {
  runtime: {
    ok: boolean;
    error?: string;
    workspaceRoot?: string;
    acquisitions?: number;
    limits?: { maxAcquisitions: number; maxRepositoryBytes: number; maxArchiveBytes: number; maxTotalBytes?: number };
  };
  pending: PreparedObjective | null;
  assignments: ReturnType<AcquisitionStore["assignments"]>;
  gaps: ReturnType<RepoExecutive["capabilityGaps"]>;
  completed: ReturnType<AcquisitionStore["capabilities"]>;
  blocked: Array<{ id: string; objective: string; reason: string; at: number }>;
  runs: PipelineRun[];
  approvals: ReturnType<ApprovalGate["auditLog"]>;
}

export interface ExecuteResult {
  ok: boolean;
  result?: PipelineResult;
  error?: string;
  tests: TestEvidence[];
}

const PENDING_KEY = "lelu.command.pending.v1";

export default class EngineeringCommandCenter {
  private static instance: EngineeringCommandCenter | null = null;

  static getInstance(): EngineeringCommandCenter {
    if (!EngineeringCommandCenter.instance) EngineeringCommandCenter.instance = new EngineeringCommandCenter();
    return EngineeringCommandCenter.instance;
  }

  static resetForTests(): void {
    EngineeringCommandCenter.instance = null;
  }

  private readonly runtime = AcquisitionRuntime.getInstance();
  private readonly store = AcquisitionStore.getInstance();
  private readonly executive = RepoExecutive.getInstance();
  private readonly council = EngineeringCouncil.getInstance();

  getPending(): PreparedObjective | null {
    try {
      return KvStore.getInstance().get<PreparedObjective>(PENDING_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private savePending(pending: PreparedObjective | null): void {
    try {
      if (pending) KvStore.getInstance().set(PENDING_KEY, pending);
      else KvStore.getInstance().remove(PENDING_KEY);
    } catch {
      /* a missing cache is reported by getPending() */
    }
  }

  async prepare(objective: string, options: PrepareOptions = {}): Promise<PreparedObjective> {
    const trimmed = objective.trim();
    if (!trimmed) throw new Error("An acquisition objective is required.");

    const status = await this.runtime.status();
    if (!status.ok) {
      throw new Error(
        `The acquisition runtime is not reachable (${status.error}). Start the engineering runtime before preparing an objective.`,
      );
    }

    this.executive.refreshSources();
    let proposal: AcquisitionProposal;
    let alternatives: AcquisitionProposal[] = [];

    if (options.repository) {
      proposal = await this.executive.proposeFor(options.repository, trimmed, options.keywords ?? trimmed);
    } else {
      const discovery = await this.executive.proposals(trimmed, {
        keywords: options.keywords ?? trimmed,
        language: options.language,
        minStars: options.minStars,
        limit: options.limit ?? 8,
      });
      if (discovery.proposals.length === 0) {
        throw new Error(
          `No repository was found for "${options.keywords ?? trimmed}"` +
            (discovery.errors.length > 0
              ? ` (${discovery.errors.map((entry) => `${entry.sourceId}: ${entry.error}`).join("; ")})`
              : "."),
        );
      }
      proposal = discovery.proposals[0];
      alternatives = discovery.proposals.slice(1);
    }

    let council: CouncilReport | null = null;
    try {
      council = await this.council.review(
        proposal.findings,
        { structure: [], manifest: "", readme: "" },
        { delegateToAgents: options.delegateToAgents === true },
      );
    } catch {
      council = null;
    }

    const pending: PreparedObjective = {
      id: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      objective: trimmed,
      proposal,
      alternatives,
      council,
      preparedAt: Date.now(),
      requestedBy: options.requestedBy ?? "user",
      requestedCapability: options.keywords ?? trimmed,
    };
    this.savePending(pending);
    return pending;
  }

  /**
   * Execute the prepared objective. The caller must name the operator;
   * that name is used for the commit approval and the registration
   * approval, and the pipeline still requires both of its own gates.
   */
  async execute(pendingId: string, approver: string): Promise<ExecuteResult> {
    const pending = this.getPending();
    if (!pending || pending.id !== pendingId) {
      return { ok: false, error: "No matching prepared objective. Prepare it again.", tests: [] };
    }
    if (!approver.trim()) {
      return { ok: false, error: "Registration requires a named operator.", tests: [] };
    }

    const testRun = await this.runtime.selftest();
    if (!testRun.ok) {
      return {
        ok: false,
        error: `LÉLU's integration test could not be run (${testRun.error}), so registration was not attempted.`,
        tests: [],
      };
    }
    const evidence: TestEvidence = {
      command: "npx tsx --test tests/engineering-command-center.test.ts tests/repository-acquisition.test.ts",
      exitCode: testRun.result.status,
      ok: testRun.result.ok,
      durationMs: testRun.result.durationMs,
      outputTail: `${testRun.result.stdout}\n${testRun.result.stderr}`.trim().slice(-4000),
      ranAt: Date.now(),
    };
    if (!evidence.ok) {
      return {
        ok: false,
        error: `LÉLU's integration test exited ${evidence.exitCode}; registration requires a passing command.`,
        tests: [evidence],
      };
    }

    const capability = pending.requestedCapability.toLowerCase();
    const use = /cache|memory|storage|recall|lru/.test(capability)
      ? { tool: "memory.cache", args: { action: "selftest" } }
      : { tool: "kb.search", args: { query: pending.requestedCapability, limit: 3 } };

    const result = await CapabilityPipeline.getInstance().run({
      objective: pending.objective,
      keywords: pending.requestedCapability,
      repository: pending.proposal.candidate.identifier,
      requestedBy: pending.requestedBy,
      approver,
      integrationTests: [evidence],
      runRepositoryTests: false,
      use,
    });

    if (result.capability) this.savePending(null);
    return {
      ok: Boolean(result.capability && result.run.complete),
      result,
      error: result.run.failure ?? undefined,
      tests: [evidence],
    };
  }

  snapshot(): CommandSnapshot {
    const status = this.runtime.isReachable();
    const assignments = this.store.assignments();
    return {
      runtime: {
        ok: status,
        error: this.runtime.getLastError() ?? undefined,
      },
      pending: this.getPending(),
      assignments,
      gaps: this.executive.capabilityGaps(),
      completed: this.store.capabilities(),
      blocked: assignments
        .filter((assignment) => assignment.status === "blocked" || assignment.status === "failed")
        .map((assignment) => ({
          id: assignment.id,
          objective: assignment.objective,
          reason: assignment.failure ?? assignment.status,
          at: assignment.updatedAt,
        })),
      runs: this.store.runs(),
      approvals: ApprovalGate.getInstance().auditLog().slice(-12),
    };
  }

  /** Discard a prepared objective without running it. */
  discard(): void {
    this.savePending(null);
  }
}
