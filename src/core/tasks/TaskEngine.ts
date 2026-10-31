/**
 * ==========================================================
 * LÉLU TASK ENGINE — Persistent multi-step tasks
 *
 * LÉLU can pause, resume, retry, and continue work.
 * Each task has a checkpoint so interrupted work can resume.
 * Tasks persist across sessions via KvStore.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import LeluRuntime from "../runtime/LeluRuntime";

export type TaskStatus =
  | "new"
  | "planning"
  | "running"
  | "paused"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskPriority = "critical" | "high" | "normal" | "low";

export interface TaskStep {
  id: string;
  title: string;
  description: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  /**
   * What this step DOES, when it is executable. A step without an action
   * is a label (the original planning-only shape); the TaskExecutor runs
   * steps that carry one. See src/core/agentic/TaskExecutor.ts.
   */
  action?: StepAction;
  /** Step ids that must complete first. Absent: the previous step. */
  dependsOn?: string[];
  /** A check the step's real output must pass before it counts as done. */
  verify?: StepVerification;
  /** Attempts allowed, including the first (default 2, max 5). */
  maxAttempts?: number;
  attempts?: number;
  /** Full output of the step (result is a short preview). */
  output?: string;
  /** Set while the step waits on a human decision. */
  approvalId?: string;
}

export type StepAction =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "agent"; agent: string; instruction: string }
  | { kind: "reason"; prompt: string };

export interface StepVerification {
  operator: "not-empty" | "contains" | "not-contains" | "equals";
  value?: string;
}

export interface TaskCheckpoint {
  stepIndex: number;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface Task {
  id: string;
  goal: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  steps: TaskStep[];
  currentStepIndex: number;
  requiredTools: string[];
  permissions: string[];
  dependencies: string[];
  result?: string;
  error?: string;
  checkpoint?: TaskCheckpoint;
  /** Where the task came from: "chat", "orchestrator", "model", "reflection"… */
  origin?: string;
  /** The verified completion report, written by the TaskExecutor. */
  report?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

const KEY = "lelu.tasks.v1";

type TaskListener = (tasks: Task[]) => void;

export default class TaskEngine {
  private static instance: TaskEngine | null = null;
  private tasks: Task[] = [];
  private listeners = new Set<TaskListener>();

  private constructor() {
    this.tasks = this.load();
  }

  static getInstance(): TaskEngine {
    if (!TaskEngine.instance) {
      TaskEngine.instance = new TaskEngine();
    }
    return TaskEngine.instance;
  }

  // ---------- CRUD ----------

  create(input: {
    goal: string;
    description?: string;
    priority?: TaskPriority;
    steps?: Array<{
      title: string;
      description: string;
      id?: string;
      action?: StepAction;
      dependsOn?: string[];
      verify?: StepVerification;
      maxAttempts?: number;
    }>;
    requiredTools?: string[];
    permissions?: string[];
    dependencies?: string[];
    origin?: string;
  }): Task {
    const now = Date.now();
    const task: Task = {
      id: crypto.randomUUID(),
      goal: input.goal,
      description: input.description ?? "",
      status: "new",
      priority: input.priority ?? "normal",
      steps: (input.steps ?? []).map((step, index) => ({
        id: step.id ?? `step-${now}-${index}`,
        title: step.title,
        description: step.description,
        status: "pending" as const,
        ...(step.action ? { action: step.action } : {}),
        ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}),
        ...(step.verify ? { verify: step.verify } : {}),
        ...(step.maxAttempts ? { maxAttempts: step.maxAttempts } : {}),
      })),
      ...(input.origin ? { origin: input.origin } : {}),
      currentStepIndex: 0,
      requiredTools: input.requiredTools ?? [],
      permissions: input.permissions ?? [],
      dependencies: input.dependencies ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.unshift(task);
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task created: ${input.goal}`);
    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  list(): Task[] {
    return [...this.tasks];
  }

  listByStatus(status: TaskStatus): Task[] {
    return this.tasks.filter((t) => t.status === status);
  }

  // ---------- STATE TRANSITIONS ----------

  start(taskId: string): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    task.status = "running";
    task.startedAt = task.startedAt ?? Date.now();
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task started: ${task.goal}`);
    return task;
  }

  pause(taskId: string, checkpoint?: Record<string, unknown>): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    task.status = "paused";
    task.checkpoint = {
      stepIndex: task.currentStepIndex,
      data: checkpoint ?? {},
      timestamp: Date.now(),
    };
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task paused: ${task.goal}`);
    return task;
  }

  resume(taskId: string): Task | undefined {
    const task = this.get(taskId);
    if (!task || task.status !== "paused") return undefined;
    task.status = "running";
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task resumed: ${task.goal}`);
    return task;
  }

  completeStep(taskId: string, stepId: string, result?: string): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    const step = task.steps.find((s) => s.id === stepId);
    if (!step) return undefined;
    step.status = "completed";
    step.result = result;
    step.completedAt = Date.now();

    // Advance to next step or complete the task
    const nextPending = task.steps.findIndex(
      (s) => s.status === "pending",
    );
    if (nextPending >= 0) {
      task.currentStepIndex = nextPending;
    } else if (task.steps.every((s) => s.status === "completed" || s.status === "skipped")) {
      task.status = "completed";
      task.completedAt = Date.now();
      LeluRuntime.getInstance().recordActivity(`Task completed: ${task.goal}`);
    }
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    return task;
  }

  failStep(taskId: string, stepId: string, error: string): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    const step = task.steps.find((s) => s.id === stepId);
    if (!step) return undefined;
    step.status = "failed";
    step.error = error;
    step.completedAt = Date.now();
    task.status = "failed";
    task.error = error;
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task failed: ${task.goal} — ${error}`);
    return task;
  }

  retry(taskId: string): Task | undefined {
    const task = this.get(taskId);
    if (!task || (task.status !== "failed" && task.status !== "paused")) return undefined;
    // Reset failed steps to pending
    for (const step of task.steps) {
      if (step.status === "failed") {
        step.status = "pending";
        step.error = undefined;
        step.result = undefined;
        step.completedAt = undefined;
      }
    }
    task.status = "new";
    task.error = undefined;
    task.currentStepIndex = task.steps.findIndex((s) => s.status === "pending");
    if (task.currentStepIndex < 0) task.currentStepIndex = 0;
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task retried: ${task.goal}`);
    return task;
  }

  cancel(taskId: string): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    task.status = "cancelled";
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    LeluRuntime.getInstance().recordActivity(`Task cancelled: ${task.goal}`);
    return task;
  }

  wait(taskId: string, reason: string): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    task.status = "waiting";
    task.description = `${task.description}\n[Waiting: ${reason}]`;
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    return task;
  }

  // ---------- MULTI-STEP EXECUTION ----------

  /** Add steps to an existing task (for dynamic planning). */
  addSteps(taskId: string, steps: { title: string; description: string }[]): Task | undefined {
    const task = this.get(taskId);
    if (!task) return undefined;
    const now = Date.now();
    for (const step of steps) {
      task.steps.push({
        id: `step-${now}-${task.steps.length}`,
        title: step.title,
        description: step.description,
        status: "pending",
      });
    }
    task.updatedAt = Date.now();
    this.persist();
    this.notify();
    return task;
  }

  /** Get the current step to execute. */
  getCurrentStep(taskId: string): TaskStep | undefined {
    const task = this.get(taskId);
    if (!task || task.status !== "running") return undefined;
    return task.steps[task.currentStepIndex];
  }

  /**
   * Persist a task the caller has mutated in place. The executor changes
   * step state directly and checkpoints through here after every step, so
   * an interrupted run resumes from the last step that really finished.
   */
  save(task: Task): void {
    task.updatedAt = Date.now();
    const index = this.tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) this.tasks[index] = task;
    else this.tasks.unshift(task);
    this.persist();
    this.notify();
  }

  /** Re-read every task from storage (a fresh start reads the same state). */
  reload(): void {
    this.tasks = this.load();
    this.notify();
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: TaskListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    const snapshot = [...this.tasks];
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch (err) {
        console.error("[TaskEngine] Listener error:", err);
      }
    }
  }

  // ---------- PERSISTENCE ----------

  private load(): Task[] {
    try {
      return KvStore.getInstance().get<Task[]>(KEY) ?? [];
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.tasks.slice(0, 200));
    } catch { /* best-effort */ }
  }
}
