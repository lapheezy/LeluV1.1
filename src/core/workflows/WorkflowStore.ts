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

/**
 * How a condition compares a step's real outcome.
 *
 * Deliberately a closed set of DATA operators. There is no expression
 * to evaluate and no code to run: branching is decided by comparing a
 * recorded step result against a literal, so a workflow LÉLU authors
 * herself can never smuggle executable logic into the engine.
 */
export type ConditionOperator =
  | "succeeded"
  | "failed"
  | "contains"
  | "not-contains"
  | "equals"
  | "empty"
  | "not-empty";

/** A test over one already-executed step. */
export interface StepCondition {
  /** The step whose result is examined. */
  step: string;
  operator: ConditionOperator;
  /** The literal compared against, for contains / not-contains / equals. */
  value?: string;
}

/**
 * Re-attempt a failing step.
 *
 * This is retry, not revision: the same arguments are sent again, for
 * transient failures. Revision — changing the input based on what came
 * back — is what `loop` expresses.
 */
export interface RetryPolicy {
  /** Total attempts including the first. Clamped by the engine. */
  maxAttempts: number;
  /** Only retry when the failure text contains this. */
  when?: string;
}

/**
 * Repeat a step until its own result satisfies a condition.
 *
 * Each iteration is recorded separately and may reference the previous
 * iteration's output via `{{steps.<this step>.output}}`, which is how a
 * step revises its own work. Always bounded — a loop that never
 * satisfies its condition ends at maxIterations, and says so.
 */
export interface LoopPolicy {
  until: StepCondition;
  maxIterations: number;
}

/**
 * What a real failure means for the rest of the run.
 *
 *  fail      — the default: the workflow reports failure (dependents skip)
 *  continue  — recorded, the run carries on (equivalent to optional)
 *  stop      — end the run here, deliberately, with the reason recorded
 *  escalate  — end the run and record a real request for a person
 */
export type FailureAction = "fail" | "continue" | "stop" | "escalate";

export interface FailurePolicy {
  action: FailureAction;
  /** For escalate: exactly what a person is being asked to decide. */
  escalate?: string;
}

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
  /**
   * BRANCH: run this step only when the condition holds. Otherwise it
   * is skipped with the real reason, and so is anything depending on
   * it — which is how two mutually exclusive conditions form a branch.
   */
  condition?: StepCondition;
  /** RETRY: re-attempt on failure. */
  retry?: RetryPolicy;
  /** LOOP: repeat until the condition over its own output holds. */
  loop?: LoopPolicy;
  /** FAILURE PATH: what a real failure means for the run. */
  onFailure?: FailurePolicy;
  /**
   * TERMINATION: after this step, end the run early when the condition
   * holds. The remaining steps are recorded as skipped for that reason,
   * never as if they had run.
   */
  terminateWhen?: StepCondition;
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
  | "blocked"
  /** Failed, and the failure policy handed the decision to a person. */
  | "escalated";

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
  /** How many times the tool was really invoked for this record. */
  attempts?: number;
  /** 1-based loop iteration; absent for a step that runs once. */
  iteration?: number;
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

export type ExecutionStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "partial"
  /** Stopped and handed to a person by a step's failure policy. */
  | "escalated";

/** A real request for a human decision, raised by a failure policy. */
export interface WorkflowEscalation {
  stepId: string;
  /** What the person is being asked to decide. */
  request: string;
  /** The failure that caused it, verbatim. */
  failure: string;
  raisedAt: number;
}

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
  /** Set when the run ended early on purpose, with the reason. */
  terminatedBy?: { stepId: string; reason: string };
  /** Set when a failure policy escalated to a person. */
  escalation?: WorkflowEscalation;
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
