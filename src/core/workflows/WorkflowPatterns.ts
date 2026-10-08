/**
 * ==========================================================
 * LÉLU
 * WORKFLOW PATTERNS — evidence that a procedure is worth saving
 *
 * Authoring a workflow is only connected to learning if something
 * NOTICES that the same procedure keeps working, and that a saved
 * one has stopped working. Otherwise a workflow is written when a
 * person happens to ask, which is not learning at all.
 *
 * This reads only real records:
 *   • repeated procedures come from the cycle records in
 *     AgentObjectives — the tools that actually ran, in order,
 *     in objectives that actually completed;
 *   • revision candidates come from WorkflowStore executions —
 *     the steps that actually failed, with their real reasons.
 *
 * It decides nothing and stores nothing. It reports evidence into
 * the surface cognition already reads, so LÉLU can choose to
 * author or revise — and so a workflow she writes is grounded in
 * something that happened rather than in a suggestion made up for
 * the occasion.
 * ==========================================================
 */

import AgentObjectives from "../cognition/AgentObjectives";
import WorkflowStore from "./WorkflowStore";

/** A tool sequence that succeeded in more than one objective. */
export interface RepeatedProcedure {
  /** The tools, in the order they ran. */
  tools: string[];
  /** How many separate objectives ran exactly this sequence. */
  occurrences: number;
  objectiveIds: string[];
  /** The objectives' own words, so the workflow can be named for its purpose. */
  examples: string[];
}

/** A stored workflow whose real executions say it needs work. */
export interface RevisionCandidate {
  workflowId: string;
  name: string;
  runs: number;
  failures: number;
  /** The step that actually fails, and the reason it gives. */
  failingStepId: string | null;
  reason: string;
}

/** A sequence must recur at least this often before it is worth saving. */
export const MIN_OCCURRENCES = 2;
/** Shorter than this is a tool call, not a procedure. */
export const MIN_LENGTH = 2;

export default class WorkflowPatterns {
  private static instance: WorkflowPatterns | null = null;

  private constructor() {}

  public static getInstance(): WorkflowPatterns {
    if (!WorkflowPatterns.instance) {
      WorkflowPatterns.instance = new WorkflowPatterns();
    }
    return WorkflowPatterns.instance;
  }

  /**
   * Procedures LÉLU has run successfully more than once and has not
   * yet saved.
   *
   * A sequence already covered by a stored workflow is excluded: the
   * point is to notice what is MISSING, not to suggest re-writing what
   * exists.
   */
  public repeatedProcedures(): RepeatedProcedure[] {
    const objectives = AgentObjectives.getInstance();
    const byObjective = new Map<string, { tools: string[]; text: string }>();

    // Cycle records are newest first; a procedure is the order things
    // really ran, so they are replayed oldest first.
    for (const record of objectives.cycles().slice().reverse()) {
      const ran = record.executed.filter((entry) => entry.ok).map((entry) => entry.tool);
      if (ran.length === 0) continue;
      const objective = objectives.get(record.objectiveId);
      // Only completed objectives teach a procedure. One that yielded
      // is evidence of what to avoid, not of what to repeat.
      if (!objective || objective.state !== "completed") continue;
      const entry = byObjective.get(record.objectiveId) ?? {
        tools: [],
        text: objective.objective,
      };
      entry.tools.push(...ran);
      byObjective.set(record.objectiveId, entry);
    }

    const known = new Set(
      WorkflowStore.getInstance()
        .list()
        .map((workflow) => workflow.steps.map((step) => normalise(step.tool)).join(">")),
    );

    const grouped = new Map<string, RepeatedProcedure>();
    for (const [objectiveId, entry] of byObjective) {
      const tools = entry.tools.map(normalise);
      if (tools.length < MIN_LENGTH) continue;
      const key = tools.join(">");
      if (known.has(key)) continue;
      const found = grouped.get(key) ?? {
        tools,
        occurrences: 0,
        objectiveIds: [],
        examples: [],
      };
      found.occurrences += 1;
      found.objectiveIds.push(objectiveId);
      if (found.examples.length < 3) found.examples.push(entry.text);
      grouped.set(key, found);
    }

    return [...grouped.values()]
      .filter((procedure) => procedure.occurrences >= MIN_OCCURRENCES)
      .sort((a, b) => b.occurrences - a.occurrences);
  }

  /**
   * Stored workflows whose real runs show they need revising.
   *
   * The evidence is the execution record: how often it ran, how often
   * it failed, and which step actually failed. A workflow that has
   * never failed is never suggested for revision.
   */
  public revisionCandidates(): RevisionCandidate[] {
    const store = WorkflowStore.getInstance();
    const candidates: RevisionCandidate[] = [];

    for (const workflow of store.list()) {
      const runs = store.executions(workflow.id);
      if (runs.length === 0) continue;
      const failed = runs.filter(
        (run) => run.status === "failed" || run.status === "partial" || run.status === "escalated",
      );
      if (failed.length === 0) continue;
      // One bad run can be circumstance; a majority is the workflow.
      if (failed.length * 2 < runs.length) continue;

      const badStep = failed
        .flatMap((run) => run.steps)
        .find((step) => step.status === "failed" || step.status === "blocked" || step.status === "escalated");

      candidates.push({
        workflowId: workflow.id,
        name: workflow.name,
        runs: runs.length,
        failures: failed.length,
        failingStepId: badStep?.stepId ?? null,
        reason: badStep?.reason ?? failed[0].summary,
      });
    }

    return candidates.sort((a, b) => b.failures - a.failures);
  }

  /**
   * The evidence, for the capability surface cognition already reads.
   *
   * Returns "" when there is nothing to report, so an empty history
   * never turns into a suggestion to invent a workflow.
   */
  public describe(): string {
    const repeated = this.repeatedProcedures();
    const revisions = this.revisionCandidates();
    if (repeated.length === 0 && revisions.length === 0) return "";

    const lines: string[] = [];
    if (repeated.length > 0) {
      lines.push(
        "PROCEDURES YOU HAVE REPEATED AND NOT SAVED (evidence from your own completed objectives — " +
          "save one with workflow_author if it is genuinely reusable):",
      );
      for (const procedure of repeated.slice(0, 3)) {
        lines.push(
          `- ${procedure.tools.join(" → ")} — succeeded in ${procedure.occurrences} separate objective(s), ` +
            `e.g. “${procedure.examples[0]?.slice(0, 110) ?? ""}”`,
        );
      }
    }
    if (revisions.length > 0) {
      lines.push(
        "SAVED WORKFLOWS YOUR OWN RUNS SAY NEED REVISING (re-author with workflow_author, passing the same id):",
      );
      for (const candidate of revisions.slice(0, 3)) {
        lines.push(
          `- “${candidate.name}” (id ${candidate.workflowId}) failed ${candidate.failures} of ${candidate.runs} run(s)` +
            `${candidate.failingStepId ? ` at step "${candidate.failingStepId}"` : ""}: ` +
            `${candidate.reason.replace(/\s+/g, " ").slice(0, 200)}`,
        );
      }
    }
    return lines.join("\n");
  }
}

/** Tool ids reach records in both dotted and underscored form. */
function normalise(tool: string): string {
  return tool.replace(/_/g, ".");
}
