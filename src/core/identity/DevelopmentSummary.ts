/**
 * ==========================================================
 * LÉLU — DEVELOPMENT SUMMARY
 *
 * Answers "what did I learn / pursue / fail at / discover /
 * change my mind about today?" strictly from the day's record.
 * Pure: it reads lines that real systems wrote and invents
 * nothing. An empty day summarises as empty.
 * ==========================================================
 */

import type { LeluDailyRecord } from "./DailyRecord";

export interface DevelopmentSummary {
  date: string;
  learned: string[];
  pursued: string[];
  failed: string[];
  discovered: string[];
  assumptionsChanged: string[];
  capabilitiesDiscovered: string[];
  gotBetterAt: string[];
  unresolved: string[];
  emergingPatterns: string[];
  proposals: string[];
  empty: boolean;
}

const strip = (line: string, prefix: string) => line.slice(prefix.length).trim();
const withPrefix = (lines: string[], prefix: string) => lines.filter((line) => line.startsWith(prefix)).map((line) => strip(line, prefix));

export function summarizeDevelopment(record: LeluDailyRecord): DevelopmentSummary {
  const lessons = withPrefix(record.lessons, "Curiosity —");
  const assumptionsChanged = withPrefix(record.lessons, "Assumption changed:");
  const strategies = withPrefix(record.lessons, "Strategy:");
  const pursued = [...withPrefix(record.experiences, "Curiosity — looked into:"), ...withPrefix(record.questions, "Asked Heru:").map((q) => `asked Heru: ${q}`)];
  const rechecked = withPrefix(record.experiences, "Re-checked:");
  const unresolved = withPrefix(record.questions, "Unresolved:");
  const traitChanges = [...record.traitChanges, ...(record.reflection?.traitChanges ?? [])];
  const gotBetterAt = [
    ...new Set(
      traitChanges
        .filter((change) => change.newConfidence > change.previousConfidence || change.newStatus !== change.previousStatus)
        .map((change) => `${change.traitName}: ${change.previousStatus} → ${change.newStatus} (${change.previousConfidence.toFixed(2)} → ${change.newConfidence.toFixed(2)})`),
    ),
  ];
  const evidence = [...new Set((record.developmentalEvidence ?? []).map((item) => item.traitId))];
  const emergingPatterns = [
    ...(record.reflection?.observations ?? []).filter((line) => line.startsWith("Pattern:")),
    ...evidence.map((traitId) => `evidence for ${traitId} awaiting reflection`).filter(() => !record.reflection),
  ];
  const summary: DevelopmentSummary = {
    date: record.date,
    learned: lessons,
    pursued,
    failed: unresolved,
    discovered: [...strategies, ...lessons.filter((line) => /available again|can stand in|can provide/i.test(line))],
    assumptionsChanged,
    capabilitiesDiscovered: strategies,
    gotBetterAt,
    unresolved,
    emergingPatterns,
    proposals: withPrefix(record.tomorrowFocus, "Proposed:"),
    empty: false,
  };
  summary.empty = [summary.learned, summary.pursued, summary.failed, summary.assumptionsChanged, summary.capabilitiesDiscovered, summary.gotBetterAt, summary.emergingPatterns, rechecked].every(
    (list) => list.length === 0,
  );
  return summary;
}

/** Compact prose for the chat context. Empty days say so. */
export function describeDevelopment(summary: DevelopmentSummary): string {
  if (summary.empty) return `[LÉLU development ${summary.date}] No meaningful development recorded.`;
  const part = (label: string, items: string[]) => (items.length > 0 ? `${label}: ${items.slice(0, 3).join("; ")}.` : "");
  return [
    `[LÉLU development ${summary.date}]`,
    part("Learned", summary.learned),
    part("Pursued", summary.pursued),
    part("Assumptions changed", summary.assumptionsChanged),
    part("Capabilities discovered", summary.capabilitiesDiscovered),
    part("Unresolved", summary.unresolved),
    part("Developing", [...summary.gotBetterAt, ...summary.emergingPatterns]),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);
}
