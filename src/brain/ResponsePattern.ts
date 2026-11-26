/**
 * ==========================================================
 * LÉLU
 * RESPONSE PATTERN
 * ==========================================================
 */


export type MemoryCategory =

  | "identity"

  | "preference"

  | "goal"

  | "skill"

  | "project"

  | "relationship"

  | "experience"

  | "conversation"

  | "general";

/**
 * Bridges the vocabulary gap between how a CATEGORY of fact is ASKED
 * about and how the fact itself was ORIGINALLY phrased — e.g. a stored
 * preference "I love hiking" never literally contains the word
 * "hobbies", so a later "what are my hobbies?" would otherwise match
 * nothing at all, at every layer that searches or ranks memories by
 * keyword overlap (PatternMemory.search, MemorySynthesizer.relevance).
 * Defined once here, next to the category type itself, and imported by
 * both so retrieval and ranking never silently disagree about which
 * words count as evidence for which category.
 */
// Deliberately conservative: only words that are near-exclusively a
// PERSONAL-fact-recall signal belong here. Generic dev/status words
// like "working"/"job"/"work"/"build" were tried and reverted — "why
// is my Groq provider not working?" and "what have you been working
// on?" (an engineering-diagnostic question) both got hijacked into an
// unrelated stored "project" memory purely because "working" was
// listed as a project synonym. That is the exact class of bug this
// whole bridge exists to avoid reintroducing (see PatternMemory's
// wordBoundaryIncludes comment for the original version of this
// mistake). A false negative (a fact that stays a little harder to
// recall) is far cheaper than a false positive (an unrelated engine
// question silently answered from stale personal memory).
export const CATEGORY_RECALL_SYNONYMS: Partial<Record<MemoryCategory, string[]>> = {
  preference: ["hobby", "hobbies", "hobbys"],
  goal: ["goal", "goals"],
  project: ["project", "projects"],
  skill: ["skill", "skills"],
  relationship: ["family", "friend", "friends", "partner", "relationship", "relationships"],
};

/**
 * Cognitive memory layers. These are logical layers of the ONE
 * persistent memory architecture — they tell cognition whose
 * information a memory is, so a fact about LÉLU is never recalled
 * as a fact about the user (and vice versa).
 *
 * - user:        facts/preferences/history belonging to the user
 * - self:        facts about LÉLU herself (identity, abilities, history)
 * - conversation: context for the active session
 * - knowledge:   external/general information (research results)
 * - system:      engineering/runtime state (providers, errors, capabilities)
 */
export type MemoryType =

  | "user"

  | "self"

  | "conversation"

  | "knowledge"

  | "system";

/** The five cognitive layers, as a runtime list (not only a compile-time type). */
export const MEMORY_TYPES: readonly MemoryType[] = ["user", "self", "conversation", "knowledge", "system"];

/**
 * The layer a category belongs to, when the memory itself does not say.
 *
 * Exported next to MemoryType so every writer and every reader resolves the
 * same way; before, MemorySynthesizer owned the only mapping, so an
 * unrecorded layer was assigned in one place and nowhere else.
 */
export function defaultMemoryType(category?: string | null): MemoryType {
  switch (category) {
    case "conversation":
    case "experience":
      return "conversation";
    case "identity":
      return "self";
    default:
      return "user";
  }
}

/**
 * Historical and aliased spellings of the five layers.
 *
 * `memoryType` reaches this process from more than one writer: persisted rows
 * (Supabase `memory_type`), hydrated snapshots (metadata.memoryType) and
 * legacy archives. Those records can name a layer with the SCOPE vocabulary
 * ("session", "persistent-user") or with a layer word the type never had
 * ("episodic", "semantic"). Indexing a fixed set of layers with such a value
 * produced `undefined` and then crashed the turn on `.push`. Aliases are
 * mapped here; anything else falls back to the category's own layer.
 */
const MEMORY_TYPE_ALIASES: Record<string, MemoryType> = {
  user: "user",
  "persistent-user": "user",
  "persistent_user": "user",
  personal: "user",
  profile: "user",
  self: "self",
  identity: "self",
  lelu: "self",
  conversation: "conversation",
  session: "conversation",
  "session-only": "conversation",
  temporary: "conversation",
  episodic: "conversation",
  chat: "conversation",
  knowledge: "knowledge",
  semantic: "knowledge",
  fact: "knowledge",
  research: "knowledge",
  external: "knowledge",
  system: "system",
  runtime: "system",
  engineering: "system",
  operational: "system",
  diagnostic: "system",
};

/**
 * The layer a memory really belongs to — always one of the five.
 *
 * Never returns a value outside MEMORY_TYPES, whatever it is handed: a
 * missing, null, non-string or unrecognised memoryType resolves from the
 * category instead. This is the only safe way to index a layer-keyed map.
 */
export function normalizeMemoryType(type: unknown, category?: string | null): MemoryType {
  if (typeof type === "string") {
    const key = type.trim().toLowerCase();
    const alias = MEMORY_TYPE_ALIASES[key];
    if (alias) return alias;
  }
  return defaultMemoryType(category);
}

/** Is this value one of the five cognitive layers, exactly? */
export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}




export default interface ResponsePattern {


  /**
   * Unique identifier.
   */
  id:
    string;



  /**
   * Memory category.
   */
  category:
    MemoryCategory;



  /**
   * Original user message.
   */
  prompt:
    string;



  /**
   * Stored information.
   */
  response:
    string;



  /**
   * High-level intent.
   */
  intent:
    string;



  /**
   * Important words.
   */
  keywords:
    string[];



  /**
   * Additional memory metadata.
   */
  context:
    Record<
      string,
      unknown
    >;



  /**
   * Cognitive memory layer (user/self/conversation/knowledge/
   * system). Defaults to "user" for extracted personal facts.
   */
  memoryType?:
    MemoryType;



  /**
   * Importance of memory.
   */
  importance:
    number;



  /**
   * Confidence score.
   */
  confidence:
    number;



  /**
   * Number of successful retrievals.
   */
  successfulUses:
    number;



  /**
   * Number of failed retrievals.
   */
  failedUses:
    number;



  /**
   * Creation timestamp.
   */
  createdAt:
    number;



  /**
   * Last update timestamp.
   */
  updatedAt:
    number;

}
/**
 * One recalled memory, repaired for READERS.
 *
 * A memory reaches a turn from more than one place — the live store, a
 * hydrated snapshot, a persisted Supabase row, a legacy archive — and those
 * records do not all carry every field the reading side assumes. Reading
 * `keywords.join(...)`, `context.origin` or `memoryType` off such a record
 * threw inside retrieval/authorization/synthesis, which is a failed turn
 * rather than a missing fact.
 *
 * Returns the record with every field the readers use present and well
 * typed, or null when there is no usable text at all (nothing to recall).
 * Identity is preserved, never invented: a record with no id keeps none, so
 * provenance verification still refuses it honestly.
 */
export function sanitizeMemoryRecord(memory: unknown): ResponsePattern | null {
  if (!memory || typeof memory !== "object") return null;
  const record = memory as Partial<ResponsePattern>;
  const response = typeof record.response === "string" ? record.response.trim() : "";
  if (!response) return null;
  const category =
    typeof record.category === "string" && record.category ? record.category : "general";
  const number = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    id: typeof record.id === "string" ? record.id : "",
    category: category as MemoryCategory,
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    response,
    intent: typeof record.intent === "string" ? record.intent : "general",
    keywords: Array.isArray(record.keywords)
      ? record.keywords.filter((keyword): keyword is string => typeof keyword === "string")
      : [],
    context:
      record.context && typeof record.context === "object"
        ? (record.context as Record<string, unknown>)
        : {},
    memoryType: normalizeMemoryType(record.memoryType, category),
    importance: number(record.importance, 0.3),
    confidence: number(record.confidence, 0.5),
    successfulUses: number(record.successfulUses, 0),
    failedUses: number(record.failedUses, 0),
    createdAt: number(record.createdAt, 0),
    updatedAt: number(record.updatedAt, 0),
  };
}
