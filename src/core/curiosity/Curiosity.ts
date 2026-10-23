/**
 * ==========================================================
 * LÉLU — CURIOSITY: types and pure decisions
 *
 * NOTICE → QUESTION → ASSESS → RETRIEVE / ASK / INVESTIGATE
 *   → EVIDENCE → VERIFY → LEARN → REMEMBER → APPLY → REFLECT
 *
 * Everything in this file is a pure function over plain data:
 * no store, no tool, no provider, no clock. CuriosityEngine
 * owns the effects; this owns the judgement, so every decision
 * the engine makes can be tested without running anything.
 * ==========================================================
 */

import { objectiveKey } from "../cognition/StudyObjectives";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CuriosityCategory =
  | "self"
  | "host"
  | "project"
  | "technical"
  | "world"
  | "creative"
  | "strategic"
  | "capability";

export type CuriosityStatus =
  | "identified"
  | "queued"
  | "retrieving"
  | "asking"
  | "investigating"
  | "verifying"
  | "learned"
  | "applied"
  | "resolved"
  | "dismissed"
  | "expired"
  | "blocked"
  /** A resolved finding being re-checked because its truth may have changed. */
  | "revisiting";

export type CuriositySource = "conversation" | "execution" | "memory" | "personality" | "project" | "self";

export type ToolActionClass = "READ" | "ANALYZE" | "PROPOSE" | "WRITE" | "EXECUTE" | "EXTERNAL";

export type CuriosityPermission = "auto" | "proposal" | "never";

export type FailureCause =
  | "not-permitted"
  | "unavailable"
  | "missing-context"
  | "not-configured"
  | "timeout"
  | "unknown-tool"
  | "empty"
  | "input"
  | "error";

/** What a failure means for what to do next. */
export type FailureKind = "temporary" | "permission" | "availability" | "environment" | "input" | "tool" | "unknown" | "none";

export function failureKind(cause: FailureCause | undefined): FailureKind {
  switch (cause) {
    case "timeout": return "temporary";
    case "not-permitted": return "permission";
    case "unavailable":
    case "missing-context": return "availability";
    case "not-configured": return "environment";
    case "input": return "input";
    case "unknown-tool": return "tool";
    case "empty": return "none";
    case "error": return "unknown";
    default: return "unknown";
  }
}

export type LearningType =
  | "fact"
  | "constraint"
  | "preference"
  | "goal"
  | "decision"
  | "procedure"
  | "capability"
  | "relationship-context"
  | "technical-knowledge"
  | "self-knowledge"
  | "hypothesis";

export type EvidenceStance = "supports" | "contradicts" | "inconclusive";

export type Verdict = "verified" | "unverified" | "conflict" | "insufficient";

/** A tool the curiosity layer can reason about: registry facts plus "has an executor". */
export interface CatalogTool {
  id: string;
  available: boolean;
  riskLevel: number;
  permissions: string[];
  executable: boolean;
  dependency?: string;
  executionRoute?: string;
  category?: string;
  description?: string;
}

/**
 * Every curiosity-driven tool invocation carries its purpose.
 * Internal probes (`internal:*`) read LÉLU's own in-process state —
 * the tool registry, her own curiosity records — and have no side
 * effects, so they are recorded the same way but never dispatched.
 */
export interface ToolIntent {
  id: string;
  curiosityId: string;
  tool: string;
  actionClass: ToolActionClass;
  objective: string;
  reason: string;
  expectedEvidence: string;
  args: Record<string, unknown>;
  permission: CuriosityPermission;
  permitted: boolean;
  blockedReason?: string;
  outcome?: "ok" | "failed" | "blocked" | "timeout";
  resultSummary?: string;
  cause?: FailureCause;
  startedAt?: number;
  finishedAt?: number;
  /** Set when this intent was chosen by capability discovery to stand in for another tool. */
  alternativeFor?: string;
}

export interface CuriosityEvidence {
  id: string;
  source: "observation" | "memory" | "tool" | "internal" | "host";
  tool?: string;
  intentId?: string;
  claim: string;
  stance: EvidenceStance;
  weight: number;
  at: number;
}

export interface CuriosityVerification {
  verdict: Verdict;
  confidence: number;
  supporting: number;
  contradicting: number;
  sources: string[];
  note: string;
}

export interface CuriosityLearning {
  type: LearningType;
  summary: string;
  keywords: string[];
  layer: "knowledge" | "system";
  /** consolidate() accepted the write. */
  stored: boolean;
  /** A recall immediately afterwards found it — the only proof it was learned. */
  retrievable: boolean;
  /** Already present in memory before this curiosity: nothing new was written. */
  fromExistingMemory?: boolean;
  verifiedAt?: number;
  /** Whether — and how — this finding can go stale. */
  revalidation?: RevalidationPolicy;
  revalidateAfterMs?: number;
  /** The state the finding depends on, fingerprinted when it was verified. */
  dependency?: { tool?: string; fingerprint?: string };
  supersededAt?: number;
  supersededBy?: string;
}

/**
 * stable     its truth does not depend on changing state (Heru's stated
 *            intent, a constant of the design) — revisited only if raised again
 * on-change  depends on capability/environment state; revisited when that
 *            state's fingerprint changes
 * periodic   can drift without a visible signal; revisited after an interval
 */
export type RevalidationPolicy = "stable" | "on-change" | "periodic";

export type ReevaluationTrigger = "environment-changed" | "time-sensitive" | "new-evidence" | "relevant-again" | "revisited";

export interface Reevaluation {
  at: number;
  trigger: ReevaluationTrigger;
  before: string;
  after: string;
  outcome: "confirmed" | "superseded" | "inconclusive";
  fingerprint?: string;
}

export interface LearnedStrategy {
  id: string;
  /** The capability that could not be used. */
  forTool: string;
  /** The existing capability that worked in its place. */
  alternative: string;
  need: string;
  /** Argument names carried from the preferred call to the alternative. */
  carriedArgs: string[];
  reason: string;
  verifiedAt: number;
  learnedFrom: string;
  status: "current" | "superseded";
}

export interface HostQuestionRecord {
  key: string;
  text: string;
  proactiveId?: string;
  askedAt: number;
  answer?: string;
  answeredAt?: number;
  interpretation?: string;
}

export interface CuriosityStep {
  at: number;
  step: string;
  detail: string;
}

export interface CuriositySubject {
  tool?: string;
  cause?: FailureCause;
  tools?: string[];
  phrase?: string;
  /** The capability this curiosity WANTS to use to get its answer. */
  preferred?: { tool: string; args: Record<string, unknown> };
  /** "What else can provide what this tool provides?" */
  alternativeFor?: string;
}

export interface Curiosity {
  id: string;
  key: string;
  createdAt: number;
  updatedAt: number;
  question: string;
  unknown: string;
  context: string;
  category: CuriosityCategory;
  source: CuriositySource;
  importance: number;
  uncertainty: number;
  relevance: number;
  expectedBenefit: number;
  priority: number;
  tier: number;
  status: CuriosityStatus;
  keywords: string[];
  subject?: CuriositySubject;
  /** Fingerprint of the situation that raised it; a merge with new evidence re-opens it. */
  evidenceFingerprint: string;
  occurrences: number;
  attempts: number;
  depth: number;
  rootId: string;
  parentId?: string;
  relatedMemoryIds: string[];
  relatedConversationIds: string[];
  relatedObjectiveIds: string[];
  proposedActions: ToolIntent[];
  evidence: CuriosityEvidence[];
  verification?: CuriosityVerification;
  hostQuestion?: HostQuestionRecord;
  answer?: string;
  learning?: CuriosityLearning;
  appliedResult: string[];
  personalityEvidence?: { traitId: string; mode: "applied" | "staged"; observation: string; at: number };
  trail: CuriosityStep[];
  blockedReason?: string;
  expiresAt: number;
  /** Backoff: a deferred curiosity is not retried before this. */
  nextAttemptAt?: number;
  hostQuestionPreset?: string;
  /** Heru (or a test) explicitly allowed this record past the chain's depth limit. */
  continuationGranted?: boolean;
  resolvedAt?: number;
  /** History of re-checks. Superseded learning is kept, never erased. */
  reevaluations?: Reevaluation[];
  supersededLearnings?: CuriosityLearning[];
  lastReevaluationAt?: number;
}

/** What a detector produces. The engine turns it into a Curiosity. */
export interface CuriositySignal {
  question: string;
  unknown: string;
  context: string;
  category: CuriosityCategory;
  source: CuriositySource;
  importance: number;
  uncertainty: number;
  relevance: number;
  expectedBenefit: number;
  urgency?: number;
  investigationCost?: number;
  blocksObjective?: boolean;
  informsDecision?: boolean;
  keywords?: string[];
  subject?: CuriositySubject;
  evidenceFingerprint: string;
  /** Pre-formed wording for a host question when the detector already knows it. */
  hostQuestion?: string;
  /** Evidence already in hand at notice time (e.g. the observed failures). */
  initialEvidence?: Array<Omit<CuriosityEvidence, "id" | "at">>;
  conversationId?: string;
  objectiveId?: string;
  parentId?: string;
  depth?: number;
  rootId?: string;
}

export interface CuriosityBudget {
  /** Root = 0. A follow-up may only be pursued while depth < maxDepth. */
  maxDepth: number;
  maxToolSteps: number;
  timeoutMs: number;
  stepTimeoutMs: number;
  maxEvidenceChars: number;
}

export const DEFAULT_BUDGET: CuriosityBudget = {
  maxDepth: 2,
  maxToolSteps: 4,
  timeoutMs: 30_000,
  stepTimeoutMs: 8_000,
  maxEvidenceChars: 600,
};

/** Below this the signal is not worth a record at all. */
export const MIN_PRIORITY = 0.05;
/** Below this a curiosity is kept but dormant — it is never pursued until it rises. */
export const QUEUE_THRESHOLD = 0.12;
export const VERIFY_THRESHOLD = 0.6;
export const MAX_ATTEMPTS = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const STOP = new Set([
  "the", "and", "for", "that", "this", "with", "what", "when", "where", "which", "why", "how",
  "does", "did", "can", "could", "should", "would", "will", "are", "was", "were", "you", "your",
  "her", "she", "his", "him", "they", "them", "from", "into", "about", "there", "their", "have",
  "has", "had", "not", "but", "its", "it's", "keep", "keeps", "use", "using", "make", "more",
  "some", "something", "like", "just", "than", "then", "also", "very", "really", "i'm", "lélu", "lelu",
]);

export function contentWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9.\-_à-ÿ']+/i)
        .map((word) => word.replace(/^[.'-]+|[.'-]+$/g, ""))
        .filter((word) => word.length >= 3 && !STOP.has(word)),
    ),
  ];
}

export function similarity(a: string, b: string): number {
  const left = new Set(contentWords(a));
  const right = new Set(contentWords(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * A query the Brain can match. PatternMemory.search strips punctuation
 * without inserting a space, so "project.read" would be searched as
 * "projectread" and never match the stored text; ids are split into words.
 */
export function recallQuery(terms: string[]): string {
  return [...new Set(terms.flatMap((term) => term.toLowerCase().split(/[^a-z0-9à-ÿ]+/i)).filter((word) => word.length >= 3))].join(" ");
}

/** Same dedupe convention StudyObjectives already uses for the questions LÉLU carries. */
export function curiosityKey(category: CuriosityCategory, question: string, target?: string): string {
  return `${category}:${objectiveKey(question, target)}`;
}

/** Near-duplicates are consolidated, not carried twice. */
export const NEAR_DUPLICATE = 0.7;

/* ------------------------------------------------------------------ */
/* Prioritisation                                                      */
/* ------------------------------------------------------------------ */

const clamp = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export interface PriorityFactors {
  importance: number;
  uncertainty: number;
  relevance: number;
  expectedBenefit: number;
  urgency?: number;
  investigationCost?: number;
}

/**
 * importance × uncertainty × relevance × expectedBenefit, bounded to 0..1.
 * Urgency can lift it by at most half again; investigation cost can
 * halve it. Multiplicative on purpose: a question that is unimportant OR
 * already well understood OR irrelevant stays near zero however strong
 * the other factors are.
 */
export function scorePriority(f: PriorityFactors): number {
  const base = clamp(f.importance) * clamp(f.uncertainty) * clamp(f.relevance) * clamp(f.expectedBenefit);
  const urgency = 1 + 0.5 * clamp(f.urgency ?? 0);
  const cost = 1 - 0.5 * clamp(f.investigationCost ?? 0);
  return Math.round(clamp(base * urgency * cost) * 1000) / 1000;
}

/**
 * Queue order from the spec: objective blockers, technical uncertainty,
 * decision information, host clarification, capability gaps,
 * personality/development, exploratory. Lower tier = pursued first.
 */
export function tierFor(signal: Pick<CuriositySignal, "category" | "blocksObjective" | "informsDecision">): number {
  if (signal.blocksObjective) return 1;
  if (signal.category === "technical") return 2;
  if (signal.informsDecision || signal.category === "project" || signal.category === "strategic") return 3;
  if (signal.category === "host") return 4;
  if (signal.category === "capability") return 5;
  if (signal.category === "self") return 6;
  return 7;
}

export function compareCuriosities(a: Curiosity, b: Curiosity): number {
  return a.tier - b.tier || b.priority - a.priority || a.createdAt - b.createdAt;
}

/** Curiosity includes knowing when a thing is not worth wondering about. */
export function trivialityReason(signal: CuriositySignal): string | null {
  const question = signal.question.trim();
  if (question.length < 12) return "question too short to be meaningful";
  if (question.length > 300) return "question too long to be a single question";
  if (contentWords(question).length < 2) return "question has no substantive content";
  if (clamp(signal.importance) < 0.2) return "importance below the noticing threshold";
  if (scorePriority(signal) < MIN_PRIORITY) return "priority below the noticing threshold";
  return null;
}

export function ttlFor(tier: number): number {
  return tier >= 7 ? 3 * DAY_MS : tier <= 2 ? 14 * DAY_MS : 7 * DAY_MS;
}

/* ------------------------------------------------------------------ */
/* The decision tree                                                   */
/* ------------------------------------------------------------------ */

export type NextStep = "stop-known" | "retrieve" | "investigate" | "ask" | "learn" | "defer" | "dismiss";

export interface DecisionFacts {
  alreadyKnown: boolean;
  memoryTried: boolean;
  verdict: Verdict;
  untriedTools: number;
  toolStepsLeft: number;
  timedOut: boolean;
  needsHost: boolean;
  hostAsk: boolean;
  /** Attempts INCLUDING the current one. */
  attempts: number;
  importance: number;
}

/**
 * Already known? STOP. Memory? RETRIEVE. A permitted tool? INVESTIGATE.
 * Only Heru can answer? ASK. Otherwise DEFER, or DISMISS once attempts
 * are spent on something that never mattered much.
 *
 * Memory is always consulted before a tool and both before Heru: she
 * should not ask what she can find, nor run a tool for what she
 * already remembers.
 */
export function nextStep(f: DecisionFacts): NextStep {
  if (f.alreadyKnown) return "stop-known";
  if (f.verdict === "verified") return "learn";
  if (!f.memoryTried) return "retrieve";
  if (f.untriedTools > 0 && f.toolStepsLeft > 0 && !f.timedOut) return "investigate";
  if (f.needsHost && f.hostAsk) return "ask";
  if (f.attempts >= MAX_ATTEMPTS && f.importance < 0.5) return "dismiss";
  return "defer";
}

export interface HostQuestionContext {
  untriedPermittedTools: number;
  memoryAnswered: boolean;
  alreadyAsked: boolean;
  hostChannelOpen: boolean;
  hostBusy: boolean;
  importance: number;
  tier: number;
}

/** Spec §14: every "no" here is a reason to stay quiet. */
export function hostQuestionCheck(ctx: HostQuestionContext): { ask: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (ctx.untriedPermittedTools > 0) reasons.push("I can still investigate this myself");
  if (ctx.memoryAnswered) reasons.push("memory already answers it");
  if (ctx.alreadyAsked) reasons.push("I have already asked this");
  if (!(ctx.importance >= 0.5 || ctx.tier <= 4)) reasons.push("not important enough to interrupt Heru");
  if (!ctx.hostChannelOpen) reasons.push("proactive questions are switched off");
  if (ctx.hostBusy) reasons.push("another question is already waiting on Heru — asking now would interrupt it");
  return { ask: reasons.length === 0, reasons };
}

export function formulateHostQuestion(curiosity: Pick<Curiosity, "question" | "category">, preset?: string): string {
  if (preset && preset.trim()) return preset.trim();
  const question = curiosity.question.trim().replace(/\?*$/, "?");
  return `I couldn't settle this from memory or my tools, so I'd rather ask than assume: ${question}`;
}

/* ------------------------------------------------------------------ */
/* Tools: classification, policy, selection                            */
/* ------------------------------------------------------------------ */

/** Execution the spec counts as diagnostics/tests: allowed automatically when the gate allows it. */
const DIAGNOSTIC_EXECUTE = new Set(["workspace.typecheck", "workspace.test", "project.validate"]);

export function classifyAction(tool: Pick<CatalogTool, "id" | "permissions">): ToolActionClass {
  if (tool.id.startsWith("internal:")) return "ANALYZE";
  const p = new Set(tool.permissions);
  if (p.has("DESTRUCTIVE") || p.has("WRITE")) return "WRITE";
  if (p.has("EXTERNAL_ACTION")) return "EXTERNAL";
  if (p.has("EXECUTE")) return DIAGNOSTIC_EXECUTE.has(tool.id) ? "ANALYZE" : "EXECUTE";
  return "READ";
}

/**
 * What curiosity may do on its own. This is NARROWER than the
 * dispatcher's own permission, never wider: an "auto" here still has to
 * pass ToolDispatcher.toolPermitted() before anything runs.
 */
export function curiosityPermission(tool: Pick<CatalogTool, "id" | "permissions" | "riskLevel">): CuriosityPermission {
  if (tool.id === "project.apply" || tool.id === "project.commit") return "never";
  const action = classifyAction(tool);
  if (action === "READ" || action === "ANALYZE") return "auto";
  // Read-only research reaches outside, but writes nothing.
  if (action === "EXTERNAL" && !tool.permissions.includes("WRITE") && tool.riskLevel <= 1) return "auto";
  return "proposal";
}

export interface ToolConstraint {
  tool: string;
  /** "background": only for investigations outside a conversation turn. */
  scope: "background" | "any";
  cause: FailureCause;
  reason: string;
  learnedFrom: string;
  at: number;
}

export interface ToolCandidate {
  tool: string;
  args: Record<string, unknown>;
  objective: string;
  reason: string;
  expectedEvidence: string;
  alternativeFor?: string;
}

const mentions = (c: Pick<Curiosity, "question" | "context">, pattern: RegExp): boolean =>
  pattern.test(`${c.question} ${c.context}`);

/**
 * What could answer this, in the order worth trying. Memory is NOT
 * here: retrieval is its own earlier step of the decision tree.
 * Learned constraints (the APPLY half of past curiosities) remove tools
 * that are known not to work in this situation.
 */
export function selectTools(
  c: Pick<Curiosity, "question" | "context" | "category" | "subject" | "keywords">,
  catalog: CatalogTool[],
  constraints: ToolConstraint[],
  background: boolean,
): ToolCandidate[] {
  const out: ToolCandidate[] = [];
  const add = (tool: string, args: Record<string, unknown>, expectedEvidence: string): void => {
    if (out.some((item) => item.tool === tool && JSON.stringify(item.args) === JSON.stringify(args))) return;
    out.push({
      tool,
      args,
      objective: c.question,
      reason: `I'm investigating “${c.question}” because a verified answer changes what I do next.`,
      expectedEvidence,
    });
  };
  const subjectTool = c.subject?.tool;

  if (c.category === "host") return [];

  if (c.subject?.preferred) {
    add(c.subject.preferred.tool, c.subject.preferred.args, "the information this question asks for, from the capability that normally provides it");
  }

  if (subjectTool && c.category === "capability" && c.subject?.cause) {
    add("internal:tool-registry", { relatedTo: subjectTool }, `registered capabilities that share ${subjectTool}'s execution route or dependency, and their state`);
  } else if (subjectTool && (c.category === "technical" || c.category === "capability")) {
    add("internal:tool-registry", { tools: [subjectTool] }, `${subjectTool}'s registry state: available, permitted, executable, documented route`);
    add("system.config", {}, "which capabilities are configured and which are missing configuration");
  }
  if (c.category === "self" && c.subject?.tool) {
    add("internal:curiosity-ledger", { tool: c.subject.tool }, `my own recorded investigations that used ${c.subject.tool}, and how each one ended`);
    add("internal:tool-registry", { tools: [c.subject.tool] }, `${c.subject.tool}'s registry state, to rule permission and availability in or out`);
  }
  if (c.category === "capability" && c.subject?.tools?.length) {
    add("internal:tool-registry", { tools: c.subject.tools }, "each capability's registry state and whether a dispatcher executor exists");
  }
  if (c.category === "project" || c.category === "technical" || c.category === "capability") {
    if (mentions(c, /\bworkflows?\b/i)) add("workflow.list", {}, "the workflows that exist and whether each is runnable");
    if (mentions(c, /\bsandbox\b/i)) add("sandbox.read", {}, "the files currently in the sandbox");
    if (mentions(c, /\b(configured|configuration|api key|provider|credential)s?\b/i)) {
      add("system.config", {}, "which capabilities are configured and which are missing configuration");
    }
  }
  if (c.category === "world" || c.category === "strategic" || c.category === "creative") {
    add("research.web", { query: c.question.slice(0, 200) }, "an external source that states the answer directly");
  }

  const byId = new Map(catalog.map((tool) => [tool.id, tool]));
  return out.filter((candidate) => {
    if (candidate.tool.startsWith("internal:")) return true;
    const tool = byId.get(candidate.tool);
    if (!tool) return false;
    return !constraints.some(
      (rule) => rule.tool === candidate.tool && (rule.scope === "any" || (rule.scope === "background" && background)),
    );
  });
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export function classifyFailure(text: string): FailureCause {
  const t = text.toLowerCase();
  if (/not permitted|autonomy level|requires an explicit authorization/.test(t)) return "not-permitted";
  if (/no tool named|no such tool/.test(t)) return "unknown-tool";
  if (/requires the router|called without|requires .* context/.test(t)) return "missing-context";
  if (/requires (a |an )?(non-empty|path|workspace|query)|requires \w+ and \w+\.|is required|invalid argument/.test(t)) return "input";
  if (/not configured|api key|missing key|no key|credential/.test(t)) return "not-configured";
  if (/not available|unavailable|not currently available|unreachable/.test(t)) return "unavailable";
  if (/timed out|timeout|deadline/.test(t)) return "timeout";
  if (/no stored memory matches|no results|nothing found|is empty/.test(t)) return "empty";
  return "error";
}

/** The cause most of these failures share, and how many share it. */
export function dominantCause(causes: FailureCause[]): { cause: FailureCause; count: number } | null {
  if (causes.length === 0) return null;
  const counts = new Map<FailureCause, number>();
  for (const cause of causes) counts.set(cause, (counts.get(cause) ?? 0) + 1);
  const [cause, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { cause, count };
}

/**
 * Tool output is not knowledge. Evidence is combined as independent
 * support (1 − Π(1 − w)), contradicted evidence is a CONFLICT rather
 * than averaged away, and "not enough yet" is a legitimate verdict.
 */
export function verifyEvidence(evidence: CuriosityEvidence[]): CuriosityVerification {
  const supporting = evidence.filter((item) => item.stance === "supports");
  const contradicting = evidence.filter((item) => item.stance === "contradicts");
  const sources = [
    ...new Set(supporting.map((item) => (item.source === "observation" || item.source === "host" ? item.source : item.tool ?? item.source))),
  ];
  let doubt = 1;
  for (const item of supporting) doubt *= 1 - clamp(item.weight);
  const confidence = Math.round((1 - doubt) * 1000) / 1000;

  if (supporting.length > 0 && contradicting.length > 0) {
    return {
      verdict: "conflict",
      confidence,
      supporting: supporting.length,
      contradicting: contradicting.length,
      sources,
      note: `Sources disagree: ${supporting.length} support, ${contradicting.length} contradict. More investigation or Heru is needed.`,
    };
  }
  if (supporting.length === 0) {
    return {
      verdict: "insufficient",
      confidence: 0,
      supporting: 0,
      contradicting: contradicting.length,
      sources: [],
      note: "I don't have enough evidence yet.",
    };
  }
  if (confidence >= VERIFY_THRESHOLD) {
    return {
      verdict: "verified",
      confidence,
      supporting: supporting.length,
      contradicting: 0,
      sources,
      note: `Verified from ${sources.length} source(s): ${sources.join(", ")}.`,
    };
  }
  return {
    verdict: "unverified",
    confidence,
    supporting: supporting.length,
    contradicting: 0,
    sources,
    note: `Some support (confidence ${confidence.toFixed(2)}), below the ${VERIFY_THRESHOLD} needed to call it verified.`,
  };
}

export interface MemoryHit {
  confidence: number;
  text: string;
}

/** Parse the real memory.recall executor's "N. [confidence X] prompt → response" lines. */
export function parseRecall(content: string): MemoryHit[] {
  const hits: MemoryHit[] = [];
  for (const line of content.split("\n")) {
    const match = /^\s*\d+\.\s*\[confidence\s+([\d.]+)\]\s*(.*)$/.exec(line);
    if (match) hits.push({ confidence: Number(match[1]) || 0, text: match[2] });
  }
  return hits;
}

/** A stored answer from Heru: this engine's own records, or the proactive channel's. */
export function isRecordedClarification(text: string): boolean {
  return /heru clarified|user answer:/i.test(text);
}

/** A memory answers a curiosity only if it covers its key terms with some confidence. */
export function memoryAnswers(keywords: string[], hit: MemoryHit): boolean {
  if (keywords.length === 0 || hit.confidence < 0.5) return false;
  const text = hit.text.toLowerCase();
  const covered = keywords.filter((word) => text.includes(word.toLowerCase())).length;
  return covered / keywords.length >= 0.75;
}

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

/** What kind of thing Heru told her. Ordered: a constraint outranks a wish. */
export function classifyAnswer(answer: string): LearningType {
  const t = answer.toLowerCase();
  if (/\b(never|don't|do not|must not|mustn't|only|ask (me )?before|without asking|not allowed|always ask)\b/.test(t)) return "constraint";
  if (/\b(let's|we will|we'll|decided|go with|the decision)\b/.test(t)) return "decision";
  if (/\b(want|goal|eventually|aim|should be able|i'd like her)\b/.test(t)) return "goal";
  if (/\b(prefer|rather|i like|i love|favorite|favourite)\b/.test(t)) return "preference";
  if (/\b(first|then|step|procedure|process)\b/.test(t)) return "procedure";
  return "fact";
}

export function describeCause(cause: FailureCause): string {
  switch (cause) {
    case "not-permitted": return "it is not permitted at the current autonomy level or authorization";
    case "unavailable": return "it is not available in this runtime";
    case "missing-context": return "it needs a conversation turn's router context, which a background investigation does not have";
    case "not-configured": return "a capability it depends on is not configured";
    case "timeout": return "it does not finish within its time budget";
    case "unknown-tool": return "no such tool exists";
    case "empty": return "it returns nothing for these queries";
    default: return "it errors for a reason I could not classify";
  }
}

/** The constraint a verified failure diagnosis teaches. */
export function constraintFromDiagnosis(tool: string, cause: FailureCause, curiosityId: string, now: number): ToolConstraint {
  return {
    tool,
    scope: cause === "missing-context" ? "background" : "any",
    cause,
    reason: `${tool} fails because ${describeCause(cause)}.`,
    learnedFrom: curiosityId,
    at: now,
  };
}

/* ------------------------------------------------------------------ */
/* Detection (pure)                                                    */
/* ------------------------------------------------------------------ */

const AMBIGUITY =
  /\b(something like|or something|somehow|kind of|sort of|whatever (?:you think|works)|figure (?:it|that) out|you decide|not sure (?:what|how|if)|i don't know (?:what|how|if)|more (autonomous|independent|alive|human|intelligent|proactive|capable|creative|personal))\b/i;
const DIRECTIVE = /\b(want|need|should|make|build|let|have her|i'd like|goal|turn|become)\b/i;

/**
 * One conversational ambiguity worth a question, or nothing. Requires
 * BOTH a directive (Heru wants something) AND a vague target (what he
 * wants is underspecified). Ordinary vagueness in chat is not curiosity.
 */
export function detectConversationAmbiguity(message: string): CuriositySignal | null {
  const text = message.trim();
  if (text.length < 20 || text.length > 600 || text.endsWith("?")) return null;
  const vague = AMBIGUITY.exec(text);
  if (!vague || !DIRECTIVE.test(text)) return null;

  const sentence = (text.split(/(?<=[.!])\s+/).find((part) => part.includes(vague[0])) ?? text).slice(0, 160);
  // Group 1 is the whole alternation; group 2 is the quality in "more X".
  const quality = vague[2]?.toLowerCase();
  const aboutLelu = /\b(lélu|lelu|her|she|you)\b/i.test(text);
  const phrase = quality ? `more ${quality}` : vague[0].toLowerCase();

  const hostQuestion =
    quality === "autonomous" || quality === "independent"
      ? `When you say you want LÉLU to become ${quality}, which actions should she eventually be able to initiate without asking you?`
      : quality
        ? `When you say “${phrase}”, what would that look like in practice — what should change first?`
        : `When you said “${sentence}”, what outcome did you have in mind?`;

  return {
    question: quality ? `What does Heru mean by “${phrase}” here?` : `What outcome does Heru intend by “${sentence}”?`,
    unknown: `The concrete meaning of “${phrase}” in Heru's request.`,
    context: sentence,
    category: "host",
    source: "conversation",
    importance: aboutLelu && quality ? 0.8 : 0.55,
    uncertainty: 0.85,
    relevance: 0.9,
    expectedBenefit: 0.8,
    informsDecision: true,
    keywords: contentWords(phrase).slice(0, 4),
    subject: { phrase },
    evidenceFingerprint: `phrase:${phrase}`,
    hostQuestion,
  };
}

export interface ObservedFailure {
  tool: string;
  taskId: string;
  message: string;
  at: number;
}

/**
 * The same tool failing in two different turns is a pattern; one
 * failure is an event. Empty results are not failures of anything.
 */
export function detectRepeatedFailures(failures: ObservedFailure[], windowMs = 30 * 60 * 1000, now = Date.now()): CuriositySignal[] {
  // Trivial failures are not curiosity: an empty result is not a failure of
  // anything, and a malformed call ("requires a path") is the caller's slip.
  const recent = failures.filter((item) => {
    const kind = failureKind(classifyFailure(item.message));
    return now - item.at <= windowMs && kind !== "none" && kind !== "input";
  });
  const byTool = new Map<string, ObservedFailure[]>();
  for (const failure of recent) byTool.set(failure.tool, [...(byTool.get(failure.tool) ?? []), failure]);
  const signals: CuriositySignal[] = [];
  for (const [tool, list] of byTool) {
    if (new Set(list.map((item) => item.taskId)).size < 2) continue;
    const dominant = dominantCause(list.map((item) => classifyFailure(item.message)));
    if (!dominant) continue;
    signals.push({
      question: `Why does ${tool} keep failing?`,
      unknown: `The cause behind ${list.length} failures of ${tool}.`,
      context: list.map((item) => item.message.slice(0, 200)).join(" | "),
      category: "technical",
      source: "execution",
      importance: 0.7,
      uncertainty: 0.7,
      relevance: 0.8,
      expectedBenefit: 0.8,
      urgency: 0.4,
      keywords: [tool],
      subject: { tool, cause: dominant.cause },
      evidenceFingerprint: `failures:${tool}:${dominant.cause}`,
      initialEvidence: list.slice(-3).map((item) => ({
        source: "observation" as const,
        tool,
        claim: `${tool} failed in turn ${item.taskId}: ${item.message.slice(0, 200)}`,
        stance: classifyFailure(item.message) === dominant.cause ? ("supports" as const) : ("inconclusive" as const),
        weight: 0.3,
      })),
    });
  }
  return signals;
}

/**
 * Self-curiosity: her OWN investigations failing on the same tool
 * across different curiosities. Read from her own records only.
 */
export function detectOwnFailurePatterns(curiosities: Curiosity[], now = Date.now(), windowMs = 7 * DAY_MS): CuriositySignal[] {
  const byTool = new Map<string, { curiosityIds: Set<string>; causes: FailureCause[]; messages: string[] }>();
  for (const curiosity of curiosities) {
    if (curiosity.category === "self") continue;
    for (const intent of curiosity.proposedActions) {
      if (intent.outcome !== "failed" || !intent.cause || failureKind(intent.cause) === "none" || failureKind(intent.cause) === "input") continue;
      if (intent.tool.startsWith("internal:") || now - (intent.finishedAt ?? 0) > windowMs) continue;
      const entry = byTool.get(intent.tool) ?? { curiosityIds: new Set<string>(), causes: [], messages: [] };
      entry.curiosityIds.add(curiosity.id);
      entry.causes.push(intent.cause);
      entry.messages.push(intent.resultSummary ?? "");
      byTool.set(intent.tool, entry);
    }
  }
  const signals: CuriositySignal[] = [];
  for (const [tool, entry] of byTool) {
    if (entry.curiosityIds.size < 2) continue;
    const dominant = dominantCause(entry.causes);
    if (!dominant) continue;
    signals.push({
      question: `Why do my own investigations keep failing when I use ${tool}?`,
      unknown: `Whether my choice of ${tool} rests on a wrong assumption.`,
      context: `${entry.curiosityIds.size} separate investigations failed with ${tool}.`,
      category: "self",
      source: "self",
      importance: 0.6,
      uncertainty: 0.7,
      relevance: 0.8,
      expectedBenefit: 0.75,
      keywords: [tool],
      subject: { tool, cause: dominant.cause },
      evidenceFingerprint: `own-failures:${tool}:${dominant.cause}:${Math.min(entry.curiosityIds.size, 5)}`,
    });
  }
  return signals;
}

/**
 * Project curiosity: capabilities the registry says are available that
 * nothing can actually dispatch. Consolidated into ONE question rather
 * than one per tool — many are reached by other routes on purpose.
 */
export function detectUnconnectedCapabilities(catalog: CatalogTool[]): CuriositySignal | null {
  const gaps = catalog
    .filter((tool) => tool.available && !tool.executable && !tool.id.startsWith("internal:"))
    .map((tool) => tool.id)
    .sort();
  if (gaps.length === 0) return null;
  const shown = gaps.slice(0, 8);
  return {
    question: `Which of my available capabilities cannot actually be dispatched as tools, and why?`,
    unknown: `Whether ${gaps.length} catalogued-but-not-dispatchable capabilities are intentional.`,
    context: `Available in the registry without a dispatcher executor: ${shown.join(", ")}${gaps.length > shown.length ? ", …" : ""}.`,
    category: "capability",
    source: "project",
    importance: 0.55,
    uncertainty: 0.6,
    relevance: 0.7,
    expectedBenefit: 0.7,
    keywords: ["capability", "dispatch"],
    subject: { tools: shown },
    evidenceFingerprint: `unconnected:${gaps.join(",")}`,
  };
}

/** The next question a verified diagnosis opens. Bounded by the caller's depth budget. */
export function deriveFollowUp(c: Curiosity): CuriositySignal | null {
  if (!c.learning || !c.subject?.tool || !c.subject.cause) return null;
  if (c.category !== "technical" && c.category !== "self") return null;
  return {
    question: `Which other capabilities share ${c.subject.tool}'s limitation (${c.subject.cause})?`,
    unknown: `Whether the cause behind ${c.subject.tool} affects other tools too.`,
    context: c.learning.summary,
    category: "capability",
    source: "self",
    importance: 0.5,
    uncertainty: 0.6,
    relevance: 0.7,
    expectedBenefit: 0.6,
    keywords: [c.subject.cause],
    subject: { tool: c.subject.tool, cause: c.subject.cause },
    evidenceFingerprint: `follow-up:${c.id}`,
    parentId: c.id,
    rootId: c.rootId,
    depth: c.depth + 1,
  };
}

/* ------------------------------------------------------------------ */
/* Re-evaluation                                                       */
/* ------------------------------------------------------------------ */

export const HOUR_MS = 60 * 60 * 1000;
/** No finding is re-checked more often than this, except on a NEW environment fingerprint. */
export const REVISIT_MIN_INTERVAL_MS = HOUR_MS;

/** The registry state a tool finding depends on. Changes when the environment or its implementation route does. */
export function toolFingerprint(tool: CatalogTool | undefined, permitted: boolean): string {
  if (!tool) return "absent";
  return `available=${tool.available}|permitted=${permitted}|executable=${tool.executable}|route=${tool.executionRoute ?? ""}`;
}

/** Only knowledge whose truth can reasonably change is marked for revalidation. */
export function revalidationPolicyFor(
  c: Pick<Curiosity, "category" | "subject">,
  learning: Pick<CuriosityLearning, "type">,
): { policy: RevalidationPolicy; afterMs?: number } {
  if (c.category === "host" || learning.type === "preference" || learning.type === "goal" || learning.type === "decision") {
    return { policy: "stable" };
  }
  if (c.subject?.cause === "missing-context") return { policy: "periodic", afterMs: 24 * HOUR_MS };
  if (c.subject?.tool || c.subject?.tools || c.subject?.alternativeFor || c.subject?.preferred) return { policy: "on-change" };
  if (c.category === "world" || c.category === "strategic") return { policy: "periodic", afterMs: 7 * 24 * HOUR_MS };
  if (learning.type === "technical-knowledge") return { policy: "periodic", afterMs: 24 * HOUR_MS };
  return { policy: "stable" };
}

export interface RevalidationContext {
  now: number;
  currentFingerprint: (tool: string) => string;
  /** A non-curiosity call of this tool succeeded after this time. */
  succeededSince: (tool: string, since: number) => boolean;
  /** A later investigation wanted this tool but a constraint excluded it. */
  wanted: (tool: string) => boolean;
  revisitRequested: boolean;
}

/**
 * Should this finding be re-checked now — and why? Bounded: a NEW
 * environment fingerprint triggers at most one check per fingerprint;
 * every other trigger respects REVISIT_MIN_INTERVAL_MS.
 */
export function revalidationTrigger(c: Curiosity, ctx: RevalidationContext): ReevaluationTrigger | null {
  const learning = c.learning;
  if (!learning || learning.supersededAt || c.status !== "resolved") return null;
  if (!learning.revalidation || learning.revalidation === "stable") return null;
  const tool = learning.dependency?.tool;
  const checkedFingerprints = new Set((c.reevaluations ?? []).map((item) => item.fingerprint));
  if (tool && learning.dependency?.fingerprint) {
    const current = ctx.currentFingerprint(tool);
    if (current !== learning.dependency.fingerprint && !checkedFingerprints.has(current)) return "environment-changed";
  }
  const last = Math.max(learning.verifiedAt ?? 0, c.lastReevaluationAt ?? 0);
  if (ctx.now - last < REVISIT_MIN_INTERVAL_MS) return null;
  if (tool && ctx.succeededSince(tool, last)) return "new-evidence";
  if (tool && ctx.wanted(tool)) return "relevant-again";
  if (ctx.revisitRequested) return "revisited";
  if (learning.revalidation === "periodic" && learning.revalidateAfterMs !== undefined && ctx.now - last >= learning.revalidateAfterMs) {
    return "time-sensitive";
  }
  return null;
}

/** One harmless, read-only call per tool that proves it works. Tools without one are judged by registry state. */
export const VERIFY_PROBES: Record<string, Record<string, unknown>> = {
  "project.git": { action: "status" },
  "system.config": {},
  "workflow.list": {},
  "workflow.status": {},
  "sandbox.read": {},
  "research.web": { query: "capability check" },
  "memory.recall": { query: "capability check" },
};

/* ------------------------------------------------------------------ */
/* Capability discovery                                                */
/* ------------------------------------------------------------------ */

/** Words that say nothing about WHICH information a capability provides. */
const GENERIC = new Set(["read", "real", "write", "run", "list", "get", "set", "create", "update", "manage", "open", "use", "data", "information", "file", "files", "contents", "inside", "copy", "from", "into", "with"]);

function distinctiveWords(text: string): string[] {
  return contentWords(text).filter((word) => !GENERIC.has(word));
}

export interface AlternativeOption {
  tool: string;
  args: Record<string, unknown>;
  score: number;
  why: string;
  fromStrategy: boolean;
}

export interface DiscoveryInput {
  preferred: CatalogTool;
  args: Record<string, unknown>;
  catalog: CatalogTool[];
  permitted: (id: string) => boolean;
  constraints: ToolConstraint[];
  background: boolean;
  strategies: LearnedStrategy[];
  parameters: (id: string) => { required: string[]; properties: string[] } | undefined;
  reliability?: (id: string) => { ok: number; failed: number };
}

/**
 * "What else can I use?" — over the EXISTING registry only. A candidate
 * must plausibly provide the same information (same category and a
 * shared distinctive term, or two shared distinctive terms), exist,
 * be executable, available, permitted by the dispatcher, read-only for
 * curiosity, not known to fail here, and callable with inputs in hand.
 * Smallest sufficient first: a learned strategy, then relatedness, then
 * lower risk, then observed reliability.
 */
export function discoverAlternatives(input: DiscoveryInput): { options: AlternativeOption[]; rejected: Array<{ tool: string; reason: string }> } {
  const need = new Set(distinctiveWords(`${input.preferred.description ?? ""} ${input.preferred.id.split(".")[0]}`));
  const options: AlternativeOption[] = [];
  const rejected: Array<{ tool: string; reason: string }> = [];
  for (const tool of input.catalog) {
    if (tool.id === input.preferred.id || tool.id.startsWith("internal:")) continue;
    const strategy = input.strategies.find((item) => item.status === "current" && item.forTool === input.preferred.id && item.alternative === tool.id);
    const sameCategory = Boolean(tool.category && tool.category === input.preferred.category);
    const shared = distinctiveWords(`${tool.description ?? ""} ${tool.id.split(".")[0]}`).filter((word) => need.has(word));
    const related = Boolean(strategy) || (sameCategory && shared.length >= 1) || shared.length >= 2;
    if (!related) continue;

    let reason: string | null = null;
    const params = input.parameters(tool.id);
    const args: Record<string, unknown> = {};
    for (const name of params?.properties ?? []) if (name in input.args) args[name] = input.args[name];
    const missing = (params?.required ?? []).filter((name) => !(name in args));
    if (!tool.executable) reason = "no executor: catalogued but not callable as a tool";
    else if (!tool.available) reason = "not available in this runtime";
    else if (curiosityPermission(tool) !== "auto") reason = `${classifyAction(tool)} capability — needs a proposal, not something curiosity may use`;
    else if (!input.permitted(tool.id)) reason = "not permitted by the dispatcher";
    else if (input.constraints.some((rule) => rule.tool === tool.id && (rule.scope === "any" || input.background))) reason = "known not to work here (learned constraint)";
    else if (missing.length > 0) reason = `needs inputs I don't have (${missing.join(", ")})`;
    if (reason) {
      rejected.push({ tool: tool.id, reason });
      continue;
    }
    const reliability = input.reliability?.(tool.id) ?? { ok: 0, failed: 0 };
    const score =
      (strategy ? 5 : 0) + (sameCategory ? 3 : 0) + Math.min(3, shared.length) + (tool.riskLevel === 0 ? 1 : 0) - tool.riskLevel +
      Math.max(-2, Math.min(2, reliability.ok - reliability.failed));
    const why = [
      strategy ? `learned strategy (${strategy.reason})` : null,
      sameCategory ? `same ${tool.category} capability` : null,
      shared.length > 0 ? `shares “${shared.join("”, “")}”` : null,
      `${classifyAction(tool)}, risk ${tool.riskLevel}`,
    ].filter(Boolean).join("; ");
    options.push({ tool: tool.id, args, score, why, fromStrategy: Boolean(strategy) });
  }
  options.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
  return { options, rejected };
}

/* ------------------------------------------------------------------ */
/* Capability state (self-model)                                       */
/* ------------------------------------------------------------------ */

export type CapabilityState = "available" | "unavailable" | "unknown" | "permission_required" | "temporarily_failed" | "revalidation_needed";

export interface CapabilityStateRow {
  tool: string;
  state: CapabilityState;
  /** Where the claim comes from: the registry, a learned finding, or her own use. */
  basis: "registry" | "learned" | "verified-use" | "observed-failure" | "no-executor";
  reason: string;
}

/** "Unavailable" and "I don't know" are different claims, and are kept apart. */
export function capabilityStates(input: {
  catalog: CatalogTool[];
  permitted: (id: string) => boolean;
  constraints: ToolConstraint[];
  curiosities: Curiosity[];
  now: number;
}): CapabilityStateRow[] {
  const intents = input.curiosities.flatMap((c) => c.proposedActions);
  return input.catalog
    .filter((tool) => !tool.id.startsWith("internal:"))
    .map((tool): CapabilityStateRow => {
      const permitted = input.permitted(tool.id);
      const rule = input.constraints.find((item) => item.tool === tool.id);
      const owner = rule ? input.curiosities.find((c) => c.id === rule.learnedFrom) : undefined;
      const fingerprint = toolFingerprint(tool, permitted);
      if (rule) {
        if (owner?.learning?.dependency?.fingerprint && owner.learning.dependency.fingerprint !== fingerprint) {
          return { tool: tool.id, state: "revalidation_needed", basis: "learned", reason: `${rule.reason} — but its state has changed since this was learned.` };
        }
        const state: CapabilityState = rule.cause === "not-permitted" ? "permission_required" : rule.cause === "timeout" ? "temporarily_failed" : "unavailable";
        return { tool: tool.id, state, basis: "learned", reason: `${rule.reason}${rule.scope === "background" ? " (outside a live conversation)" : ""}` };
      }
      if (!tool.available) return { tool: tool.id, state: "unavailable", basis: "registry", reason: "The registry reports it unavailable in this runtime." };
      if (!permitted) return { tool: tool.id, state: "permission_required", basis: "registry", reason: "Available, but not permitted at the current autonomy level or authorization." };
      if (!tool.executable) return { tool: tool.id, state: "unknown", basis: "no-executor", reason: "Catalogued, but not callable as a tool — I cannot tell whether it would work." };
      const recentTimeout = intents.some((intent) => intent.tool === tool.id && intent.outcome === "timeout" && input.now - (intent.finishedAt ?? 0) < 30 * 60 * 1000);
      if (recentTimeout) return { tool: tool.id, state: "temporarily_failed", basis: "observed-failure", reason: "Timed out recently." };
      const used = intents.some((intent) => intent.tool === tool.id && intent.outcome === "ok");
      return { tool: tool.id, state: "available", basis: used ? "verified-use" : "registry", reason: used ? "I have used it successfully." : "The registry reports it available and permitted." };
    });
}

/* ------------------------------------------------------------------ */
/* Personality → curiosity                                             */
/* ------------------------------------------------------------------ */

export interface TraitTendency {
  traitId: string;
  status: string;
  confidence: number;
}

/** Tendencies, not templates: which kinds of question a developing trait draws attention to. */
const AFFINITY: Record<string, (c: Curiosity) => boolean> = {
  "pattern-recognition": (c) => c.source === "execution" || c.source === "self",
  synthesis: (c) => Boolean(c.parentId) || c.category === "capability",
  curiosity: (c) => c.category === "world" || c.category === "creative" || c.category === "strategic",
  "constructive-challenge": (c) => c.category === "host",
  patience: (c) => c.status === "revisiting",
  playfulness: (c) => c.category === "creative",
};

/** A bounded multiplier (≤ 1.5) used only to order curiosities within the same tier. */
export function tendencyBoost(c: Curiosity, tendencies: TraitTendency[]): { boost: number; traits: string[] } {
  let boost = 1;
  const traits: string[] = [];
  for (const tendency of tendencies) {
    const weight = tendency.status === "established" ? 0.3 : tendency.status === "emerging" ? 0.15 : 0;
    if (weight > 0 && AFFINITY[tendency.traitId]?.(c)) {
      boost += weight;
      traits.push(tendency.traitId);
    }
  }
  return { boost: Math.min(1.5, boost), traits };
}

/** Every follow-up a verified finding opens. The caller applies the depth budget and drops ones with nothing to investigate. */
export function deriveFollowUps(c: Curiosity): CuriositySignal[] {
  const out: CuriositySignal[] = [];
  const tool = c.subject?.tool;
  if (c.learning && tool && c.subject?.cause && (c.category === "technical" || c.category === "self") && failureKind(c.subject.cause) === "availability") {
    out.push({
      question: `What else can provide what ${tool} provides?`,
      unknown: `Whether an existing, authorized capability can stand in for ${tool}.`,
      context: c.learning.summary,
      category: "capability",
      source: "self",
      importance: 0.6,
      uncertainty: 0.7,
      relevance: 0.8,
      expectedBenefit: 0.8,
      informsDecision: true,
      keywords: [tool, "alternative"],
      subject: { alternativeFor: tool, cause: c.subject.cause },
      evidenceFingerprint: `alternative:${c.id}`,
      parentId: c.id,
      rootId: c.rootId,
      depth: c.depth + 1,
    });
  }
  const share = deriveFollowUp(c);
  if (share) out.push(share);
  return out;
}
