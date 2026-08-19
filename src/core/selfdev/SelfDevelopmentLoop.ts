/**
 * ==========================================================
 * LÉLU
 * SELF-DEVELOPMENT LOOP — the closed engineering feedback loop
 *
 * The real workflow (not a description of one):
 *
 *   proposal (Approved)
 *     → snapshot sandbox (rollback point)
 *     → edit working copy
 *     → run syntax check (isolated worker)
 *     → run tests (isolated worker)
 *     → [optional] workspace typecheck (autonomy L3+)
 *     → evaluate (all green?)
 *     → create candidate (snapshot + patch)
 *     → Ready — STOP at the approval boundary
 *
 * `integrate()` then records the result (version, registries,
 * knowledge, self-model, engineering memory) once the user
 * approves. Actual production source application is a separate,
 * hard-gated step (autonomy L5) exposed as `applyCandidate()` —
 * implemented but never auto-invoked.
 * ==========================================================
 */

import ImprovementQueue, { type ImprovementProposal, type ImprovementStatus } from "./ImprovementQueue";
import VersionHistory from "./VersionHistory";
import SelfCode from "./SelfCode";
import EngineeringToolset from "./EngineeringToolset";
import EngineeringMemory from "./EngineeringMemory";
import CapabilityRegistry from "./CapabilityRegistry";
import KnowledgeLibrary from "../cognition/KnowledgeLibrary";
import SelfModel from "../cognition/SelfModel";
import AutonomyGate from "../cognition/AutonomyGate";
import type { SandboxRunResult } from "../engineering/SandboxRuntime";
import type { WorkspaceCommandResult } from "../engineering/WorkspaceRuntime";

export interface LoopEdit {
  path: string;
  content: string;
}

export interface LoopStep {
  step: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail: string;
  timestamp: number;
}

export interface LoopRunResult {
  proposalId: string;
  title: string;
  started: number;
  finished: number;
  success: boolean;
  finalStatus: ImprovementStatus;
  steps: LoopStep[];
  syntaxResult?: SandboxRunResult;
  testResult?: SandboxRunResult;
  typecheckResult?: WorkspaceCommandResult;
  candidateSnapshotId?: string;
  patch?: string;
  summary: string;
}

export default class SelfDevelopmentLoop {
  private static instance: SelfDevelopmentLoop | null = null;

  private readonly queue = ImprovementQueue.getInstance();
  private readonly versions = VersionHistory.getInstance();
  private readonly tools = EngineeringToolset.getInstance();
  private readonly selfCode = SelfCode.getInstance();
  private readonly memory = EngineeringMemory.getInstance();
  private readonly registry = CapabilityRegistry.getInstance();
  private readonly knowledge = KnowledgeLibrary.getInstance();
  private readonly self = SelfModel.getInstance();
  private lastRun: LoopRunResult | null = null;

  private constructor() {}

  public static getInstance(): SelfDevelopmentLoop {
    if (!SelfDevelopmentLoop.instance) {
      SelfDevelopmentLoop.instance = new SelfDevelopmentLoop();
    }
    return SelfDevelopmentLoop.instance;
  }

  public getLastRun(): LoopRunResult | null {
    return this.lastRun;
  }

  private addStep(steps: LoopStep[], step: string, status: LoopStep["status"], detail: string): void {
    steps.push({ step, status, detail, timestamp: Date.now() });
  }

  /**
   * Run the full sandbox development pipeline for an approved proposal.
   * Stops at Ready — production application is a separate approval step.
   */
  public async develop(
    proposalId: string,
    options: { edits?: LoopEdit[]; runWorkspaceTypecheck?: boolean } = {},
  ): Promise<LoopRunResult> {
    const proposal = this.queue.get(proposalId);
    const steps: LoopStep[] = [];
    const started = Date.now();

    if (!proposal) {
      this.lastRun = {
        proposalId,
        title: "(unknown)",
        started,
        finished: Date.now(),
        success: false,
        finalStatus: "Rejected",
        steps,
        summary: "Proposal not found.",
      };
      return this.lastRun;
    }

    const gate = AutonomyGate.getInstance();
    if (!gate.can(2)) {
      this.addStep(steps, "autonomy", "failed", `Blocked: sandbox work needs level 2 (${gate.describe(2)}).`);
      this.lastRun = this.finish(proposal, false, "Rejected", steps, "Blocked by the autonomy gate.", started);
      return this.lastRun;
    }

    /* 1. Snapshot as the rollback point. */
    const snapshot = this.versions.snapshotSandbox(`Rollback point for “${proposal.title}”`, proposalId);
    this.addStep(steps, "snapshot", "done", `${Object.keys(snapshot.files).length} sandbox file(s) captured.`);

    /* 2. In Development. */
    this.queue.update(proposalId, { status: "In Development", rollbackSnapshotId: snapshot.id });
    this.addStep(steps, "status", "done", "Proposal → In Development.");

    /* 3. Apply edits to the working copy. */
    if (options.edits && options.edits.length > 0) {
      for (const edit of options.edits) {
        const result = this.tools.editFile(edit.path, edit.content);
        if (!result.ok) {
          this.addStep(steps, "edit", "failed", `Edit failed for ${edit.path}: ${result.error}`);
          this.lastRun = this.finish(proposal, false, "Testing", steps, "An edit failed — loop aborted.", started);
          return this.lastRun;
        }
      }
      this.addStep(steps, "edit", "done", `${options.edits.length} edit(s) applied to the sandbox.`);
    } else {
      this.addStep(steps, "edit", "skipped", "No explicit edits supplied — continuing with the existing working copy.");
    }

    /* 4. Syntax check (isolated worker). */
    const syntaxTool = await this.tools.syntaxCheck();
    const syntax = syntaxTool.data as SandboxRunResult | undefined;
    const syntaxOk = Boolean(syntaxTool.ok && syntax);
    this.addStep(steps, "syntax", syntaxOk ? "done" : "failed", syntaxTool.output.split("\n")[0] ?? "");

    /* 5. Run tests (isolated worker). */
    const testsTool = await this.tools.runTests();
    const tests = testsTool.data as SandboxRunResult | undefined;
    const testsOk = Boolean(testsTool.ok && tests);
    const testSummary = tests ? `${tests.tests.filter((test) => test.passed).length}/${tests.tests.length} test(s) passed.` : testsTool.output;
    this.addStep(steps, "test", testsOk ? "done" : "failed", testSummary);

    /* 6. Optional workspace typecheck (autonomy L3+). */
    let typecheckResult: WorkspaceCommandResult | undefined;
    if (options.runWorkspaceTypecheck) {
      typecheckResult = await this.tools.workspaceTypecheck().then((result) => result.data as WorkspaceCommandResult | undefined);
      this.addStep(steps, "typecheck", typecheckResult?.ok ? "done" : typecheckResult?.available === false ? "skipped" : "failed", typecheckResult?.ok ? "Workspace typecheck passed." : typecheckResult?.stderr ?? "Typecheck skipped.");
    } else {
      this.addStep(steps, "typecheck", "skipped", "Workspace typecheck not requested.");
    }

    /* 7. Evaluate. */
    const typecheckOk = typecheckResult === undefined || typecheckResult.ok === true;
    const allGreen = syntaxOk && testsOk && typecheckOk;
    this.addStep(steps, "evaluate", allGreen ? "done" : "failed", allGreen ? "All checks green." : "One or more checks failed.");

    /* 8. Candidate. */
    if (allGreen) {
      const candidate = await this.selfCode.buildPatchText();
      const candidateSnapshot = this.versions.snapshotSandbox(`Candidate for “${proposal.title}”`, proposalId);
      this.queue.update(proposalId, { status: "Ready", candidateSnapshotId: candidateSnapshot.id });
      this.memory.record({
        kind: "attempt",
        topic: proposal.title,
        summary: `Candidate ready for “${proposal.title}” — syntax + ${tests?.tests.length ?? 0} test(s) green.`,
        outcome: "success",
        improvementId: proposalId,
      });
      this.addStep(steps, "candidate", "done", `Candidate snapshot ${candidateSnapshot.id}. Stopping at the approval boundary.`);
      this.lastRun = this.finish(
        { ...proposal, status: "Ready" },
        true,
        "Ready",
        steps,
        "Candidate developed and verified — awaiting approval.",
        started,
        syntax,
        tests,
        typecheckResult,
        candidateSnapshot.id,
        candidate,
      );
      return this.lastRun;
    }

    /* 9. Failure → record + Testing (iteration point). */
    this.queue.update(proposalId, { status: "Testing" });
    this.memory.record({
      kind: "attempt",
      topic: proposal.title,
      summary: `Development attempt failed for “${proposal.title}” — checks did not pass.`,
      outcome: "failure",
      improvementId: proposalId,
    });
    this.addStep(steps, "candidate", "skipped", "No candidate — checks failed; left in Testing for iteration.");
    this.lastRun = this.finish(proposal, false, "Testing", steps, "Checks failed — iterate on the working copy and run again.", started, syntax, tests, typecheckResult);
    return this.lastRun;
  }

  /**
   * Record an approved integration: version + registries + knowledge +
   * self-model + engineering memory. Does NOT write production source —
   * that is `applyCandidate()`, gated at autonomy L5.
   */
  public integrate(proposalId: string): LoopRunResult {
    const proposal = this.queue.get(proposalId);
    const steps: LoopStep[] = [];
    const started = Date.now();

    if (!proposal || proposal.status !== "Ready") {
      this.lastRun = {
        proposalId,
        title: proposal?.title ?? "(unknown)",
        started,
        finished: Date.now(),
        success: false,
        finalStatus: proposal?.status ?? "Rejected",
        steps,
        summary: "Only a Ready candidate can be integrated.",
      };
      return this.lastRun;
    }

    const version = this.versions.recordVersion({
      version: `1.${(this.versions.listVersions().length + 1).toFixed(1)}`,
      changeDescription: proposal.title,
      filesChanged: Object.keys(this.selfCode.workingCopies()),
      tests: "Self-test suite + sandbox tests",
      results: "Green at development time",
      knownIssues: "None recorded",
      rollbackSnapshotId: proposal.rollbackSnapshotId,
      improvementId: proposalId,
    });
    this.addStep(steps, "version", "done", `Recorded v${version.version}.`);

    if (proposal.capabilityId) {
      const capability = this.registry.get(proposal.capabilityId);
      if (capability && capability.status !== "available") {
        this.registry.update(proposal.capabilityId, { status: "available" });
        this.addStep(steps, "capability", "done", `Capability “${capability.name}” → available.`);
      } else {
        this.addStep(steps, "capability", "skipped", `Capability “${proposal.capabilityId}” unchanged.`);
      }
    } else {
      this.addStep(steps, "capability", "skipped", "No targeted capability.");
    }

    this.queue.update(proposalId, { status: "Integrated" });
    this.memory.record({
      kind: "upgrade",
      topic: proposal.title,
      summary: `Integrated “${proposal.title}” (v${version.version}).`,
      outcome: "success",
      improvementId: proposalId,
      version: version.version,
    });
    this.self.recordDiscovery(`Completed: ${proposal.title}`);
    this.knowledge.add({
      domain: "selfdev",
      title: `Result: ${proposal.title}`,
      detail: `Integrated ${proposal.title} (v${version.version}). Tests: ${version.tests}. ${proposal.expectedBenefit}`,
      status: "tested",
      source: "SelfDevelopmentLoop.integrate",
    });
    this.addStep(steps, "record", "done", "Engineering memory + knowledge + self-model updated.");

    this.lastRun = this.finish({ ...proposal, status: "Integrated" }, true, "Integrated", steps, `Integrated v${version.version}.`, started);
    return this.lastRun;
  }

  /**
   * Apply the candidate's working-copy changes to production source via
   * the workspace write endpoint, then verify with a typecheck. Rolls
   * back automatically on failure. Hard-gated: autonomy L5 AND explicit
   * `approved: true`. Never auto-invoked.
   */
  public async applyCandidate(proposalId: string, options: { approved: boolean }): Promise<LoopRunResult> {
    const proposal = this.queue.get(proposalId);
    const steps: LoopStep[] = [];
    const started = Date.now();

    if (!proposal || proposal.status !== "Ready") {
      this.lastRun = this.finish(proposal ?? null, false, "Ready", steps, "Only a Ready candidate can be applied.", started);
      return this.lastRun;
    }
    if (!options.approved) {
      this.addStep(steps, "approval", "failed", "Explicit approval was not granted.");
      this.lastRun = this.finish(proposal, false, "Ready", steps, "Approval required to apply.", started);
      return this.lastRun;
    }
    if (!AutonomyGate.getInstance().can(5)) {
      this.addStep(steps, "autonomy", "failed", "Production application requires autonomy level 5.");
      this.lastRun = this.finish(proposal, false, "Ready", steps, "Blocked: production changes require autonomy L5.", started);
      return this.lastRun;
    }

    const copies = this.selfCode.workingCopies();
    const originals: { path: string; content: string }[] = [];
    for (const [sandboxPath, realPath] of Object.entries(copies)) {
      const original = await this.selfCode.readCoreSource(realPath);
      const modified = await this.tools.readFile(sandboxPath);
      if (original === null || !modified.ok) {
        continue;
      }
      const content = (modified.data as { content?: string } | undefined)?.content;
      if (typeof content === "string" && content !== original) {
        originals.push({ path: realPath, content: original });
        const applied = await this.writeWorkspace(realPath, content);
        if (!applied) {
          this.addStep(steps, "apply", "failed", `Write failed for ${realPath} — rolling back.`);
          await this.rollbackOriginals(originals);
          this.queue.update(proposalId, { status: "Rolled Back" });
          this.memory.record({ kind: "rollback", topic: proposal.title, summary: `Rolled back “${proposal.title}” — write failed.`, outcome: "failure", improvementId: proposalId });
          this.lastRun = this.finish(proposal, false, "Rolled Back", steps, "Apply failed and rolled back.", started);
          return this.lastRun;
        }
        this.addStep(steps, "apply", "done", `Applied ${realPath}.`);
      }
    }

    if (originals.length === 0) {
      this.addStep(steps, "apply", "skipped", "No changed files to apply.");
      this.lastRun = this.finish(proposal, false, "Ready", steps, "Nothing to apply.", started);
      return this.lastRun;
    }

    const typecheck = await this.tools.workspaceTypecheck().then((result) => result.data as WorkspaceCommandResult | undefined);
    if (!typecheck?.ok) {
      this.addStep(steps, "verify", "failed", `Verification failed: ${typecheck?.stderr ?? "typecheck failed"}. Rolling back.`);
      await this.rollbackOriginals(originals);
      this.queue.update(proposalId, { status: "Rolled Back" });
      this.memory.record({ kind: "rollback", topic: proposal.title, summary: `Rolled back “${proposal.title}” — verification failed.`, outcome: "failure", improvementId: proposalId });
      this.lastRun = this.finish(proposal, false, "Rolled Back", steps, "Verification failed and rolled back automatically.", started);
      return this.lastRun;
    }

    this.queue.update(proposalId, { status: "Integrated" });
    this.memory.record({ kind: "upgrade", topic: proposal.title, summary: `Applied and verified “${proposal.title}” to production source.`, outcome: "success", improvementId: proposalId });
    this.addStep(steps, "verify", "done", "Verification passed. Integrated.");
    this.lastRun = this.finish(proposal, true, "Integrated", steps, "Applied and verified.", started);
    return this.lastRun;
  }

  private async writeWorkspace(path: string, content: string): Promise<boolean> {
    try {
      const response = await fetch("/api/engineer/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      const payload = (await response.json()) as { ok?: boolean };
      return payload.ok === true;
    } catch {
      return false;
    }
  }

  private async rollbackOriginals(originals: { path: string; content: string }[]): Promise<void> {
    for (const { path, content } of originals) {
      try {
        await fetch("/api/engineer/write", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path, content }),
        });
      } catch {
        // best-effort rollback
      }
    }
  }

  private finish(
    proposal: ImprovementProposal | null,
    success: boolean,
    finalStatus: ImprovementStatus,
    steps: LoopStep[],
    summary: string,
    started: number,
    syntaxResult?: SandboxRunResult,
    testResult?: SandboxRunResult,
    typecheckResult?: WorkspaceCommandResult,
    candidateSnapshotId?: string,
    patch?: string,
  ): LoopRunResult {
    return {
      proposalId: proposal?.id ?? "",
      title: proposal?.title ?? "(unknown)",
      started,
      finished: Date.now(),
      success,
      finalStatus,
      steps,
      syntaxResult,
      testResult,
      typecheckResult,
      candidateSnapshotId,
      patch,
      summary,
    };
  }
}
