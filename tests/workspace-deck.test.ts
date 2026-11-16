/**
 * The deck must hold more than four surfaces without shrinking the working
 * one to unusable size, without overlapping, and without ever closing a
 * surface to make room.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { rectsOverlap, type WindowRect } from "../src/app/scene/genesis/windowLayout";
import {
  deckCapacity,
  deckDensity,
  planDeck,
  promoteDeck,
  type DeckPlan,
  type DeckViewport,
} from "../src/core/workspace/workspaceDeck";

const PHONE: DeckViewport = { width: 390, height: 844 };
const TABLET: DeckViewport = { width: 820, height: 1180 };
const DESKTOP: DeckViewport = { width: 1440, height: 900 };
const ULTRAWIDE: DeckViewport = { width: 1920, height: 1080 };
const VIEWPORTS = [PHONE, TABLET, DESKTOP, ULTRAWIDE];
const COUNTS = [1, 2, 3, 4, 6, 8, 12, 20];

const ids = (count: number) => Array.from({ length: count }, (_, index) => `surface-${index}`);
const allRects = (plan: DeckPlan): WindowRect[] =>
  [plan.primary, ...plan.previews].filter((window): window is NonNullable<typeof window> => Boolean(window));

test("density follows the viewport, not a device guess", () => {
  assert.equal(deckDensity(390), "compact");
  assert.equal(deckDensity(719), "compact");
  assert.equal(deckDensity(720), "regular");
  assert.equal(deckDensity(1279), "regular");
  assert.equal(deckDensity(1280), "wide");
  assert.equal(deckDensity(1920), "wide");
});

test("no surface is ever lost: primary + previews + shelf is the whole set", () => {
  for (const viewport of VIEWPORTS) {
    for (const count of COUNTS) {
      const surfaces = ids(count);
      const plan = planDeck(surfaces, surfaces[0], viewport);
      const seen = [plan.primary!.id, ...plan.previews.map((preview) => preview.id), ...plan.shelf];
      assert.equal(seen.length, surfaces.length, `${count} surfaces at ${viewport.width}px stay accounted for`);
      assert.deepEqual([...seen].sort(), [...surfaces].sort(), "nothing is closed to make room");
      assert.equal(plan.visible, 1 + plan.previews.length);
      assert.equal(plan.capacity, plan.visible);
    }
  }
});

test("no two surfaces overlap, and all of them stay inside the viewport", () => {
  for (const viewport of VIEWPORTS) {
    for (const count of COUNTS) {
      const surfaces = ids(count);
      const plan = planDeck(surfaces, surfaces[Math.min(2, count - 1)], viewport);
      const rects = allRects(plan);
      for (let index = 0; index < rects.length; index += 1) {
        const rect = rects[index];
        assert.ok(rect.width > 0 && rect.height > 0, `${rect.id} has area`);
        assert.ok(rect.x >= 0 && rect.y >= 0, `${rect.id} starts inside the viewport`);
        assert.ok(rect.x + rect.width <= viewport.width + 1, `${rect.id} does not overflow horizontally`);
        assert.ok(rect.y + rect.height <= viewport.height + 1, `${rect.id} does not overflow vertically`);
        for (let other = index + 1; other < rects.length; other += 1) {
          assert.equal(
            rectsOverlap(rect, rects[other]),
            false,
            `${rect.id} and ${rects[other].id} do not overlap at ${viewport.width}x${viewport.height}`,
          );
        }
      }
    }
  }
});

test("the working surface keeps a usable size at every viewport", () => {
  for (const viewport of VIEWPORTS) {
    const surfaces = ids(8);
    const plan = planDeck(surfaces, surfaces[0], viewport);
    const primary = plan.primary!;
    assert.ok(primary.width >= Math.min(320, viewport.width), `primary width at ${viewport.width}px`);
    assert.ok(primary.height >= 220, `primary height at ${viewport.width}px`);
    assert.equal(primary.role, "primary");
  }
});

test("focus is promoted, and promotion changes only the arrangement", () => {
  const surfaces = ids(8);
  const plan = planDeck(surfaces, surfaces[0], DESKTOP);
  assert.equal(plan.primary!.id, surfaces[0]);

  const promoted = promoteDeck(plan, surfaces[3], surfaces, DESKTOP);
  assert.equal(promoted.primary!.id, surfaces[3], "the promoted surface takes the working area");
  assert.ok(promoted.previews.some((preview) => preview.id === surfaces[0]), "the old primary becomes a live preview");
  assert.equal(promoted.visible, plan.visible, "promotion does not change how much is visible");

  assert.equal(promoteDeck(plan, "not-open", surfaces, DESKTOP), plan, "promoting an unopened surface is a no-op");
  assert.equal(planDeck(surfaces, "not-open", DESKTOP).primary!.id, surfaces[0], "unknown focus falls back to the first");
});

test("there is no four-window ceiling", () => {
  // The old layout showed four full windows and stacked the rest. The deck
  // must show more than four surfaces at once on a desktop, and keep growing.
  const desktop = deckCapacity(DESKTOP);
  const ultrawide = deckCapacity(ULTRAWIDE);
  const tablet = deckCapacity(TABLET);
  const phone = deckCapacity(PHONE);

  assert.ok(desktop >= 6, `a 1440x900 desktop shows at least six surfaces (measured ${desktop})`);
  assert.ok(ultrawide >= desktop, `growing the viewport never reduces capacity (${ultrawide} vs ${desktop})`);
  assert.ok(tablet >= 4, `a tablet shows at least four (measured ${tablet})`);
  assert.ok(phone >= 2, `a phone still shows the working surface plus a preview (measured ${phone})`);

  const plan = planDeck(ids(12), "surface-0", DESKTOP);
  assert.ok(plan.visible > 4, `twelve open surfaces: ${plan.visible} visible at once`);
  assert.ok(plan.shelf.length < 12, "the shelf is not just a rename of the old behaviour");
});

test("the phone never lets a preview cover the composer strip", () => {
  const plan = planDeck(ids(6), "surface-0", PHONE);
  const primary = plan.primary!;
  const stripTop = Math.min(...plan.previews.map((preview) => preview.y));
  assert.ok(stripTop > primary.y + primary.height - 1, "previews sit below the working surface");
  assert.ok(primary.y + primary.height + 8 <= PHONE.height - 96 + 1, "the primary stops above the dock and composer");
});
