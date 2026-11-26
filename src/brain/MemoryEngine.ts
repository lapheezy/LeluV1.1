/**
 * ==========================================================
 * LÉLU
 * MEMORY ENGINE
 *
 * Selective writing + memory evolution over the ONE persistent
 * memory store. Every incoming interaction is evaluated before
 * anything is persisted:
 *
 *   NEW INFORMATION
 *     → extract candidate memories (category / type / importance)
 *     → reject what is not durable (pure conversation, trivia)
 *     → find the existing memory it relates to
 *     → decide: REINFORCE / MERGE / SUPERSEDE / CREATE / IGNORE
 *     → persist (with history preserved where useful)
 *
 * Corrections supersede: if the user corrects an earlier fact,
 * the newer statement wins and the old value is preserved in
 * context.history instead of producing a contradictory duplicate.
 * ==========================================================
 */

import MemoryExtractor from "./MemoryExtractor";
import PatternMemory from "./PatternMemory";
import {
  createOrigin,
  type MemoryScopeContext,
  type OriginInput,
} from "../core/memory/MemorySovereignty";

import type ResponsePattern from "./ResponsePattern";
import { normalizeMemoryType } from "./ResponsePattern";

/** Long-term durability gate: below this, facts stay session-scoped. */
const DURABILITY_THRESHOLD = 0.5;

/** Correction markers: the speaker is updating/replacing earlier info. */
const CORRECTION_MARKERS =
  /(actually|no longer|not anymore|changed|instead|correction|update|never mind|scrap that|forget that|didn't|doesn't|wasn't|isn't|not really|actually i|i changed|i no longer)/i;

/**
 * Where a memory came from, and whether the work behind it was observed.
 *
 * The caller (MemoryBridge, an agent, knowledge ingestion) already knows
 * this; before it was passed here, `Brain.learn` accepted it and dropped
 * it, so a remembered claim could not be told apart from a recorded fact
 * once it was stored. Provenance is carried on the pattern, next to the
 * fact it describes.
 */
export interface LearnProvenance {
  /** Who supplied the memory (`lelu-chat`, `research`, `agent:<name>`). */
  source?: string;
  /** Human-readable attribution, when the source names one. */
  attribution?: string;
  /** Keywords the caller already extracted, used for matching as well. */
  keywords?: string[];
  /** Extra provenance fields (executionVerified, redactedActionClaims, …). */
  context?: Record<string, unknown>;
}

/**
 * Is this statement phrased as a correction?
 *
 * Exported so the knowledge path (`Brain.persistLayer`) applies the same rule
 * the conversation path does, instead of a second regex that could drift.
 */
export function looksLikeCorrection(text: string): boolean {
  return CORRECTION_MARKERS.test(text);
}

/** Provenance as it is stored: the caller's fields, never invented ones. */
function provenanceFields(provenance: LearnProvenance): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...(provenance.context ?? {}) };
  if (provenance.source) fields.source = provenance.source;
  if (provenance.attribution) fields.attribution = provenance.attribution;
  return fields;
}

export default class MemoryEngine {
  constructor(
    private readonly memory: PatternMemory,
  ) {}

  /**
   * Learn and consolidate memory. Returns the patterns that were
   * persisted or reinforced; [] means nothing durable was said.
   */
  public async learn(
    prompt: string,
    response: string,
    provenance: LearnProvenance = {},
  ): Promise<ResponsePattern[]> {
    const text = prompt.trim();
    if (text.length < 2) {
      return [];
    }

    const candidates = new MemoryExtractor().extract(text, response);
    // Keywords the caller already extracted belong with the fact, and must
    // still match it on a later recall. They are added to the candidate the
    // extractor produced rather than replacing what it found.
    const supplied = provenance.keywords ?? [];
    if (supplied.length > 0) {
      for (const candidate of candidates) {
        candidate.keywords = [...new Set([...candidate.keywords, ...supplied])];
      }
    }

    // Selective writing: pure conversational filler (importance below
    // the durability gate) stays in the session's ConversationEngine
    // and is NOT persisted as long-term memory. Only durable facts
    // (identity, preferences, goals, skills, projects, relationships)
    // are consolidated.
    const durable = candidates.filter((candidate) => candidate.importance >= DURABILITY_THRESHOLD);

    if (durable.length === 0) {
      return [];
    }

    const persisted: ResponsePattern[] = [];

    for (const candidate of durable) {
      const existing = await this.findExisting(candidate.category, candidate.content, candidate.keywords, text);
      const now = Date.now();

      if (!existing) {
        const pattern = await this.create(candidate, text, now, provenance);
        persisted.push(pattern);
        continue;
      }

      const contentOverlap = this.overlap(existing.response, candidate.content);
      const promptOverlap = this.overlap(existing.response, text);
      const keywordOverlap = candidate.keywords.filter((word) => existing.keywords.includes(word)).length;
      const isCorrection = CORRECTION_MARKERS.test(text);

      // A CORRECTION IS CHECKED BEFORE "same thing restated".
      //
      // A correction usually shares most of its words with the statement it
      // corrects — "I prefer platinum, not rose gold" against "I prefer rose
      // gold" overlaps heavily — so the high-overlap reinforce branch used to
      // win and the old value stayed current. The newer statement must win,
      // and the old one survives in context.history.
      if (isCorrection && (contentOverlap >= 0.33 || promptOverlap >= 0.33 || keywordOverlap >= 1)) {
        // Newer statement contradicts/updates the old one → SUPERSEDE.
        await this.supersede(existing, candidate, now, provenance);
        persisted.push(existing);
      } else if (contentOverlap >= 0.6) {
        // Same fact restated → REINFORCE.
        await this.reinforce(existing, candidate.keywords, now, provenance);
        persisted.push(existing);
      } else if (contentOverlap >= 0.33 || promptOverlap >= 0.33) {
        // Related but distinct → MERGE keywords, keep the fuller content.
        await this.merge(existing, candidate, now, provenance);
        persisted.push(existing);
      } else {
        // Genuinely different fact → CREATE.
        const pattern = await this.create(candidate, text, now, provenance);
        persisted.push(pattern);
      }
    }

    return persisted;
  }

  /**
   * Find the existing memory this new fact most likely belongs to.
   */
  private async findExisting(
    category: string,
    content: string,
    keywords: string[],
    prompt: string,
  ): Promise<ResponsePattern | undefined> {
    // Search by the full statement: a correction like "actually I no
    // longer like coffee" must still find the stored coffee memory
    // even though the new durable content ("i prefer tea") shares no
    // words with it.
    const memories = await this.memory.search(prompt || content);

    // A correction is about an EXISTING fact, and the wording that corrects
    // it rarely lands in the same category: measured, "my studio … rose
    // gold" is extracted as `general` and "actually … platinum now" as
    // `experience`, so a same-category requirement made the correction a
    // SECOND competing fact instead of a supersession. Corrections are
    // therefore allowed to reach across categories — but only with two
    // shared keywords, so a single common word cannot merge an unrelated
    // memory by accident.
    const isCorrection = CORRECTION_MARKERS.test(prompt);

    for (const memory of memories) {
      if (memory.id === "lelu-identity-foundation") {
        continue;
      }
      const sameCategory = memory.category === category;
      if (!sameCategory && !isCorrection) {
        continue;
      }

      const contentOverlap = this.overlap(memory.response, content);
      const promptOverlap = this.overlap(memory.response, prompt);
      const keywordOverlap = keywords.filter((word) => memory.keywords.includes(word)).length;

      if (
        contentOverlap >= 0.33 ||
        promptOverlap >= 0.33 ||
        (isCorrection && keywordOverlap >= (sameCategory ? 1 : 2))
      ) {
        return memory;
      }
    }

    return undefined;
  }

  /**
   * REINFORCE: same fact stated again — strengthen confidence,
   * merge in any new keywords, refresh the timestamp.
   */
  private async reinforce(
    existing: ResponsePattern,
    keywords: string[],
    now: number,
    provenance: LearnProvenance,
  ): Promise<void> {
    existing.successfulUses += 1;
    existing.confidence = existing.successfulUses / Math.max(1, existing.successfulUses + existing.failedUses);
    existing.keywords = [...new Set([...existing.keywords, ...keywords])];
    const { originSeed: _seed, ...fields } = provenanceFields(provenance);
    existing.context = { ...existing.context, ...fields };
    // Strictly monotonic: a reinforcement in the same millisecond as the
    // write must still be later than it, or chronology (and the correction
    // test) depends on clock granularity.
    const stamp = Math.max(now, existing.updatedAt + 1);
    existing.updatedAt = stamp;
    this.touchOrigin(existing, stamp);
    await this.memory.update(existing);
  }

  /**
   * Provenance ages with the record. The ORIGIN never moves — learning a fact
   * again in another conversation must not rewrite where it was first learned,
   * or chronology becomes a lie. Only updatedAt advances.
   */
  private touchOrigin(pattern: ResponsePattern, now: number): void {
    const origin = pattern.context?.origin as Record<string, unknown> | undefined;
    if (origin && typeof origin === "object") {
      pattern.context = { ...pattern.context, origin: { ...origin, updatedAt: now } };
    }
  }

  /**
   * SUPERSEDE: newer information replaces the old. The previous
   * value is preserved in context.history so the correction is
   * traceable without ever serving the obsolete version again.
   */
  private async supersede(
    existing: ResponsePattern,
    incoming: { content: string; keywords: string[]; importance: number },
    now: number,
    provenance: LearnProvenance = {},
  ): Promise<void> {
    const history = Array.isArray(existing.context?.history) ? (existing.context.history as string[]) : [];
    const previous = existing.response;
    history.push(previous);

    // The correction is authoritative, but the statement it corrects
    // usually carries facts the correction says nothing about: "my
    // studio is Aurelia and I work in rose gold", corrected to
    // "platinum, not rose gold", must not take the studio name with it.
    // Replacing `response` outright deleted those. The superseded text
    // is kept alongside, explicitly labelled, so the unrelated facts
    // stay retrievable while the correction clearly wins.
    existing.response = previous && previous !== incoming.content
      ? `${incoming.content}\n(Superseded earlier statement, kept for the details it still carries: ${previous})`
      : incoming.content;
    existing.keywords = [...new Set([...existing.keywords, ...incoming.keywords])];
    existing.importance = Math.max(existing.importance, incoming.importance);
    existing.context = {
      ...existing.context,
      ...provenanceFields(provenance),
      history: history.slice(-8),
      corrected: now,
    };
    existing.successfulUses += 1;
    existing.confidence = 1;
    const stamp = Math.max(now, existing.updatedAt + 1);
    existing.updatedAt = stamp;
    this.touchOrigin(existing, stamp);
    await this.memory.update(existing);
  }

  /**
   * MERGE: related facts — combine keywords, keep the more complete
   * content, refresh the timestamp.
   */
  private async merge(
    existing: ResponsePattern,
    incoming: { content: string; keywords: string[]; importance: number },
    now: number,
    provenance: LearnProvenance = {},
  ): Promise<void> {
    if (incoming.content.length > existing.response.length) {
      existing.response = incoming.content;
    }
    existing.keywords = [...new Set([...existing.keywords, ...incoming.keywords])];
    existing.importance = Math.max(existing.importance, incoming.importance);
    existing.context = { ...existing.context, ...provenanceFields(provenance) };
    existing.successfulUses += 1;
    existing.updatedAt = now;
    this.touchOrigin(existing, now);
    await this.memory.update(existing);
  }

  /**
   * CREATE: persist a brand-new durable memory.
   */
  private async create(
    candidate: { category: string; content: string; keywords: string[]; importance: number; memoryType?: string },
    prompt: string,
    now: number,
    provenance: LearnProvenance = {},
  ): Promise<ResponsePattern> {
    const id = crypto.randomUUID();
    const rest = provenanceFields(provenance);
    const seed = (rest.originSeed ?? {}) as Partial<OriginInput>;
    delete rest.originSeed;

    const pattern: ResponsePattern = {
      id,
      category: candidate.category as ResponsePattern["category"],
      prompt,
      response: candidate.content,
      intent: "general",
      keywords: candidate.keywords,
      context: {
        source: "memory-engine",
        memoryCategory: candidate.category,
        consolidated: now,
        // The caller's provenance wins over the default source: it is the
        // only record of where the fact came from.
        ...rest,
        // WHERE, WHEN and WHOSE. Created here because this is where the id
        // exists; never left for a later reader to guess.
        origin: createOrigin({
          memoryId: id,
          userId: seed.userId ?? null,
          conversationId: seed.conversationId ?? null,
          sessionId: seed.sessionId ?? null,
          conversationTitle: seed.conversationTitle ?? null,
          sourceType: seed.sourceType ?? "user-said",
          scope:
            seed.scope ??
            (candidate.memoryType === "conversation" ? "session" : "persistent-user"),
          confidence: seed.confidence ?? Math.min(1, candidate.importance),
          now,
        }),
      },
      // WRITE SIDE OF THE SAME RULE: only the five cognitive layers are ever
      // persisted, whatever an extractor (or a legacy caller) supplied. A
      // stored value outside that set is what made recall crash later.
      memoryType: normalizeMemoryType(candidate.memoryType, candidate.category),
      importance: candidate.importance,
      confidence: 1,
      successfulUses: 1,
      failedUses: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.memory.add(pattern);
    return pattern;
  }

  /** Word-overlap ratio between two snippets. */
  private overlap(a: string, b: string): number {
    const wordsA = new Set(this.significantWords(a));
    const wordsB = new Set(this.significantWords(b));
    if (wordsA.size === 0 || wordsB.size === 0) {
      return 0;
    }
    let shared = 0;
    for (const word of wordsA) {
      if (wordsB.has(word)) {
        shared += 1;
      }
    }
    return shared / Math.min(wordsA.size, wordsB.size);
  }

  private significantWords(text: string): string[] {
    const generic = new Set([
      "building", "creating", "developing", "working", "making",
      "designing", "planning", "want", "need", "would", "could",
      "actually", "please", "really", "started", "trying",
      "love", "like", "prefer", "hate", "dislike", "enjoy",
      "favorite", "have", "having", "been", "being",
    ]);
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !generic.has(word));
  }

  /**
   * Recall: search the existing memory store.
   */
  public async recall(
    query: string,
    /** The current turn's identity: ownership, conversation and session. */
    scope?: MemoryScopeContext,
  ): Promise<ResponsePattern[]> {
    return await this.memory.search(query, scope);
  }
}
