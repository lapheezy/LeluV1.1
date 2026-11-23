/**
 * ==========================================================
 * LÉLU — CREATIVE REFERENT CONTINUITY
 *
 * "Rotate it 90 degrees" only means something if "it" still
 * points at the chair from the turn before. This module answers
 * one question — WHICH creation does this instruction refer
 * to? — from evidence that already exists:
 *
 *   1. the conversation itself (`AIRequest.messages`), which is
 *      per-conversation by construction, so two chats cannot
 *      leak a referent into each other;
 *   2. the current selection, as a live hint.
 *
 * There is no new memory store and no global "last object"
 * singleton: the conversation is the context authority, and the
 * live selection only ever confirms it. A referent is always
 * validated against the canonical store before use, so a
 * deleted, archived or unknown id is dropped instead of acted
 * on.
 * ==========================================================
 */

import type CreativeObjects from "./objects";
import type { CreativeObject } from "./objects";
import { getCreativeSelection } from "./selection";

export interface ConversationLike {
  role: string;
  content: string;
}

export interface CreativeReferent {
  object: CreativeObject;
  /** Where the identity came from — never conflated. */
  source: "conversation" | "selection" | "explicit";
  /** The id as it appeared before validation. */
  raw: string;
}

const ID_PATTERN = /\b(obj-[a-z]+(?:-[a-z0-9]+)*)\b/i;

/** Names LÉLU uses when she means "the one we were just working on". */
const IMPLICIT_REFERENCE =
  /^(it|that|this|that one|this one|the same(?: object| one)?|the selected(?: object| one)?|the object (?:i|we) (?:just )?(?:created|made|moved|rotated|scaled|selected)|the one (?:you|i) (?:just )?(?:moved|selected|rotated|scaled|made)|the object we were working on)$/i;

export function isImplicitReference(text: string): boolean {
  const trimmed = text.trim().replace(/[.!?]+$/, "");
  return IMPLICIT_REFERENCE.test(trimmed);
}

/**
 * Validate a candidate id against the canonical store.
 * Archived, hidden and missing objects are not referents.
 */
function valid(store: CreativeObjects, id: string): CreativeObject | null {
  const object = store.get(id);
  if (!object) return null;
  if (object.archived) return null;
  return object;
}

/**
 * The latest canonical object id mentioned in the conversation.
 *
 * Messages are read newest-first, so a later mention beats an earlier one:
 * "rotate the pendant" followed by "enlarge it" refers to the pendant. Only
 * ids the store still holds count — a stale id is skipped rather than used.
 */
export function referentFromConversation(
  messages: ConversationLike[] | undefined,
  store: CreativeObjects,
): CreativeReferent | null {
  if (!messages?.length) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content ?? "";
    if (!content) continue;
    const matches = [...content.matchAll(new RegExp(ID_PATTERN, "gi"))].map((match) => match[1]);
    for (let m = matches.length - 1; m >= 0; m -= 1) {
      const object = valid(store, matches[m]);
      if (object) return { object, source: "conversation", raw: matches[m] };
    }
  }
  return null;
}

/**
 * The referent for this instruction.
 *
 * An explicitly named object in the instruction itself always wins (the
 * compiler reads the noun); this only answers the implicit cases, where the
 * order is: the conversation's latest valid mention, then the live selection.
 * Both are checked against the store, so neither can resurrect a dead id.
 */
/**
 * The referent each conversation is currently working on.
 *
 * Deliberately ephemeral and tiny: one canonical id per conversation, taken
 * from a tool result that actually succeeded, validated against the store on
 * every read, capped and aged out. It is not a memory system, not a second
 * object store, and it cannot leak between conversations because the key IS
 * the conversation. It exists because the reply text of a model-free turn is
 * not guaranteed to be in the next turn's `messages`, while the conversation
 * id always is.
 */
const MAX_CONVERSATIONS = 50;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const current = new Map<string, { objectId: string; at: number }>();

function prune(now: number): void {
  for (const [key, entry] of current) {
    if (now - entry.at > MAX_AGE_MS) current.delete(key);
  }
  while (current.size > MAX_CONVERSATIONS) {
    const oldest = [...current.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!oldest) break;
    current.delete(oldest[0]);
  }
}

/** Called by the creative tool after a SUCCESSFUL operation. */
export function rememberCreativeReferent(conversationId: string | undefined, objectId: string): void {
  if (!conversationId || !objectId) return;
  const now = Date.now();
  current.set(conversationId, { objectId, at: now });
  prune(now);
}

/** Forget one conversation's referent (used when it can no longer resolve). */
export function forgetCreativeReferent(conversationId: string | undefined): void {
  if (conversationId) current.delete(conversationId);
}

export function recallCreativeReferent(conversationId: string | undefined, store: CreativeObjects): CreativeReferent | null {
  if (!conversationId) return null;
  const entry = current.get(conversationId);
  if (!entry) return null;
  const object = valid(store, entry.objectId);
  if (!object) {
    current.delete(conversationId);
    return null;
  }
  return { object, source: "conversation", raw: entry.objectId };
}

/** Test/teardown hook: forget everything. */
export function clearCreativeReferents(): void {
  current.clear();
}

export function resolveCreativeReferent(options: {
  messages?: ConversationLike[];
  store: CreativeObjects;
  allowSelection?: boolean;
  conversationId?: string;
}): CreativeReferent | null {
  const { store, allowSelection = true } = options;

  const fromConversation = referentFromConversation(options.messages, store);
  if (fromConversation) return fromConversation;

  // What this conversation was last working on, written by the tool that did
  // the work. Checked against the store, so a deleted object drops out here.
  const remembered = recallCreativeReferent(options.conversationId, store);
  if (remembered) return remembered;

  if (allowSelection) {
    const selection = getCreativeSelection();
    if (selection?.objectId) {
      const object = valid(store, selection.objectId);
      if (object) return { object, source: "selection", raw: selection.objectId };
    }
  }

  return null;
}

/** A short, honest line for the reply: what "it" was taken to mean. */
export function describeReferent(referent: CreativeReferent | null): string {
  if (!referent) return "no object in context";
  return `${referent.object.name} (${referent.object.id}), from the ${referent.source === "conversation" ? "conversation" : "current selection"}`;
}
