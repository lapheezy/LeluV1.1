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

import ImprovementQueue, {
  PENDING_APPROVAL_STATUSES,
  RUNNING_STATUSES,
  type ImprovementProposal,
  type ImprovementStatus,
  type ProposalBlock,
  type ProposalExecution,
} from "./ImprovementQueue";
import ProposalEngineer, { type ProposalSourceAccess } from "./ProposalEngineer";
import EngineeringWorkspace from "../engineering/EngineeringWorkspace";
import EngineeringAuthorization from "../engineering/EngineeringAuthorization";
import AgentEventBus from "../agent/AgentEvents";
import VersionHistory from "./VersionHistory";
import SelfCode from "./SelfCode";
import EngineeringToolset from "./EngineeringToolset";
import EngineeringMemory from "./EngineeringMemory";
import CapabilityRegistry from "./CapabilityRegistry";
import KnowledgeLibrary from "../cognition/KnowledgeLibrary";
import SelfModel from "../cognition/SelfModel";
import AutonomyGate from "../cognition/AutonomyGate";
import LeluRuntime from "../runtime/LeluRuntime";
import type { SandboxRunResult } from "../engineering/SandboxRuntime";
import type { WorkspaceCommandResult } from "../engineering/WorkspaceRuntime";
import SelfTestRunner from "./SelfTestRunner";

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
  public approve(proposalId: string): boolean {
    const proposal = this.queue.get(proposalId);
    if (!proposal) return false;
    // Approval is a decision about PENDING work. It queues the proposal
    // and starts its first development run. It never re-runs work that
    // is running, ready, applied or recorded — that used to happen when
    // the Updates panel's INTEGRATE called approve() on a Ready
    // candidate and sent it back to development forever.
    const queuedNotStarted = proposal.status === "Approved";
    if (!PENDING_APPROVAL_STATUSES.includes(proposal.status) && !queuedNotStarted) return false;
    this.queue.update(proposalId, { status: "Approved", blocked: undefined });
    this.develop(proposalId).catch((err) => {
      console.error("[SelfDevelopmentLoop] develop failed for", proposalId, err);
      this.fail(proposalId, `Development crashed: ${err instanceof Error ? err.message : String(err)}`);
    });
    return true;
  }

  /**
   * Explicitly repeat the action that last stopped: development after a
   * Failed or Blocked run, or the apply that was Blocked. This is the
   * "new development request" — approval never does it implicitly.
   */
  public async retry(proposalId: string): Promise<LoopRunResult> {
    const proposal = this.queue.get(proposalId);
    if (proposal?.status === "Blocked" && proposal.blocked?.action === "apply") {
      return this.applyCandidate(proposalId, { approved: true });
    }
    return this.develop(proposalId);
  }

  /** Mark a proposal Blocked with the reason and what unblocks it. Never leaves it "in progress". */
  private block(proposalId: string, block: Omit<ProposalBlock, "at">, execution?: ProposalExecution): void {
    this.queue.update(proposalId, {
      status: "Blocked",
      blocked: { ...block, at: Date.now() },
      ...(execution ? this.withExecution(proposalId, { ...execution, finished: Date.now(), outcome: "Blocked", error: block.reason }) : {}),
    });
    AgentEventBus.getInstance().emit({ type: "task_failed", taskId: proposalId, label: `Blocked: ${block.reason}`, error: block.unblock });
  }

  private fail(proposalId: string, error: string, execution?: ProposalExecution): void {
    this.queue.update(proposalId, {
      status: "Failed",
      blocked: undefined,
      ...(execution ? this.withExecution(proposalId, { ...execution, finished: Date.now(), outcome: "Failed", error }) : {}),
    });
  }

  /** The proposal patch that records this execution as the latest (keeping the last few). */
  private withExecution(proposalId: string, execution: ProposalExecution): Partial<ImprovementProposal> {
    const previous = (this.queue.get(proposalId)?.executions ?? []).filter((item) => item.executionId !== execution.executionId);
    return { lastExecution: execution, executions: [...previous, execution].slice(-8) };
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
    // Explicit sandbox edits (the self-test probe, scripted runs) keep
    // the original in-browser sandbox pipeline. A proposal developed from
    // the UI has no edits: its change must be GENERATED first.
    if (!options.edits || options.edits.length === 0) {
      return this.developProposal(proposalId);
    }
    return this.developInSandbox(proposalId, options);
  }

  private async developInSandbox(
    proposalId: string,
    options: { edits?: LoopEdit[]; runWorkspaceTypecheck?: boolean },
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
      this.block(proposalId, {
        reason: `Sandbox work needs autonomy level 2; the current level is ${gate.getLevel()}.`,
        requiredAutonomy: 2,
        unblock: "Raise autonomy to L2 (Sandbox) in Self Development → Autonomy, then Retry.",
        action: "develop",
      });
      this.lastRun = this.finish(proposal, false, "Blocked", steps, "Blocked by the autonomy gate.", started);
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
          this.fail(proposalId, `Edit failed for ${edit.path}: ${result.error}`);
          this.lastRun = this.finish(proposal, false, "Failed", steps, "An edit failed — loop aborted.", started);
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
    this.fail(proposalId, !syntaxOk ? "syntax check failed" : !testsOk ? "tests failed" : "typecheck failed");
    this.memory.record({
      kind: "attempt",
      topic: proposal.title,
      summary: `Development attempt failed for “${proposal.title}” — checks did not pass.`,
      outcome: "failure",
      improvementId: proposalId,
    });
    this.addStep(steps, "candidate", "skipped", "No candidate — checks failed; left in Testing for iteration.");
    events.emit({ type: "task_failed", taskId, label: `Checks failed for “${proposal.title}” — needs another pass`, error: !syntaxOk ? "syntax check failed" : !testsOk ? "tests failed" : "typecheck failed" });
    this.lastRun = this.finish(proposal, false, "Failed", steps, "Checks failed — iterate on the working copy and run again.", started, syntax, tests, typecheckResult);
    return this.lastRun;
  }

  /**
   * Develop a proposal for real: generate the change, stage it in an
   * isolated copy of the project, and check THAT change.
   *
   *   retrieve → gate → copy → inspect + generate (engineering agent)
   *   → stage in copy → syntax (changed files) → relevant tests
   *   → typecheck (the copy) → diff → Ready for review | Failed | Blocked
   *
   * A run that produces no change is Failed with the reason. It is never
   * Ready: "Ready" means a generated, verified diff exists to review.
   */
  private async developProposal(proposalId: string): Promise<LoopRunResult> {
    const proposal = this.queue.get(proposalId);
    const steps: LoopStep[] = [];
    const started = Date.now();
    const events = AgentEventBus.getInstance();
    const taskId = proposalId;
    if (!proposal) {
      this.lastRun = this.finish(null, false, "Failed", steps, "Proposal not found.", started);
      return this.lastRun;
    }
    if (RUNNING_STATUSES.includes(proposal.status)) {
      this.lastRun = this.finish(proposal, false, proposal.status, steps, `Already running (${proposal.status}).`, started);
      return this.lastRun;
    }

    const execution: ProposalExecution = {
      executionId: `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "develop",
      started,
      filesInspected: [],
      filesChanged: [],
      checks: [],
    };
    const save = (status?: ImprovementStatus) =>
      this.queue.update(proposalId, { ...(status ? { status } : {}), ...this.withExecution(proposalId, { ...execution }) });
    const check = (name: string, ok: boolean | null, detail: string) => {
      execution.checks.push({ name, ok, detail });
      this.addStep(steps, name, ok === null ? "skipped" : ok ? "done" : "failed", detail);
      save();
    };

    try {
      this.goalId = LeluRuntime.getInstance().setGoal(`Self-development: ${proposal.title}`, 1, [
        "generate", "stage", "syntax", "test", "typecheck", "diff",
      ]).id;
    } catch {
      this.goalId = null;
    }
    events.emit({ type: "task_started", taskId, label: `Developing: ${proposal.title} (${execution.executionId})` });

    /* gate: this runs commands in a project copy — "Execute approved" (L3). */
    const gate = AutonomyGate.getInstance();
    if (!gate.can(3)) {
      this.block(proposalId, {
        reason: `Developing a change runs commands in a project copy, which needs autonomy level 3; the current level is ${gate.getLevel()}.`,
        requiredAutonomy: 3,
        unblock: "Raise autonomy to L3 (Execute approved) in Self Development → Autonomy, then Retry.",
        action: "develop",
      }, execution);
      this.lastRun = this.finish(proposal, false, "Blocked", steps, "Blocked by the autonomy gate.", started);
      return this.lastRun;
    }
    const workspace = EngineeringWorkspace.getInstance();
    if (!(await workspace.runtimeReachable())) {
      this.block(proposalId, {
        reason: "No development runtime is serving /api/engineer here, so there is no project copy to work in.",
        unblock: "Run LÉLU from its development runtime (npm run dev / the Node server), then Retry.",
        action: "develop",
      }, execution);
      this.lastRun = this.finish(proposal, false, "Blocked", steps, "No development runtime.", started);
      return this.lastRun;
    }

    this.queue.update(proposalId, { status: "In Development", blocked: undefined });
    save();

    /* copy */
    events.emit({ type: "tool_started", taskId, tool: "workspace.copy", label: "Copying the project into an isolated workspace" });
    const copy = await workspace.createCopy(`ws-${proposalId.slice(0, 24).replace(/[^A-Za-z0-9-]/g, "-")}-${Date.now().toString(36)}`);
    if (!copy.ok) {
      this.addStep(steps, "copy", "failed", copy.error);
      this.fail(proposalId, `Could not create a workspace copy: ${copy.error}`, execution);
      events.emit({ type: "task_failed", taskId, label: "Could not create a workspace copy", error: copy.error });
      this.lastRun = this.finish(proposal, false, "Failed", steps, copy.error, started);
      return this.lastRun;
    }
    const workspaceId = copy.workspace.id;
    execution.workspaceId = workspaceId;
    this.addStep(steps, "copy", "done", `Workspace ${workspaceId} (${copy.workspace.fileCount} files).`);
    events.emit({ type: "tool_result", taskId, tool: "workspace.copy", result: `Workspace ${workspaceId}: ${copy.workspace.fileCount} files` });
    save();

    /* inspect + generate */
    events.emit({ type: "tool_selected", taskId, tool: "selfdev.engineer", label: "Engineering agent: inspect and generate the change" });
    const access = this.copyAccess(workspaceId);
    const generated = await new ProposalEngineer().generate(proposal, access, (label) =>
      events.emit({ type: "tool_started", taskId, tool: "selfdev.engineer", label }),
    );
    execution.agent = generated.agent;
    execution.plan = generated.plan;
    execution.filesInspected = generated.filesInspected;
    if (!generated.ok) {
      this.addStep(steps, "generate", "failed", generated.error ?? "No change generated.");
      this.fail(proposalId, `No change was generated: ${generated.error}`, execution);
      events.emit({ type: "task_failed", taskId, label: "No change was generated", error: generated.error });
      this.lastRun = this.finish(proposal, false, "Failed", steps, `No change was generated: ${generated.error}`, started);
      return this.lastRun;
    }
    this.addStep(steps, "generate", "done", `${generated.files.length} file(s) changed by ${generated.agent}. ${generated.plan ?? ""}`.trim());
    events.emit({ type: "tool_result", taskId, tool: "selfdev.engineer", result: `${generated.files.length} file(s) generated by ${generated.agent}` });

    /* stage in the copy */
    for (const file of generated.files) {
      const written = await workspace.writeFile(workspaceId, file.path, file.content);
      if (!written.ok) {
        this.addStep(steps, "stage", "failed", `${file.path}: ${written.error}`);
        this.fail(proposalId, `Staging failed for ${file.path}: ${written.error}`, execution);
        this.lastRun = this.finish(proposal, false, "Failed", steps, "Staging failed.", started);
        return this.lastRun;
      }
      events.emit({ type: "file_changed", taskId, path: `${workspaceId}/${file.path}` });
    }
    const staged = await workspace.diff(workspaceId, true);
    execution.filesChanged = staged.map((change) => change.path);
    execution.diff = staged.map((change) => change.patch ?? `(${change.status} ${change.path})`).join("\n");
    this.addStep(steps, "stage", "done", `Staged in ${workspaceId}: ${execution.filesChanged.join(", ")}.`);
    this.queue.update(proposalId, { status: "Testing" });
    save();

    /* syntax — the changed source files only */
    const codeFiles = execution.filesChanged.filter((path) => /\.(ts|tsx|js|mjs)$/.test(path));
    events.emit({ type: "tool_started", taskId, tool: "dev.syntax", label: `Parsing ${codeFiles.length} changed file(s)` });
    const syntax = codeFiles.length > 0 ? await workspace.checkFiles(workspaceId, "syntax-files", codeFiles) : null;
    const syntaxOk = syntax === null ? null : syntax.ok;
    check("syntax", syntaxOk, syntax === null ? "No changed code files." : "error" in syntax ? syntax.error : `exit ${syntax.exitCode}: ${firstLines(syntax.output)}`);

    /* relevant tests — inside the copy */
    const testFiles = generated.tests.filter((path) => /^tests\/[A-Za-z0-9_.-]+\.test\.tsx?$/.test(path));
    execution.tests = testFiles;
    events.emit({ type: "tool_started", taskId, tool: "dev.test", label: testFiles.length ? `Running ${testFiles.join(", ")}` : "No relevant test file identified" });
    const tests = testFiles.length > 0 ? await workspace.checkFiles(workspaceId, "test-files", testFiles) : null;
    check(
      "test",
      tests === null ? null : tests.ok,
      tests === null ? "No relevant test file was identified or created — no tests ran." : "error" in tests ? tests.error : `${testFiles.join(", ")} — ${testSummaryOf(tests.output)} (exit ${tests.exitCode})`,
    );

    /* typecheck — the whole copy, with the change in it */
    events.emit({ type: "tool_started", taskId, tool: "dev.typecheck", label: "Typechecking the workspace copy" });
    const typecheck = await workspace.validate(workspaceId, "typecheck");
    check("typecheck", typecheck.ok, "error" in typecheck ? typecheck.error : `exit ${typecheck.exitCode} in ${Math.round(typecheck.durationMs / 1000)}s${typecheck.ok ? "" : `: ${firstLines(typecheck.output)}`}`);

    const green = syntaxOk !== false && (tests === null || tests.ok) && typecheck.ok;
    execution.finished = Date.now();
    if (!green) {
      const failing = execution.checks.filter((item) => item.ok === false).map((item) => item.name).join(", ");
      this.fail(proposalId, `Checks failed: ${failing}.`, execution);
      events.emit({ type: "task_failed", taskId, label: `Checks failed for “${proposal.title}”: ${failing}`, error: failing });
      this.memory.record({ kind: "attempt", topic: proposal.title, summary: `Generated change failed ${failing}.`, outcome: "failure", improvementId: proposalId });
      this.lastRun = this.finish(proposal, false, "Failed", steps, `Generated change failed: ${failing}.`, started);
      return this.lastRun;
    }

    execution.outcome = "Ready";
    this.queue.update(proposalId, { status: "Ready", ...this.withExecution(proposalId, execution) });
    this.memory.record({
      kind: "attempt",
      topic: proposal.title,
      summary: `Generated change ready for review: ${execution.filesChanged.join(", ")} (${execution.agent}).`,
      outcome: "success",
      improvementId: proposalId,
    });
    events.emit({ type: "task_completed", taskId, label: `Ready for review: ${proposal.title} — ${execution.filesChanged.length} file(s), checks green` });
    this.lastRun = this.finish({ ...proposal, status: "Ready" }, true, "Ready", steps, "Change generated and verified in the copy — ready for review.", started, undefined, undefined, undefined, undefined, execution.diff);
    return this.lastRun;
  }

  /** Read access to a workspace copy for the engineering agent. */
  private copyAccess(workspaceId: string): ProposalSourceAccess {
    const workspace = EngineeringWorkspace.getInstance();
    const walk = async (dir: string, accept: (path: string) => boolean, depth = 0): Promise<string[]> => {
      if (depth > 6) return [];
      const listing = await workspace.listDir(workspaceId, dir);
      if (!listing.ok) return [];
      const found: string[] = [];
      for (const entry of listing.entries) {
        const path = entry.path.replace(/^\.?\/+/, "");
        if (entry.type === "dir") {
          if (!/(^|\/)(node_modules|assets|_deferred)$/.test(path)) found.push(...(await walk(path, accept, depth + 1)));
        } else if (accept(path)) {
          found.push(path);
        }
      }
      return found;
    };
    return {
      listSources: async () => (await walk("src", (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts"))).sort(),
      listTests: async () => (await walk("tests", (path) => /^tests\/[A-Za-z0-9_.-]+\.test\.tsx?$/.test(path))).sort(),
      read: async (path) => {
        const file = await workspace.readFile(workspaceId, path);
        return file.ok ? file.content : null;
      },
    };
  }

  /**
   * Record an approved integration: version + registries + knowledge +
   * self-model + engineering memory. Does NOT write production source —
   * that is `applyCandidate()`, gated at autonomy L5.
   */
  public async integrate(proposalId: string): Promise<LoopRunResult> {
    // The workspace timeline learns that integration is happening from this
    // stream, the same one every other tool reports on.
    const events = AgentEventBus.getInstance();
    const taskId = proposalId;
    const proposal = this.queue.get(proposalId);
    const steps: LoopStep[] = [];
    const started = Date.now();

    // A verified change can be recorded while Ready, or while only its
    // APPLY is blocked (recording does not need the apply permissions).
    const applyBlocked = proposal?.status === "Blocked" && proposal.blocked?.action === "apply";
    if (!proposal || (proposal.status !== "Ready" && !applyBlocked)) {
      this.lastRun = {
        proposalId,
        title: proposal?.title ?? "(unknown)",
        started,
        finished: Date.now(),
        success: false,
        finalStatus: proposal?.status ?? "Rejected",
        steps,
        summary: "Only a Ready candidate can be recorded.",
      };
      return this.lastRun;
    }

    /* RUN THE REAL SELF-TEST SUITE — do not describe one.
       These two fields were the hardcoded strings "Self-test suite +
       sandbox tests" and "Green at development time": a version record
       that CLAIMED tests had run and passed, written without running
       anything. The suite exists (SelfTestRunner) and was simply never
       called from here. */
    events.emit({
      type: "tool_selected",
      taskId,
      tool: "selfdev.integrate",
      label: `Integrating: ${proposal.title}`,
    });
    events.emit({
      type: "tool_started",
      taskId,
      tool: "selfdev.integrate",
      label: "Recording version, capability, knowledge, self-model",
    });

    const suite = await SelfTestRunner.getInstance().run();
    const failed = suite.results.filter((result) => !result.passed);
    const testSummary =
      `SelfTestRunner: ${suite.summary.passed}/${suite.summary.total} passed` +
      (failed.length ? ` — failing: ${failed.map((f) => f.name).join(", ")}` : "");
    this.addStep(
      steps,
      "self-test",
      suite.healthy ? "done" : "failed",
      testSummary,
    );

    const version = this.versions.recordVersion({
      version: `1.${(this.versions.listVersions().length + 1).toFixed(1)}`,
      changeDescription: proposal.title,
      filesChanged: Object.keys(this.selfCode.workingCopies()),
      // Measured, not asserted.
      tests: `SelfTestRunner (${suite.summary.total} checks) + sandbox tests`,
      results: testSummary,
      knownIssues: failed.length
        ? failed.map((f) => `${f.name}: ${f.detail}`).join("; ")
        : "None recorded",
      rollbackSnapshotId: proposal.rollbackSnapshotId,
      improvementId: proposalId,
    });
    this.addStep(steps, "version", "done", `Recorded v${version.version}.`);

    /* A CAPABILITY BECOMES AVAILABLE BY PASSING, NOT BY INTEGRATING.
       This previously set status:"available" unconditionally the moment
       a proposal integrated — so a capability was marked operational
       because a proposal existed and some code changed, which is
       exactly the claim the registry is supposed to be able to deny.
       The suite result now decides, and the evidence is recorded with
       it so the status can be justified later. */
    if (proposal.capabilityId) {
      const capability = this.registry.get(proposal.capabilityId);
      if (!capability) {
        this.addStep(steps, "capability", "skipped", `Unknown capability “${proposal.capabilityId}”.`);
      } else if (suite.healthy) {
        this.registry.update(proposal.capabilityId, {
          status: "available",
          limitations: [`Verified by SelfTestRunner at v${version.version}: ${testSummary}`],
        });
        this.addStep(
          steps,
          "capability",
          "done",
          `Capability “${capability.name}” → available (verified: ${testSummary}).`,
        );
      } else {
        // Integrated but not verified is "partial", with the real reason.
        this.registry.update(proposal.capabilityId, {
          status: "partial",
          limitations: [`Integrated at v${version.version} but NOT verified — ${testSummary}`],
        });
        this.addStep(
          steps,
          "capability",
          "failed",
          `Capability “${capability.name}” → partial: the self-test suite did not pass (${testSummary}).`,
        );
      }
    } else {
      this.addStep(steps, "capability", "skipped", "No targeted capability.");
    }

    // Recording is not implementing: the real project was not touched.
    // "Integrated" is reserved for a change applied and verified there.
    this.queue.update(proposalId, { status: "Recorded", blocked: undefined });
    this.memory.record({
      kind: "upgrade",
      topic: proposal.title,
      summary:
        `Integrated “${proposal.title}” (v${version.version}). ${testSummary}` +
        (suite.healthy ? "" : " Capability left PARTIAL — self-tests did not pass."),
      outcome: suite.healthy ? "success" : "failure",
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
    events.emit({ type: "tool_result", taskId, tool: "selfdev.integrate", result: `Recorded v${version.version} (not applied)` });
    events.emit({ type: "task_completed", taskId, label: `Recorded v${version.version}: ${proposal.title} — not applied to the project` });

    this.lastRun = this.finish({ ...proposal, status: "Recorded" }, true, "Recorded", steps, `Recorded v${version.version} (the real project was not changed).`, started);
    return this.lastRun;
  }

  /**
   * Apply the reviewed, generated change to the REAL project.
   *
   * The change is the diff of the proposal's own workspace copy — not the
   * Self Development panel's hand-edited Source-tab working copies, and
   * not a write the server would refuse (/api/engineer/write is
   * copy-only; this path used to fail on every file and "roll back"
   * with writes that were refused too).
   *
   *   Ready → gates (explicit click, L5, signed-in identity) → diff
   *   check (non-empty, no file changed in the real project since the
   *   copy) → Applying → workspace:apply (server conflict check + backup)
   *   → typecheck the real project (auto-rollback inside apply) →
   *   relevant tests on the real project → Integrated | Rolled Back
   */
  public async applyCandidate(proposalId: string, options: { approved: boolean }): Promise<LoopRunResult> {
    const proposal = this.queue.get(proposalId);
    const steps: LoopStep[] = [];
    const started = Date.now();
    const events = AgentEventBus.getInstance();
    const taskId = proposalId;
    const developed = proposal?.lastExecution?.kind === "develop" ? proposal.lastExecution : proposal?.executions?.filter((item) => item.kind === "develop").at(-1);
    const retryingApply = proposal?.status === "Blocked" && proposal.blocked?.action === "apply";

    if (!proposal || (proposal.status !== "Ready" && !retryingApply) || !developed?.workspaceId || developed.outcome !== "Ready") {
      this.lastRun = this.finish(proposal ?? null, false, proposal?.status ?? "Failed", steps, "Only a change that was generated and verified (Ready for review) can be applied.", started);
      return this.lastRun;
    }
    if (!options.approved) {
      this.addStep(steps, "approval", "failed", "Explicit approval was not granted.");
      this.lastRun = this.finish(proposal, false, proposal.status, steps, "Approval required to apply.", started);
      return this.lastRun;
    }

    const workspaceId = developed.workspaceId;
    const execution: ProposalExecution = {
      executionId: `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "apply",
      started,
      agent: developed.agent,
      plan: developed.plan,
      filesInspected: developed.filesInspected,
      filesChanged: [],
      diff: developed.diff,
      workspaceId,
      checks: [],
    };
    const check = (name: string, ok: boolean | null, detail: string) => {
      execution.checks.push({ name, ok, detail });
      this.addStep(steps, name, ok === null ? "skipped" : ok ? "done" : "failed", detail);
    };
    events.emit({ type: "task_started", taskId, label: `Applying to the project: ${proposal.title} (${execution.executionId})` });

    const gate = AutonomyGate.getInstance();
    if (!gate.can(5)) {
      this.block(proposalId, {
        reason: `Changing the real project needs autonomy level 5 (Production); the current level is ${gate.getLevel()}.`,
        requiredAutonomy: 5,
        unblock: "Raise autonomy to L5 (Production) in Self Development → Autonomy, then Retry apply. Lower it again afterwards if you like.",
        action: "apply",
      }, execution);
      this.lastRun = this.finish(proposal, false, "Blocked", steps, "Blocked: production changes need autonomy L5.", started);
      return this.lastRun;
    }
    const authorization = EngineeringAuthorization.getInstance();
    const preflight = authorization.preflight();
    if (!preflight.ready) {
      this.block(proposalId, {
        reason: preflight.reason,
        unblock: "Sign in with your LÉLU cloud identity on a runtime whose server verifies identity (Supabase configured), then Retry apply.",
        action: "apply",
      }, execution);
      this.lastRun = this.finish(proposal, false, "Blocked", steps, preflight.reason, started);
      return this.lastRun;
    }

    /* validate the diff against the real project as it is NOW */
    const workspace = EngineeringWorkspace.getInstance();
    const changes = await workspace.diff(workspaceId, true);
    execution.filesChanged = changes.map((change) => change.path);
    if (changes.length === 0) {
      this.fail(proposalId, `Workspace ${workspaceId} no longer holds a change — nothing to apply.`, execution);
      this.lastRun = this.finish(proposal, false, "Failed", steps, "Nothing to apply.", started);
      return this.lastRun;
    }
    const conflicts = changes.filter((change) => change.realChangedSince).map((change) => change.path);
    check("conflicts", conflicts.length === 0, conflicts.length ? `Changed in the real project since the copy: ${conflicts.join(", ")}` : `No conflicts in ${changes.length} file(s).`);
    if (conflicts.length > 0) {
      this.block(proposalId, {
        reason: `${conflicts.join(", ")} changed in the real project after the change was generated; applying would overwrite that work.`,
        unblock: "Develop again so the change is regenerated on the current project, then review and apply.",
        action: "develop",
      }, execution);
      this.lastRun = this.finish(proposal, false, "Blocked", steps, "Conflicting modifications — nothing was applied.", started);
      return this.lastRun;
    }

    /* the explicit click is the human authorization for exactly these paths */
    const paths = changes.map((change) => change.path);
    const granted = authorization.authorize(workspaceId, paths);
    if (!granted.allowed) {
      this.block(proposalId, { reason: granted.reason, unblock: "Resolve the authorization requirement above, then Retry apply.", action: "apply" }, execution);
      this.lastRun = this.finish(proposal, false, "Blocked", steps, granted.reason, started);
      return this.lastRun;
    }

    this.queue.update(proposalId, { status: "Applying", blocked: undefined, ...this.withExecution(proposalId, execution) });
    events.emit({ type: "tool_started", taskId, tool: "workspace.apply", label: `Writing ${paths.length} file(s) to the project` });
    const applied = await workspace.apply(workspaceId);
    if (!applied.ok) {
      const rolledBack = "rolledBack" in applied && applied.rolledBack === true;
      check("apply", false, applied.error);
      if (rolledBack) {
        execution.rollback = { ok: true, restored: applied.applied ?? [] };
        this.queue.update(proposalId, { status: "Rolled Back", ...this.withExecution(proposalId, { ...execution, finished: Date.now(), outcome: "Rolled Back", error: applied.error }) });
        this.memory.record({ kind: "rollback", topic: proposal.title, summary: applied.error, outcome: "failure", improvementId: proposalId });
        events.emit({ type: "task_failed", taskId, label: `Rolled back: ${proposal.title}`, error: applied.error });
        this.lastRun = this.finish(proposal, false, "Rolled Back", steps, applied.error, started);
      } else {
        this.fail(proposalId, applied.error, execution);
        events.emit({ type: "task_failed", taskId, label: `Apply failed: ${proposal.title}`, error: applied.error });
        this.lastRun = this.finish(proposal, false, "Failed", steps, applied.error, started);
      }
      return this.lastRun;
    }
    execution.filesChanged = applied.applied;
    check("apply", true, `Wrote ${applied.applied.join(", ")} (authorized by ${applied.authorizedBy}).`);
    check("typecheck", true, "The real project typechecks with the change.");
    for (const path of applied.applied) events.emit({ type: "file_changed", taskId, path });

    /* relevant tests on the REAL project */
    const testFiles = developed.tests ?? [];
    if (testFiles.length > 0) {
      events.emit({ type: "tool_started", taskId, tool: "dev.test", label: `Running ${testFiles.join(", ")} on the project` });
      const tests = await workspace.checkFiles(null, "test-files", testFiles);
      const ok = tests.ok;
      check("test", ok, "error" in tests ? tests.error : `${testFiles.join(", ")} — ${testSummaryOf(tests.output)} (exit ${tests.exitCode})`);
      if (!ok) {
        const rollback = await workspace.rollbackApply(workspaceId);
        execution.rollback = rollback.ok ? { ok: true, restored: rollback.restored } : { ok: false, restored: [], error: rollback.error };
        const status: ImprovementStatus = rollback.ok ? "Rolled Back" : "Failed";
        const summary = rollback.ok
          ? `Tests failed on the project; rolled back ${rollback.restored.join(", ")}.`
          : `Tests failed on the project and the ROLLBACK FAILED: ${rollback.error}`;
        this.queue.update(proposalId, { status, ...this.withExecution(proposalId, { ...execution, finished: Date.now(), outcome: status, error: summary }) });
        this.memory.record({ kind: "rollback", topic: proposal.title, summary, outcome: "failure", improvementId: proposalId });
        events.emit({ type: "task_failed", taskId, label: summary });
        this.lastRun = this.finish(proposal, false, status, steps, summary, started);
        return this.lastRun;
      }
    } else {
      check("test", null, "No relevant test file was recorded for this change.");
    }

    execution.finished = Date.now();
    execution.outcome = "Integrated";
    this.queue.update(proposalId, { status: "Integrated", ...this.withExecution(proposalId, execution) });
    this.memory.record({ kind: "upgrade", topic: proposal.title, summary: `Applied and verified “${proposal.title}”: ${applied.applied.join(", ")}.`, outcome: "success", improvementId: proposalId });
    events.emit({ type: "task_completed", taskId, label: `Integrated (applied and verified): ${proposal.title}` });
    this.lastRun = this.finish(proposal, true, "Integrated", steps, "Applied to the project and verified.", started);
    return this.lastRun;
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

/** The first few lines of command output, for a one-line check detail. */
function firstLines(output: string, count = 3): string {
  return output.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, count).join(" · ").slice(0, 400);
}

/** node:test's own pass/fail summary from TAP output, when present. */
function testSummaryOf(output: string): string {
  const pass = output.match(/^# pass (\d+)/m)?.[1];
  const fail = output.match(/^# fail (\d+)/m)?.[1];
  return pass !== undefined ? `${pass} passed, ${fail ?? "0"} failed` : firstLines(output);
}
