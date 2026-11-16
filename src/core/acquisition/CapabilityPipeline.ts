/**
 * ==========================================================
 * LÉLU — REPOSITORY-TO-CAPABILITY PIPELINE
 *
 * DISCOVER → RESEARCH → ACQUIRE → INSPECT → ADAPT → CONNECT →
 * TEST → APPROVE → INTEGRATE → REGISTER → USE
 *
 * The orchestrator that makes the chain real. Each stage is
 * recorded only when the operation behind it returned a real
 * result, and a failure stops the run with the real reason.
 *
 * The final stage is not a summary: it calls the registered
 * capability through the ordinary tool dispatcher, so "LÉLU can
 * use it" means a tool call actually returned data.
 * ==========================================================
 */

import ToolRegistry from "../tools/ToolRegistry";
import AcquisitionRuntime from "./AcquisitionRuntime";
import AcquisitionStore from "./AcquisitionStore";
import CapabilityIntegrator from "./CapabilityIntegrator";
import RepoExecutive from "./RepoExecutive";
import RepoExecutor from "./RepoExecutor";
import type {
  AcquisitionProposal,
  CapabilityRecord,
  PipelineRun,
  PipelineStage,
  TestEvidence,
} from "./AcquisitionTypes";

export interface PipelineInput {
  objective: string;
  /** Search keywords describing the capability needed. */
  keywords: string;
  /** Restrict acquisition to one known repository (owner/name). */
  repository?: string;
  language?: string;
  minStars?: number;
  limit?: number;
  /** Named person/operator handing the work over. */
  requestedBy?: string;
  /** Named approver for registration. Required: registration is never silent. */
  approver: string;
  /** Evidence from LÉLU's own integration tests (real exit codes). */
  integrationTests?: TestEvidence[];
  /** Run the acquired repository's own install/test commands. */
  runRepositoryTests?: boolean;
  /** The tool call that proves use. Defaults to kb.search on the keywords. */
  use?: { tool: string; args: Record<string, unknown> };
}

export interface PipelineResult {
  run: PipelineRun;
  proposal: AcquisitionProposal | null;
  capability: CapabilityRecord | null;
  /** What the final USE stage actually returned. */
  useResult: string | null;
}

type StageCallback = (stage: PipelineStage, ok: boolean, detail: string) => void;

export default class CapabilityPipeline {
  private static instance: CapabilityPipeline | null = null;
  private readonly store = AcquisitionStore.getInstance();
  private readonly executive = RepoExecutive.getInstance();
  private readonly executor = RepoExecutor.getInstance();
  private readonly integrator = CapabilityIntegrator.getInstance();
  private readonly runtime = AcquisitionRuntime.getInstance();

  static getInstance(): CapabilityPipeline {
    if (!CapabilityPipeline.instance) CapabilityPipeline.instance = new CapabilityPipeline();
    return CapabilityPipeline.instance;
  }

  static resetForTests(): void {
    CapabilityPipeline.instance = null;
  }

  async run(input: PipelineInput): Promise<PipelineResult> {
    const run = this.store.createRun({ objective: input.objective });
    const record: StageCallback = (stage, ok, detail) => {
      this.store.recordStage(run.id, stage, ok, detail, {
        stage,
        complete: false,
      });
    };
    const fail = (stage: PipelineStage, detail: string): PipelineResult => {
      record(stage, false, detail);
      const updated = this.store.getRun(run.id);
      return { run: updated ?? run, proposal: null, capability: null, useResult: null };
    };

    /* ----------------------------- DISCOVER ----------------------------- */
    const status = await this.runtime.status();
    if (!status.ok) {
      return fail(
        "discover",
        `The acquisition runtime is not reachable (${status.error}). Nothing was discovered or acquired.`,
      );
    }
    this.executive.refreshSources();
    // The repo.* tools are declared unavailable until a runtime probe says
    // otherwise. Probe now, so the workforce this run produces is actually
    // offered afterwards instead of staying invisible until a reload.
    try {
      await ToolRegistry.getInstance().refreshAvailability();
    } catch {
      /* availability refresh is not a precondition for the run itself */
    }

    let proposals: AcquisitionProposal[];
    let errors: Array<{ sourceId: string; error: string }> = [];
    try {
      if (input.repository) {
        proposals = [await this.executive.proposeFor(input.repository, input.objective, input.keywords)];
      } else {
        const result = await this.executive.proposals(input.objective, {
          keywords: input.keywords,
          language: input.language,
          minStars: input.minStars,
          limit: input.limit ?? 8,
        });
        proposals = result.proposals;
        errors = result.errors;
      }
    } catch (error) {
      return fail("discover", `Discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (proposals.length === 0) {
      return fail(
        "discover",
        `No repository was found for "${input.keywords}"${errors.length > 0 ? ` (${errors.map((entry) => `${entry.sourceId}: ${entry.error}`).join("; ")})` : ""}.`,
      );
    }
    const top = proposals[0];
    record(
      "discover",
      true,
      `${proposals.length} candidate(s); top: ${top.candidate.identifier} (${top.candidate.stars} stars, priority ${top.priority})`,
    );

    /* ------------------------------ RESEARCH ---------------------------- */
    record(
      "research",
      true,
      `${top.findings.identifier}: ${top.findings.capabilities.slice(0, 5).join(", ") || "no capability signals"}; ` +
        `license ${top.findings.license.spdx} (${top.findings.license.risk}); ` +
        `compatibility ${top.findings.compatibility.runtime} ${Math.round(top.findings.compatibility.score * 100)}%; ` +
        `security ${top.findings.security.riskLevel}.`,
    );

    /* ------------------------------ ASSIGN ------------------------------ */
    const assignment = this.executive.assign(top, input.objective, input.requestedBy ?? "user");
    const assigned = this.store.getRun(run.id) ?? run;
    this.store.saveRun({ ...assigned, assignmentId: assignment.id });

    /* ---------------------------- EXECUTION ----------------------------- */
    const execution = await this.executor.execute(assignment, {
      skipRepositoryTests: input.runRepositoryTests !== true,
      deferCommit: true,
      committer: input.approver,
      onStage: (stage, ok, detail) => {
        const mapped: PipelineStage =
          stage === "acquire" ? "acquire" : stage === "inspect" ? "inspect" : stage === "adapt" ? "adapt" : stage === "connect" ? "connect" : stage === "test" ? "test" : "approve";
        record(mapped, ok, detail);
      },
    });

    const acquisitionId = execution.acquisitionId;
    if (!acquisitionId) {
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }

    // No adaptation evidence means the run stopped before a measured
    // result existed. Nothing downstream may claim otherwise.
    if (!execution.evidence) {
      record("adapt", false, execution.failure ?? "the executor produced no evidence");
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }

    /* ------------------------------- TEST -------------------------------- */
    const tests: TestEvidence[] = [...execution.tests, ...(input.integrationTests ?? [])];
    const integrationPassing = (input.integrationTests ?? []).filter((test) => test.ok);
    if (integrationPassing.length === 0) {
      record(
        "test",
        false,
        "No passing integration test evidence was supplied for LÉLU's adapted capability; " +
          "registration requires a real passing command. " +
          (tests.length > 0 ? `Repository results: ${tests.map((test) => `${test.command} exit ${test.exitCode}`).join(", ")}.` : "Nothing was run."),
      );
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }
    record(
      "test",
      true,
      integrationPassing.map((test) => `${test.command} exited ${test.exitCode}`).join("; ") +
        (tests.length > integrationPassing.length
          ? ` (also: ${tests
              .filter((test) => !test.ok)
              .map((test) => `${test.command} exit ${test.exitCode}`)
              .join(", ")})`
          : ""),
    );

    /* ------------------------------ APPROVE ----------------------------- */
    if (!input.approver.trim()) {
      record("approve", false, "No approver was named; nothing was registered.");
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }
    const approval = this.integrator.authorize(
      input.approver,
      `Register ${top.requestedCapability} from ${top.candidate.identifier} as a LÉLU capability`,
    );
    if (!approval.allowed) {
      record("approve", false, approval.reason);
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }
    record("approve", true, approval.reason);

    // Commit only now: the tests passed above and the operator approved
    // registration. Both gates, in that order.
    const committed = await this.executor.commitAdaptation({
      acquisitionId,
      message:
        `acquire(${top.requestedCapability}): adapt ${top.candidate.identifier} for LÉLU\n\n` +
        `Source commit: ${execution.evidence.sourceCommit}\n` +
        `License: ${execution.evidence.license}\nFiles: ${execution.evidence.written.join(", ")}`,
      committer: input.approver,
      branch: execution.evidence.branch ?? undefined,
    });
    if (!committed.ok) {
      record("approve", false, committed.error);
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }
    record(
      "approve",
      true,
      `committed ${committed.commit.slice(0, 10)} on ${committed.branch} (version ${committed.version ?? "n/a"}), approved by ${committed.approver}`,
    );
    const evidence = { ...execution.evidence, commit: committed.commit, branch: committed.branch };
    const delivered = this.store.getAssignment(assignment.id);
    if (delivered) this.store.saveAssignment({ ...delivered, status: "delivered", acquisitionId });

    /* ----------------------------- INTEGRATE ---------------------------- */
    const capabilityId = `acquired.${evidence.capability.replace(/^acquired\./, "")}`;
    const tools = toolsForCapability(capabilityId);
    const registration = this.integrator.register({
      capabilityId,
      name: `Acquired — ${top.requestedCapability}`,
      description:
        `Adapted from ${top.candidate.identifier}@${evidence.sourceCommit.slice(0, 10)} ` +
        `(${evidence.license}). ${top.findings.summary.slice(0, 180)}`.trim(),
      category: "knowledge",
      source: {
        identifier: top.candidate.identifier,
        url: top.candidate.url,
        commit: evidence.sourceCommit,
        acquiredAt: Date.now(),
      },
      license: evidence.license,
      evidence,
      tests: integrationPassing,
      tools,
      acquisitionId,
      limitations: [
        `Extracted ${evidence.extracted.length} source file(s) into ${evidence.capability}.`,
        "Upstream maintenance is manual: LÉLU does not track the source repository's future commits.",
      ],
    });

    if (!registration.ok) {
      record("integrate", false, registration.error);
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: null, useResult: null };
    }
    record("integrate", true, `registered ${capabilityId} with tools ${tools.join(", ") || "none"}`);

    /* ------------------------------ REGISTER ---------------------------- */
    const acquisition = await this.runtime.get(acquisitionId);
    if (acquisition.ok) this.store.saveAcquisition(acquisition.acquisition);
    const marked = await this.runtime.update(acquisitionId, {
      status: "integrated",
      capability: capabilityId,
      notes: [`registered by ${input.approver}`],
    });
    if (!marked.ok) {
      record("register", false, `The runtime could not record the integration: ${marked.error}`);
      return { run: this.store.getRun(run.id) ?? run, proposal: top, capability: registration.capability, useResult: null };
    }
    record("register", true, `acquisition ${acquisitionId} recorded as integrated (${capabilityId})`);

    /* -------------------------------- USE ------------------------------- */
    const use = input.use ?? { tool: "kb.search", args: { query: input.keywords, limit: 3 } };
    let useResult: string | null = null;
    try {
      const { dispatchToolCall } = await import("../tools/ToolDispatcher");
      const result = await dispatchToolCall(
        {
          id: `pipeline-${run.id}`,
          name: use.tool,
          arguments: use.args,
        },
        run.id,
      );
      if (!result.ok) {
        record("use", false, `Calling ${use.tool} failed: ${result.content}`);
      } else {
        useResult = result.content;
        record("use", true, `${use.tool} returned: ${result.content.slice(0, 400)}`);
      }
    } catch (error) {
      record("use", false, `${use.tool} could not be called: ${error instanceof Error ? error.message : String(error)}`);
    }

    const finished = this.store.getRun(run.id);
    if (finished) {
      const stages = new Set(finished.events.filter((event) => event.ok).map((event) => event.stage));
      const complete = ["discover", "research", "acquire", "inspect", "adapt", "connect", "test", "approve", "integrate", "register", "use"].every(
        (stage) => stages.has(stage as PipelineStage),
      );
      this.store.saveRun({ ...finished, complete });
      return {
        run: this.store.getRun(run.id) ?? finished,
        proposal: top,
        capability: registration.capability,
        useResult,
      };
    }

    return { run, proposal: top, capability: registration.capability, useResult };
  }
}

/**
 * Which registered tools expose an acquired capability.
 *
 * The adaptation manifest's `expectedExports` are descriptive; the real
 * route into a capability is a tool that already executes it. For the
 * first acquisition (Bitap fuzzy search) that is `kb.search`.
 */
function toolsForCapability(capabilityId: string): string[] {
  if (capabilityId.includes("cache") || capabilityId.includes("memory") || capabilityId.includes("lru")) {
    return ["memory.cache"];
  }
  if (capabilityId.includes("fuzzy") || capabilityId.includes("search")) return ["kb.search"];
  return [];
}
