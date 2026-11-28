import { test } from "node:test";
import assert from "node:assert/strict";
import { placeArcs, isBottomAnchored } from "../src/core/interaction/geometry";

const dial = (w: number, h: number) => ({ left: w / 2 - 34, top: h - 100, width: 68, height: 68 });
const inner = [...Array(9).fill(false), ...Array(5).fill(true)];

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`bottom dial at ${w}×${h}: options fan upward, stay on screen, and never overlap`, () => {
    const a = dial(w, h);
    assert.ok(isBottomAnchored(a, { width: w, height: h }));
    const p = placeArcs(a, { width: w, height: h }, { optionSize: 52, inner });
    const abs = p.positions.map((q) => ({ x: p.centerX + q.x, y: p.centerY + q.y, ring: q.ring }));
    for (const q of abs) {
      assert.ok(q.y < p.centerY, "every option is above the dial");
      assert.ok(q.x >= 26 && q.x <= w - 26, `option on screen horizontally (${Math.round(q.x)})`);
      assert.ok(q.y >= 26, "option on screen vertically");
    }
    for (let i = 0; i < abs.length; i++) for (let j = i + 1; j < abs.length; j++) {
      assert.ok(Math.hypot(abs[i].x - abs[j].x, abs[i].y - abs[j].y) >= 52, `options ${i} and ${j} overlap`);
    }
    // the five utilities share the first arc, right around the dial
    assert.deepEqual(new Set(p.positions.slice(9).map((q) => q.ring)), new Set([0]));
    // the destinations keep their order along one arc, left to right
    const dest = p.positions.slice(0, 9);
    assert.equal(new Set(dest.map((q) => q.ring)).size, 1);
    for (let i = 1; i < dest.length; i++) assert.ok(dest[i].angleDeg > dest[i - 1].angleDeg);
  });
}

test("a dial in the bottom-right corner fans up-left, on screen, without overlaps", () => {
  const w = 1440, h = 900;
  const a = { left: w - 70, top: h - 70, width: 56, height: 56 };
  const p = placeArcs(a, { width: w, height: h }, { optionSize: 52, inner: [false, false, false, false, false] });
  const abs = p.positions.map((q) => ({ x: p.centerX + q.x, y: p.centerY + q.y }));
  for (const q of abs) assert.ok(q.x <= w - 26 && q.x >= 26 && q.y >= 26 && q.y <= p.centerY + 1, JSON.stringify(q));
  for (let i = 0; i < abs.length; i++) for (let j = i + 1; j < abs.length; j++) assert.ok(Math.hypot(abs[i].x - abs[j].x, abs[i].y - abs[j].y) >= 52);
});
