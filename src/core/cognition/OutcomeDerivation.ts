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
 * Wording that makes a mention a NON-requirement — in TWO shapes,
 * because one lookback window cannot do both jobs.
 *
 * "Do not use memory_store" and "without calling workflow_run" are the
 * goal saying a tool must NOT run. Reading the name alone turned both
 * into hard requirements — the exact inversion the contract exists to
 * prevent — so the wording before the mention decides whether it is a
 * requirement at all. But the two shapes want opposite windows:
 *
 *   BINDING   "instead of memory_store, save it with sandbox_write"
 *             rules out exactly ONE tool: the one bound to the phrase.
 *             A window wide enough to see "instead of" from
 *             sandbox_write would delete the replacement the same
 *             sentence is asking for.
 *
 *   CLAUSE    "Avoid memory_store, workflow_run and sandbox_write"
 *             rules out EVERY tool in the list. A window that stops at
 *             the first comma sees only " " before workflow_run, and
 *             turns two forbidden tools into requirements.
 *
 * Both of those are real: the first was found by the live model test
 * ("If it does not already exist, create it with workflow_author" is a
 * condition followed by an instruction, and a comma-spanning window
 * made the instruction disappear), the second by reading the derivation
 * against the goal→outcome rule it is supposed to enforce — a
 * prohibition list is the most natural way to write one, and it was
 * producing the inverted contract on every item after the first comma.
 *
 * So: a binding phrase is consumed with the tool (or the bare list of
 * tools — "without workflow_run and workflow_list" binds both) before
 * anything else is read, and the clause scan then spans commas freely.
 * The clause is bounded by sentence punctuation, and by a contrast
 * marker, so "do not use X; instead use Y" still requires Y.
 *
 * The list stops at the first word that is not tool-shaped, which is
 * what keeps "instead of memory_store, save it with sandbox_write"
 * binding only memory_store.
 */
const BINDING_NEGATION =
  /\b(?:instead of|rather than|other than|without(?:\s+(?:using|calling))?|except(?:\s+for)?)\s+[a-z][a-z0-9]*(?:[._][a-z0-9]+)+(?:[,\s]*(?:and|or|plus)?[,\s]*[a-z][a-z0-9]*(?:[._][a-z0-9]+)+)*/gi;

/**
 * Prohibition that governs the whole clause, including past a comma.
 *
 * Deliberately a closed list of phrases that negate an INSTRUCTION. A
 * bare "not" is not here on purpose: "if it does not already exist" is
 * a condition, and matching it would delete the instruction that
 * follows the comma.
 */
const CLAUSE_NEGATION =
  /\b(?:do not|don'?t|dont|never|avoid|avoiding|no need to|refrain from|must not|should not|cannot|can'?t|stop using|skip|omit|omitting|excluding)\b/i;

/** Contrast markers: a new instruction starts, so the prohibition ends. */
const CLAUSE_RESET = /\b(?:but|instead|rather)\b/gi;

/**
 * "and" / "or" either continue a list or start a new instruction, and
 * the difference decides whether a prohibition still applies:
 *
 *   "Avoid memory_store, workflow_run and sandbox_write"
 *        the list continues — all three are still forbidden
 *   "Do not use memory_store, and create it with workflow_author"
 *        a second instruction begins — workflow_author is required
 *
 * What tells them apart is what sits between the conjunction and the
 * mention: nothing but separators means the list goes on; any words at
 * all mean a new instruction. Both cases are pinned by tests.
 */
const LIST_CONJUNCTION = /\b(?:and|or|plus)\b/gi;
const LIST_GLUE = /^[\s,]*$/;

/** Sentence punctuation — a dot inside `project.manage` is not one. */
const SENTENCE_END = /[.!?](?=\s|$)|[;:\n]/g;

/**
 * The clause a mention sits in: back to the last sentence boundary, then
 * forward past any contrast marker inside it.
 */
function clauseBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  let boundary = -1;
  for (const match of before.matchAll(SENTENCE_END)) boundary = match.index ?? 0;
  const clause = before.slice(boundary + 1);
  let reset = -1;
  for (const match of clause.matchAll(CLAUSE_RESET)) reset = (match.index ?? 0) + match[0].length;
  for (const match of clause.matchAll(LIST_CONJUNCTION)) {
    const after = (match.index ?? 0) + match[0].length;
    if (LIST_GLUE.test(clause.slice(after))) continue; // the list continues
    if (after > reset) reset = after;
  }
  return reset >= 0 ? clause.slice(reset) : clause;
}

/**
 * A tool named as the CONTENT of an artifact, not as an operation.
 *
 * "give it two steps that both use the project.manage tool" is the goal
 * saying what the workflow it wants should contain. It is not telling LÉLU
 * to call project.manage itself — the workflow does, when it is run.
 *
 * Reading that as a requirement is not a hypothetical: a real model on the
 * live end-to-end test listed, authored and ran the workflow in its first
 * cycle, and then spent nine more cycles being told that project.manage was
 * still required and that it could not be reached. The objective could
 * never have been completed, and the contract — the thing that exists to
 * keep LÉLU honest — was the thing making honesty impossible.
 *
 * The pattern is deliberately narrow: a plan-ish noun, then a relative
 * clause, then the mention, with no sentence boundary in between. A tool
 * named in any other way is still a requirement, because a false negative
 * here weakens the check that catches a premature DONE:.
 */
const ARTIFACT_CONTENT =
  /\b(?:steps?|tasks?|workflows?|plan|actions?|stages?|sequences?)\b[^.;:!?\n]{0,40}\b(?:that|which|who|whose)\b[^.;:!?\n]{0,40}$/i;

/**
 * Tool ids a piece of text names as requirements.
 *
 * Two filters make this safe rather than a keyword search: the name must
 * be one the runtime can dispatch (`knownTools`), and the clause before
 * it must not negate it. Nothing else is inferred — a verb is a verb.
 */
export function namedToolIds(text: string, knownTools: string[]): string[] {
  const found: string[] = [];

  // Pass 1: consume the binding negations with the single tool each one
  // rules out, blanking them in place. Blanking (rather than cutting)
  // keeps every later index equal to the original text's, so the
  // artifact-content window below still reads the real sentence.
  let scanned = text;
  for (const match of text.matchAll(BINDING_NEGATION)) {
    const at = match.index ?? 0;
    scanned = scanned.slice(0, at) + " ".repeat(match[0].length) + scanned.slice(at + match[0].length);
  }

  // Pass 2: everything still named, unless its clause forbids it.
  for (const match of scanned.matchAll(TOOL_NAME)) {
    const named = match[1];
    if (!named) continue;
    const start = match.index ?? 0;
    if (CLAUSE_NEGATION.test(clauseBefore(scanned, start))) continue;
    // Named only as what an authored artifact's steps should use.
    if (ARTIFACT_CONTENT.test(text.slice(Math.max(0, start - 140), start))) continue;
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
