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

import type ResponsePattern from "./ResponsePattern";

/** Long-term durability gate: below this, facts stay session-scoped. */
const DURABILITY_THRESHOLD = 0.5;

/** Correction markers: the speaker is updating/replacing earlier info. */
const CORRECTION_MARKERS =
  /(actually|no longer|not anymore|changed|instead|correction|update|never mind|scrap that|forget that|didn't|doesn't|wasn't|isn't|not really|actually i|i changed|i no longer)/i;

export default class MemoryEngine {
  constructor(
    private readonly memory: PatternMemory,
  ) {}

  /**
   * Learn and consolidate memory. Returns the patterns that were
   * persisted or reinforced; [] means nothing durable was said.
   */
  public async learn(prompt: string, response: string): Promise<ResponsePattern[]> {
    const text = prompt.trim();
    if (text.length < 2) {
      return [];
    }

    const candidates = new MemoryExtractor().extract(text, response);

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
        const pattern = await this.create(candidate, text, now);
        persisted.push(pattern);
        continue;
      }

      const contentOverlap = this.overlap(existing.response, candidate.content);
      const promptOverlap = this.overlap(existing.response, text);
      const keywordOverlap = candidate.keywords.filter((word) => existing.keywords.includes(word)).length;
      const isCorrection = CORRECTION_MARKERS.test(text);

      if (contentOverlap >= 0.6) {
        // Same fact restated → REINFORCE.
        await this.reinforce(existing, candidate.keywords, now);
        persisted.push(existing);
      } else if (isCorrection && (contentOverlap >= 0.33 || promptOverlap >= 0.33 || keywordOverlap >= 1)) {
        // Newer statement contradicts/updates the old one → SUPERSEDE.
        await this.supersede(existing, candidate, now);
        persisted.push(existing);
      } else if (contentOverlap >= 0.33 || promptOverlap >= 0.33) {
        // Related but distinct → MERGE keywords, keep the fuller content.
        await this.merge(existing, candidate, now);
        persisted.push(existing);
      } else {
        // Genuinely different fact → CREATE.
        const pattern = await this.create(candidate, text, now);
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

    for (const memory of memories) {
      if (memory.category !== category) {
        continue;
      }
      if (memory.id === "lelu-identity-foundation") {
        continue;
      }

      const contentOverlap = this.overlap(memory.response, content);
      const promptOverlap = this.overlap(memory.response, prompt);
      const keywordOverlap = keywords.filter((word) => memory.keywords.includes(word)).length;
      const isCorrection = CORRECTION_MARKERS.test(prompt);

      if (
        contentOverlap >= 0.33 ||
        promptOverlap >= 0.33 ||
        (isCorrection && keywordOverlap >= 1)
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
  private async reinforce(existing: ResponsePattern, keywords: string[], now: number): Promise<void> {
    existing.successfulUses += 1;
    existing.confidence = existing.successfulUses / Math.max(1, existing.successfulUses + existing.failedUses);
    existing.keywords = [...new Set([...existing.keywords, ...keywords])];
    existing.updatedAt = now;
    await this.memory.update(existing);
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
      history: history.slice(-8),
      corrected: now,
    };
    existing.successfulUses += 1;
    existing.confidence = 1;
    existing.updatedAt = now;
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
  ): Promise<void> {
    if (incoming.content.length > existing.response.length) {
      existing.response = incoming.content;
    }
    existing.keywords = [...new Set([...existing.keywords, ...incoming.keywords])];
    existing.importance = Math.max(existing.importance, incoming.importance);
    existing.successfulUses += 1;
    existing.updatedAt = now;
    await this.memory.update(existing);
  }

  /**
   * CREATE: persist a brand-new durable memory.
   */
  private async create(
    candidate: { category: string; content: string; keywords: string[]; importance: number; memoryType?: string },
    prompt: string,
    now: number,
  ): Promise<ResponsePattern> {
    const pattern: ResponsePattern = {
      id: crypto.randomUUID(),
      category: candidate.category as ResponsePattern["category"],
      prompt,
      response: candidate.content,
      intent: "general",
      keywords: candidate.keywords,
      context: {
        source: "memory-engine",
        memoryCategory: candidate.category,
        consolidated: now,
      },
      memoryType: (candidate.memoryType ?? "user") as ResponsePattern["memoryType"],
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
  public async recall(query: string): Promise<ResponsePattern[]> {
    return await this.memory.search(query);
  }
}
