/**
 * ==========================================================
 * LÉLU — ONE WORKSPACE LAYOUT (tests)
 *
 * The contract this file pins: auto-arrange never moves a rect
 * a person placed, auto rects never overlap, restoring is
 * reproducible, a viewport change keeps geometry usable, and a
 * legacy layout migrates without inventing or silently dropping
 * anything.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKSPACE,
  addEntry,
  autoArrange,
  dockOrder,
  migrateLayout,
  placeManual,
  readLayout,
  reflowForViewport,
  releaseManual,
  removeEntry,
  reorder,
  restoreAutoLayout,
  setMinimized,
  setPinned,
  workspaceEntries,
  type ModuleLayoutEntry,
} from "../src/app/scene/genesis/layout/moduleLayout";
import { rectsOverlap } from "../src/app/scene/genesis/windowLayout";

const desktop = { width: 1440, height: 900 };

function entry(moduleId: string, overrides: Partial<ModuleLayoutEntry> = {}): ModuleLayoutEntry {
  return {
    moduleId,
    rect: { x: 100, y: 100, width: 400, height: 320 },
    zIndex: 200,
    manual: false,
    pinned: false,
    minimized: false,
    workspace: DEFAULT_WORKSPACE,
    ...overrides,
  };
}

test("auto-arrange tiles modules without overlapping them", () => {
  const arranged = autoArrange([entry("a", { zIndex: 200 }), entry("b", { zIndex: 201 }), entry("c", { zIndex: 202 })], desktop);
  for (let i = 0; i < arranged.length; i += 1) {
    for (let j = i + 1; j < arranged.length; j += 1) {
      assert.ok(!rectsOverlap(arranged[i].rect, arranged[j].rect), `${arranged[i].moduleId} and ${arranged[j].moduleId} do not overlap`);
    }
  }
  for (const item of arranged) {
    assert.ok(item.rect.x >= 0 && item.rect.y >= 0);
    assert.ok(item.rect.x + item.rect.width <= desktop.width);
    assert.ok(item.rect.y + item.rect.height <= desktop.height);
  }
});

test("auto-arrange never moves a manually placed module", () => {
  const manualRect = { x: 24, y: 36, width: 500, height: 400 };
  const entries = [entry("hand", { manual: true, rect: manualRect, zIndex: 200 }), entry("auto", { zIndex: 201 })];
  const arranged = autoArrange(entries, desktop);
  assert.deepEqual(arranged[0].rect, manualRect, "the person's rect is exactly where they left it");
  assert.ok(!rectsOverlap(arranged[0].rect, arranged[1].rect), "the auto window gets out of its way");
});

test("a manual placement marks the entry and release hands it back to auto", () => {
  const placed = placeManual([entry("earth")], "earth", { x: -40, y: -20, width: 50, height: 50 }, desktop);
  assert.equal(placed[0].manual, true);
  assert.equal(placed[0].rect.x, 0, "a rect off the screen is clamped");
  assert.ok(placed[0].rect.width >= 240, "and kept big enough to be usable");
  assert.equal(releaseManual(placed, "earth")[0].manual, false);
});

test("restore regenerates the layout reproducibly and reports what moved", () => {
  const entries = [entry("a", { manual: true, rect: { x: 400, y: 300, width: 300, height: 200 } }), entry("b")];
  const first = restoreAutoLayout(entries, desktop);
  const second = restoreAutoLayout(entries, desktop);
  assert.deepEqual(first.entries, second.entries, "the same input gives the same layout");
  assert.ok(first.changed.includes("a"), "the manual module is reported as moved");
  assert.equal(first.entries[0].manual, false);
});

test("a viewport change keeps every rect on screen and manual rects in place", () => {
  const manualRect = { x: 900, y: 500, width: 400, height: 300 };
  const entries = [entry("hand", { manual: true, rect: manualRect }), entry("auto")];
  const phone = reflowForViewport(entries, { width: 390, height: 844 });
  for (const item of phone) {
    assert.ok(item.rect.width <= 390 && item.rect.height <= 844, `${item.moduleId} fits the phone`);
    assert.ok(item.rect.x >= 0 && item.rect.y >= 0);
    assert.ok(item.rect.x + item.rect.width <= 390);
  }
  assert.ok(phone[0].rect.x <= manualRect.x, "the manual window is pulled back only as far as needed");
});

test("dock order puts pinned modules first and reorder moves a module into a slot", () => {
  const entries = [
    entry("a", { pinned: true, zIndex: 200 }),
    entry("b", { pinned: false, zIndex: 201 }),
    entry("c", { pinned: true, zIndex: 202 }),
  ];
  assert.deepEqual(dockOrder(entries), ["a", "c", "b"], "a pinned module leads; an unpinned module follows in z order");
  const moved = reorder(entries, "a", "c");
  assert.deepEqual(dockOrder(moved), ["c", "a", "b"]);
  assert.equal(removeEntry(entries, "c").length, 2);
  assert.equal(setPinned(entries, "b", true)[1].pinned, true);
  assert.equal(setMinimized(entries, "a", true)[0].minimized, true);
});

test("workspace filtering keeps configurations separate", () => {
  const entries = [entry("a"), entry("b", { workspace: "client" }), addEntry([], "c")[0]];
  assert.deepEqual(workspaceEntries(entries).map((item) => item.moduleId), ["a", "c"]);
  assert.deepEqual(workspaceEntries(entries, "client").map((item) => item.moduleId), ["b"]);
  assert.equal(addEntry(entries, "a").length, 3, "adding a known module changes nothing");
});

test("legacy geometry migrates as manual placement, and unreadable geometry is counted", () => {
  const migrated = migrateLayout(
    [
      { moduleId: "earth", position: { x: 40, y: 60 }, size: { width: 420, height: 300 }, zIndex: 205 },
      { moduleId: "browser" },
      { moduleId: "broken", position: { x: Number.NaN, y: 0 } },
      { moduleId: "" },
    ],
    { order: ["browser", "earth"], hidden: ["browser"] },
    desktop,
  );
  assert.deepEqual(migrated.migrated, ["earth", "browser"]);
  const earth = migrated.layout.entries.find((item) => item.moduleId === "earth")!;
  assert.equal(earth.manual, true, "a module the person had positioned is manual");
  assert.deepEqual({ x: earth.rect.x, y: earth.rect.y }, { x: 40, y: 60 });
  const browser = migrated.layout.entries.find((item) => item.moduleId === "browser")!;
  assert.equal(browser.pinned, false, "a hidden dock item migrates as unpinned, not deleted");
  assert.equal(browser.manual, false);
  assert.equal(migrated.skipped, 2, "the NaN rect and the empty id are reported, not invented");
});

test("a pinned module holds its rect during auto-arrange, and regenerate overrides it", () => {
  const held = { x: 640, y: 120, width: 420, height: 300 };
  const entries = [entry("held", { pinned: true, rect: held, zIndex: 200 }), entry("free", { zIndex: 201 })];
  const arranged = autoArrange(entries, desktop);
  assert.deepEqual(arranged[0].rect, held, "pin means the window stays where it is");
  assert.ok(!rectsOverlap(arranged[0].rect, arranged[1].rect), "and the automatic window avoids it");
  const restored = restoreAutoLayout(entries, desktop);
  assert.notDeepEqual(restored.entries[0].rect, held, "an explicit regenerate is the person's decision");
  assert.equal(restored.entries[0].pinned, true, "the pin preference itself is preserved");
  assert.equal(restored.entries[0].manual, false, "regenerate hands everything back to auto");
});

test("a stored layout is re-validated and corrupt entries are reported", () => {
  const parsed = readLayout({
    version: 2,
    workspace: "default",
    updatedAt: 5,
    entries: [
      { moduleId: "earth", rect: { x: 10, y: 10, width: 300, height: 200 }, zIndex: 200, manual: true, pinned: true, minimized: false, workspace: "default" },
      { moduleId: "bad", rect: { x: "nope", y: 0 } },
      { nope: true },
    ],
  });
  assert.equal(parsed.layout.entries.length, 1);
  assert.equal(parsed.skipped, 2);
  assert.equal(parsed.layout.entries[0].manual, true, "manual placement survives a reload");
});

test("an absent layout is empty, not an error", () => {
  const parsed = readLayout(null);
  assert.deepEqual(parsed.layout.entries, []);
  assert.equal(parsed.skipped, 0);
});
