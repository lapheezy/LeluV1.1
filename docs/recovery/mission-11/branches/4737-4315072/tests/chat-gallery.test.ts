/**
 * ==========================================================
 * LÉLU — CHAT GALLERY
 *
 * CATEGORY: unit. The gallery is a view over MultiChatStore: cards
 * carry metadata and the latest line, sections are decided by
 * recency and pinning, and search/filters narrow the same list.
 * Those rules are tested here, without a browser.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  GALLERY_FILTERS,
  GALLERY_PREVIEW_CHARS,
  galleryCard,
  galleryCounts,
  gallerySections,
  galleryTimeAgo,
  groupCards,
  matchesQuery,
  sectionFor,
  type GalleryCard,
} from "../src/app/scene/genesis/chat/chatGallery";
import type { ChatConversation } from "../src/core/multichat/MultiChatStore";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-28T12:00:00Z").getTime();

function conversation(overrides: Partial<ChatConversation> & { id: string }): ChatConversation {
  return {
    title: "New chat",
    messages: [],
    createdAt: NOW - DAY,
    updatedAt: NOW - HOUR,
    pinned: false,
    archived: false,
    linkedIds: [],
    projectId: null,
    tags: [],
    topic: "general",
    unread: 0,
    processing: false,
    ...overrides,
  };
}

function said(text: string, role: "user" | "assistant" = "user", at = NOW - HOUR) {
  return { id: `${role}-${text.slice(0, 8)}-${at}`, role, text, timestamp: at, source: "ai" as const };
}

test("a card carries the conversation's metadata and its latest real line", () => {
  const card = galleryCard(
    conversation({
      id: "a",
      title: "Spring capsule",
      unread: 3,
      processing: true,
      pinned: true,
      tags: ["fashion"],
      messages: [said("Design a spring capsule", "user", NOW - 2 * HOUR), said("Starting with three looks.", "assistant", NOW - HOUR)],
    }),
  );
  assert.equal(card.title, "Spring capsule");
  assert.equal(card.preview, "Starting with three looks.");
  assert.equal(card.previewRole, "assistant");
  assert.equal(card.unread, 3);
  assert.equal(card.processing, true);
  assert.equal(card.pinned, true);
  assert.deepEqual(card.tags, ["fashion"]);
  assert.equal(card.messageCount, 2);
});

test("a card previews the latest displayable line, collapsed and bounded", () => {
  const long = `word ${"x".repeat(GALLERY_PREVIEW_CHARS * 2)}`;
  const card = galleryCard(
    conversation({
      id: "b",
      messages: [said("the real line"), said("undefined", "assistant"), { ...said(long), id: "long" }],
    }),
  );
  assert.equal(card.preview.length, GALLERY_PREVIEW_CHARS, "the preview is clipped, not the whole reply");
  const silent = galleryCard(conversation({ id: "c" }));
  assert.equal(silent.preview, "No messages yet");
  assert.equal(silent.previewRole, null);
  const collapsed = galleryCard(conversation({ id: "d", messages: [said("one\n\n   two")] }));
  assert.equal(collapsed.preview, "one two");
});

test("sections follow recency: today, this week, this month, older", () => {
  assert.equal(sectionFor(NOW - HOUR, NOW), "Today");
  assert.equal(sectionFor(NOW - 3 * DAY, NOW), "This week");
  assert.equal(sectionFor(NOW - 14 * DAY, NOW), "This month");
  assert.equal(sectionFor(NOW - 90 * DAY, NOW), "Older");
  const cards = [
    galleryCard(conversation({ id: "now", updatedAt: NOW - HOUR })),
    galleryCard(conversation({ id: "week", updatedAt: NOW - 3 * DAY })),
    galleryCard(conversation({ id: "old", updatedAt: NOW - 90 * DAY })),
  ];
  assert.deepEqual(
    groupCards(cards, NOW).map((section) => section.title),
    ["Today", "This week", "Older"],
    "empty sections are omitted",
  );
});

test("pinned conversations come first, newest first, and are not repeated", () => {
  const cards = [
    galleryCard(conversation({ id: "old-pin", pinned: true, updatedAt: NOW - 40 * DAY })),
    galleryCard(conversation({ id: "new-pin", pinned: true, updatedAt: NOW - HOUR })),
    galleryCard(conversation({ id: "today", updatedAt: NOW - 2 * HOUR })),
  ];
  const sections = groupCards(cards, NOW);
  assert.equal(sections[0].title, "Pinned");
  assert.deepEqual(sections[0].cards.map((card) => card.id), ["new-pin", "old-pin"]);
  const elsewhere = sections.slice(1).flatMap((section) => section.cards.map((card) => card.id));
  assert.deepEqual(elsewhere, ["today"], "a pinned chat is not listed again under its age");
});

test("archived conversations are hidden by default and shown on their own", () => {
  const list = [
    conversation({ id: "live", updatedAt: NOW - HOUR }),
    conversation({ id: "gone", archived: true, updatedAt: NOW - 2 * HOUR }),
  ];
  assert.deepEqual(
    gallerySections(list, { query: "", filter: "all", now: NOW }).flatMap((s) => s.cards.map((c) => c.id)),
    ["live"],
  );
  assert.deepEqual(
    gallerySections(list, { query: "", filter: "archived", now: NOW }).flatMap((s) => s.cards.map((c) => c.id)),
    ["gone"],
  );
});

test("filters show unread and working chats, from real store state", () => {
  const list = [
    conversation({ id: "unread", unread: 2 }),
    conversation({ id: "working", processing: true }),
    conversation({ id: "quiet" }),
  ];
  const ids = (filter: "unread" | "working") =>
    gallerySections(list, { query: "", filter, now: NOW }).flatMap((s) => s.cards.map((c) => c.id));
  assert.deepEqual(ids("unread"), ["unread"]);
  assert.deepEqual(ids("working"), ["working"]);
  assert.deepEqual(
    galleryCounts(list),
    { all: 3, unread: 1, working: 1, archived: 0 },
    "counts describe the whole list, not the filtered view",
  );
});

test("search matches the title, the latest line and tags, case-insensitively", () => {
  const list = [
    conversation({ id: "title", title: "Spring capsule", messages: [said("three looks")] }),
    conversation({ id: "body", title: "Untitled", messages: [said("check the CAPSULE colours")] }),
    conversation({ id: "tagged", title: "Untitled", tags: ["capsule"] }),
    conversation({ id: "other", title: "Taxes" }),
  ];
  const ids = (query: string) =>
    gallerySections(list, { query, filter: "all", now: NOW }).flatMap((s) => s.cards.map((c) => c.id)).sort();
  assert.deepEqual(ids("capsule"), ["body", "tagged", "title"]);
  assert.deepEqual(ids("  CAPSULE  colours "), ["body"], "every word must match, and spacing is irrelevant");
  assert.deepEqual(ids("nothing-like-this"), []);
  assert.deepEqual(ids(""), ["body", "other", "tagged", "title"], "an empty search shows everything");
});

test("matchesQuery reads metadata only — never a transcript", () => {
  const card = galleryCard(conversation({ id: "x", title: "A", messages: [said("hello")] }));
  assert.equal(matchesQuery(card, conversation({ id: "x" }), ""), true);
  assert.equal(matchesQuery(card, conversation({ id: "x" }), "hello"), true);
  const source = readFileSync("src/app/scene/genesis/chat/ChatGallery.tsx", "utf8");
  assert.ok(!source.includes("ChatTranscript"), "the gallery must not render conversation transcripts");
  assert.ok(!source.includes(".messages.map"), "the gallery renders metadata cards, not messages");
  assert.match(source, /data-lelu-gallery-card/, "cards are addressable for verification");
});

test("the gallery offers every filter the spec names, with stable ids", () => {
  assert.deepEqual(
    GALLERY_FILTERS.map((filter) => filter.id),
    ["all", "unread", "working", "archived"],
  );
});

test("relative times are short and honest", () => {
  assert.equal(galleryTimeAgo(NOW, NOW), "just now");
  assert.equal(galleryTimeAgo(NOW - 12 * 60 * 1000, NOW), "12m ago");
  assert.equal(galleryTimeAgo(NOW - 5 * HOUR, NOW), "5h ago");
  assert.equal(galleryTimeAgo(NOW - 3 * DAY, NOW), "3d ago");
});

test("the gallery is wired to the existing store, not a second one", () => {
  const tabs = readFileSync("src/app/scene/genesis/MultiChatTabs.tsx", "utf8");
  assert.match(tabs, /import MultiChatStore from "\.\.\/\.\.\/\.\.\/core\/multichat\/MultiChatStore"/);
  assert.match(tabs, /<ChatGallery/, "the gallery is mounted from the chat's own tab bar");
  assert.match(tabs, /onPin=\{pinConversation\}/, "pin goes to the real store operation");
  assert.match(tabs, /onRename=\{renameConversation\}/, "rename goes to the real store operation");
  assert.match(tabs, /onDelete=\{closeConversation\}/, "delete goes to the real store operation");
  assert.match(tabs, /MultiChatStore\.getInstance\(\)\.archive/, "archive uses the store method");
  assert.match(tabs, /MultiChatStore\.getInstance\(\)\.unarchive/, "restore uses the store method");
  const gallery = readFileSync("src/app/scene/genesis/chat/ChatGallery.tsx", "utf8");
  assert.ok(
    !gallery.includes("MultiChatStore") || !gallery.includes("new MultiChatStore"),
    "the gallery takes the store operations as props instead of keeping a second store of its own",
  );
  assert.ok(!gallery.includes("KvStore"), "the gallery stores nothing");
});

test("deleting asks for confirmation before anything is removed", () => {
  const gallery = readFileSync("src/app/scene/genesis/chat/ChatGallery.tsx", "utf8");
  assert.match(gallery, /confirmDelete/, "a second, deliberate tap is required");
  assert.match(gallery, /Delete for good\?/, "the confirming control says what it will do");
});

const card = (id: string, at: number): GalleryCard => galleryCard(conversation({ id, updatedAt: at }));
test("cards sort newest first inside a section", () => {
  const sections = groupCards([card("a", NOW - 3 * HOUR), card("b", NOW - HOUR)], NOW);
  assert.deepEqual(sections[0].cards.map((item) => item.id), ["b", "a"]);
});
