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
import AgentEventBus from "../agent/AgentEvents";
import LeluRuntime from "../runtime/LeluRuntime";
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

  /**
   * User-approved a proposal: mark it approved and fire
   * sandbox development. The actual develop() call runs
   * asynchronously through the existing sandbox pipeline.
   */
  public approve(proposalId: string): void {
    const proposal = this.queue.get(proposalId);
    if (!proposal) return;
    this.queue.setStatus(proposalId, "Approved");
    // Start sandbox development asynchronously
    this.develop(proposalId).catch((err) => {
      console.error("[SelfDevelopmentLoop] Auto-develop failed for", proposalId, err);
      // Don't lose the proposal — reset so user can retry
      this.queue.setStatus(proposalId, "Proposed");
    });
  }

  /**
   * The runtime goal this development run is driving, if any.
   *
   * Self-development used to run entirely outside the goal system: it
   * had no goal, so nothing recorded what it was trying to achieve, and
   * its verification results went nowhere the rest of LÉLU could see.
   */
  private goalId: string | null = null;

  /**
   * Record one pipeline phase — and mirror it into the runtime goal as a
   * verified/failed OUTCOME.
   *
   * Every phase of the pipeline already funnels through here, so this is
   * the one place the bridge belongs. The evidence is genuinely
   * measured: `typecheck` runs the real TypeScript build, `test` runs
   * the real test suite, `syntax` compiles the sandbox files. A step
   * marked verified here passed an actual check, not a model's opinion.
   */
  private addStep(steps: LoopStep[], step: string, status: LoopStep["status"], detail: string): void {
    steps.push({ step, status, detail, timestamp: Date.now() });
    if (!this.goalId) return;
    try {
      LeluRuntime.getInstance().recordGoalOutcome(this.goalId, {
        action: step,
        status: status === "done" ? "verified" : status === "failed" ? "failed" : "skipped",
        detail,
      });
    } catch {
      // Reporting progress must never break the development loop itself.
    }
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
    // One taskId per proposal (not per run) — the timeline groups all of
    // LÉLU's work on this proposal into one continuous, visible thread
    // across iterations, exactly like every other visible LÉLU activity
    // (research, provider calls, tool use). Without this, the sandbox
    // loop ran completely silently: nothing appeared until develop()'s
    // promise resolved, which looked like "nothing is happening" even
    // while real edit/syntax/test work was in progress.
    const events = AgentEventBus.getInstance();
    const taskId = proposalId;

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

    // Self-development IS a goal pipeline: observe → plan → implement →
    // test → verify. Opening a real runtime goal here is what makes the
    // work continuous and inspectable, rather than a detached routine
    // that finishes and leaves no trace in LÉLU's state.
    try {
      this.goalId = LeluRuntime.getInstance().setGoal(
        `Self-development: ${proposal.title}`,
        1,
        ["snapshot", "edit", "syntax", "test", "typecheck", "evaluate", "candidate"],
      ).id;
    } catch {
      this.goalId = null;
    }

    events.emit({ type: "task_started", taskId, label: `Coding: ${proposal.title}` });
    events.emit({ type: "tool_selected", taskId, tool: "selfdev.develop", label: "Sandbox development loop" });
    events.emit({ type: "tool_started", taskId, tool: "selfdev.develop", label: "Starting sandbox development" });

    const gate = AutonomyGate.getInstance();
    if (!gate.can(2)) {
      this.addStep(steps, "autonomy", "failed", `Blocked: sandbox work needs level 2 (${gate.describe(2)}).`);
      events.emit({ type: "task_failed", taskId, label: `Blocked: sandbox work needs autonomy level 2 (${gate.describe(2)}).` });
      this.lastRun = this.finish(proposal, false, "Rejected", steps, "Blocked by the autonomy gate.", started);
      return this.lastRun;
    }

    /* 1. Snapshot as the rollback point. */
    const snapshot = this.versions.snapshotSandbox(`Rollback point for “${proposal.title}”`, proposalId);
    this.addStep(steps, "snapshot", "done", `${Object.keys(snapshot.files).length} sandbox file(s) captured.`);
    events.emit({ type: "tool_result", taskId, tool: "version.snapshot", result: `Rollback point captured (${Object.keys(snapshot.files).length} file(s))` });

    /* 2. In Development. */
    this.queue.update(proposalId, { status: "In Development", rollbackSnapshotId: snapshot.id });
    this.addStep(steps, "status", "done", "Proposal → In Development.");

    /* 3. Apply edits to the working copy. */
    if (options.edits && options.edits.length > 0) {
      events.emit({ type: "tool_started", taskId, tool: "fs.edit", label: `Editing ${options.edits.length} sandbox file(s)` });
      for (const edit of options.edits) {
        const result = this.tools.editFile(edit.path, edit.content);
        if (!result.ok) {
          this.addStep(steps, "edit", "failed", `Edit failed for ${edit.path}: ${result.error}`);
          events.emit({ type: "tool_failed", taskId, tool: "fs.edit", error: `${edit.path}: ${result.error}` });
          events.emit({ type: "task_failed", taskId, label: `Edit failed for ${edit.path}` });
          this.lastRun = this.finish(proposal, false, "Testing", steps, "An edit failed — loop aborted.", started);
          return this.lastRun;
        }
        events.emit({ type: "file_changed", taskId, path: edit.path });
      }
      this.addStep(steps, "edit", "done", `${options.edits.length} edit(s) applied to the sandbox.`);
      events.emit({ type: "tool_result", taskId, tool: "fs.edit", result: `${options.edits.length} file(s) edited` });
    } else {
      this.addStep(steps, "edit", "skipped", "No explicit edits supplied — continuing with the existing working copy.");
    }

    /* 4. Syntax check (isolated worker). */
    events.emit({ type: "tool_selected", taskId, tool: "dev.syntax", label: "Syntax check" });
    events.emit({ type: "tool_started", taskId, tool: "dev.syntax", label: "Compiling sandbox files in the isolated worker" });
    const syntaxTool = await this.tools.syntaxCheck();
    const syntax = syntaxTool.data as SandboxRunResult | undefined;
    const syntaxOk = Boolean(syntaxTool.ok && syntax);
    this.addStep(steps, "syntax", syntaxOk ? "done" : "failed", syntaxTool.output.split("\n")[0] ?? "");
    if (syntaxOk) {
      events.emit({ type: "tool_result", taskId, tool: "dev.syntax", result: syntaxTool.output.split("\n")[0] ?? "Syntax OK" });
    } else {
      events.emit({ type: "tool_failed", taskId, tool: "dev.syntax", error: syntaxTool.output.split("\n")[0] ?? "Syntax check failed" });
    }

    /* 5. Run tests (isolated worker). */
    events.emit({ type: "tool_selected", taskId, tool: "dev.test", label: "Running sandbox tests" });
    events.emit({ type: "tool_started", taskId, tool: "dev.test", label: "Executing test files in the isolated worker" });
    const testsTool = await this.tools.runTests();
    const tests = testsTool.data as SandboxRunResult | undefined;
    const testsOk = Boolean(testsTool.ok && tests);
    const testSummary = tests ? `${tests.tests.filter((test) => test.passed).length}/${tests.tests.length} test(s) passed.` : testsTool.output;
    this.addStep(steps, "test", testsOk ? "done" : "failed", testSummary);
    if (testsOk) {
      events.emit({ type: "tool_result", taskId, tool: "dev.test", result: testSummary });
    } else {
      events.emit({ type: "tool_failed", taskId, tool: "dev.test", error: testSummary });
    }

    /* 6. Optional workspace typecheck (autonomy L3+). */
    let typecheckResult: WorkspaceCommandResult | undefined;
    if (options.runWorkspaceTypecheck) {
      events.emit({ type: "tool_selected", taskId, tool: "dev.typecheck", label: "Workspace typecheck" });
      events.emit({ type: "tool_started", taskId, tool: "dev.typecheck", label: "Running the real TypeScript build" });
      typecheckResult = await this.tools.workspaceTypecheck().then((result) => result.data as WorkspaceCommandResult | undefined);
      const typecheckStatus = typecheckResult?.ok ? "done" : typecheckResult?.available === false ? "skipped" : "failed";
      this.addStep(steps, "typecheck", typecheckStatus, typecheckResult?.ok ? "Workspace typecheck passed." : typecheckResult?.stderr ?? "Typecheck skipped.");
      if (typecheckStatus === "done") {
        events.emit({ type: "tool_result", taskId, tool: "dev.typecheck", result: "Typecheck passed" });
      } else if (typecheckStatus === "failed") {
        events.emit({ type: "tool_failed", taskId, tool: "dev.typecheck", error: typecheckResult?.stderr ?? "Typecheck failed" });
      }
    } else {
      this.addStep(steps, "typecheck", "skipped", "Workspace typecheck not requested.");
    }

    /* 7. Evaluate. */
    const typecheckOk = typecheckResult === undefined || typecheckResult.ok === true;
    const allGreen = syntaxOk && testsOk && typecheckOk;
    this.addStep(steps, "evaluate", allGreen ? "done" : "failed", allGreen ? "All checks green." : "One or more checks failed.");

    /* 8. Candidate. */
    if (allGreen) {
      events.emit({ type: "tool_started", taskId, tool: "version.candidate", label: "Building the verified candidate" });
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
      events.emit({ type: "tool_result", taskId, tool: "version.candidate", result: `Candidate ${candidateSnapshot.id} ready for approval` });
      events.emit({ type: "task_completed", taskId, label: `Ready: ${proposal.title} — candidate verified, awaiting approval` });
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
    events.emit({ type: "task_failed", taskId, label: `Checks failed for “${proposal.title}” — needs another pass`, error: !syntaxOk ? "syntax check failed" : !testsOk ? "tests failed" : "typecheck failed" });
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
    const events = AgentEventBus.getInstance();
    const taskId = proposalId;

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

    events.emit({ type: "tool_selected", taskId, tool: "selfdev.integrate", label: `Integrating: ${proposal.title}` });
    events.emit({ type: "tool_started", taskId, tool: "selfdev.integrate", label: "Recording version, capability, knowledge, self-model" });

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
    events.emit({ type: "tool_result", taskId, tool: "selfdev.integrate", result: `Integrated v${version.version}` });
    events.emit({ type: "task_completed", taskId, label: `Integrated v${version.version}: ${proposal.title}` });

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
    const events = AgentEventBus.getInstance();
    const taskId = proposalId;

    if (!proposal || proposal.status !== "Ready") {
      this.lastRun = this.finish(proposal ?? null, false, "Ready", steps, "Only a Ready candidate can be applied.", started);
      return this.lastRun;
    }

    events.emit({ type: "task_started", taskId, label: `Applying to production: ${proposal.title}` });

    if (!options.approved) {
      this.addStep(steps, "approval", "failed", "Explicit approval was not granted.");
      events.emit({ type: "task_failed", taskId, label: "Apply requires explicit approval" });
      this.lastRun = this.finish(proposal, false, "Ready", steps, "Approval required to apply.", started);
      return this.lastRun;
    }
    if (!AutonomyGate.getInstance().can(5)) {
      this.addStep(steps, "autonomy", "failed", "Production application requires autonomy level 5.");
      events.emit({ type: "task_failed", taskId, label: "Blocked: production changes require autonomy level 5" });
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
        events.emit({ type: "tool_started", taskId, tool: "engineer.write", label: `Writing ${realPath}` });
        const applied = await this.writeWorkspace(realPath, content);
        if (!applied) {
          this.addStep(steps, "apply", "failed", `Write failed for ${realPath} — rolling back.`);
          events.emit({ type: "tool_failed", taskId, tool: "engineer.write", error: `Write failed for ${realPath}` });
          await this.rollbackOriginals(originals);
          events.emit({ type: "task_failed", taskId, label: `Apply failed for ${realPath} — rolled back` });
          this.queue.update(proposalId, { status: "Rolled Back" });
          this.memory.record({ kind: "rollback", topic: proposal.title, summary: `Rolled back “${proposal.title}” — write failed.`, outcome: "failure", improvementId: proposalId });
          this.lastRun = this.finish(proposal, false, "Rolled Back", steps, "Apply failed and rolled back.", started);
          return this.lastRun;
        }
        this.addStep(steps, "apply", "done", `Applied ${realPath}.`);
        events.emit({ type: "file_changed", taskId, path: realPath });
      }
    }

    if (originals.length === 0) {
      this.addStep(steps, "apply", "skipped", "No changed files to apply.");
      events.emit({ type: "task_completed", taskId, label: "Nothing to apply — working copy matched production" });
      this.lastRun = this.finish(proposal, false, "Ready", steps, "Nothing to apply.", started);
      return this.lastRun;
    }

    events.emit({ type: "tool_selected", taskId, tool: "dev.typecheck", label: "Verifying with a real workspace typecheck" });
    events.emit({ type: "tool_started", taskId, tool: "dev.typecheck", label: "Running the real TypeScript build against production source" });
    const typecheck = await this.tools.workspaceTypecheck().then((result) => result.data as WorkspaceCommandResult | undefined);
    if (!typecheck?.ok) {
      this.addStep(steps, "verify", "failed", `Verification failed: ${typecheck?.stderr ?? "typecheck failed"}. Rolling back.`);
      events.emit({ type: "tool_failed", taskId, tool: "dev.typecheck", error: typecheck?.stderr ?? "Typecheck failed" });
      await this.rollbackOriginals(originals);
      events.emit({ type: "task_failed", taskId, label: "Verification failed — rolled back automatically" });
      this.queue.update(proposalId, { status: "Rolled Back" });
      this.memory.record({ kind: "rollback", topic: proposal.title, summary: `Rolled back “${proposal.title}” — verification failed.`, outcome: "failure", improvementId: proposalId });
      this.lastRun = this.finish(proposal, false, "Rolled Back", steps, "Verification failed and rolled back automatically.", started);
      return this.lastRun;
    }

    this.queue.update(proposalId, { status: "Integrated" });
    this.memory.record({ kind: "upgrade", topic: proposal.title, summary: `Applied and verified “${proposal.title}” to production source.`, outcome: "success", improvementId: proposalId });
    this.addStep(steps, "verify", "done", "Verification passed. Integrated.");
    events.emit({ type: "tool_result", taskId, tool: "dev.typecheck", result: "Verification passed" });
    events.emit({ type: "task_completed", taskId, label: `Applied to production and verified: ${proposal.title}` });
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
    // The run is over: close the goal it was driving. A successful run
    // completes it; a failed one stays ACTIVE and blocked, so the reason
    // it stopped survives for the next cycle to pick up rather than
    // vanishing when this function returns.
    if (this.goalId) {
      try {
        if (success) {
          LeluRuntime.getInstance().completeGoal(this.goalId);
        }
      } catch {
        // never let goal bookkeeping break the loop's own result
      }
      this.goalId = null;
    }

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
