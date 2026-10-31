/**
 * ==========================================================
 * LÉLU
 * AGENT OBJECTIVES — what an agent is currently working on
 *
 * The missing piece was not cognition. CognitiveLoop already
 * observes and proposes; AIService already decides and executes.
 * What did not exist was a reason for an agent to run a cycle
 * when nobody had just spoken to it — an objective it owns,
 * with a lifecycle that can end.
 *
 * This is state, not a second brain. It holds no reasoning: it
 * records what an agent is trying to do, what has happened so
 * far, and whether that work is still live. Persistence is the
 * existing KvStore, so an objective survives a reload and an
 * interrupted run is recoverable rather than lost.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { emitCognition } from "../agent/AgentEvents";
import { computePriority, clampPriority, type PriorityAdjustment } from "./Prioritization";

export type ObjectiveState =
  /** Live work: the agent may run cognition cycles for it. */
  | "active"
  /** Waiting on something specific; a matching event revives it. */
  | "waiting"
  /**
   * Deliberately deferred until a wall-clock time. Persisted, so a
   * restart resumes it rather than losing it — this is runtime state,
   * not a chat message saying "I'll come back to this".
   */
  | "scheduled"
  /**
   * Blocked on a person. The runtime will not act until approval is
   * granted or refused, and the decision is recorded.
   */
  | "awaiting-approval"
  /** The agent judged the objective satisfied. */
  | "completed"
  /** Stopped without completing, for a recorded reason. */
  | "yielded"
  /** Cancelled by a person or by the runtime. */
  | "cancelled";

/** Why an objective stopped. Never "done" unless it really was. */
export type YieldReason =
  | "cycle-budget-exhausted"
  | "action-budget-exhausted"
  | "deadline-reached"
  | "repeated-failure"
  | "no-progress"
  | "capability-unavailable"
  | "awaiting-information"
  | "cancelled";

/** One completed cognition cycle, as it actually ran. */
export interface CognitionCycleRecord {
  cycleId: string;
  agentId: string;
  objectiveId: string;
  /** What woke this cycle. */
  trigger: string;
  startedAt: number;
  finishedAt: number;
  /** The model's own account of its decision. */
  decision: string;
  /** Tools/workflows actually executed, from the real tool results. */
  executed: Array<{ tool: string; ok: boolean }>;
  /**
   * Tools the model ASKED for, which is a different fact from what ran.
   *
   * A request that never became an execution is the gap between a
   * claim and the record, and it is invisible if only executions are
   * kept.
   */
  requested?: string[];
  /** Which provider and model served the decision, for diagnosis. */
  provider?: string;
  model?: string;
  /** Why the model stopped generating, when the provider reports it. */
  finishReason?: string;
  /** What the completion check decided, when the model claimed DONE. */
  verification?: {
    verdict: "complete" | "incomplete" | "blocked";
    reason: string;
    observed: string[];
    missing: string[];
  };
  /** State the objective moved to after this cycle. */
  nextState: ObjectiveState;
  /** Set when the cycle ended the objective. */
  yieldReason?: YieldReason;
}

/**
 * WHAT AN OBJECTIVE MUST BE OBSERVED TO HAVE ACCOMPLISHED.
 *
 * The runtime used to accept the model writing "DONE:" as the whole of
 * the completion decision, so a three-operation objective could finish
 * after one of them. Checking that needs something objective-level to
 * check against — this is it, and it is deliberately the smallest
 * thing that works rather than a second goal model: an objective
 * carries a few outcomes, each naming the kind of evidence that
 * settles it.
 *
 * `evidence` says what counts, never who says so:
 *   tool-succeeded    a named tool really ran and really returned ok
 *   answer-given      the objective is answerable by reasoning, and the
 *                     conclusion itself is the evidence
 *   user-information  only the user can supply this, so no amount of
 *                     further work can satisfy it
 */
export interface ObjectiveOutcome {
  evidence: "tool-succeeded" | "answer-given" | "user-information";
  /** The tool that must have run and succeeded. Required for tool-succeeded. */
  tool?: string;
  /** What this outcome is, in words — used in briefings and questions. */
  what: string;
}

export interface AgentObjective {
  id: string;
  agentId: string;
  /** What the agent is trying to achieve, in the requester's words. */
  objective: string;
  state: ObjectiveState;
  /** Who or what created it. */
  source: "user" | "cognition" | "agent";
  /**
   * The project this objective advances, when it advances one.
   *
   * Carried so cognition can tell whether a project already has work in
   * flight before deriving more — without it, a 10-second loop would
   * queue the same project's next step on every tick — and so a question
   * raised mid-objective can name the project it belongs to.
   */
  projectId?: string;
  /**
   * The intrinsic importance this objective was created with.
   *
   * Recomputation always starts here, never from the last computed
   * value — see Prioritization.computePriority. Compounding would mean
   * an objective that lost the contest once sank forever.
   */
  basePriority: number;
  /** 1-100, recomputed from what is true now. Decides execution order. */
  priority: number;
  createdAt: number;
  updatedAt: number;

  /* ---- budgets: the loop must be able to stop ---- */
  cyclesRun: number;
  maxCycles: number;
  actionsTaken: number;
  maxActions: number;
  /** Absolute wall-clock deadline. */
  deadline: number;

  /** Consecutive cycles that executed nothing useful. */
  consecutiveFailures: number;
  /** Signatures of actions already taken, for duplicate protection. */
  actionHistory: string[];
  /**
   * What completion will be checked against, when it is known.
   *
   * Absent is normal and means "not declared": an objective nobody
   * stated requirements for is still verified, just on weaker
   * evidence — see CompletionVerifier. Declared outcomes always win
   * over anything inferred from the objective's wording.
   */
  expectedOutcomes?: ObjectiveOutcome[];
  /**
   * A correction the runtime owes the next cycle.
   *
   * When a cycle repeats an action that produced nothing new, stopping
   * immediately throws away work that may be one sentence from done.
   * The runtime says so instead, once, and only stops if the same
   * action comes back again. It is runtime state rather than a message
   * in a transcript, so it survives a restart with everything else.
   */
  nudge?: string;

  /** Why it stopped, when it has. */
  yieldReason?: YieldReason;
  /** The agent's own summary at completion. */
  conclusion?: string;
  /** What it is waiting for, when waiting. */
  waitingFor?: string;

  /** When a scheduled objective becomes actionable again. */
  resumeAt?: number;
  /** What approval is being requested, and the recorded decision. */
  approval?: {
    request: string;
    requestedAt: number;
    decidedAt?: number;
    granted?: boolean;
    decidedBy?: string;
  };
}

const KEY = "lelu.agent.objectives.v1";
const CYCLES_KEY = "lelu.agent.cognition.cycles.v1";
const MAX_CYCLE_RECORDS = 200;

/**
 * Where an objective starts when nobody said how important it is.
 *
 * Mid-scale on purpose: a default of 100 would make every objective
 * outrank anything deliberately scored, and a default of 1 would bury
 * them all under the first thing that was.
 */
export const DEFAULT_BASE_PRIORITY = 50;

/** Defaults chosen so a runaway loop is impossible by construction. */
export const DEFAULT_MAX_CYCLES = 8;
export const DEFAULT_MAX_ACTIONS = 12;
export const DEFAULT_DEADLINE_MS = 10 * 60 * 1000;
/** Consecutive unproductive cycles before the agent stops trying. */
export const FAILURE_LIMIT = 3;

type Listener = () => void;

export default class AgentObjectives {
  private static instance: AgentObjectives | null = null;

  private readonly kv = KvStore.getInstance();
  private listeners = new Set<Listener>();

  private constructor() {}

  public static getInstance(): AgentObjectives {
    if (!AgentObjectives.instance) {
      AgentObjectives.instance = new AgentObjectives();
    }
    return AgentObjectives.instance;
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

  /* ------------------------------ objectives ------------------------------ */

  public list(agentId?: string): AgentObjective[] {
    const all = this.kv.get<AgentObjective[]>(KEY) ?? [];
    return agentId ? all.filter((objective) => objective.agentId === agentId) : all;
  }

  public get(id: string): AgentObjective | undefined {
    return this.list().find((objective) => objective.id === id);
  }

  /**
   * Objectives an agent may legitimately run a cycle for right now.
   *
   * A scheduled objective whose time has come is promoted here, so a
   * deferral genuinely resumes on its own rather than needing someone
   * to notice. Awaiting-approval never becomes actionable by time.
   */
  public actionable(agentId?: string): AgentObjective[] {
    const now = Date.now();
    for (const objective of this.list(agentId)) {
      if (objective.state === "scheduled" && (objective.resumeAt ?? 0) <= now) {
        this.update(objective.id, { state: "active", resumeAt: undefined });
      }
    }
    // Priority follows from what is true NOW, so it is recomputed here
    // rather than frozen at creation — the same reason self-study
    // recomputes its own on every cycle.
    this.prioritize();
    return this.list(agentId)
      .filter((objective) => objective.state === "active")
      // Highest first, oldest first within a tie. Without the tiebreak
      // equal-priority work would reorder between calls, and nothing
      // would reliably be picked at all.
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
  }

  /**
   * Recompute every live objective's priority from current state.
   *
   * Shares Prioritization.computePriority with self-study: the attempts
   * penalty, the age nudge and the clamp are the same arithmetic, and
   * deliberately the same numbers. What differs is what counts as an
   * attempt — for executable work that is cycles already spent and
   * failures already taken, not a question's domain.
   */
  public prioritize(): void {
    const rescored = new Map<string, number>();
    for (const objective of this.list()) {
      if (
        objective.state !== "active" &&
        objective.state !== "scheduled" &&
        objective.state !== "waiting" &&
        objective.state !== "awaiting-approval"
      ) {
        // Finished work keeps the number it ended on. Recomputing it
        // would only move a value nothing reads, and completed work must
        // never be able to outrank live work.
        continue;
      }

      const adjustments: PriorityAdjustment[] = [];
      // What the user asked for outranks what cognition inferred.
      if (objective.source === "user") {
        adjustments.push({ reason: "the user asked for this", delta: 12 });
      }
      // Something outstanding from someone else: an approval, an answer.
      // Leaving these at full priority is exactly how a blocked
      // objective keeps winning the contest it cannot act on.
      if (objective.state === "awaiting-approval" || objective.state === "waiting") {
        adjustments.push({ reason: "waiting on someone else", delta: -25 });
      }
      // Deliberately deferred to a time that has not arrived.
      if (objective.state === "scheduled" && (objective.resumeAt ?? 0) > Date.now()) {
        adjustments.push({ reason: "scheduled for later", delta: -20 });
      }

      const next = computePriority({
        basePriority: objective.basePriority ?? DEFAULT_BASE_PRIORITY,
        adjustments,
        attempts: objective.cyclesRun + objective.consecutiveFailures,
        createdAt: objective.createdAt,
      });

      if (next !== objective.priority) {
        rescored.set(objective.id, next);
      }
    }

    if (rescored.size === 0) return;

    // ONE write, and NO notification.
    //
    // Both matter, and the second one is load-bearing. The store's
    // subscription is how AgentCognitionRuntime learns that work changed
    // state, and it answers by calling considerPending() → actionable()
    // → here. Writing through update() therefore notified from inside
    // the very read path the notification had triggered: with several
    // objectives in the store that cascade re-entered considerPending
    // once per rescored objective, and because scheduleContinuation()
    // clears and re-sets its timer each time, the next cycle was pushed
    // out again on every pass and never fired. Measured: an objective
    // revived by a user's answer sat active for 20 seconds without
    // running.
    //
    // A re-score is idempotent bookkeeping, not a state change, so there
    // is nothing for a subscriber to react to.
    this.kv.set(
      KEY,
      this.list().map((objective) =>
        rescored.has(objective.id)
          ? { ...objective, priority: rescored.get(objective.id)! }
          : objective,
      ),
    );
  }

  /**
   * Is this project already being worked on?
   *
   * "Already" means an objective that is going to run again by itself:
   * active, scheduled, waiting for an approval, or waiting on an answer.
   * A completed or yielded objective is finished and must not block the
   * project forever.
   *
   * This is what stops a 10-second cognitive tick from deriving the same
   * next step over and over.
   */
  public hasWorkInFlight(projectId: string): boolean {
    if (!projectId) return false;
    return this.list().some(
      (objective) =>
        objective.projectId === projectId &&
        (objective.state === "active" ||
          objective.state === "scheduled" ||
          objective.state === "awaiting-approval" ||
          objective.state === "waiting"),
    );
  }

  /** Defer an objective to a wall-clock time. Survives a restart. */
  public schedule(id: string, resumeAt: number, note = ""): AgentObjective | undefined {
    const updated = this.update(id, { state: "scheduled", resumeAt, conclusion: note });
    if (updated) {
      emitCognition("objective-scheduled", `Deferred until ${new Date(resumeAt).toISOString()}${note ? `: ${note}` : ""}`, {
        objectiveId: id,
        data: { resumeAt },
      });
    }
    return updated;
  }

  /** Park an objective on a person's decision. */
  public requestApproval(id: string, request: string): AgentObjective | undefined {
    const updated = this.update(id, {
      state: "awaiting-approval",
      approval: { request, requestedAt: Date.now() },
    });
    if (updated) {
      emitCognition("approval-required", request, { objectiveId: id });
    }
    return updated;
  }

  /**
   * Record a person's decision.
   *
   * Granting resumes the objective; refusing ends it as yielded, never
   * as completed — a refused objective did not achieve anything.
   */
  public decideApproval(id: string, granted: boolean, decidedBy: string): AgentObjective | undefined {
    const objective = this.get(id);
    if (!objective?.approval) return objective;
    const approval = { ...objective.approval, granted, decidedAt: Date.now(), decidedBy };
    emitCognition(
      "approval-decided",
      `${granted ? "Granted" : "Refused"} by ${decidedBy}: ${objective.approval.request}`,
      { objectiveId: id, data: { granted, decidedBy } },
    );
    return granted
      ? this.update(id, { state: "active", approval })
      : this.update(id, {
          state: "yielded",
          yieldReason: "cancelled",
          approval,
          conclusion: `Approval refused by ${decidedBy}. The objective was NOT completed.`,
        });
  }

  public create(input: {
    agentId: string;
    objective: string;
    source?: AgentObjective["source"];
    projectId?: string;
    /** Intrinsic importance. Defaults to the mid-scale when unstated. */
    basePriority?: number;
    maxCycles?: number;
    maxActions?: number;
    deadlineMs?: number;
    /** What completion will be checked against. See ObjectiveOutcome. */
    expectedOutcomes?: ObjectiveOutcome[];
  }): AgentObjective {
    const now = Date.now();
    const objective: AgentObjective = {
      id: crypto.randomUUID(),
      agentId: input.agentId,
      objective: input.objective,
      state: "active",
      source: input.source ?? "user",
      ...(input.projectId ? { projectId: input.projectId } : {}),
      basePriority: clampPriority(input.basePriority ?? DEFAULT_BASE_PRIORITY),
      priority: clampPriority(input.basePriority ?? DEFAULT_BASE_PRIORITY),
      createdAt: now,
      updatedAt: now,
      cyclesRun: 0,
      maxCycles: input.maxCycles ?? DEFAULT_MAX_CYCLES,
      actionsTaken: 0,
      maxActions: input.maxActions ?? DEFAULT_MAX_ACTIONS,
      deadline: now + (input.deadlineMs ?? DEFAULT_DEADLINE_MS),
      consecutiveFailures: 0,
      actionHistory: [],
      ...(input.expectedOutcomes?.length ? { expectedOutcomes: input.expectedOutcomes } : {}),
    };
    this.kv.set(KEY, [...this.list(), objective]);
    this.notify();
    // Emitted after the objective really exists in the store.
    emitCognition("objective-created", objective.objective, {
      objectiveId: objective.id,
      data: { agentId: objective.agentId, source: objective.source, maxCycles: objective.maxCycles },
    });
    return objective;
  }

  public update(id: string, patch: Partial<AgentObjective>): AgentObjective | undefined {
    let updated: AgentObjective | undefined;
    const next = this.list().map((objective) => {
      if (objective.id !== id) return objective;
      updated = { ...objective, ...patch, updatedAt: Date.now() };
      return updated;
    });
    if (updated) {
      this.kv.set(KEY, next);
      this.notify();
    }
    return updated;
  }

  /**
   * Has this objective run out of room?
   *
   * Returns the REAL reason, so a stop is never reported as a
   * completion — an objective that exhausted its budget did not
   * succeed, and the record must be able to say which happened.
   */
  public exhausted(objective: AgentObjective): YieldReason | null {
    if (objective.cyclesRun >= objective.maxCycles) return "cycle-budget-exhausted";
    if (objective.actionsTaken >= objective.maxActions) return "action-budget-exhausted";
    if (Date.now() > objective.deadline) return "deadline-reached";
    if (objective.consecutiveFailures >= FAILURE_LIMIT) return "repeated-failure";
    return null;
  }

  /** Stop an objective, recording why. */
  public yieldObjective(id: string, reason: YieldReason, note = ""): AgentObjective | undefined {
    return this.update(id, {
      state: reason === "cancelled" ? "cancelled" : "yielded",
      yieldReason: reason,
      conclusion: note,
    });
  }

  public complete(id: string, conclusion: string): AgentObjective | undefined {
    return this.update(id, { state: "completed", conclusion });
  }

  /** Park an objective until something specific happens. */
  public waitFor(id: string, waitingFor: string): AgentObjective | undefined {
    return this.update(id, { state: "waiting", waitingFor });
  }

  /** Bring a waiting objective back when its condition may have changed. */
  public revive(id: string): AgentObjective | undefined {
    const objective = this.get(id);
    if (!objective || objective.state !== "waiting") return objective;
    return this.update(id, { state: "active", waitingFor: undefined });
  }

  /* ------------------------------ cycle records ------------------------------ */

  public cycles(objectiveId?: string): CognitionCycleRecord[] {
    const all = this.kv.get<CognitionCycleRecord[]>(CYCLES_KEY) ?? [];
    return objectiveId ? all.filter((record) => record.objectiveId === objectiveId) : all;
  }

  public recordCycle(record: CognitionCycleRecord): void {
    const all = this.cycles();
    this.kv.set(CYCLES_KEY, [record, ...all].slice(0, MAX_CYCLE_RECORDS));
    this.notify();
  }
}
