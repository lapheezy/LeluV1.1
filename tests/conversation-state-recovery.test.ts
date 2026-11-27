/**
 * ==========================================================
 * LÉLU — CONVERSATION STATE RECOVERY
 *
 * CATEGORY: integration. The real MultiChatStore over a stub backend.
 *
 * A turn that was running when the tab went away leaves `processing: true` in
 * the persisted workspace. Read back on the next load, that is a spinner for a
 * turn that no longer exists — the client saying "still working" about work
 * that is finished, which is the discrepancy Mission 44.4 reported (server
 * complete, client stuck). A freshly loaded page has no turn in flight, so the
 * flag cannot survive the load.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

const data: Record<string, string> = {};
const storage = {
  getItem: (key: string) => data[key] ?? null,
  setItem: (key: string, value: string) => {
    data[key] = value;
  },
  removeItem: (key: string) => {
    delete data[key];
  },
  clear: () => {
    for (const key of Object.keys(data)) delete data[key];
  },
  get length() {
    return Object.keys(data).length;
  },
  key: (index: number) => Object.keys(data)[index] ?? null,
};

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
(globalThis as Record<string, unknown>).localStorage = storage;
(globalThis as Record<string, unknown>).sessionStorage = storage;

import MultiChatStore from "../src/core/multichat/MultiChatStore";

const WORKSPACE_KEY = "lelu.multichat.workspace.v1";

test("a conversation persisted mid-turn is not read back as Processing", () => {
  const conversation = {
    id: "conv-mid-turn",
    title: "A turn that outlived its tab",
    messages: [
      { id: "m1", role: "user", text: "check the branch", timestamp: 1, source: "local" },
      { id: "m2", role: "assistant", text: "The branch is mission/44-5.", timestamp: 2, source: "ai" },
    ],
    createdAt: 1,
    updatedAt: 2,
    pinned: false,
    archived: false,
    linkedIds: [],
    projectId: null,
    tags: [],
    topic: "",
    unread: 0,
    processing: true,
  };
  data[WORKSPACE_KEY] = JSON.stringify({ conversations: [conversation], activeId: conversation.id });

  const store = MultiChatStore.getInstance();
  const loaded = store.get(conversation.id);

  assert.ok(loaded, "the stored conversation was not loaded");
  assert.equal(
    loaded?.processing,
    false,
    "a turn that ended with the tab is still reported as processing after a reload",
  );
  // The conversation itself is untouched: history, reply and identity survive.
  assert.equal(loaded?.messages.length, 2);
  assert.equal(loaded?.messages[1].text, "The branch is mission/44-5.");
});

test("a running turn is visible as work in progress, and cleared when it ends", () => {
  const store = MultiChatStore.getInstance();
  const created = store.create("A live turn");

  assert.ok(created.id.length > 0);
  store.setProcessing(created.id, true);
  assert.equal(store.get(created.id)?.processing, true, "a running turn is not visible as work in progress");
  store.setProcessing(created.id, false);
  assert.equal(store.get(created.id)?.processing, false, "a finished turn still says processing");
});
