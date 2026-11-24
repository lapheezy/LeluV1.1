/**
 * M23 WP03 — the shared radial menu: layout and selection rules.
 * CATEGORY: unit (pure geometry). The interaction itself (hold, slide,
 * release; tap; keyboard) is exercised in a real browser by
 * scripts/e2e/radial-e2e.cjs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { angleDistance, layoutRadial, pickRadialItem } from "../src/app/ui/radial/radialGeometry";

const phone = { width: 390, height: 664 };
const desktop = { width: 1440, height: 900 };

function overlaps(items: Array<{ x: number; y: number }>, size: number): boolean {
  for (let i = 0; i < items.length; i += 1)
    for (let j = i + 1; j < items.length; j += 1)
      if (Math.hypot(items[i].x - items[j].x, items[i].y - items[j].y) < size - 0.5) return true;
  return false;
}

test("a control on the bottom edge fans upward, fully on screen, without overlap", () => {
  const layout = layoutRadial({ count: 5, anchor: { x: 195, y: 620 }, viewport: phone, itemSize: 56, margin: 12 });
  assert.equal(layout.fullCircle, false);
  assert.ok(angleDistance(layout.direction, -Math.PI / 2) < 0.3, `opens up (direction ${layout.direction})`);
  for (const item of layout.items) {
    assert.ok(item.y < 620, "every item is above the control");
    assert.ok(item.x - 28 >= 12 && item.x + 28 <= 390 - 12 && item.y - 28 >= 12, "on screen");
  }
  assert.equal(overlaps(layout.items, 56), false);
});

test("a control in the bottom-right corner fans up and to the left", () => {
  const layout = layoutRadial({ count: 4, anchor: { x: 360, y: 630 }, viewport: phone, itemSize: 56, margin: 12 });
  for (const item of layout.items) assert.ok(item.x <= 360 + 1 && item.y <= 630 + 1, JSON.stringify(item));
  assert.equal(overlaps(layout.items, 56), false);
});

test("a control with room on every side gets a full ring", () => {
  const layout = layoutRadial({ count: 6, anchor: { x: 720, y: 450 }, viewport: desktop, itemSize: 46 });
  assert.equal(layout.fullCircle, true);
  assert.equal(layout.items.length, 6);
  assert.equal(overlaps(layout.items, 46), false);
});

test("many items grow the radius instead of overlapping", () => {
  const layout = layoutRadial({ count: 9, anchor: { x: 195, y: 620 }, viewport: phone, itemSize: 56, margin: 12, maxRadius: 170 });
  assert.ok(layout.radius > 90);
  assert.equal(overlaps(layout.items, 56), false);
});

test("selection is by direction; the dead zone and far away cancel", () => {
  const anchor = { x: 195, y: 620 };
  const layout = layoutRadial({ count: 5, anchor, viewport: phone, itemSize: 56, margin: 12 });
  // Pointing straight at each drawn item selects it, even short of the item itself.
  layout.items.forEach((item, index) => {
    const halfway = { x: anchor.x + (item.x - anchor.x) * 0.55, y: anchor.y + (item.y - anchor.y) * 0.55 };
    assert.equal(pickRadialItem(layout, anchor, halfway), index);
  });
  assert.equal(pickRadialItem(layout, anchor, { x: 200, y: 615 }), -1, "release where you pressed cancels");
  assert.equal(pickRadialItem(layout, anchor, { x: 195, y: 0 }), -1, "sliding far past the ring cancels");
  assert.equal(pickRadialItem(layout, anchor, { x: 195, y: 700 }), -1, "a direction outside the arc chooses nothing");
});

test("one implementation: every host uses the shared RadialMenu", () => {
  for (const host of [
    "src/app/scene/spatial/SpatialNavigator.tsx",
    "src/app/scene/genesis/chat/universe/ChatUniverse.tsx",
    "src/app/scene/genesis/GenesisModuleHost.tsx",
    "src/app/scene/genesis/layout/WorkspaceBar.tsx",
  ]) {
    assert.match(readFileSync(host, "utf8"), /from "[./]+(?:\/[\w.]+)*\/ui\/radial\/RadialMenu"/, host);
  }
});
