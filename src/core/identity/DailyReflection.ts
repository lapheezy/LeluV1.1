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
 *
 * runDueReflections() is the lifecycle entry point: CognitiveLoop
 * calls it each cycle, and it reflects each COMPLETED day exactly
 * once. Evidence counts only behaviour LÉLU's own systems observed:
 * structured evidence (one vote per line of inquiry, capped per
 * trait), plus keyword patterns over text that is neither intake
 * (documents she read) nor already accounted for structurally.
 * ==========================================================
 */

import LeluIdentity, { type IdentitySnapshot, type TraitChange } from "./LeluIdentity";
import DailyRecord, { isAccountedOrIntake, type LeluDailyRecord } from "./DailyRecord";

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
  /** False when nothing in the day amounts to development. A valid outcome. */
  meaningful: boolean;
}

/** Bounded votes: at most this many evidence items per trait per day. */
export const MAX_EVIDENCE_PER_TRAIT_PER_DAY = 3;
export const NOTHING_DETECTED = "No meaningful development detected.";

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
  ]
    .filter((line) => !isAccountedOrIntake(line))
    .join(" ")
    .toLowerCase();
}

const TRAIT_NAMES: Record<string, string> = Object.fromEntries(TRAIT_PATTERNS.map((p) => [p.traitId, p.traitName]));

export function reflectOnDay(record: LeluDailyRecord): ReflectionResult {
  const fullText = textFromRecord(record);
  const observations: string[] = [];
  const candidateTraitChanges: CandidateTraitChange[] = [];
  const newCuriosities: string[] = [];
  const newRelationshipObservations: string[] = [];

  // Structured evidence: one vote per (trait, line of inquiry), capped.
  const seen = new Set<string>();
  const byTrait = new Map<string, Array<{ unitId: string; observation: string }>>();
  for (const item of record.developmentalEvidence ?? []) {
    const key = `${item.traitId}::${item.unitId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byTrait.set(item.traitId, [...(byTrait.get(item.traitId) ?? []), { unitId: item.unitId, observation: item.observation }]);
  }
  for (const [traitId, units] of byTrait) {
    const name = TRAIT_NAMES[traitId] ?? traitId;
    for (const unit of units.slice(0, MAX_EVIDENCE_PER_TRAIT_PER_DAY)) {
      candidateTraitChanges.push({ traitId, traitName: name, evidence: `Observed behaviour (${record.date}): ${unit.observation}`, isContrarian: false });
    }
    observations.push(
      units.length >= 2
        ? `Pattern: ${units.length} separate lines of inquiry showed ${name.toLowerCase()}`
        : `Evidence for ${name} observed`,
    );
  }

  const hasContent =
    fullText.trim().length > 0;

  if (hasContent) {
    for (const pattern of TRAIT_PATTERNS) {
      // A trait already evidenced by observed behaviour today does not get
      // a second, narrative vote for the same day.
      if (byTrait.has(pattern.traitId)) continue;
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
  }

  // Questions LÉLU's curiosity already carries live in its own ledger;
  // intake text is someone else's words. Neither becomes an identity curiosity.
  for (const question of record.questions) {
    if (!isAccountedOrIntake(question) && question.length > 10 && question.length < 120) {
      newCuriosities.push(question);
    }
  }
  for (const obs of record.relationshipObservations) {
    if (!isAccountedOrIntake(obs)) newRelationshipObservations.push(obs);
  }

  const meaningful = candidateTraitChanges.length > 0 || newCuriosities.length > 0 || newRelationshipObservations.length > 0;
  if (!meaningful) observations.push(NOTHING_DETECTED);

  return {
    date: record.date,
    observations,
    candidateTraitChanges,
    newCuriosities,
    newRelationshipObservations,
    meaningful,
  };
}

export interface AppliedReflection {
  traitChanges: TraitChange[];
  staged: number;
}

export function applyReflection(result: ReflectionResult, sandboxMode = false): AppliedReflection {
  const identity = LeluIdentity.getInstance();

  // Questions are not identity changes, so they are recorded in both modes.
  // (Staging them used the "preference" kind, which would have stored a
  // question as one of LÉLU's preferences once approved.)
  for (const curiosity of result.newCuriosities) {
    identity.addCuriosity(curiosity);
  }

  if (sandboxMode) {
    for (const change of result.candidateTraitChanges) {
      identity.stageSandboxChange({
        kind: "trait-update",
        description: `Reflection: ${change.traitName} — ${change.evidence}`,
        proposedAt: Date.now(),
        evidence: change.evidence,
        payload: { traitId: change.traitId, isContrarian: change.isContrarian },
      });
    }
    return { traitChanges: [], staged: result.candidateTraitChanges.length };
  }

  // Capture the BEFORE state so the snapshot records an actual change.
  const before = new Map(
    result.candidateTraitChanges.map((c) => {
      const trait = identity.getTrait(c.traitId);
      return [c.traitId, { confidence: trait?.confidence ?? 0, status: trait?.status ?? "candidate" }] as const;
    }),
  );
  for (const change of result.candidateTraitChanges) {
    identity.addTraitObservation(change.traitId, change.evidence, change.isContrarian);
  }
  for (const obs of result.newRelationshipObservations) {
    identity.addRelationshipObservation("interactionPatterns", obs);
  }

  const traitChanges: TraitChange[] = [...before.entries()].map(([traitId, previous]) => {
    const trait = identity.getTrait(traitId);
    const reasons = result.candidateTraitChanges.filter((c) => c.traitId === traitId).map((c) => c.evidence);
    return {
      traitId,
      traitName: trait?.name ?? traitId,
      previousConfidence: previous.confidence,
      newConfidence: trait?.confidence ?? previous.confidence,
      previousStatus: previous.status,
      newStatus: trait?.status ?? previous.status,
      reason: reasons.join(" | ").slice(0, 300),
    };
  });
  if (traitChanges.length > 0) {
    identity.takeSnapshot(`Daily reflection: ${result.observations.length} observation(s) on ${result.date}`, traitChanges);
  }
  return { traitChanges, staged: 0 };
}

export interface ReflectionRun {
  date: string;
  meaningful: boolean;
  observations: string[];
  traitChanges: TraitChange[];
  staged: number;
}

/**
 * The daily development boundary. Reflects every completed, unreflected
 * day (bounded to the last week, at most three per call), each exactly
 * once. An empty day is recorded as "No meaningful development detected."
 * and nothing is applied.
 */
export function runDueReflections(now = Date.now()): ReflectionRun[] {
  const daily = DailyRecord.getInstance();
  const identity = LeluIdentity.getInstance();
  const runs: ReflectionRun[] = [];
  for (const record of daily.awaitingReflection(now).slice(0, 3)) {
    const result = reflectOnDay(record);
    const applied = result.meaningful ? applyReflection(result, identity.getState().sandboxMode) : { traitChanges: [], staged: 0 };
    for (const change of applied.traitChanges) {
      if (change.previousStatus !== change.newStatus) daily.appendTraitChange(change);
    }
    daily.markReflected(record.date, {
      at: now,
      meaningful: result.meaningful,
      observations: result.observations,
      traitChanges: applied.traitChanges,
      staged: applied.staged,
    });
    runs.push({ date: record.date, meaningful: result.meaningful, observations: result.observations, ...applied });
  }
  return runs;
}
