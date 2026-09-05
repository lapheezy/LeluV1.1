/**
 * ==========================================================
 * LÉLU
 * WORKFLOW STORE — definitions and execution state
 *
 * A workflow is a named, reusable sequence of steps, where each
 * step invokes a tool LÉLU ALREADY HAS. It is deliberately not a
 * second agent runtime: a step names a tool id from the existing
 * ToolRegistry, and WorkflowEngine runs it through the existing
 * ToolDispatcher — the same path a model's native tool call takes.
 *
 * Both definitions and executions persist through the existing
 * KvStore, so a workflow survives a reload and an interrupted run
 * can be inspected rather than silently lost.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export interface WorkflowStep {
  id: string;
  name: string;
  /** A tool id from the existing ToolRegistry, e.g. "research.web". */
  tool: string;
  /**
   * Arguments for the tool. A value may reference an earlier step's
   * output with `{{steps.<stepId>.output}}`, which is how context
   * flows from one step to the next.
   */
  arguments: Record<string, unknown>;
  /** Steps that must succeed first. */
  dependsOn: string[];
  /**
   * When true, a failure is recorded but does not fail the workflow.
   * Anything depending on it is still skipped.
   */
  optional?: boolean;
}

/**
 * A value the caller must supply for the workflow to run.
 *
 * Declared rather than inferred, so cognition can tell the difference
 * between "this workflow cannot run here" and "I need to ask the user
 * for something first" — two different next actions.
 */
export interface WorkflowInput {
  name: string;
  description: string;
  required: boolean;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  /** Inputs referenced by steps as {{input.<name>}}. */
  inputs?: WorkflowInput[];
  /** What a successful run produces, in plain terms. */
  outputs?: string;
  steps: WorkflowStep[];
  /** Optional project this workflow belongs to. */
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export type StepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "blocked";

export interface StepExecution {
  stepId: string;
  /** The step's human name, so a reader need not re-join the definition. */
  name: string;
  /** The tool this step invoked. */
  tool: string;
  status: StepStatus;
  /**
   * The arguments actually sent to the tool, AFTER context substitution.
   * Recorded because "what was this step given" is a different question
   * from "what did the workflow declare", and only the first explains a
   * result.
   */
  input: Record<string, unknown>;
  /** The REAL tool result content, never a summary of an intention. */
  output: string;
  /** Why a step is blocked or skipped — the actual reason. */
  reason?: string;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * Who asked for this run.
 *
 * A workflow reached from chat, from an agent, or from cognition is the
 * same execution, but the answer to "why did this happen" differs — and
 * an agent needs to find its own runs among everything else.
 */
export interface WorkflowOrigin {
  kind: "chat" | "agent" | "cognition" | "manual";
  /** AgentStore id when an agent invoked it. */
  agentId?: string;
  /** The chat task id / conversation turn that led here. */
  taskId?: string;
  /** The request in the invoker's own words. */
  reason?: string;
}

export type ExecutionStatus = "running" | "succeeded" | "failed" | "partial";

/** Values supplied for one run, keyed by input name. */
export type WorkflowInputValues = Record<string, string>;

export interface WorkflowExecution {
  /** The invocation id — unique per run, stable across updates. */
  id: string;
  workflowId: string;
  /** Denormalised so a run is readable without its definition. */
  workflowName: string;
  status: ExecutionStatus;
  /** The step running right now, or null between/after steps. */
  currentStepId: string | null;
  steps: StepExecution[];
  /** Steps not yet reached, in the order they will be attempted. */
  pendingStepIds: string[];
  origin: WorkflowOrigin;
  /** The inputs this run was given. */
  inputs: WorkflowInputValues;
  startedAt: number;
  finishedAt?: number;
  summary: string;
  /**
   * The workflow's result: the output of the last step that succeeded.
   * Null when nothing succeeded — an empty result is not a result.
   */
  finalResult: string | null;
}

const DEFS_KEY = "lelu.workflows.definitions.v1";
const RUNS_KEY = "lelu.workflows.executions.v1";
const MAX_RUNS = 50;

type Listener = () => void;

export default class WorkflowStore {
  private static instance: WorkflowStore | null = null;

  private readonly kv = KvStore.getInstance();
  private listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): WorkflowStore {
    if (!WorkflowStore.instance) {
      WorkflowStore.instance = new WorkflowStore();
    }
    return WorkflowStore.instance;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* a listener must never break the store */
      }
    }
  }

  /* ---------------------------- definitions ---------------------------- */

  public list(): WorkflowDefinition[] {
    return this.kv.get<WorkflowDefinition[]>(DEFS_KEY) ?? [];
  }

  public get(id: string): WorkflowDefinition | undefined {
    return this.list().find((workflow) => workflow.id === id);
  }

  public define(
    input: Omit<WorkflowDefinition, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): WorkflowDefinition {
    const now = Date.now();
    const workflow: WorkflowDefinition = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const existing = this.list().filter((entry) => entry.id !== workflow.id);
    this.kv.set(DEFS_KEY, [...existing, workflow]);
    this.notify();
    return workflow;
  }

  public remove(id: string): void {
    this.kv.set(DEFS_KEY, this.list().filter((workflow) => workflow.id !== id));
    this.notify();
  }

  /* ---------------------------- executions ---------------------------- */

  public executions(workflowId?: string): WorkflowExecution[] {
    const all = this.kv.get<WorkflowExecution[]>(RUNS_KEY) ?? [];
    return workflowId ? all.filter((run) => run.workflowId === workflowId) : all;
  }

  public execution(id: string): WorkflowExecution | undefined {
    return this.executions().find((run) => run.id === id);
  }

  public saveExecution(execution: WorkflowExecution): void {
    const others = this.executions().filter((run) => run.id !== execution.id);
    // Newest first, bounded — an execution log must not grow without limit.
    this.kv.set(RUNS_KEY, [execution, ...others].slice(0, MAX_RUNS));
    this.notify();
  }
}
