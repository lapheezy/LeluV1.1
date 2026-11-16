/**
 * ==========================================================
 * LÉLU — COSMOS REFERENT CONTINUITY
 *
 * "Rotate it 90 degrees" only means something if "it" still points at the
 * object from the turn before. This module answers one question — WHICH
 * object does this instruction refer to? — from evidence that already
 * exists:
 *
 *   1. the conversation itself (`AIRequest.messages`), which is
 *      per-conversation by construction;
 *   2. the id the last successful tool result in THIS conversation touched;
 *   3. the selection the person can see.
 *
 * There is no new object store, and nothing here looks at "the newest
 * object": `CosmosObjectStore.resolve("")` falls back to the most recent
 * object, which is a guess, and a guess is exactly what a conversation
 * must not make. When there is no referent the answer is a refusal with
 * the list of objects, never a default.
 *
 * A referent is validated against the store on every read, so an object
 * that was removed (it moves to the trash, where `get` cannot see it) or
 * replaced cannot be acted on through a stale id.
 * ==========================================================
 */

import CosmosObjectStore from "./CosmosObjectStore";
import type { CosmosObject } from "./CosmosObjectTypes";

export interface ConversationLike {
  role: string;
  content: string;
}

export interface CosmosReferent {
  object: CosmosObject;
  /** Where the identity came from — never conflated. */
  source: "conversation" | "selection";
  raw: string;
}

export type TargetLookup = { object: CosmosObject } | { reason: string };

const ID_PATTERN = /\b(obj[_-][a-z0-9]+(?:[_-][a-z0-9]+)*)\b/gi;

/** Words that mean "the one we are working on", not a new object. */
const IMPLICIT =
  /^(it|that|this|that one|this one|them|the same(?: object| one)?|the selected(?: object| one)?|the one (?:you|i|we) (?:just )?(?:moved|selected|rotated|scaled|made|built)|the object (?:i|we|you) (?:just )?(?:moved|selected|rotated|scaled|made|built)|the object we were working on)$/i;

export function isImplicitReference(text: string): boolean {
  return IMPLICIT.test(text.trim().replace(/[.!?]+$/, ""));
}

/**
 * conversationId → last object a successful tool result touched.
 *
 * Bounded and aged out; it holds one id per conversation and is re-validated
 * on every read. The key IS the conversation, so two chats cannot share a
 * referent.
 */
const MAX_CONVERSATIONS = 50;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const remembered = new Map<string, { objectId: string; at: number }>();

function prune(now: number): void {
  for (const [key, entry] of remembered) if (now - entry.at > MAX_AGE_MS) remembered.delete(key);
  while (remembered.size > MAX_CONVERSATIONS) {
    const oldest = [...remembered.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!oldest) break;
    remembered.delete(oldest[0]);
  }
}

/** Called by the object tools after a SUCCESSFUL operation. */
export function rememberCosmosReferent(conversationId: string | undefined, objectId: string): void {
  if (!conversationId || !objectId) return;
  const now = Date.now();
  remembered.set(conversationId, { objectId, at: now });
  prune(now);
}

export function forgetCosmosReferent(conversationId: string | undefined): void {
  if (conversationId) remembered.delete(conversationId);
}

/** Test hook: forget everything. */
export function clearCosmosReferents(): void {
  remembered.clear();
}

/** A live object: present in the store, not in the trash. */
function live(store: CosmosObjectStore, id: string): CosmosObject | null {
  return store.get(id) ?? null;
}

export function referentFromConversation(messages: ConversationLike[] | undefined, store: CosmosObjectStore): CosmosReferent | null {
  if (!messages?.length) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const content = messages[index]?.content ?? "";
    if (!content) continue;
    const ids = [...content.matchAll(new RegExp(ID_PATTERN.source, "gi"))].map((match) => match[1]);
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      const object = live(store, ids[i]);
      if (object) return { object, source: "conversation", raw: ids[i] };
    }
  }
  return null;
}

export function recallCosmosReferent(conversationId: string | undefined, store: CosmosObjectStore): CosmosReferent | null {
  if (!conversationId) return null;
  const entry = remembered.get(conversationId);
  if (!entry) return null;
  const object = live(store, entry.objectId);
  if (!object) {
    remembered.delete(conversationId);
    return null;
  }
  return { object, source: "conversation", raw: entry.objectId };
}

/**
 * The referent for this turn: newest valid id in the conversation, then what
 * this conversation last worked on, then the visible selection.
 */
export function resolveCosmosReferent(options: {
  store: CosmosObjectStore;
  messages?: ConversationLike[];
  conversationId?: string;
  allowSelection?: boolean;
}): CosmosReferent | null {
  const { store, allowSelection = true } = options;
  const fromConversation = referentFromConversation(options.messages, store);
  if (fromConversation) return fromConversation;
  const fromRecord = recallCosmosReferent(options.conversationId, store);
  if (fromRecord) return fromRecord;
  if (allowSelection) {
    const selected = store.selectedId();
    if (selected) {
      const object = live(store, selected);
      if (object) return { object, source: "selection", raw: selected };
    }
  }
  return null;
}

/**
 * Resolve the object a tool call names.
 *
 * An explicit name or id is resolved by the store as before. An implicit
 * reference ("it", "that", or nothing at all) is resolved only from a real
 * referent — never from the newest object — and states a reason when there
 * is none, so the caller can say why instead of acting on the wrong thing.
 */
export function resolveCosmosTarget(
  store: CosmosObjectStore,
  reference: string | undefined,
  options: { messages?: ConversationLike[]; conversationId?: string } = {},
): TargetLookup {
  const ref = (reference ?? "").trim();
  const implicit = !ref || isImplicitReference(ref);

  if (!implicit) {
    const exact = store.get(ref);
    if (exact) return { object: exact };
    // A name that is several objects is not a target: acting on one of them
    // would be a guess dressed up as a resolution.
    const matches = store.list().filter((object) => object.name.toLowerCase().includes(ref.toLowerCase()));
    if (matches.length > 1) {
      return { reason: `“${ref}” matches ${matches.length} objects (${matches.map((object) => object.name).join(", ")}) — say which one` };
    }
    if (matches.length === 1) return { object: matches[0] };
    return { reason: `no object matches “${ref}”` };
  }

  const referent = resolveCosmosReferent({ store, messages: options.messages, conversationId: options.conversationId });
  if (referent) return { object: referent.object };

  const names = store.list().map((object) => object.name).slice(0, 8);
  return {
    reason: names.length
      ? `I could not tell which object “${ref || "that"}” means — the Cosmos has ${names.join(", ")}`
      : "there is nothing in the Cosmos to act on yet",
  };
}

export function describeCosmosReferent(referent: CosmosReferent | null): string {
  if (!referent) return "no object in context";
  return `${referent.object.name} (${referent.object.id}), from the ${referent.source === "conversation" ? "conversation" : "current selection"}`;
}

/** The conversation's messages, flattened, from a tool context. */
export function messagesOf(context: { request?: { messages?: Array<{ role?: string; content?: unknown }> } } | undefined): ConversationLike[] {
  const messages = context?.request?.messages ?? [];
  return messages.map((message) => ({
    role: String(message?.role ?? "user"),
    content: typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? ""),
  }));
}

export function conversationOf(context: { request?: { conversationId?: string } } | undefined): string | undefined {
  return context?.request?.conversationId;
}
