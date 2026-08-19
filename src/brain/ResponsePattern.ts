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