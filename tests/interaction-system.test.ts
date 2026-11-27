/**
 * ==========================================================
 * LÉLU — SHARED INTERACTION SYSTEM
 *
 * CATEGORY: unit. Geometry, state ownership and the hold gesture are
 * pure, so they are tested without a browser. These are the rules every
 * radial menu in the project depends on:
 *
 *   - a ring is never clipped by a viewport edge;
 *   - one menu is open at a time;
 *   - a hold opens and STAYS open after release;
 *   - a tap stays a tap;
 *   - a scroll cancels a pending hold;
 *   - the keyboard can open the same menu.
 * ==========================================================
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  InteractionStateManager,
  clamp,
  placeContextMenu,
  placeRadial,
  radialOptionPosition,
  radialOptionPositions,
} from "../src/core/interaction/index";
import { createHoldGesture } from "../src/core/interaction/GestureController";
import { INTERACTION_TOKENS } from "../src/core/interaction/tokens";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------ geometry ------------------------------ */

test("a radial ring at the edge is kept whole inside the viewport", () => {
  for (const [width, height] of [
    [390, 844],
    [844, 390],
    [320, 320],
    [1440, 900],
  ]) {
    for (const anchor of [
      { left: 0, top: 0, width: 48, height: 48 },
      { left: width - 48, top: height - 48, width: 48, height: 48 },
      { left: width / 2, top: height / 2, width: 48, height: 48 },
    ]) {
      const placement = placeRadial(anchor, { width, height }, {
        itemCount: 8,
        optionSize: INTERACTION_TOKENS.size.option,
        preferredRadius: INTERACTION_TOKENS.radius.preferred,
      });
      const edge = placement.optionSize / 2 + INTERACTION_TOKENS.gap.edge;
      assert.ok(placement.centerX - placement.radius - edge >= -0.01, `${width}x${height}: left edge clipped`);
      assert.ok(placement.centerX + placement.radius + edge <= width + 0.01, `${width}x${height}: right edge clipped`);
      assert.ok(placement.centerY - placement.radius - edge >= -0.01, `${width}x${height}: top edge clipped`);
      assert.ok(placement.centerY + placement.radius + edge <= height + 0.01, `${width}x${height}: bottom edge clipped`);
    }
  }
});

test("a tiny viewport shrinks the ring rather than clipping it", () => {
  const placement = placeRadial(
    { left: 220, top: 0, width: 48, height: 48 },
    { width: 240, height: 240 },
    { itemCount: 6, optionSize: 56, preferredRadius: 104 },
  );
  assert.ok(placement.radius < 104, "the preferred radius was not reduced");
  assert.ok(placement.radius > 0);
});

test("radial options are distributed around the ring with no duplicates", () => {
  const positions = radialOptionPositions(8, 100);
  assert.equal(positions.length, 8);
  const keys = new Set(positions.map((p) => `${p.x.toFixed(3)}:${p.y.toFixed(3)}`));
  assert.equal(keys.size, 8);
  // First option is at the top, so it has a negative y and ~zero x.
  assert.ok(Math.abs(positions[0].x) < 0.001);
  assert.ok(positions[0].y < 0);
  const single = radialOptionPosition(0, 1, 50);
  assert.ok(Math.abs(single.x) < 0.001);
  assert.equal(single.y, -50);
});

test("a context menu flips above the control and is clamped sideways", () => {
  const below = placeContextMenu(
    { left: 140, top: 100, width: 48, height: 48 },
    { width: 230, height: 280 },
    { width: 390, height: 844 },
  );
  assert.equal(below.placement, "below");
  assert.ok(below.left >= 12);

  const flip = placeContextMenu(
    { left: 140, top: 700, width: 48, height: 48 },
    { width: 230, height: 280 },
    { width: 390, height: 844 },
  );
  assert.equal(flip.placement, "above");
  assert.ok(flip.top >= 12);
  assert.ok(flip.maxHeight > 0, "the menu has no height budget above the control");

  const edge = placeContextMenu(
    { left: 0, top: 100, width: 44, height: 44 },
    { width: 230, height: 100 },
    { width: 390, height: 844 },
  );
  assert.ok(edge.left >= 12, "menu ran off the left edge");
  assert.equal(clamp(-5, 0, 10), 0);
});

/* --------------------------- state ownership --------------------------- */

test("exactly one menu is open at a time, and subscribers see each change", () => {
  const manager = new InteractionStateManager();
  let changes = 0;
  const stop = manager.subscribe(() => {
    changes += 1;
  });
  const anchor = { left: 10, top: 10, width: 44, height: 44 };

  manager.open({ id: "one", kind: "radial", anchor });
  assert.equal(manager.openId, "one");
  manager.open({ id: "two", kind: "context", anchor });
  assert.equal(manager.openId, "two");
  assert.equal(manager.isOpen("one"), false);

  manager.close("one"); // not the open one: no change
  assert.equal(manager.openId, "two");
  assert.equal(changes, 2);

  manager.toggle({ id: "two", kind: "context", anchor });
  assert.equal(manager.openId, null);
  manager.close();
  assert.equal(changes, 3);
  stop();

  manager.open({ id: "three", kind: "radial", anchor });
  assert.equal(changes, 3, "an unsubscribed listener was still called");
});

/* --------------------------- environment coverage --------------------------- */

/**
 * Every named environment reaches its own actions through the shared
 * circular control. These are structural regressions: an environment that
 * grows back a row of chips, or hand-rolls its own hold gesture, fails here.
 */
test("every environment's actions come from the shared circular control", () => {
  const envs: Array<{ name: string; path: string; controls: string[]; retired?: RegExp }> = [
    {
      name: "Agent Universe",
      path: "src/app/scene/genesis/GenesisAgentsPanel.tsx",
      controls: ["agent-template-control", "agent-action-control"],
    },
    {
      name: "Workspace",
      path: "src/app/scene/genesis/GenesisProjectsPanel.tsx",
      controls: ["project-action-control", "project-add-control"],
    },
    {
      name: "Creation Studio",
      path: "src/app/scene/genesis/studio/GenesisCreationStudio.tsx",
      controls: ["studio-create-control"],
      retired: /data-lelu-studio-new/,
    },
    {
      name: "UI Universe",
      path: "src/app/scene/genesis/GenesisVisualStudio.tsx",
      controls: ["studio-mode-control"],
      retired: /data-studio-mode/,
    },
    {
      name: "Voice Studio",
      path: "src/app/scene/genesis/integration/VoiceStudioPanel.tsx",
      controls: ["voice-actions"],
    },
    {
      name: "Engineering Studio",
      path: "src/app/scene/genesis/integration/EngineeringStudioPanel.tsx",
      controls: ["engineering-actions"],
    },
    {
      name: "Executive Board",
      path: "src/app/scene/genesis/GenesisExecutivePanel.tsx",
      controls: ["executive-board-actions"],
    },
  ];

  for (const env of envs) {
    const source = readFileSync(env.path, "utf8");
    assert.match(source, /from "[./]*core\/interaction"/, `${env.name} must import the shared system`);
    assert.match(source, /<CircularControl/, `${env.name} must render a CircularControl`);
    for (const id of env.controls) {
      assert.match(source, new RegExp(`testId="${id}"`), `${env.name} is missing ${id}`);
    }
    if (env.retired) {
      assert.doesNotMatch(source, env.retired, `${env.name} still renders a bespoke control row`);
    }
    // One implementation: no environment owns a second hold gesture or ring.
    assert.doesNotMatch(source, /createHoldGesture|lelu-radial-layer|RadialMenu\b/, `${env.name} must not implement its own radial`);
  }
});

test("one registry names every environment, once each", () => {
  const registry = readFileSync("src/app/scene/genesis/interaction/destinations.ts", "utf8");
  for (const label of [
    "LÉLU CORE",
    "Cosmos",
    "Genesis Scene",
    "Chat Universe",
    "UI Universe",
    "Workspace",
    "Creation Studio",
    "Voice Studio",
    "Engineering Studio",
    "Agent Universe",
    "Executive Board",
    "Executive Galaxies",
  ]) {
    assert.ok(registry.includes(label), `the destination registry no longer offers ${label}`);
  }

  // One entry per panel: “Files” was the Workspace panel under a second name.
  const projectEntries = registry.match(/"projects"/g) ?? [];
  assert.equal(projectEntries.length, 1, "the Workspace panel is registered more than once");
  const workspaceLabels = registry.match(/"Workspace"/g) ?? [];
  assert.equal(workspaceLabels.length, 1, "Workspace is offered under more than one name");
  assert.doesNotMatch(registry, /"Files"/, "Files must not be a second destination for the Workspace panel");
});

test("the interface has exactly one navigation: the bottom dial", () => {
  const shell = readFileSync("src/app/scene/genesis/GenesisInterface.tsx", "utf8");
  const nav = readFileSync("src/app/scene/genesis/home/SpatialNav.tsx", "utf8");
  const home = readFileSync("src/app/scene/genesis/home/CosmosHome.tsx", "utf8");
  const catalog = readFileSync("src/app/scene/genesis/home/homeCatalog.ts", "utf8");

  // The second floating radial is gone, and nothing mounts it again.
  assert.doesNotMatch(shell, /EnvironmentRadial/, "a second navigation launcher is still mounted");
  assert.doesNotMatch(shell, /environment-radial-hidden|environmentRadialHidden/, "the shell still owns a second launcher's visibility");

  // The old horizontal destination bar is gone, with its catalog row.
  assert.doesNotMatch(home, /lch-apps/, "the dashboard still renders a horizontal app bar");
  assert.doesNotMatch(home, /PRIMARY/, "the dashboard still renders the old primary row");
  assert.doesNotMatch(catalog, /export const PRIMARY/, "the primary destination row still exists in the catalog");

  // The dial is the one thing that offers destinations, and it reads the one
  // registry instead of keeping its own copy of the list.
  assert.match(nav, /from "\.\.\/interaction\/destinations"/, "the dial does not read the destination registry");
  assert.match(nav, /const dialMenu: RadialMenuDefinition/, "the bottom dial has no radial menu");
  assert.doesNotMatch(nav, /const environments: RadialMenuItemSpec\[\]/, "the dial keeps a hand-written destination list");
});

/* ------------------------------- gesture ------------------------------- */

test("a hold opens once and survives release; a tap stays a tap", async () => {
  let taps = 0;
  let holds = 0;
  const gesture = createHoldGesture({ holdMs: 12, onTap: () => (taps += 1), onHold: () => (holds += 1) });

  gesture.onPointerDown({ pointerId: 1, clientX: 10, clientY: 10 });
  await sleep(30);
  assert.equal(holds, 1, "the hold did not fire");
  gesture.onPointerUp({ pointerId: 1, clientX: 10, clientY: 10 });
  assert.equal(taps, 0, "releasing after a hold also fired a tap");
  assert.equal(holds, 1, "the menu closed on release or opened twice");

  gesture.onPointerDown({ pointerId: 2, clientX: 10, clientY: 10 });
  gesture.onPointerUp({ pointerId: 2, clientX: 10, clientY: 10 });
  assert.equal(taps, 1);
  assert.equal(holds, 1);
});

test("movement past the threshold cancels the hold — a scroll is a scroll", async () => {
  let taps = 0;
  let holds = 0;
  let cancels = 0;
  const gesture = createHoldGesture({
    holdMs: 20,
    moveCancelPx: 8,
    onTap: () => (taps += 1),
    onHold: () => (holds += 1),
    onCancel: () => (cancels += 1),
  });
  gesture.onPointerDown({ pointerId: 3, clientX: 0, clientY: 0 });
  gesture.onPointerMove({ pointerId: 3, clientX: 0, clientY: 24 });
  await sleep(35);
  gesture.onPointerUp({ pointerId: 3, clientX: 0, clientY: 24 });
  assert.equal(holds, 0);
  assert.equal(taps, 0);
  assert.equal(cancels, 1);
});

test("the keyboard opens the same menu as a hold", () => {
  let holds = 0;
  let taps = 0;
  const withMenu = createHoldGesture({ onTap: () => (taps += 1), onHold: () => (holds += 1) });
  withMenu.onKeyDown({ key: "Enter", preventDefault: () => {} });
  assert.equal(holds, 1);
  assert.equal(taps, 0);

  const plain = createHoldGesture({ onTap: () => (taps += 1) });
  plain.onKeyDown({ key: " ", preventDefault: () => {} });
  assert.equal(taps, 1);
});
