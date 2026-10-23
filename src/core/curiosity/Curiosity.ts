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
  | "blocked";

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
  | "error";

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
  const recent = failures.filter((item) => now - item.at <= windowMs && classifyFailure(item.message) !== "empty");
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
      if (intent.outcome !== "failed" || !intent.cause || intent.cause === "empty") continue;
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
