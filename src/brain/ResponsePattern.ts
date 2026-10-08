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