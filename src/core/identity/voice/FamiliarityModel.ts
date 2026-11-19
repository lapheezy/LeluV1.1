/**
 * ==========================================================
 * LÉLU — FAMILIARITY MODEL
 *
 * Familiarity is measured, not performed. It is derived from the
 * real counters the linguistic profile keeps — exchanges, active
 * days, banter, corrections, shared references — so "we're close"
 * is something she earned rather than a line she opens with.
 *
 * The tier decides HOW MUCH of her informal range is available:
 * a stranger gets clarity and warmth; someone she has talked to
 * for months gets shorthand, callbacks, and dry teasing.
 * ==========================================================
 */

import type { FamiliarityCounters } from "./LinguisticProfile";

export type FamiliarityTier = "new" | "acquainted" | "familiar" | "close" | "old-friend";

export interface FamiliarityState {
  score: number;
  tier: FamiliarityTier;
  interactions: number;
  daysKnown: number;
  banterTurns: number;
  corrections: number;
  sharedReferences: number;
  /** What this tier permits. */
  allows: {
    contractions: boolean;
    shorthand: boolean;
    callbacks: boolean;
    teasing: boolean;
    skipGreeting: boolean;
    mirrorUserLingo: boolean;
  };
}

const DAY_MS = 86_400_000;

/** Bounded 0..1 weighting: no single channel can manufacture closeness. */
function weighted(input: {
  interactions: number;
  daysKnown: number;
  banterTurns: number;
  corrections: number;
  sharedReferences: number;
}): number {
  const conversation = Math.min(1, Math.log10(1 + input.interactions) / 2.1); // 10 → .47, 126 → 1
  const time = Math.min(1, Math.log10(1 + input.daysKnown) / 1.8); // 30 → .95
  const play = Math.min(1, input.banterTurns / 20);
  const repair = Math.min(1, input.corrections / 6);
  const shared = Math.min(1, input.sharedReferences / 6);
  return Number(
    (conversation * 0.45 + time * 0.25 + play * 0.12 + repair * 0.08 + shared * 0.1).toFixed(3),
  );
}

export function computeFamiliarity(counters: FamiliarityCounters, now = Date.now()): FamiliarityState {
  const interactions = Math.max(0, counters.interactions);
  const daysKnown = counters.activeDays.length;
  const score = weighted({
    interactions,
    daysKnown,
    banterTurns: counters.banterTurns,
    corrections: counters.corrections,
    sharedReferences: counters.sharedReferences.length,
  });

  let tier: FamiliarityTier;
  if (interactions < 3 || daysKnown < 1) tier = "new";
  else if (interactions < 12 || daysKnown < 2) tier = "acquainted";
  else if (interactions < 40 || daysKnown < 7) tier = "familiar";
  else if (interactions < 120 || daysKnown < 30) tier = "close";
  else tier = "old-friend";

  // Silence for a long time lowers the temperature without erasing it.
  const idleDays = counters.lastContactAt > 0 ? (now - counters.lastContactAt) / DAY_MS : 0;
  if (idleDays > 60 && tier !== "new") {
    const dropped: Record<FamiliarityTier, FamiliarityTier> = {
      new: "new",
      acquainted: "new",
      familiar: "acquainted",
      close: "familiar",
      "old-friend": "close",
    };
    tier = dropped[tier];
  }

  return {
    score,
    tier,
    interactions,
    daysKnown,
    banterTurns: counters.banterTurns,
    corrections: counters.corrections,
    sharedReferences: counters.sharedReferences.length,
    allows: {
      contractions: tier !== "new",
      shorthand: tier === "familiar" || tier === "close" || tier === "old-friend",
      callbacks: tier === "close" || tier === "old-friend",
      teasing: tier === "close" || tier === "old-friend",
      skipGreeting: tier !== "new",
      // Mirroring the user's own slang needs both long familiarity and
      // the explicit permission recorded on the term itself.
      mirrorUserLingo: tier === "old-friend",
    },
  };
}

/** One line for the voice directive. Concrete, so it changes behaviour. */
export function familiarityLine(state: FamiliarityState): string {
  const facts = `${state.interactions} exchange${state.interactions === 1 ? "" : "s"} across ${state.daysKnown} day${state.daysKnown === 1 ? "" : "s"}`;
  switch (state.tier) {
    case "new":
      return `Familiarity: new (${facts}). Be warm but do not perform closeness you have not earned: no in-jokes, no teasing, no "we both know" phrasing.`;
    case "acquainted":
      return `Familiarity: acquainted (${facts}). Contractions and a normal conversational register are fine. No callbacks yet unless the user makes one first.`;
    case "familiar":
      return `Familiarity: familiar (${facts}). Shorthand is fine. Skip the greeting. You may refer back to earlier work without being reminded.`;
    case "close":
      return `Familiarity: close (${facts}). Dry teasing and callbacks to shared history are allowed. Still no parroting their slang back at them.`;
    default:
      return `Familiarity: old friend (${facts}). Compression is a kindness: shorthand, unfinished sentences, callbacks, gentle ribbing. Never fake a memory you do not have.`;
  }
}
