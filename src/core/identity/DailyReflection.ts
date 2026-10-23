/**
 * ==========================================================
 * LÉLU — DAILY REFLECTION
 *
 * Pattern-matching analysis of the daily record. No LLM call,
 * no second runtime — pure logic based on what was observed.
 *
 * reflectOnDay() analyzes text patterns in the day's record.
 * applyReflection() writes the results back to LeluIdentity.
 * If sandboxMode is true, changes are staged for review.
 * ==========================================================
 */

import LeluIdentity, { type IdentitySnapshot, type TraitChange } from "./LeluIdentity";
import type { LeluDailyRecord } from "./DailyRecord";

export interface CandidateTraitChange {
  traitId: string;
  traitName: string;
  evidence: string;
  isContrarian: boolean;
}

export interface ReflectionResult {
  date: string;
  observations: string[];
  candidateTraitChanges: CandidateTraitChange[];
  newCuriosities: string[];
  newRelationshipObservations: string[];
  snapshot?: IdentitySnapshot;
}

// Keyword patterns for each trait dimension
const TRAIT_PATTERNS: Array<{
  traitId: string;
  traitName: string;
  keywords: string[];
  contrarianKeywords: string[];
}> = [
  {
    traitId: "curiosity",
    traitName: "Curiosity",
    keywords: ["curious", "explored", "experiment", "wondering", "investigate", "fascinated", "discovered"],
    contrarianKeywords: ["avoided exploring", "dismissed", "uninterested"],
  },
  {
    traitId: "synthesis",
    traitName: "Synthesis",
    keywords: ["synthesized", "connected", "organized", "integrated", "combined", "unified", "linked"],
    contrarianKeywords: ["fragmented", "disconnected", "scattered"],
  },
  {
    traitId: "constructive-challenge",
    traitName: "Constructive Challenge",
    keywords: ["challenged", "questioned", "pushed back", "reframed", "reconsidered", "scrutinized"],
    contrarianKeywords: ["agreed without question", "accepted uncritically"],
  },
  {
    traitId: "playfulness",
    traitName: "Playfulness",
    keywords: ["playful", "humor", "laughed", "enjoyed", "light", "creative", "imaginative"],
    contrarianKeywords: ["rigid", "serious only", "humorless"],
  },
  {
    traitId: "pattern-recognition",
    traitName: "Pattern Recognition",
    keywords: ["pattern", "recurring", "noticed", "structure", "theme", "repeated"],
    contrarianKeywords: ["missed the pattern", "failed to notice"],
  },
  {
    traitId: "patience",
    traitName: "Patience",
    keywords: ["patient", "sustained", "long arc", "persisted", "continued", "careful"],
    contrarianKeywords: ["rushed", "impatient", "skipped"],
  },
];

function textFromRecord(record: LeluDailyRecord): string {
  return [
    ...record.observations,
    ...record.experiences,
    ...record.meaningfulInteractions,
    ...record.selfReflection,
    ...record.lessons,
  ].join(" ").toLowerCase();
}

export function reflectOnDay(record: LeluDailyRecord): ReflectionResult {
  const fullText = textFromRecord(record);
  const observations: string[] = [];
  const candidateTraitChanges: CandidateTraitChange[] = [];
  const newCuriosities: string[] = [];
  const newRelationshipObservations: string[] = [];

  // Only run reflection if there are at least 2 observations to work with
  const hasContent = record.observations.length > 0 ||
    record.experiences.length > 0 ||
    record.meaningfulInteractions.length > 0;

  if (hasContent) {
    // Check each trait pattern
    for (const pattern of TRAIT_PATTERNS) {
      const supportHit = pattern.keywords.some((kw) => fullText.includes(kw));
      const contrarianHit = pattern.contrarianKeywords.some((kw) => fullText.includes(kw));

      if (supportHit) {
        const matchedKeyword = pattern.keywords.find((kw) => fullText.includes(kw)) ?? pattern.keywords[0];
        candidateTraitChanges.push({
          traitId: pattern.traitId,
          traitName: pattern.traitName,
          evidence: `Observed in daily record: "${matchedKeyword}" (${record.date})`,
          isContrarian: false,
        });
        observations.push(`Evidence for ${pattern.traitName} observed`);
      } else if (contrarianHit) {
        const matchedKeyword = pattern.contrarianKeywords.find((kw) => fullText.includes(kw)) ?? pattern.contrarianKeywords[0];
        candidateTraitChanges.push({
          traitId: pattern.traitId,
          traitName: pattern.traitName,
          evidence: `Contrarian evidence: "${matchedKeyword}" (${record.date})`,
          isContrarian: true,
        });
        observations.push(`Contrarian evidence for ${pattern.traitName} noted`);
      }
    }

    // Extract questions as curiosities
    for (const question of record.questions) {
      if (question.length > 10 && question.length < 120) {
        newCuriosities.push(question);
      }
    }

    // Collect relationship observations
    for (const obs of record.relationshipObservations) {
      newRelationshipObservations.push(obs);
    }
  }

  return {
    date: record.date,
    observations,
    candidateTraitChanges,
    newCuriosities,
    newRelationshipObservations,
  };
}

export function applyReflection(result: ReflectionResult, sandboxMode = false): void {
  const identity = LeluIdentity.getInstance();

  if (sandboxMode) {
    // Stage changes rather than applying directly
    for (const change of result.candidateTraitChanges) {
      identity.stageSandboxChange({
        kind: "trait-update",
        description: `Reflection: ${change.traitName} — ${change.evidence}`,
        proposedAt: Date.now(),
        evidence: change.evidence,
        payload: { traitId: change.traitId, isContrarian: change.isContrarian },
      });
    }
    for (const curiosity of result.newCuriosities) {
      identity.stageSandboxChange({
        kind: "preference",
        description: `New curiosity from reflection: ${curiosity.slice(0, 60)}`,
        proposedAt: Date.now(),
        evidence: curiosity,
        payload: { text: curiosity },
      });
    }
  } else {
    // Apply directly
    for (const change of result.candidateTraitChanges) {
      identity.addTraitObservation(change.traitId, change.evidence, change.isContrarian);
    }
    for (const curiosity of result.newCuriosities) {
      identity.addCuriosity(curiosity);
    }
    for (const obs of result.newRelationshipObservations) {
      identity.addRelationshipObservation("interactionPatterns", obs);
    }

    // Take a snapshot if there were any changes
    if (result.candidateTraitChanges.length > 0) {
      const traitChanges: TraitChange[] = result.candidateTraitChanges.map((c) => {
        const trait = identity.getTrait(c.traitId);
        return {
          traitId: c.traitId,
          traitName: c.traitName,
          previousConfidence: trait?.confidence ?? 0,
          newConfidence: trait?.confidence ?? 0,
          previousStatus: trait?.status ?? "candidate",
          newStatus: trait?.status ?? "candidate",
          reason: c.evidence,
        };
      });
      identity.takeSnapshot(
        `Daily reflection: ${result.observations.length} observation(s) on ${result.date}`,
        traitChanges,
      );
    }
  }
}
