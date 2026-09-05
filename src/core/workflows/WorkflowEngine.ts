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
  type StepExecution,
  type WorkflowDefinition,
  type WorkflowExecution,
} from "./WorkflowStore";

/** Interpolate `{{steps.<id>.output}}` against completed steps. */
export function resolveArguments(
  args: Record<string, unknown>,
  completed: Map<string, StepExecution>,
): { resolved: Record<string, unknown>; missing: string[] } {
  const missing: string[] = [];

  const substitute = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    return value.replace(/\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\s*\}\}/g, (_match, stepId: string) => {
      const step = completed.get(stepId);
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
      const ready = step.dependsOn.every((id) => done.has(id) || !byId.has(id));
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

  /** Execute a workflow. Never throws; every outcome is recorded. */
  public async run(workflowId: string): Promise<WorkflowExecution> {
    const workflow = this.store.get(workflowId);
    const execution: WorkflowExecution = {
      id: crypto.randomUUID(),
      workflowId,
      status: "running",
      steps: [],
      startedAt: Date.now(),
      summary: "",
    };

    if (!workflow) {
      execution.status = "failed";
      execution.finishedAt = Date.now();
      execution.summary = `No workflow with id ${workflowId}.`;
      this.store.saveExecution(execution);
      return execution;
    }

    const { order, unresolvable } = orderSteps(workflow);
    const byId = new Map(workflow.steps.map((step) => [step.id, step]));
    const completed = new Map<string, StepExecution>();
    const taskId = `workflow-${execution.id}`;

    for (const stepId of order) {
      const step = byId.get(stepId)!;
      const record: StepExecution = { stepId, status: "pending", output: "" };

      // A dependency that did not succeed means this step's inputs do not
      // exist. Running it anyway would produce a confident wrong answer.
      const failedDependency = step.dependsOn.find(
        (id) => completed.get(id)?.status !== "succeeded",
      );
      if (failedDependency) {
        record.status = "skipped";
        record.reason = `Depends on "${failedDependency}", which did not succeed.`;
        execution.steps.push(record);
        completed.set(stepId, record);
        this.store.saveExecution({ ...execution });
        continue;
      }

      const gate = this.preflight({ ...workflow, steps: [step] })[0];
      if (!gate.runnable) {
        record.status = "blocked";
        record.reason = gate.reason;
        execution.steps.push(record);
        completed.set(stepId, record);
        this.store.saveExecution({ ...execution });
        continue;
      }

      const { resolved, missing } = resolveArguments(step.arguments, completed);
      if (missing.length > 0) {
        record.status = "skipped";
        record.reason = `Referenced output of ${missing.join(", ")}, which is not available.`;
        execution.steps.push(record);
        completed.set(stepId, record);
        this.store.saveExecution({ ...execution });
        continue;
      }

      record.status = "running";
      record.startedAt = Date.now();
      execution.steps.push(record);
      this.store.saveExecution({ ...execution });

      // THE REAL EXECUTION — the same dispatcher a native tool call uses.
      const result = await dispatchToolCall(
        {
          id: `${execution.id}:${stepId}`,
          name: toolNameForModel(step.tool),
          arguments: resolved,
        },
        taskId,
      );

      record.status = result.ok ? "succeeded" : "failed";
      record.output = result.content;
      record.finishedAt = Date.now();
      if (!result.ok) record.reason = result.content;
      completed.set(stepId, record);
      this.store.saveExecution({ ...execution });
    }

    for (const stepId of unresolvable) {
      const record: StepExecution = {
        stepId,
        status: "blocked",
        output: "",
        reason: "Part of a dependency cycle; it can never become ready.",
      };
      execution.steps.push(record);
      completed.set(stepId, record);
    }

    const hardFailure = execution.steps.some(
      (record) =>
        (record.status === "failed" || record.status === "blocked") &&
        !byId.get(record.stepId)?.optional,
    );
    const anySucceeded = execution.steps.some((record) => record.status === "succeeded");

    execution.status = hardFailure ? (anySucceeded ? "partial" : "failed") : "succeeded";
    execution.finishedAt = Date.now();
    execution.summary = this.describe(execution);
    this.store.saveExecution(execution);
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
      `${execution.steps.length} step(s): ${parts.join(", ")}.` +
      (blocked.length ? ` Blocked: ${blocked.map((r) => r.reason).join(" ")}` : "")
    );
  }
}
