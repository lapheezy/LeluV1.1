/**
 * The Spatial bar is put away on the Home unless she asks: the side tab, the
 * menu entry, or LÉLU ("open the spatial menu" / "hide the spatial bar").
 * The browser script scripts/home/verify-spatial-hidden.mjs proves the same
 * in the real app, with a picture at every step.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpatialNavCommand } from "../src/core/router/SurfaceResolver";

test("LÉLU opens the spatial bar", () => {
  for (const t of ["open the spatial menu", "LÉLU, open the spatial bar", "show me the spatial navigation", "please bring up the spatial nav", "can you open spatial menu"]) {
    assert.equal(parseSpatialNavCommand(t), true, t);
  }
});

test("LÉLU hides the spatial bar", () => {
  for (const t of ["hide the spatial bar", "close the spatial menu", "lelu put away the spatial navigation", "get rid of the spatial bar"]) {
    assert.equal(parseSpatialNavCommand(t), false, t);
  }
});

test("ordinary talk about 'spatial' is not a command", () => {
  for (const t of ["what is spatial computing", "open the browser", "I like the spatial menu", "spatial audio is cool", "show me spatial audio"]) {
    assert.equal(parseSpatialNavCommand(t), null, t);
  }
});

test("the bar starts hidden and follows requests", async () => {
  const listeners: Record<string, Array<(e: Event) => void>> = {};
  const g = globalThis as Record<string, unknown>;
  const previous = g.window;
  g.window = {
    addEventListener: (n: string, f: (e: Event) => void) => (listeners[n] ??= []).push(f),
    removeEventListener: () => {},
    dispatchEvent: (e: Event) => {
      for (const f of listeners[e.type] ?? []) f(e);
      return true;
    },
  };
  try {
    const m = await import("../src/app/scene/spatial/spatialNavVisibility");
    assert.equal(m.isSpatialNavShown(), false);
    m.requestSpatialNav(true);
    assert.equal(m.isSpatialNavShown(), true);
    m.requestSpatialNav("toggle");
    assert.equal(m.isSpatialNavShown(), false);
    m.requestSpatialNav("toggle");
    m.requestSpatialNav(false);
    assert.equal(m.isSpatialNavShown(), false);
  } finally {
    g.window = previous;
  }
});
