/**
 * ==========================================================
 * LÉLU — COMPLEXITY AND SCOPE INTELLIGENCE (WP18.5)
 *
 * Answers one question about a piece of work: should this be
 * expanded, simplified, prioritised or minimised — and why?
 *
 * The distinction the engine exists for:
 *
 *   NECESSARY COMPLEXITY   a stated requirement genuinely needs more
 *                          than one moving part, or a real dependency
 *                          is unresolved.
 *   INCIDENTAL COMPLEXITY  a step that traces to no requirement, a new
 *                          module duplicating an existing capability, or
 *                          a plan much larger than what was asked for.
 *
 * The engine NEVER reduces ambition on its own. It only recommends
 * SIMPLIFY or MINIMIZE when every must-have requirement is covered and
 * it can name the functionality being preserved. When the ambition is
 * backed by real requirements it says HOLD or EXPAND instead, and says
 * which requirements justify the size.
 *
 * Every recommendation carries its reasoning and its coverage, so a
 * scope judgement can be argued with rather than obeyed.
 * ==========================================================
 */

import { clamp01, overlap, fingerprint, shorten, tokens } from "./text";

export type ScopeRecommendation = "EXPAND" | "SIMPLIFY" | "PRIORITIZE" | "MINIMIZE" | "HOLD";

export interface ScopeRequirement {
  text: string;
  /** Explicitly requested, or inferred from the objective's wording. */
  kind: "explicit" | "implied";
  /** Must survive any simplification. */
  mustHave: boolean;
}

export interface PlanStep {
  text: string;
  tool?: string;
  /** Requirement texts this step claims to address. */
  addresses?: string[];
}

export interface Dependency {
  what: string;
  resolved: boolean;
  /** Why it blocks, when known. */
  blocks?: string;
}

export interface CompetingObjective {
  objective: string;
  priority?: string;
  /** True when other work cannot start until this is done. */
  blocks?: boolean;
}

export interface ScopeInput {
  objective: string;
  requirements: ScopeRequirement[];
  plan?: PlanStep[];
  /** Real capability names, e.g. from SelfModel.capabilities. */
  existingCapabilities?: string[];
  /** New modules/machinery the proposed work would introduce. */
  proposedNewModules?: string[];
  dependencies?: Dependency[];
  competingObjectives?: CompetingObjective[];
  /** 0..1. */
  urgency?: number;
  /** Things that must be investigated before the shape is known. */
  investigationGaps?: string[];
  /** Claims that lack supporting evidence. */
  evidenceGaps?: string[];
  /** The user asked for something simple/small. */
  signaledSimplicity?: boolean;
  /** 0..1: how large the stated ambition is ("whole platform", "everything"). */
  ambition?: number;
  now?: number;
}

export interface ScopeReason {
  code: string;
  detail: string;
  delta: number;
}

export interface ScopeAssessment {
  recommendation: ScopeRecommendation;
  headline: string;
  why: ScopeReason[];
  coverage: {
    covered: string[];
    uncovered: string[];
    /** No requirements were stated, so scope cannot be judged. */
    notStated: boolean;
    /** A plan was available. Without one, "uncovered" is unknown, not empty. */
    planStated: boolean;
  };
  incidentalComplexity: Array<{ what: string; reason: string }>;
  necessaryComplexity: Array<{ what: string; reason: string }>;
  /** Functionality a simplification must keep. */
  preserved: string[];
  confidence: number;
  /** True when the stated ambition was backed by requirements and respected. */
  ambitionRespected: boolean;
  fingerprint: string;
}

/* ------------------------------------------------------------------ *
 * EXTRACTING REQUIREMENTS AND DEPENDENCIES FROM WHAT WAS SAID
 * ------------------------------------------------------------------ */

const REQUIREMENT_CUE = /\b(must|should|needs? to|required?|without|keep|preserve|support|so that|do not|don't|only|at least|instead of)\b/i;
const MUST_HAVE = /\b(must|needs? to|required?|without breaking|keep|preserve|support|at least)\b/i;

/**
 * The requirements the user actually stated. Sentences with a
 * requirement cue, not inferred feature lists.
 *
 * A requirement she invented is not evidence of scope, so when nothing
 * is stated this returns an empty list and the assessment says the
 * scope is not stated rather than guessing.
 */
export function extractRequirements(text: string, limit = 8): ScopeRequirement[] {
  const sentences = (text ?? "")
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 2);
  const requirements: ScopeRequirement[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    if (!REQUIREMENT_CUE.test(sentence)) continue;
    const cleaned = sentence.replace(/^(please|also|and)\s+/i, "").trim();
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({
      text: shorten(cleaned, 180),
      kind: "explicit",
      mustHave: MUST_HAVE.test(cleaned),
    });
    if (requirements.length >= limit) break;
  }
  return requirements;
}

const DEPENDENCY_CUE = /(?:depends? on|blocked by|blocked until|waiting on|requires?|before we can|prerequisite(?: is)?|as soon as|once)\s+([^.;\n]{3,120})/gi;

/** Dependencies named in the text, with the phrase that named them. */
export function extractDependencies(text: string): Dependency[] {
  const found: Dependency[] = [];
  const seen = new Set<string>();
  for (const match of (text ?? "").matchAll(DEPENDENCY_CUE)) {
    const what = shorten((match[1] ?? "").trim(), 120);
    if (!what) continue;
    const key = what.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ what, resolved: false });
  }
  return found;
}

/** Does the text carry a large-ambition signal rather than a small one? */
export function deriveAmbition(text: string): number {
  const clean = text ?? "";
  if (/\b(everything|entire|whole (platform|system|product)|all of it|full (rewrite|rebuild|platform)|from scratch|complete)\b/i.test(clean)) {
    return 0.8;
  }
  if (/\b(framework|platform|engine|architecture|infrastructure|pipeline|suite)\b/i.test(clean)) {
    return 0.5;
  }
  if (/\b(simple|minimal|small|quick|just|one file|tiny)\b/i.test(clean)) {
    return 0.15;
  }
  return 0.35;
}

/* ------------------------------------------------------------------ *
 * THE ASSESSMENT
 * ------------------------------------------------------------------ */

function stepTouchesRequirement(step: PlanStep, requirement: ScopeRequirement): boolean {
  if (step.addresses?.some((address) => address.toLowerCase() === requirement.text.toLowerCase())) return true;
  return overlap(step.text, requirement.text) >= 2;
}

function moduleDuplicatesCapability(module: string, capability: string): boolean {
  const moduleTokens = new Set(tokens(module));
  const capabilityTokens = tokens(capability);
  return capabilityTokens.some((word) => moduleTokens.has(word));
}

export function assessScope(input: ScopeInput): ScopeAssessment {
  const requirements = input.requirements ?? [];
  const plan = input.plan ?? [];
  const mustHaves = requirements.filter((requirement) => requirement.mustHave);

  const hasPlan = plan.length > 0;
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const requirement of mustHaves) {
    const coveredByPlan = hasPlan && plan.some((step) => stepTouchesRequirement(step, requirement));
    const coveredByCapability = (input.existingCapabilities ?? []).some(
      (capability) => overlap(capability, requirement.text) >= 2,
    );
    if (coveredByPlan || coveredByCapability) covered.push(requirement.text);
    // Before a plan exists, an unaddressed requirement is UNKNOWN, not
    // uncovered. Claiming otherwise would call every request too small
    // the moment it was made.
    else if (hasPlan) uncovered.push(requirement.text);
  }

  const incidental: Array<{ what: string; reason: string }> = [];
  const necessary: Array<{ what: string; reason: string }> = [];

  for (const step of plan) {
    if (requirements.length > 0 && !requirements.some((requirement) => stepTouchesRequirement(step, requirement))) {
      incidental.push({
        what: step.text,
        reason: "not traceable to any stated requirement",
      });
    }
  }

  for (const module of input.proposedNewModules ?? []) {
    const duplicate = (input.existingCapabilities ?? []).find((capability) =>
      moduleDuplicatesCapability(module, capability),
    );
    if (duplicate) {
      incidental.push({
        what: module,
        reason: `${duplicate} already exists in this environment — a second one is a parallel system`,
      });
    }
  }

  if (plan.length > 0 && requirements.length > 0 && plan.length > Math.max(6, requirements.length * 3)) {
    incidental.push({
      what: `${plan.length}-step plan`,
      reason: `the stated requirements (${requirements.length}) do not need that many moving parts`,
    });
  }

  for (const requirement of mustHaves) {
    if (covered.includes(requirement.text)) {
      necessary.push({ what: requirement.text, reason: "stated as must-have and addressed by the work" });
    }
  }
  const unresolvedDependencies = (input.dependencies ?? []).filter((dependency) => !dependency.resolved);
  for (const dependency of unresolvedDependencies) {
    necessary.push({ what: dependency.what, reason: "unresolved dependency" });
  }
  for (const gap of input.investigationGaps ?? []) {
    necessary.push({ what: gap, reason: "must be investigated before the shape is known" });
  }

  const why: ScopeReason[] = [];
  let recommendation: ScopeRecommendation = "HOLD";
  let headline = "The scope matches what was asked for.";
  const ambition = clamp01(input.ambition ?? deriveAmbition(input.objective));
  const ambiguityOfScope = plan.length === 0 && requirements.length === 0;

  const add = (code: string, detail: string, delta: number): void => {
    why.push({ code, detail, delta });
  };

  if (uncovered.length > 0) {
    add("uncovered-requirements", `${uncovered.length} must-have requirement(s) have no step`, 0.5);
  }
  if (unresolvedDependencies.length > 0) {
    add(
      "unresolved-dependency",
      `${unresolvedDependencies.map((dependency) => dependency.what).join("; ")} — this cannot move until it is settled`,
      0.4,
    );
  }
  if ((input.investigationGaps ?? []).length > 0) {
    add("investigation-needed", "the shape cannot be judged without investigation", 0.35);
  }
  if ((input.evidenceGaps ?? []).length > 0) {
    add("evidence-gap", "claims behind this work are not yet supported", 0.25);
  }
  if (incidental.length > 0) {
    add(
      "incidental-complexity",
      `${incidental.length} element(s) add moving parts without a stated requirement`,
      0.25 + incidental.length * 0.08,
    );
  }
  const competing = (input.competingObjectives ?? []).filter(Boolean);
  if (competing.length >= 2) {
    const blockers = competing.filter((objective) => objective.blocks).length;
    add(
      "competing-objectives",
      `${competing.length} objectives compete${blockers > 0 ? `, ${blockers} of them blocking others` : ""}`,
      0.3 + blockers * 0.1,
    );
  }
  if (input.signaledSimplicity) {
    add("user-asked-for-simple", "the request favors the smallest thing that works", 0.2);
  }

  const requiredCoverage = mustHaves.length > 0 && uncovered.length === 0;

  if (ambitiousButJustified(ambition, mustHaves.length, incidental, plan.length)) {
    recommendation = "EXPAND";
    headline = `The size is justified by ${mustHaves.length} must-have requirements; expansion should serve them, not replace them.`;
    add("ambition-justified", `${mustHaves.length} must-have requirements support this scope`, 0.2);
  } else if (uncovered.length > 0 || unresolvedDependencies.length > 0 || (input.investigationGaps ?? []).length > 0) {
    recommendation = "EXPAND";
    headline =
      uncovered.length > 0
        ? `Expand the plan: ${uncovered.length} required outcome(s) are not covered yet.`
        : unresolvedDependencies.length > 0
          ? `Expand before building: ${unresolvedDependencies[0]?.what ?? "a dependency"} is unresolved.`
          : "Expand the investigation before committing to a shape.";
  } else if (competing.length >= 2) {
    recommendation = "PRIORITIZE";
    headline = `Prioritise: ${competing.length} objectives compete and only one should be advancing now.`;
    add("priority-order", "ordering matters more than adding scope", 0.2);
  } else if (incidental.length >= 2 && requiredCoverage && ambition < 0.7) {
    recommendation = "SIMPLIFY";
    headline = `Simplify: ${incidental.length} moving part(s) can go without losing a stated requirement.`;
  } else if (input.signaledSimplicity && plan.length > Math.max(3, requirements.length * 2) && requiredCoverage) {
    recommendation = "MINIMIZE";
    headline = "Minimise: a smaller version reaches the same stated outcome.";
  } else if (ambiguityOfScope) {
    recommendation = "HOLD";
    headline = "No scope judgement yet: no requirements or plan were stated.";
    add("scope-not-stated", "there is nothing concrete to expand or reduce", 0);
  } else if (incidental.length === 1 && requiredCoverage) {
    add("single-redundant-element", `“${incidental[0]?.what ?? "one element"}” may be removable, but it is not worth a detour`, 0.1);
    headline = "The scope is broadly right; one element may be redundant.";
  }

  if (recommendation === "SIMPLIFY" || recommendation === "MINIMIZE") {
    // A reduction is only proposed alongside the list of things it must
    // not remove. This is what separates simplification from cutting
    // requested functionality.
    add(
      "preserved-functionality",
      `${mustHaves.length} must-have requirement(s) stay intact`,
      0,
    );
  }

  const evidenceCount =
    (input.plan?.length ?? 0) +
    requirements.length +
    (input.existingCapabilities?.length ?? 0) +
    (input.dependencies?.length ?? 0);
  const confidence = ambiguityOfScope ? 0.25 : clamp01(0.45 + evidenceCount * 0.05);

  return {
    recommendation,
    headline,
    why,
    coverage: {
      covered,
      uncovered,
      notStated: requirements.length === 0,
      planStated: hasPlan,
    },
    incidentalComplexity: incidental,
    necessaryComplexity: necessary,
    preserved: mustHaves.map((requirement) => requirement.text),
    confidence,
    ambitionRespected: recommendation === "EXPAND" ? ambitiousButJustified(ambition, mustHaves.length, incidental, plan.length) : false,
    fingerprint: fingerprint("scope", input.objective, recommendation, ...uncovered, ...incidental.map((item) => item.what)),
  };
}

/**
 * An ambitious objective with real must-have requirements is not
 * over-engineering; reducing it would remove something that was asked
 * for. This is the guard against "simplify" becoming a reflex.
 */
function ambitiousButJustified(
  ambition: number,
  mustHaveCount: number,
  incidental: Array<{ what: string; reason: string }>,
  planLength: number,
): boolean {
  return ambition >= 0.6 && mustHaveCount >= 3 && incidental.length === 0 && planLength >= 3;
}

/** A readable account of the assessment, for her own context. */
export function describeScope(assessment: ScopeAssessment): string {
  if (assessment.recommendation === "HOLD") return assessment.headline;
  const why = assessment.why
    .filter((reason) => reason.delta > 0)
    .slice(0, 3)
    .map((reason) => reason.detail)
    .join("; ");
  const preserve = assessment.preserved.length > 0
    ? ` Keep: ${assessment.preserved.slice(0, 3).map((item) => `“${shorten(item, 70)}”`).join(", ")}.`
    : "";
  return `${assessment.headline}${why ? ` Because ${why}.` : ""}${preserve}`;
}
