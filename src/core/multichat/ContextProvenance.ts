/**
 * ==========================================================
 * LÉLU — WHICH CHAT DID THIS COME FROM?
 *
 * A turn's context is assembled from LÉLU's whole cognition:
 * long-term memory ("About the user"), knowledge nodes, project
 * checkpoints, her executive state. Those quote what was said in
 * OTHER chats verbatim, with no source — measured: a codename told
 * to one chat "for this chat" was answered in an unrelated chat
 * through four such sections, and she could not say where it came
 * from.
 *
 * This keeps her cognition whole but labelled: every line of the
 * context that quotes another chat's message is marked
 * [from the chat “…”], and she is told not to use those silently.
 * The conversation store is the ground truth of who said what.
 * ==========================================================
 */

import MultiChatStore, { type ChatConversation } from "./MultiChatStore";

/** How much of a message identifies it (its opening words). */
const NEEDLE = 36;
/** Recent messages per chat that are looked for. */
const PER_CHAT = 60;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Opening-words index of other chats' messages → the chat they belong to. */
function indexOthers(conversations: ChatConversation[], currentId: string): Map<string, string> {
  const index = new Map<string, string>();
  for (const conversation of conversations) {
    if (conversation.id === currentId) continue;
    for (const message of conversation.messages.slice(-PER_CHAT)) {
      const text = normalize(message.text);
      if (text.length < NEEDLE) continue;
      const needle = text.slice(0, NEEDLE).toLowerCase();
      if (!index.has(needle)) index.set(needle, message.origin?.title ?? conversation.title);
    }
  }
  return index;
}

/** The chat a line quotes, if it quotes another chat's message. */
function sourceOf(line: string, index: Map<string, string>): string | null {
  const text = normalize(line).toLowerCase();
  // Messages begin at word boundaries; only those positions are tried.
  for (let position = 0; position + NEEDLE <= text.length; position += 1) {
    if (position > 0 && text[position - 1] !== " " && text[position - 1] !== "“" && text[position - 1] !== '"' && text[position - 1] !== ":") continue;
    const title = index.get(text.slice(position, position + NEEDLE));
    if (title) return title;
  }
  return null;
}

export interface ProvenanceResult {
  context: string;
  /** Titles of the chats whose content was found (and labelled). */
  labelled: string[];
}

/**
 * Label every line of `context` that quotes another chat. Lines from
 * this chat, and lines quoting no chat, are left exactly as they are.
 */
export function labelOtherChats(context: string, conversationId: string, conversations?: ChatConversation[]): ProvenanceResult {
  if (!context.trim() || !conversationId) return { context, labelled: [] };
  // Already labelled (a second provider attempt): leave it as it is.
  if (context.includes("## FROM OTHER CHATS")) return { context, labelled: [] };
  const all = conversations ?? MultiChatStore.getInstance().list();
  const index = indexOthers(all, conversationId);
  if (index.size === 0) return { context, labelled: [] };
  const labelled = new Set<string>();
  const lines = context.split("\n").map((line) => {
    const title = sourceOf(line, index);
    if (!title) return line;
    labelled.add(title);
    return `[from the chat “${title}”] ${line}`;
  });
  if (labelled.size === 0) return { context, labelled: [] };
  const sources = [...labelled].map((title) => `“${title}”`).join(", ");
  const note =
    "## FROM OTHER CHATS\n" +
    `Lines marked [from the chat “…”] were said in another of the user's chats (${sources}), not this one. ` +
    "Never present them as something said or known here. If one bears on this question, EITHER answer and say where it came from " +
    "in the same sentence — e.g. “From our “…” chat: …” — OR ask whether to bring that chat in. Using one without naming its chat is wrong.";
  // At the top as well as the end: in a long context the end alone was
  // measured to be missed (she answered from a labelled line unattributed).
  return { context: `${note}\n\n${lines.join("\n")}\n\n${note}`, labelled: [...labelled] };
}

/** "Remember this for this chat", "only in this chat": kept to that chat, not long-term memory. */
export const CHAT_SCOPED = /\b(?:for|in|just in|only in|within) this (?:chat|conversation|thread)\b|\b(?:this chat|this conversation) only\b|\b(?:don'?t|do not) (?:remember|store|save) (?:this|it)\b/i;
