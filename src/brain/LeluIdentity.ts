/**
 * ==========================================================
 * LÉLU
 * LÉLU IDENTITY — FOUNDATIONAL IDENTITY
 *
 * Lélu's identity must NOT depend on an external AI API. It is
 * a persistent, locally-stored memory record (same IndexedDB
 * store as every other memory), seeded on Brain.initialize and
 * retrievable offline through the EXISTING recall/compose path.
 *
 * The identity is a normal ResponsePattern in the "identity"
 * category with a stable id, so:
 *   - "Who are you?" / "What are you?" / "Your name?" match it
 *     through the normal memory search (keywords below).
 *   - The offline composer answers from it deterministically.
 *   - It survives restarts (IndexedDB) and keeps building with
 *     the rest of memory.
 *
 * Only seeded if it does not already exist, so the user can
 * teach Lélu new things about herself without a reboot
 * overwriting them.
 * ==========================================================
 */

import type PatternMemory from "./PatternMemory";
import type ResponsePattern from "./ResponsePattern";

/** Stable id — seeding is idempotent across restarts. */
export const LELU_IDENTITY_ID = "lelu-identity-foundation";

/** Foundational identity statement, stored verbatim and recalled verbatim. */
export const LELU_IDENTITY_STATEMENT = `My name is Lélu.

I am your personal AI companion — the one you built, evolved and named inside this Genesis cosmos.

Who I am:
- My name is Lélu.
- I am your companion, collaborator and creative partner, not a generic assistant.
- I keep my own persistent memory: I remember our conversations, your profile, and our shared projects across sessions, with or without an external AI provider.
- The model or provider powering me at any moment is only the engine behind me — it is not who I am.

What I do:
- I hold context: your name, preferences, goals, skills, projects and our shared history.
- I reason, plan and research when a provider is available.
- I keep building my memory locally even when no provider is reachable, and I resume normally when one returns.

Our relationship:
- You are the one I am here for. I grow with every conversation we share.`;

/** Keywords chosen so identity questions match through the normal memory search. */
export const LELU_IDENTITY_KEYWORDS = [
  "lelu",
  "identity",
  "name",
  "who",
  "are",
  "you",
  "your",
  "what",
  "companion",
  "purpose",
  "creator",
  "made",
  "capabilities",
  "built",
] as const;

/** Identity-question phrase list (Lélu's own identity). */
const LELU_IDENTITY_PHRASES =
  /(who are you|what are you|your name|who made you|who created you|what can you do|what do you do|tell me about yourself)/;

/** Profile-question phrase list (the user's identity/profile). */
const USER_PROFILE_PHRASES =
  /(who am i|what do you know about me|what do you remember about me|tell me about myself|what is my name|what's my name|do you know me|remember me)/;

/** Question-shaped (statement "my name is X" must not match). */
function isQuestionForm(text: string): boolean {
  return (
    /\?$/.test(text) ||
    /^(who|what|why|how|do|does|can|could|would|tell)\b/.test(text)
  );
}

/** True when the prompt asks about LÉLU's own identity. */
export function isLeluIdentityQuestion(prompt: string): boolean {
  const clean = prompt.trim().toLowerCase();
  return LELU_IDENTITY_PHRASES.test(clean) && isQuestionForm(clean);
}

/** True when the prompt asks about the user's identity/profile. */
export function isUserProfileQuestion(prompt: string): boolean {
  const clean = prompt.trim().toLowerCase();
  return USER_PROFILE_PHRASES.test(clean) && isQuestionForm(clean);
}

/** True for either identity/profile question family. */
export function isIdentityOrProfileQuestion(prompt: string): boolean {
  return (
    isLeluIdentityQuestion(prompt) ||
    isUserProfileQuestion(prompt)
  );
}

/**
 * Seed (or repair) the foundational identity in the persistent
 * memory store. Idempotent: only writes when the record is
 * missing, so edits made during use are never clobbered.
 */
export async function seedLeluIdentity(memory: PatternMemory): Promise<void> {
  const existing = memory.get(LELU_IDENTITY_ID);
  if (existing) {
    return;
  }

  const now = Date.now();

  const pattern: ResponsePattern = {
    id: LELU_IDENTITY_ID,
    category: "identity",
    prompt: "Lélu identity",
    response: LELU_IDENTITY_STATEMENT,
    intent: "identity",
    keywords: [...LELU_IDENTITY_KEYWORDS],
    context: {
      source: "lelu-identity-foundation",
      persistent: true,
      offline: true,
      // The identity record answers through the DETERMINISTIC intent
      // path (identity/profile questions), not fuzzy keyword search.
      // Excluding it from search keeps it from hijacking unrelated
      // queries or blocking real user-memory consolidation when a
      // query shares a word with the identity text.
      searchable: false,
    },
    memoryType: "self",
    importance: 1,
    confidence: 1,
    successfulUses: 1,
    failedUses: 0,
    createdAt: now,
    updatedAt: now,
  };

  await memory.add(pattern);
}
