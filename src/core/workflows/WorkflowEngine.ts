/**
 * ==========================================================
 * LÉLU
 * WORKFLOW ENGINE — runs a workflow's steps for real
 *
 * Every step executes through the EXISTING ToolDispatcher, which
 * is the same path a model's native tool call takes. That is the
 * whole design: a workflow is a saved sequence of tool calls, not
 * a second execution runtime with its own idea of what a tool is.
 *
 * Consequences that fall out of reusing it, rather than being
 * re-implemented here:
 *   • a step can only call a tool that really exists and is
 *     permitted — the dispatcher re-checks availability and the
 *     autonomy gate before running anything;
 *   • the tool_selected / tool_started / tool_result events reach
 *     the activity timeline exactly as they do for a chat turn;
 *   • a failing step reports the tool's real error text.
 *
 * A step whose tool is unavailable is BLOCKED with the actual
 * reason (missing provider key, no runtime) rather than being
 * quietly skipped or reported as done — a workflow must never
 * claim a step ran when its dependency was absent.
 * ==========================================================
 */

import ToolRegistry from "../tools/ToolRegistry";
import {
  dispatchToolCall,
  toolNameForModel,
  toolPermitted,
} from "../tools/ToolDispatcher";
import WorkflowStore, {
  type StepCondition,
  type StepExecution,
  type WorkflowDefinition,
  type WorkflowEscalation,
  type WorkflowExecution,
  type WorkflowInputValues,
  type WorkflowOrigin,
} from "./WorkflowStore";

/* ---- hard ceilings: control flow must be bounded by construction ---- */

/** Attempts for one step, including the first. */
export const MAX_ATTEMPTS = 5;
/** Iterations of one looping step. */
export const MAX_ITERATIONS = 10;
/** Total tool invocations in one run, across every step and iteration. */
export const MAX_STEP_EXECUTIONS = 100;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, Math.floor(Number.isFinite(value) ? value : low)));

/**
 * Evaluate a branch/loop/termination condition against REAL results.
 *
 * There is no expression language here and nothing is evaluated as
 * code: a condition names a step and compares its recorded status or
 * output to a literal. That is what makes a workflow LÉLU wrote
 * herself safe to execute — the control flow is data the engine
 * interprets, never logic the engine runs.
 *
 * Returns the reason as well as the verdict, so a skipped step can say
 * why it was skipped instead of just that it was.
 */
export function evaluateCondition(
  condition: StepCondition,
  completed: Map<string, StepExecution>,
): { met: boolean; detail: string } {
  const target = completed.get(condition.step);
  if (!target) {
    return { met: false, detail: `step "${condition.step}" has not run` };
  }
  const output = target.output ?? "";
  const value = condition.value ?? "";
  const has = output.toLowerCase().includes(value.toLowerCase());

  switch (condition.operator) {
    case "succeeded":
      return { met: target.status === "succeeded", detail: `"${condition.step}" is ${target.status}` };
    case "failed":
      return {
        met: target.status === "failed" || target.status === "escalated",
        detail: `"${condition.step}" is ${target.status}`,
      };
    case "contains":
      return { met: has, detail: `"${condition.step}" output ${has ? "contains" : "does not contain"} “${value}”` };
    case "not-contains":
      return { met: !has, detail: `"${condition.step}" output ${has ? "contains" : "does not contain"} “${value}”` };
    case "equals":
      return {
        met: output.trim() === value.trim(),
        detail: `"${condition.step}" output ${output.trim() === value.trim() ? "equals" : "differs from"} “${value}”`,
      };
    case "empty":
      return { met: output.trim() === "", detail: `"${condition.step}" output is ${output.trim() ? "not empty" : "empty"}` };
    case "not-empty":
      return { met: output.trim() !== "", detail: `"${condition.step}" output is ${output.trim() ? "not empty" : "empty"}` };
    default:
      // An unknown operator is never silently treated as true.
      return { met: false, detail: `unsupported operator "${String(condition.operator)}"` };
  }
}

/** Interpolate `{{steps.<id>.output}}` against completed steps. */
export function resolveArguments(
  args: Record<string, unknown>,
  completed: Map<string, StepExecution>,
  inputs: WorkflowInputValues = {},
  /**
   * The step being resolved, when it is a LOOP step. A loop step may
   * reference its own previous iteration to revise its work; on the
   * first iteration there is nothing there yet, and that is an empty
   * start rather than a missing dependency.
   */
  selfStepId?: string,
): { resolved: Record<string, unknown>; missing: string[] } {
  const missing: string[] = [];

  const substitute = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    // {{input.<name>}} comes from what the caller supplied; a required
    // input that is absent is caught before the run starts, so anything
    // missing here is an optional the workflow declared.
    const withInputs = value.replace(
      /\{\{\s*input\.([A-Za-z0-9_-]+)\s*\}\}/g,
      (_match, name: string) => inputs[name] ?? "",
    );
    return withInputs.replace(/\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\s*\}\}/g, (_match, stepId: string) => {
      const step = completed.get(stepId);
      if (!step && stepId === selfStepId) return "";
      if (!step || step.status !== "succeeded") {
        // A reference to a step that did not succeed is recorded, not
        // silently replaced with an empty string — that would send the
        // next tool a confidently wrong argument.
        missing.push(stepId);
        return "";
      }
      return step.output;
    });
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    resolved[key] = substitute(value);
  }
  return { resolved, missing };
}

/** Order steps so dependencies run first; report a cycle rather than hang. */
export function orderSteps(workflow: WorkflowDefinition): {
  order: string[];
  unresolvable: string[];
} {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const order: string[] = [];
  const done = new Set<string>();

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const step of workflow.steps) {
      if (done.has(step.id)) continue;
      const ready = [...step.dependsOn, ...(step.after ?? [])].every(
        (id) => done.has(id) || !byId.has(id),
      );
      if (!ready) continue;
      order.push(step.id);
      done.add(step.id);
      progressed = true;
    }
  }

  // Anything left is part of a dependency cycle, or depends on one.
  const unresolvable = workflow.steps
    .filter((step) => !done.has(step.id))
    .map((step) => step.id);
  return { order, unresolvable };
}

export default class WorkflowEngine {
  private static instance: WorkflowEngine | null = null;

  private readonly store = WorkflowStore.getInstance();

  private constructor() {}

  public static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }

  /**
   * Report, without running anything, which steps could execute now.
   *
   * Used before a run and by the UI, so a workflow that cannot execute
   * says why in terms of the real blocker instead of failing halfway.
   */
  public preflight(workflow: WorkflowDefinition): Array<{
    stepId: string;
    tool: string;
    runnable: boolean;
    reason: string;
  }> {
    const registry = ToolRegistry.getInstance();
    return workflow.steps.map((step) => {
      const definition = registry.get(step.tool);
      if (!definition) {
        return { stepId: step.id, tool: step.tool, runnable: false, reason: `No tool "${step.tool}" is registered.` };
      }
      if (!definition.available) {
        return {
          stepId: step.id,
          tool: step.tool,
          runnable: false,
          reason: `"${definition.name}" is not available in this runtime${
            definition.dependency ? ` (needs ${definition.dependency})` : ""
          }.`,
        };
      }
      if (!toolPermitted(step.tool)) {
        return {
          stepId: step.id,
          tool: step.tool,
          runnable: false,
          reason: `"${definition.name}" is not permitted at the current autonomy level.`,
        };
      }
      return { stepId: step.id, tool: step.tool, runnable: true, reason: "Ready." };
    });
  }

  /**
   * Execute a workflow. Never throws; every outcome is recorded.
   *
   * `origin` says who asked. It is carried on the execution so an agent
   * can find its own runs, and so cognition can tell a workflow it
   * chose apart from one the user asked for directly.
   */
  public async run(
    workflowId: string,
    origin: WorkflowOrigin = { kind: "manual" },
    inputs: WorkflowInputValues = {},
  ): Promise<WorkflowExecution> {
    const workflow = this.store.get(workflowId);
    const execution: WorkflowExecution = {
      id: crypto.randomUUID(),
      workflowId,
      workflowName: workflow?.name ?? "(unknown)",
      status: "running",
      currentStepId: null,
      steps: [],
      pendingStepIds: [],
      origin,
      inputs,
      startedAt: Date.now(),
      summary: "",
      finalResult: null,
    };

    if (!workflow) {
      execution.status = "failed";
      execution.finishedAt = Date.now();
      execution.summary = `No workflow with id ${workflowId}.`;
      this.store.saveExecution(execution);
      return execution;
    }

    // A REQUIRED INPUT THAT IS MISSING IS NOT A FAILURE TO EXECUTE.
    //
    // It is a request for information, and cognition needs to tell the
    // two apart: one means "ask the user", the other means "this cannot
    // work here". Nothing runs, so no partial state is created.
    const missingInputs = (workflow.inputs ?? [])
      .filter((input) => input.required && !String(inputs[input.name] ?? "").trim())
      .map((input) => input.name);
    if (missingInputs.length > 0) {
      execution.status = "failed";
      execution.finishedAt = Date.now();
      execution.summary =
        `Not started: required input(s) missing — ${missingInputs.join(", ")}. ` +
        `Nothing was executed.`;
      execution.pendingStepIds = workflow.steps.map((step) => step.id);
      this.store.saveExecution(execution);
      return execution;
    }

    const { order, unresolvable } = orderSteps(workflow);
    execution.pendingStepIds = [...order];
    const byId = new Map(workflow.steps.map((step) => [step.id, step]));
    const completed = new Map<string, StepExecution>();
    const taskId = `workflow-${execution.id}`;

    /* ---- run-level control flow, all bounded, all recorded ---- */
    let terminated: { stepId: string; reason: string } | null = null;
    let escalation: WorkflowEscalation | null = null;
    let totalExecutions = 0;

    for (const stepId of order) {
      const step = byId.get(stepId)!;
      execution.pendingStepIds = execution.pendingStepIds.filter((id) => id !== stepId);

      const record = (): StepExecution => ({
        stepId,
        name: step.name,
        tool: step.tool,
        status: "pending",
        input: {},
        output: "",
      });
      const park = (status: StepExecution["status"], reason: string): void => {
        const entry = record();
        entry.status = status;
        entry.reason = reason;
        execution.steps.push(entry);
        completed.set(stepId, entry);
        this.store.saveExecution({ ...execution });
      };

      // The run already ended — deliberately, or handed to a person.
      // The remaining steps are recorded as not run, with the real
      // reason, never as if they had executed.
      if (terminated) {
        park("skipped", terminated.reason);
        continue;
      }
      if (escalation) {
        park("skipped", `Not run: the workflow was escalated at "${escalation.stepId}".`);
        continue;
      }

      // A dependency that did not succeed means this step's inputs do not
      // exist. Running it anyway would produce a confident wrong answer.
      const failedDependency = step.dependsOn.find(
        (id) => completed.get(id)?.status !== "succeeded",
      );
      if (failedDependency) {
        park("skipped", `Depends on "${failedDependency}", which did not succeed.`);
        continue;
      }

      // An ordering edge only requires that the step RAN. One that never
      // ran leaves nothing to test, so anything ordered after it is
      // skipped with that reason rather than judged against nothing.
      const neverRan = (step.after ?? []).find((id) => !completed.has(id));
      if (neverRan) {
        park("skipped", `Ordered after "${neverRan}", which never ran.`);
        continue;
      }

      // BRANCH. A step whose condition does not hold is skipped with
      // the reason it did not hold — and everything depending on it is
      // skipped in turn, which is how a branch is not taken.
      if (step.condition) {
        const verdict = evaluateCondition(step.condition, completed);
        if (!verdict.met) {
          park("skipped", `Condition not met: ${verdict.detail}.`);
          continue;
        }
      }

      const gate = this.preflight({ ...workflow, steps: [step] })[0];
      if (!gate.runnable) {
        park("blocked", gate.reason);
        continue;
      }

      // LOOP. One pass for an ordinary step; up to maxIterations for a
      // looping one, which may revise its own previous output.
      const maxIterations = step.loop ? clamp(step.loop.maxIterations, 1, MAX_ITERATIONS) : 1;
      const maxAttempts = clamp(step.retry?.maxAttempts ?? 1, 1, MAX_ATTEMPTS);
      let last: StepExecution | null = null;

      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        if (totalExecutions >= MAX_STEP_EXECUTIONS) {
          terminated = {
            stepId,
            reason: `Run stopped at the ceiling of ${MAX_STEP_EXECUTIONS} tool invocation(s).`,
          };
          break;
        }

        const { resolved, missing } = resolveArguments(
          step.arguments,
          completed,
          inputs,
          step.loop ? stepId : undefined,
        );
        const entry = record();
        entry.input = resolved;
        if (step.loop) entry.iteration = iteration;

        if (missing.length > 0) {
          entry.status = "skipped";
          entry.reason = `Referenced output of ${missing.join(", ")}, which is not available.`;
          execution.steps.push(entry);
          completed.set(stepId, entry);
          last = entry;
          this.store.saveExecution({ ...execution });
          break;
        }

        entry.status = "running";
        entry.startedAt = Date.now();
        execution.currentStepId = stepId;
        execution.steps.push(entry);
        this.store.saveExecution({ ...execution });

        // RETRY. The same arguments, re-sent, for a transient failure.
        let result: Awaited<ReturnType<typeof dispatchToolCall>> | null = null;
        let attempts = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          attempts = attempt;
          totalExecutions += 1;
          // THE REAL EXECUTION — the same dispatcher a native tool call uses.
          result = await dispatchToolCall(
            {
              id: `${execution.id}:${stepId}:${iteration}:${attempt}`,
              name: toolNameForModel(step.tool),
              arguments: resolved,
            },
            taskId,
          );
          if (result.ok) break;
          // A retry filter that does not match means this failure is not
          // the transient kind the workflow said to retry.
          if (
            step.retry?.when &&
            !result.content.toLowerCase().includes(step.retry.when.toLowerCase())
          ) {
            break;
          }
        }

        entry.attempts = attempts;
        entry.status = result?.ok ? "succeeded" : "failed";
        entry.output = result?.content ?? "";
        entry.finishedAt = Date.now();
        if (!result?.ok) {
          entry.reason =
            attempts > 1
              ? `Failed after ${attempts} attempt(s): ${result?.content ?? "no result"}`
              : (result?.content ?? "no result");
        }
        completed.set(stepId, entry);
        last = entry;
        this.store.saveExecution({ ...execution });

        if (entry.status !== "succeeded") break;

        if (step.loop) {
          const verdict = evaluateCondition(step.loop.until, completed);
          if (verdict.met) {
            entry.reason = `Loop condition satisfied after ${iteration} iteration(s): ${verdict.detail}.`;
            this.store.saveExecution({ ...execution });
            break;
          }
          if (iteration === maxIterations) {
            // Reaching the ceiling is not success at looping, and the
            // record says so rather than implying the goal was met.
            entry.reason =
              `Loop ended at its maximum of ${maxIterations} iteration(s) ` +
              `without satisfying its condition (${verdict.detail}).`;
            this.store.saveExecution({ ...execution });
          }
        }
      }

      // FAILURE PATH. What a real failure means for the rest of the run.
      if (last && last.status === "failed") {
        const action = step.onFailure?.action ?? (step.optional ? "continue" : "fail");
        if (action === "stop") {
          terminated = {
            stepId,
            reason: `Stopped by "${step.name}" failure policy: ${last.reason ?? "the step failed"}`,
          };
        } else if (action === "escalate") {
          last.status = "escalated";
          escalation = {
            stepId,
            request:
              step.onFailure?.escalate ??
              `"${step.name}" failed and the workflow cannot decide what to do next.`,
            failure: last.reason ?? last.output,
            raisedAt: Date.now(),
          };
          this.store.saveExecution({ ...execution });
        }
        // "fail" and "continue" need nothing here: the final status is
        // computed from the real step records and each step's policy.
      }

      // TERMINATION. Ending early because the goal is already met is a
      // legitimate outcome, distinct from failing.
      if (!terminated && !escalation && step.terminateWhen && last) {
        const condition: StepCondition = {
          ...step.terminateWhen,
          step: step.terminateWhen.step || stepId,
        };
        const verdict = evaluateCondition(condition, completed);
        if (verdict.met) {
          terminated = {
            stepId,
            reason: `Terminated after "${step.name}": ${verdict.detail}.`,
          };
        }
      }

      this.store.saveExecution({ ...execution });
    }

    execution.currentStepId = null;

    for (const stepId of unresolvable) {
      const cyclic = byId.get(stepId);
      const record: StepExecution = {
        stepId,
        name: cyclic?.name ?? stepId,
        tool: cyclic?.tool ?? "(unknown)",
        status: "blocked",
        input: {},
        output: "",
        reason: "Part of a dependency cycle; it can never become ready.",
      };
      execution.pendingStepIds = execution.pendingStepIds.filter((id) => id !== stepId);
      execution.steps.push(record);
      completed.set(stepId, record);
    }

    const hardFailure = execution.steps.some((entry) => {
      if (entry.status !== "failed" && entry.status !== "blocked") return false;
      const step = byId.get(entry.stepId);
      // A step the workflow declared optional, or whose failure policy
      // says to carry on, is a recorded failure but not a failed run.
      return !step?.optional && step?.onFailure?.action !== "continue";
    });
    const anySucceeded = execution.steps.some((entry) => entry.status === "succeeded");

    execution.status = escalation
      ? "escalated"
      : hardFailure
        ? anySucceeded
          ? "partial"
          : "failed"
        : "succeeded";
    if (terminated) execution.terminatedBy = terminated;
    if (escalation) execution.escalation = escalation;
    // The result is the last SUCCEEDING step's real output. Null when
    // nothing succeeded — an empty string would read as a result.
    const lastSuccess = [...execution.steps].reverse().find((record) => record.status === "succeeded");
    execution.finalResult = lastSuccess ? lastSuccess.output : null;
    execution.finishedAt = Date.now();
    execution.summary = this.describe(execution);
    this.store.saveExecution(execution);

    // Recorded on the shared bus AFTER the run finished, from the run's
    // own state — so the trace can never claim an execution the store
    // does not hold.
    const { emitCognition } = await import("../agent/AgentEvents");
    emitCognition("workflow-executed", `“${execution.workflowName}” — ${execution.status}. ${execution.summary}`, {
      taskId,
      data: {
        invocationId: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        steps: execution.steps.map((step) => ({ id: step.stepId, status: step.status })),
      },
    });
    return execution;
  }

  /** A factual one-line account of what actually happened. */
  private describe(execution: WorkflowExecution): string {
    const counts = execution.steps.reduce<Record<string, number>>((totals, record) => {
      totals[record.status] = (totals[record.status] ?? 0) + 1;
      return totals;
    }, {});
    const parts = Object.entries(counts).map(([status, count]) => `${count} ${status}`);
    const blocked = execution.steps.filter((record) => record.status === "blocked");
    return (
      `${execution.steps.length} step record(s): ${parts.join(", ")}.` +
      (blocked.length ? ` Blocked: ${blocked.map((r) => r.reason).join(" ")}` : "") +
      (execution.terminatedBy ? ` ${execution.terminatedBy.reason}` : "") +
      (execution.escalation
        ? ` ESCALATED at "${execution.escalation.stepId}": ${execution.escalation.request}`
        : "")
    );
  }
}
