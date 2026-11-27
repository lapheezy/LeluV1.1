/**
 * ==========================================================
 * LÉLU — CONTINUOUS COGNITIVE EVALUATION (WP18.1 + WP18.8)
 *
 * The ongoing lifecycle: observe what is true now, decide what it
 * means, question her own direction, and record what came of it.
 *
 * It is deliberately NOT a new timer, loop or brain:
 *
 *   · its scheduled reflection is driven by the EXISTING CognitiveLoop
 *     heartbeat, which already owns the interval and the user-turn
 *     deferral;
 *   · its event-driven evaluation is called by the existing chat turn
 *     (AIService → TurnBridge);
 *   · it makes ZERO model calls. Every judgement here is deterministic
 *     over state that other systems already recorded, so "continuous
 *     cognition" cannot become "continuous token spend".
 *
 * Every tick has a named purpose, a budget and a report:
 *
 *   purpose   what this reflection is for, by trigger
 *   budget    minimum gap, per-minute ceiling, bounded lists
 *   report    observations, challenges, a questioning decision, a
 *             continuation plan, initiative candidates, elapsed time
 *
 * The five behavioural modes (CONVERSATIONAL, COLLABORATIVE,
 * EXECUTIVE, REFLECTIVE, OBSERVATIONAL) are states of this one
 * cognition. They change how much she says, not who is thinking.
 * ==========================================================
 */

import AgentObjectives, { type AgentObjective } from "../cognition/AgentObjectives";
import WorkQueue, { type QueueItem } from "../cognition/WorkQueue";
import ProjectStore from "../projects/ProjectStore";
import ProactiveCore from "../proactive/ProactiveCore";
import CollaborationModel, { type CollaborationProfile } from "./CollaborationModel";
import QuestioningLedger, { decideQuestioning, type QuestioningDecision } from "./QuestioningPolicy";
import {
  interrogate,
  type SelfChallenge,
  type SelfInterrogationInput,
} from "./SelfInterrogation";
import { planContinuation, type ContinuationPlan } from "./ContinuationPlanner";
import {
  selectInitiatives,
  type InitiativeSeed,
} from "./ConversationalInitiative";
import NeuralMapBridge, { type NeuralEvent } from "./NeuralMapBridge";
import LearningLedger from "./LearningLedger";
import type { CognitiveMode } from "./types";
import { clamp01, shorten } from "./text";

export type EvaluationTrigger =
  | "scheduled"
  | "user-turn"
  | "assistant-turn"
  | "correction"
  | "manual";

const PURPOSE: Record<EvaluationTrigger, string> = {
  scheduled: "check live objectives for drift, missing information and unfinished work",
  "user-turn": "understand what is being asked and whether a clarification is worth it",
  "assistant-turn": "evaluate what the completed action produced and what follows from it",
  correction: "revise assumptions in light of a correction",
  manual: "a person asked for an evaluation of the current direction",
};

const MIN_GAP_MS = 12_000;
const MAX_PER_MINUTE = 6;
const RECENT_COMPLETION_MS = 15 * 60 * 1000;
const STALE_OBJECTIVE_MS = 30 * 60 * 1000;
const WAITING_TOO_LONG_MS = 45 * 60 * 1000;

const LIVE_STATES = new Set<AgentObjective["state"]>([
  "active",
  "waiting",
  "scheduled",
  "awaiting-approval",
]);

export interface ModeInput {
  liveObjectives: number;
  /** The queue has a NOW item, or an objective is actively running. */
  activeWork: boolean;
  /** The last action failed or was yielded. */
  failedAction: boolean;
  userTurnActive: boolean;
  wantsUninterruptedExecution: boolean;
  initiativeTolerance: number;
}

/**
 * Which behavioural state this cognition is in.
 *
 * Reflective when something failed (evaluate before doing more),
 * executive when authorized work is live, observational when the user
 * has asked not to be interrupted, collaborative when there are live
 * objectives, conversational otherwise.
 */
export function resolveCognitiveMode(input: ModeInput): CognitiveMode {
  if (input.failedAction) return "reflective";
  if (input.activeWork) return "executive";
  if (input.userTurnActive || input.wantsUninterruptedExecution || input.initiativeTolerance < 0.25) {
    return "observational";
  }
  if (input.liveObjectives > 0) return "collaborative";
  return "conversational";
}

export interface EvaluationReport {
  id: string;
  at: number;
  trigger: EvaluationTrigger;
  purpose: string;
  mode: CognitiveMode;
  /** Why this tick did not evaluate, when it did not. */
  skipped: string | null;
  elapsedMs: number;
  /** Always 0: this lifecycle makes no model calls. */
  modelCalls: 0;
  observations: string[];
  /**
   * The live objectives this evaluation could see. Identification is
   * not the same as an alarm: this says WHAT is incomplete right now,
   * whether or not anything about it is stale enough to raise.
   */
  liveWork: Array<{
    id: string;
    objective: string;
    state: string;
    stale: boolean;
    waitingFor?: string;
  }>;
  challenges: SelfChallenge[];
  questioning: QuestioningDecision | null;
  continuation: ContinuationPlan | null;
  initiatives: InitiativeSeed[];
  neuralEvents: NeuralEvent[];
  profile: CollaborationProfile;
}

export interface TickOptions {
  /** Supplied by the caller that already knows (CognitiveLoop). */
  userTurnActive?: boolean;
  now?: number;
}

export default class CognitiveEvaluation {
  private static instance: CognitiveEvaluation | null = null;

  private lastAt = 0;
  private timestamps: number[] = [];
  private counter = 0;
  private reports: EvaluationReport[] = [];

  public static getInstance(): CognitiveEvaluation {
    if (!CognitiveEvaluation.instance) {
      CognitiveEvaluation.instance = new CognitiveEvaluation();
    }
    return CognitiveEvaluation.instance;
  }

  public static resetForTests(): void {
    CognitiveEvaluation.instance = null;
  }

  /** The most recent evaluation, for the cognition panel or diagnostics. */
  public latest(): EvaluationReport | null {
    return this.reports[this.reports.length - 1] ?? null;
  }

  public history(limit = 10): EvaluationReport[] {
    return this.reports.slice(-limit);
  }

  /**
   * One bounded evaluation. This is the whole scheduler-facing API:
   * the existing heartbeat calls it, the chat turn calls it, and nothing
   * else starts a cycle.
   */
  public tick(trigger: EvaluationTrigger, options: TickOptions = {}): EvaluationReport {
    const started = performance.now();
    const at = options.now ?? Date.now();
    this.counter += 1;
    const profile = CollaborationModel.getInstance().profile();
    const objectives = AgentObjectives.getInstance().list();
    const live = objectives.filter((objective) => LIVE_STATES.has(objective.state));
    const queue = WorkQueue.getInstance().list().filter((item) => item.status === "open");
    const failedAction = live.some((objective) => objective.state === "awaiting-approval") ||
      objectives.some(
        (objective) =>
          objective.state === "yielded" &&
          objective.yieldReason !== "cancelled" &&
          at - objective.updatedAt < 24 * 60 * 60 * 1000,
      );

    const mode = resolveCognitiveMode({
      liveObjectives: live.length,
      activeWork: live.some((objective) => objective.state === "active") || queue.some((item) => item.category === "NOW"),
      failedAction,
      userTurnActive: options.userTurnActive ?? false,
      wantsUninterruptedExecution: profile.wantsUninterruptedExecution,
      initiativeTolerance: profile.initiativeTolerance,
    });

    const base: EvaluationReport = {
      id: `wp18-${at}-${this.counter}`,
      at,
      trigger,
      purpose: PURPOSE[trigger],
      mode,
      skipped: null,
      elapsedMs: 0,
      modelCalls: 0,
      observations: [],
      liveWork: live.map((objective) => ({
        id: objective.id,
        objective: objective.objective,
        state: objective.state,
        stale: at - objective.updatedAt > STALE_OBJECTIVE_MS,
        ...(objective.waitingFor ? { waitingFor: objective.waitingFor } : {}),
      })),
      challenges: [],
      questioning: null,
      continuation: null,
      initiatives: [],
      neuralEvents: [],
      profile,
    };

    const skipped = this.skipReason(trigger, at, options);
    if (skipped) {
      const report: EvaluationReport = { ...base, skipped, elapsedMs: Math.round(performance.now() - started) };
      this.remember(report);
      return report;
    }

    this.lastAt = at;
    this.timestamps = [...this.timestamps.filter((timestamp) => at - timestamp < 60_000), at];

    const neural = NeuralMapBridge.getInstance();
    const observations: string[] = [];
    const events: NeuralEvent[] = [];
    const seeds: InitiativeSeed[] = [];

    /* ---------------- OBJECTIVE CONTINUITY ---------------- */
    const focus = this.pickFocus(live);
    for (const objective of live) {
      const age = at - objective.updatedAt;
      if (objective.nudge) {
        observations.push(`Objective “${shorten(objective.objective, 100)}” is carrying a correction: ${objective.nudge}`);
      }
      if (objective.state === "active" && age > STALE_OBJECTIVE_MS) {
        const observation = `Objective “${shorten(objective.objective, 100)}” has been active for ${Math.round(age / 60_000)}m without an update.`;
        observations.push(observation);
        seeds.push({
          kind: "unfinished-objective",
          text: `${observation} It may need unblocking or dropping.`,
          strength: 0.6,
          grounding: [{ source: "objective:state", detail: `${objective.state}, ${objective.cyclesRun} cycle(s), last update ${Math.round(age / 60_000)}m ago` }],
          asksQuestion: false,
          key: `objective-stall:${objective.id}`,
        });
      }
      if (objective.state === "waiting" && objective.waitingFor && age > WAITING_TOO_LONG_MS) {
        const observation = `Objective “${shorten(objective.objective, 90)}” has been waiting on “${objective.waitingFor}” for ${Math.round(age / 60_000)}m.`;
        observations.push(observation);
      }
      if (objective.state === "scheduled" && objective.resumeAt && objective.resumeAt < at) {
        observations.push(`Objective “${shorten(objective.objective, 90)}” was scheduled to resume and has not.`);
      }
      events.push(
        neural.record({
          kind: "objective-evaluation",
          at,
          subject: objective.objective,
          detail: `${objective.state}; ${objective.cyclesRun} cycle(s); ${objective.actionsTaken} action(s)${
            objective.waitingFor ? `; waiting on ${objective.waitingFor}` : ""
          }`,
          refs: { objectiveId: objective.id },
          data: { state: objective.state, progress: objective.priority },
        }),
      );
    }

    if (focus) {
      seeds.push({
        kind: "unfinished-objective",
        text: `“${shorten(focus.objective, 120)}” is still ${focus.state}.`,
        strength: 0.45,
        grounding: [
          {
            source: "objective:live",
            detail: `${focus.state}; ${focus.cyclesRun} cycle(s); ${focus.actionsTaken} action(s)`,
          },
        ],
        key: `live:${focus.id}`,
      });
    }

    /* ---------------- SELF-QUESTIONING ---------------- */
    let challenges: SelfChallenge[] = [];
    if (focus) {
      const input = this.interrogationInputFor(focus, at);
      const result = interrogate(input);
      challenges = result.challenges;
      for (const challenge of challenges) {
        events.push(
          neural.record({
            kind: "self-questioning",
            at,
            subject: challenge.question,
            detail: `${challenge.kind} — ${challenge.correction}`,
            refs: { objectiveId: focus.id },
            data: { severity: challenge.severity },
          }),
        );
        if (challenge.severity >= 0.6) {
          seeds.push({
            kind: challenge.kind === "omission" ? "unfinished-objective" : "challenge",
            text: challenge.correction,
            strength: clamp01(challenge.severity),
            grounding: challenge.basis,
            asksQuestion: false,
            key: challenge.fingerprint,
          });
        }
      }
    }

    /* ---------------- QUESTIONING ---------------- */
    let questioning: QuestioningDecision | null = null;
    const waiting = live.find(
      (objective) =>
        objective.state === "waiting" &&
        objective.waitingFor &&
        at - objective.updatedAt > WAITING_TOO_LONG_MS,
    );
    const pending = ProactiveCore.getInstance().listQuestions().filter((question) => question.status === "pending");
    if (waiting?.waitingFor && !pending.some((question) => question.objectiveId === waiting.id)) {
      const ledger = QuestioningLedger.getInstance();
      const questionText = /\?$/.test(waiting.waitingFor)
        ? waiting.waitingFor
        : `Can you provide ${waiting.waitingFor}?`;
      questioning = decideQuestioning({
        objective: waiting.objective,
        ambiguity: 0.55,
        ambiguitySignals: ["the objective is blocked on something only the user can supply"],
        missing: [{ what: waiting.waitingFor, materiality: 0.8, known: 0.2, discoverable: false }],
        decisionImportance: 0.65,
        urgency: 0.25,
        priorQuestions: ledger.historyFor(0.64, 24).map((record) => ({
          key: record.key,
          askedAt: record.at,
          answered: record.outcome === "answered",
          ignored: record.outcome === "ignored",
        })),
        corrections: 0,
        questionTolerance: profile.questionTolerance,
        wantsUninterruptedExecution: profile.wantsUninterruptedExecution,
        proposedQuestion: questionText,
        expectedAction: "continue without it",
        learnedAdjustment: ledger.toleranceAdjustmentFor(0.64),
        now: at,
      });
      if (questioning.action === "ask") {
        events.push(
          neural.record({
            kind: "clarification",
            at,
            subject: questioning.question ?? waiting.objective,
            detail: `Would ask: ${questioning.question}`,
            refs: { objectiveId: waiting.id },
            data: { impact: questioning.expectedImpact, cost: questioning.interruptionCost },
          }),
        );
      }
    }

    /* ---------------- POST-ACTION CONTINUATION ---------------- */
    const continuation = this.buildContinuation(at, objectives, live, queue, profile);

    /* ---------------- DEVELOPMENT GAPS ---------------- */
    // Every tenth evaluation, offer the strongest measured collaboration
    // gap to the EXISTING improvement queue. It is bounded (one, and
    // `hasOpenSimilar` prevents duplicates), so Agent Forge/self-
    // improvement receive evidence rather than a stream of requests.
    if (this.counter % 10 === 0) {
      try {
        for (const gap of LearningLedger.getInstance().fileCapabilityGaps(1)) {
          observations.push(`Development gap filed for review: ${gap.title}`);
          events.push(
            neural.record({
              kind: "learning",
              at,
              subject: gap.title,
              detail: `${gap.detail} Evidence: ${gap.evidence}`,
              refs: {},
              data: { owner: gap.owner, severity: gap.severity },
            }),
          );
        }
      } catch {
        // Filing is best-effort; a full queue must not stop cognition.
      }
    }

    /* ---------------- INITIATIVE ---------------- */
    const recentInitiative = neural
      .recent(20)
      .filter((event) => event.kind === "conversational-initiative")
      .map((event) => event.id);
    const selection = selectInitiatives(seeds, {
      mode,
      profile,
      topic: focus?.objective ?? "",
      recentKeys: recentInitiative,
    });
    for (const contribution of selection.contributions) {
      events.push(
        neural.record({
          kind: "conversational-initiative",
          at,
          subject: contribution.text,
          detail: `${contribution.kind}: ${contribution.text}`,
          visibility: "internal",
          refs: { initiativeKind: contribution.kind },
          data: { strength: contribution.strength },
        }),
      );
    }

    const report: EvaluationReport = {
      ...base,
      observations,
      challenges,
      questioning,
      continuation,
      initiatives: selection.contributions,
      neuralEvents: events,
      elapsedMs: Math.round(performance.now() - started),
    };
    this.remember(report);
    return report;
  }

  private skipReason(trigger: EvaluationTrigger, at: number, options: TickOptions): string | null {
    if (options.userTurnActive && trigger !== "user-turn") {
      return "the user is mid-turn; autonomous reflection stands down";
    }
    if (trigger === "scheduled" && this.lastAt > 0 && at - this.lastAt < MIN_GAP_MS) {
      return `reflection ran ${Math.round((at - this.lastAt) / 1000)}s ago; nothing has changed`;
    }
    const inWindow = this.timestamps.filter((timestamp) => at - timestamp < 60_000).length;
    if (inWindow >= MAX_PER_MINUTE) {
      return `the evaluation budget of ${MAX_PER_MINUTE}/minute is spent`;
    }
    return null;
  }

  private pickFocus(live: AgentObjective[]): AgentObjective | null {
    return [...live].sort((a, b) => b.priority - a.priority)[0] ?? null;
  }

  /**
   * Builds the interrogation from records, not from prompts. Every
   * assumption and piece of evidence below came from the objective's
   * own stored state.
   */
  private interrogationInputFor(
    objective: AgentObjective,
    at: number,
  ): SelfInterrogationInput {
    const cycles = AgentObjectives.getInstance().cycles(objective.id);
    const lastCycle = cycles[cycles.length - 1];
    const executed = cycles.flatMap((cycle) => cycle.executed);
    const expected = objective.expectedOutcomes ?? [];
    const requirements = expected.map((outcome) => ({
      text: outcome.what,
      addressed: executed.some((action) => action.ok && (!outcome.tool || action.tool === outcome.tool)),
    }));
    const assumptions = [];
    if (at - objective.createdAt > 2 * 60 * 60 * 1000) {
      assumptions.push({
        text: `“${shorten(objective.objective, 90)}” is still what Heru wants`,
        verified: false,
        evidence: "no recent confirmation; the objective has been carried since " + new Date(objective.createdAt).toISOString().slice(0, 10),
      });
    }
    const evidence: SelfInterrogationInput["evidence"] = [];
    for (const action of executed.slice(-4)) {
      evidence.push({
        claim: `tool ${action.tool}`,
        stance: action.ok ? "supports" : "contradicts",
        source: "objective:cycle",
        detail: action.ok ? `${action.tool} succeeded` : `${action.tool} failed`,
      });
    }
    if (objective.nudge) {
      evidence.push({
        claim: "the approach is producing new progress",
        stance: "contradicts",
        source: "objective:nudge",
        detail: objective.nudge,
      });
    }
    if (objective.yieldReason) {
      evidence.push({
        claim: "the objective can continue",
        stance: "contradicts",
        source: "objective:yield",
        detail: `yielded: ${objective.yieldReason}`,
      });
    }
    const nextQueued = WorkQueue.getInstance()
      .list()
      .some((item) => item.status === "open" && objective.projectId && item.detail?.includes(objective.projectId));
    return {
      objective: objective.objective,
      conclusion: `“${shorten(objective.objective, 90)}” is being pursued as planned (${objective.state}, ${objective.cyclesRun} cycle(s)).`,
      approach: lastCycle?.requested ?? lastCycle?.executed.map((action) => action.tool) ?? [],
      assumptions,
      evidence,
      requirements,
      recentActions: lastCycle?.executed ?? [],
      userCorrections: [],
      objectiveAgeMs: at - objective.createdAt,
      objectiveStillRelevant: null,
      nextStepDefined: Boolean(nextQueued) || objective.state !== "active" || objective.cyclesRun > 0,
      existingCapabilityFor: [],
      dedupe: NeuralMapBridge.getInstance()
        .recent(40)
        .filter((event) => event.kind === "self-questioning" && event.refs.objectiveId === objective.id)
        .map((event) => event.id),
      now: at,
    };
  }

  private buildContinuation(
    at: number,
    objectives: AgentObjective[],
    live: AgentObjective[],
    queue: QueueItem[],
    profile: CollaborationProfile,
  ): ContinuationPlan {
    const finished = objectives.filter(
      (objective) => objective.state === "completed" && at - objective.updatedAt < RECENT_COMPLETION_MS,
    );
    const projects = ProjectStore.getInstance().list().filter((project) => project.status === "active");
    const pendingQuestions = ProactiveCore.getInstance()
      .listQuestions()
      .filter((question) => question.status === "pending");

    return planContinuation({
      completed: finished.map((objective) => ({
        what: shorten(objective.objective, 140),
        evidence: "objective:completed",
        at: objective.updatedAt,
      })),
      revealed: finished
        .filter((objective) => objective.conclusion?.trim())
        .map((objective) => ({
          finding: objective.conclusion!.trim(),
          evidence: "objective:conclusion",
          subject: shorten(objective.objective, 120),
        })),
      affectedObjectives: live
        .filter((objective) => !finished.some((done) => done.id === objective.id))
        .slice(0, 2)
        .map((objective) => ({
          id: objective.id,
          objective: objective.objective,
          state: objective.state,
          evidence: "objective:live",
        })),
      unresolved: [
        ...objectives
          .filter(
            (objective) =>
              objective.state === "yielded" &&
              objective.yieldReason !== "cancelled" &&
              at - objective.updatedAt < 24 * 60 * 60 * 1000,
          )
          .slice(0, 1)
          .map((objective) => ({
            what: shorten(objective.objective, 120),
            evidence: `objective:yielded:${objective.yieldReason ?? "unknown"}`,
          })),
        ...live
          .filter((objective) => objective.waitingFor)
          .slice(0, 1)
          .map((objective) => ({
            what: `${shorten(objective.objective, 100)} is waiting on ${objective.waitingFor}`,
            evidence: "objective:waiting",
          })),
        ...pendingQuestions.slice(0, 1).map((question) => ({
          what: question.question,
          evidence: "proactive:question",
        })),
      ],
      nextSteps: [
        ...projects
          .filter((project) => project.checkpoint?.nextAction?.trim())
          .slice(0, 2)
          .map((project) => ({ action: project.checkpoint!.nextAction!.trim(), source: "project:checkpoint" })),
        ...queue
          .filter((item) => item.category === "NEXT")
          .slice(0, 2)
          .map((item) => ({ action: item.title, source: "queue:NEXT" })),
      ],
      opportunities: queue
        .filter((item) => item.category === "IDEAS")
        .slice(0, 2)
        .map((item) => ({ what: item.title, evidence: "queue:IDEAS", strength: 0.65 })),
      userTolerance: profile.initiativeTolerance,
      interruptedRecently: false,
      now: at,
    });
  }

  private remember(report: EvaluationReport): void {
    this.reports = [...this.reports, report].slice(-25);
  }
}
