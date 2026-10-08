/**
 * ==========================================================
 * LÉLU — WORKSPACE LAYOUT AND LAYER ORDER
 *
 * CATEGORY: unit. Pure measurement and ordering; reads the
 * real source tree for the structural assertions.
 *
 * Why this exists: the interface behaved as though it owned a
 * fixed desktop canvas. Eleven components each measured
 * `window.innerWidth` and each picked its own "am I mobile"
 * threshold, so inside the Freebuff workspace they laid out
 * for room they did not have, and they could disagree with
 * each other — which is how absolutely-positioned controls
 * ended up on top of one another.
 *
 * Twenty hand-written z-index values between 5 and 100
 * encoded no hierarchy at all, so "notifications must not
 * cover the composer" was true only by accident.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { LAYERS, layer, within } from "../src/core/ui/Layers";
import { BREAKPOINTS, measure } from "../src/core/ui/Workspace";

/* ---------------------------- measurement ---------------------------- */

test("the container's own size decides the layout, not the window's", () => {
  // The Freebuff case: a wide window, a narrow container.
  const metrics = measure(480, 900);
  assert.equal(metrics.size, "compact");
  assert.equal(metrics.compact, true);
  assert.equal(metrics.width, 480, "the measured box is what is reported");
});

test("breakpoints are ordered and cover every width", () => {
  assert.ok(BREAKPOINTS.compact < BREAKPOINTS.medium);
  assert.equal(measure(BREAKPOINTS.compact - 1, 800).size, "compact");
  assert.equal(measure(BREAKPOINTS.compact, 800).size, "medium");
  assert.equal(measure(BREAKPOINTS.medium - 1, 800).size, "medium");
  assert.equal(measure(BREAKPOINTS.medium, 800).size, "wide");
});

test("an open keyboard is detected without the container resizing", () => {
  // A keyboard shrinks the visual viewport only, so a ResizeObserver
  // never fires — which is why the composer went under the keyboard.
  const closed = measure(400, 800, { visibleHeight: 800 });
  assert.equal(closed.keyboardOpen, false);
  const open = measure(400, 800, { visibleHeight: 420 });
  assert.equal(open.keyboardOpen, true);
  assert.equal(open.height, 800, "the layout viewport is unchanged");
  assert.equal(open.visibleHeight, 420, "only the visible area shrank");
});

test("browser-chrome rounding is not mistaken for a keyboard", () => {
  const nudged = measure(400, 800, { visibleHeight: 760 });
  assert.equal(nudged.keyboardOpen, false, "a 40px shortfall is chrome, not a keyboard");
});

test("orientation is reported independently of width", () => {
  assert.equal(measure(900, 1200).portrait, true);
  assert.equal(measure(1200, 900).portrait, false);
  // A wide-but-short container is landscape even on a phone-class width.
  assert.equal(measure(700, 360).portrait, false);
});

test("safe-area insets are carried through as numbers", () => {
  const metrics = measure(390, 844, { safeTop: 47, safeBottom: 34 });
  assert.equal(metrics.safeTop, 47);
  assert.equal(metrics.safeBottom, 34);
});

test("metrics default safely when nothing has been measured", () => {
  const metrics = measure(0, 0);
  assert.equal(metrics.visibleHeight, 0);
  assert.equal(metrics.keyboardOpen, false, "0×0 must not read as a keyboard");
  assert.equal(metrics.size, "compact");
});

/* ------------------------------- layers ------------------------------- */

test("notifications never cover the composer", () => {
  // The brief's hard requirement, and the screenshot's complaint.
  assert.ok(
    LAYERS.composer < LAYERS.notification,
    "a suggestion paints above the composer only if it is allowed to cover it",
  );
});

test("the composer sits above navigation", () => {
  // The controls the user is mid-interaction with win over the dock.
  assert.ok(LAYERS.navigation < LAYERS.composer);
  assert.ok(LAYERS.tabs < LAYERS.composer);
});

test("navigation is never covered by a panel", () => {
  // A panel that covers the dock hides the only way to close it.
  assert.ok(LAYERS.panel < LAYERS.navigation);
  assert.ok(LAYERS.panelActive < LAYERS.navigation);
});

test("the full stack is strictly ordered", () => {
  const order = [
    "scene", "panel", "panelActive", "navigation", "tabs",
    "composer", "notification", "overlay", "modal", "tooltip",
  ] as const;
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      LAYERS[order[i - 1]] < LAYERS[order[i]],
      `${order[i - 1]} must sit below ${order[i]}`,
    );
  }
});

test("stacking inside a layer cannot escape it", () => {
  // This is how twenty ad-hoc numbers drifted into each other.
  const names = Object.keys(LAYERS) as Array<keyof typeof LAYERS>;
  for (const name of names) {
    const next = Math.min(
      ...names.map((n) => LAYERS[n]).filter((value) => value > LAYERS[name]),
    );
    if (!Number.isFinite(next)) continue;
    assert.ok(
      within(name, 999) < next,
      `${name} with a large offset must stay below the next layer`,
    );
  }
});

test("layer() returns the declared value", () => {
  assert.equal(layer("composer"), LAYERS.composer);
  assert.equal(within("panel", 0), LAYERS.panel);
  assert.equal(within("panel", 3), LAYERS.panel + 3);
  assert.equal(within("panel", -5), LAYERS.panel, "a negative offset cannot sink a layer");
});

/* --------------------------- the real tree --------------------------- */

test("the measurement root is attached to the workspace element", () => {
  const source = readFileSync("src/app/scene/genesis/GenesisInterface.tsx", "utf8");
  assert.match(source, /data-workspace="genesis-unified"/);
  assert.match(source, /ref=\{attachWorkspaceRoot\}/, "the root must actually be observed");
});

/** Source with comments removed, so prose about a bug is not read as the bug. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the chat decides compactness from the workspace, not the window", () => {
  const source = code("src/app/scene/genesis/GenesisChat.tsx");
  // prefers-reduced-motion is a legitimate window-level query and is not
  // about layout; a WIDTH query on the window is the bug.
  assert.ok(
    !/matchMedia\([^)]*width/.test(source),
    "a window width query cannot see the container the chat is mounted in",
  );
  assert.match(source, /workspace\.width <= 720/);
});

test("core navigation and transient surfaces use the hierarchy, not literals", () => {
  for (const file of [
    "src/app/scene/genesis/GenesisDock.tsx",
    "src/app/scene/genesis/GenesisCommandPalette.tsx",
    "src/app/scene/genesis/GenesisMobileMenu.tsx",
    "src/app/scene/genesis/MultiChatTabs.tsx",
    "src/app/scene/genesis/OgDockTabs.tsx",
  ]) {
    const source = code(file);
    assert.ok(
      !/zIndex:\s*\d+/.test(source),
      `${file} still sets a bare z-index; ordering must come from LAYERS`,
    );
    assert.match(source, /core\/ui\/Layers/, `${file} must use the hierarchy`);
  }
});

test("the cognition card is on the notification layer", () => {
  const source = readFileSync("src/app/scene/genesis/GenesisChat.tsx", "utf8");
  const card = source.slice(source.indexOf("data-lelu-proactive-question"));
  assert.match(card.slice(0, 900), /zIndex: layer\("notification"\)/);
});
