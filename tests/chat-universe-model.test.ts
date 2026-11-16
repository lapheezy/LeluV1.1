import assert from "node:assert/strict";
import test from "node:test";
import { contextReferences, gridOrder, recentOrder, timelineMarkers, previewOf } from "../src/app/scene/genesis/chat/universe/universeModel";
import type { ChatConversation } from "../src/core/multichat/MultiChatStore";

const NOW = new Date("2026-11-04T15:00:00").getTime();
const H = 3600_000;
function chat(id: string, updatedAt: number, extra: Partial<ChatConversation> = {}): ChatConversation {
  return { id, title: id, messages: [{ id: id + "m", role: "assistant", text: `hello from ${id}`, timestamp: updatedAt, source: "ai" }], createdAt: updatedAt - H, updatedAt, pinned: false, archived: false, linkedIds: [], projectId: null, tags: [], topic: "", unread: 0, processing: false, ...extra };
}

test("grid keeps the user's order (pins first), never a topic sort", () => {
  const order = gridOrder([chat("a", NOW - 5 * H), chat("b", NOW - H, { pinned: true }), chat("c", NOW)]).map((p) => p.id);
  assert.deepEqual(order, ["b", "a", "c"]);
});

test("dock is most recently used first, from stored timestamps", () => {
  assert.deepEqual(recentOrder([chat("a", NOW - 5 * H), chat("c", NOW)]).map((p) => p.id), ["c", "a"]);
  assert.equal(previewOf(chat("x", NOW)).lastText, "hello from x");
});

test("timeline only places real timestamps inside the range", () => {
  const markers = timelineMarkers([chat("a", NOW - 2 * H), chat("old", NOW - 48 * H)], "24h", NOW);
  assert.ok(markers.every((m) => m.conversationId === "a"));
  assert.ok(markers.every((m) => m.position >= 0 && m.position <= 1));
});

test("shared context is tiered references, current first, archived never above older", () => {
  const refs = contextReferences([chat("old", NOW - 10 * 24 * H), chat("y", NOW - 20 * H), chat("cur", NOW), chat("arch", NOW, { archived: true })], "cur", NOW);
  assert.equal(refs[0].conversationId, "cur");
  assert.equal(refs.find((r) => r.conversationId === "arch")?.tier, "older");
  assert.ok(refs.every((r) => !("messages" in r)));
});
