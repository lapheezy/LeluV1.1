/**
 * ==========================================================
 * LÉLU — COLLABORATION DEVELOPMENT LEDGER (WP18.9)
 *
 * What she is actually getting better or worse at, measured from
 * outcomes rather than from activity.
 *
 * The rule this file is built around:
 *
 *   MORE PROMPTS, LONGER RESPONSES AND MORE CYCLES ARE NOT PROGRESS.
 *
 * Nothing here counts words, tokens, turns or model calls. Every
 * metric is a RATIO of things that happened to the user:
 *
 *   questions answered vs ignored      questioning effectiveness
 *   recommendations accepted vs rejected   recommendation accuracy
 *   objectives continued vs abandoned   objective continuity
 *   interruptions engaged vs ignored    interruption quality
 *   corrections not repeated            correction discipline
 *   anticipatory actions that helped    anticipation
 *
 * A metric with no samples is `null`, not zero — "not measured" and
 * "measured badly" are different facts. A score only exists when at
 * least two metrics have samples.
 *
 * `compare()` is the development record: it compares one window with
 * an earlier one, and `capabilityGaps()` turns a weak ratio into a
 * concrete gap that Agent Forge / the self-improvement queue can act
 * on, with the evidence attached.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import ImprovementQueue from "../selfdev/ImprovementQueue";
import { fingerprint, shorten, tokens } from "./text";

export type DevelopmentEventType =
  | "question-asked"
  | "question-answered"
  | "question-ignored"
  | "question-repeated"
  | "recommendation-accepted"
  | "recommendation-rejected"
  | "recommendation-ignored"
  | "objective-continued"
  | "objective-abandoned"
  | "scope-adjustment-proposed"
  | "scope-adjustment-accepted"
  | "complexity-reduced"
  | "missing-requirement-found"
  | "correction"
  | "correction-repeated"
  | "anticipatory-action"
  | "anticipatory-action-failed"
  | "interruption"
  | "interruption-engaged";

export interface DevelopmentEvent {
  id: string;
  type: DevelopmentEventType;
  at: number;
  conversationId?: string;
  /** Stable identity for repeat detection (corrections, topics). */
  subject?: string;
  detail?: string;
}

export interface DevelopmentSummary {
  windowStart: number;
  windowEnd: number;
  events: number;
  counts: Record<DevelopmentEventType, number>;
  metrics: {
    questionEffectiveness: number | null;
    recommendationAccuracy: number | null;
    objectiveContinuity: number | null;
    interruptionQuality: number | null;
    correctionDiscipline: number | null;
    anticipation: number | null;
  };
  /** 0..1, or null when fewer than two metrics have samples. */
  collaborationScore: number | null;
  missingRequirementsFound: number;
  corrections: number;
  repeatedCorrections: number;
}

export interface MetricComparison {
  metric: keyof DevelopmentSummary["metrics"];
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface DevelopmentComparison {
  earlier: DevelopmentSummary;
  later: DevelopmentSummary;
  metrics: MetricComparison[];
  scoreDelta: number | null;
  improved: boolean;
  /** Why the comparison is or is not meaningful. */
  caveat: string;
}

export interface CapabilityGap {
  id: string;
  title: string;
  detail: string;
  evidence: string;
  severity: number;
  /** Which existing system owns the improvement. */
  owner: "agent-forge" | "self-improvement" | "caretaker";
}

const KEY = "lelu.wp18.development.v1";
const MAX_EVENTS = 400;
const MAX_SNAPSHOTS = 30;

const EVENT_TYPES: DevelopmentEventType[] = [
  "question-asked",
  "question-answered",
  "question-ignored",
  "question-repeated",
  "recommendation-accepted",
  "recommendation-rejected",
  "recommendation-ignored",
  "objective-continued",
  "objective-abandoned",
  "scope-adjustment-proposed",
  "scope-adjustment-accepted",
  "complexity-reduced",
  "missing-requirement-found",
  "correction",
  "correction-repeated",
  "anticipatory-action",
  "anticipatory-action-failed",
  "interruption",
  "interruption-engaged",
];

interface Snapshot {
  at: number;
  score: number | null;
  counts: Record<DevelopmentEventType, number>;
}

interface LedgerState {
  version: 1;
  events: DevelopmentEvent[];
  snapshots: Snapshot[];
}

function emptyCounts(): Record<DevelopmentEventType, number> {
  return Object.fromEntries(EVENT_TYPES.map((type) => [type, 0])) as Record<DevelopmentEventType, number>;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

/**
 * Pure: a window of events becomes the measured facts about it.
 * Exported because the evaluation harness and the tests both need to
 * score a window without touching the singleton.
 */
export function summarizeDevelopment(
  events: DevelopmentEvent[],
  windowStart = 0,
  windowEnd = Date.now(),
): DevelopmentSummary {
  const counts = emptyCounts();
  for (const event of events) {
    if (counts[event.type] !== undefined) counts[event.type] += 1;
  }

  const questionDecided = counts["question-answered"] + counts["question-ignored"] + counts["question-repeated"];
  const recommendationDecided = counts["recommendation-accepted"] + counts["recommendation-rejected"];
  const objectiveOutcomes = counts["objective-continued"] + counts["objective-abandoned"];
  const interruptionOutcomes = counts.interruption + counts["interruption-engaged"];
  const corrective = counts.correction + counts["correction-repeated"];
  const anticipatory = counts["anticipatory-action"] + counts["anticipatory-action-failed"];

  const metrics = {
    questionEffectiveness: ratio(counts["question-answered"], questionDecided),
    recommendationAccuracy: ratio(counts["recommendation-accepted"], recommendationDecided),
    objectiveContinuity: ratio(counts["objective-continued"], objectiveOutcomes),
    // Interruptions are good when engaged and bad when ignored: the
    // denominator is all interruptions, the numerator only engaged ones.
    interruptionQuality: ratio(counts["interruption-engaged"], interruptionOutcomes),
    correctionDiscipline:
      corrective > 0 ? 1 - (counts["correction-repeated"] ?? 0) / corrective : null,
    anticipation: ratio(counts["anticipatory-action"], anticipatory),
  };

  const weights: Array<[keyof typeof metrics, number]> = [
    ["questionEffectiveness", 0.18],
    ["recommendationAccuracy", 0.18],
    ["objectiveContinuity", 0.2],
    ["interruptionQuality", 0.16],
    ["correctionDiscipline", 0.16],
    ["anticipation", 0.12],
  ];
  let weighted = 0;
  let totalWeight = 0;
  let samples = 0;
  for (const [metric, weight] of weights) {
    const value = metrics[metric];
    if (value === null) continue;
    samples += 1;
    weighted += value * weight;
    totalWeight += weight;
  }

  return {
    windowStart,
    windowEnd,
    events: events.length,
    counts,
    metrics,
    collaborationScore: samples >= 2 && totalWeight > 0 ? weighted / totalWeight : null,
    missingRequirementsFound: counts["missing-requirement-found"],
    corrections: counts.correction,
    repeatedCorrections: counts["correction-repeated"],
  };
}

export function compareDevelopment(
  earlier: DevelopmentSummary,
  later: DevelopmentSummary,
): DevelopmentComparison {
  const metricKeys = Object.keys(earlier.metrics) as Array<keyof DevelopmentSummary["metrics"]>;
  const metrics: MetricComparison[] = metricKeys.map((metric) => {
    const before = earlier.metrics[metric];
    const after = later.metrics[metric];
    return {
      metric,
      before,
      after,
      delta: before === null || after === null ? null : after - before,
    };
  });
  const scoreDelta =
    earlier.collaborationScore === null || later.collaborationScore === null
      ? null
      : later.collaborationScore - earlier.collaborationScore;
  const comparable = metrics.filter((metric) => metric.delta !== null).length;
  return {
    earlier,
    later,
    metrics,
    scoreDelta,
    improved: scoreDelta !== null && scoreDelta > 0.02,
    caveat:
      comparable < 2
        ? "Too few comparable metrics; this is not yet evidence of development."
        : earlier.events < 6 || later.events < 6
          ? "Small sample; direction is indicative, not established."
          : "Both windows have enough outcomes for the comparison to mean something.",
  };
}

export default class LearningLedger {
  private static instance: LearningLedger | null = null;

  private readonly kv = KvStore.getInstance();
  private state: LedgerState;

  private constructor() {
    const stored = this.kv.get<Partial<LedgerState>>(KEY);
    this.state = {
      version: 1,
      events:
        stored?.version === 1 && Array.isArray(stored.events)
          ? stored.events.filter(
              (event): event is DevelopmentEvent =>
                Boolean(event) && typeof event.type === "string" && typeof event.at === "number",
            )
          : [],
      snapshots:
        stored?.version === 1 && Array.isArray(stored.snapshots)
          ? stored.snapshots.filter((snapshot): snapshot is Snapshot => Boolean(snapshot) && typeof snapshot.at === "number")
          : [],
    };
  }

  public static getInstance(): LearningLedger {
    if (!LearningLedger.instance) {
      LearningLedger.instance = new LearningLedger();
    }
    return LearningLedger.instance;
  }

  public static resetForTests(): void {
    LearningLedger.instance = null;
  }

  private persist(): void {
    this.state.events = this.state.events.slice(-MAX_EVENTS);
    this.state.snapshots = this.state.snapshots.slice(-MAX_SNAPSHOTS);
    try {
      this.kv.set(KEY, this.state);
    } catch {
      // best-effort
    }
  }

  public record(
    type: DevelopmentEventType,
    options: { conversationId?: string; subject?: string; detail?: string; at?: number } = {},
  ): DevelopmentEvent {
    const event: DevelopmentEvent = {
      id: `${options.at ?? Date.now()}-${this.state.events.length}`,
      type,
      at: options.at ?? Date.now(),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.subject ? { subject: options.subject } : {}),
      ...(options.detail ? { detail: shorten(options.detail, 240) } : {}),
    };
    this.state.events = [...this.state.events, event];
    this.persist();
    return event;
  }

  /**
   * A correction, with repetition detected by subject rather than text.
   * "Same mistake twice" is a fact worth its own event.
   */
  public recordCorrection(
    message: string,
    options: { conversationId?: string; at?: number } = {},
  ): { repeated: boolean; subject: string } {
    const subject = fingerprint(
      "correction",
      ...tokens(message).sort().slice(0, 5),
    );
    const repeated = this.state.events.some(
      (event) => event.type === "correction" && event.subject === subject,
    ) && this.state.events.filter((event) => event.type === "correction" && event.subject === subject).length < 3;
    this.record(repeated ? "correction-repeated" : "correction", {
      conversationId: options.conversationId,
      subject,
      detail: message,
      at: options.at,
    });
    return { repeated, subject };
  }

  public events(since = 0): DevelopmentEvent[] {
    return this.state.events.filter((event) => event.at >= since);
  }

  public summary(since = 0, until = Date.now()): DevelopmentSummary {
    return summarizeDevelopment(this.events(since), since, until);
  }

  /** The record as it stood at a past moment, for before/after comparison. */
  public summaryBefore(at: number, windowMs = 7 * 24 * 60 * 60 * 1000): DevelopmentSummary {
    const start = at - windowMs;
    return summarizeDevelopment(
      this.state.events.filter((event) => event.at >= start && event.at < at),
      start,
      at,
    );
  }

  /** Snapshot at most once an hour; returns the comparison when one exists. */
  public recordSnapshot(now = Date.now()): DevelopmentComparison | null {
    const last = this.state.snapshots[this.state.snapshots.length - 1];
    if (last && now - last.at < 60 * 60 * 1000) return null;
    const summary = this.summary(now - 7 * 24 * 60 * 60 * 1000, now);
    this.state.snapshots = [
      ...this.state.snapshots,
      { at: now, score: summary.collaborationScore, counts: summary.counts },
    ];
    this.persist();
    if (this.state.snapshots.length < 2) return null;
    const previous = this.state.snapshots[this.state.snapshots.length - 2]!;
    const earlier = summarizeDevelopment(
      this.state.events.filter((event) => event.at < previous.at),
      0,
      previous.at,
    );
    return compareDevelopment(earlier, summary);
  }

  /**
   * Concrete gaps, only where a ratio is genuinely weak and there are
   * enough samples to say so. Each names the system that owns it.
   */
  public capabilityGaps(summary = this.summary()): CapabilityGap[] {
    const gaps: CapabilityGap[] = [];
    const metrics = summary.metrics;

    if (
      metrics.questionEffectiveness !== null &&
      metrics.questionEffectiveness < 0.4 &&
      (summary.counts["question-answered"] + summary.counts["question-ignored"]) >= 4
    ) {
      gaps.push({
        id: "questioning-materiality",
        title: "Ask fewer questions, only when they change the action",
        detail: `Only ${Math.round((metrics.questionEffectiveness ?? 0) * 100)}% of clarifications were answered. Tighten materiality before interrupting.`,
        evidence: `${summary.counts["question-answered"]} answered / ${summary.counts["question-ignored"]} ignored / ${summary.counts["question-repeated"]} repeated.`,
        severity: 0.7,
        owner: "self-improvement",
      });
    }

    if (
      metrics.objectiveContinuity !== null &&
      metrics.objectiveContinuity < 0.5 &&
      (summary.counts["objective-continued"] + summary.counts["objective-abandoned"]) >= 4
    ) {
      gaps.push({
        id: "objective-continuity",
        title: "Carry objectives to a conclusion instead of leaving them",
        detail: `Only ${Math.round((metrics.objectiveContinuity ?? 0) * 100)}% of objectives were continued after the first interruption.`,
        evidence: `${summary.counts["objective-continued"]} continued / ${summary.counts["objective-abandoned"]} abandoned.`,
        severity: 0.65,
        owner: "agent-forge",
      });
    }

    if (
      metrics.interruptionQuality !== null &&
      metrics.interruptionQuality < 0.35 &&
      summary.counts.interruption >= 4
    ) {
      gaps.push({
        id: "interruption-relevance",
        title: "Raise observations that the user actually engages with",
        detail: `Only ${Math.round((metrics.interruptionQuality ?? 0) * 100)}% of proactive contributions were engaged with.`,
        evidence: `${summary.counts["interruption-engaged"]} engaged / ${summary.counts.interruption} raised.`,
        severity: 0.6,
        owner: "agent-forge",
      });
    }

    if (summary.repeatedCorrections >= 2) {
      gaps.push({
        id: "repeated-mistake",
        title: "Stop repeating a corrected mistake",
        detail: `The same correction has been made ${summary.repeatedCorrections + 1} times. Record the correction as a rule, not a memory.`,
        evidence: `${summary.repeatedCorrections} repeated correction event(s).`,
        severity: 0.8,
        owner: "self-improvement",
      });
    }

    if (
      metrics.anticipation !== null &&
      metrics.anticipation < 0.5 &&
      (summary.counts["anticipatory-action"] + summary.counts["anticipatory-action-failed"]) >= 4
    ) {
      gaps.push({
        id: "anticipation-accuracy",
        title: "Anticipate only consequences that actually follow",
        detail: `Only ${Math.round((metrics.anticipation ?? 0) * 100)}% of anticipations held up.`,
        evidence: `${summary.counts["anticipatory-action"]} held / ${summary.counts["anticipatory-action-failed"]} failed.`,
        severity: 0.55,
        owner: "agent-forge",
      });
    }

    return gaps.sort((a, b) => b.severity - a.severity);
  }

  /**
   * Hand the strongest gap to the EXISTING self-improvement queue, so
   * Agent Forge has work to evaluate through the architecture that
   * already exists rather than a parallel proposal system.
   */
  public fileCapabilityGaps(limit = 1): CapabilityGap[] {
    const filed: CapabilityGap[] = [];
    try {
      const queue = ImprovementQueue.getInstance();
      for (const gap of this.capabilityGaps().slice(0, limit)) {
        if (queue.hasOpenSimilar(gap.title)) continue;
        queue.add({
          title: gap.title,
          problem: gap.detail,
          observation: "Measured from collaboration outcomes in WP18's development ledger.",
          evidence: gap.evidence,
          proposedSolution:
            "Use the WP18 conversational evaluation to change the behaviour, then re-measure the same ratio over the next window.",
          expectedBenefit: "Fewer irrelevant interruptions and better objective continuity.",
          dependencies: [],
          risk: "low",
          requiredTools: [],
          requiredAgents: [],
          complexity: "low",
          kind: "Optimization",
          version: "WP18",
          testPlan: "tests/conversational-cognition.test.ts plus the WP18 evaluation harness.",
        });
        filed.push(gap);
      }
    } catch (error) {
      console.warn("[LearningLedger] could not file capability gaps (contained)", error);
    }
    return filed;
  }

  public snapshots(): Snapshot[] {
    return [...this.state.snapshots];
  }

  public reset(): void {
    this.state = { version: 1, events: [], snapshots: [] };
    this.persist();
  }
}
