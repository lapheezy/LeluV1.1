/**
 * ==========================================================
 * LÉLU
 * GOAL → OUTCOME CONTRACT
 *
 * An objective is a claim about what should become TRUE. The
 * completion verifier can only check that claim against
 * something, so something has to say what "done" means before
 * the work starts. This module answers only that question:
 * given a goal and what the runtime already knows about it,
 * which observable outcomes must hold?
 *
 * WHAT IT MAY USE
 *   declared outcomes      outcomes the caller stated. Always win.
 *   structured tool ids    the project's own plan / task /
 *                          checkpoint steps. Runtime state, not
 *                          conversation.
 *   tool ids the goal names
 *                          "create it with workflow_author" is the
 *                          goal stating its own requirement.
 *
 * WHAT IT REFUSES TO DO
 *   • turn a verb into a tool: "Improve the project." does NOT
 *     require project.manage, and nothing here maps wording to
 *     capability.
 *   • require a tool the goal names only to RULE OUT:
 *     "Do not use memory_store." requires no memory_store.
 *   • require anything the runtime cannot actually dispatch, when
 *     the caller supplies the list.
 *   • invent a requirement when it cannot tell. An empty contract
 *     is the honest answer: the objective is still verified, on
 *     its answer rather than on a guessed checklist.
 *
 * Pure by design — no stores, no registry, no events. Callers
 * hand it the known tool ids, so a test can hand it a list.
 * ==========================================================
 */

import type { ObjectiveOutcome } from "./AgentObjectives";

/** Tool names as they appear in prose: workflow_run, project.manage. */
const TOOL_NAME = /\b([a-z][a-z0-9]*(?:[._][a-z0-9]+)+)\b/g;

/**
 * The one normalisation the rest of cognition uses, so
 * `project.manage` and `project_manage` are never two tools.
 */
export function normaliseTool(name: string): string {
  return name.toLowerCase().replace(/[.]/g, "_");
}

/** Both spellings of a tool, since the registry and the models differ. */
export function sameTool(a: string, b: string): boolean {
  return normaliseTool(a) === normaliseTool(b);
}

/** One outcome, in the shape the verifier already checks. */
export function toolOutcome(tool: string): ObjectiveOutcome {
  return { evidence: "tool-succeeded", tool, what: `${tool} ran successfully` };
}

/**
 * Wording that makes a mention a NON-requirement.
 *
 * "Do not use memory_store" and "without calling workflow_run" are the
 * goal saying a tool must NOT run. Reading the name alone turned both
 * into hard requirements — the exact inversion the contract exists to
 * prevent — so the clause immediately before the mention decides
 * whether it is a requirement at all.
 *
 * Bounded to the same clause (no sentence punctuation, at most 60
 * characters back) so "Do not touch the schema; use workflow_run"
 * still requires workflow_run.
 */
const NEGATION =
  /\b(?:not|never|without|avoid|skip|omit|except|excluding|instead of|rather than|no need to|don'?t|doesn'?t|do not)\b[^.;:!?\n]{0,60}$/i;

/**
 * Tool ids a piece of text names as requirements.
 *
 * Two filters make this safe rather than a keyword search: the name must
 * be one the runtime can dispatch (`knownTools`), and the clause before
 * it must not negate it. Nothing else is inferred — a verb is a verb.
 */
export function namedToolIds(text: string, knownTools: string[]): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TOOL_NAME)) {
    const named = match[1];
    if (!named) continue;
    const start = match.index ?? 0;
    if (NEGATION.test(text.slice(Math.max(0, start - 60), start))) continue;
    const known = knownTools.find((tool) => sameTool(tool, named));
    if (!known) continue;
    if (!found.some((entry) => sameTool(entry, known))) found.push(known);
  }
  return found;
}

/** Everything the derivation is allowed to look at. */
export interface GoalContractInput {
  /** The objective, in the requester's words. */
  objective: string;
  /** Outcomes the caller declared. These win, verbatim. */
  declared?: ObjectiveOutcome[];
  /**
   * Tool ids taken from STRUCTURED state — a project's plan steps, its
   * actionable tasks, its checkpoint's pending items — rather than from
   * a sentence someone typed.
   */
  structuredTools?: string[];
  /**
   * Tool ids the runtime can really dispatch. When supplied, nothing
   * outside it can become a requirement, so prose that merely looks
   * tool-shaped cannot invent one.
   */
  knownTools?: string[];
}

/**
 * The outcomes this goal will be judged against.
 *
 * Returns an empty array — not a guess — when nothing safe is known.
 * Callers must treat empty as "nothing declared", never as "nothing
 * required of the answer": the verifier's reasoning-only path already
 * handles that, and it is not this module's decision to make.
 */
export function deriveOutcomes(input: GoalContractInput): ObjectiveOutcome[] {
  const declared = input.declared ?? [];
  if (declared.length > 0) return declared;

  const known = input.knownTools ?? [];
  const outcomes: ObjectiveOutcome[] = [];

  const add = (tool: string): void => {
    // With no list supplied the caller is asserting it already filtered;
    // with one supplied, only a dispatchable id survives.
    const canonical = known.length === 0 ? tool : known.find((candidate) => sameTool(candidate, tool));
    if (!canonical) return;
    if (outcomes.some((outcome) => outcome.tool !== undefined && sameTool(outcome.tool, canonical))) return;
    outcomes.push(toolOutcome(canonical));
  };

  for (const tool of input.structuredTools ?? []) {
    if (known.length > 0 && !known.some((candidate) => sameTool(candidate, tool))) continue;
    add(tool);
  }
  for (const tool of namedToolIds(input.objective, known)) {
    add(tool);
  }

  return outcomes;
}

/**
 * A contract made only of operations the runtime was HANDED.
 *
 * For callers that know the required tools structurally and must not
 * let the objective's wording add any — this is the constructor used
 * when a project's own plan becomes an objective.
 */
export function outcomesForTools(tools: string[], knownTools: string[]): ObjectiveOutcome[] {
  return deriveOutcomes({ objective: "", structuredTools: tools, knownTools });
}

/**
 * The project fields a contract may be derived from.
 *
 * Deliberately NOT `description`, `objective`, `originalRequest` or the
 * project's conversations: those are prose a person wrote. Plan steps,
 * actionable tasks and a checkpoint's pending items are the runtime's
 * own record of the operations it intends to perform, and are the only
 * project state this reads.
 */
export interface StructuredGoalSource {
  executionPlan?: string[];
  actionableTasks?: string[];
  checkpoint?: { pending?: string[] };
}

/**
 * Tool ids the project's own plan states as operations.
 *
 * Feeds `AgentObjectives.create({ expectedOutcomes })`, so a derived
 * objective carries the contract it will later be verified against
 * instead of leaving the verifier to re-read the wording. Empty when the
 * plan names no dispatchable tool — which is the normal case, and means
 * "no contract", not "nothing expected".
 */
export function structuredPlanToolIds(
  source: StructuredGoalSource,
  knownTools: string[],
): string[] {
  const steps = [
    ...(source.executionPlan ?? []),
    ...(source.actionableTasks ?? []),
    ...(source.checkpoint?.pending ?? []),
  ];
  const ids: string[] = [];
  for (const step of steps) {
    for (const tool of namedToolIds(step, knownTools)) {
      if (!ids.some((entry) => sameTool(entry, tool))) ids.push(tool);
    }
  }
  return ids;
}
