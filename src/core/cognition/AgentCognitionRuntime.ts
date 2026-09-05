/**
 * ==========================================================
 * LÉLU
 * AGENT COGNITION RUNTIME — autonomy over the existing loop
 *
 * This is NOT a second cognition. The reasoning and the choice
 * of action are made by the existing native tool loop:
 * AIService.deliberate() enters the same ProviderResolver path
 * a chat turn uses, with the same capability surface, the same
 * ToolDispatcher, the same workflow bridge and the same provider
 * fallback. Nothing here decides anything itself; there is no
 * rule engine and no keyword matching.
 *
 * What this adds is the part that was genuinely missing: a
 * reason to run a cycle when no user just spoke. It owns
 *
 *   • objective lifecycle — active / waiting / completed / yielded
 *   • wake conditions from real AgentEventBus events
 *   • budgets and termination, so nothing runs away
 *   • duplicate-action and repeated-failure detection
 *   • an observable record of every cycle
 *
 * A cycle that reaches a limit YIELDS with the real reason. It is
 * never recorded as completion — an objective that ran out of
 * budget did not succeed, and the two must stay distinguishable.
 * ==========================================================
 */

import AIService from "../AIService";
import AgentStore from "../agents/AgentStore";
import AgentEventBus from "../agent/AgentEvents";
import AgentObjectives, {
  type AgentObjective,
  type CognitionCycleRecord,
  type ObjectiveState,
} from "./AgentObjectives";

/** What the agent concluded this cycle, parsed from its own decision. */
export interface CycleOutcome {
  cycleId: string;
  objectiveId: string;
  decision: string;
  executed: Array<{ tool: string; ok: boolean }>;
  nextState: ObjectiveState;
  yieldReason?: CognitionCycleRecord["yieldReason"];
}

/** Minimum gap between cycles for one objective — never a hot loop. */
const CYCLE_COOLDOWN_MS = 1_500;

export default class AgentCognitionRuntime {
  private static instance: AgentCognitionRuntime | null = null;

  private readonly objectives = AgentObjectives.getInstance();
  private readonly events = AgentEventBus.getInstance();

  /** Objectives with a cycle in flight, so a wake cannot double-run one. */
  private inFlight = new Set<string>();
  private lastCycleAt = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;
  private running = false;

  private constructor() {}

  public static getInstance(): AgentCognitionRuntime {
    if (!AgentCognitionRuntime.instance) {
      AgentCognitionRuntime.instance = new AgentCognitionRuntime();
    }
    return AgentCognitionRuntime.instance;
  }

  /* ------------------------------ wake ------------------------------ */

  /**
   * Follow real runtime events.
   *
   * The trigger is an actual event on the existing bus — a tool result,
   * a workflow finishing, an agent event — not a timer pretending
   * something happened. An idle agent with no active objective is woken
   * by nothing and costs nothing.
   */
  public start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.events.subscribe((event) => {
      if (event.type === "tool_result" || event.type === "task_completed") {
        void this.wake(`event:${event.type}`);
      }
    });
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }

  /**
   * Run one cycle for every objective that legitimately needs one.
   *
   * Returns the cycles actually run — an empty array means nothing
   * required action, which is a real outcome and not a failure.
   */
  public async wake(trigger: string): Promise<CycleOutcome[]> {
    const outcomes: CycleOutcome[] = [];
    for (const objective of this.objectives.actionable()) {
      const outcome = await this.runCycle(objective.id, trigger);
      if (outcome) outcomes.push(outcome);
    }
    return outcomes;
  }

  /* ------------------------------ the cycle ------------------------------ */

  /**
   * One observe → decide → execute → record → evaluate cycle.
   *
   * Returns null when the objective was not eligible: already running,
   * inside its cooldown, or no longer active. Those are not errors.
   */
  public async runCycle(objectiveId: string, trigger: string): Promise<CycleOutcome | null> {
    const objective = this.objectives.get(objectiveId);
    if (!objective || objective.state !== "active") return null;
    if (this.inFlight.has(objectiveId)) return null;

    const since = Date.now() - (this.lastCycleAt.get(objectiveId) ?? 0);
    if (since < CYCLE_COOLDOWN_MS) return null;

    /* ---- BUDGETS FIRST: never spend a model call to discover a limit ---- */
    const exhausted = this.objectives.exhausted(objective);
    if (exhausted) {
      this.objectives.yieldObjective(
        objectiveId,
        exhausted,
        `Stopped after ${objective.cyclesRun} cycle(s) and ${objective.actionsTaken} action(s): ${exhausted}. The objective was NOT completed.`,
      );
      const record = this.record(objective, trigger, {
        decision: `Yielded before reasoning: ${exhausted}.`,
        executed: [],
        nextState: "yielded",
        yieldReason: exhausted,
      });
      return record;
    }

    this.inFlight.add(objectiveId);
    this.lastCycleAt.set(objectiveId, Date.now());

    try {
      /* ---- OBSERVE: the objective's own history so far ---- */
      const history = this.objectives.cycles(objectiveId).slice(0, 5).reverse();
      const priorWork = history.length
        ? history
            .map(
              (entry, index) =>
                `${index + 1}. ${entry.decision.slice(0, 300)}` +
                (entry.executed.length
                  ? ` [ran: ${entry.executed.map((e) => `${e.tool}${e.ok ? "" : " FAILED"}`).join(", ")}]`
                  : " [no action taken]"),
            )
            .join("\n")
        : "(nothing yet — this is the first cycle)";

      const agent = AgentStore.getInstance().get(objective.agentId);

      /* ---- DECIDE: the EXISTING loop makes the choice ---- */
      const response = await AIService.getInstance().deliberate(
        [
          `OBJECTIVE: ${objective.objective}`,
          "",
          `WORK SO FAR (cycle ${objective.cyclesRun + 1} of at most ${objective.maxCycles}):`,
          priorWork,
          "",
          "Decide the single next action and take it now, using your tools if that is what is needed.",
          "When the objective is already satisfied by the work above, say DONE: followed by the conclusion and take no action.",
          "When you cannot proceed because a capability is unavailable or you need information from the user,",
          "say BLOCKED: followed by exactly what is missing, and take no action.",
        ].join("\n"),
        {
          system:
            (agent
              ? `You are ${agent.name}. ${agent.role}. ${agent.instructions}\n\n`
              : "") +
            "You are working autonomously toward an objective, without a user watching each step. " +
            "Take one concrete step per cycle. Do not repeat an action already taken above. " +
            "Never claim work you did not actually perform — your tool results are the record.",
        },
      );

      const decision = (response.text ?? "").trim();
      const executed =
        (response.metadata?.toolsExecuted as Array<{ tool: string; ok: boolean }> | undefined) ?? [];

      /* ---- EVALUATE from the real result, not from the text alone ---- */
      const anyFailed = executed.some((entry) => !entry.ok);
      const didSomething = executed.length > 0;

      // Duplicate protection: the same action twice in a row is not
      // progress, whatever the model says about it.
      const signature = executed.map((entry) => entry.tool).sort().join("|");
      const repeated = Boolean(signature) && objective.actionHistory.includes(signature);

      let nextState: ObjectiveState = "active";
      let yieldReason: CognitionCycleRecord["yieldReason"] | undefined;
      let conclusion = "";

      if (/^\s*DONE:/i.test(decision)) {
        nextState = "completed";
        conclusion = decision.replace(/^\s*DONE:\s*/i, "").trim();
      } else if (/^\s*BLOCKED:/i.test(decision)) {
        nextState = "yielded";
        // The model reporting a capability gap is a legitimate outcome,
        // and a different one from failing to execute.
        yieldReason = /information|ask|clarif/i.test(decision)
          ? "awaiting-information"
          : "capability-unavailable";
        conclusion = decision.replace(/^\s*BLOCKED:\s*/i, "").trim();
      } else if (repeated) {
        nextState = "yielded";
        yieldReason = "no-progress";
        conclusion = `Repeated the same action (${signature}) without progress.`;
      } else if (!didSomething && !decision) {
        nextState = "yielded";
        yieldReason = "no-progress";
        conclusion = "The cycle produced neither a decision nor an action.";
      }

      /* ---- RECORD: real counters, from what really happened ---- */
      const failures = anyFailed || !didSomething
        ? objective.consecutiveFailures + 1
        : 0;

      this.objectives.update(objectiveId, {
        cyclesRun: objective.cyclesRun + 1,
        actionsTaken: objective.actionsTaken + executed.length,
        consecutiveFailures: failures,
        actionHistory: signature
          ? [...objective.actionHistory, signature].slice(-10)
          : objective.actionHistory,
      });

      if (nextState === "completed") {
        this.objectives.complete(objectiveId, conclusion);
      } else if (nextState === "yielded" && yieldReason) {
        this.objectives.yieldObjective(objectiveId, yieldReason, conclusion);
      } else {
        // Still active — but re-check the budget now that this cycle spent
        // some of it, so the NEXT wake does not need a model call to stop.
        const after = this.objectives.get(objectiveId);
        const nowExhausted = after ? this.objectives.exhausted(after) : null;
        if (after && nowExhausted) {
          this.objectives.yieldObjective(
            objectiveId,
            nowExhausted,
            `Stopped after ${after.cyclesRun} cycle(s): ${nowExhausted}. The objective was NOT completed.`,
          );
          nextState = "yielded";
          yieldReason = nowExhausted;
        }
      }

      return this.record(
        this.objectives.get(objectiveId) ?? objective,
        trigger,
        { decision: decision || "(no decision text)", executed, nextState, yieldReason },
      );
    } finally {
      this.inFlight.delete(objectiveId);
    }
  }

  /** Persist and emit the cycle so it is inspectable, never inferred. */
  private record(
    objective: AgentObjective,
    trigger: string,
    outcome: Omit<CycleOutcome, "cycleId" | "objectiveId">,
  ): CycleOutcome {
    const cycleId = crypto.randomUUID();
    const record: CognitionCycleRecord = {
      cycleId,
      agentId: objective.agentId,
      objectiveId: objective.id,
      trigger,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      decision: outcome.decision,
      executed: outcome.executed,
      nextState: outcome.nextState,
      yieldReason: outcome.yieldReason,
    };
    this.objectives.recordCycle(record);

    // On the EXISTING event bus, so the timeline and cognition see it.
    this.events.emit({
      type: "tool_result",
      taskId: cycleId,
      tool: "cognition.cycle",
      result:
        `[${objective.agentId.slice(0, 8)}] ${outcome.nextState}` +
        (outcome.yieldReason ? ` (${outcome.yieldReason})` : "") +
        `: ${outcome.decision.slice(0, 200)}`,
      results: [],
      status: outcome.nextState === "yielded" ? "error" : "complete",
    });

    return { cycleId, objectiveId: objective.id, ...outcome };
  }
}
