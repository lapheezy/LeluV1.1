/**
 * ==========================================================
 * LÉLU
 * LOCAL JOB QUEUE — sequential, cancellable, persistent
 *
 * Every expensive creative operation (inference, image gen,
 * video gen, 3D build, Blender render, simulation, game build,
 * film build, universe build) is a job. The queue runs them
 * one at a time so LÉLU never overloads the local backend.
 *
 * Statuses: QUEUED → RUNNING → COMPLETED / FAILED / CANCELLED
 *
 * Each runner receives a progress callback and a cancel token
 * so it can report progress and abort cleanly. Jobs are
 * persisted through KvStore so a tab reload does not lose them.
 * ==========================================================
 */

import KvStore from "../../storage/KvStore";
import type { LocalJob, LocalJobStatus, LocalJobType } from "./LocalRuntimeTypes";

export type { LocalJob, LocalJobStatus, LocalJobType } from "./LocalRuntimeTypes";

type JobRunner = (
  report: (progress: number, log?: string) => void,
  cancelToken: { cancelled: boolean },
) => Promise<unknown>;

interface InternalJob extends LocalJob {
  runner: JobRunner;
  cancelToken: { cancelled: boolean };
}

const STORAGE_KEY = "runtime.local.jobs.v1";

export default class LocalJobQueue {
  private static instance: LocalJobQueue | null = null;

  private jobs: InternalJob[] = [];
  private processing = false;
  private jobCounter = 0;

  public static getInstance(): LocalJobQueue {
    if (!LocalJobQueue.instance) {
      LocalJobQueue.instance = new LocalJobQueue();
    }
    return LocalJobQueue.instance;
  }

  private constructor() {
    this.load();
  }

  /* ---------- public ---------- */

  public submit(
    type: LocalJobType,
    label: string,
    runner: JobRunner,
  ): LocalJob {
    const id = `job-${Date.now()}-${(this.jobCounter += 1)}`;
    const cancelToken = { cancelled: false };
    const job: InternalJob = {
      id,
      type,
      label,
      status: "queued",
      progress: 0,
      startedAt: null,
      completedAt: null,
      logs: [],
      runner,
      cancelToken,
    };
    this.jobs.push(job);
    this.persist();
    this.tick();
    return this.toPublic(job);
  }

  public get(id: string): LocalJob | undefined {
    const internal = this.jobs.find((j) => j.id === id);
    return internal ? this.toPublic(internal) : undefined;
  }

  public list(): LocalJob[] {
    return this.jobs.map((j) => this.toPublic(j));
  }

  public cancel(id: string): boolean {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) {
      return false;
    }
    if (job.status === "queued") {
      job.status = "cancelled";
      job.completedAt = Date.now();
      job.logs.push("[cancelled while queued]");
      this.persist();
      return true;
    }
    if (job.status === "running") {
      job.cancelToken.cancelled = true;
      job.logs.push("[cancellation requested]");
      // The runner must honor the token and resolve; we don't force-
      // fail it — the next report() after cancellation will see it.
      return true;
    }
    return false;
  }

  public clearCompleted(): void {
    this.jobs = this.jobs.filter(
      (j) => j.status === "running" || j.status === "queued",
    );
    this.persist();
  }

  public activeCount(): number {
    return this.jobs.filter(
      (j) => j.status === "running" || j.status === "queued",
    ).length;
  }

  public totalRun(): number {
    return this.jobs.filter(
      (j) => j.status === "completed" || j.status === "failed",
    ).length;
  }

  /* ---------- internal ---------- */

  private toPublic(job: InternalJob): LocalJob {
    return {
      id: job.id,
      type: job.type,
      label: job.label,
      status: job.status,
      progress: job.progress,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      logs: [...job.logs],
      output: job.output,
      error: job.error,
    };
  }

  private tick(): void {
    if (this.processing) {
      return;
    }
    void this.runNext();
  }

  private async runNext(): Promise<void> {
    const next = this.jobs.find((j) => j.status === "queued");
    if (!next) {
      return;
    }
    this.processing = true;
    next.status = "running";
    next.startedAt = Date.now();
    next.logs.push("[started]");
    this.persist();

    const report = (progress: number, log?: string) => {
      next.progress = Math.max(0, Math.min(1, progress));
      if (log) {
        next.logs.push(log);
      }
      if (next.cancelToken.cancelled) {
        next.status = "cancelled";
        next.completedAt = Date.now();
        next.logs.push("[cancelled mid-execution]");
        this.persist();
        throw new DOMException("Job cancelled.", "AbortError");
      }
    };

    try {
      next.output = await next.runner(report, next.cancelToken);
      next.status = "completed";
      next.completedAt = Date.now();
      next.progress = 1;
      next.logs.push("[completed]");
    } catch (error) {
      if ((next as InternalJob).status === "cancelled") {
        // already handled in report()
      } else {
        next.status = "failed";
        next.error = error instanceof Error ? error.message : String(error);
        next.completedAt = Date.now();
        next.logs.push(`[failed: ${next.error}]`);
      }
    } finally {
      this.processing = false;
      this.persist();
      void this.runNext();
    }
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(
        STORAGE_KEY,
        this.jobs.map((j) => this.toPublic(j)).slice(-50),
      );
    } catch {
      // best-effort
    }
  }

  private load(): void {
    try {
      const stored = KvStore.getInstance().get<LocalJob[]>(STORAGE_KEY) ?? [];
      this.jobs = stored
        .filter((j) => j.status === "queued" || j.status === "running")
        .map(
          (j): InternalJob => ({
            ...j,
            logs: [...j.logs, "[reloaded after tab restore; task terminated]"],
            status: "failed" as LocalJobStatus,
            error: "Tab was closed or reloaded while job was active.",
            runner: () => Promise.resolve(null),
            cancelToken: { cancelled: true },
          }),
        );
      this.jobCounter = this.jobs.length;
    } catch {
      this.jobs = [];
    }
  }
}