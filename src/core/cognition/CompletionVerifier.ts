/**
 * ==========================================================
 * LÉLU
 * COMPLETION VERIFIER — "DONE:" is a claim, not evidence
 *
 * AgentCognitionRuntime used to complete an objective the
 * moment the model's reply started with DONE:. Nothing
 * checked the claim against what had actually happened, so a
 * three-operation objective could finish after one of them —
 * which is exactly what the live end-to-end test caught a real
 * model doing: workflow_list, then DONE.
 *
 * This answers ONE question: is this objective satisfied?
 *
 * It does NOT decide what happens next. Retrying, replanning,
 * asking, yielding and giving up are the runtime's business and
 * stay there — mixing them in here would make a second
 * executor out of a predicate.
 *
 * WHAT IT REFUSES TO USE AS EVIDENCE
 *   • the model saying DONE
 *   • the model's prose about what it did
 *   • "some tool ran", or any fixed number of tools
 *   • the last tool call having succeeded
 *
 * WHAT IT USES
 *   • the objective's expected outcomes, when declared
 *   • tool names the objective itself states, when not
 *   • successful executions recorded across EVERY cycle of the
 *     objective, not just the one that said DONE
 *   • tools the model asked for that never reached the
 *     dispatcher
 *
 * Objectives that are genuinely answerable by reasoning are
 * not turned into tool checklists: with nothing to execute,
 * the conclusion itself is the evidence, and the only thing
 * that can fail is a claim contradicted by the record.
 * ==========================================================
 */

import type { AgentObjective, CognitionCycleRecord, ObjectiveOutcome } from "./AgentObjectives";
// One definition of what "done" means, shared with whoever creates the
// objective — see OutcomeDerivation.
import { deriveOutcomes, sameTool } from "./OutcomeDerivation";

export type CompletionVerdict = "complete" | "incomplete" | "blocked";

export interface CompletionResult {
  verdict: CompletionVerdict;
  /** One line a person can act on, and the runtime can hand the model. */
  reason: string;
  /** Outcomes that really are satisfied, in words. */
  observed: string[];
  /** Outcomes that are not, in words. */
  missing: string[];
}

export interface CompletionInput {
  objective: AgentObjective;
  /**
   * Every cycle recorded for this objective, in any order.
   *
   * The cycle that says DONE is usually the one that executed
   * nothing — the model is told to take no action when concluding —
   * so looking at it alone would reject every multi-cycle objective
   * that genuinely finished.
   */
  cycles: CognitionCycleRecord[];
  /** This cycle's executions, which are not in `cycles` yet. */
  executedNow?: Array<{ tool: string; ok: boolean }>;
  /** This cycle's tool requests, likewise. */
  requestedNow?: string[];
  /** The model's conclusion, with the DONE: prefix already removed. */
  conclusion: string;
}

/**
 * A conclusion that restates "done" and says nothing else.
 *
 * Only consulted for objectives with nothing to execute, where the
 * conclusion IS the deliverable. "Done." is not an answer to anything.
 *
 * Deliberately a short closed list rather than a minimum length: the
 * first version of this required 24 characters, and rejected "nothing
 * needed doing." — a complete and correct answer to "decide whether
 * anything needs doing". Length measures the wrong thing. What makes a
 * conclusion empty is that it carries no content beyond the claim of
 * completion itself.
 */
const ACKNOWLEDGEMENT = /^(done|ok|okay|complete|completed|finished|finished it|yes|all done)$/i;

function isVacuous(conclusion: string): boolean {
  const bare = conclusion.trim().replace(/[.!…\s]+$/g, "").trim();
  return bare.length === 0 || ACKNOWLEDGEMENT.test(bare);
}

/**
 * The outcomes this objective will be judged against.
 *
 * The decision itself lives in OutcomeDerivation — one place that
 * decides what "done" means, so an objective created by cognition and
 * one checked here can never disagree about it. This is the verifier's
 * entry point into that contract: declared outcomes win; otherwise tool
 * ids the objective states are taken as required ("check with
 * workflow_list, create it with workflow_author, then run it with
 * workflow_run" has stated its own requirements, and taking it at its
 * word needs no model); and a mention the goal RULES OUT ("do not use
 * memory_store") is not a requirement.
 *
 * `knownTools` keeps that honest: only names the runtime can actually
 * dispatch are treated as requirements, so prose that merely looks
 * tool-shaped cannot invent one.
 */
export function expectedOutcomesFor(
  objective: AgentObjective,
  knownTools: string[],
): ObjectiveOutcome[] {
  return deriveOutcomes({
    objective: objective.objective,
    declared: objective.expectedOutcomes,
    knownTools,
  });
}

/**
 * Is this objective satisfied?
 *
 * Returns "blocked" only for outcomes nothing LÉLU can do will supply,
 * so the runtime can take its existing question path rather than
 * spending more cycles on something that cannot move.
 */
export function verifyCompletion(input: CompletionInput, knownTools: string[] = []): CompletionResult {
  const { objective, conclusion } = input;

  // EVERY cycle's executions, plus the one not recorded yet.
  const executed = [
    ...input.cycles.flatMap((cycle) => cycle.executed ?? []),
    ...(input.executedNow ?? []),
  ];
  const succeeded = executed.filter((entry) => entry.ok).map((entry) => entry.tool);
  const failed = executed.filter((entry) => !entry.ok).map((entry) => entry.tool);

  // A TOOL THE MODEL ASKED FOR THIS CYCLE THAT NEVER RAN.
  //
  // Scoped to the CURRENT cycle only. Aggregating historical cycles'
  // requested lists against the combined execution pool creates a
  // cross-cycle trap: a tool requested in cycle 1 and somehow not
  // dispatched then (impossible on the native path, but possible in
  // tests) would poison every later completion check, even after the
  // objective had done real work for cycles. The unexecuted check is
  // a claim-vs-evidence test for THIS decision, not an audit of history.
  const unexecuted = [...new Set(input.requestedNow ?? [])].filter(
    (tool) => !(input.executedNow ?? []).some((entry) => sameTool(entry.tool, tool)),
  );
  if (unexecuted.length > 0) {
    return {
      verdict: "incomplete",
      reason:
        `The model asked for ${unexecuted.join(", ")} but ${unexecuted.length === 1 ? "it" : "they"} ` +
        "never reached the dispatcher, so the conclusion describes work that did not happen.",
      observed: [...new Set(succeeded)].map((tool) => `${tool} ran successfully`),
      missing: unexecuted.map((tool) => `${tool} ran successfully`),
    };
  }

  const outcomes = expectedOutcomesFor(objective, knownTools);

  /* ---- NOTHING DECLARED AND NOTHING STATED: reasoning is the work ---- */
  if (outcomes.length === 0) {
    // An objective with no observable requirement is completed by its
    // answer. The only thing that can be wrong is there not being one:
    // an objective that executed nothing and whose conclusion only
    // restates "done" has produced nothing at all.
    if (isVacuous(conclusion) && succeeded.length === 0) {
      return {
        verdict: "incomplete",
        reason:
          "Nothing was executed and the conclusion only restates that it is done, " +
          "so there is no evidence of anything having been accomplished.",
        observed: [],
        missing: ["an answer, or an action"],
      };
    }
    return {
      verdict: "complete",
      reason:
        succeeded.length > 0
          ? `Satisfied by ${[...new Set(succeeded)].join(", ")} and the conclusion.`
          : "Answerable by reasoning, and answered.",
      observed:
        succeeded.length > 0
          ? [...new Set(succeeded)].map((tool) => `${tool} ran successfully`)
          : ["a reasoned answer was given"],
      missing: [],
    };
  }

  /* ---- DECLARED OR STATED OUTCOMES: check each against the record ---- */
  const observed: string[] = [];
  const missing: string[] = [];
  const blocking: string[] = [];
  // A required tool that has failed more than once is not recovering:
  // more cycles will not help. Separate from "missing" so the runtime
  // can take its blocked path rather than burning the rest of the budget.
  const toolBlocking: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.evidence === "tool-succeeded") {
      const ran = outcome.tool !== undefined && succeeded.some((tool) => sameTool(tool, outcome.tool!));
      if (ran) {
        observed.push(outcome.what);
      } else {
        const failCount =
          outcome.tool !== undefined
            ? failed.filter((tool) => sameTool(tool, outcome.tool!)).length
            : 0;
        if (failCount >= 2) {
          // Repeated failure — escalate rather than cycling until the
          // budget runs out. The distinction the runtime cares about:
          // "incomplete" means try again; "blocked" means stop.
          toolBlocking.push(
            `${outcome.what} (${outcome.tool} has failed ${failCount} times with no recovery)`,
          );
        } else {
          // A tool that ran and failed is still an unmet requirement. It
          // is named differently because what the runtime should do about
          // it differs, and that decision is the runtime's.
          missing.push(failCount > 0 ? `${outcome.what} (it ran and failed)` : outcome.what);
        }
      }
      continue;
    }

    if (outcome.evidence === "user-information") {
      // Satisfied only by the user having answered. The runtime records
      // that as the trigger of the cycle the answer woke, so it is
      // observable rather than assumed.
      const answered = input.cycles.some((cycle) => /question-answered/.test(cycle.trigger ?? ""));
      if (answered) observed.push(outcome.what);
      else blocking.push(outcome.what);
      continue;
    }

    // answer-given: the conclusion is the evidence.
    if (!isVacuous(conclusion)) observed.push(outcome.what);
    else missing.push(outcome.what);
  }

  if (toolBlocking.length > 0) {
    return {
      verdict: "blocked",
      reason: `Required tool keeps failing: ${toolBlocking.join("; ")}.`,
      observed,
      missing: [...toolBlocking, ...blocking, ...missing],
    };
  }

  if (blocking.length > 0) {
    return {
      verdict: "blocked",
      reason: `Cannot be finished without the user: ${blocking.join("; ")}.`,
      observed,
      missing: [...blocking, ...missing],
    };
  }

  if (missing.length > 0) {
    return {
      verdict: "incomplete",
      reason:
        `${missing.length} of ${outcomes.length} required outcome${outcomes.length === 1 ? "" : "s"} ` +
        `${missing.length === 1 ? "has" : "have"} not been observed: ${missing.join("; ")}.`,
      observed,
      missing,
    };
  }

  return {
    verdict: "complete",
    reason: `All ${outcomes.length} required outcome${outcomes.length === 1 ? "" : "s"} observed.`,
    observed,
    missing: [],
  };
}
