/**
 * ==========================================================
 * LÉLU — WORK THAT SURVIVES THE CONVERSATION IT STARTED IN
 *
 * The failure this fixes is the one people describe as \"she forgot what we
 * were doing\": an objective is stated in one conversation, three of its
 * steps are done, the tab closes, and the next conversation has no idea
 * that any of it happened — so the work is either abandoned or started
 * again from the first step.
 *
 * Everything needed already exists and is reused rather than duplicated:
 *
 *   ProjectStore   the project, its objective, its durable checkpoint
 *                  (status / completed / pending / blockers / nextAction)
 *   MultiChatStore conversations, each optionally bound to a project
 *
 * What was missing is the STEP LEDGER between them: which steps are done,
 * with what evidence, which one was in flight when the interruption came,
 * and which are still to do. That is all this module adds — and every
 * change is mirrored into the project's existing checkpoint, so the
 * Projects panel and ProjectStore.contextFor() show the same truth.
 *
 * TWO PROPERTIES THAT MATTER
 * --------------------------
 * Idempotent: starting the same objective in the same project returns the
 * record that already exists, and completing a step twice changes nothing
 * and says so (`duplicatePrevented`). Resuming never re-lists completed
 * work as work to do.
 *
 * Honest: a step is `completed` only when a caller records it with
 * evidence. An interruption moves in-flight steps back to `pending` — it
 * does not guess that they finished.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ProjectStore from "../projects/ProjectStore";

export type StepStatus = "pending" | "active" | "completed" | "failed" | "blocked";

export interface WorkStep {
  id: string;
  label: string;
  /** Normalised label, used to recognise the same step across resumptions. */
  key: string;
  status: StepStatus;
  /** What backs a completed step (a tool result, a commit, a measurement). */
  evidence?: string;
  attempts: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface WorkInterruption {
  at: number;
  reason: string;
  /** The steps that were in flight, by label. */
  interruptedSteps: string[];
}

export interface WorkRecord {
  id: string;
  objective: string;
  constraints: string[];
  steps: WorkStep[];
  projectId: string | null;
  /** The conversation that stated the objective. */
  conversationId: string;
  /** Every conversation this work has been resumed in. */
  resumedIn: string[];
  createdAt: number;
  updatedAt: number;
  interruptions: number;
  lastInterruption: WorkInterruption | null;
  resumptions: number;
}

export interface ResumePlan {
  record: WorkRecord;
  /** Steps that are done — named so they are NOT repeated. */
  completed: WorkStep[];
  /** Steps still to do, in order. */
  remaining: WorkStep[];
  blocked: WorkStep[];
  /** The context block for the new conversation. */
  context: string;
  /** True when this call moved the record from interrupted to resumed. */
  resumed: boolean;
  resumptions: number;
  /** Whether the resumption itself was written to durable storage. */
  persisted: boolean;
}

export interface StepOutcome {
  step: WorkStep;
  /** True when the work had already been recorded; nothing changed. */
  duplicatePrevented: boolean;
  record: WorkRecord;
  /**
   * Whether the change reached durable storage. False means it is in memory
   * only and will be gone after a reload — the caller must not report the
   * step as durably recorded.
   */
  persisted: boolean;
}

// KvStore applies its own "lelu." prefix; a prefixed key here would never
// be read back.
const KEY = "work.v1";
const MAX_RECORDS = 40;

/** Labels normalise to their significant words, so \"Run the tests\" matches \"run tests\". */
export function stepKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "into", "you", "your", "our"].includes(word))
    .join(" ");
}

export default class WorkContinuity {
  private static instance: WorkContinuity | null = null;

  private readonly kv = KvStore.getInstance();
  private records: WorkRecord[] | null = null;

  private constructor() {}

  public static getInstance(): WorkContinuity {
    if (!WorkContinuity.instance) WorkContinuity.instance = new WorkContinuity();
    return WorkContinuity.instance;
  }

  /** Test seam. */
  public static resetForTests(): void {
    WorkContinuity.instance = null;
  }

  private all(): WorkRecord[] {
    if (this.records === null) {
      const stored = this.kv.get<WorkRecord[]>(KEY);
      this.records = Array.isArray(stored) ? stored.filter((record) => record && record.id && Array.isArray(record.steps)) : [];
    }
    return this.records;
  }

  /** Write the ledger. Returns whether storage actually accepted it. */
  private persist(): boolean {
    try {
      return this.kv.set(KEY, this.all().slice(-MAX_RECORDS));
    } catch {
      return false;
    }
  }

  public list(): WorkRecord[] {
    return [...this.all()];
  }

  public get(id: string): WorkRecord | undefined {
    return this.all().find((record) => record.id === id);
  }

  /** The live record for a project (most recently touched), if any. */
  public forProject(projectId: string): WorkRecord | undefined {
    return this.all()
      .filter((record) => record.projectId === projectId && !this.isFinished(record))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  /** Any record still holding unfinished steps. */
  private isFinished(record: WorkRecord): boolean {
    return record.steps.every((step) => step.status === "completed") && record.steps.length > 0;
  }

  /**
   * Start tracking an objective.
   *
   * Idempotent by (project, objective): a second conversation stating the
   * same objective for the same project continues the record instead of
   * creating a rival one — which is what would otherwise make \"resume\"
   * ambiguous the moment the user rephrased.
   */
  public start(input: {
    objective: string;
    steps?: string[];
    constraints?: string[];
    projectId?: string | null;
    conversationId: string;
    at?: number;
  }): { record: WorkRecord; created: boolean; persisted: boolean } {
    const at = input.at ?? Date.now();
    const objectiveKey = stepKey(input.objective);
    const projectId = input.projectId ?? null;

    const existing = this.all().find(
      (record) =>
        !this.isFinished(record) &&
        record.projectId === projectId &&
        (stepKey(record.objective) === objectiveKey || record.objective === input.objective),
    );
    if (existing) {
      existing.updatedAt = at;
      if (input.constraints?.length) {
        existing.constraints = [...new Set([...existing.constraints, ...input.constraints])];
      }
      // A second conversation stating the same objective continues the same
      // work. Recording which conversations it has been seen in is what makes
      // "resume in another conversation" auditable rather than assumed.
      if (input.conversationId && !existing.resumedIn.includes(input.conversationId)) {
        existing.resumedIn.push(input.conversationId);
      }
      const persisted = this.persist();
      this.mirror(existing, at);
      return { record: existing, created: false, persisted };
    }

    const record: WorkRecord = {
      id: `work-${crypto.randomUUID()}`,
      objective: input.objective.trim(),
      constraints: [...new Set(input.constraints ?? [])],
      steps: (input.steps ?? []).map((label) => ({
        id: `step-${crypto.randomUUID()}`,
        label: label.trim(),
        key: stepKey(label),
        status: "pending",
        attempts: 0,
      })),
      projectId,
      conversationId: input.conversationId,
      resumedIn: [input.conversationId],
      createdAt: at,
      updatedAt: at,
      interruptions: 0,
      lastInterruption: null,
      resumptions: 0,
    };
    this.all().push(record);
    const persisted = this.persist();
    this.mirror(record, at);
    return { record, created: true, persisted };
  }

  /** Add a step that the plan did not foresee. Idempotent by label. */
  public addStep(recordId: string, label: string, at = Date.now()): WorkStep | undefined {
    const record = this.get(recordId);
    if (!record) return undefined;
    const key = stepKey(label);
    const existing = record.steps.find((step) => step.key === key);
    if (existing) return existing;
    const step: WorkStep = {
      id: `step-${crypto.randomUUID()}`,
      label: label.trim(),
      key,
      status: "pending",
      attempts: 0,
    };
    record.steps.push(step);
    record.updatedAt = at;
    this.persist();
    this.mirror(record, at);
    return step;
  }

  /**
   * Mark a step as started.
   *
   * A step already completed is returned untouched with
   * `duplicatePrevented` — the executor must not run it again.
   */
  public startStep(recordId: string, label: string, at = Date.now()): StepOutcome | undefined {
    const record = this.get(recordId);
    if (!record) return undefined;
    const step = record.steps.find((entry) => entry.key === stepKey(label));
    if (!step) {
      const added = this.addStep(recordId, label, at);
      return added ? { step: added, duplicatePrevented: false, record, persisted: true } : undefined;
    }
    if (step.status === "completed") {
      return { step, duplicatePrevented: true, record, persisted: true };
    }
    step.status = "active";
    step.startedAt = step.startedAt ?? at;
    step.attempts += 1;
    record.updatedAt = at;
    const persisted = this.persist();
    this.mirror(record, at);
    return { step, duplicatePrevented: false, record, persisted };
  }

  /**
   * Record a step's outcome.
   *
   * `ok: false` records a failure rather than a completion: an operation
   * that did not succeed must never be written as done.
   */
  public completeStep(
    recordId: string,
    label: string,
    outcome: { ok?: boolean; evidence?: string; at?: number } = {},
  ): StepOutcome | undefined {
    const at = outcome.at ?? Date.now();
    const record = this.get(recordId);
    if (!record) return undefined;
    let step = record.steps.find((entry) => entry.key === stepKey(label));
    if (!step) {
      const added = this.addStep(recordId, label, at);
      if (!added) return undefined;
      step = added;
    }
    if (step.status === "completed") {
      // Already done. Do not append evidence, do not bump attempts: a
      // duplicate execution is a defect to prevent, not work to record.
      return { step, duplicatePrevented: true, record, persisted: true };
    }
    const ok = outcome.ok ?? true;
    step.status = ok ? "completed" : "failed";
    step.finishedAt = at;
    step.attempts = Math.max(1, step.attempts);
    if (outcome.evidence) step.evidence = outcome.evidence;
    record.updatedAt = at;
    const persisted = this.persist();
    this.mirror(record, at);
    return { step, duplicatePrevented: false, record, persisted };
  }

  /** A step that cannot proceed without something outside LÉLU. */
  public blockStep(recordId: string, label: string, reason?: string, at = Date.now()): StepOutcome | undefined {
    const record = this.get(recordId);
    if (!record) return undefined;
    const step = record.steps.find((entry) => entry.key === stepKey(label));
    if (!step || step.status === "completed") {
      return step ? { step, duplicatePrevented: true, record, persisted: true } : undefined;
    }
    step.status = "blocked";
    step.finishedAt = at;
    if (reason) step.evidence = `blocked: ${reason}`;
    record.updatedAt = at;
    const persisted = this.persist();
    this.mirror(record, at);
    return { step, duplicatePrevented: false, record, persisted };
  }

  /**
   * The session ended mid-work.
   *
   * In-flight steps go back to `pending` — an interruption is not a
   * completion, and the only honest thing to say about a step that was
   * running is that it is not known to be done.
   */
  public interrupt(recordId: string, reason: string, at = Date.now()): WorkRecord | undefined {
    const record = this.get(recordId);
    if (!record) return undefined;
    const interruptedSteps: string[] = [];
    for (const step of record.steps) {
      if (step.status === "active") {
        interruptedSteps.push(step.label);
        step.status = "pending";
        step.startedAt = undefined;
      }
    }
    record.interruptions += 1;
    record.lastInterruption = { at, reason: reason.trim() || "the session ended before the step finished", interruptedSteps };
    record.updatedAt = at;
    this.persist();
    this.mirror(record, at);
    return record;
  }

  /**
   * Resume the work in a conversation — possibly a different one.
   *
   * The plan lists completed steps only so they are NOT repeated, and the
   * context block says which conversation the objective came from, so the
   * user can check that the right project was found.
   */
  public resume(input: {
    projectId?: string | null;
    objective?: string;
    conversationId: string;
    at?: number;
  }): ResumePlan | null {
    const at = input.at ?? Date.now();
    const record = input.projectId
      ? this.forProject(input.projectId)
      : this.all()
          .filter((entry) => !this.isFinished(entry))
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .find((entry) => (input.objective ? stepKey(entry.objective) === stepKey(input.objective) : true));

    if (!record) return null;

    const wasInterrupted = record.lastInterruption !== null || record.interruptions > 0;
    if (input.conversationId && !record.resumedIn.includes(input.conversationId)) {
      record.resumedIn.push(input.conversationId);
    }
    record.resumptions += 1;
    record.updatedAt = at;
    const persisted = this.persist();
    this.mirror(record, at);

    const completed = record.steps.filter((step) => step.status === "completed");
    const remaining = record.steps.filter((step) => step.status === "pending" || step.status === "active");
    const blocked = record.steps.filter((step) => step.status === "blocked" || step.status === "failed");

    return {
      record,
      completed,
      remaining,
      blocked,
      context: this.describe({ record, completed, remaining, blocked }),
      resumed: wasInterrupted,
      resumptions: record.resumptions,
      persisted,
    };
  }

  /**
   * The plan for a project, read without recording a resumption.
   *
   * `resume()` is the event — it counts, it writes, it names the conversation
   * it was resumed in. A turn that merely shows the work in progress must not
   * inflate that count, so it reads through here instead.
   */
  public currentPlan(projectId: string): ResumePlan | null {
    const record = this.forProject(projectId);
    if (!record) return null;
    const completed = record.steps.filter((step) => step.status === "completed");
    const remaining = record.steps.filter((step) => step.status === "pending" || step.status === "active");
    const blocked = record.steps.filter((step) => step.status === "blocked" || step.status === "failed");
    return {
      record,
      completed,
      remaining,
      blocked,
      context: this.describe({ record, completed, remaining, blocked }),
      resumed: false,
      resumptions: record.resumptions,
      persisted: true,
    };
  }

  /** The block that tells a new conversation where the work stands. */
  public describe(plan: {
    record: WorkRecord;
    completed: WorkStep[];
    remaining: WorkStep[];
    blocked: WorkStep[];
  }): string {
    const { record, completed, remaining, blocked } = plan;
    if (record.steps.length === 0) return "";
    const lines: string[] = [
      `## Work in progress — ${record.objective}`,
      `Stated in conversation ${record.conversationId}${record.projectId ? `, project ${record.projectId}` : ""}. Resumed ${record.resumptions} time(s).`,
    ];
    if (record.constraints.length > 0) {
      lines.push(`Constraints: ${record.constraints.join("; ")}`);
    }
    if (completed.length > 0) {
      lines.push(
        `Already done (do not repeat):\n${completed
          .map((step) => `- ${step.label}${step.evidence ? ` — ${step.evidence.slice(0, 120)}` : ""}`)
          .join("\n")}`,
      );
    }
    if (remaining.length > 0) {
      lines.push(`Still to do:\n${remaining.map((step) => `- ${step.label}`).join("\n")}`);
    }
    if (blocked.length > 0) {
      lines.push(`Blocked or failed:\n${blocked.map((step) => `- ${step.label}${step.evidence ? ` (${step.evidence})` : ""}`).join("\n")}`);
    }
    if (record.lastInterruption) {
      lines.push(
        `Interrupted ${new Date(record.lastInterruption.at).toISOString()}: ${record.lastInterruption.reason}` +
          (record.lastInterruption.interruptedSteps.length > 0
            ? ` — mid-way through: ${record.lastInterruption.interruptedSteps.join(", ")}`
            : ""),
      );
    }
    lines.push(
      "Continue the remaining steps; do not redo a completed one. If a step cannot proceed, say what it needs.",
    );
    return lines.join("\n");
  }

  /**
   * Mirror the ledger into the project's existing checkpoint.
   *
   * One truth, two readers: ProjectStore.contextFor() and the Projects
   * panel already format a checkpoint, so the step ledger does not invent
   * a second place to look.
   */
  private mirror(record: WorkRecord, at: number): void {
    if (!record.projectId) return;
    try {
      const project = ProjectStore.getInstance().get(record.projectId);
      if (!project) return;
      const completed = record.steps.filter((step) => step.status === "completed");
      const pending = record.steps.filter((step) => step.status === "pending" || step.status === "active");
      const blockers = record.steps
        .filter((step) => step.status === "blocked" || step.status === "failed")
        .map((step) => `${step.label}${step.evidence ? ` (${step.evidence})` : ""}`);
      const next = pending[0]?.label ?? null;
      const status = record.steps.length > 0 && pending.length === 0 && blockers.length === 0
        ? "completed"
        : record.lastInterruption && pending.length > 0
          ? "waiting_user"
          : blockers.length > 0
            ? "blocked"
            : "active";
      ProjectStore.getInstance().checkpoint(record.projectId, {
        status,
        summary: record.objective,
        completed: completed.map((step) => step.label),
        pending: pending.map((step) => step.label),
        blockers,
        nextAction: next,
      });
    } catch {
      // A missing or unwritable project must not break the ledger.
    }
    void at;
  }
}
