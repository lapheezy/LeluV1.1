/**
 * ==========================================================
 * LÉLU — MAY THIS TURN USE ANOTHER CHAT? (pure)
 *
 * LÉLU can read, link or merge other chats from inside a
 * conversation (the chats.* tools). Whether she may is decided
 * here, from what the USER said — never from the model's own
 * judgement alone:
 *
 *   read   — the chat is linked / in the same project, OR the
 *            user's message names it or refers to "the other
 *            chat", OR the user just said yes to her asking.
 *   link   — the user's message names the chat, or said yes to
 *            her asking about it.
 *   merge  — the user asked to merge/combine (naming the chats
 *            or "these"), or said yes to her proposing it.
 *
 * Otherwise the answer is "ask first": she decides whether the
 * connection is worth raising, and the user decides.
 * ==========================================================
 */

import { tokenizeText, type ChatConversation } from "./MultiChatStore";

export type ChatAction = "read" | "link" | "merge";

export interface ConsentInput {
  /** The user's current message. */
  prompt: string;
  /** The conversation this turn belongs to. */
  current: ChatConversation;
  /** The chat to read, link or merge. */
  target: ChatConversation;
  action: ChatAction;
}

export interface ConsentResult {
  ok: boolean;
  /** Why — shown to the model, which tells the user. */
  reason: string;
  /** What allowed it, when it was allowed. */
  authorization?: "linked" | "project" | "asked";
}

const GENERIC_CHAT_REFERENCE = /\b(?:other|another|previous|earlier|last|that|my|our|the)\s+(?:\w+\s+)?(?:chat|conversation|thread)s?\b/i;
/** Words about chats themselves; they say nothing about which chat or what is in it. */
export const CHAT_WORDS = new Set(["chat", "chats", "conversation", "conversations", "thread", "threads", "other", "another", "earlier", "previous", "merged"]);
const AFFIRMATIVE =/^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please(?: do)?|go ahead|do it|sounds good|absolutely|of course|definitely)\b/i;
const MERGE_WORDS = /\b(?:merge|merging|combine|combining|join|consolidate|put (?:them|these|it) together)\b/i;
const LINK_WORDS = /\b(?:link|connect|use|reference|pull (?:in|from)|bring in|look at|check)\b/i;

/** The last thing LÉLU said in this conversation, if anything. */
function lastAssistantText(current: ChatConversation): string {
  return [...current.messages].reverse().find((message) => message.role === "assistant")?.text ?? "";
}

/** Does this text name the chat — its title, or enough of its distinctive words? */
export function namesChat(text: string, target: ChatConversation): boolean {
  const lower = text.toLowerCase();
  const title = target.title.trim().toLowerCase();
  if (title.length >= 4 && lower.includes(title)) return true;
  // "chat" names no chat in particular — every default title is "New chat".
  const titleTokens = [...new Set(tokenizeText(target.title))].filter((token) => token.length >= 4 && !CHAT_WORDS.has(token));
  if (titleTokens.length === 0) return false;
  const textTokens = new Set(tokenizeText(text));
  const hits = titleTokens.filter((token) => textTokens.has(token)).length;
  // Most of the title, not a few of its words: "Merged: Pitch deck + Video
  // research" shares words with "video research" but was not named.
  return hits >= Math.min(2, titleTokens.length) && hits / titleTokens.length >= 0.6;
}

/** Find a chat by id or by (part of) its title, best match first. */
export function findChat(
  query: string,
  conversations: ChatConversation[],
  excludeId?: string,
): ChatConversation | undefined {
  // Two chats can share a title ("New chat"); the one in use most
  // recently is the one the user means.
  const candidates = conversations
    .filter((conversation) => conversation.id !== excludeId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const exact = candidates.find((conversation) => conversation.id === query);
  if (exact) return exact;
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const exactTitle = candidates.find((conversation) => conversation.title.toLowerCase() === q);
  if (exactTitle) return exactTitle;
  // The CLOSEST containing title, not the first: a merged chat's title
  // ("Merged: A + Video research") contains its sources' titles, and the
  // newest chat is listed first — so "video research" picked the merge.
  const containing = candidates
    .filter((conversation) => conversation.title.toLowerCase().includes(q) || q.includes(conversation.title.toLowerCase()))
    .sort((a, b) => Math.abs(a.title.length - q.length) - Math.abs(b.title.length - q.length));
  if (containing.length > 0) return containing[0];
  const qTokens = new Set(tokenizeText(query));
  let best: { conversation: ChatConversation; score: number; extra: number } | undefined;
  for (const conversation of candidates) {
    const titleTokens = tokenizeText(conversation.title);
    const score = titleTokens.filter((token) => qTokens.has(token)).length;
    const extra = titleTokens.length - score;
    if (score > 0 && (!best || score > best.score || (score === best.score && extra < best.extra))) best = { conversation, score, extra };
  }
  return best?.conversation;
}

/**
 * Why this turn may read the target chat, or null. "generic" is the user
 * saying "my other chat" without naming one — enough to look, but the
 * caller should take only the best match, not every chat.
 */
export function readAuthorization(
  prompt: string,
  current: ChatConversation,
  target: ChatConversation,
): "linked" | "project" | "named" | "agreed" | "generic" | null {
  if (current.linkedIds.includes(target.id) || target.linkedIds.includes(current.id)) return "linked";
  if (current.projectId != null && target.projectId === current.projectId) return "project";
  if (namesChat(prompt, target)) return "named";
  if (AFFIRMATIVE.test(prompt) && namesChat(lastAssistantText(current), target)) return "agreed";
  if (GENERIC_CHAT_REFERENCE.test(prompt)) return "generic";
  return null;
}

export function consentFor({ prompt, current, target, action }: ConsentInput): ConsentResult {
  const linked = current.linkedIds.includes(target.id) || target.linkedIds.includes(current.id);
  const sameProject = current.projectId != null && target.projectId === current.projectId;
  const named = namesChat(prompt, target);
  const lastAsked = lastAssistantText(current);
  // "Yes" counts only as an answer to HER asking about THIS chat.
  const saidYesToThis = AFFIRMATIVE.test(prompt) && namesChat(lastAsked, target);
  const title = `“${target.title}”`;

  if (action === "read") {
    if (linked) return { ok: true, reason: `${title} is linked to this chat.`, authorization: "linked" };
    if (sameProject) return { ok: true, reason: `${title} is in the same project.`, authorization: "project" };
    if (named) return { ok: true, reason: `The user brought up ${title}.`, authorization: "asked" };
    if (GENERIC_CHAT_REFERENCE.test(prompt)) return { ok: true, reason: "The user referred to another chat.", authorization: "asked" };
    if (saidYesToThis) return { ok: true, reason: `The user agreed to using ${title}.`, authorization: "asked" };
    return {
      ok: false,
      reason: `The user has not brought up ${title} or allowed this chat to use it. Ask them first — if they agree, read it then.`,
    };
  }

  if (action === "link") {
    if (linked) return { ok: true, reason: `${title} is already linked.` };
    if (named && LINK_WORDS.test(prompt)) return { ok: true, reason: `The user asked to use ${title}.` };
    if (saidYesToThis) return { ok: true, reason: `The user agreed to linking ${title}.` };
    return { ok: false, reason: `Linking ${title} needs the user's go-ahead. Ask them first.` };
  }

  // merge
  const askedToMerge = MERGE_WORDS.test(prompt) && (named || /\b(?:these|them|both|all|this chat|the two|together)\b/i.test(prompt));
  const agreedToMerge = AFFIRMATIVE.test(prompt) && MERGE_WORDS.test(lastAsked) && namesChat(lastAsked, target);
  if (askedToMerge) return { ok: true, reason: "The user asked to merge." };
  if (agreedToMerge) return { ok: true, reason: `The user agreed to merging ${title}.` };
  return {
    ok: false,
    reason: `Merging ${title} needs the user to ask for it or agree to it. If combining would help, ask them first.`,
  };
}
