/**
 * ==========================================================
 * LÉLU — POST-ACTION CONVERSATIONAL CONTINUITY (WP18.7)
 *
 * After work completes, decides whether there is something worth
 * saying next — and says nothing when there is not.
 *
 * A completed task raises six questions, in order:
 *
 *   1. What was accomplished?
 *   2. What did the result reveal?
 *   3. Does it affect another objective?
 *   4. Is there an unresolved issue?
 *   5. What is the most logical next step?
 *   6. Is there an opportunity worth discussing?
 *
 * The output is a plan, not a paragraph of filler. A continuation is
 * only produced when it can point at an accomplished item, a finding,
 * an affected objective, an unresolved issue or a real next step, each
 * with its evidence. When none exists the plan says why it is quiet.
 *
 * This is the module that makes "let me know if you need anything
 * else" impossible: there is no branch that produces a generic offer.
 * ==========================================================
 */

import type { Evidence } from "./types";
import { shorten } from "./text";

export interface CompletedItem {
  what: string;
  /** Which record proves it, e.g. "objective:completed". */
  evidence: string;
  at: number;
}

export interface RevealedFinding {
  finding: string;
  evidence: string;
  /**
   * The work that produced the finding, when it is known. Used so the
   * sentence can name what finished instead of implying that whatever
   * happened most recently caused it.
   */
  subject?: string;
}

export interface AffectedObjective {
  id: string;
  objective: string;
  state: string;
  evidence: string;
}

export interface UnresolvedIssue {
  what: string;
  evidence: string;
}

export interface NextStep {
  action: string;
  /** Where the step came from: project checkpoint, queue, question. */
  source: string;
}

export interface Opportunity {
  what: string;
  evidence: string;
  /** 0..1. */
  strength: number;
}

export interface ContinuationInput {
  completed: CompletedItem[];
  revealed?: RevealedFinding[];
  affectedObjectives?: AffectedObjective[];
  unresolved?: UnresolvedIssue[];
  nextSteps?: NextStep[];
  opportunities?: Opportunity[];
  /** 0..1: how welcome an unasked contribution is right now. */
  userTolerance?: number;
  /** A continuation was already offered recently. */
  interruptedRecently?: boolean;
  now?: number;
}

export interface ContinuationAnswers {
  accomplished: string[];
  revealed: string[];
  affectsOtherObjectives: string[];
  unresolved: string[];
  nextStep: string | null;
  opportunity: string | null;
}

export interface ContinuationPlan {
  worthRaising: boolean;
  /** One or two sentences, or null. Never a generic offer. */
  line: string | null;
  answers: ContinuationAnswers;
  evidence: Evidence[];
  /** Why she is quiet, when she is. */
  reason: string;
}

function clampTolerance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function planContinuation(input: ContinuationInput): ContinuationPlan {
  const completed = input.completed ?? [];
  const revealed = input.revealed ?? [];
  const affected = input.affectedObjectives ?? [];
  const unresolved = input.unresolved ?? [];
  const nextSteps = input.nextSteps ?? [];
  const opportunities = (input.opportunities ?? []).filter((opportunity) => opportunity.strength >= 0.6);
  const tolerance = clampTolerance(input.userTolerance);

  const answers: ContinuationAnswers = {
    accomplished: completed.map((item) => item.what),
    revealed: revealed.map((item) => item.finding),
    affectsOtherObjectives: affected.map((item) => item.objective),
    unresolved: unresolved.map((item) => item.what),
    nextStep: nextSteps[0]?.action ?? null,
    opportunity: opportunities[0]?.what ?? null,
  };

  const evidence: Evidence[] = [];
  let line: string | null = null;
  let reason = "nothing specific enough to say";

  // An unresolved issue outranks everything: it is the one thing that
  // could change what the user does next.
  if (unresolved.length > 0 && tolerance >= 0.2) {
    const issue = unresolved[0]!;
    evidence.push({ source: issue.evidence, detail: issue.what });
    const next = nextSteps[0];
    // "Still unresolved" rather than "that leaves": the issue may
    // predate this action, and the record does not say it was caused by
    // it.
    line =
      `Still unresolved: ${lower(issue.what)}.` +
      (next ? ` The next step is ${lower(next.action)}.` : "");
    if (next) evidence.push({ source: next.source, detail: next.action });
  } else if (revealed.length > 0 && tolerance >= 0.3) {
    const finding = revealed[0]!;
    evidence.push({ source: finding.evidence, detail: finding.finding });
    line = finding.subject
      ? `${finding.subject} finished — ${lower(finding.finding)}.`
      : `A completed objective recorded this: ${lower(finding.finding)}.`;
    const next = nextSteps[0];
    if (next && tolerance >= 0.4) {
      evidence.push({ source: next.source, detail: next.action });
      line += ` The next step from here is ${lower(next.action)}.`;
    }
  } else if (affected.length > 0 && tolerance >= 0.3) {
    const objective = affected[0]!;
    evidence.push({ source: objective.evidence, detail: objective.objective });
    line = `This also touches “${shorten(objective.objective, 90)}”, which is still ${objective.state}.`;
  } else if (nextSteps.length > 0 && tolerance >= 0.45) {
    const next = nextSteps[0]!;
    evidence.push({ source: next.source, detail: next.action });
    line = `Next logical step: ${lower(next.action)}.`;
  } else if (opportunities.length > 0 && tolerance >= 0.5) {
    const opportunity = opportunities[0]!;
    evidence.push({ source: opportunity.evidence, detail: opportunity.what });
    line = `There is an opening here: ${lower(opportunity.what)}.`;
  } else if (completed.length === 0) {
    reason = "nothing completed, so there is no continuation to draw from";
  } else if (tolerance < 0.2) {
    reason = "the user has signalled they do not want to be interrupted";
  } else if (input.interruptedRecently) {
    reason = "a continuation was already offered recently";
  }

  const worthRaising = line !== null && evidence.length > 0 && !input.interruptedRecently;

  return {
    worthRaising,
    line: worthRaising ? line : null,
    answers,
    evidence,
    reason: worthRaising ? "a specific, evidence-backed continuation exists" : reason,
  };
}

/** Lowercase the first character of a fragment that will sit mid-sentence. */
function lower(text: string): string {
  const clean = (text ?? "").trim().replace(/[.]+$/, "");
  if (!clean) return clean;
  // Keep acronyms and proper nouns intact.
  if (/^[A-Z]{2,}/.test(clean)) return clean;
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}
