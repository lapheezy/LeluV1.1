/**
 * ==========================================================
 * LÉLU
 * OBJECTIVE EVIDENCE — what was required, and what was seen
 *
 * The runtime can now check a completion claim (CompletionVerifier)
 * and give an objective its contract before the work starts
 * (OutcomeDerivation → AgentObjectives.create). Both were only
 * visible in a log.
 *
 * That left an honest gap in the one place a person reads about
 * autonomous work: a briefing said "1 action really ran" and,
 * if there happened to be a recorded verdict, "Verified: …". It
 * never said WHAT the objective had to accomplish, whether that
 * requirement was declared or read from its own wording, which
 * parts were never observed, or that a model claimed completion
 * twice and was turned back both times before the work finished.
 *
 * This is that answer, as one projection over state that
 * already exists — the objective, its cycle records, and the
 * tool ids the runtime can really dispatch. It decides nothing:
 * it does not extend a budget, schedule a cycle or change a
 * state. The verifier still says whether the work is done; this
 * says what the verdict was about, in words a person can check.
 *
 * Pure by design — no stores, no registry, no events — so a
 * test can hand it a record and read the answer.
 * ==========================================================
 */

import type { AgentObjective, CognitionCycleRecord, ObjectiveOutcome } from "./AgentObjectives";
import { expectedOutcomesFor, type CompletionResult, type CompletionVerdict } from "./CompletionVerifier";
import { sameTool } from "./OutcomeDerivation";

/**
 * Where the requirements came from.
 *
 *   declared  the caller stated them, so they win verbatim
 *   stated    the objective's own wording names them, and only
 *             operations the runtime can dispatch were taken
 *   none      nothing safe could be derived, so the deliverable
 *             is the answer and it is checked for substance
 *             rather than against a guessed checklist
 */
export type ContractSource = "declared" | "stated" | "none";

/** One requirement, and whether the record shows it. */
export interface ContractItem {
  /** In the outcome's own words, as the verifier phrased it. */
  what: string;
  evidence: ObjectiveOutcome["evidence"];
  tool?: string;
  satisfied: boolean;
  /** It ran, and it failed. An unmet requirement, named differently. */
  failedAttempt: boolean;
}

/** A completion claim, as the verifier judged it. */
export interface VerificationRecord {
  verdict: CompletionVerdict;
  reason: string;
  missing: string[];
}

export interface ObjectiveEvidenceReport {
  objectiveId: string;
  /** Whether the objective's record shows it finished. */
  completed: boolean;
  contractSource: ContractSource;
  contract: ContractItem[];
  /** Requirements the record really shows, in words. */
  observed: string[];
  /** Requirements it does not, in words. */
  missing: string[];
  /** Every verdict recorded for this objective, oldest first. */
  verdicts: VerificationRecord[];
  /** How many times a claimed completion was sent back as incomplete. */
  rejections: number;
  /**
   * Cycles the runtime ran AFTER the first rejection.
   *
   * This is the difference between a rejection and a stall: the
   * verifier refusing a claim is only useful if the work then
   * continued. Zero means the objective stopped when it was
   * turned back, and that is worth seeing.
   */
  continuationsAfterRejection: number;
  /** Tools that really succeeded, unique, in the order first seen. */
  executed: string[];
}

export interface ObjectiveEvidenceInput {
  objective: AgentObjective;
  /** Every recorded cycle for the objective, in any order. */
  cycles: CognitionCycleRecord[];
  /** Executions from a cycle that is not recorded yet (the one ending it). */
  executedNow?: Array<{ tool: string; ok: boolean }>;
  /** A verdict from that same unrecorded cycle. */
  verification?: CompletionResult;
  /** Tool ids the runtime can dispatch — keeps prose from inventing one. */
  knownTools?: string[];
  /**
   * Whether the objective finished. Passed explicitly because the
   * briefing is written from the snapshot taken BEFORE the state
   * moved, and guessing from that snapshot would report a finished
   * objective as still running.
   */
  completed?: boolean;
}

/** Ordered, unique, oldest verdict first — the order the cycles ran. */
function orderedCycles(cycles: CognitionCycleRecord[]): CognitionCycleRecord[] {
  return [...cycles].sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Everything the record proves about this objective's contract.
 *
 * `answer-given` is satisfied by a conclusion that is not merely the
 * claim of completion, which is the same rule the verifier applies —
 * so this cannot report an answered objective as unanswered, or the
 * reverse.
 */
export function objectiveEvidence(input: ObjectiveEvidenceInput): ObjectiveEvidenceReport {
  const { objective } = input;
  const cycles = orderedCycles(input.cycles ?? []);
  const completed = input.completed ?? objective.state === "completed";

  const executed = [
    ...cycles.flatMap((cycle) => cycle.executed ?? []),
    ...(input.executedNow ?? []),
  ];
  const succeeded = executed.filter((entry) => entry.ok).map((entry) => entry.tool);
  const failed = executed.filter((entry) => !entry.ok).map((entry) => entry.tool);
  const uniqueSucceeded = [...new Set(succeeded)];

  const outcomes = expectedOutcomesFor(objective, input.knownTools ?? []);
  const contractSource: ContractSource = objective.expectedOutcomes?.length
    ? "declared"
    : outcomes.length > 0
      ? "stated"
      : "none";

  const contract: ContractItem[] = outcomes.map((outcome) => {
    if (outcome.evidence === "tool-succeeded") {
      const ran = outcome.tool !== undefined && succeeded.some((tool) => sameTool(tool, outcome.tool!));
      const failedAttempt =
        !ran && outcome.tool !== undefined && failed.some((tool) => sameTool(tool, outcome.tool!));
      return {
        what: outcome.what,
        evidence: outcome.evidence,
        ...(outcome.tool !== undefined ? { tool: outcome.tool } : {}),
        satisfied: ran,
        failedAttempt,
      };
    }

    if (outcome.evidence === "user-information") {
      // Only an answer from the user satisfies this, and the runtime
      // records that as the trigger of the cycle the answer woke.
      const answered = cycles.some((cycle) => /question-answered/.test(cycle.trigger ?? ""));
      return { what: outcome.what, evidence: outcome.evidence, satisfied: answered, failedAttempt: false };
    }

    // answer-given: the conclusion itself is the evidence. A completed
    // objective that got here had a conclusion the verifier accepted.
    return { what: outcome.what, evidence: outcome.evidence, satisfied: completed, failedAttempt: false };
  });

  const observed = contract.filter((item) => item.satisfied).map((item) => item.what);
  const missing = contract
    .filter((item) => !item.satisfied)
    .map((item) => (item.failedAttempt ? `${item.what} (it ran and failed)` : item.what));

  // The reasoning-only case has no contract entry, so the evidence of
  // an answer is stated directly rather than left empty.
  if (contractSource === "none" && completed) observed.push("a reasoned answer was given");

  const verdicts: VerificationRecord[] = cycles
    .map((cycle) => cycle.verification)
    .filter((verification): verification is NonNullable<typeof verification> => Boolean(verification))
    .map((verification) => ({
      verdict: verification.verdict,
      reason: verification.reason,
      missing: [...verification.missing],
    }));
  if (input.verification) {
    verdicts.push({
      verdict: input.verification.verdict,
      reason: input.verification.reason,
      missing: [...input.verification.missing],
    });
  }

  const rejections = verdicts.filter((verdict) => verdict.verdict === "incomplete").length;

  // A cycle that STARTED after the first rejection is the continuation
  // the rejection is only worth anything for.
  const firstRejectionAt = cycles.find(
    (cycle) => cycle.verification?.verdict === "incomplete",
  )?.finishedAt;
  const continuationsAfterRejection =
    firstRejectionAt === undefined
      ? 0
      : cycles.filter((cycle) => cycle.startedAt > firstRejectionAt).length;

  return {
    objectiveId: objective.id,
    completed,
    contractSource,
    contract,
    observed,
    missing,
    verdicts,
    rejections,
    continuationsAfterRejection,
    executed: uniqueSucceeded,
  };
}

/**
 * The report as the one paragraph a briefing carries.
 *
 * `missing: false` is for finished work: a completed objective has
 * nothing outstanding by definition, and printing a stale shortfall
 * next to "Finished" would contradict the headline above it.
 */
export function describeEvidence(
  report: ObjectiveEvidenceReport,
  options: { missing?: boolean } = {},
): string {
  const parts: string[] = [];

  if (report.contractSource === "none") {
    parts.push(
      "No outcome contract: this objective's deliverable is its answer, so the answer " +
        "was checked for substance rather than against a guessed checklist.",
    );
    if (report.observed.length > 0) parts.push(`Observed: ${report.observed.join("; ")}.`);
  } else {
    const label =
      report.contractSource === "declared"
        ? "declared by whoever set the objective"
        : "read from the objective's own wording";
    parts.push(`Outcome contract (${label}): ${report.contract.map((item) => item.what).join("; ")}.`);
    if (report.observed.length > 0) parts.push(`Observed: ${report.observed.join("; ")}.`);
    if (options.missing !== false && report.missing.length > 0) {
      parts.push(`Not observed: ${report.missing.join("; ")}.`);
    }
  }

  if (report.rejections > 0) {
    const continued =
      report.continuationsAfterRejection > 0
        ? ` and continued the work for ${report.continuationsAfterRejection} more cycle(s)`
        : ", and no further cycle ran";
    parts.push(
      `The runtime rejected ${report.rejections} premature completion claim${report.rejections === 1 ? "" : "s"}${continued}.`,
    );
  }

  return parts.join(" ");
}
