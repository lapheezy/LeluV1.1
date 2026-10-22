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

/** Tool names as they appear in prose: workflow_run, project.manage. */
const TOOL_NAME = /\b([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)\b/g;

/** Both spellings of a tool, since the registry and the models differ. */
function sameTool(a: string, b: string): boolean {
  const normalise = (name: string) => name.toLowerCase().replace(/[.]/g, "_");
  return normalise(a) === normalise(b);
}

/**
 * The outcomes this objective will be judged against.
 *
 * Declared outcomes win. With none declared, tool names the objective
 * itself states are taken as required — an objective that says "check
 * with workflow_list, create it with workflow_author, then run it with
 * workflow_run" has stated its own requirements, and taking it at its
 * word needs no model and no guessing.
 *
 * `knownTools` keeps that honest: only names the runtime can actually
 * dispatch are treated as requirements, so prose that merely looks
 * tool-shaped cannot invent one.
 */
export function expectedOutcomesFor(
  objective: AgentObjective,
  knownTools: string[],
): ObjectiveOutcome[] {
  if (objective.expectedOutcomes?.length) return objective.expectedOutcomes;

  const stated: ObjectiveOutcome[] = [];
  const seen = new Set<string>();
  for (const match of objective.objective.matchAll(TOOL_NAME)) {
    const named = match[1];
    const known = knownTools.find((tool) => sameTool(tool, named));
    if (!known || seen.has(known)) continue;
    seen.add(known);
    stated.push({
      evidence: "tool-succeeded",
      tool: known,
      what: `${known} ran successfully`,
    });
  }
  return stated;
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

  const requested = [
    ...input.cycles.flatMap((cycle) => cycle.requested ?? []),
    ...(input.requestedNow ?? []),
  ];

  // A TOOL THE MODEL ASKED FOR THAT NEVER RAN.
  //
  // On the native path every accepted call is dispatched, so this is
  // normally empty. When it is not, the model's account of its work
  // describes something that did not happen — and that is true whether
  // or not the objective declared any outcomes, which is why it is
  // checked before them.
  const unexecuted = [...new Set(requested)].filter(
    (tool) => !executed.some((entry) => sameTool(entry.tool, tool)),
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

  for (const outcome of outcomes) {
    if (outcome.evidence === "tool-succeeded") {
      const ran = outcome.tool !== undefined && succeeded.some((tool) => sameTool(tool, outcome.tool!));
      if (ran) {
        observed.push(outcome.what);
      } else {
        const refused =
          outcome.tool !== undefined && failed.some((tool) => sameTool(tool, outcome.tool!));
        // A tool that ran and failed is still an unmet requirement. It
        // is named differently because what the runtime should do about
        // it differs, and that decision is the runtime's.
        missing.push(refused ? `${outcome.what} (it ran and failed)` : outcome.what);
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
