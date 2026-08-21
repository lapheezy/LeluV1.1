/**
 * ==========================================================
 * LÉLU BACKGROUND TASK ENGINE
 *
 * Controlled autonomous continuation of permitted tasks:
 *   - Long-running project work
 *   - Monitoring a task
 *   - Waiting for an external result
 *   - Continuing a multi-step workflow
 *   - Checking whether an operation completed
 *   - Preparing information
 *   - Reminding about unfinished work
 *
 * Uses explicit permissions — no unrestricted authority.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import TaskEngine from "./TaskEngine";
import LeluRuntime from "../runtime/LeluRuntime";

export type BackgroundPermission = "none" | "observe" | "continue" | "full";

export interface BackgroundTask {
  id: string;
  taskId: string;
  permission: BackgroundPermission;
  intervalMs: number;
  lastRun: number;
  nextRun: number;
  runCount: number;
  maxRuns: number;
  status: "active" | "paused" | "completed" | "expired";
  description: string;
}

type BackgroundListener = (event: { taskId: string; status: string; message: string }) => void;

const KEY = "lelu.background.v1";

export default class BackgroundEngine {
  private static instance: BackgroundEngine | null = null;
  private tasks: BackgroundTask[] = [];
  private listeners = new Set<BackgroundListener>();
  private tickTimer: number | null = null;

  private constructor() {
    this.tasks = this.load();
  }

  static getInstance(): BackgroundEngine {
    if (!BackgroundEngine.instance) {
      BackgroundEngine.instance = new BackgroundEngine();
    }
    return BackgroundEngine.instance;
  }

  // ---------- LIFECYCLE ----------

  start(): void {
    if (this.tickTimer !== null) return;
    // Check every 30 seconds
    this.tickTimer = window.setInterval(() => void this.tick(), 30_000);
  }

  stop(): void {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  // ---------- TASK MANAGEMENT ----------

  schedule(taskId: string, permission: BackgroundPermission, intervalMs: number, maxRuns = 10, description = ""): BackgroundTask {
    const existing = this.tasks.find((t) => t.taskId === taskId && t.status === "active");
    if (existing) return existing;

    const now = Date.now();
    const bgTask: BackgroundTask = {
      id: crypto.randomUUID(),
      taskId,
      permission,
      intervalMs,
      lastRun: 0,
      nextRun: now + intervalMs,
      runCount: 0,
      maxRuns,
      status: "active",
      description,
    };

    this.tasks.unshift(bgTask);
    this.persist();
    LeluRuntime.getInstance().recordActivity(`Background task scheduled: ${description || taskId}`);
    this.emit({ taskId, status: "scheduled", message: description || `Background task scheduled for ${taskId}` });
    return bgTask;
  }

  pause(taskId: string): void {
    const task = this.tasks.find((t) => t.taskId === taskId && t.status === "active");
    if (task) {
      task.status = "paused";
      this.persist();
      this.emit({ taskId, status: "paused", message: `Background task paused: ${task.description}` });
    }
  }

  resume(taskId: string): void {
    const task = this.tasks.find((t) => t.taskId === taskId && t.status === "paused");
    if (task) {
      task.status = "active";
      task.nextRun = Date.now() + task.intervalMs;
      this.persist();
      this.emit({ taskId, status: "resumed", message: `Background task resumed: ${task.description}` });
    }
  }

  cancel(taskId: string): void {
    const task = this.tasks.find((t) => t.taskId === taskId);
    if (task) {
      task.status = "expired";
      this.persist();
      this.emit({ taskId, status: "cancelled", message: `Background task cancelled: ${task.description}` });
    }
  }

  list(): BackgroundTask[] {
    return [...this.tasks];
  }

  listActive(): BackgroundTask[] {
    return this.tasks.filter((t) => t.status === "active");
  }

  // ---------- TICK ----------

  private async tick(): Promise<void> {
    const now = Date.now();
    const taskEngine = TaskEngine.getInstance();

    for (const bgTask of this.tasks) {
      if (bgTask.status !== "active") continue;
      if (now < bgTask.nextRun) continue;
      if (bgTask.runCount >= bgTask.maxRuns) {
        bgTask.status = "expired";
        continue;
      }

      // Execute
      bgTask.lastRun = now;
      bgTask.nextRun = now + bgTask.intervalMs;
      bgTask.runCount += 1;

      try {
        const task = taskEngine.get(bgTask.taskId);
        if (!task) {
          bgTask.status = "expired";
          continue;
        }

        if (bgTask.permission === "observe") {
          // Observe-only: just check status
          this.emit({
            taskId: bgTask.taskId,
            status: "observed",
            message: `Task "${task.goal}" status: ${task.status}`,
          });
        } else if (bgTask.permission === "continue" || bgTask.permission === "full") {
          // Continue: try to advance the task
          if (task.status === "paused") {
            taskEngine.resume(task.id);
            this.emit({
              taskId: bgTask.taskId,
              status: "continued",
              message: `Resumed task: ${task.goal}`,
            });
          } else if (task.status === "running") {
            this.emit({
              taskId: bgTask.taskId,
              status: "monitoring",
              message: `Monitoring task: ${task.goal} (step ${task.currentStepIndex + 1}/${task.steps.length})`,
            });
          }
        }

        LeluRuntime.getInstance().recordActivity(`Background check: ${bgTask.description || bgTask.taskId}`);
      } catch (error) {
        this.emit({
          taskId: bgTask.taskId,
          status: "error",
          message: `Background task error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    this.persist();
  }

  // ---------- REMINDERS ----------

  /** Check for tasks that have been paused/open for too long and suggest resuming. */
  checkForStaleTasks(): string[] {
    const staleThreshold = Date.now() - 24 * 60 * 60 * 1000; // 24 hours
    const taskEngine = TaskEngine.getInstance();
    const stale = taskEngine.list().filter(
      (task) => task.status === "paused" && task.updatedAt < staleThreshold,
    );

    return stale.map((task) =>
      `You have a paused task from ${new Date(task.updatedAt).toLocaleDateString()}: "${task.goal}". Want me to continue?`,
    );
  }

  // ---------- SUBSCRIPTION ----------

  subscribe(listener: BackgroundListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: { taskId: string; status: string; message: string }): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* swallow */ }
    }
  }

  // ---------- PERSISTENCE ----------

  private load(): BackgroundTask[] {
    try { return KvStore.getInstance().get<BackgroundTask[]>(KEY) ?? []; } catch { return []; }
  }

  private persist(): void {
    try { KvStore.getInstance().set(KEY, this.tasks.slice(0, 50)); } catch { /* best-effort */ }
  }
}
