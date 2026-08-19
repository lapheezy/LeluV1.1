/**
 * ==========================================================
 * LÉLU
 * MEMORY SYNTHESIZER
 *
 * The cognitive processing layer over the EXISTING memory
 * architecture. This is not another memory store — it turns
 * retrieved memories into a compact, evaluated understanding
 * before anything reaches the provider or the response.
 *
 * Retrieved memories do NOT automatically belong in the final
 * answer. Each one is evaluated for:
 *   - relevance to the actual request
 *   - importance / confidence / recency
 *   - whose memory it is (user / self / conversation / knowledge / system)
 *   - duplication with other retrieved memories
 *   - contradictions with other retrieved memories
 *   - whether it needs to appear in the response at all
 *
 * The output is a "cognitive context" that informs Lélu's
 * understanding without dominating her answer, with
 * progressive disclosure: a broad question gets the minimum
 * sufficient subset; an explicit "tell me everything / more
 * detail" request gets a deeper subset.
 * ==========================================================
 */

import type ResponsePattern from "./ResponsePattern";
import type { MemoryType } from "./ResponsePattern";

export interface SynthesisInput {
  /** The user's actual request. */
  prompt: string;
  /** Memories retrieved for this request (already searched). */
  memories: ResponsePattern[];
  /** Existing user-profile summary (optional, compact). */
  profile?: string;
  /** Active conversation context (optional). */
  conversation?: {
    lastTopic?: string;
    recentMessages?: string[];
  };
  /** Request a deeper subset (progressive disclosure). */
  deep?: boolean;
  /** Hard cap on how many memories are used. */
  maxMemories?: number;
}

export interface SynthesizedContext {
  /** Compact cognitive context string, or "" when nothing is relevant. */
  context: string;
  /** Memories that actually made it into the context. */
  used: ResponsePattern[];
  /** Number of memories rejected as irrelevant/duplicate. */
  rejected: number;
  /** Contradictions detected between memories. */
  contradictions: string[];
  /** Relationships/patterns derived across memories. */
  notes: string[];
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "you", "your", "with", "that", "this",
  "have", "has", "was", "were", "what", "when", "where", "which",
  "who", "whom", "how", "why", "can", "could", "would", "should",
  "tell", "about", "from", "into", "them", "they", "there", "their",
  "please", "just", "want", "need", "make", "made", "know", "think",
  "remember", "memory", "anything", "everything", "something", "does",
  "did", "doing", "been", "being", "also", "but", "not", "don't",
  "will", "would", "then", "than", "more", "most", "very", "really",
]);

/** Phrases that request deeper detail (progressive disclosure). */
const DEEP_PHRASES =
  /(everything|all you (?:remember|know)|more detail|more details|tell me more|elaborate|expand|go deeper|tell me everything|full detail)/i;

export default class MemorySynthesizer {
  /**
   * Build the compact cognitive context for a request.
   */
  public synthesize(input: SynthesisInput): SynthesizedContext {
    const prompt = input.prompt.trim();
    const memories = input.memories ?? [];
    const deep = input.deep ?? DEEP_PHRASES.test(prompt);
    const max = input.maxMemories ?? (deep ? 14 : 6);

    if (memories.length === 0) {
      return { context: "", used: [], rejected: 0, contradictions: [], notes: [] };
    }

    const concepts = this.concepts(prompt);

    // 1. Score every memory for relevance to THIS request.
    const scored = memories
      .map((memory) => ({
        memory,
        score: this.relevance(memory, concepts, prompt),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    // 2. Deduplicate: same category + heavily overlapping content.
    const seen: ResponsePattern[] = [];
    const unique: { memory: ResponsePattern; score: number }[] = [];
    for (const item of scored) {
      const duplicate = seen.find(
        (existing) =>
          existing.category === item.memory.category &&
          this.overlap(existing.response, item.memory.response) >= 0.6,
      );
      if (duplicate) {
        continue;
      }
      seen.push(item.memory);
      unique.push(item);
    }

    const rejected =
      memories.length - unique.length + (scored.length === 0 ? memories.length : 0);

    // 3. Contradictions within the same category.
    const contradictions = this.detectContradictions(unique.map((u) => u.memory));

    // 4. Relationship notes across the used set.
    const notes = this.deriveNotes(unique.slice(0, max).map((u) => u.memory));

    // 5. Group by memory layer and cap.
    const used = unique.slice(0, max).map((u) => u.memory);

    const byType = this.groupByType(used);
    const sections: string[] = [];

    if (byType.user.length > 0) {
      sections.push(`## About the user\n${this.formatGroup(byType.user)}`);
    }
    if (byType.self.length > 0) {
      sections.push(`## About me\n${this.formatGroup(byType.self)}`);
    }
    if (byType.conversation.length > 0) {
      sections.push(`## Recent conversation\n${this.formatGroup(byType.conversation)}`);
    }
    if (byType.knowledge.length > 0) {
      sections.push(`## Knowledge\n${this.formatGroup(byType.knowledge)}`);
    }
    if (byType.system.length > 0) {
      sections.push(`## System state\n${this.formatGroup(byType.system)}`);
    }

    if (contradictions.length > 0) {
      sections.push(`## Memory conflicts\n${contradictions.map((c) => `- ${c}`).join("\n")}`);
    }

    if (notes.length > 0) {
      sections.push(`## Connections\n${notes.map((n) => `- ${n}`).join("\n")}`);
    }

    if (input.profile) {
      sections.unshift(`## User model\n${input.profile}`);
    }

    if (input.conversation?.lastTopic) {
      sections.push(`## Current thread\nTopic: ${input.conversation.lastTopic}`);
    }

    return {
      context: sections.join("\n\n"),
      used,
      rejected,
      contradictions,
      notes,
    };
  }

  /**
   * Natural-language summary of the most relevant memories, used
   * by the offline composer when no AI provider is reachable.
   */
  public summarizeFacts(prompt: string, memories: ResponsePattern[]): string {
    const synthesized = this.synthesize({ prompt, memories, deep: DEEP_PHRASES.test(prompt) });
    if (synthesized.used.length === 0) {
      return "";
    }

    const facts = synthesized.used.slice(0, 4).map((memory) => this.factPhrase(memory));
    const unique = [...new Set(facts.filter((f) => f.length > 0))];
    if (unique.length === 0) {
      return "";
    }

    if (synthesized.contradictions.length > 0) {
      unique.push(
        `I also noticed some older information conflicts with this — the newer details are what I'm going with.`,
      );
    }

    return unique.join("\n");
  }

  /** Significant words extracted from the prompt (stemmed). */
  private concepts(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word))
      .map((word) => this.stem(word));
  }

  /** Light singularization: projects → project, stories → story. */
  private stem(word: string): string {
    const singular = word.endsWith("ies")
      ? `${word.slice(0, -3)}y`
      : word.endsWith("es")
        ? word.slice(0, -2)
        : word.endsWith("s")
          ? word.slice(0, -1)
          : word;
    return singular.length >= 4 ? singular : word;
  }

  /** Relevance of one memory to the request. */
  private relevance(
    memory: ResponsePattern,
    concepts: string[],
    prompt: string,
  ): number {
    const haystack = `${memory.prompt} ${memory.response} ${memory.keywords.join(" ")}`.toLowerCase();
    let score = 0;
    let matched = 0;

    for (const concept of concepts) {
      if (haystack.includes(concept)) {
        score += 4;
        matched += 1;
      }
    }

    // Full-phrase match (e.g. the topic appears verbatim).
    if (haystack.includes(prompt.toLowerCase().slice(0, 40))) {
      score += 10;
      matched += 1;
    }

    // When the request names specific concepts, a memory with NO
    // overlap is irrelevant — importance/recency alone must not
    // surface it (that is how unrelated facts pollute answers).
    if (concepts.length > 0 && matched === 0) {
      return -1;
    }

    // Importance + confidence weight (strong memories surface first).
    score += memory.importance * 3 + memory.confidence * 2;

    // Recency: memories touched within the last week are more salient.
    const age = Date.now() - (memory.updatedAt ?? memory.createdAt ?? 0);
    if (age < 7 * 24 * 3600 * 1000) {
      score += 2;
    }

    // Conversation-layer memories are session context: useful only
    // when the query itself is about the active conversation.
    if (memory.memoryType === "conversation") {
      score -= 2;
    }

    // The self-identity record answers deterministically elsewhere;
    // keep it out of general synthesis unless asked about Lélu.
    if (
      memory.memoryType === "self" &&
      memory.id === "lelu-identity-foundation" &&
      !/(who are you|what are you|about yourself|what can you do|your name)/i.test(prompt)
    ) {
      score -= 10;
    }

    return score;
  }

  /** Overlap ratio between two text snippets (word-set Jaccard-ish). */
  private overlap(a: string, b: string): number {
    const wordsA = new Set(this.sigWords(a));
    const wordsB = new Set(this.sigWords(b));
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

  private sigWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9'\s-]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOPWORDS.has(word));
  }

  private detectContradictions(memories: ResponsePattern[]): string[] {
    const contradictions: string[] = [];
    for (let i = 0; i < memories.length; i += 1) {
      for (let j = i + 1; j < memories.length; j += 1) {
        const a = memories[i];
        const b = memories[j];
        if (a.category !== b.category || a.id === b.id) {
          continue;
        }
        if (this.overlap(a.response, b.response) < 0.33) {
          continue;
        }
        if (this.negates(a.response, b.response)) {
          contradictions.push(
            `"${this.shorten(a.response)}" conflicts with newer "${this.shorten(b.response)}" — the newer statement wins.`,
          );
        }
      }
    }
    return contradictions;
  }

  /** True when the second statement looks like a correction of the first. */
  private negates(a: string, b: string): boolean {
    const correction = /(no longer|actually|not anymore|changed|instead|never|don't|doesn't|isn't|wasn't|hate|dislike|stopped)/i;
    return correction.test(b) && !correction.test(a);
  }

  private deriveNotes(memories: ResponsePattern[]): string[] {
    const notes: string[] = [];
    const projects = memories.filter((m) => m.category === "project");
    const skills = memories.filter((m) => m.category === "skill");
    const goals = memories.filter((m) => m.category === "goal");

    if (projects.length >= 1 && skills.length >= 1) {
      notes.push(`Their project work draws on stored skills — keep offering practical implementation help.`);
    }
    if (goals.length >= 1 && projects.length >= 1) {
      notes.push(`Their active projects line up with stated goals — tie next steps back to those goals.`);
    }
    if (memories.filter((m) => m.category === "preference").length >= 2) {
      notes.push(`They have multiple stored preferences — use them to personalize suggestions, don't restate them all.`);
    }
    return notes;
  }

  private groupByType(memories: ResponsePattern[]): Record<MemoryType, ResponsePattern[]> {
    const groups: Record<MemoryType, ResponsePattern[]> = {
      user: [],
      self: [],
      conversation: [],
      knowledge: [],
      system: [],
    };
    for (const memory of memories) {
      const type = memory.memoryType ?? this.defaultType(memory.category);
      groups[type].push(memory);
    }
    return groups;
  }

  private defaultType(category: string): MemoryType {
    switch (category) {
      case "conversation":
      case "experience":
        return "conversation";
      default:
        return "user";
    }
  }

  private formatGroup(memories: ResponsePattern[]): string {
    return memories
      .map((memory) => `- ${this.shorten(memory.response)}`)
      .join("\n");
  }

  private shorten(text: string, max = 160): string {
    const clean = text.replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }

  /** Natural offline phrasing for a single stored fact. */
  private factPhrase(memory: ResponsePattern): string {
    const value = this.shorten(memory.response, 220);
    switch (memory.category) {
      case "identity":
        return `Your name is ${value}.`;
      case "preference":
        return `You've told me you ${value.replace(/^i\s+/i, "").toLowerCase()}.`;
      case "goal":
        return `Your goal: ${value}.`;
      case "project":
        return `You're working on ${value.replace(/^i (?:am |'m )?(?:building|creating|working on|making)\s+/i, "")}.`;
      case "skill":
        return `You have a skill with ${value.replace(/^i (?:can|know|make|build)\s+/i, "")}.`;
      case "relationship":
        return value;
      default:
        return value;
    }
  }
}
