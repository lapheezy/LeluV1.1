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

export type ObjectiveState =
  /** Live work: the agent may run cognition cycles for it. */
  | "active"
  /** Waiting on something specific; a matching event revives it. */
  | "waiting"
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
  /** State the objective moved to after this cycle. */
  nextState: ObjectiveState;
  /** Set when the cycle ended the objective. */
  yieldReason?: YieldReason;
}

export interface AgentObjective {
  id: string;
  agentId: string;
  /** What the agent is trying to achieve, in the requester's words. */
  objective: string;
  state: ObjectiveState;
  /** Who or what created it. */
  source: "user" | "cognition" | "agent";
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

  /** Why it stopped, when it has. */
  yieldReason?: YieldReason;
  /** The agent's own summary at completion. */
  conclusion?: string;
  /** What it is waiting for, when waiting. */
  waitingFor?: string;
}

const KEY = "lelu.agent.objectives.v1";
const CYCLES_KEY = "lelu.agent.cognition.cycles.v1";
const MAX_CYCLE_RECORDS = 200;

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

  /** Objectives an agent may legitimately run a cycle for right now. */
  public actionable(agentId?: string): AgentObjective[] {
    return this.list(agentId).filter((objective) => objective.state === "active");
  }

  public create(input: {
    agentId: string;
    objective: string;
    source?: AgentObjective["source"];
    maxCycles?: number;
    maxActions?: number;
    deadlineMs?: number;
  }): AgentObjective {
    const now = Date.now();
    const objective: AgentObjective = {
      id: crypto.randomUUID(),
      agentId: input.agentId,
      objective: input.objective,
      state: "active",
      source: input.source ?? "user",
      createdAt: now,
      updatedAt: now,
      cyclesRun: 0,
      maxCycles: input.maxCycles ?? DEFAULT_MAX_CYCLES,
      actionsTaken: 0,
      maxActions: input.maxActions ?? DEFAULT_MAX_ACTIONS,
      deadline: now + (input.deadlineMs ?? DEFAULT_DEADLINE_MS),
      consecutiveFailures: 0,
      actionHistory: [],
    };
    this.kv.set(KEY, [...this.list(), objective]);
    this.notify();
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
