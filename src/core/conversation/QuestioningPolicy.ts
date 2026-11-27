/**
 * ==========================================================
 * LÉLU — ADAPTIVE QUESTIONING ENGINE (WP18.4)
 *
 * Decides whether a clarification is worth the interruption, using
 * only things that are true about this moment: how ambiguous the
 * request is, whether an answer would change the next action, how
 * urgent it is, what the user already said about being asked, how
 * previous clarifications were received, and whether this question
 * has been asked before.
 *
 * The governing rule:
 *
 *   ASK ONLY WHEN THE ANSWER WOULD MATERIALLY CHANGE WHAT SHE DOES NEXT.
 *
 * Everything else is "proceed with a stated assumption" or "proceed",
 * which is a real decision rather than a failure to ask.
 *
 * Two things this deliberately does NOT do:
 *
 *   · invent a question when none is worth asking. A material gap
 *     with no specific question returns `defer` and says so.
 *   · diagnose the user. `posture` entries are observations of the
 *     wording ("the request carries four alternatives"), not claims
 *     about their state, and every one is overridable by the next
 *     message.
 *
 * QuestioningLedger closes the loop: answered questions make asking
 * cheaper, ignored ones make it more expensive.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { clamp, clamp01, fingerprint, shorten } from "./text";

/** What the wording suggests about how to respond — never a diagnosis. */
export type UserPosture =
  | "exploring"
  | "uncertain"
  | "decided"
  | "overcomplicating"
  | "overthinking"
  | "missing-dependency"
  | "needs-broader-investigation"
  | "needs-simpler-solution"
  | "wants-uninterrupted-execution";

export interface MissingInformation {
  /** The gap, phrased as a noun: "what done looks like". */
  what: string;
  /** Would knowing it change the next action? 0..1. */
  materiality: number;
  /** How much is already known. 0..1. */
  known: number;
  /** Could this be found without asking (memory, tool, research)? */
  discoverable: boolean;
}

export interface QuestioningInput {
  objective: string;
  /** 0..1. Computed from `deriveAmbiguity` when the caller has no better measure. */
  ambiguity: number;
  ambiguitySignals?: string[];
  missing?: MissingInformation[];
  /** 0..1: how much this decision costs if it is wrong. */
  decisionImportance: number;
  userInstructions?: {
    noQuestions?: boolean;
    askFreely?: boolean;
    executeNow?: boolean;
  };
  /** 0..1: time pressure. */
  urgency?: number;
  /** Recent clarifications, for repetition cost and effectiveness. */
  priorQuestions?: Array<{ key: string; askedAt: number; answered: boolean; ignored: boolean }>;
  /** Keys already asked in this thread. */
  repeatedQuestionKeys?: string[];
  /** Corrections received recently; repeated questions after a correction are expensive. */
  corrections?: number;
  /** From CollaborationModel.profile().questionTolerance. */
  questionTolerance: number;
  wantsUninterruptedExecution?: boolean;
  /** The exact question she would ask. Without one, she cannot ask. */
  proposedQuestion?: string;
  /** What she would do if she proceeded without asking. */
  expectedAction?: string;
  /** From QuestioningLedger.toleranceAdjustment(). */
  learnedAdjustment?: number;
  now?: number;
}

export interface QuestioningReason {
  code: string;
  detail: string;
  delta: number;
}

export interface QuestioningDecision {
  action: "ask" | "proceed-with-assumption" | "proceed-silently" | "defer";
  question: string | null;
  /** What she will treat as true if she does not ask. */
  assumption: string | null;
  confidence: number;
  reasons: QuestioningReason[];
  /** Materiality of the highest-impact gap, 0..1. */
  expectedImpact: number;
  /** How much the interruption is estimated to cost, 0..1. */
  interruptionCost: number;
  posture: UserPosture[];
  /** True when the best available answer would not change the next action. */
  answerWouldNotChangeAction: boolean;
  /** Fingerprint of the decision, for learning its outcome. */
  key: string;
}

/* ------------------------------------------------------------------ *
 * READING THE REQUEST
 * ------------------------------------------------------------------ */

const VAGUE_VERBS = /\b(improve|enhance|optimize|fix|update|polish|clean up|make it better|sort out|look at)\b/i;
const SUCCESS_CRITERIA = /\b(so that|should|must|done when|acceptance|test|tests pass|without breaking|keep|preserve|support|as long as|criteria)\b/i;
const BOUND_REFERENCE = /(?:[/\\][\w./-]{3,}|\b\w+\.(ts|tsx|js|py|md|json)\b|\b\d{1,5}\b)/;
const REFERENT_PRONOUNS = /\b(it|that|this|those|these)\b/i;

/**
 * How ambiguous the request is, from its wording.
 *
 * `signals` are quotable: "no success criterion", "‘it’ has no
 * antecedent". They travel into the decision's reasons so an ask can
 * always be justified afterwards.
 */
export function deriveAmbiguity(text: string): { score: number; signals: string[] } {
  const clean = (text ?? "").trim();
  const signals: string[] = [];
  let score = 0.15;

  if (clean.length === 0) return { score: 1, signals: ["the request is empty"] };

  if (VAGUE_VERBS.test(clean) && !SUCCESS_CRITERIA.test(clean)) {
    score += 0.2;
    signals.push("a broad verb with no stated success criterion");
  }
  if (!SUCCESS_CRITERIA.test(clean) && clean.split(/\s+/).length > 3) {
    score += 0.1;
    signals.push("nothing says what done looks like");
  }
  if (/\bor\b/i.test(clean) && /\b(maybe|could|either|or should|or we)\b/i.test(clean)) {
    score += 0.15;
    signals.push("more than one direction is offered as acceptable");
  }
  if (REFERENT_PRONOUNS.test(clean) && clean.split(/\s+/).length <= 6) {
    score += 0.2;
    signals.push("‘it/that/this’ carries no antecedent in the message");
  }
  if (clean.split(/\s+/).length < 4) {
    score += 0.1;
    signals.push("the request is extremely short");
  }
  if (BOUND_REFERENCE.test(clean)) {
    score -= 0.25;
    signals.push("a concrete path, name or number narrows it");
  }
  if (/\b(you decide|your call|use your judgment|whatever you think|up to you)\b/i.test(clean)) {
    score -= 0.2;
    signals.push("she was explicitly given the decision");
  }
  return { score: clamp01(score), signals };
}

/** Does the text state what success would look like? */
export function hasSuccessCriterion(text: string): boolean {
  return SUCCESS_CRITERIA.test(text ?? "");
}

/** Wording-level posture observations. All of them are defeasible. */
export function derivePosture(text: string, priorQuestions: Array<{ answered: boolean; ignored: boolean }> = []): UserPosture[] {
  const clean = text ?? "";
  const posture = new Set<UserPosture>();

  if (/\b(just do it|go ahead|no questions|don'?t ask|stop asking|implement it|build it now|without asking)\b/i.test(clean)) {
    posture.add("wants-uninterrupted-execution");
  }
  if (/\b(maybe|what if|thinking about|explore|possibilit|might|could we|should we)\b/i.test(clean)) {
    posture.add("exploring");
  }
  if (/\b(i'?m not sure|not certain|unsure|no idea|don'?t know yet|i think maybe)\b/i.test(clean)) {
    posture.add("uncertain");
  }
  if (/\b(i decided|i'?ve decided|we'?re doing|go with|settled on|final answer|use the)\b/i.test(clean)) {
    posture.add("decided");
  }
  if ((clean.match(/\bor\b/gi)?.length ?? 0) >= 3 || (clean.match(/\?/g)?.length ?? 0) >= 3) {
    posture.add("overcomplicating");
  }
  if (priorQuestions.length >= 2 && priorQuestions.slice(0, 2).every((question) => question.answered)) {
    posture.add("overthinking");
  }
  if (/\b(depends on|blocked by|waiting on|requires? the|before we can|prerequisite)\b/i.test(clean)) {
    posture.add("missing-dependency");
  }
  if (/\b(research|look into|find out|investigate|not sure what|unclear)\b/i.test(clean)) {
    posture.add("needs-broader-investigation");
  }
  if (/\b(simple|simplest|minimal|just a|smallest|quick version|lightweight)\b/i.test(clean)) {
    posture.add("needs-simpler-solution");
  }

  // "overcomplicating" is only asserted with two independent signs.
  if (posture.has("overcomplicating") && !/\b(every|all the|edge case|what about|also maybe)\b/i.test(clean)) {
    posture.delete("overcomplicating");
  }
  return [...posture];
}

/* ------------------------------------------------------------------ *
 * THE DECISION
 * ------------------------------------------------------------------ */

function impactOf(input: QuestioningInput): { impact: number; best: MissingInformation | null } {
  const missing = input.missing ?? [];
  let best: MissingInformation | null = null;
  let impact = 0;
  for (const gap of missing) {
    // Materiality is discounted by what is already known, and by
    // whether the answer can be discovered without asking at all.
    const value = clamp01(gap.materiality) * (1 - clamp01(gap.known)) * (gap.discoverable ? 0.35 : 1);
    if (value > impact) {
      impact = value;
      best = gap;
    }
  }
  if (!best) {
    // No identified gap: the request's own ambiguity is the only thing
    // a question could resolve, and it has to compete with its cost.
    impact = clamp01(input.ambiguity) * clamp01(input.decisionImportance) * 0.6;
  }
  return { impact: clamp01(impact), best };
}

function interruptionCostOf(input: QuestioningInput): { cost: number; reasons: QuestioningReason[] } {
  const reasons: QuestioningReason[] = [];
  let cost = 0.18;
  reasons.push({ code: "baseline-interruption", detail: "any question costs the user a turn", delta: 0.18 });

  const repeated = input.repeatedQuestionKeys?.length ?? 0;
  if (repeated > 0) {
    cost += Math.min(0.36, repeated * 0.18);
    reasons.push({
      code: "repeated-question",
      detail: `this has been asked ${repeated} time(s) already`,
      delta: Math.min(0.36, repeated * 0.18),
    });
  }

  const ignored = (input.priorQuestions ?? []).filter((question) => question.ignored).length;
  if (ignored > 0) {
    cost += Math.min(0.3, ignored * 0.1);
    reasons.push({
      code: "prior-clarification-ignored",
      detail: `${ignored} earlier clarification(s) went unanswered`,
      delta: Math.min(0.3, ignored * 0.1),
    });
  }

  if ((input.corrections ?? 0) > 0) {
    cost += 0.08;
    reasons.push({
      code: "recent-correction",
      detail: "a correction is recent; another question can read as deflection",
      delta: 0.08,
    });
  }

  const urgency = clamp01(input.urgency ?? 0);
  // A low background urgency is not "time-sensitive"; saying so would
  // put a false reason in front of the user.
  if (urgency >= 0.3) {
    cost += urgency * 0.2;
    reasons.push({ code: "urgency", detail: "the work is time-sensitive", delta: urgency * 0.2 });
  }

  const tolerance = clamp01(input.questionTolerance + (input.learnedAdjustment ?? 0));
  const toleranceCost = (1 - tolerance) * 0.4;
  cost += toleranceCost;
  reasons.push({
    code: "question-tolerance",
    detail: `tolerance for being asked is ${tolerance.toFixed(2)}`,
    delta: toleranceCost,
  });

  if (input.wantsUninterruptedExecution) {
    cost += 0.28;
    reasons.push({
      code: "wants-uninterrupted-execution",
      detail: "the user asked to be left to execute",
      delta: 0.28,
    });
  }

  if (input.userInstructions?.askFreely) {
    cost -= 0.3;
    reasons.push({ code: "invited-to-ask", detail: "the user invited questions", delta: -0.3 });
  }

  return { cost: clamp01(cost), reasons };
}

export function decideQuestioning(input: QuestioningInput): QuestioningDecision {
  const posture = derivePosture(input.objective, input.priorQuestions);
  const { impact, best } = impactOf(input);
  const { cost, reasons } = interruptionCostOf(input);
  const answerWouldNotChangeAction = best !== null && clamp01(best.materiality) < 0.3;
  const question = (input.proposedQuestion ?? "").trim();
  const key = fingerprint(
    "questioning",
    input.objective,
    question,
    best?.what ?? "",
  );

  const base = {
    key,
    posture,
    expectedImpact: impact,
    interruptionCost: cost,
    answerWouldNotChangeAction,
    reasons: [...reasons],
  };

  // An explicit instruction not to ask is decisive, not one input among
  // many. It is the user's own statement about this work.
  if (input.userInstructions?.noQuestions) {
    reasons.push({
      code: "user-said-no-questions",
      detail: "the user explicitly asked her not to ask",
      delta: 1,
    });
    return {
      ...base,
      action: "proceed-silently",
      question: null,
      assumption: null,
      confidence: 0.9,
      reasons,
    };
  }

  // Nothing material would change: asking would be theatre.
  if (answerWouldNotChangeAction) {
    reasons.push({
      code: "answer-would-not-change-action",
      detail: `knowing “${best?.what ?? "this"}” would not change the next action`,
      delta: 0.5,
    });
    return {
      ...base,
      action: "proceed-silently",
      question: null,
      assumption: null,
      confidence: 0.82,
      reasons,
    };
  }

  if (impact >= Math.max(0.3, cost)) {
    if (!question) {
      reasons.push({
        code: "no-question-worth-asking",
        detail: "a real gap exists, but no specific question would repay the interruption — investigate instead",
        delta: 0.2,
      });
      return {
        ...base,
        action: "defer",
        question: null,
        assumption: null,
        confidence: 0.55,
        reasons,
      };
    }
    reasons.push({
      code: "material-gap",
      detail: best
        ? `“${best.what}” is ${(clamp01(best.materiality) * 100).toFixed(0)}% likely to change the next action`
        : `ambiguity ${input.ambiguity.toFixed(2)} is high enough to change the next action`,
      delta: impact,
    });
    return {
      ...base,
      action: "ask",
      question,
      assumption: null,
      confidence: clamp01(0.55 + (impact - cost) * 0.5),
      reasons,
    };
  }

  // Proceeding is the decision here, with the assumption made explicit
  // unless the user asked not to be interrupted at all.
  const assumption = best
    ? `treat “${best.what}” as ${input.expectedAction ?? "the most direct reading of the request"}`
    : input.ambiguity > 0.3
      ? `the request means ${shorten(input.objective, 90)} as written`
      : null;

  reasons.push({
    code: "interruption-costs-more-than-the-gap",
    detail: `impact ${impact.toFixed(2)} does not beat interruption cost ${cost.toFixed(2)}`,
    delta: cost - impact,
  });

  return {
    ...base,
    action: assumption && !input.wantsUninterruptedExecution ? "proceed-with-assumption" : "proceed-silently",
    question: null,
    assumption,
    confidence: clamp01(0.5 + (cost - impact) * 0.5),
    reasons,
  };
}

/* ------------------------------------------------------------------ *
 * LEARNING FROM WHAT HAPPENED NEXT
 * ------------------------------------------------------------------ */

interface LedgerRecord {
  key: string;
  at: number;
  action: QuestioningDecision["action"];
  question: string | null;
  conversationId?: string;
  /**
   * How much the answer was expected to change the next action.
   *
   * Stored so effectiveness can be learned PER KIND of question. A
   * pooled rate is misleading: answering three high-stakes questions
   * says nothing about whether a low-stakes one was worth asking, and
   * using the pooled rate is what let ignored low-stakes questions
   * come back.
   */
  impact?: number;
  outcome?: "answered" | "ignored" | "resolved-without-answer" | "asked-again";
  outcomeAt?: number;
}

interface LedgerState {
  version: 1;
  records: LedgerRecord[];
}

const LEDGER_KEY = "lelu.wp18.questioning.v1";
const MAX_RECORDS = 120;

export interface QuestioningEffectiveness {
  asked: number;
  answered: number;
  ignored: number;
  repeated: number;
  answerRate: number | null;
  ignoreRate: number | null;
  /** Signed adjustment to tolerance, -0.3..0.2. */
  adjustment: number;
  samples: number;
}

/**
 * What happened after she asked.
 *
 * This is the whole of "learns when to question more and when to
 * question less": answered questions lower the future cost of asking,
 * ignored ones raise it, repeated ones raise it sharply. Bounded so a
 * handful of outcomes cannot swing the policy.
 */
export default class QuestioningLedger {
  private static instance: QuestioningLedger | null = null;

  private readonly kv = KvStore.getInstance();
  private state: LedgerState;

  private constructor() {
    const stored = this.kv.get<Partial<LedgerState>>(LEDGER_KEY);
    this.state = {
      version: 1,
      records:
        stored?.version === 1 && Array.isArray(stored.records)
          ? stored.records.filter(
              (record): record is LedgerRecord =>
                Boolean(record) && typeof record.key === "string" && typeof record.at === "number",
            )
          : [],
    };
  }

  public static getInstance(): QuestioningLedger {
    if (!QuestioningLedger.instance) {
      QuestioningLedger.instance = new QuestioningLedger();
    }
    return QuestioningLedger.instance;
  }

  public static resetForTests(): void {
    QuestioningLedger.instance = null;
  }

  private persist(): void {
    this.state.records = this.state.records.slice(-MAX_RECORDS);
    try {
      this.kv.set(LEDGER_KEY, this.state);
    } catch {
      // best-effort
    }
  }

  public record(decision: QuestioningDecision, options: { conversationId?: string; at?: number } = {}): void {
    if (decision.action !== "ask") return;
    const record: LedgerRecord = {
      key: decision.key,
      at: options.at ?? Date.now(),
      action: decision.action,
      question: decision.question,
      impact: decision.expectedImpact,
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    };
    this.state.records = [...this.state.records, record].slice(-MAX_RECORDS);
    this.persist();
  }

  /** The user answered a question she asked. */
  public recordAnswered(questionKey: string, at = Date.now()): void {
    this.close(questionKey, "answered", at);
  }

  /** The user moved on without answering. */
  public recordIgnored(questionKey: string, at = Date.now()): void {
    this.close(questionKey, "ignored", at);
  }

  /** The answer arrived later, from the work itself. */
  public recordResolved(questionKey: string, at = Date.now()): void {
    this.close(questionKey, "resolved-without-answer", at);
  }

  private close(questionKey: string, outcome: NonNullable<LedgerRecord["outcome"]>, at: number): void {
    const record = [...this.state.records].reverse().find((item) => item.key === questionKey && !item.outcome);
    if (!record) return;
    record.outcome = outcome;
    record.outcomeAt = at;
    this.persist();
  }

  /** Mark that a question was raised again after being left open. */
  public recordRepeated(questionKey: string, at = Date.now()): void {
    const record = [...this.state.records].reverse().find((item) => item.key === questionKey && !item.outcome);
    if (!record) return;
    record.outcome = "asked-again";
    record.outcomeAt = at;
    this.persist();
  }

  public recent(limit = 6): LedgerRecord[] {
    return this.state.records.slice(-limit);
  }

  /**
   * Prior questions of the same kind, for the interruption cost.
   *
   * Two questions with very different materiality are not evidence
   * about each other. `impact` is a 0..1 estimate, and the band is wide
   * enough to collect a usable sample while still keeping a clarifying
   * question distinct from a low-value one.
   */
  public historyFor(impact: number, limit = 24): LedgerRecord[] {
    return this.state.records
      .filter((record) => record.impact !== undefined && Math.abs(record.impact - impact) <= 0.2)
      .slice(-limit);
  }

  public effectivenessFor(impact: number): QuestioningEffectiveness {
    return this.measure(this.historyFor(impact, 60));
  }

  public openQuestionKeys(): string[] {
    return this.state.records.filter((record) => !record.outcome).map((record) => record.key);
  }

  public effectiveness(): QuestioningEffectiveness {
    return this.measure(this.state.records);
  }

  private measure(records: LedgerRecord[]): QuestioningEffectiveness {
    const asked = records.filter((record) => record.action === "ask");
    const answered = asked.filter((record) => record.outcome === "answered").length;
    const ignored = asked.filter((record) => record.outcome === "ignored").length;
    const repeated = asked.filter((record) => record.outcome === "asked-again").length;
    const decided = answered + ignored + repeated;
    const answerRate = decided > 0 ? answered / decided : null;
    const ignoreRate = decided > 0 ? ignored / decided : null;
    let adjustment = 0;
    if (decided >= 2 && answerRate !== null && ignoreRate !== null) {
      adjustment = clamp((answerRate - ignoreRate) * 0.2 - repeated * 0.03, -0.3, 0.15);
    }
    return {
      asked: asked.length,
      answered,
      ignored,
      repeated,
      answerRate,
      ignoreRate,
      adjustment,
      samples: decided,
    };
  }

  /** Convenience for QuestioningInput.learnedAdjustment, for one kind of question. */
  public toleranceAdjustmentFor(impact: number): number {
    return this.effectivenessFor(impact).adjustment;
  }

  /** Pooled adjustment, for display only — not for the policy. */
  public toleranceAdjustment(): number {
    return this.effectiveness().adjustment;
  }

  public reset(): void {
    this.state = { version: 1, records: [] };
    this.persist();
  }
}
