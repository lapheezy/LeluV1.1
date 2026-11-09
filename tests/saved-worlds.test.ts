/**
 * Saved worlds reach the navigator: environments made through the world
 * engine are listed from the same store (not a second world system), and
 * sandboxes under test are not offered as places to go.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { listedWorlds } from "../src/app/scene/spatial/SavedWorlds";

const env = (id: string, sandbox = false) => ({ id, name: id, kind: "room", sandbox, sandboxOf: sandbox ? "home" : null, version: 1 });

test("created environments are listed; sandboxes are not; nothing without the engine", () => {
  assert.deepEqual(listedWorlds({ environments: [env("home"), env("moon-oasis"), env("home-sandbox", true)] }).map((e) => e.id), ["home", "moon-oasis"]);
  assert.deepEqual(listedWorlds(null), []);
  assert.equal(listedWorlds({ environments: Array.from({ length: 20 }, (_, i) => env(`w${i}`)) }).length, 12, "bounded");
});

test("the navigator shows them, and choosing one enters it in the engine and opens the world view", () => {
  const nav = readFileSync("src/app/scene/spatial/SpatialNavigator.tsx", "utf8");
  assert.match(nav, /<SavedWorlds compact=\{compact\} \/>/);
  const row = readFileSync("src/app/scene/spatial/SavedWorlds.tsx", "utf8");
  assert.match(row, /await ForgeClient\.enterEnvironment\(id\);\s*openPanel\("genesisv2"\);/);
  assert.match(row, /window\.addEventListener\(FORGE_CHANGED_EVENT, load\)/, "a world LÉLU creates appears without a reload");
});
