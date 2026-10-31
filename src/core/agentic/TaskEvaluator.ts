/**
 * ==========================================================
 * LÉLU — TASK EVALUATOR
 *
 * Every finished task is judged on what really happened, and
 * the judgement goes where it changes later behaviour:
 *
 *   • LESSONS   through ObjectiveLearning, the existing lesson
 *               system (confidence from repeated evidence,
 *               durable write through long-term memory). Its
 *               guidanceFor() is injected into the next plan for
 *               similar work, so a failure here changes the next
 *               attempt.
 *   • GAPS      a step that failed because a capability does not
 *               exist or is unavailable is recorded as a gap —
 *               the input DailyReflection turns into improvement
 *               proposals.
 *   • RECORD    a bounded evaluation history for reflection.
 *
 * It reads step status and error text written by the executor;
 * it never asks a model whether the task went well.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { Task } from "../tasks/TaskEngine";
import type { AgentObjective, CognitionCycleRecord, YieldReason } from "../cognition/AgentObjectives";

export interface CapabilityGap {
  /** The missing or failing capability, e.g. a tool id or agent name. */
  capability: string;
  kind: "missing-tool" | "unavailable-tool" | "missing-agent" | "unexecutable-tool";
  evidence: string;
  taskId: string;
  at: number;
}

export interface TaskEvaluation {
  taskId: string;
  goal: string;
  status: Task["status"];
  at: number;
  stepsTotal: number;
  stepsCompleted: number;
  failures: Array<{ step: string; error: string }>;
  gaps: CapabilityGap[];
  lessonIds: string[];
}

const KEY = "lelu.task-evaluations.v1";
const MAX_RECORDS = 200;

const GAP_PATTERNS: Array<{ pattern: RegExp; kind: CapabilityGap["kind"] }> = [
  { pattern: /There is no tool named "([^"]+)"/i, kind: "missing-tool" },
  { pattern: /"([^"]+)" is not available in this runtime/i, kind: "unavailable-tool" },
  { pattern: /No runnable agent named "([^"]+)"/i, kind: "missing-agent" },
  { pattern: /"([^"]+)" has no executor/i, kind: "unexecutable-tool" },
];

export function gapsFromTask(task: Task): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  for (const step of task.steps) {
    if (step.status !== "failed" || !step.error) continue;
    for (const { pattern, kind } of GAP_PATTERNS) {
      const match = pattern.exec(step.error);
      if (match) {
        // Name what the plan asked for: the dispatcher's message quotes the
        // model-facing name (dots become underscores), not the registry id.
        const capability =
          step.action?.kind === "tool" && kind !== "missing-agent"
            ? step.action.tool
            : step.action?.kind === "agent"
              ? step.action.agent
              : match[1];
        gaps.push({ capability, kind, evidence: step.error.slice(0, 300), taskId: task.id, at: Date.now() });
        break;
      }
    }
  }
  return gaps;
}

export default class TaskEvaluator {
  private static instance: TaskEvaluator | null = null;

  public static getInstance(): TaskEvaluator {
    if (!TaskEvaluator.instance) TaskEvaluator.instance = new TaskEvaluator();
    return TaskEvaluator.instance;
  }

  public async evaluate(task: Task): Promise<TaskEvaluation | null> {
    if (!["completed", "failed", "cancelled"].includes(task.status)) return null;
    const actionable = task.steps.filter((step) => step.action);
    if (actionable.length === 0) return null;

    const gaps = gapsFromTask(task);
    const evaluation: TaskEvaluation = {
      taskId: task.id,
      goal: task.goal,
      status: task.status,
      at: Date.now(),
      stepsTotal: actionable.length,
      stepsCompleted: actionable.filter((step) => step.status === "completed").length,
      failures: actionable
        .filter((step) => step.status === "failed")
        .map((step) => ({ step: step.title, error: (step.error ?? "").slice(0, 300) })),
      gaps,
      lessonIds: [],
    };

    // A cancelled task says nothing about whether the approach works.
    if (task.status !== "cancelled") {
      try {
        const { default: ObjectiveLearning } = await import("../cognition/ObjectiveLearning");
        const { objective, cycles } = toObjective(task, gaps.length > 0);
        const lessons = await ObjectiveLearning.getInstance().extract(objective, cycles);
        evaluation.lessonIds = lessons.map((lesson) => lesson.id);
      } catch (error) {
        console.warn("[TaskEvaluator] lesson extraction failed (contained):", error);
      }
    }

    const records = this.history();
    records.unshift(evaluation);
    KvStore.getInstance().set(KEY, records.slice(0, MAX_RECORDS));
    return evaluation;
  }

  public history(): TaskEvaluation[] {
    return KvStore.getInstance().get<TaskEvaluation[]>(KEY) ?? [];
  }

  public since(at: number): TaskEvaluation[] {
    return this.history().filter((record) => record.at >= at);
  }
}

/**
 * Present a task in the shape ObjectiveLearning reads: one objective, one
 * "cycle" listing what actually executed. Agent and reasoning steps are
 * named so a lesson can say which of them worked.
 */
function toObjective(task: Task, capabilityGap: boolean): { objective: AgentObjective; cycles: CognitionCycleRecord[] } {
  const executed = task.steps
    .filter((step) => step.action && (step.status === "completed" || step.status === "failed"))
    .map((step) => ({
      tool:
        step.action!.kind === "tool"
          ? step.action!.tool
          : step.action!.kind === "agent"
            ? `agent:${step.action!.agent}`
            : "reasoning",
      ok: step.status === "completed",
    }));
  const completed = task.status === "completed";
  const yieldReason: YieldReason = capabilityGap ? "capability-unavailable" : "repeated-failure";
  const now = Date.now();
  const objective = {
    id: `task:${task.id}`,
    agentId: "lelu",
    objective: task.goal,
    state: completed ? "completed" : "yielded",
    source: "user",
    createdAt: task.createdAt,
    updatedAt: now,
    cyclesRun: 1,
    maxCycles: 1,
    actionsTaken: executed.length,
    maxActions: executed.length,
    deadline: now,
    consecutiveFailures: executed.filter((entry) => !entry.ok).length,
    actionHistory: executed.map((entry) => `${entry.tool}:${entry.ok ? "ok" : "failed"}`),
    ...(completed ? { conclusion: task.report } : { yieldReason, conclusion: task.error }),
  } as AgentObjective;
  const cycles = [
    {
      cycleId: `task:${task.id}`,
      agentId: "lelu",
      objectiveId: objective.id,
      trigger: task.origin ?? "task",
      startedAt: task.startedAt ?? task.createdAt,
      finishedAt: task.completedAt ?? now,
      decision: task.steps.map((step) => step.title).join(" → "),
      executed,
      nextState: objective.state,
      ...(completed ? {} : { yieldReason }),
    },
  ] as CognitionCycleRecord[];
  return { objective, cycles };
}
