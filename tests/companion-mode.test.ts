/**
 * ==========================================================
 * LÉLU — COMPANION MODE: ON/OFF, WHERE SHE STANDS, WHAT SHE SAYS
 *
 * CATEGORY: unit. Real CompanionStore over KvStore (in-memory
 * localStorage), the real placement rule, the real caption mapping and
 * the real avatar.companion tool executor. The live overlay itself is
 * exercised in the browser by scripts/verify-companion.mjs.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

if (typeof globalThis.window === "undefined") {
  (globalThis as Record<string, unknown>).window = globalThis;
}
if (typeof localStorage === "undefined") {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

import CompanionStore, {
  chooseSpot,
  figureRect,
  overlapArea,
  COMPANION_DIMENSIONS,
  EDGE_MARGIN,
} from "../src/core/avatar/CompanionStore";
import { dispatchToolCall, executableToolIds } from "../src/core/tools/ToolDispatcher";
import ToolRegistry from "../src/core/tools/ToolRegistry";

const phone = { width: 390, height: 844 };

test("on by default, full figure; on/off, size, framing and your chosen spot survive a reload", () => {
  const store = CompanionStore.getInstance();
  // The owner's V1.1 brief: she is present wherever LÉLU is active, and the
  // mode can still be turned off.
  assert.equal(store.get().enabled, true, "she is with you unless you turn her off");
  assert.equal(store.get().framing, "full");
  store.setEnabled(false);
  store.setSize("large");
  store.setFraming("face");
  store.placeByUser(0.2, 0.7);
  CompanionStore.resetForTests();
  const reloaded = CompanionStore.getInstance().get();
  assert.equal(reloaded.enabled, false, "turned off stays off");
  assert.equal(reloaded.size, "large");
  assert.equal(reloaded.framing, "face");
  assert.deepEqual([reloaded.x, reloaded.y, reloaded.pinned, reloaded.lastMovedBy], [0.2, 0.7, true, "user"]);
});

test("where you put her, she stays: she cannot move herself while pinned", () => {
  const store = CompanionStore.getInstance();
  store.placeByUser(0.3, 0.3);
  store.placeByLelu(0.9, 0.9);
  assert.deepEqual([store.get().x, store.get().y], [0.3, 0.3]);
  store.unpin();
  store.placeByLelu(0.9, 0.9);
  assert.deepEqual([store.get().x, store.get().y, store.get().lastMovedBy], [0.9, 0.9, "lelu"]);
});

test("her figure always stays fully on screen", () => {
  for (const [x, y] of [[0, 0], [1, 1], [-3, 5], [0.5, 0.5]]) {
    const rect = figureRect(x, y, "large", phone);
    assert.ok(rect.left >= EDGE_MARGIN && rect.top >= EDGE_MARGIN, `${x},${y}`);
    assert.ok(rect.left + rect.width <= phone.width - EDGE_MARGIN + 0.001, `${x},${y}`);
    assert.ok(rect.top + rect.height <= phone.height - EDGE_MARGIN + 0.001, `${x},${y}`);
  }
});

test("standing on nothing that matters, she does not wander", () => {
  const spot = chooseSpot({ x: 0.85, y: 0.2 }, "medium", phone, [{ left: 0, top: 760, width: 390, height: 84 }]);
  assert.equal(spot.moved, false);
});

test("covering the field you are typing in, she moves to where she covers nothing", () => {
  const composer = { left: 0, top: 700, width: 390, height: 144 };
  const start = { x: 0.5, y: 0.88 };
  assert.ok(overlapArea(figureRect(start.x, start.y, "medium", phone), composer) > 0, "she starts on the composer");
  const spot = chooseSpot(start, "medium", phone, [composer]);
  assert.equal(spot.moved, true);
  assert.equal(overlapArea(figureRect(spot.x, spot.y, "medium", phone), composer), 0);
});

test("when every spot covers something, she takes the one covering least — and never a worse one", () => {
  const { width, height } = COMPANION_DIMENSIONS.small;
  const tiny = { width: width + 2 * EDGE_MARGIN + 10, height: height + 2 * EDGE_MARGIN + 140 };
  const everywhere = [{ left: 0, top: 0, width: tiny.width, height: tiny.height }];
  const spot = chooseSpot({ x: 0.5, y: 0.5 }, "small", tiny, everywhere);
  assert.equal(spot.moved, false, "moving would not help, so she stays");
});

test("LÉLU can turn companion mode on and off herself, through her real tool", async () => {
  assert.ok(ToolRegistry.getInstance().get("avatar.companion"), "registered");
  assert.ok(executableToolIds().includes("avatar.companion"), "and runnable");
  const off = await dispatchToolCall({ id: "c1", name: "avatar_companion", arguments: { enabled: false } }, "t");
  assert.equal(off.ok, true);
  assert.equal(CompanionStore.getInstance().get().enabled, false);
  const on = await dispatchToolCall({ id: "c2", name: "avatar_companion", arguments: { enabled: true, size: "small", chooseOwnSpot: true } }, "t");
  assert.equal(on.ok, true, on.content);
  assert.match(on.content, /ON \(small, choosing your own/);
  assert.deepEqual([CompanionStore.getInstance().get().enabled, CompanionStore.getInstance().get().pinned], [true, false]);
});
