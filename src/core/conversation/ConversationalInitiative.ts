/**
 * ==========================================================
 * LÉLU — CONVERSATIONAL INITIATIVE (WP18.3)
 *
 * What she noticed while working, offered as material for the
 * conversation rather than bolted onto the reply.
 *
 * Every candidate must arrive with grounding — a record, a checkpoint,
 * a stated requirement, a contradiction between two things the user
 * said. A candidate with no grounding is rejected, which is the code-
 * level answer to "do not manufacture conversation to appear active".
 *
 * Selection is relevance-weighted, novelty-weighted and tolerance-
 * weighted, capped by mode. In OBSERVATIONAL mode she keeps the
 * observation to herself and it only informs her context; she does not
 * speak it.
 *
 * The output is an internal brief. LÉLU's own model decides how to use
 * it in the reply, which is how an observation can participate in a
 * conversation without being a canned sentence inserted by a rule.
 * ==========================================================
 */

import type { CognitiveMode, Evidence } from "./types";
import type { CollaborationProfile } from "./CollaborationModel";
import { findReversal, fingerprint, overlap, shorten, similarity } from "./text";

export type InitiativeKind =
  | "observation"
  | "follow-up-question"
  | "idea"
  | "challenge"
  | "contradiction"
  | "alternative"
  | "implication"
  | "unfinished-objective"
  | "future-direction";

export interface InitiativeSeed {
  kind: InitiativeKind;
  text: string;
  grounding: Evidence[];
  /** 0..1: how strong the underlying evidence is. */
  strength: number;
  asksQuestion?: boolean;
  /** Stable identity for novelty tracking. */
  key?: string;
}

export interface InitiativeContext {
  mode: CognitiveMode;
  profile: CollaborationProfile;
  /** Current request or topic, for relevance. */
  topic: string;
  /** Fingerprints already raised recently. */
  recentKeys?: string[];
  maxContributions?: number;
}

export interface InitiativeSelection {
  contributions: InitiativeSeed[];
  suppressed: Array<{ seed: InitiativeSeed; reason: string }>;
  /** Internal brief for her model; null when there is nothing to say. */
  contextBrief: string | null;
}

const KIND_LABEL: Record<InitiativeKind, string> = {
  observation: "observation",
  "follow-up-question": "question worth asking",
  idea: "idea",
  challenge: "challenge to the current direction",
  contradiction: "possible contradiction",
  alternative: "alternative",
  implication: "implication",
  "unfinished-objective": "unfinished objective",
  "future-direction": "future direction",
};

/** How many contributions a mode permits. */
export function contributionBudget(mode: CognitiveMode): number {
  switch (mode) {
    case "observational":
      // Notices without interrupting.
      return 0;
    case "executive":
      return 1;
    case "reflective":
      return 1;
    case "collaborative":
      return 2;
    case "conversational":
      return 1;
  }
}

function keyOf(seed: InitiativeSeed): string {
  return seed.key ?? fingerprint("initiative", seed.kind, seed.text);
}

export function selectInitiatives(seeds: InitiativeSeed[], context: InitiativeContext): InitiativeSelection {
  const suppressed: Array<{ seed: InitiativeSeed; reason: string }> = [];
  const recent = new Set(context.recentKeys ?? []);
  const tolerance = Math.max(0, Math.min(1, context.profile.initiativeTolerance));
  const budget = Math.min(context.maxContributions ?? contributionBudget(context.mode), contributionBudget(context.mode));
  const ranked: Array<{ seed: InitiativeSeed; score: number }> = [];

  for (const seed of seeds) {
    const text = (seed.text ?? "").trim();
    if (!text) {
      suppressed.push({ seed, reason: "empty" });
      continue;
    }
    // No grounding, no contribution. This is the hard rule.
    if (!seed.grounding || seed.grounding.length === 0) {
      suppressed.push({ seed, reason: "no evidence to ground it" });
      continue;
    }
    const key = keyOf(seed);
    if (recent.has(key)) {
      suppressed.push({ seed, reason: "already raised recently" });
      continue;
    }
    if (seed.asksQuestion && (tolerance < 0.3 || context.profile.wantsUninterruptedExecution)) {
      suppressed.push({ seed, reason: "the user currently prefers not to be asked" });
      continue;
    }
    const relevance = Math.max(similarity(text, context.topic), overlap(text, context.topic) > 0 ? 0.4 : 0);
    const novelty = 1;
    const score = seed.strength * 0.55 + relevance * 0.3 + novelty * 0.15;
    if (score < 0.3) {
      suppressed.push({ seed, reason: "too weak or too loosely related" });
      continue;
    }
    ranked.push({ seed, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  const contributions = ranked.slice(0, Math.max(0, budget)).map((item) => item.seed);
  for (const item of ranked.slice(Math.max(0, budget))) {
    suppressed.push({ seed: item.seed, reason: "lower relevance than what was kept" });
  }

  return {
    contributions,
    suppressed,
    contextBrief: buildBrief(contributions, context),
  };
}

function buildBrief(contributions: InitiativeSeed[], context: InitiativeContext): string | null {
  if (contributions.length === 0) return null;
  const lines = contributions.map((seed) => {
    const source = seed.grounding.map((item) => item.source).join(", ");
    return `- (${KIND_LABEL[seed.kind]}) ${shorten(seed.text, 220)}\n  grounded in: ${source}`;
  });
  return [
    "[What you noticed — internal; use your judgement, do not recite this]",
    ...lines,
    context.mode === "observational"
      ? "Mode: observational — keep this to yourself for now; let it inform how you read the request, not what you say."
      : "Raise at most one of these, and only if it changes something for the user. Do not restate the request, do not append a generic offer of help, and do not raise an observation whose evidence you cannot name.",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * CONTRADICTION
 * ------------------------------------------------------------------ */

export interface ContradictionCheck {
  contradiction: boolean;
  earlier: string | null;
  basis: string | null;
}

/**
 * Compares the current message with earlier user turns.
 *
 * Conservative on purpose: a shared topic plus an explicit reversal
 * marker ("actually", "instead", "not X", "changed my mind"). It is
 * presented as a question about which one holds, never as an assertion
 * that the user is being inconsistent.
 */
export function findContradiction(current: string, earlierTurns: string[]): ContradictionCheck {
  const currentText = (current ?? "").trim();
  if (!currentText) return { contradiction: false, earlier: null, basis: null };

  // One reversal implementation, shared with the rest of WP18. It is
  // conservative by design: it needs shared subject matter AND an
  // explicit reversal marker.
  for (const earlier of [...earlierTurns].reverse()) {
    const reversal = findReversal(currentText, earlier);
    if (reversal) {
      return {
        contradiction: true,
        earlier: shorten(earlier, 160),
        basis: "an earlier position is being reversed",
      };
    }
  }
  return { contradiction: false, earlier: null, basis: null };
}
