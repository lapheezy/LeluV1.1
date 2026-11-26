/**
 * ==========================================================
 * LÉLU — MEMORY SOVEREIGNTY
 *
 * The boundary the memory pipeline was missing.
 *
 * 2.1 exposed the defect: a loss discussed in one
 * conversation was answered as though it had been said in
 * another. The store was not corrupt and retrieval was not
 * broken — memories simply carried no statement of where they
 * came from, so every recall was anonymous. Once a memory is
 * anonymous, "relevant" and "authorized" collapse into the same
 * thing, and lexical overlap is enough to make another chat's
 * private context look like this chat's business.
 *
 * This module does not add a memory store. It adds the two
 * things a memory needs before it may reach a model:
 *
 *   PROVENANCE — who it belongs to, where and when it was
 *   learned, whether it is a statement, an observation, a
 *   report or an inference, and whether it is durable.
 *
 *   AUTHORIZATION — a deterministic decision (RETRIEVE /
 *   RETRIEVE_WITH_CONTEXT / DEFER / REJECT) from ownership,
 *   scope, relevance, confidence and necessity. Relevance alone
 *   is never permission.
 *
 * The rules are enforced in code at two points:
 *   1. PatternMemory.search() drops ineligible memories before
 *      ranking, so an unauthorized memory is never even a
 *      candidate.
 *   2. MemoryBridge.enrich() authorizes what survived, labels
 *      historical and inferred material, and tells the model
 *      how to speak about it.
 *
 * Deliberately conservative about what it can prove:
 * memories written before provenance existed are historical
 * with unknown origin, never "said here".
 * ==========================================================
 */

import type ResponsePattern from "../../brain/ResponsePattern";
import type { MemoryType } from "../../brain/ResponsePattern";
import { appraise } from "../identity/voice/EmotionAppraisal";

/** Where a memory sits relative to the conversation happening now. */
export type MemoryScope =
  /** Explicitly provided in the active conversation. */
  | "current-conversation"
  /** From an earlier conversation; retrievable, but stays historical. */
  | "historical-conversation"
  /** Intentionally durable across conversations (preferences, projects, identity). */
  | "persistent-user"
  /** Temporary, belonging to one runtime session. Never durable by default. */
  | "session"
  /** Produced by reasoning rather than stated. Never silently promoted to fact. */
  | "derived";

/** How the information came to LÉLU. */
export type MemorySourceType =
  | "user-said"
  | "lelu-observed"
  | "agent-reported"
  | "inferred"
  | "external-tool";

/** The retrieval decision. Deterministic and auditable. */
export type MemoryDecision =
  | "RETRIEVE"
  | "RETRIEVE_WITH_CONTEXT"
  | "DEFER"
  | "REJECT";

export interface MemoryOrigin {
  /** The memory this provenance describes — checked against the record it rides on. */
  memoryId: string;
  /** Owner. Null only for data migrated in without an owner recorded. */
  userId: string | null;
  originatingConversationId: string | null;
  originatingSessionId: string | null;
  /** Title at write time, so a later turn can name where it came from honestly. */
  originatingConversationTitle: string | null;
  createdAt: number;
  updatedAt: number;
  scope: MemoryScope;
  sourceType: MemorySourceType;
  /** 0..1 — how sure the writer was that this is true of the user. */
  confidence: number;
  persistence: "persistent" | "session" | "derived";
  retention: "durable" | "session" | "expires";
}

/** The current turn's identity, against which every memory is judged. */
export interface MemoryScopeContext {
  userId: string | null;
  conversationId: string | null;
  sessionId: string;
  prompt: string;
}

export interface RetrievalDecisionRecord {
  memoryId: string;
  decision: MemoryDecision;
  reason: string;
  scope: MemoryScope;
  sourceType: MemorySourceType;
  relevance: number;
  /** Same-conversation, other-conversation, unknown, or none. */
  relation: "this-conversation" | "other-conversation" | "unknown-conversation" | "no-conversation";
  originatingConversationId: string | null;
}

export interface AuthorizationResult {
  /** Only the memories the model may see. */
  allowed: ResponsePattern[];
  decisions: RetrievalDecisionRecord[];
  /** Counted outcomes, for the trace and for acceptance reports. */
  counts: Record<MemoryDecision, number>;
}

/* ----------------------------- policy ----------------------------- */

export const SOVEREIGNTY_POLICY = {
  version: "1.0.0",
  /**
   * Persistent user facts are authorized on modest topical overlap. The
   * synthesizer still ranks and caps them; this gate only refuses the
   * clearly unrelated.
   */
  persistentRelevance: 0.1,
  /** Historical transcript material must earn its way in with its subject. */
  historicalRelevance: 0.2,
  /**
   * Emotionally charged historical material needs real subject overlap,
   * not a shared verb. "Can you fix it?" must not authorize a bereavement
   * memory because both contain "fix".
   */
  sensitiveHistoricalRelevance: 0.45,
  /** An inference is only worth showing when it is both relevant and confident. */
  derivedRelevance: 0.3,
  derivedConfidence: 0.75,
  /** A memory addressed by id must carry the id it claims. */
  verifyMemoryIdentity: true,
} as const;

export const POLICY_AS_JSON = {
  version: SOVEREIGNTY_POLICY.version,
  decisions: {
    RETRIEVE: "Authorized, relevant, and current enough to use directly.",
    RETRIEVE_WITH_CONTEXT:
      "Authorized and relevant but not from this conversation (or inferred); it may be used only with its origin stated.",
    DEFER: "Not retrieved for this turn: insufficient relevance, confidence, or necessity. The memory is retained, not deleted.",
    REJECT:
      "Refused outright: owner mismatch, wrong session, tampered provenance, or an unauthorized scope. Never reaches the model.",
  },
  thresholds: {
    persistentRelevance: SOVEREIGNTY_POLICY.persistentRelevance,
    historicalRelevance: SOVEREIGNTY_POLICY.historicalRelevance,
    sensitiveHistoricalRelevance: SOVEREIGNTY_POLICY.sensitiveHistoricalRelevance,
    derivedRelevance: SOVEREIGNTY_POLICY.derivedRelevance,
    derivedConfidence: SOVEREIGNTY_POLICY.derivedConfidence,
  },
  precedence: [
    "ownership",
    "session isolation",
    "provenance integrity",
    "scope",
    "relevance",
    "confidence",
  ],
  nonNegotiable: [
    "A conversation never silently inherits another conversation's transcript or active emotional context.",
    "Historical information stays historical: it is never presented as something said now.",
    "An inference is never promoted to an established fact.",
    "Session memory never becomes persistent memory by accident.",
    "Retrieval relevance is not authorization.",
  ],
} as const;

/* ------------------------------ words ------------------------------ */

/**
 * Words that carry an instruction or a request but no subject. A query
 * made only of these ("can you fix it?") names nothing, so it cannot
 * authorize historical material on lexical overlap alone.
 */
const GENERIC_ACTION = new Set([
  "fix", "help", "work", "works", "working", "make", "made", "doing", "done",
  // Time words name WHEN, not WHAT. "How am I handling it now?" must not
  // authorize an unrelated stored fact just because it also says "now".
  "now", "today", "yesterday", "tomorrow", "currently", "lately", "soon",
  "later", "recently", "already", "ever",
  "need", "want", "please", "thing", "things", "stuff", "issue", "problem",
  "error", "again", "still", "just", "really", "something", "anything",
  "can", "could", "would", "should", "will", "you", "your", "there", "here",
  "this", "that", "these", "those", "with", "from", "about", "what", "when",
  "where", "which", "who", "how", "why", "does", "did", "have", "has",
  "been", "being", "tell", "show", "give", "take", "look", "check", "turn",
  "start", "stop", "open", "close", "run", "get", "got", "put", "use",
  "using", "used", "like", "seem", "seems", "kind", "maybe", "sure",
]);

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "but", "not", "all", "any",
  "some", "very", "more", "most", "than", "then", "also", "into", "over",
  "under", "its", "it's", "i'm", "i've", "we're", "our", "ours", "mine",
]);

/** Explicit recall cues: the user is asking about something from before. */
const RECALL_CUE =
  /\b(remember|remembered|recall|earlier|previously|last time|before|we (?:discussed|talked|said|decided)|you (?:know|said) (?:about|that)|back to|that (?:project|chat|conversation|idea)|as we)\b/i;

/**
 * Material that must not drift between conversations as if it were
 * small talk: bereavement, illness, crisis, family loss. Kept as a
 * deterministic list so the rule is auditable rather than a model's
 * judgement.
 */
const SENSITIVE_HISTORY =
  /\b(died|death|dying|passed away|funeral|grief|grieving|mourning|loss|lost (?:my|her|his|our)|cancer|diagnosis|diagnosed|illness|surgery|hospital|depress(?:ed|ion)|anxiety|panic attack|suicid\w*|abuse|divorce|breakup|broke up|miscarriage|widow\w*|terminal)\b/i;

/** Words that ask about the person in general, authorizing broad recall. */
const BROAD_PERSONAL =
  /\b(tell me about (?:myself|me)|what do you (?:know|remember) about me|what have you (?:learned|remembered) about me|my (?:profile|preferences|goals|projects|history))\b/i;

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function words(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Subject words: what the query is ABOUT, stripped of instructions. */
export function subjectWords(text: string): string[] {
  return words(text).filter((word) => !GENERIC_ACTION.has(word));
}

/**
 * One token per concept, for both the query and the memory.
 *
 * Possessives and the common irregular forms matter here: "my father's
 * death" and "my father died" are the same subject, and a matcher that
 * cannot see that defers a question the user asked directly.
 */
const EQUIVALENT: Record<string, string> = {
  died: "death",
  dying: "death",
  dead: "death",
  deaths: "death",
  grief: "grief",
  grieving: "grief",
  mourned: "grief",
  lost: "loss",
  losing: "loss",
  loste: "loss",
};

function stemOf(word: string): string {
  const base = word.replace(/'s$/, "").replace(/'$/, "");
  if (EQUIVALENT[base]) return EQUIVALENT[base];
  if (base.endsWith("ies") && base.length > 5) return `${base.slice(0, -3)}y`;
  if (base.endsWith("ing") && base.length > 6) return base.slice(0, -3);
  if (base.endsWith("ed") && base.length > 5) return base.slice(0, -2);
  if (base.endsWith("es") && base.length > 5) return base.slice(0, -2);
  if (base.endsWith("s") && base.length > 4) return base.slice(0, -1);
  return base;
}

/**
 * Share of the query's SUBJECT words that the memory actually covers.
 * 0 means the memory says nothing about what was asked.
 */
export function subjectRelevance(query: string, text: string): number {
  const subjects = subjectWords(query);
  if (subjects.length === 0) return 0;
  const haystack = new Set(words(text).map(stemOf));
  let hits = 0;
  for (const subject of subjects) {
    if (haystack.has(subject) || haystack.has(stemOf(subject))) hits += 1;
  }
  return hits / subjects.length;
}

/** Is this material emotionally private enough to need a real subject match? */
export function isSensitiveHistory(text: string): boolean {
  if (SENSITIVE_HISTORY.test(text)) return true;
  try {
    const reading = appraise(text);
    return reading.intensity >= 0.7 && !reading.guarded;
  } catch {
    return false;
  }
}

/* ---------------------------- provenance ---------------------------- */

function scopeForType(type: MemoryType): MemoryScope {
  switch (type) {
    case "conversation":
      return "session";
    default:
      // Facts about the user, about LÉLU, knowledge and system state are
      // durable by nature; history is decided by origin, not by type.
      return "persistent-user";
  }
}

function sourceForType(type: MemoryType): MemorySourceType {
  switch (type) {
    case "self":
    case "system":
      return "lelu-observed";
    case "knowledge":
      return "external-tool";
    default:
      return "user-said";
  }
}

function isScope(value: unknown): value is MemoryScope {
  return (
    value === "current-conversation" ||
    value === "historical-conversation" ||
    value === "persistent-user" ||
    value === "session" ||
    value === "derived"
  );
}

function isSource(value: unknown): value is MemorySourceType {
  return (
    value === "user-said" ||
    value === "lelu-observed" ||
    value === "agent-reported" ||
    value === "inferred" ||
    value === "external-tool"
  );
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/**
 * Provenance for a record written before provenance existed.
 *
 * It is explicitly and conservatively HISTORICAL: no owner, no
 * conversation, no session. It may still be recalled as something
 * previously learned, and it can never be described as said here.
 */
export function legacyOrigin(pattern: ResponsePattern): MemoryOrigin {
  const type = (pattern.memoryType ?? "user") as MemoryType;
  return {
    memoryId: pattern.id,
    userId: null,
    originatingConversationId: null,
    originatingSessionId: null,
    originatingConversationTitle: null,
    createdAt: pattern.createdAt,
    updatedAt: pattern.updatedAt,
    scope: type === "conversation" ? "session" : "historical-conversation",
    sourceType: sourceForType(type),
    confidence: clamp01(pattern.confidence, 0.5),
    persistence: type === "conversation" ? "session" : "persistent",
    retention: type === "conversation" ? "session" : "durable",
  };
}

/** Read (and validate) the provenance attached to a memory. */
export function readOrigin(pattern: ResponsePattern): MemoryOrigin {
  const raw = pattern.context?.origin as Partial<MemoryOrigin> | undefined;
  if (!raw || typeof raw !== "object") return legacyOrigin(pattern);

  const type = (pattern.memoryType ?? "user") as MemoryType;
  const inferred =
    raw.sourceType === "inferred" || pattern.context?.inferred === true;
  const scope = isScope(raw.scope) ? raw.scope : inferred ? "derived" : scopeForType(type);
  const sourceType = isSource(raw.sourceType)
    ? raw.sourceType
    : inferred
      ? "inferred"
      : sourceForType(type);

  return {
    memoryId: typeof raw.memoryId === "string" ? raw.memoryId : pattern.id,
    userId: typeof raw.userId === "string" ? raw.userId : null,
    originatingConversationId:
      typeof raw.originatingConversationId === "string"
        ? raw.originatingConversationId
        : null,
    originatingSessionId:
      typeof raw.originatingSessionId === "string" ? raw.originatingSessionId : null,
    originatingConversationTitle:
      typeof raw.originatingConversationTitle === "string"
        ? raw.originatingConversationTitle
        : null,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : pattern.createdAt,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : pattern.updatedAt,
    scope,
    sourceType,
    confidence: clamp01(raw.confidence ?? pattern.confidence, 0.5),
    persistence:
      raw.persistence === "session" || raw.persistence === "derived"
        ? raw.persistence
        : "persistent",
    retention:
      raw.retention === "session" || raw.retention === "expires"
        ? raw.retention
        : "durable",
  };
}

export interface OriginInput {
  memoryId: string;
  userId?: string | null;
  conversationId?: string | null;
  sessionId?: string | null;
  conversationTitle?: string | null;
  sourceType?: MemorySourceType;
  scope?: MemoryScope;
  confidence?: number;
  now?: number;
}

/** Build the provenance written alongside a new memory. */
export function createOrigin(input: OriginInput): MemoryOrigin {
  const now = input.now ?? Date.now();
  const sourceType = input.sourceType ?? "user-said";
  const scope =
    input.scope ??
    (sourceType === "inferred"
      ? "derived"
      : input.conversationId
        ? "current-conversation"
        : "persistent-user");
  return {
    memoryId: input.memoryId,
    userId: input.userId ?? null,
    originatingConversationId: input.conversationId ?? null,
    originatingSessionId: input.sessionId ?? null,
    originatingConversationTitle: input.conversationTitle ?? null,
    createdAt: now,
    updatedAt: now,
    scope,
    sourceType,
    confidence: clamp01(input.confidence, 0.8),
    persistence: scope === "derived" ? "derived" : scope === "session" ? "session" : "persistent",
    retention: scope === "session" ? "session" : "durable",
  };
}

/* ---------------------------- session id ---------------------------- */

let runtimeSessionId: string = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The runtime session this tab/app instance is running in. */
export function currentSessionId(): string {
  return runtimeSessionId;
}

/** Test seam: a new app start is a new session. */
export function resetSessionForTests(sessionId?: string): string {
  runtimeSessionId =
    sessionId ??
    `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return runtimeSessionId;
}

/* ---------------------------- decisions ---------------------------- */

function relationOf(origin: MemoryOrigin, ctx: MemoryScopeContext): RetrievalDecisionRecord["relation"] {
  if (!origin.originatingConversationId) return "no-conversation";
  if (!ctx.conversationId) return "unknown-conversation";
  return origin.originatingConversationId === ctx.conversationId
    ? "this-conversation"
    : "other-conversation";
}

function record(
  pattern: ResponsePattern,
  origin: MemoryOrigin,
  ctx: MemoryScopeContext,
  decision: MemoryDecision,
  reason: string,
  relevance: number,
): RetrievalDecisionRecord {
  return {
    memoryId: pattern.id,
    decision,
    reason,
    scope: origin.scope,
    sourceType: origin.sourceType,
    relevance: Math.round(relevance * 1000) / 1000,
    relation: relationOf(origin, ctx),
    originatingConversationId: origin.originatingConversationId,
  };
}

/**
 * May this memory be considered at all?
 *
 * This is the hard boundary used by retrieval itself (PatternMemory),
 * so an ineligible memory is never a candidate — not merely filtered
 * later at rendering time.
 */
export function isEligible(pattern: ResponsePattern, ctx: MemoryScopeContext): boolean {
  const origin = readOrigin(pattern);

  if (SOVEREIGNTY_POLICY.verifyMemoryIdentity && origin.memoryId !== pattern.id) {
    return false;
  }

  // Ownership. A recorded owner that is not the current user is a hard
  // refusal; a memory with no owner recorded (legacy/migrated) is not
  // claimed by anyone and is treated as historical.
  if (origin.userId && ctx.userId && origin.userId !== ctx.userId) return false;

  // Session isolation: session-scoped material never crosses sessions.
  if (origin.scope === "session") {
    if (!origin.originatingSessionId) return false;
    if (origin.originatingSessionId !== ctx.sessionId) return false;
  }

  // Derived material is owned by the reasoning that produced it and is
  // only ever shown as an inference (see decide()).
  return true;
}

/**
 * The deterministic retrieval decision for one memory.
 *
 * Order is fixed and documented in POLICY_AS_JSON: ownership, session,
 * provenance integrity, scope, relevance, confidence.
 */
export function decide(
  pattern: ResponsePattern,
  ctx: MemoryScopeContext,
): RetrievalDecisionRecord {
  const origin = readOrigin(pattern);
  // Defensive, because this boundary is also called directly by tests and by
  // agents with records that never passed through MemoryBridge's sanitiser:
  // a persisted record with no keywords must read as "no keyword evidence",
  // not throw out of retrieval.
  const keywordText = Array.isArray(pattern.keywords) ? pattern.keywords.join(" ") : "";
  const text = `${pattern.prompt ?? ""} ${pattern.response ?? ""} ${keywordText}`;
  const relevance = subjectRelevance(ctx.prompt, text);
  const sensitive = isSensitiveHistory(`${pattern.prompt} ${pattern.response}`);
  const relation = relationOf(origin, ctx);
  const broad = BROAD_PERSONAL.test(ctx.prompt);
  const cue = RECALL_CUE.test(ctx.prompt);
  const otherConversation = Boolean(
    origin.originatingConversationId &&
      ctx.conversationId &&
      origin.originatingConversationId !== ctx.conversationId,
  );

  /* 1. Provenance integrity. */
  if (SOVEREIGNTY_POLICY.verifyMemoryIdentity && origin.memoryId !== pattern.id) {
    return record(pattern, origin, ctx, "REJECT", "provenance id does not match the record it describes", relevance);
  }

  /* 2. Ownership. */
  if (origin.userId && ctx.userId && origin.userId !== ctx.userId) {
    return record(pattern, origin, ctx, "REJECT", "owner mismatch — memory belongs to another user", relevance);
  }

  /* 3. Session isolation. */
  if (origin.scope === "session") {
    if (!origin.originatingSessionId) {
      return record(pattern, origin, ctx, "DEFER", "session memory with no recorded session cannot be validated", relevance);
    }
    if (origin.originatingSessionId !== ctx.sessionId) {
      return record(pattern, origin, ctx, "REJECT", "session memory from another runtime session", relevance);
    }
    return record(pattern, origin, ctx, "RETRIEVE", "session memory belonging to this session", relevance);
  }

  /* 4. Inferred material is never a fact. */
  if (origin.sourceType === "inferred" || origin.scope === "derived") {
    if (origin.confidence < SOVEREIGNTY_POLICY.derivedConfidence) {
      return record(pattern, origin, ctx, "DEFER", "inference below the confidence floor", relevance);
    }
    if (relevance < SOVEREIGNTY_POLICY.derivedRelevance) {
      return record(pattern, origin, ctx, "DEFER", "inference not relevant to this request", relevance);
    }
    return record(
      pattern, origin, ctx, "RETRIEVE_WITH_CONTEXT",
      "inference — may inform, must be named as an inference, never stated as fact",
      relevance,
    );
  }

  /* 5. Same conversation: the highest-priority, fully authorized source. */
  if (relation === "this-conversation") {
    return record(pattern, origin, ctx, "RETRIEVE", "stated in this conversation", relevance);
  }

  /* 6. Emotionally private history needs a real subject match. */
  if (sensitive) {
    if (relevance < SOVEREIGNTY_POLICY.sensitiveHistoricalRelevance) {
      return record(
        pattern, origin, ctx, "DEFER",
        "emotionally private history with no subject overlap in this request",
        relevance,
      );
    }
    return record(
      pattern, origin, ctx, "RETRIEVE_WITH_CONTEXT",
      "emotionally private history retrieved as history — not this conversation's mood",
      relevance,
    );
  }

  /* 7. Historical transcript material must be about something asked. */
  if (origin.scope === "historical-conversation" || relation === "other-conversation") {
    if (relevance >= SOVEREIGNTY_POLICY.historicalRelevance || (cue && relevance > 0)) {
      return record(
        pattern, origin, ctx, "RETRIEVE_WITH_CONTEXT",
        "relevant history from another conversation — origin must be stated",
        relevance,
      );
    }
    return record(pattern, origin, ctx, "DEFER", "history with insufficient subject relevance", relevance);
  }

  /* 8. Persistent user facts: authorized on modest overlap, or a broad ask. */
  if (origin.scope === "persistent-user") {
    if (relevance >= SOVEREIGNTY_POLICY.persistentRelevance || broad) {
      const decision: MemoryDecision =
        otherConversation || relation === "unknown-conversation"
          ? "RETRIEVE_WITH_CONTEXT"
          : "RETRIEVE";
      return record(
        pattern, origin, ctx, decision,
        otherConversation
          ? "durable fact learned in another conversation — say where it came from"
          : "durable fact relevant to this request",
        relevance,
      );
    }
    return record(pattern, origin, ctx, "DEFER", "durable fact unrelated to this request", relevance);
  }

  return record(pattern, origin, ctx, "DEFER", "no retrieval rule authorized this memory", relevance);
}

/** Authorize a whole recall set, preserving order (best-ranked first). */
export function authorize(
  memories: ResponsePattern[],
  ctx: MemoryScopeContext,
): AuthorizationResult {
  const counts: Record<MemoryDecision, number> = {
    RETRIEVE: 0,
    RETRIEVE_WITH_CONTEXT: 0,
    DEFER: 0,
    REJECT: 0,
  };
  const allowed: ResponsePattern[] = [];
  const decisions: RetrievalDecisionRecord[] = [];

  for (const memory of memories) {
    const decision = decide(memory, ctx);
    counts[decision.decision] += 1;
    decisions.push(decision);
    if (decision.decision === "RETRIEVE" || decision.decision === "RETRIEVE_WITH_CONTEXT") {
      allowed.push(memory);
    }
  }

  return { allowed, decisions, counts };
}

/* ----------------------------- labelling ----------------------------- */

/**
 * How a memory must be introduced to the model, if at all.
 *
 * The labels are short because they ride inside the context; the
 * instruction block (memoryContextNote) explains them once.
 */
export function originLabel(pattern: ResponsePattern, conversationId?: string | null): string {
  const origin = readOrigin(pattern);
  if (origin.sourceType === "inferred" || origin.scope === "derived") return "[inferred]";
  if (!origin.originatingConversationId) return "";
  if (!conversationId || origin.originatingConversationId === conversationId) return "";
  return origin.originatingConversationTitle
    ? `[earlier conversation “${origin.originatingConversationTitle}”]`
    : "[earlier conversation]";
}

/**
 * The one instruction that makes labels meaningful. Only added when the
 * turn actually carries historical or inferred material, so an ordinary
 * turn pays no tokens for it.
 */
export function memoryContextNote(decisions: RetrievalDecisionRecord[]): string {
  const historical = decisions.some(
    (d) => d.decision === "RETRIEVE_WITH_CONTEXT" && d.relation === "other-conversation",
  );
  const inferred = decisions.some(
    (d) => d.decision === "RETRIEVE_WITH_CONTEXT" && d.sourceType === "inferred",
  );
  if (!historical && !inferred) return "";

  const lines = ["## Memory provenance (read before answering)"];
  if (historical) {
    // Measured live: "they are not something the user said here" was read as
    // "the user never said this", and the model denied having a memory that
    // was in its own context. These ARE the user's words — from another chat.
    lines.push(
      "- Lines marked [earlier conversation …] ARE things the user told you, in a DIFFERENT chat. Do not say you have no memory of them, and never say \"you just told me\". If one bears on the question, name where it came from in the same sentence, e.g. \"From our “…” chat: …\".",
    );
  }
  if (inferred) {
    lines.push(
      "- Lines marked [inferred] are your own reasoning, not something the user stated. Offer them as a possibility, never as an established fact.",
    );
  }
  lines.push(
    "- The current message is the only evidence of the user's present state. A remembered emotion is history, not their mood now: do not comfort them about something that is not happening in this conversation unless they raise it.",
  );
  return lines.join("\n");
}

/** Compact one-line summary for the cognitive trace. */
export function summarizeDecisions(decisions: RetrievalDecisionRecord[]): string {
  const counts: Record<string, number> = {};
  for (const decision of decisions) {
    counts[decision.decision] = (counts[decision.decision] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([decision, count]) => `${decision}:${count}`)
    .join(" ");
}
