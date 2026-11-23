/**
 * The dev-only scene switch used by browser acceptance (M22.3).
 *
 * It must disable the 3D presentation and nothing else, and it must not
 * exist in production at all.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { sceneDisabledBySearch } from "../src/app/scene/genesis/sceneTestMode";

test("scene test mode: ?scene=off disables the scene in development", () => {
  assert.equal(sceneDisabledBySearch("?scene=off", true), true);
  assert.equal(sceneDisabledBySearch("?foo=1&scene=off", true), true);
});

test("scene test mode: any other value leaves the scene alone", () => {
  assert.equal(sceneDisabledBySearch("", true), false);
  assert.equal(sceneDisabledBySearch("?scene=on", true), false);
  assert.equal(sceneDisabledBySearch("?scene=", true), false);
  assert.equal(sceneDisabledBySearch("?scenery=off", true), false);
});

test("scene test mode: production can never be switched off by a link", () => {
  assert.equal(sceneDisabledBySearch("?scene=off", false), false);
});
