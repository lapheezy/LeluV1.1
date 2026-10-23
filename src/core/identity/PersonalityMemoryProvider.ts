/**
 * ==========================================================
 * LÉLU — PERSONALITY MEMORY PROVIDER
 *
 * Supplies relevant identity context at band 4 (persistent
 * LÉLU memory). Compact — 2-4 sentences max — so it never
 * crowds out higher-priority context.
 *
 * Also extracts personality signals from persisted candidates
 * and records them in the DailyRecord.
 * ==========================================================
 */

import type { MemoryProvider, ContextItem, MemoryCandidate } from "../memory/MemoryProvider";
import LeluIdentity from "./LeluIdentity";
import DailyRecord from "./DailyRecord";

const PERSONALITY_SIGNALS = [
  { field: "observations" as const, keywords: ["noticed", "observed", "realized", "recognized"] },
  { field: "lessons" as const, keywords: ["learned", "understood", "discovered", "found"] },
  { field: "questions" as const, keywords: ["wondering", "curious", "what if", "why", "how"] },
  { field: "creativeIdeas" as const, keywords: ["idea", "could", "imagine", "create", "build", "design"] },
];

export default class PersonalityMemoryProvider implements MemoryProvider {
  readonly id = "personality";

  isAvailable(): boolean {
    return true;
  }

  async context(query: string, _limit: number): Promise<ContextItem[]> {
    try {
      const identity = LeluIdentity.getInstance();
      const state = identity.getState();
      const relevant = identity.getRelevantTraits(query);

      const valueSummary = state.coreValues.slice(0, 4).join(", ");

      let traitLine = "";
      if (relevant.length > 0) {
        const traitParts = relevant.map((t) => `${t.name.toLowerCase()} (${t.status})`);
        traitLine = `Active traits: ${traitParts.join(", ")}.`;
      } else {
        const active = state.traits.filter(
          (t) => t.status === "established" || t.status === "emerging",
        ).slice(0, 3);
        if (active.length > 0) {
          const traitParts = active.map((t) => `${t.name.toLowerCase()} (${t.status})`);
          traitLine = `Active traits: ${traitParts.join(", ")}.`;
        }
      }

      const curiosityLine = state.curiosities.length > 0
        ? `Current curiosity: ${state.curiosities[state.curiosities.length - 1]}.`
        : "";

      const lines = [
        `[LÉLU Identity] Values: ${valueSummary}.`,
        traitLine,
        `Voice: ${state.communicationStyle}.`,
        curiosityLine,
      ].filter(Boolean);

      const content = lines.join(" ");

      return [{
        source: "personality",
        content,
        band: 4,
        relevance: relevant.length > 0 ? 0.7 : 0.4,
      }];
    } catch {
      return [];
    }
  }

  async persist(candidate: MemoryCandidate): Promise<void> {
    try {
      const daily = DailyRecord.getInstance();
      const combinedText = `${candidate.prompt} ${candidate.response}`.toLowerCase();

      for (const { field, keywords } of PERSONALITY_SIGNALS) {
        const matchedKeyword = keywords.find((kw) => combinedText.includes(kw));
        if (matchedKeyword) {
          // Extract the sentence containing the keyword from the response
          const sentences = candidate.response.split(/[.!?]+/).filter((s) => s.trim().length > 10);
          const matching = sentences.find((s) => s.toLowerCase().includes(matchedKeyword));
          if (matching) {
            daily.appendToday(field, matching.trim().slice(0, 200));
          }
        }
      }
    } catch {
      // Personality extraction must never fail a memory persist operation
    }
  }
}
