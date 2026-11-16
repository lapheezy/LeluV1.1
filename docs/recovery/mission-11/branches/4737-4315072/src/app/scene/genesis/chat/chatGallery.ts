/**
 * ==========================================================
 * LÉLU — CHAT GALLERY (pure)
 *
 * The conversation gallery is a browser for the conversations
 * that already exist: it reads MultiChatStore's metadata and
 * nothing else. It never loads a transcript, never keeps its
 * own list and never stores anything — opening a card hands
 * the id back to the real store, so the gallery cannot drift
 * from what the chats actually are.
 *
 * All of the decisions live here, without React:
 *   - the card a conversation turns into (title, preview, time,
 *     unread / working / pinned state);
 *   - which section it belongs to (Pinned, Today, This week,
 *     This month, Older, Archived);
 *   - which conversations a search + filter leaves visible.
 * ==========================================================
 */

import type { ChatConversation, ChatMessage } from "../../../../core/multichat/MultiChatStore";
import { isDisplayableText } from "./chatTranscript";

/** How much of the latest message a card shows. */
export const GALLERY_PREVIEW_CHARS = 160;

export type GalleryFilter = "all" | "unread" | "working" | "archived";

export const GALLERY_FILTERS: Array<{ id: GalleryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "working", label: "Working" },
  { id: "archived", label: "Archived" },
];

export type GallerySectionTitle = "Pinned" | "Today" | "This week" | "This month" | "Older" | "Archived";

export interface GalleryCard {
  id: string;
  title: string;
  /** The latest thing said, collapsed to one line. */
  preview: string;
  /** Who said the previewed line, so a card can label "You:". */
  previewRole: "user" | "assistant" | null;
  /** When the conversation last changed. */
  timestamp: number;
  unread: number;
  processing: boolean;
  pinned: boolean;
  archived: boolean;
  tags: string[];
  messageCount: number;
}

export interface GallerySection {
  title: GallerySectionTitle;
  cards: GalleryCard[];
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The conversation as a card: metadata and its latest real line. */
export function galleryCard(conversation: ChatConversation): GalleryCard {
  let last: ChatMessage | undefined;
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (isDisplayableText(message.text)) {
      last = message;
      break;
    }
  }
  return {
    id: conversation.id,
    title: conversation.title.trim() || "New chat",
    preview: last ? collapse(last.text).slice(0, GALLERY_PREVIEW_CHARS) : "No messages yet",
    previewRole: last ? last.role : null,
    timestamp: conversation.updatedAt,
    unread: conversation.unread,
    processing: conversation.processing,
    pinned: conversation.pinned,
    archived: conversation.archived,
    tags: conversation.tags,
    messageCount: conversation.messages.length,
  };
}

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Which time section a timestamp falls in, relative to `now`. */
export function sectionFor(timestamp: number, now: number): Exclude<GallerySectionTitle, "Pinned" | "Archived"> {
  if (timestamp >= startOfDay(now)) return "Today";
  if (timestamp >= now - 7 * DAY) return "This week";
  if (timestamp >= now - 31 * DAY) return "This month";
  return "Older";
}

const SECTION_ORDER: Array<Exclude<GallerySectionTitle, "Pinned" | "Archived">> = [
  "Today",
  "This week",
  "This month",
  "Older",
];

/**
 * Group cards for display: pinned first (newest first), then by recency,
 * then archived. Empty sections are omitted — a section label with
 * nothing under it is noise.
 */
export function groupCards(cards: GalleryCard[], now: number): GallerySection[] {
  const byRecency = (a: GalleryCard, b: GalleryCard) => b.timestamp - a.timestamp;
  const sections: GallerySection[] = [];

  const pinned = cards.filter((card) => card.pinned && !card.archived).sort(byRecency);
  if (pinned.length > 0) sections.push({ title: "Pinned", cards: pinned });

  for (const title of SECTION_ORDER) {
    const bucket = cards
      .filter((card) => !card.pinned && !card.archived && sectionFor(card.timestamp, now) === title)
      .sort(byRecency);
    if (bucket.length > 0) sections.push({ title, cards: bucket });
  }

  const archived = cards.filter((card) => card.archived).sort(byRecency);
  if (archived.length > 0) sections.push({ title: "Archived", cards: archived });

  return sections;
}

/** Does this card match what was typed? Title, latest line, tags, topic. */
export function matchesQuery(card: GalleryCard, conversation: ChatConversation, query: string): boolean {
  const needles = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (needles.length === 0) return true;
  const haystack = [card.title, card.preview, conversation.topic, ...card.tags].join(" ").toLowerCase();
  return needles.every((needle) => haystack.includes(needle));
}

export interface GalleryView {
  query: string;
  filter: GalleryFilter;
  now: number;
}

/**
 * What the gallery shows: the conversations the filter includes, narrowed
 * by the search, as sections.
 */
export function gallerySections(
  conversations: ChatConversation[],
  view: GalleryView,
): GallerySection[] {
  const cards = conversations
    .filter((conversation) => {
      switch (view.filter) {
        case "archived":
          return conversation.archived;
        case "unread":
          return !conversation.archived && conversation.unread > 0;
        case "working":
          return !conversation.archived && conversation.processing;
        default:
          return !conversation.archived;
      }
    })
    .filter((conversation) => matchesQuery(galleryCard(conversation), conversation, view.query))
    .map(galleryCard);
  return groupCards(cards, view.now);
}

export interface GalleryCounts {
  all: number;
  unread: number;
  working: number;
  archived: number;
}

export function galleryCounts(conversations: ChatConversation[]): GalleryCounts {
  return {
    all: conversations.filter((conversation) => !conversation.archived).length,
    unread: conversations.filter((conversation) => !conversation.archived && conversation.unread > 0).length,
    working: conversations.filter((conversation) => !conversation.archived && conversation.processing).length,
    archived: conversations.filter((conversation) => conversation.archived).length,
  };
}

/** "just now" / "12m" / "5h" / "3d" — how long ago the chat last changed. */
export function galleryTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
