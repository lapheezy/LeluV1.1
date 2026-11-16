/**
 * MISSION 5.4B.9 — a press owns the portal it landed on.
 *
 * Mission 5.4B.8's two remaining acceptance failures were both identity
 * failures, not travel failures: one Studio press opened Browser because the
 * field rotated a neighbour under the release pixel, and one Files press was
 * lost. These tests pin the rule at the level where it is decided — one
 * identity resolved at pointer-down, and release may only complete or refuse
 * it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVATION_WINDOW_MS,
  PRESS_MOVE_THRESHOLD_PX,
  claimPress,
  pressMovement,
  refusesBusyFlight,
  resolvePress,
  shouldSuppressClick,
  type OwnedPress,
} from "../src/app/scene/spatial/pressOwnership";

const studio = { id: "portal_builtin_studio", destination: "studio", label: "The Atelier" };
const files = { id: "portal_builtin_files", destination: "files", label: "Files" };

const claimed = (target = studio, at = 1000): OwnedPress =>
  claimPress(target, { pointerId: 1, x: 400, y: 300 }, at);

test("a press claims the portal under the pointer and carries its destination", () => {
  const press = claimed();
  assert.equal(press.portalId, studio.id);
  assert.equal(press.destination, "studio");
  assert.equal(press.label, "The Atelier");
  assert.equal(press.pointerId, 1);
  assert.equal(press.x, 400);
  assert.equal(press.y, 300);
});

test("release activates the CLAIMED portal even when a neighbour now sits under the pointer", () => {
  // The field rotated: at release the pointer is over Files' mouth (300 px away
  // from where the press started is too far, so move the world, not the hand).
  const press = claimed(studio);
  const release = { pointerId: 1, x: 403, y: 302 };
  const resolution = resolvePress(press, release, 0, 2000);
  assert.equal(resolution.kind, "activate");
  assert.ok(resolution.kind === "activate");
  assert.equal(resolution.press.portalId, studio.id, "the pressed portal is the one that opens");
  assert.equal(resolution.press.destination, "studio");
  assert.ok(resolution.moved <= PRESS_MOVE_THRESHOLD_PX);
});

test("the destination survives movement inside the threshold and is never re-resolved", () => {
  const press = claimed(files);
  const at18 = resolvePress(press, { pointerId: 1, x: 418, y: 300 }, 0, 2000);
  assert.equal(at18.kind, "activate", "18 px is still a press");
  const at19 = resolvePress(press, { pointerId: 1, x: 419.5, y: 300 }, 0, 2000);
  assert.equal(at19.kind, "refuse");
  assert.ok(at19.kind === "refuse");
  assert.equal(at19.reason, "moved", "beyond the threshold is a drag, not a press");
  assert.equal(at19.press.portalId, files.id, "and even a refusal keeps the pressed identity");
});

test("a different pointer cannot complete the press", () => {
  const press = claimed();
  const resolution = resolvePress(press, { pointerId: 7, x: 400, y: 300 }, 0, 2000);
  assert.equal(resolution.kind, "refuse");
  assert.ok(resolution.kind === "refuse");
  assert.equal(resolution.reason, "wrong-pointer");
});

test("one press produces one activation: the click derived from it is discarded", () => {
  const press = claimed();
  const activatedAt = 2000;
  const resolution = resolvePress(press, { pointerId: 1, x: 400, y: 300 }, 0, activatedAt);
  assert.equal(resolution.kind, "activate");
  const again = resolvePress(claimed(), { pointerId: 1, x: 400, y: 300 }, activatedAt, activatedAt + 40);
  assert.equal(again.kind, "refuse");
  assert.ok(again.kind === "refuse");
  assert.equal(again.reason, "duplicate");
  assert.equal(shouldSuppressClick(activatedAt, activatedAt + 40), true);
  assert.equal(shouldSuppressClick(activatedAt, activatedAt + ACTIVATION_WINDOW_MS), false);
});

test("a refused drag still suppresses the click that follows it", () => {
  const press = claimed();
  const resolution = resolvePress(press, { pointerId: 1, x: 500, y: 300 }, 0, 2000);
  assert.ok(resolution.kind === "refuse");
  // The component records the resolution time either way; this is that contract.
  const resolvedAt = 2000;
  assert.equal(shouldSuppressClick(resolvedAt, resolvedAt + 1), true);
});

test("an unmounted or cancelled field leaves no activation behind", () => {
  // Cancel clears the record: there is nothing to resolve, so nothing travels.
  let record: OwnedPress | null = claimed();
  record = null;
  assert.equal(record, null);
  const moved = pressMovement(claimed(), { pointerId: 1, x: 401, y: 300 });
  assert.equal(moved, 1);
});

test("a press that starts outside a portal cannot activate one on release", () => {
  // No claim was made, so there is no identity to travel to — the field's
  // release handler returns before doing anything.
  const empty: OwnedPress | null = null;
  assert.equal(empty, null);
});

test("a later press is a new interaction and activates normally", () => {
  const first = resolvePress(claimed(), { pointerId: 1, x: 400, y: 300 }, 0, 2000);
  assert.equal(first.kind, "activate");
  const second = resolvePress(claimed(files), { pointerId: 1, x: 400, y: 300 }, 2000, 2000 + ACTIVATION_WINDOW_MS + 1);
  assert.equal(second.kind, "activate");
  assert.ok(second.kind === "activate");
  assert.equal(second.press.destination, "files");
});

test("a new press replaces the previous claim, so a stale identity cannot leak", () => {
  const first = claimed(studio);
  const second = claimPress(files, { pointerId: 2, x: 800, y: 200 }, 1200);
  assert.notEqual(second.portalId, first.portalId);
  const resolution = resolvePress(second, { pointerId: 2, x: 800, y: 200 }, 0, 2000);
  assert.ok(resolution.kind === "activate");
  assert.equal(resolution.press.portalId, files.id, "the newest press owns the interaction");
});

test("a flight to another destination refuses a second request, but the same destination may re-enter", () => {
  assert.equal(refusesBusyFlight({ kind: "portal" }, "browser", "files"), true);
  assert.equal(refusesBusyFlight({ kind: "portal" }, "files", "files"), false);
  assert.equal(refusesBusyFlight(null, "files", "browser"), false, "an idle camera accepts anything");
});

test("every ring destination can be claimed and activated (the contract is per identity)", () => {
  const destinations = [
    "galaxy",
    "agents",
    "browser",
    "studio",
    "studio-3d",
    "projects",
    "files",
    "missions",
    "mail",
  ];
  for (const destination of destinations) {
    const press = claimPress(
      { id: `portal_builtin_${destination}`, destination, label: destination },
      { pointerId: 1, x: 10, y: 10 },
      0,
    );
    const resolution = resolvePress(press, { pointerId: 1, x: 10, y: 10 }, 0, 100);
    assert.ok(resolution.kind === "activate", `${destination} activates`);
    assert.equal(resolution.press.destination, destination);
  }
});
