/**
 * ==========================================================
 * LÉLU — TURN BRIDGE (WP18 integration)
 *
 * The one place the conversational cognition meets an actual chat
 * turn. AIService calls `prepareTurn` before generation and
 * `completeTurn` after it; nothing here replaces the chat pipeline,
 * the memory path or the router.
 *
 * BEFORE GENERATION the bridge assembles internal notes that are added
 * to the model's context:
 *
 *   · how this user prefers to collaborate (evidence-weighted)
 *   · what the thread already contains, if it moved surfaces
 *   · the self-challenges to her intended direction
 *   · a scope judgement, when the request names a shape
 *   · whether a clarification is worth asking, and what it is
 *   · grounded observations worth raising, at most one
 *
 * AFTER GENERATION it measures the plan that was actually produced,
 * decides whether anything specific follows from the completed work,
 * records the outcome for learning, and tags the thread with the
 * decision so the next surface can continue it.
 *
 * Honesty rules enforced here:
 *   · a question is only counted as asked when the reply really
 *     contains one;
 *   · a continuation is only appended when it names something with
 *     evidence behind it;
 *   · nothing is appended to a reply when the user asked for
 *     uninterrupted execution;
 *   · the continuation is rate-limited per conversation, and only one
 *     is ever pending.
 * ==========================================================
 */

import AgentObjectives from "../cognition/AgentObjectives";
import WorkQueue from "../cognition/WorkQueue";
import ProjectStore from "../projects/ProjectStore";
import ProactiveCore from "../proactive/ProactiveCore";
import MultiChatStore from "../multichat/MultiChatStore";
import SelfModel from "../cognition/SelfModel";
import KvStore from "../storage/KvStore";
import CollaborationModel, { type CollaborationProfile } from "./CollaborationModel";
import QuestioningLedger, {
  decideQuestioning,
  deriveAmbiguity,
  hasSuccessCriterion,
  type MissingInformation,
  type QuestioningDecision,
} from "./QuestioningPolicy";
import { interrogate, type SelfChallenge } from "./SelfInterrogation";
import {
  assessScope,
  deriveAmbition,
  describeScope,
  extractDependencies,
  extractRequirements,
  type ScopeAssessment,
} from "./ScopeIntelligence";
import { planContinuation, type ContinuationPlan } from "./ContinuationPlanner";
import {
  findContradiction,
  selectInitiatives,
  type InitiativeSeed,
} from "./ConversationalInitiative";
import LearningLedger from "./LearningLedger";
import NeuralMapBridge from "./NeuralMapBridge";
import SurfaceContinuity from "./SurfaceContinuity";
import CognitiveEvaluation, { resolveCognitiveMode } from "./CognitiveEvaluation";
import type { CognitiveMode, Surface } from "./types";
import { clamp01, fingerprint, firstSentence, shorten, similarity } from "./text";

export interface TurnPlan {
  goal?: string;
  steps?: Array<{ title?: string; description?: string; tool?: string }>;
}

export interface TurnPreparationInput {
  message: string;
  conversationId?: string;
  surface?: Surface;
  at?: number;
}

export interface TurnPreparation {
  /** Internal context to append to the model request. Empty when quiet. */
  context: string;
  mode: CognitiveMode;
  profile: CollaborationProfile;
  questioning: QuestioningDecision | null;
  scope: ScopeAssessment | null;
  challenges: SelfChallenge[];
  initiatives: InitiativeSeed[];
  continuity: string | null;
}

export interface TurnCompletionInput {
  message: string;
  reply: string;
  conversationId?: string;
  surface?: Surface;
  plan?: TurnPlan;
  at?: number;
}

export interface TurnCompletion {
  /** A specific, evidence-backed sentence to append to the reply, or null. */
  continuation: string | null;
  plan: ContinuationPlan;
  mode: CognitiveMode;
  scope: ScopeAssessment | null;
}

interface PendingQuestion {
  key: string;
  question: string;
  objective: string;
  at: number;
  conversationId?: string;
}

interface PendingContinuation {
  text: string;
  at: number;
  conversationId?: string;
}

interface BridgeState {
  version: 1;
  lastReply: string;
  lastReplyAt: number;
  lastConversationId?: string;
  lastPlan: string[];
  pendingQuestion?: PendingQuestion;
  pendingContinuation?: PendingContinuation;
  pendingScopeNote?: { text: string; at: number; conversationId?: string };
  lastContinuationAt: number;
  turnsSinceContinuation: number;
  recentInitiativeKeys: Array<{ key: string; at: number }>;
}

const KEY = "lelu.wp18.turn.v1";
const MAX_RECENT_INITIATIVES = 24;
/** Turns that must pass before another continuation is appended. */
const CONTINUATION_TURN_GAP = 3;
/** Wall-clock floor between continuations in one conversation. */
const CONTINUATION_GAP_MS = 10 * 60 * 1000;

function defaultState(): BridgeState {
  return {
    version: 1,
    lastReply: "",
    lastReplyAt: 0,
    lastPlan: [],
    lastContinuationAt: 0,
    // Start eligible: a first completed task should be allowed to say
    // what followed from it.
    turnsSinceContinuation: CONTINUATION_TURN_GAP,
    recentInitiativeKeys: [],
  };
}

export default class TurnBridge {
  private static instance: TurnBridge | null = null;

  private readonly kv = KvStore.getInstance();
  private state: BridgeState;

  private constructor() {
    const stored = this.kv.get<Partial<BridgeState>>(KEY);
    this.state = stored?.version === 1 ? { ...defaultState(), ...stored } : defaultState();
  }

  public static getInstance(): TurnBridge {
    if (!TurnBridge.instance) {
      TurnBridge.instance = new TurnBridge();
    }
    return TurnBridge.instance;
  }

  public static resetForTests(): void {
    TurnBridge.instance = null;
  }

  private persist(): void {
    try {
      this.kv.set(KEY, this.state);
    } catch {
      // best-effort
    }
  }

  /* ------------------------------------------------------------------ *
   * BEFORE THE TURN
   * ------------------------------------------------------------------ */

  public prepareTurn(input: TurnPreparationInput): TurnPreparation {
    const at = input.at ?? Date.now();
    const message = (input.message ?? "").trim();
    const surface = input.surface ?? "chat";
    const conversationId = input.conversationId;
    const collaboration = CollaborationModel.getInstance();
    const ledger = QuestioningLedger.getInstance();
    const learning = LearningLedger.getInstance();
    const neural = NeuralMapBridge.getInstance();

    const correction = /^(no\b|nope|that'?s (wrong|not)|actually|i meant|not what i|you missed|that is not)/i.test(message);
    let profile: CollaborationProfile;
    if (correction) {
      collaboration.observe(message, { conversationId, at });
      collaboration.recordCorrection(message, { conversationId, at });
      // Re-read AFTER recording: a correction is evidence about how to
      // collaborate, and the profile returned to this turn must contain
      // it rather than the state from before it.
      profile = collaboration.profile(conversationId, at);
      const repeated = learning.recordCorrection(message, { conversationId, at }).repeated;
      neural.record({
        kind: "learning",
        at,
        subject: "user correction",
        detail: `Correction received${repeated ? " (repeated topic)" : ""}: ${shorten(message, 160)}`,
        refs: { conversationId, surface },
        data: { repeated },
      });
    } else {
      profile = collaboration.observe(message, { conversationId, at });
    }

    // Settle the previous question before interpreting this message.
    this.settlePendingQuestion(message, profile, at);

    // Moving between surfaces must carry the thread, not restart it.
    let continuity: string | null = null;
    if (conversationId) {
      SurfaceContinuity.getInstance().touch(surface, conversationId, { topic: message, at });
      const briefing = SurfaceContinuity.getInstance().briefingFor(surface, conversationId, at);
      continuity = briefing?.text ?? null;
      const open = AgentObjectives.getInstance()
        .list()
        .filter((objective) => ["active", "waiting", "scheduled", "awaiting-approval"].includes(objective.state))
        .map((objective) => objective.id);
      if (open.length > 0) SurfaceContinuity.getInstance().setOpenObjectives(conversationId, open, at);
    }

    /* ---------------- QUESTIONING ---------------- */
    const ambiguity = deriveAmbiguity(message);
    const missing: MissingInformation[] = [];
    let proposedQuestion: string | undefined;

    const refersBack = /^(do|fix|change|update|rotate|move|delete|remove|open|close|rename|resize|adjust)\s+(it|that|this)\b/i.test(message);
    if (refersBack) {
      missing.push({ what: "what “it” refers to", materiality: 0.85, known: 0.1, discoverable: false });
      proposedQuestion = "Which item does “it” refer to?";
    }

    const buildish = /\b(build|implement|add|create|fix|change|refactor|design|make|update|remove|delete|rewrite|migrate|set up)\b/i.test(message);
    if (buildish && !hasSuccessCriterion(message)) {
      missing.push({ what: "what done looks like", materiality: 0.55, known: 0.3, discoverable: false });
      proposedQuestion ??= `What would count as done for ${shorten(firstSentence(message), 60)}?`;
    }

    const urgency = /\b(urgent|asap|right now|today|immediately|deadline)\b/i.test(message) ? 0.7 : 0.15;
    // What this question is worth before asking it, so the learning is
    // read from questions of the same kind rather than a pooled rate.
    const anticipatedImpact = (() => {
      const values = missing.map((gap) =>
        clamp01(gap.materiality) * (1 - clamp01(gap.known)) * (gap.discoverable ? 0.35 : 1),
      );
      const best = Math.max(0, ...values);
      return best > 0 ? clamp01(best) : clamp01(ambiguity.score * (buildish ? 0.7 : 0.4) * 0.6);
    })();
    const anticipatedKey = fingerprint(
      "questioning",
      message,
      proposedQuestion ?? "",
      missing[0]?.what ?? "",
    );
    const openKeys = ledger.openQuestionKeys();
    const decision = decideQuestioning({
      objective: message,
      ambiguity: ambiguity.score,
      ambiguitySignals: ambiguity.signals,
      missing,
      decisionImportance: buildish ? 0.7 : 0.4,
      userInstructions: {
        noQuestions: /\b(no questions|don'?t ask|stop asking|without asking)\b/i.test(message),
        askFreely: /\b(ask me|check with me|tell me if|let me know if you need)\b/i.test(message),
        executeNow: /\b(just do it|go ahead|execute)\b/i.test(message),
      },
      urgency,
      priorQuestions: ledger.historyFor(anticipatedImpact, 24).map((record) => ({
        key: record.key,
        askedAt: record.at,
        answered: record.outcome === "answered",
        ignored: record.outcome === "ignored",
      })),
      repeatedQuestionKeys: openKeys.includes(anticipatedKey) ? [anticipatedKey] : [],
      corrections: correction ? 1 : 0,
      questionTolerance: profile.questionTolerance,
      wantsUninterruptedExecution: profile.wantsUninterruptedExecution,
      proposedQuestion,
      expectedAction: buildish ? "the most direct reading of the request" : "continue the current thread",
      learnedAdjustment: ledger.toleranceAdjustmentFor(anticipatedImpact),
      now: at,
    });

    if (decision.action === "ask" && decision.question) {
      neural.record({
        kind: "clarification",
        at,
        subject: decision.question,
        detail: `Would ask before acting: ${decision.question}`,
        refs: { conversationId, surface, questionId: decision.key },
        data: { impact: decision.expectedImpact, cost: decision.interruptionCost },
      });
    }

    /* ---------------- SCOPE ---------------- */
    const requirements = extractRequirements(message);
    const modules = [
      ...message.matchAll(
        /\b(?:new|another|separate)\s+(?:[\w-]+\s+){0,2}(?:engine|manager|registry|system|agent|store|pipeline|service|framework)\b/gi,
      ),
    ].map((match) => match[0]);
    const scope = buildish
      ? assessScope({
          objective: message,
          requirements,
          existingCapabilities: SelfModel.getInstance().get().capabilities,
          proposedNewModules: modules,
          dependencies: extractDependencies(message),
          urgency,
          signaledSimplicity: /\b(simple|simplest|minimal|just|small|quick)\b/i.test(message),
          ambition: deriveAmbition(message),
          now: at,
        })
      : null;

    if (scope && scope.recommendation !== "HOLD" && scope.confidence >= 0.4) {
      neural.record({
        kind: "scope-adjustment",
        at,
        subject: scope.headline,
        detail: `${scope.recommendation}: ${scope.headline}`,
        refs: { conversationId, surface },
        data: { confidence: scope.confidence, incidental: scope.incidentalComplexity.length },
      });
    }

    /* ---------------- SELF-INTERROGATION ---------------- */
    const corrections = learning
      .events(at - 24 * 60 * 60 * 1000)
      .filter((event) => event.type === "correction" || event.type === "correction-repeated")
      .map((event) => event.detail ?? "")
      .filter(Boolean)
      .slice(-2);
    const scopeEvidence = [
      ...(scope?.incidentalComplexity ?? []).map((item) => ({
        claim: "this needs new machinery",
        stance: "contradicts" as const,
        source: "scope:incidental",
        detail: `${item.what}: ${item.reason}`,
      })),
      ...(scope?.necessaryComplexity ?? [])
        .filter((item) => item.reason === "unresolved dependency")
        .map((item) => ({
          claim: "the direction can proceed now",
          stance: "contradicts" as const,
          source: "scope:dependency",
          detail: `${item.what} is unresolved`,
        })),
    ];
    const interrogation = interrogate({
      objective: message,
      conclusion: `Handle the request as stated: ${shorten(message, 120)}`,
      assumptions: [
        {
          text: "the request is complete enough to act on",
          verified: ambiguity.score < 0.4,
          evidence: ambiguity.signals.join("; ") || "no ambiguity signal found",
        },
        ...(scope && scope.incidentalComplexity.length > 0
          ? [
              {
                text: "this needs new machinery",
                verified: false,
                evidence: scope.incidentalComplexity[0]!.reason,
              },
            ]
          : []),
      ],
      evidence: scopeEvidence,
      requirements: [],
      approach: [],
      recentActions: [],
      userCorrections: corrections,
      objectiveStillRelevant: true,
      nextStepDefined: true,
      dedupe: neural
        .recent(40)
        .filter((event) => event.kind === "self-questioning" && event.refs.conversationId === conversationId)
        .map((event) => event.id),
      now: at,
    });
    const challenges = interrogation.challenges.filter((challenge) => challenge.severity >= 0.5).slice(0, 2);
    for (const challenge of challenges) {
      neural.record({
        kind: "self-questioning",
        at,
        subject: challenge.question,
        detail: `${challenge.kind} — ${challenge.correction}`,
        refs: { conversationId, surface },
        data: { severity: challenge.severity },
      });
    }

    /* ---------------- INITIATIVE ---------------- */
    const seeds: InitiativeSeed[] = [];
    const live = AgentObjectives.getInstance()
      .list()
      .filter((objective) => ["active", "waiting", "scheduled", "awaiting-approval"].includes(objective.state));

    const earlierTurns = conversationId
      ? (MultiChatStore.getInstance().get(conversationId)?.messages ?? [])
          .filter((item) => item.role === "user" && item.text.trim() !== message)
          .slice(-12)
          .map((item) => item.text)
      : [];
    const contradiction = findContradiction(message, earlierTurns);
    if (contradiction.contradiction && contradiction.earlier) {
      seeds.push({
        kind: "contradiction",
        text: `Earlier you said “${shorten(contradiction.earlier, 120)}”. Which position should I follow now?`,
        strength: 0.8,
        asksQuestion: true,
        grounding: [
          { source: "conversation:earlier-turn", detail: contradiction.earlier },
          { source: "conversation:current-turn", detail: message },
        ],
        key: "contradiction:current-turn",
      });
    }

    const unfinished = live.find((objective) => similarity(objective.objective, message) < 0.3);
    if (unfinished) {
      seeds.push({
        kind: "unfinished-objective",
        text: `“${shorten(unfinished.objective, 120)}” is still ${unfinished.state}.`,
        strength: 0.55,
        grounding: [
          {
            source: "objective:live",
            detail: `${unfinished.state}; ${unfinished.cyclesRun} cycle(s); ${unfinished.actionsTaken} action(s)`,
          },
        ],
        key: `unfinished:${unfinished.id}`,
      });
    }

    const dependency = extractDependencies(message)[0];
    if (dependency) {
      seeds.push({
        kind: "future-direction",
        text: `This depends on “${shorten(dependency.what, 100)}”, which is not resolved yet.`,
        strength: 0.65,
        grounding: [{ source: "request:dependency", detail: dependency.what }],
        key: `dependency:${fingerprint("dependency", dependency.what)}`,
      });
    }

    if (scope && (scope.recommendation === "SIMPLIFY" || scope.recommendation === "MINIMIZE")) {
      seeds.push({
        kind: "alternative",
        text: scope.headline,
        strength: 0.65,
        grounding: scope.incidentalComplexity.map((item) => ({
          source: "scope:incidental",
          detail: `${item.what}: ${item.reason}`,
        })),
        key: scope.fingerprint,
      });
    }

    const mode = resolveCognitiveMode({
      liveObjectives: live.length,
      activeWork: live.some((objective) => objective.state === "active"),
      // A correction means the previous direction missed something;
      // reflect on it before adding more initiative.
      failedAction: correction,
      userTurnActive: false,
      wantsUninterruptedExecution: profile.wantsUninterruptedExecution,
      initiativeTolerance: profile.initiativeTolerance,
    });

    const selection = selectInitiatives(seeds, {
      mode,
      profile,
      topic: message,
      recentKeys: this.state.recentInitiativeKeys
        .filter((entry) => at - entry.at < 60 * 60 * 1000)
        .map((entry) => entry.key),
    });
    if (selection.contributions.length > 0) {
      this.state.recentInitiativeKeys = [
        ...this.state.recentInitiativeKeys,
        ...selection.contributions.map((contribution) => ({
          key: contribution.key ?? fingerprint("initiative", contribution.kind, contribution.text),
          at,
        })),
      ].slice(-MAX_RECENT_INITIATIVES);
      this.persist();
    }

    /* ---------------- THE NOTES SHE ACTUALLY SEES ---------------- */
    const parts: string[] = [];
    parts.push(collaboration.describe(profile));
    if (continuity) parts.push(continuity);
    if (this.state.pendingScopeNote && at - this.state.pendingScopeNote.at < 30 * 60 * 1000) {
      parts.push(`[Scope judgement on the previous plan] ${this.state.pendingScopeNote.text}`);
      this.state.pendingScopeNote = undefined;
      this.persist();
    }
    if (challenges.length > 0) {
      parts.push(
        `[Self-check before you answer] ${challenges
          .map((challenge) => `(${challenge.kind}) ${challenge.question}`)
          .join(" ")} Address anything that changes the answer; do not narrate the check.`,
      );
    }
    if (
      scope &&
      (scope.recommendation !== "HOLD" || scope.incidentalComplexity.length > 0) &&
      scope.confidence >= 0.45
    ) {
      parts.push(`[Scope judgement — say so only if it changes the answer] ${describeScope(scope)}`);
    }
    if (decision.action === "ask" && decision.question) {
      const why = decision.reasons
        .filter((reason) => reason.delta > 0)
        .slice(0, 2)
        .map((reason) => reason.detail)
        .join("; ");
      parts.push(
        `[Before you act — one clarification is worth making] Ask: “${decision.question}” It matters because ${why}. Do not guess instead.`,
      );
    } else if (decision.action === "proceed-with-assumption" && decision.assumption) {
      parts.push(
        `[Proceed, and state the assumption] ${decision.assumption}. Do not ask unless the work turns out to depend on it.`,
      );
    } else if (decision.action === "defer") {
      parts.push(
        "[Do not ask yet] A gap exists but no question would repay the interruption. Investigate first.",
      );
    }
    if (selection.contextBrief) parts.push(selection.contextBrief);

    return {
      context: parts.filter(Boolean).join("\n\n"),
      mode,
      profile,
      questioning: decision,
      scope,
      challenges,
      initiatives: selection.contributions,
      continuity,
    };
  }

  private settlePendingQuestion(
    message: string,
    profile: CollaborationProfile,
    at: number,
  ): void {
    const pending = this.state.pendingQuestion;
    if (!pending) return;
    this.state.pendingQuestion = undefined;

    const dismissal = /^(no|nope|not that|stop|don'?t|leave it|never mind|skip)\b/i.test(message);
    const newCommand = /^(build|make|create|add|fix|run|show|open|search|find|start|stop|delete|remove)\b/i.test(message);
    const substantive = message.split(/\s+/).filter(Boolean).length >= 3;
    const answered = !dismissal && !newCommand && substantive;

    const ledger = QuestioningLedger.getInstance();
    const learning = LearningLedger.getInstance();
    const collaboration = CollaborationModel.getInstance();
    const neural = NeuralMapBridge.getInstance();

    if (answered) {
      ledger.recordAnswered(pending.key, at);
      learning.record("question-answered", {
        conversationId: pending.conversationId,
        subject: pending.key,
        detail: `Answered: ${shorten(message, 140)}`,
        at,
      });
      collaboration.recordRecommendation("question", "accepted", {
        conversationId: pending.conversationId,
        at,
      });
    } else if (dismissal || newCommand) {
      ledger.recordIgnored(pending.key, at);
      learning.record("question-ignored", {
        conversationId: pending.conversationId,
        subject: pending.key,
        detail: dismissal ? "dismissed" : "moved to a new request",
        at,
      });
      collaboration.recordRecommendation("question", "ignored", {
        conversationId: pending.conversationId,
        at,
      });
    }
    neural.record({
      kind: "recommendation",
      at,
      subject: pending.question,
      detail: answered ? "clarification answered" : "clarification not answered",
      refs: { conversationId: pending.conversationId, questionId: pending.key },
      data: { profileAfter: profile.questionTolerance },
    });
  }

  /* ------------------------------------------------------------------ *
   * AFTER THE TURN
   * ------------------------------------------------------------------ */

  public completeTurn(input: TurnCompletionInput): TurnCompletion {
    const at = input.at ?? Date.now();
    const message = (input.message ?? "").trim();
    const reply = (input.reply ?? "").trim();
    const conversationId = input.conversationId;
    const surface = input.surface ?? "chat";
    const collaboration = CollaborationModel.getInstance();
    const learning = LearningLedger.getInstance();
    const neural = NeuralMapBridge.getInstance();
    const profile = collaboration.profile(conversationId, at);

    // A continuation the user actually picked up is evidence FOR
    // initiative; one they ignored is evidence against more of it.
    if (this.state.pendingContinuation) {
      const pending = this.state.pendingContinuation;
      const engaged = similarity(message, pending.text) >= 0.15;
      if (engaged) {
        learning.record("interruption-engaged", { conversationId, detail: pending.text, at });
        collaboration.recordRecommendation("continuation", "engaged", { conversationId, at });
      } else {
        learning.record("recommendation-ignored", { conversationId, detail: pending.text, at });
        collaboration.recordRecommendation("continuation", "ignored", { conversationId, at });
      }
      this.state.pendingContinuation = undefined;
    }

    /* ---------------- WHAT THE PLAN ACTUALLY IS ---------------- */
    const planSteps = (input.plan?.steps ?? [])
      .map((step) => `${step.title ?? ""} ${step.description ?? ""}`.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
    const requirements = extractRequirements(message);
    const scope = planSteps.length > 0 || requirements.length > 0
      ? assessScope({
          objective: input.plan?.goal || message,
          requirements,
          plan: planSteps,
          existingCapabilities: SelfModel.getInstance().get().capabilities,
          dependencies: extractDependencies(message),
          signaledSimplicity: /\b(simple|simplest|minimal|just|small|quick)\b/i.test(message),
          ambition: deriveAmbition(message),
          now: at,
        })
      : null;

    if (scope && scope.recommendation !== "HOLD" && scope.confidence >= 0.55) {
      const preserved = scope.preserved.length > 0
        ? ` Keep: ${scope.preserved.slice(0, 2).map((item) => `“${shorten(item, 70)}”`).join(", ")}.`
        : "";
      this.state.pendingScopeNote = {
        text: `${describeScope(scope)}${preserved}`,
        at,
        conversationId,
      };
      learning.record("scope-adjustment-proposed", {
        conversationId,
        subject: scope.fingerprint,
        detail: `${scope.recommendation}: ${scope.headline}`,
        at,
      });
      neural.record({
        kind: "scope-adjustment",
        at,
        subject: scope.headline,
        detail: `${scope.recommendation} on the produced plan — ${scope.headline}`,
        refs: { conversationId, surface },
        data: { confidence: scope.confidence },
      });
      if (scope.coverage.uncovered.length > 0) {
        learning.record("missing-requirement-found", {
          conversationId,
          subject: scope.coverage.uncovered[0],
          detail: scope.coverage.uncovered.join("; "),
          at,
        });
      }
    }

    /* ---------------- WHAT FOLLOWS FROM IT ---------------- */
    const objectives = AgentObjectives.getInstance().list();
    const queue = WorkQueue.getInstance().list();
    const projects = ProjectStore.getInstance().list().filter((project) => project.status === "active");
    const pendingQuestions = ProactiveCore.getInstance()
      .listQuestions()
      .filter((question) => question.status === "pending");
    const finished = objectives.filter(
      (objective) => objective.state === "completed" && at - objective.updatedAt < 15 * 60 * 1000,
    );
    const finishedQueue = queue.filter(
      (item) => item.status === "done" && at - item.updated < 15 * 60 * 1000,
    );
    const live = objectives.filter((objective) =>
      ["active", "waiting", "scheduled", "awaiting-approval"].includes(objective.state),
    );

    const continuation = planContinuation({
      completed: [
        ...finished.map((objective) => ({
          what: shorten(objective.objective, 140),
          evidence: "objective:completed",
          at: objective.updatedAt,
        })),
        ...finishedQueue.map((item) => ({
          what: item.title,
          evidence: "queue:done",
          at: item.updated,
        })),
      ],
      revealed: finished
        .filter((objective) => objective.conclusion?.trim())
        .map((objective) => ({
          finding: objective.conclusion!.trim(),
          evidence: "objective:conclusion",
          subject: shorten(objective.objective, 120),
        })),
      affectedObjectives: live.slice(0, 2).map((objective) => ({
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
          .map((project) => ({
            action: project.checkpoint!.nextAction!.trim(),
            source: "project:checkpoint",
          })),
        ...queue
          .filter((item) => item.status === "open" && item.category === "NEXT")
          .slice(0, 2)
          .map((item) => ({ action: item.title, source: "queue:NEXT" })),
      ],
      opportunities: queue
        .filter((item) => item.status === "open" && item.category === "IDEAS")
        .slice(0, 2)
        .map((item) => ({ what: item.title, evidence: "queue:IDEAS", strength: 0.65 })),
      userTolerance: profile.initiativeTolerance,
      interruptedRecently: false,
      now: at,
    });

    const eligible =
      continuation.worthRaising &&
      this.state.turnsSinceContinuation >= CONTINUATION_TURN_GAP &&
      at - this.state.lastContinuationAt > CONTINUATION_GAP_MS &&
      !profile.wantsUninterruptedExecution;

    let line: string | null = null;
    if (eligible && continuation.line) {
      line = continuation.line;
      this.state.pendingContinuation = { text: line, at, conversationId };
      this.state.lastContinuationAt = at;
      this.state.turnsSinceContinuation = 0;
      learning.record("interruption", { conversationId, subject: "continuation", detail: line, at });
      neural.record({
        kind: "post-action-continuation",
        at,
        subject: line,
        detail: line,
        visibility: "user-visible",
        refs: { conversationId, surface },
        data: { worthRaising: true },
      });
    } else {
      this.state.turnsSinceContinuation += 1;
      if (continuation.worthRaising && !eligible) {
        // Kept for the record: something WAS there, the gate withheld it.
        neural.record({
          kind: "post-action-continuation",
          at,
          subject: continuation.reason,
          detail: `Withheld: ${continuation.line}`,
          visibility: "internal",
          refs: { conversationId, surface },
          data: { reason: continuation.reason },
        });
      }
    }

    this.state.lastReply = shorten(reply, 600);
    this.state.lastReplyAt = at;
    this.state.lastPlan = planSteps.map((step) => step.text).slice(0, 12);
    if (conversationId) this.state.lastConversationId = conversationId;
    this.persist();

    if (conversationId) {
      SurfaceContinuity.getInstance().touch(surface, conversationId, {
        lastDecision: shorten(reply, 240),
        lastQuestion: line ?? "",
        topic: message,
        at,
      });
    }

    const evaluation = CognitiveEvaluation.getInstance().tick("assistant-turn", { now: at });
    const mode = evaluation.skipped
      ? resolveCognitiveMode({
          liveObjectives: live.length,
          activeWork: live.some((objective) => objective.state === "active"),
          failedAction: false,
          userTurnActive: false,
          wantsUninterruptedExecution: profile.wantsUninterruptedExecution,
          initiativeTolerance: profile.initiativeTolerance,
        })
      : evaluation.mode;

    return { continuation: line, plan: continuation, mode, scope };
  }

  /**
   * Called by AIService when the policy said to ask and the reply really
   * contains the question. This is the only path that counts a
   * clarification as asked.
   */
  public noteQuestionAsked(decision: QuestioningDecision, message: string, conversationId?: string): void {
    if (decision.action !== "ask" || !decision.question) return;
    QuestioningLedger.getInstance().record(decision, { conversationId });
    LearningLedger.getInstance().record("question-asked", {
      conversationId,
      subject: decision.key,
      detail: decision.question,
      at: Date.now(),
    });
    this.state.pendingQuestion = {
      key: decision.key,
      question: decision.question,
      objective: message,
      at: Date.now(),
      ...(conversationId ? { conversationId } : {}),
    };
    this.persist();
  }

  public reset(): void {
    this.state = defaultState();
    this.persist();
  }
}
