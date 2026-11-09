/**
 * LÉLU 3F — windows arrange themselves.
 *
 * The old host cascaded windows at 34px intervals, so every pair overlapped.
 * These tests pin the replacement: two desktop workspaces are side by side,
 * three use the full second row, phones stack one column, and no pair
 * overlaps.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { layoutWindowRects, rectsOverlap } from "../src/app/scene/genesis/windowLayout";

function assertNonOverlapping(count: number, width: number, height: number) {
  const rects = layoutWindowRects(count, { width, height });
  assert.equal(rects.length, count);
  for (let i = 0; i < rects.length; i += 1) {
    assert.ok(rects[i].width > 0 && rects[i].height > 0, `rect ${i} has positive size`);
    assert.ok(rects[i].x >= 0 && rects[i].y >= 0, `rect ${i} starts inside the viewport`);
    assert.ok(rects[i].x + rects[i].width <= width, `rect ${i} ends inside the viewport`);
    assert.ok(rects[i].y + rects[i].height <= height, `rect ${i} ends inside the viewport`);
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.equal(rectsOverlap(rects[i], rects[j]), false, `rect ${i} does not overlap rect ${j}`);
    }
  }
  return rects;
}

test("two desktop workspaces tile side by side", () => {
  const [left, right] = assertNonOverlapping(2, 1440, 900);
  assert.equal(left.y, right.y);
  assert.equal(left.width, right.width);
  assert.ok(right.x > left.x + left.width - 1);
});

test("a large desktop keeps a centre channel for the scene and LÉLU", () => {
  const [left, right] = layoutWindowRects(2, { width: 1440, height: 900 }, { centerGap: 220 });
  const channel = right.x - (left.x + left.width);
  assert.ok(channel >= 220, `expected at least a 220px channel, got ${channel}px`);
  assert.equal(left.x, 88);
  assert.equal(right.x + right.width, 1424);
});

test("three workspaces use the spare width on the second row", () => {
  const rects = assertNonOverlapping(3, 1440, 900);
  assert.equal(rects[2].x, rects[0].x);
  assert.ok(rects[2].width > rects[0].width);
});

test("phone windows stack in one column and keep usable height", () => {
  const rects = assertNonOverlapping(2, 390, 844);
  assert.equal(rects[0].x, rects[1].x);
  assert.equal(rects[0].width, rects[1].width);
  assert.ok(rects[0].height >= 220);
  assert.ok(rects[1].y > rects[0].y);
});

test("layout returns nothing for no open windows", () => {
  assert.deepEqual(layoutWindowRects(0, { width: 1440, height: 900 }), []);
});
