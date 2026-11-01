/**
 * ==========================================================
 * LÉLU — TASK EXECUTOR
 *
 * Runs a TaskEngine task's steps for real.
 *
 * TaskEngine already persisted multi-step tasks with
 * checkpoints, but nothing executed a step: the Orchestrator
 * made one chat call and then marked every step "completed"
 * with that same reply. This is the missing executor. It adds
 * no second tool system and no second agent system:
 *
 *   tool step    → dispatchToolCall   (the chat tool path)
 *   agent step   → AgentRunner.run    (the delegation path)
 *   reason step  → AIService.reason   (the structured-call path)
 *
 * What it guarantees:
 *   • ORDER     a step runs only after the steps it depends on
 *               completed; a step whose dependency failed is
 *               skipped with that reason, never run on bad input.
 *   • DATA      `{{steps.<id>.output}}` passes a real earlier
 *               output into a later step; an unresolved reference
 *               fails the step instead of sending the literal.
 *   • RETRY     transient failures retry with backoff; a refusal
 *               (not permitted, no such tool) does not, because it
 *               will fail the same way.
 *   • VERIFY    a step counts only if its tool reported success
 *               AND its output passes the step's check. A task is
 *               "completed" only if every step is.
 *   • APPROVAL  a sensitive step stops the task at "waiting" with
 *               a request in the ApprovalGate. Approved, it runs
 *               once with exactly the arguments shown; rejected,
 *               the task fails and says so.
 *   • RESUME    the task is checkpointed after every step. A run
 *               cut off by a reload is found at start-up, marked
 *               paused, and resume() continues from the first step
 *               that did not finish.
 *   • CANCEL    cancel() stops between steps and between attempts.
 * ==========================================================
 */

import type { ToolCall } from "../../providers/AIProvider";
import AgentEventBus from "../agent/AgentEvents";
import TaskEngine, { type Task, type TaskStep, type StepVerification } from "../tasks/TaskEngine";
import type { ToolExecutionResult } from "../tools/ToolDispatcher";
import ApprovalGate, { type ApprovalRequest } from "./ApprovalGate";

export interface StepResult {
  ok: boolean;
  content: string;
}

/** The three execution paths, injectable so tests can count calls. */
export interface ExecutorDeps {
  dispatch: (call: ToolCall, taskId: string, options?: { approvalId?: string }) => Promise<ToolExecutionResult>;
  runAgent: (agent: string, instruction: string, taskId: string) => Promise<StepResult>;
  reason: (prompt: string) => Promise<StepResult>;
  sleep: (ms: number) => Promise<void>;
}

export type ProgressKind =
  | "started"
  | "step-started"
  | "step-succeeded"
  | "step-failed"
  | "step-retrying"
  | "step-skipped"
  | "awaiting-approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface TaskProgress {
  taskId: string;
  kind: ProgressKind;
  stepId?: string;
  message: string;
  at: number;
}

type ProgressListener = (progress: TaskProgress) => void;

const DEFAULT_ATTEMPTS = 2;
const MAX_ATTEMPTS = 5;
const MAX_OUTPUT_CHARS = 20_000;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** Failures a retry cannot fix: the dispatcher refused before running. */
const NOT_RETRYABLE = [
  /There is no tool named/i,
  /not permitted/i,
  /was NOT run/i,
  /is not available in this runtime/i,
  /declined by the user/i,
  /unresolved reference/i,
];

/* --------------------------- default dependencies --------------------------- */

async function realDispatch(call: ToolCall, taskId: string, options?: { approvalId?: string }) {
  const { dispatchToolCall } = await import("../tools/ToolDispatcher");
  return dispatchToolCall(call, taskId, undefined, options);
}

export async function delegateToAgent(agentRef: string, instruction: string, taskId: string): Promise<StepResult> {
  const [{ default: AgentStore }, { default: AgentRunner }] = await Promise.all([
    import("../agents/AgentStore"),
    import("../agents/AgentRunner"),
  ]);
  const wanted = agentRef.replace(/^agent:/, "").trim().toLowerCase();
  const agent = AgentStore.getInstance()
    .runnable()
    .find((candidate) => candidate.id.toLowerCase() === wanted || candidate.name.toLowerCase() === wanted);
  if (!agent) return { ok: false, content: `No runnable agent named "${agentRef}".` };
  const result = await AgentRunner.getInstance().run(agent.id, instruction, undefined, taskId);
  if (!result.ok || !result.response) {
    return { ok: false, content: result.error ?? `${agent.name} did not complete the task.` };
  }
  // An offline answer is a canned reply, not the agent's work.
  if (result.response.provider === "offline") {
    return { ok: false, content: `${agent.name} could not reach a model; only the offline reply came back.` };
  }
  return { ok: true, content: result.response.text };
}

async function realReason(prompt: string): Promise<StepResult> {
  const { default: AIService } = await import("../AIService");
  const response = await AIService.getInstance().reason(prompt, { maxTokens: 2000 });
  const ok = response.metadata?.success !== false && response.provider !== "offline" && response.text.trim().length > 0;
  return { ok, content: ok ? response.text : "No model was reachable for this reasoning step." };
}

/* --------------------------------- helpers --------------------------------- */

/** Replace `{{steps.<id>.output}}` in every string inside `value`. */
export function interpolate(
  value: unknown,
  outputs: Map<string, string>,
  missing: string[],
): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\s*\}\}/g, (_match, stepId: string) => {
      const output = outputs.get(stepId);
      if (output === undefined) {
        missing.push(stepId);
        return "";
      }
      return output;
    });
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, outputs, missing));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolate(item, outputs, missing)]),
    );
  }
  return value;
}

/** Check a real output against a step's verification rule. */
export function verifyOutput(output: string, rule: StepVerification | undefined): { ok: boolean; detail: string } {
  if (!rule) return { ok: true, detail: "no check" };
  const text = output.trim();
  const value = (rule.value ?? "").trim();
  switch (rule.operator) {
    case "not-empty":
      return { ok: text.length > 0, detail: text ? "output present" : "output was empty" };
    case "contains":
      return {
        ok: text.toLowerCase().includes(value.toLowerCase()),
        detail: `output ${text.toLowerCase().includes(value.toLowerCase()) ? "contains" : "does not contain"} "${value}"`,
      };
    case "not-contains":
      return {
        ok: !text.toLowerCase().includes(value.toLowerCase()),
        detail: `output ${text.toLowerCase().includes(value.toLowerCase()) ? "contains" : "does not contain"} "${value}"`,
      };
    case "equals":
      return { ok: text === value, detail: text === value ? "output matches" : `output differs from "${value}"` };
    default:
      return { ok: false, detail: `unknown check "${String((rule as StepVerification).operator)}"` };
  }
}

/** The steps a step waits for: its declared deps, else the one before it. */
function dependenciesOf(task: Task, index: number): string[] {
  const step = task.steps[index];
  if (step.dependsOn) return step.dependsOn;
  return index > 0 ? [task.steps[index - 1].id] : [];
}

/* --------------------------------- executor --------------------------------- */

export default class TaskExecutor {
  private static instance: TaskExecutor | null = null;
  private deps: ExecutorDeps;
  private readonly active = new Map<string, { controller: AbortController; done: Promise<Task | undefined> }>();
  private readonly listeners = new Set<ProgressListener>();
  /** In-flight self-evaluations, so a run resolves after its task is judged. */
  private readonly evaluations = new Map<string, Promise<void>>();

  private constructor(deps: Partial<ExecutorDeps> = {}) {
    this.deps = {
      dispatch: realDispatch,
      runAgent: delegateToAgent,
      reason: realReason,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      ...deps,
    };
    // A human answered: carry on with the task that was waiting on it.
    ApprovalGate.getInstance().onDecision((request) => this.onApprovalDecided(request));
  }

  public static getInstance(): TaskExecutor {
    if (!TaskExecutor.instance) TaskExecutor.instance = new TaskExecutor();
    return TaskExecutor.instance;
  }

  /** Replace execution paths (tests, alternative runtimes). */
  public configure(deps: Partial<ExecutorDeps>): void {
    this.deps = { ...this.deps, ...deps };
  }

  public onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  /** Start in the background; progress arrives through onProgress and the event bus. */
  public start(taskId: string): void {
    void this.run(taskId);
  }

  /** Wait for a task's current run, if one is in flight. */
  public async settled(taskId: string): Promise<Task | undefined> {
    return (await this.active.get(taskId)?.done) ?? TaskEngine.getInstance().get(taskId);
  }

  /**
   * Run until the task completes, fails, is cancelled, or stops to wait
   * for a human. Joining an in-flight run returns that run's result.
   */
  public run(taskId: string): Promise<Task | undefined> {
    const existing = this.active.get(taskId);
    if (existing) return existing.done;
    const controller = new AbortController();
    const done = this.execute(taskId, controller.signal)
      .then(async (task) => {
        // A caller awaiting a task gets it judged, not just finished.
        await this.evaluations.get(taskId);
        return task;
      })
      .finally(() => this.active.delete(taskId));
    this.active.set(taskId, { controller, done });
    return done;
  }

  /** Stop a task. A step already running finishes; nothing after it starts. */
  public cancel(taskId: string, reason = "cancelled by request"): Task | undefined {
    const engine = TaskEngine.getInstance();
    const task = engine.get(taskId);
    if (!task || TERMINAL.has(task.status)) return task;
    const live = this.active.get(taskId);
    if (live) {
      live.controller.abort(reason);
      return task;
    }
    // Not running (waiting or paused): cancel directly.
    this.finish(task, "cancelled", reason);
    return task;
  }

  /** Continue a paused, interrupted or approval-waiting task. */
  public resume(taskId: string): Promise<Task | undefined> {
    const task = TaskEngine.getInstance().get(taskId);
    if (!task || TERMINAL.has(task.status)) return Promise.resolve(task);
    return this.run(taskId);
  }

  /**
   * Tasks that were "running" with no live runner were cut off (reload,
   * crash, closed tab). Mark them paused so they show as resumable rather
   * than as running forever. Returns their ids.
   */
  public recoverInterrupted(): string[] {
    const engine = TaskEngine.getInstance();
    const recovered: string[] = [];
    for (const task of engine.list()) {
      if (task.status !== "running" || this.active.has(task.id) || !task.steps.some((s) => s.action)) continue;
      for (const step of task.steps) {
        // A step cut off mid-run did not finish; it runs again on resume.
        if (step.status === "running") step.status = "pending";
      }
      task.status = "paused";
      task.checkpoint = {
        stepIndex: task.steps.findIndex((s) => s.status === "pending"),
        data: { reason: "interrupted" },
        timestamp: Date.now(),
      };
      engine.save(task);
      recovered.push(task.id);
      this.progress(task.id, "paused", "Interrupted before it finished — resumable.");
    }
    return recovered;
  }

  /** Plain-language account of what really happened, step by step. */
  public report(task: Task): string {
    const lines = task.steps.map((step, index) => {
      const what =
        step.action?.kind === "tool"
          ? step.action.tool
          : step.action?.kind === "agent"
            ? `agent ${step.action.agent}`
            : step.action?.kind === "reason"
              ? "reasoning"
              : "note";
      const detail = step.status === "completed" ? step.result : step.error;
      return `${index + 1}. [${step.status}] ${step.title} (${what})${detail ? ` — ${detail}` : ""}`;
    });
    const headline =
      task.status === "completed"
        ? `Completed and verified: ${task.goal}`
        : task.status === "waiting"
          ? `Waiting for your approval: ${task.goal}`
          : task.status === "cancelled"
            ? `Cancelled: ${task.goal}`
            : task.status === "paused"
              ? `Paused (resumable): ${task.goal}`
              : `Not completed: ${task.goal}${task.error ? ` — ${task.error}` : ""}`;
    return [headline, ...lines].join("\n");
  }

  /* ------------------------------- internals ------------------------------- */

  private async execute(taskId: string, signal: AbortSignal): Promise<Task | undefined> {
    const engine = TaskEngine.getInstance();
    const events = AgentEventBus.getInstance();
    const task = engine.get(taskId);
    if (!task || TERMINAL.has(task.status)) return task;

    const resumed = task.status === "paused" || task.status === "waiting";
    task.status = "running";
    task.startedAt = task.startedAt ?? Date.now();
    engine.save(task);
    events.emit({ type: "task_started", taskId, label: task.goal });
    events.emit({
      type: "task_planning",
      taskId,
      plan: task.steps.map((step, index) => `${index + 1}. ${step.title}`).join("\n"),
    });
    this.progress(taskId, "started", resumed ? `Resuming: ${task.goal}` : `Starting: ${task.goal}`);

    for (;;) {
      if (signal.aborted) {
        this.finish(task, "cancelled", String(signal.reason ?? "cancelled"));
        return task;
      }

      this.skipBlocked(task);
      const index = task.steps.findIndex(
        (step, i) =>
          step.status === "pending" &&
          dependenciesOf(task, i).every((dep) => task.steps.find((s) => s.id === dep)?.status === "completed"),
      );
      if (index < 0) break;

      const outcome = await this.executeStep(task, task.steps[index], signal);
      engine.save(task); // checkpoint after every step
      if (outcome === "waiting") return task;
      if (outcome === "stop") break;
    }

    if (signal.aborted) {
      this.finish(task, "cancelled", String(signal.reason ?? "cancelled"));
      return task;
    }

    const failed = task.steps.filter((step) => step.status === "failed" || step.status === "skipped");
    const actionable = task.steps.filter((step) => step.action);
    if (failed.length === 0 && actionable.every((step) => step.status === "completed")) {
      this.finish(task, "completed");
    } else {
      const first = failed[0];
      this.finish(task, "failed", first ? `step "${first.title}": ${first.error ?? first.status}` : "steps did not complete");
    }
    return task;
  }

  /** Pending steps whose dependency failed or was skipped cannot run. */
  private skipBlocked(task: Task): void {
    let changed = true;
    while (changed) {
      changed = false;
      task.steps.forEach((step, index) => {
        if (step.status !== "pending") return;
        const broken = dependenciesOf(task, index)
          .map((dep) => task.steps.find((s) => s.id === dep))
          .find((dep) => !dep || dep.status === "failed" || dep.status === "skipped");
        if (broken !== undefined) {
          step.status = "skipped";
          step.error = broken ? `not run: "${broken.title}" did not complete` : "not run: a dependency does not exist";
          changed = true;
          this.progress(task.id, "step-skipped", `${step.title}: ${step.error}`, step.id);
        }
      });
    }
  }

  private async executeStep(task: Task, step: TaskStep, signal: AbortSignal): Promise<"done" | "waiting" | "stop"> {
    const events = AgentEventBus.getInstance();
    if (!step.action) {
      // A label-only step has nothing to run; it is not evidence of work.
      step.status = "skipped";
      step.error = "no executable action";
      return "done";
    }

    // Pass real earlier outputs into this step.
    const outputs = new Map(task.steps.filter((s) => s.status === "completed").map((s) => [s.id, s.output ?? s.result ?? ""]));
    const missing: string[] = [];
    const action = interpolate(step.action, outputs, missing) as NonNullable<TaskStep["action"]>;
    if (missing.length) {
      return this.failStep(task, step, `unresolved reference to step(s) ${[...new Set(missing)].join(", ")}`);
    }

    // Sensitive tool: a human decides before it runs.
    let approvalId: string | undefined;
    if (action.kind === "tool") {
      const gate = ApprovalGate.getInstance();
      const policy = gate.requiresApproval(action.tool);
      if (policy.required) {
        const existing = step.approvalId ? gate.get(step.approvalId) : undefined;
        if (existing?.status === "rejected") {
          return this.failStep(task, step, `declined by the user (${action.tool})`, "stop");
        }
        if (!existing || existing.status === "pending" || existing.usedAt) {
          const request =
            existing && existing.status === "pending"
              ? existing
              : gate.request({
                  taskId: task.id,
                  stepId: step.id,
                  tool: action.tool,
                  args: action.args,
                  title: `Approve "${step.title}"?`,
                  detail:
                    `LÉLU wants to run ${action.tool} (${policy.reason}) as part of: ${task.goal}\n` +
                    `Arguments: ${JSON.stringify(action.args).slice(0, 600)}`,
                  systemsAffected: [action.tool],
                });
          step.approvalId = request.id;
          step.status = "pending";
          task.status = "waiting";
          TaskEngine.getInstance().save(task);
          this.progress(task.id, "awaiting-approval", `Waiting for your approval to run ${action.tool}: ${step.title}`, step.id);
          return "waiting";
        }
        approvalId = existing.id; // approved and unused
      }
    }

    // An approval is spent by the first attempt, so an approved step
    // runs exactly once; a retry would be a new, unapproved call.
    const maxAttempts = approvalId ? 1 : Math.min(Math.max(step.maxAttempts ?? DEFAULT_ATTEMPTS, 1), MAX_ATTEMPTS);
    step.status = "running";
    step.startedAt = Date.now();
    TaskEngine.getInstance().save(task);
    this.progress(task.id, "step-started", step.title, step.id);
    events.emit({
      type: "execution_phase",
      taskId: task.id,
      phase: "backend_task_started",
      label: step.title,
      side: "backend",
      detail: action.kind === "tool" ? action.tool : action.kind,
    });

    let last: StepResult = { ok: false, content: "not run" };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      step.attempts = attempt;
      last = await this.perform(action, task.id, approvalId);
      const check = last.ok ? verifyOutput(last.content, step.verify) : { ok: false, detail: last.content };

      if (last.ok && check.ok) {
        step.status = "completed";
        step.completedAt = Date.now();
        step.output = last.content.slice(0, MAX_OUTPUT_CHARS);
        step.result = last.content.replace(/\s+/g, " ").trim().slice(0, 200);
        step.error = undefined;
        events.emit({
          type: "execution_phase",
          taskId: task.id,
          phase: "validation_completed",
          label: `Verified: ${step.title}`,
          side: "backend",
          detail: check.detail,
        });
        this.progress(task.id, "step-succeeded", `${step.title} — ${step.result}`, step.id);
        return "done";
      }

      const reason = last.ok ? `verification failed: ${check.detail}` : last.content;
      const retryable = attempt < maxAttempts && !signal.aborted && !NOT_RETRYABLE.some((pattern) => pattern.test(reason));
      if (!retryable) return this.failStep(task, step, reason.slice(0, 500));

      events.emit({
        type: "execution_phase",
        taskId: task.id,
        phase: "retry",
        label: `Retrying: ${step.title}`,
        side: "backend",
        detail: reason.slice(0, 200),
      });
      this.progress(task.id, "step-retrying", `${step.title}: ${reason.slice(0, 160)} — retrying`, step.id);
      await this.deps.sleep(Math.min(250 * 2 ** (attempt - 1), 4000));
    }
    return this.failStep(task, step, last.content.slice(0, 500));
  }

  private async perform(
    action: NonNullable<TaskStep["action"]>,
    taskId: string,
    approvalId: string | undefined,
  ): Promise<StepResult> {
    try {
      if (action.kind === "tool") {
        const { toolNameForModel } = await import("../tools/ToolDispatcher");
        const result = await this.deps.dispatch(
          { id: `task-${taskId}-${Date.now()}`, name: toolNameForModel(action.tool), arguments: action.args ?? {} },
          taskId,
          approvalId ? { approvalId } : undefined,
        );
        return { ok: result.ok, content: result.content };
      }
      if (action.kind === "agent") return await this.deps.runAgent(action.agent, action.instruction, taskId);
      return await this.deps.reason(action.prompt);
    } catch (error) {
      return { ok: false, content: error instanceof Error ? error.message : String(error) };
    }
  }

  private failStep(task: Task, step: TaskStep, error: string, outcome: "done" | "stop" = "done"): "done" | "stop" {
    step.status = "failed";
    step.error = error;
    step.completedAt = Date.now();
    AgentEventBus.getInstance().emit({
      type: "execution_phase",
      taskId: task.id,
      phase: "error",
      label: `Failed: ${step.title}`,
      side: "backend",
      detail: error.slice(0, 200),
    });
    this.progress(task.id, "step-failed", `${step.title}: ${error.slice(0, 200)}`, step.id);
    return outcome;
  }

  private finish(task: Task, status: "completed" | "failed" | "cancelled", error?: string): void {
    const events = AgentEventBus.getInstance();
    if (status === "cancelled") {
      for (const step of task.steps) {
        if (step.status === "pending" || step.status === "running") {
          step.status = "skipped";
          step.error = "task cancelled";
        }
      }
    }
    task.status = status;
    task.completedAt = Date.now();
    task.error = status === "completed" ? undefined : error;
    task.report = this.report(task);
    TaskEngine.getInstance().save(task);
    if (status === "completed") {
      events.emit({ type: "task_completed", taskId: task.id, label: task.goal });
    } else {
      events.emit({ type: "task_failed", taskId: task.id, label: task.goal, error });
    }
    this.progress(task.id, status, task.report);
    const evaluation = this.evaluate(task).finally(() => this.evaluations.delete(task.id));
    this.evaluations.set(task.id, evaluation);
  }

  /** Hand the finished task to self-evaluation (lessons, gaps). */
  private async evaluate(task: Task): Promise<void> {
    try {
      const { default: TaskEvaluator } = await import("./TaskEvaluator");
      await TaskEvaluator.getInstance().evaluate(task);
    } catch (error) {
      console.warn("[TaskExecutor] evaluation failed (contained):", error);
    }
  }

  private onApprovalDecided(request: ApprovalRequest): void {
    const task = TaskEngine.getInstance().get(request.taskId);
    if (!task || task.status !== "waiting") return;
    if (!task.steps.some((step) => step.approvalId === request.id)) return;
    // Approved: the step runs. Rejected: the run marks it declined and
    // fails the task with that reason. Either way the task moves on.
    this.start(task.id);
  }

  private progress(taskId: string, kind: ProgressKind, message: string, stepId?: string): void {
    const event: TaskProgress = { taskId, kind, message, at: Date.now(), ...(stepId ? { stepId } : {}) };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[TaskExecutor] progress listener failed:", error);
      }
    }
  }
}
