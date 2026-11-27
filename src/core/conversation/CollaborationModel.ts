/**
 * ==========================================================
 * LÉLU — USER-ADAPTIVE COLLABORATION MODEL (WP18.6)
 *
 * A changing estimate of HOW Heru prefers to work, built only from
 * what he actually did: what he asked for, what he corrected, what he
 * accepted or ignored. It is not a personality profile and it makes
 * no claims about his internal state.
 *
 * Three rules make it adaptive rather than a label:
 *
 *   EVIDENCE IS KEPT. Every adjustment stores the phrase or outcome
 *   that caused it, so the estimate can be explained and overruled.
 *
 *   IT DECAYS. A preference weight halves every three weeks, so an
 *   instruction from last month cannot govern this afternoon. Nothing
 *   is ever permanently locked.
 *
 *   IT IS CONTEXTUAL. Weights recorded in one conversation are blended
 *   with the global ones, so "be brief" in a quick thread does not
 *   silently make every other thread terse.
 *
 * Persistence is the existing KvStore. No model is called to infer a
 * preference: a preference nobody expressed is not recorded.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import type { Evidence } from "./types";
import { clamp, clamp01, shorten } from "./text";

export const COLLABORATION_PREFERENCES = [
  "direct-answers",
  "deeper-discussion",
  "critical-examination",
  "creative-exploration",
  "independent-research",
  "immediate-execution",
  "minimal-interruption",
  "detailed-collaboration",
] as const;

export type CollaborationPreference = (typeof COLLABORATION_PREFERENCES)[number];

export const PREFERENCE_LABELS: Record<CollaborationPreference, string> = {
  "direct-answers": "wants the answer up front",
  "deeper-discussion": "wants the reasoning explored",
  "critical-examination": "wants assumptions challenged",
  "creative-exploration": "wants ideas opened up",
  "independent-research": "wants sources checked independently",
  "immediate-execution": "wants work carried out now",
  "minimal-interruption": "wants to be interrupted less",
  "detailed-collaboration": "wants thorough, step-by-step collaboration",
};

interface PreferenceRecord {
  /** -1..1, where positive means "more of this". */
  value: number;
  at: number;
  evidence: string[];
}

interface ScopeState {
  preferences: Partial<Record<CollaborationPreference, PreferenceRecord>>;
}

interface Persisted {
  version: 1;
  scopes: Record<string, ScopeState>;
}

const KEY = "lelu.wp18.collaboration.v1";
const HALF_LIFE_MS = 21 * 24 * 60 * 60 * 1000;
const MAX_EVIDENCE = 3;
const MAX_SCOPES = 40;

/** A phrase Heru used, and which preference it is evidence for. */
interface PreferencePattern {
  pattern: RegExp;
  weights: Partial<Record<CollaborationPreference, number>>;
}

/**
 * Lexical evidence. Each entry is a thing he SAID, not a guess about
 * why he said it. Deliberately conservative: nothing here fires on a
 * single ambiguous word.
 */
const PATTERNS: PreferencePattern[] = [
  {
    pattern: /\b(short answer|just the answer|skip the (explanation|preamble)|be brief|get to the point|tl;?dr|no explanation)\b/i,
    weights: { "direct-answers": 0.6, "detailed-collaboration": -0.3 },
  },
  {
    pattern: /\b(explain why|more detail|go deeper|walk me through|teach me|help me understand|reasoning)\b/i,
    weights: { "deeper-discussion": 0.55, "detailed-collaboration": 0.3 },
  },
  {
    pattern: /\b(poke holes|challenge (that|this|me)|critique|devil'?s advocate|what am i missing|stress[- ]test)\b/i,
    weights: { "critical-examination": 0.65 },
  },
  {
    pattern: /\b(brainstorm|what if|ideas?|explore|possibilit|alternatives?|think out loud)\b/i,
    weights: { "creative-exploration": 0.5, "deeper-discussion": 0.15 },
  },
  {
    pattern: /\b(research|look into|investigate|find sources|check the (docs|literature)|look it up)\b/i,
    weights: { "independent-research": 0.55 },
  },
  {
    pattern: /\b(just do it|go ahead|implement it|build it now|don'?t ask|no questions|stop asking|execute)\b/i,
    weights: {
      "immediate-execution": 0.7,
      "minimal-interruption": 0.4,
      "detailed-collaboration": -0.25,
    },
  },
  {
    pattern: /\b(don'?t interrupt|leave me to it|let me work|keep it quiet|only ping me|i'?ll come to you)\b/i,
    weights: { "minimal-interruption": 0.7, "immediate-execution": 0.2 },
  },
  {
    pattern: /\b(step by step|thorough|comprehensive|in detail|all the options|everything involved)\b/i,
    weights: { "detailed-collaboration": 0.55, "deeper-discussion": 0.2 },
  },
];

export interface CollaborationProfile {
  updatedAt: number;
  contextKey: string;
  /** Effective, decayed weights. Positive means "more of this". */
  preferences: Record<CollaborationPreference, number>;
  dominant: CollaborationPreference[];
  /** 0..1: how much to lead with the conclusion. */
  directness: number;
  detailLevel: "terse" | "balanced" | "thorough";
  /** 0..1: how much a clarification is worth to this user right now. */
  questionTolerance: number;
  /** 0..1: how welcome an unasked-for contribution is. */
  initiativeTolerance: number;
  wantsUninterruptedExecution: boolean;
  /** The phrases and outcomes behind the estimate, newest first. */
  evidence: Evidence[];
  /** True when there is not enough evidence to adapt anything yet. */
  thin: boolean;
}

interface ObserveOptions {
  conversationId?: string;
  at?: number;
}

interface RecommendationOptions {
  conversationId?: string;
  at?: number;
}

export default class CollaborationModel {
  private static instance: CollaborationModel | null = null;

  private readonly kv = KvStore.getInstance();
  private state: Persisted;

  private constructor() {
    this.state = this.load();
  }

  public static getInstance(): CollaborationModel {
    if (!CollaborationModel.instance) {
      CollaborationModel.instance = new CollaborationModel();
    }
    return CollaborationModel.instance;
  }

  /** Test-only: drop the singleton so each test begins with no evidence. */
  public static resetForTests(): void {
    CollaborationModel.instance = null;
  }

  private load(): Persisted {
    const stored = this.kv.get<Partial<Persisted>>(KEY);
    if (!stored || stored.version !== 1 || typeof stored.scopes !== "object" || stored.scopes === null) {
      return { version: 1, scopes: {} };
    }
    return { version: 1, scopes: stored.scopes };
  }

  private persist(): void {
    const keys = Object.keys(this.state.scopes);
    if (keys.length > MAX_SCOPES) {
      // Bounded: the oldest scopes go first. The global scope is never dropped.
      const ordered = keys
        .filter((key) => key !== "global")
        .sort((a, b) => this.scopeAge(b) - this.scopeAge(a));
      for (const key of ordered.slice(0, keys.length - MAX_SCOPES)) {
        delete this.state.scopes[key];
      }
    }
    try {
      this.kv.set(KEY, this.state);
    } catch {
      // Best-effort, like every other store: losing an estimate must
      // never break the conversation it was estimating.
    }
  }

  private scopeAge(scope: string): number {
    const preferences = Object.values(this.state.scopes[scope]?.preferences ?? {});
    return Math.max(0, ...preferences.map((record) => record?.at ?? 0));
  }

  private scopeKey(conversationId?: string): string {
    return conversationId ? `conversation:${conversationId}` : "global";
  }

  private apply(
    scope: string,
    weights: Partial<Record<CollaborationPreference, number>>,
    evidence: string,
    at: number,
    multiplier = 1,
  ): void {
    const state = (this.state.scopes[scope] ??= { preferences: {} });
    for (const preference of COLLABORATION_PREFERENCES) {
      const delta = weights[preference];
      if (!delta) continue;
      const previous = state.preferences[preference];
      state.preferences[preference] = {
        value: clamp((previous?.value ?? 0) + delta * multiplier, -1, 1),
        at,
        evidence: [shorten(evidence, 90), ...(previous?.evidence ?? [])].slice(0, MAX_EVIDENCE),
      };
    }
    this.persist();
  }

  private decayed(record: PreferenceRecord | undefined, now: number): number {
    if (!record) return 0;
    const age = Math.max(0, now - record.at);
    return record.value * Math.pow(0.5, age / HALF_LIFE_MS);
  }

  private effective(scope: string, now: number): Record<CollaborationPreference, number> {
    const result = {} as Record<CollaborationPreference, number>;
    const state = this.state.scopes[scope];
    for (const preference of COLLABORATION_PREFERENCES) {
      result[preference] = clamp(this.decayed(state?.preferences[preference], now), -1, 1);
    }
    return result;
  }

  /**
   * Read what the user said this turn as evidence of how they want to
   * work, and record it globally and against this conversation.
   *
   * Returns the profile AFTER the observation, because the current
   * message is the strongest evidence available for the current reply.
   */
  public observe(message: string, options: ObserveOptions = {}): CollaborationProfile {
    const at = options.at ?? Date.now();
    const text = (message ?? "").trim();
    for (const pattern of PATTERNS) {
      if (!pattern.pattern.test(text)) continue;
      this.apply("global", pattern.weights, text, at);
      if (options.conversationId) {
        // Contextual evidence moves faster than global: it is about THIS
        // thread, and this thread will not last three weeks.
        this.apply(this.scopeKey(options.conversationId), pattern.weights, text, at, 0.6);
      }
    }
    return this.profile(options.conversationId, at);
  }

  /**
   * A recommendation's reception is evidence about future ones.
   *
   * Ignoring a question or a continuation raises the cost of the next
   * one; engaging with it lowers it. Rejection of a scope judgement
   * lowers how much scope advice is volunteered.
   */
  public recordRecommendation(
    kind: "question" | "continuation" | "scope",
    outcome: "accepted" | "rejected" | "ignored" | "engaged",
    options: RecommendationOptions = {},
  ): CollaborationProfile {
    const at = options.at ?? Date.now();
    const evidence = `${kind} ${outcome}`;
    const weights: Partial<Record<CollaborationPreference, number>> = {};

    if (kind === "question") {
      if (outcome === "ignored" || outcome === "rejected") {
        weights["minimal-interruption"] = 0.18;
        weights["immediate-execution"] = 0.06;
      } else {
        weights["detailed-collaboration"] = 0.06;
      }
    } else if (kind === "continuation") {
      if (outcome === "ignored" || outcome === "rejected") {
        weights["minimal-interruption"] = 0.12;
        weights["direct-answers"] = 0.05;
      } else {
        weights["deeper-discussion"] = 0.1;
      }
    } else {
      // Scope advice that is accepted is valued judgement; repeated
      // rejection says she is reading the work wrong.
      weights["critical-examination"] = outcome === "rejected" ? -0.08 : 0.05;
    }

    this.apply("global", weights, evidence, at);
    if (options.conversationId) {
      this.apply(this.scopeKey(options.conversationId), weights, evidence, at, 0.6);
    }
    return this.profile(options.conversationId, at);
  }

  /**
   * A correction is evidence that the previous answer missed something.
   * It does not say WHAT was missed, so only the fact is recorded here;
   * LearningLedger is what counts repeated corrections.
   */
  public recordCorrection(message: string, options: RecommendationOptions = {}): void {
    const at = options.at ?? Date.now();
    this.apply("global", { "detailed-collaboration": 0.08 }, message, at, 0.5);
    if (options.conversationId) {
      this.apply(this.scopeKey(options.conversationId), { "detailed-collaboration": 0.08 }, message, at, 0.5);
    }
  }

  /** The current estimate, optionally blended with one conversation's evidence. */
  public profile(conversationId?: string, now = Date.now()): CollaborationProfile {
    const global = this.effective("global", now);
    const local = conversationId ? this.effective(this.scopeKey(conversationId), now) : null;
    const preferences = {} as Record<CollaborationPreference, number>;
    for (const preference of COLLABORATION_PREFERENCES) {
      preferences[preference] = local
        ? clamp(global[preference] * 0.65 + local[preference] * 0.35, -1, 1)
        : global[preference];
    }

    const dominant = [...COLLABORATION_PREFERENCES]
      .filter((preference) => preferences[preference] > 0.15)
      .sort((a, b) => preferences[b] - preferences[a])
      .slice(0, 3);

    const detailLevel: CollaborationProfile["detailLevel"] =
      preferences["detailed-collaboration"] > 0.25 || preferences["deeper-discussion"] > 0.25
        ? "thorough"
        : preferences["direct-answers"] > 0.3
          ? "terse"
          : "balanced";

    const evidence = this.evidenceFor(conversationId);

    return {
      updatedAt: now,
      contextKey: conversationId ?? "global",
      preferences,
      dominant,
      directness: clamp01(
        0.5 +
          preferences["direct-answers"] * 0.4 -
          preferences["detailed-collaboration"] * 0.3 -
          preferences["deeper-discussion"] * 0.2,
      ),
      detailLevel,
      questionTolerance: clamp01(
        0.55 -
          preferences["minimal-interruption"] * 0.45 -
          preferences["immediate-execution"] * 0.2 +
          preferences["detailed-collaboration"] * 0.12,
      ),
      initiativeTolerance: clamp01(
        0.5 -
          preferences["minimal-interruption"] * 0.5 +
          preferences["deeper-discussion"] * 0.2 +
          preferences["creative-exploration"] * 0.15 +
          preferences["critical-examination"] * 0.1,
      ),
      wantsUninterruptedExecution:
        preferences["immediate-execution"] > 0.3 || preferences["minimal-interruption"] > 0.35,
      evidence,
      thin: evidence.length === 0,
    };
  }

  private evidenceFor(conversationId?: string): Evidence[] {
    const scopes = conversationId
      ? [this.scopeKey(conversationId), "global"]
      : ["global"];
    const found: Array<Evidence & { at: number }> = [];
    for (const scope of scopes) {
      const state = this.state.scopes[scope];
      if (!state) continue;
      for (const preference of COLLABORATION_PREFERENCES) {
        const record = state.preferences[preference];
        if (!record) continue;
        for (const detail of record.evidence) {
          found.push({
            source: `collaboration:${scope}:${preference}`,
            detail,
            at: record.at,
          });
        }
      }
    }
    const seen = new Set<string>();
    return found
      .sort((a, b) => b.at - a.at)
      .filter((item) => {
        if (seen.has(item.detail)) return false;
        seen.add(item.detail);
        return true;
      })
      .slice(0, 4)
      .map(({ source, detail }) => ({ source, detail }));
  }

  /**
   * How to describe this estimate to her own model.
   *
   * It is phrased as evidence, not as instructions about who Heru is —
   * the current turn's words always outrank it.
   */
  public describe(profile: CollaborationProfile): string {
    if (profile.thin) {
      return (
        "[How Heru prefers to collaborate] No consistent preference recorded yet. " +
        "Follow this turn's wording, and do not infer a style from a single message."
      );
    }
    const named = profile.dominant.map(
      (preference) => `${PREFERENCE_LABELS[preference]} (${profile.preferences[preference].toFixed(2)})`,
    );
    const evidence = profile.evidence.map((item) => `“${shorten(item.detail, 70)}”`).join("; ");
    return [
      "[How Heru prefers to collaborate — evidence, not a fixed label]",
      `Detail level: ${profile.detailLevel}. Directness: ${profile.directness.toFixed(2)}.`,
      `Question tolerance: ${profile.questionTolerance.toFixed(2)}. Initiative tolerance: ${profile.initiativeTolerance.toFixed(2)}.`,
      named.length > 0 ? `Recurring signals: ${named.join(", ")}.` : "",
      evidence ? `Evidence: ${evidence}.` : "",
      "This estimate decays and is often overridden by the current message; treat it as a prior.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /** Test/debug helper: clear one conversation's evidence. */
  public clearConversation(conversationId: string): void {
    delete this.state.scopes[this.scopeKey(conversationId)];
    this.persist();
  }

  /** Test-only: clear everything. */
  public reset(): void {
    this.state = { version: 1, scopes: {} };
    this.persist();
  }
}
