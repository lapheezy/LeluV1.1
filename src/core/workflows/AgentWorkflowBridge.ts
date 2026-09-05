/**
 * ==========================================================
 * LÉLU
 * AGENT ↔ WORKFLOW BRIDGE
 *
 * AgentStore agents could not reach the workflow substrate at
 * all: workflows existed and executed, but only if something
 * outside the agent system invoked them.
 *
 * This is the smallest connection that closes that, and it adds
 * no storage of its own. Discovery reads the existing
 * WorkflowStore; execution goes through the existing
 * WorkflowEngine (and therefore the existing ToolDispatcher);
 * the outcome is recorded through AgentStore.recordExecution,
 * the same call the agent system already uses for every other
 * kind of work, so an agent's history has one shape.
 *
 * What an agent gets back is the REAL execution — every step,
 * its inputs, its outputs and its failures — not a summary
 * string. Cognition can then reason about what actually ran.
 * ==========================================================
 */

import AgentStore from "../agents/AgentStore";
import WorkflowEngine from "./WorkflowEngine";
import WorkflowStore, {
  type WorkflowDefinition,
  type WorkflowExecution,
} from "./WorkflowStore";

export interface WorkflowOffer {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  /** Which steps could run right now, and why the others could not. */
  runnable: boolean;
  blockers: string[];
}

export default class AgentWorkflowBridge {
  private static instance: AgentWorkflowBridge | null = null;

  private readonly store = WorkflowStore.getInstance();
  private readonly engine = WorkflowEngine.getInstance();

  private constructor() {}

  public static getInstance(): AgentWorkflowBridge {
    if (!AgentWorkflowBridge.instance) {
      AgentWorkflowBridge.instance = new AgentWorkflowBridge();
    }
    return AgentWorkflowBridge.instance;
  }

  /**
   * What workflows can this agent actually run right now?
   *
   * Every offer carries its real blockers, so a caller choosing a
   * workflow is choosing among things that can execute rather than
   * discovering mid-run that a step needed a provider key.
   */
  public discover(): WorkflowOffer[] {
    return this.store.list().map((workflow) => {
      const preflight = this.engine.preflight(workflow);
      const blockers = preflight
        .filter((entry) => !entry.runnable)
        .map((entry) => `${entry.stepId}: ${entry.reason}`);
      return {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        stepCount: workflow.steps.length,
        runnable: blockers.length === 0,
        blockers,
      };
    });
  }

  /** Find a workflow by id, or by an exact/partial name match. */
  public resolve(identifier: string): WorkflowDefinition | undefined {
    const needle = identifier.trim().toLowerCase();
    if (!needle) return undefined;
    const all = this.store.list();
    return (
      all.find((workflow) => workflow.id === identifier) ??
      all.find((workflow) => workflow.name.toLowerCase() === needle) ??
      all.find((workflow) => workflow.name.toLowerCase().includes(needle))
    );
  }

  /**
   * Run a workflow ON BEHALF OF an agent, and record it in that
   * agent's own execution history.
   *
   * The recorded result is a factual account of the run — which steps
   * ran, what each produced — so the agent's history says what
   * happened rather than that something happened.
   */
  public async runForAgent(
    agentId: string,
    workflowIdentifier: string,
    reason = "",
  ): Promise<{ ok: boolean; execution?: WorkflowExecution; error?: string }> {
    const agents = AgentStore.getInstance();
    const agent = agents.get(agentId);
    if (!agent) {
      return { ok: false, error: `No agent with id ${agentId}.` };
    }

    const workflow = this.resolve(workflowIdentifier);
    if (!workflow) {
      return { ok: false, error: `No workflow matches "${workflowIdentifier}".` };
    }

    const execution = await this.engine.run(workflow.id, {
      kind: "agent",
      agentId,
      reason,
    });

    // Recorded through the EXISTING agent execution history, so a
    // workflow run appears alongside the agent's other work.
    agents.recordExecution(agentId, {
      taskId: execution.id,
      prompt: reason || `Run workflow “${workflow.name}”`,
      provider: "workflow",
      model: workflow.name,
      offline: false,
      result: describeExecution(execution),
      processingTime: (execution.finishedAt ?? Date.now()) - execution.startedAt,
    });

    return { ok: execution.status !== "failed", execution };
  }

  /** Every run an agent has performed, newest first. */
  public executionsForAgent(agentId: string): WorkflowExecution[] {
    return this.store
      .executions()
      .filter((execution) => execution.origin.agentId === agentId);
  }
}

/**
 * A factual, step-by-step account of a run.
 *
 * Shared by the agent record, the native tool result and the cognitive
 * context so all three describe the same execution the same way — and
 * so none of them can describe one that did not happen.
 */
export function describeExecution(execution: WorkflowExecution): string {
  const lines = [
    `Workflow “${execution.workflowName}” — ${execution.status.toUpperCase()} (invocation ${execution.id.slice(0, 8)}).`,
  ];
  for (const step of execution.steps) {
    const detail =
      step.status === "succeeded"
        ? step.output.replace(/\s+/g, " ").slice(0, 240)
        : (step.reason ?? "no reason recorded");
    lines.push(`  • ${step.name} [${step.tool}] → ${step.status}: ${detail}`);
  }
  if (execution.pendingStepIds.length > 0) {
    lines.push(`  pending: ${execution.pendingStepIds.join(", ")}`);
  }
  lines.push(
    execution.finalResult
      ? `Result: ${execution.finalResult.replace(/\s+/g, " ").slice(0, 400)}`
      : "Result: none — no step produced output.",
  );
  return lines.join("\n");
}
