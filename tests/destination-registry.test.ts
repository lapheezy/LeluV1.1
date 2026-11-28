/**
 * ==========================================================
 * LÉLU — THE DESTINATION REGISTRY, GUARDED
 *
 * The dial is only authoritative if the data behind it is true. These
 * checks are the registry's contract (WP15 §2):
 *
 *   - every destination names a panel the interface really renders, or the
 *     one navigation action it performs — no phantom routes;
 *   - nothing is listed twice, by id, by label, or by the place it opens;
 *   - a group is a group (Work, Intelligence) and never a destination;
 *   - ids are stable, so a destination keeps its identity across
 *     environments and across releases;
 *   - the tree nests, so a workspace's projects and conversations can be
 *     reached as deeper levels of the SAME dial — no new bar per level.
 *
 * The panel list is read from the interface's own module map and its
 * directly-mounted panels rather than restated here: a destination that
 * claims a panel nobody renders fails, and so does a renderer id that is
 * spelled differently in the registry.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  allDestinations,
  DIAL,
  destinationById,
  destinationPath,
  groupOf,
  INTELLIGENCE,
  SPACES,
  WORK,
  type Destination,
  type DestinationGroup,
} from "../src/app/scene/genesis/interaction/destinations";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const interfaceSource = read("../src/app/scene/genesis/GenesisInterface.tsx");
const coreSource = read("../src/app/scene/genesis/GenesisCore.tsx");

/** `id: ({ onClose }) => <… />` entries of MODULE_RENDERERS. */
const renderedPanels = new Set(
  [...interfaceSource.matchAll(/^\s{2}"?([a-z][a-z-]*)"?:\s*\(\{\s*onClose\s*\}\)/gm)].map((match) => match[1]),
);

/** Panels mounted straight off `activePanel` (`{state.activePanel === "cosmos" ? …}`). */
const directlyMountedPanels = new Set(
  [...interfaceSource.matchAll(/activePanel === "([a-z][a-z-]*)"/g)].map((match) => match[1]),
);

/** The interface's own panel table is the source of truth for "registered". */
const registeredPanels = new Set([
  ...renderedPanels,
  ...directlyMountedPanels,
  // The chat is the Universe (openPanel routes it), and Gen V2 is a SCENE
  // switch handled in GenesisCore, not a module with a renderer.
  ...(coreSource.includes('panel === "chat"') ? ["chat"] : []),
  ...(coreSource.includes('panel === "genesisv2"') ? ["genesisv2"] : []),
]);

const destinations = allDestinations();

test("the registry has one entry per place, at every depth", () => {
  const ids = destinations.map((destination) => destination.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `duplicate destination ids: ${duplicates.join(", ")}`);
  assert.ok(destinations.length >= 15, `expected the whole interface to be reachable, found ${destinations.length}`);
});

test("no destination is offered under two names", () => {
  const labels = destinations.map((destination) => destination.label.toLowerCase());
  const duplicates = labels.filter((label, index) => labels.indexOf(label) !== index);
  assert.deepEqual(duplicates, [], `the same place is offered twice: ${duplicates.join(", ")}`);

  /* “Files” was the Workspace under another name — that is the bug this ends. */
  assert.equal(allDestinations().some((destination) => destination.label === "Files"), false);
  assert.equal(destinations.filter((destination) => destination.target.kind === "panel" && destination.target.panel === "projects").length, 1);
});

test("every destination resolves to a place the interface really renders", () => {
  for (const destination of destinations) {
    const target = destination.target;
    if (target.kind === "panel") {
      assert.ok(
        registeredPanels.has(target.panel),
        `${destination.id} opens panel "${target.panel}", which MODULE_RENDERERS and the mounted panels do not provide`,
      );
    } else {
      assert.ok(
        ["home", "immersive", "chat", "conversation", "project"].includes(target.kind),
        `${destination.id} has an unknown target kind "${target.kind}"`,
      );
    }
  }
});

test("two destinations never perform the same navigation", () => {
  /* "Executive Galaxies" used to be a second Cosmos: the same `immersive`
     target under another label. One destination, one place. */
  const seen = new Map<string, string>();
  for (const destination of destinations) {
    const key =
      destination.target.kind === "panel"
        ? `panel:${destination.target.panel}`
        : `${destination.target.kind}`;
    const previous = seen.get(key);
    assert.equal(previous, undefined, `${destination.id} and ${previous} both open ${key}`);
    seen.set(key, destination.id);
  }
});

test("Work and Intelligence are organizational groups, never destinations", () => {
  for (const group of [WORK, INTELLIGENCE]) {
    assert.equal(group.kind, "group");
    assert.ok(group.items.length > 1, `${group.id} is a group of one`);
    assert.equal(destinations.some((destination) => destination.id === group.id), false, `${group.id} is also a destination`);
    assert.equal(groupOf(group.items[0].id)?.id, group.id);
  }
  /* The root ring holds the five spaces and the two categories, nothing else. */
  assert.deepEqual(DIAL.map((entry) => entry.id), ["core", "cosmos", "genesis", "chat", "browser", "work", "intelligence"]);
  assert.deepEqual(SPACES.map((space) => space.id), ["core", "cosmos", "genesis", "chat", "browser"]);
});

test("destination identity is stable", () => {
  assert.deepEqual(
    destinations.map((destination) => destination.id).sort(),
    [
      "agents",
      "browser",
      "chat",
      "core",
      "cosmos",
      "creation",
      "eng-studio",
      "executive",
      "galaxies",
      "genesis",
      "memory",
      "reasoning",
      "render",
      "sketch",
      "ui",
      "video",
      "voice-studio",
      "workspace",
    ],
    "a destination id changed — rename is a navigation change, not a refactor",
  );
  /* One id, one destination, every lookup path. */
  assert.equal(destinationById("workspace")?.label, "Workspace");
  assert.equal(destinationById("ghost"), null);
});

test("the tree nests, so a space can hold its own contents", () => {
  /* Work → its studios is two levels; the dial adds the third (projects,
     conversations) from the stores at render time. Both must resolve. */
  assert.deepEqual(destinationPath("workspace").map((entry) => entry.id), ["work", "workspace"]);
  assert.deepEqual(destinationPath("core").map((entry) => entry.id), ["core"]);
  assert.deepEqual(destinationPath("nothing"), []);

  const nested: DestinationGroup = {
    id: "outer",
    label: "Outer",
    hint: "outer",
    icon: "Layers",
    kind: "group",
    items: [{ id: "inner", label: "Inner", hint: "inner", icon: "Layers", kind: "group", items: [destinations[0]] }],
  };
  const leaf: Destination = allDestinations(nested.items)[0];
  assert.equal(leaf.id, destinations[0].id, "a group three levels deep still resolves to its leaves");
  assert.equal(allDestinations(nested.items).length, 1);
});
