/**
 * The dock's information architecture must be derived from surfaces that
 * exist — a group that advertises a destination the app cannot open is the
 * failure mode this file exists to prevent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DOCK_GLYPHS,
  dockEntryFor,
  dockGroups,
  groupFor,
  orderedGroups,
  ungroupedScenes,
} from "../src/app/scene/spatial/capabilityGroups";
import { SPATIAL_DESTINATIONS } from "../src/app/scene/spatial/SpatialScenes";

const root = process.cwd();
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

test("the dock has the five groups the brief defines, each with real entries", () => {
  const groups = dockGroups();
  assert.deepEqual(
    groups.map((group) => group.id),
    ["environment", "intelligence", "creation", "resources", "communication"],
  );
  for (const group of groups) {
    assert.ok(group.entries.length > 0, `${group.id} is not an empty heading`);
    assert.ok(group.label.length > 0);
    assert.match(group.accent, /^#[0-9a-f]{6}$/i, `${group.id} carries a real accent`);
  }
});

test("every destination appears at most once, and only if the scene graph has it", () => {
  const scenes = dockGroups().flatMap((group) => group.entries.map((entry) => entry.scene));
  assert.equal(new Set(scenes).size, scenes.length, "no destination is offered twice");
  const known = new Set(SPATIAL_DESTINATIONS.map((destination) => destination.id));
  for (const scene of scenes) {
    assert.ok(known.has(scene), `${scene} exists in the scene graph`);
  }
  // "core" is the return control, not a destination in the groups.
  assert.ok(!scenes.includes("core"));
});

test("every grouped entry opens a panel GenesisCore actually declares", () => {
  const core = source("src/app/scene/genesis/GenesisCore.tsx");
  const declared = new Set([...core.matchAll(/\|\s*"([a-z0-9-]+)"/g)].map((match) => match[1]));
  for (const group of dockGroups()) {
    for (const entry of group.entries) {
      if (!entry.panel) continue;
      assert.ok(declared.has(entry.panel), `${entry.scene} opens "${entry.panel}", declared by GenesisCore`);
    }
  }
});

test("an entry never invents its label, hint or accent", () => {
  for (const group of dockGroups()) {
    for (const entry of group.entries) {
      const destination = SPATIAL_DESTINATIONS.find((item) => item.id === entry.scene);
      assert.ok(destination, `${entry.scene} exists`);
      assert.equal(entry.label, destination!.label);
      assert.equal(entry.hint, destination!.hint);
      assert.equal(entry.accent, destination!.accent);
      assert.equal(entry.glyph, DOCK_GLYPHS[entry.scene]);
    }
  }
});

test("the dock knows where the person is standing", () => {
  assert.equal(groupFor("studio"), "creation");
  assert.equal(groupFor("browser"), "environment");
  assert.equal(groupFor("conversation"), "communication");
  assert.equal(groupFor("cosmos"), "environment");
  assert.equal(groupFor(null), null);
  assert.equal(groupFor("core"), null, "the core is a return control, not a group");

  const ordered = orderedGroups("studio");
  assert.equal(ordered[0].id, "creation", "the active group leads");
  assert.equal(ordered.length, dockGroups().length, "nothing is dropped by ordering");
  assert.deepEqual(orderedGroups(null).map((group) => group.id), dockGroups().map((group) => group.id));
});

test("lookups agree with the groups", () => {
  const entry = dockEntryFor("projects");
  assert.ok(entry);
  assert.equal(entry!.label, "Projects");
  assert.equal(dockGroups().concat().find((group) => group.id === "resources")!.entries.some((item) => item.scene === "projects"), true);
});

test("nothing is left stranded outside a group unintentionally", () => {
  // If this ever grows, the destination is still reachable through the scene
  // graph and the studio/browser surfaces — but it should be a deliberate
  // decision, so the list is asserted rather than ignored.
  assert.deepEqual(ungroupedScenes(), []);
});
