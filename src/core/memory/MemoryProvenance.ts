/**
 * ==========================================================
 * LÉLU — WHAT A REMEMBERED FACT IS, AND WHEN IT STOPPED BEING TRUE
 *
 * Mission 44.7 taught the reply path to ask \"did a tool back this
 * sentence?\". That question has no answer for the most common
 * sentence LÉLU writes: one that restates something she remembers.
 * There the evidence is a memory record — and a memory record can
 * be old, contradicted, corrected, or so thin that nobody can say
 * where it came from.
 *
 * This module reads a set of retrieved memories the way a careful
 * reader would, and says what each one is:
 *
 *   current      recorded recently and not contradicted
 *   historical   real, but older than a week
 *   stale        older than a month, or recorded at low confidence
 *   conflicting  another stored record in the same category disagrees
 *   superseded   a newer record contradicts THIS one
 *   incomplete   no recorded time or source, so it cannot be dated
 *
 * It creates no store and no second memory path. It is a reading of
 * the records `Brain.recall()` already returns, so the answer to
 * \"where does this come from?\" is available everywhere memory is.
 *
 * THE RULE THIS EXISTS FOR
 * ------------------------
 * Historical memory must never silently become a current fact. A
 * note that only says \"from memory\" is not enough: it has to say
 * WHEN, from WHICH chat, and whether anything since has disagreed.
 * memoryProvenanceNote() is therefore written to lead with the
 * limitation rather than end with it.
 * ==========================================================
 */

import type { ClaimEvidence } from "../tools/ClaimGrounding";

/** The minimum shape this module reads: what recall actually returns. */
export interface MemoryLike {
  /** Absent for projections (AIService.recall returns no ids); one is made. */
  id?: string;
  prompt?: string;
  response?: string;
  category?: string;
  keywords?: string[];
  importance?: number;
  confidence?: number;
  createdAt?: number;
  updatedAt?: number;
  memoryType?: string;
  context?: Record<string, unknown>;
}

/** Where a memory says it came from, when it says anything. */
export interface MemorySource {
  /** The chat it was learned in, when that was recorded. */
  conversationId?: string;
  conversationTitle?: string;
  /** Free-text attribution carried by the record or its provider. */
  attribution?: string;
  /** The provider that supplied it (local, supabase, og-archive…). */
  provider?: string;
}

export type MemoryStatus =
  | "current"
  | "historical"
  | "stale"
  | "conflicting"
  | "superseded"
  | "incomplete";

/** One record, read. */
export interface MemoryReading {
  id: string;
  content: string;
  category: string;
  status: MemoryStatus;
  /**
   * The five classifications Mission 44.7 established, reused rather than
   * replaced: a memory read here is \"memory\" unless the record itself
   * carries stronger evidence (a tool-backed write from this turn, a
   * hedge that makes it an inference, or no provenance at all).
   */
  evidence: ClaimEvidence;
  source: MemorySource;
  /** When the fact was first recorded, or null when nothing says. */
  recordedAt: number | null;
  /** When it was last reinforced or corrected. */
  updatedAt: number | null;
  /** When this reading happened — always now. */
  retrievedAt: number;
  /** A tool result or an explicit flag backs the record's content. */
  verified: boolean;
  /** The record says it is a conclusion, not an observation. */
  inference: boolean;
  /** Earlier statements this record supersedes (kept in its own history). */
  supersedes: string[];
  /** Ids of records that disagree with this one. */
  conflictedWith: string[];
  /** Why it was classified this way, in words a person can check. */
  reasons: string[];
}

export interface MemoryConflict {
  a: string;
  b: string;
  /** How this module resolves it, and how much that resolution is worth. */
  resolution: "newer-wins" | "unresolved";
  note: string;
}

export interface MemoryReadingResult {
  records: MemoryReading[];
  conflicts: MemoryConflict[];
  retrievedAt: number;
  counts: Record<MemoryStatus, number>;
}

/** Older than this, a memory is history rather than the current picture. */
export const HISTORICAL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Older than this, it is stale — and may well have been true once. */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** Below this confidence the record itself is hedged. */
export const WEAK_CONFIDENCE = 0.5;

/** '%s' in a memory's logger is not a sentence: strip shapes that carry no fact. */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Content overlap, as MemoryEngine and MemorySynthesizer both compute it. */
function overlap(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9'\s-]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );
  const setA = words(a);
  const setB = words(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

/** Does one of these read as a correction of the other? */
function negates(a: string, b: string): boolean {
  const correction =
    /(no longer|actually|not anymore|changed|instead|never|don'?t|doesn'?t|isn'?t|wasn'?t|stopped|not\b)/i;
  return correction.test(b) !== correction.test(a);
}

/** A human age, from milliseconds. */
export function describeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** A short ISO day for a timestamp, or "" when there is none. */
export function dayOf(at: number | null): string {
  if (at === null || !Number.isFinite(at)) return "";
  return new Date(at).toISOString().slice(0, 10);
}

/** Read one record's provenance without judging it against the others. */
function sourceOf(record: MemoryLike): MemorySource {
  const context = record.context ?? {};
  const source: MemorySource = {};
  const conversationId = context.conversationId;
  const conversationTitle = context.conversationTitle;
  const attribution = context.attribution ?? context.source;
  const provider = context.provider ?? context.providerId;
  if (typeof conversationId === "string" && conversationId) source.conversationId = conversationId;
  if (typeof conversationTitle === "string" && conversationTitle) source.conversationTitle = conversationTitle;
  if (typeof attribution === "string" && attribution) source.attribution = attribution;
  if (typeof provider === "string" && provider) source.provider = provider;
  return source;
}

/** Earlier statements the record keeps, from the supersede path. */
function historyOf(record: MemoryLike): string[] {
  const history = record.context?.history;
  return Array.isArray(history)
    ? history.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

/**
 * Read a set of retrieved memories: classify each, pair up conflicts, and
 * keep every reason so a person can audit the classification rather than
 * trust it.
 *
 * Order does not matter: conflicts are found by comparing every pair in a
 * category, so a caller that passes records newest-first and one that
 * passes them oldest-first get the same answer.
 */
export function readMemory(
  records: readonly MemoryLike[],
  options: { now?: number } = {},
): MemoryReadingResult {
  const now = options.now ?? Date.now();

  const readings: MemoryReading[] = records.map((record, index) => {
    const content = clean(record.response ?? "");
    const recordedAt = typeof record.createdAt === "number" ? record.createdAt : null;
    const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : null;
    const at = updatedAt ?? recordedAt;
    const confidence = typeof record.confidence === "number" ? record.confidence : 1;
    const context = record.context ?? {};
    const inference = context.inferred === true || context.inference === true;
    const verified = context.executionVerified === true || context.verified === true;
    const source = sourceOf(record);
    const supersedes = historyOf(record);

    const reasons: string[] = [];
    let status: MemoryStatus = "current";

    if (at === null) {
      status = "incomplete";
      reasons.push("no recorded time, so it cannot be dated");
    } else if (content.length < 8) {
      status = "incomplete";
      reasons.push("the stored text is too short to carry a fact");
    } else if (confidence < WEAK_CONFIDENCE) {
      status = "stale";
      reasons.push(`recorded at low confidence (${confidence.toFixed(2)})`);
    } else {
      const age = now - at;
      if (age > STALE_AFTER_MS) {
        status = "stale";
        reasons.push(`recorded ${describeAge(age)}`);
      } else if (age > HISTORICAL_AFTER_MS) {
        status = "historical";
        reasons.push(`recorded ${describeAge(age)}`);
      } else {
        reasons.push(`recorded ${describeAge(age)}`);
      }
    }

    if (!source.conversationId && !source.conversationTitle && !source.attribution && !source.provider) {
      reasons.push("the record does not say where it came from");
      if (status === "current") status = "incomplete";
    }
    if (supersedes.length > 0) {
      reasons.push(`it supersedes ${supersedes.length} earlier statement${supersedes.length === 1 ? "" : "s"}`);
    }

    const evidence: ClaimEvidence = inference
      ? "inference"
      : verified
        ? "current-turn"
        : source.conversationId || source.attribution || at !== null
          ? "memory"
          : "unverified";

    return {
      id: record.id ?? `memory-${index + 1}`,
      content,
      category: record.category ?? "general",
      status,
      evidence,
      source,
      recordedAt,
      updatedAt,
      retrievedAt: now,
      verified,
      inference,
      supersedes,
      conflictedWith: [],
      reasons,
    };
  });

  const conflicts: MemoryConflict[] = [];
  for (let i = 0; i < readings.length; i += 1) {
    for (let j = i + 1; j < readings.length; j += 1) {
      const a = readings[i];
      const b = readings[j];
      if (a.id === b.id || a.category !== b.category) continue;
      if (overlap(a.content, b.content) < 0.33) continue;
      if (!negates(a.content, b.content)) continue;

      const aAt = a.updatedAt ?? a.recordedAt ?? 0;
      const bAt = b.updatedAt ?? b.recordedAt ?? 0;
      const newer = aAt === bAt ? null : aAt > bAt ? a : b;
      const older = newer === a ? b : a;

      // The newer record is the contested one (something old disagrees);
      // the older one has been superseded. Both are reported, because a
      // reader needs to know BOTH halves of a contradiction.
      if (newer) {
        newer.status = "conflicting";
        newer.reasons.push("a stored record it contradicts is still present");
        newer.conflictedWith.push(older.id);
        older.status = "superseded";
        older.reasons.push("a newer stored record contradicts it");
        older.conflictedWith.push(newer.id);
      } else {
        a.status = "conflicting";
        b.status = "conflicting";
        a.conflictedWith.push(b.id);
        b.conflictedWith.push(a.id);
      }

      conflicts.push({
        a: a.id,
        b: b.id,
        resolution: newer ? "newer-wins" : "unresolved",
        note: newer
          ? `"${a.content.slice(0, 80)}" and "${b.content.slice(0, 80)}" disagree; the newer one is treated as current, but neither was verified in this turn.`
          : `"${a.content.slice(0, 80)}" and "${b.content.slice(0, 80)}" disagree and carry the same time, so there is no honest way to choose between them.`,
      });
    }
  }

  const counts: Record<MemoryStatus, number> = {
    current: 0,
    historical: 0,
    stale: 0,
    conflicting: 0,
    superseded: 0,
    incomplete: 0,
  };
  for (const reading of readings) counts[reading.status] += 1;

  return { records: readings, conflicts, retrievedAt: now, counts };
}

/** Where one record came from, in one clause, or "" when nothing says. */
export function sourceClause(reading: MemoryReading): string {
  const parts: string[] = [];
  if (reading.source.conversationTitle) parts.push(`from the chat “${reading.source.conversationTitle}”`);
  else if (reading.source.conversationId) parts.push(`from conversation ${reading.source.conversationId}`);
  if (reading.source.attribution) parts.push(`attributed to ${reading.source.attribution}`);
  if (reading.source.provider) parts.push(`via ${reading.source.provider}`);
  return parts.join(", ");
}

/** One record, as a line a reader can audit. */
export function describeReading(reading: MemoryReading): string {
  const bits: string[] = [reading.status];
  if (reading.recordedAt !== null) {
    bits.push(`recorded ${dayOf(reading.recordedAt)} (${describeAge(reading.retrievedAt - reading.recordedAt)})`);
  } else {
    bits.push("not dated");
  }
  const source = sourceClause(reading);
  if (source) bits.push(source);
  if (reading.verified) bits.push("backed by a tool result");
  if (reading.inference) bits.push("an inference, not an observation");
  return bits.join(" · ");
}

/**
 * The note a reply carries when it restates memory.
 *
 * Leads with the limitation ("not a fresh check") because a reader who
 * stops after the first clause has still been told the important part,
 * then names what is wrong: conflicts, superseded values, records with no
 * date or source.
 */
export function memoryProvenanceNote(
  result: MemoryReadingResult,
  options: { limit?: number } = {},
): string {
  const { records } = result;
  if (records.length === 0) return "";
  const limit = options.limit ?? 3;
  const parts: string[] = [];

  const weakest = records.filter((reading) => reading.status !== "current");
  if (weakest.length > 0) {
    parts.push(
      `⚠️ From memory, not a fresh check: ${weakest
        .slice(0, limit)
        .map((reading) => `“${reading.content.slice(0, 90)}” — ${describeReading(reading)}`)
        .join("; ")}.`,
    );
  }

  for (const conflict of result.conflicts.slice(0, 2)) {
    parts.push(`⚠️ Memory conflict: ${conflict.note}`);
  }

  const superseding = records.filter((reading) => reading.supersedes.length > 0);
  for (const reading of superseding.slice(0, 2)) {
    const earlier = reading.supersedes.at(-1)?.slice(0, 120) ?? "";
    if (earlier) {
      parts.push(
        `The earlier statement “${earlier}” is superseded by “${reading.content.slice(0, 90)}”; ` +
          "it is kept only for the details the correction does not mention.",
      );
    }
  }

  return parts.join("\n");
}

/**
 * The lines `memory.recall` returns to the model.
 *
 * A tool that returns bare content teaches the model that memory is
 * timeless. Returning the date, the source and any conflict teaches it what
 * the record is actually worth — the same discipline Mission 44.7 applied to
 * tool results, applied to memory.
 */
export function memoryToolLines(
  result: MemoryReadingResult,
  options: { limit?: number } = {},
): string[] {
  const limit = options.limit ?? 8;
  const lines = result.records.slice(0, limit).map((reading, index) => {
    const when = reading.recordedAt !== null ? `${dayOf(reading.recordedAt)}, ${describeAge(reading.retrievedAt - reading.recordedAt)}` : "undated";
    const source = sourceClause(reading);
    return `${index + 1}. [${reading.status}; ${when}${source ? `; ${source}` : ""}] ${reading.content}`;
  });
  for (const conflict of result.conflicts.slice(0, 2)) {
    lines.push(`! Conflict: ${conflict.note}`);
  }
  const noSource = result.records.filter((reading) => reading.status === "incomplete").length;
  if (noSource > 0) {
    lines.push(
      `${noSource} record${noSource === 1 ? " has" : "s have"} no recorded time or source — say so rather than presenting ${noSource === 1 ? "it" : "them"} as established fact.`,
    );
  }
  return lines;
}
