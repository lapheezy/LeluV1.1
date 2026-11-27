/**
 * ==========================================================
 * LÉLU — SELF-QUESTIONING (WP18.2)
 *
 * Challenges her OWN conclusion before it becomes a claim, from the
 * evidence that actually exists — never from a list of prompts read
 * out in order.
 *
 * Nine checks, each producing a question only when its input exists:
 *
 *   APPROACH          the plan never touches a stated requirement
 *   ASSUMPTION        something is being treated as settled with no check
 *   COUNTER-EVIDENCE  recorded evidence points the other way
 *   EFFICIENCY        a capability that already exists is being rebuilt
 *   OMISSION          a must-have requirement is unaddressed
 *   RELEVANCE         the objective may no longer be live
 *   NEXT-STEP         nothing says what happens after this
 *   INVESTIGATION     the gap needs evidence before it needs code
 *   ALTERNATIVE       an option was raised and never compared
 *
 * Repetition is prevented structurally: each challenge carries a
 * fingerprint of its kind and basis, and one already raised is
 * suppressed. A challenge is not re-asked because time passed; it is
 * re-asked only when its basis changed.
 *
 * `applyRevision()` is the other half. A challenge that survives
 * scrutiny rewrites the conclusion and records the revision, so
 * questioning can actually change her mind instead of decorating it.
 * ==========================================================
 */

import type { Evidence } from "./types";
import { clamp01, fingerprint, overlap, shorten, unique } from "./text";

export type SelfChallengeKind =
  | "approach"
  | "assumption"
  | "counter-evidence"
  | "efficiency"
  | "omission"
  | "relevance"
  | "next-step"
  | "investigation"
  | "alternative";

export interface Assumption {
  text: string;
  /** Has anything actually checked it? */
  verified: boolean;
  evidence?: string;
}

export interface EvidenceItem {
  claim: string;
  stance: "supports" | "contradicts" | "silent";
  source: string;
  detail?: string;
}

export interface RequirementCoverage {
  text: string;
  addressed: boolean;
}

export interface Alternative {
  text: string;
  compared: boolean;
}

export interface SelfInterrogationInput {
  objective: string;
  conclusion: string;
  approach?: string[];
  assumptions?: Assumption[];
  evidence?: EvidenceItem[];
  requirements?: RequirementCoverage[];
  alternatives?: Alternative[];
  /** Recent tool outcomes. `ok:false` is real counter-evidence. */
  recentActions?: Array<{ tool?: string; ok: boolean }>;
  userCorrections?: string[];
  /** How long this objective has been carried. */
  objectiveAgeMs?: number;
  /** null = unknown, not "irrelevant". */
  objectiveStillRelevant?: boolean | null;
  nextStepDefined?: boolean;
  /** Existing capabilities whose names overlap the approach. */
  existingCapabilityFor?: string[];
  /** Fingerprints already raised in this thread. */
  dedupe?: string[];
  now?: number;
}

export interface SelfChallenge {
  id: string;
  kind: SelfChallengeKind;
  question: string;
  /** What changes if this challenge is upheld. */
  correction: string;
  basis: Evidence[];
  /** 0..1. High severity should stop a claim being made unchanged. */
  severity: number;
  fingerprint: string;
  disposition: "open" | "upheld" | "dismissed" | "addressed";
}

export interface SelfInterrogationResult {
  challenges: SelfChallenge[];
  /** How many checks had enough input to run. */
  considered: number;
  suppressed: string[];
  /** True when nothing found was serious enough to block the conclusion. */
  conclusionHeld: boolean;
  modelCalls: 0;
}

const CLAIM_WORDS = /\b(done|complete|completed|fixed|works|working|verified|shipped|built|implemented|finished|solved)\b/i;

export function interrogate(input: SelfInterrogationInput): SelfInterrogationResult {
  const challenges: SelfChallenge[] = [];
  const suppressed: string[] = [];
  const known = new Set(input.dedupe ?? []);
  const seen = new Set<string>();
  let considered = 0;

  const add = (
    kind: SelfChallengeKind,
    question: string,
    correction: string,
    basis: Evidence[],
    severity: number,
  ): void => {
    const print = fingerprint("challenge", kind, ...basis.map((item) => item.detail || item.source), question);
    if (known.has(print) || seen.has(print)) {
      suppressed.push(print);
      return;
    }
    seen.add(print);
    challenges.push({
      id: print,
      kind,
      question,
      correction,
      basis,
      severity: clamp01(severity),
      fingerprint: print,
      disposition: "open",
    });
  };

  const evidence = input.evidence ?? [];
  const supports = evidence.filter((item) => item.stance === "supports");
  const contradicts = evidence.filter((item) => item.stance === "contradicts");
  const actions = input.recentActions ?? [];
  const requirements = input.requirements ?? [];
  const unmet = requirements.filter((requirement) => !requirement.addressed);

  /* 1. Is a success claim actually supported? */
  considered += 1;
  if (CLAIM_WORDS.test(input.conclusion) && supports.length === 0 && actions.every((action) => !action.ok)) {
    add(
      "investigation",
      "Am I claiming this is done without a single piece of verified evidence?",
      `Withdraw the completion claim about “${shorten(input.objective, 80)}” until something observable confirms it`,
      [
        { source: "conclusion", detail: shorten(input.conclusion, 120) },
        {
          source: "evidence",
          detail:
            actions.length > 0
              ? `${actions.length} recent action(s), none succeeded`
              : "no verified evidence was recorded",
        },
      ],
      0.9,
    );
  }

  /* 2. Is there evidence against the conclusion? */
  considered += 1;
  for (const item of contradicts.slice(0, 2)) {
    add(
      "counter-evidence",
      `“${shorten(item.detail ?? item.claim, 100)}” cuts against “${shorten(input.conclusion, 80)}”. Which is right?`,
      `Revise the conclusion to account for ${item.source}: ${shorten(item.detail ?? item.claim, 100)}`,
      [{ source: item.source, detail: item.detail ?? item.claim }],
      0.85,
    );
  }

  /* 3. Unverified assumptions. */
  for (const assumption of input.assumptions ?? []) {
    considered += 1;
    if (assumption.verified) continue;
    add(
      "assumption",
      `I am treating “${shorten(assumption.text, 90)}” as settled, but nothing recorded verifies it. What would show it is wrong?`,
      `Treat “${shorten(assumption.text, 90)}” as unverified until it is checked`,
      [
        { source: "assumption", detail: assumption.text },
        ...(assumption.evidence
          ? [{ source: "partial-evidence", detail: assumption.evidence }]
          : [{ source: "evidence", detail: "no verification recorded" }]),
      ],
      0.62,
    );
  }

  /* 4. Does the approach touch what was asked for? */
  considered += 1;
  const approach = input.approach ?? [];
  if (approach.length > 0 && unmet.length > 0) {
    add(
      "approach",
      `The approach never addresses “${shorten(unmet[0]!.text, 80)}”. Is this the right approach for it?`,
      `Add a step that addresses “${shorten(unmet[0]!.text, 80)}”`,
      [
        { source: "approach", detail: approach.join(" → ") },
        { source: "requirement", detail: unmet[0]!.text },
      ],
      0.6,
    );
  }

  /* 5. Is something already built being built again? */
  for (const step of approach) {
    considered += 1;
    const duplicate = (input.existingCapabilityFor ?? []).find(
      (capability) => overlap(capability, step) >= 2,
    );
    if (!duplicate) continue;
    add(
      "efficiency",
      `“${duplicate}” already exists in this environment. Would rebuilding it in “${shorten(step, 70)}” add anything?`,
      `Reuse “${duplicate}” instead of rebuilding it inside “${shorten(step, 70)}”`,
      [
        { source: "existing-capability", detail: duplicate },
        { source: "approach", detail: step },
      ],
      0.5,
    );
    break;
  }

  /* 6. Requirements left unaddressed. */
  for (const requirement of unmet.slice(0, 2)) {
    considered += 1;
    add(
      "omission",
      `“${shorten(requirement.text, 90)}” was required and is not addressed. What have I overlooked?`,
      `Address “${shorten(requirement.text, 90)}” before calling this complete`,
      [{ source: "requirement", detail: requirement.text }],
      0.7,
    );
  }

  /* 7. Is the objective still live? */
  considered += 1;
  if (input.objectiveStillRelevant === false) {
    add(
      "relevance",
      "The user has moved on from this objective. Should it still be advanced?",
      `Treat “${shorten(input.objective, 80)}” as stale and ask before spending more on it`,
      [{ source: "objective", detail: `${Math.round((input.objectiveAgeMs ?? 0) / 3_600_000)}h old; the conversation has moved on` }],
      0.55,
    );
  } else if (
    input.objectiveStillRelevant === null &&
    (input.objectiveAgeMs ?? 0) > 7 * 24 * 3_600_000
  ) {
    add(
      "relevance",
      "This objective is over a week old and nothing recently confirmed it is still wanted. Is it still relevant?",
      `Confirm “${shorten(input.objective, 80)}” is still wanted before continuing`,
      [{ source: "objective", detail: `carried for ${Math.round((input.objectiveAgeMs ?? 0) / 86_400_000)} days` }],
      0.4,
    );
  }

  /* 8. What happens next? */
  considered += 1;
  if (input.nextStepDefined === false) {
    add(
      "next-step",
      "Nothing names what happens after this. What should happen next?",
      "Name the next step, or record that there is none",
      [{ source: "plan", detail: "no next step recorded" }],
      0.4,
    );
  }

  /* 9. Was an alternative ever compared? */
  considered += 1;
  const uncompared = (input.alternatives ?? []).filter((alternative) => !alternative.compared);
  if (uncompared.length > 0) {
    add(
      "alternative",
      `“${shorten(uncompared[0]!.text, 80)}” was raised but never compared. Is the current direction still the better one?`,
      `Compare against “${shorten(uncompared[0]!.text, 80)}” or record why it was set aside`,
      [{ source: "alternative", detail: uncompared[0]!.text }],
      0.35,
    );
  }

  const corrections = unique(input.userCorrections ?? []);
  if (corrections.length > 0) {
    considered += 1;
    add(
      "assumption",
      `The user corrected: “${shorten(corrections[0]!, 90)}”. Which of my assumptions does that change?`,
      `Revise the assumption behind “${shorten(input.conclusion, 70)}” in light of the correction`,
      [{ source: "user-correction", detail: corrections[0]! }],
      0.65,
    );
  }

  challenges.sort((a, b) => b.severity - a.severity);
  const capped = challenges.slice(0, 6);
  return {
    challenges: capped,
    considered,
    suppressed,
    conclusionHeld: capped.every((challenge) => challenge.severity < 0.6),
    modelCalls: 0,
  };
}

/* ------------------------------------------------------------------ *
 * REVISING THE CONCLUSION
 * ------------------------------------------------------------------ */

export interface ChallengeDecision {
  challengeId: string;
  verdict: "upheld" | "dismissed";
  /** The evidence or reasoning that settled it. */
  reason: string;
}

export interface Revision {
  at: number;
  from: string;
  to: string;
  because: string[];
  challengeIds: string[];
}

export interface RevisionResult {
  conclusion: string;
  revision: Revision | null;
  upheld: SelfChallenge[];
  dismissed: SelfChallenge[];
}

/**
 * Apply the outcomes of scrutiny.
 *
 * Dismissals are kept: a challenge that was answered is evidence the
 * conclusion survived, which is different from never having asked.
 */
export function applyRevision(
  original: string,
  challenges: SelfChallenge[],
  decisions: ChallengeDecision[],
  at = Date.now(),
): RevisionResult {
  const byId = new Map(challenges.map((challenge) => [challenge.id, challenge]));
  const upheld: SelfChallenge[] = [];
  const dismissed: SelfChallenge[] = [];
  for (const decision of decisions) {
    const challenge = byId.get(decision.challengeId);
    if (!challenge) continue;
    challenge.disposition = decision.verdict === "upheld" ? "upheld" : "dismissed";
    if (decision.verdict === "upheld") upheld.push(challenge);
    else dismissed.push(challenge);
  }
  if (upheld.length === 0) {
    return { conclusion: original, revision: null, upheld, dismissed };
  }
  const because = upheld.map((challenge) => challenge.correction);
  const revised = `${original}\nRevision (${new Date(at).toISOString().slice(0, 10)}): ${because.join("; ")}.`;
  return {
    conclusion: revised,
    revision: {
      at,
      from: original,
      to: revised,
      because,
      challengeIds: upheld.map((challenge) => challenge.id),
    },
    upheld,
    dismissed,
  };
}

/** A compact account for her own context. */
export function describeChallenges(challenges: SelfChallenge[]): string {
  if (challenges.length === 0) return "No unresolved challenge to the current direction.";
  return challenges
    .slice(0, 3)
    .map((challenge) => `[${challenge.kind}] ${challenge.question}`)
    .join(" ");
}
