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
import AgentEventBus, { emitCognition } from "../agent/AgentEvents";
import ObjectiveLearning from "./ObjectiveLearning";
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
/** How soon a brand-new objective gets its first cycle. */
const FIRST_CYCLE_DELAY_MS = 50;
/** setTimeout saturates past this; a longer deferral is re-armed on restart. */
const MAX_TIMER_MS = 2_147_483_000;

export default class AgentCognitionRuntime {
  private static instance: AgentCognitionRuntime | null = null;

  private readonly objectives = AgentObjectives.getInstance();
  private readonly events = AgentEventBus.getInstance();

  /** Objectives with a cycle in flight, so a wake cannot double-run one. */
  private inFlight = new Set<string>();
  private lastCycleAt = new Map<string, number>();
  /** Pending self-continuation timers, one per objective at most. */
  private continuations = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;
  private objectivesUnsubscribe: (() => void) | null = null;
  private running = false;
  private paused = false;

  /**
   * EPOCH — what makes stopping actually stop.
   *
   * Clearing a timer does not un-start the cycle already inside it, and
   * a cycle takes seconds: without this, a run that began before
   * shutdown would come back afterwards, write its result into a
   * runtime that no longer owns it, and schedule the next one. Every
   * cycle and every timer carries the epoch it was created in; a bump
   * makes all of them no-ops at their next checkpoint.
   */
  private epoch = 0;

  /** Objectives explicitly cancelled: their in-flight work is abandoned. */
  private cancelled = new Set<string>();

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

    // A NEW OBJECTIVE IS ITSELF A WAKE CONDITION.
    //
    // Without this, an objective created while nothing else was
    // happening would sit there until some unrelated event arrived —
    // autonomy that depends on someone else's activity is not
    // autonomy. This is the existing objective store's own
    // subscription; no new bus and no polling.
    this.objectivesUnsubscribe = this.objectives.subscribe(() => this.considerPending());

    // RESUME WHAT WAS ALREADY IN FLIGHT.
    //
    // Objectives persist, so a restart finds work mid-stream. An
    // unfinished objective is picked up again, and a scheduled one is
    // re-armed for the time it was deferred to.
    this.considerPending();
  }

  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.objectivesUnsubscribe?.();
    this.objectivesUnsubscribe = null;
    for (const handle of this.continuations.values()) clearTimeout(handle);
    this.continuations.clear();
    this.running = false;
    this.paused = false;
    // Anything already in flight belongs to the runtime that is ending.
    this.epoch += 1;
  }

  /**
   * PAUSE — keep everything, do nothing.
   *
   * The objectives, their budgets and their history are untouched; only
   * the scheduling stops. This is what a person asking LÉLU to hold on
   * needs, and it is different from stopping: resume() picks the same
   * work up rather than starting new work.
   */
  public pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    for (const handle of this.continuations.values()) clearTimeout(handle);
    this.continuations.clear();
    // A cycle already running finishes its call but will not record or
    // continue: it belongs to the epoch before the pause.
    this.epoch += 1;
    emitCognition("continuation-scheduled", "Paused: no further cycles until resumed.", {
      data: { paused: true },
    });
  }

  public resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.considerPending();
  }

  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * CANCEL one objective's work.
   *
   * Its timer goes, its in-flight cycle is abandoned rather than
   * recorded, and the objective itself is ended with the real reason —
   * cancelled work is never reported as completed.
   */
  public cancel(objectiveId: string, reason = "Cancelled."): void {
    this.cancelled.add(objectiveId);
    const handle = this.continuations.get(objectiveId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.continuations.delete(objectiveId);
    }
    const objective = this.objectives.get(objectiveId);
    if (objective && !["completed", "yielded", "cancelled"].includes(objective.state)) {
      this.objectives.yieldObjective(objectiveId, "cancelled", reason);
    }
  }

  /**
   * CLEANUP — drop every piece of transient runtime state.
   *
   * Persisted objectives, cycles and lessons are deliberately left
   * alone: this clears what belongs to a running process (timers,
   * in-flight marks, cooldowns, cancellations), which is exactly the
   * state that must not survive into whatever runs next.
   */
  public cleanup(): void {
    this.stop();
    this.inFlight.clear();
    this.lastCycleAt.clear();
    this.cancelled.clear();
  }

  /** Objectives this runtime currently holds a timer or a cycle for. */
  public activeObjectiveIds(): string[] {
    return [...new Set([...this.continuations.keys(), ...this.inFlight])];
  }

  /**
   * Objectives with a pending TIMER, as distinct from one mid-cycle.
   *
   * The two are different facts and stopping treats them differently: a
   * timer is dropped outright, while a cycle already inside a model call
   * runs to its end and then abandons its result. Reporting them
   * together made "stop left nothing scheduled" impossible to assert
   * without also asserting the network was idle.
   */
  public scheduledObjectiveIds(): string[] {
    return [...this.continuations.keys()];
  }

  /** Objectives with a cycle executing right now. */
  public inFlightObjectiveIds(): string[] {
    return [...this.inFlight];
  }

  /** Objectives it is currently working for one agent — ownership, observable. */
  public activeObjectiveIdsFor(agentId: string): string[] {
    return this.activeObjectiveIds().filter(
      (id) => this.objectives.get(id)?.agentId === agentId,
    );
  }

  /**
   * Give every objective that is owed a cycle a real timer.
   *
   * Called when the runtime starts and whenever the objective store
   * changes. It only ever ARMS work — an objective already running, or
   * already holding a timer, is left alone — so a store notification
   * during a cycle cannot multiply cycles.
   */
  private considerPending(): void {
    if (!this.running || this.paused) return;
    const now = Date.now();

    for (const objective of this.objectives.list()) {
      if (this.inFlight.has(objective.id)) continue;
      if (this.continuations.has(objective.id)) continue;

      if (objective.state === "active") {
        // A never-started objective gets its first cycle promptly; one
        // that has already run is between cycles and is handled by its
        // own continuation.
        if (objective.cyclesRun === 0) {
          this.scheduleContinuation(objective.id, FIRST_CYCLE_DELAY_MS, "runtime:objective-created");
        } else {
          emitCognition(
            "objective-resumed",
            `Picked up again at cycle ${objective.cyclesRun} of ${objective.maxCycles}.`,
            { objectiveId: objective.id, data: { cyclesRun: objective.cyclesRun } },
          );
          this.scheduleContinuation(objective.id, CYCLE_COOLDOWN_MS + 100, "runtime:resumed");
        }
        continue;
      }

      if (objective.state === "scheduled" && objective.resumeAt !== undefined) {
        // Wall-clock deferral is real state with a real timer, not a
        // promise in a sentence. A time already past resumes at once.
        this.scheduleContinuation(
          objective.id,
          Math.min(Math.max(objective.resumeAt - now, 0), MAX_TIMER_MS),
          "runtime:scheduled-resume",
        );
      }
    }
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

    if (this.cancelled.has(objectiveId)) return null;
    this.inFlight.add(objectiveId);
    this.lastCycleAt.set(objectiveId, Date.now());
    // The epoch this cycle belongs to. If the runtime is stopped,
    // paused or this objective is cancelled while the model call is in
    // flight, the result is no longer ours to record.
    const startedIn = this.epoch;
    emitCognition("cycle-started", `Cycle ${objective.cyclesRun + 1} — ${trigger}`, {
      objectiveId,
      data: { trigger, cycle: objective.cyclesRun + 1 },
    });

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

      // RETRIEVE PRIOR LEARNING BEFORE PLANNING.
      //
      // This is what separates learning from logging: lessons from
      // earlier, unrelated objectives are matched by topic and injected
      // before the model reasons, so a strategy that failed before is
      // not tried again by default.
      const priorLessons = ObjectiveLearning.getInstance().relevantTo(objective.objective);
      const guidance = ObjectiveLearning.getInstance().guidanceFor(objective.objective);

      emitCognition(
        "context-retrieved",
        `${history.length} prior cycle(s) and ${priorLessons.length} prior lesson(s) assembled for this decision.`,
        { objectiveId, data: { priorCycles: history.length, lessons: priorLessons.length } },
      );
      if (priorLessons.length > 0) {
        // Emitted only when learning was really found and really put in
        // front of the model — the trace must never imply retrieval
        // that did not reach the prompt.
        emitCognition(
          "lesson-retrieved",
          priorLessons.map((lesson) => `[${lesson.kind}] ${lesson.lesson}`).join(" | ").slice(0, 400),
          {
            objectiveId,
            data: {
              lessonIds: priorLessons.map((lesson) => lesson.id),
              topics: priorLessons.map((lesson) => lesson.topic),
            },
          },
        );
      }

      /* ---- DECIDE: the EXISTING loop makes the choice ---- */
      const response = await AIService.getInstance().deliberate(
        [
          `OBJECTIVE: ${objective.objective}`,
          "",
          `WORK SO FAR (cycle ${objective.cyclesRun + 1} of at most ${objective.maxCycles}):`,
          priorWork,
          "",
          ...(guidance ? [guidance, ""] : []),
          ...(objective.nudge ? [`RUNTIME CORRECTION: ${objective.nudge}`, ""] : []),
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

      // ABANDON RATHER THAN WRITE. A cycle takes seconds; teardown takes
      // none. Recording here would put a dead runtime's conclusion into
      // live state and schedule a continuation nobody owns.
      if (startedIn !== this.epoch || this.cancelled.has(objectiveId)) {
        emitCognition(
          "cycle-completed",
          "Abandoned: the runtime was stopped, paused or the objective cancelled while this cycle was in flight. Nothing was recorded.",
          { objectiveId, data: { abandoned: true } },
        );
        return null;
      }

      const decision = (response.text ?? "").trim();
      const executed =
        (response.metadata?.toolsExecuted as Array<{ tool: string; ok: boolean }> | undefined) ?? [];

      emitCognition("decision-made", decision.slice(0, 400) || "(no decision text)", {
        objectiveId,
        data: { provider: response.provider, model: response.model },
      });
      if (executed.length > 0) {
        emitCognition(
          "result-observed",
          executed.map((entry) => `${entry.tool}${entry.ok ? "" : " FAILED"}`).join(", "),
          { objectiveId, data: { executed } },
        );
      }

      /* ---- EVALUATE from the real result, not from the text alone ---- */
      const anyFailed = executed.some((entry) => !entry.ok);
      const didSomething = executed.length > 0;

      // Duplicate protection: the same action twice in a row is not
      // progress, whatever the model says about it.
      const signature = executed.map((entry) => entry.tool).sort().join("|");
      const repeats = signature
        ? objective.actionHistory.filter((entry) => entry === signature).length
        : 0;
      // ONE correction before stopping. A single repeat is often a
      // verification step away from a conclusion; a second is a loop.
      const repeated = repeats >= 2;
      const shouldNudge = repeats === 1;

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
      } else if (/^\s*SCHEDULE:/i.test(decision)) {
        // A deliberate deferral is runtime state, not a promise in text.
        const minutes = Number(decision.match(/in\s+(\d+)\s*min/i)?.[1] ?? 5);
        this.objectives.schedule(
          objectiveId,
          Date.now() + Math.max(1, minutes) * 60_000,
          decision.replace(/^\s*SCHEDULE:\s*/i, "").trim(),
        );
        nextState = "scheduled";
      } else if (/^\s*APPROVAL:/i.test(decision)) {
        this.objectives.requestApproval(
          objectiveId,
          decision.replace(/^\s*APPROVAL:\s*/i, "").trim(),
        );
        nextState = "awaiting-approval";
      } else if (repeated) {
        nextState = "yielded";
        yieldReason = "no-progress";
        conclusion = `Repeated the same action (${signature}) after being told it produced nothing new.`;
      } else if (!didSomething && !decision) {
        nextState = "yielded";
        yieldReason = "no-progress";
        conclusion = "The cycle produced neither a decision nor an action.";
      }

      // The branch the runtime actually took, with the reason it took it.
      emitCognition(
        "branch-selected",
        `${nextState}${yieldReason ? ` (${yieldReason})` : ""}${conclusion ? `: ${conclusion.slice(0, 200)}` : ""}`,
        { objectiveId, data: { nextState, yieldReason, repeated, executed: executed.length } },
      );

      /* ---- RECORD: real counters, from what really happened ---- */
      const failures = anyFailed || !didSomething
        ? objective.consecutiveFailures + 1
        : 0;

      this.objectives.update(objectiveId, {
        nudge:
          shouldNudge && nextState === "active"
            ? `You already ran ${signature} in an earlier cycle and it produced nothing new. ` +
              `Either conclude with DONE: and the answer, or take a genuinely different action.`
            : undefined,
        cyclesRun: objective.cyclesRun + 1,
        actionsTaken: objective.actionsTaken + executed.length,
        consecutiveFailures: failures,
        actionHistory: signature
          ? [...objective.actionHistory, signature].slice(-10)
          : objective.actionHistory,
      });

      if (nextState === "completed") {
        this.objectives.complete(objectiveId, conclusion);
      } else if (nextState === "scheduled" || nextState === "awaiting-approval") {
        // Already set above; the objective is parked in real state.
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

      const finalObjective = this.objectives.get(objectiveId) ?? objective;

      // RECORD FIRST, THEN LEARN.
      //
      // Learning reads the objective's cycle records, so the cycle that
      // just ran has to be in them. It was not: extraction ran before
      // the record was written, which meant an objective finished in a
      // single cycle taught nothing at all — the most informative cycle,
      // the one that ended the work, was the one being ignored.
      const outcome = this.record(finalObjective, trigger, {
        decision: decision || "(no decision text)",
        executed,
        nextState,
        yieldReason,
      });

      // EXTRACT LEARNING when the objective ends, from the real cycle
      // records. Contained: a memory failure must not corrupt the run,
      // and it is reported rather than assumed successful.
      if (finalObjective.state === "completed" || finalObjective.state === "yielded") {
        try {
          await ObjectiveLearning.getInstance().extract(
            finalObjective,
            this.objectives.cycles(objectiveId),
          );
        } catch (error) {
          console.warn(
            "[AgentCognitionRuntime] learning extraction failed (contained)",
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      emitCognition(
        "cycle-completed",
        `Cycle ${finalObjective.cyclesRun} ended with the objective ${finalObjective.state}.`,
        { objectiveId, data: { state: finalObjective.state, actions: executed.length } },
      );
      if (finalObjective.state === "completed") {
        emitCognition("objective-completed", finalObjective.conclusion ?? "", { objectiveId });
      } else if (finalObjective.state === "yielded") {
        emitCognition(
          "objective-yielded",
          `${finalObjective.yieldReason ?? "unknown"}: ${finalObjective.conclusion ?? ""}`,
          { objectiveId, data: { yieldReason: finalObjective.yieldReason } },
        );
      }

      // SELF-CONTINUATION: the runtime starts cycle N+1 itself.
      //
      // Nothing outside advances the loop. The objective is still
      // active, so the runtime schedules its own next cycle after the
      // cooldown — bounded by the same budgets, which are re-checked at
      // the top of every cycle, so this cannot run away.
      if (finalObjective.state === "active") {
        this.scheduleContinuation(objectiveId);
      }

      return outcome;
    } finally {
      this.inFlight.delete(objectiveId);
    }
  }

  /**
   * Queue this objective's next cycle, driven by the runtime.
   *
   * A single pending timer per objective, cleared on stop and replaced
   * rather than stacked, so continuation can never multiply.
   */
  private scheduleContinuation(
    objectiveId: string,
    delayMs: number = CYCLE_COOLDOWN_MS + 100,
    trigger = "runtime:self-continuation",
  ): void {
    if (!this.running || this.paused) return;
    if (this.cancelled.has(objectiveId)) return;
    const existing = this.continuations.get(objectiveId);
    if (existing !== undefined) clearTimeout(existing);
    const scheduledIn = this.epoch;

    emitCognition("continuation-scheduled", `Next cycle in ${delayMs}ms (${trigger}).`, {
      objectiveId,
      data: { delayMs, trigger },
    });

    const handle = setTimeout(() => {
      this.continuations.delete(objectiveId);
      // A timer that survived a stop, a pause or a cancel does nothing.
      // Clearing a handle is best-effort; this is the guarantee.
      if (scheduledIn !== this.epoch || !this.running || this.paused) return;
      if (this.cancelled.has(objectiveId)) return;
      // Promote anything whose deferral has come due, then run this one.
      this.objectives.actionable();
      void this.runCycle(objectiveId, trigger);
    }, delayMs);

    // Never hold the process open for a background cycle.
    (handle as unknown as { unref?: () => void }).unref?.();
    this.continuations.set(objectiveId, handle);
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
